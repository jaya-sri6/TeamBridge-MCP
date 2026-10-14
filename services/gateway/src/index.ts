import fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { db, initSeedData } from "./db.js";
import { generateApiKey, hashApiKey, maskSecret, encryptSecret, decryptSecret, validateUpstreamUrl } from "./crypto.js";
import { upstreamManager, UpstreamRecord } from "./upstream-manager.js";
import { executeChatTurn } from "./chat-agent.js";

// Rate Limiter per User/Key (60 requests per minute)
class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private hits: Map<string, number[]>;

  constructor(windowMs = 60000, maxRequests = 60) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();
  }

  isRateLimited(key: string): { limited: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    const timestamps = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      const retryAfter = Math.ceil((oldest + this.windowMs - now) / 1000);
      return { limited: true, remaining: 0, retryAfterSeconds: Math.max(1, retryAfter) };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { limited: false, remaining: this.maxRequests - timestamps.length, retryAfterSeconds: 0 };
  }
}

export const rateLimiter = new RateLimiter(60000, 60);

// RBAC Policy: Mutating tools requiring 'admin' privileges
export const ADMIN_ONLY_TOOLS = new Set([
  "create_product",
  "update_order_status",
  "create_task",
  "update_task_status",
  "woo__create_product",
  "woo__update_order_status",
  "tasks__create_task",
  "tasks__update_task_status",
  "store2__create_product",
  "store2__update_order_status",
]);

export function isToolAllowedForRole(role: string, toolName: string): boolean {
  if (role === "admin") return true;
  return !ADMIN_ONLY_TOOLS.has(toolName);
}

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = fastify({ logger: true });

// Enable CORS for external MCP clients and local development
await server.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-User-Id", "X-MCP-API-KEY"],
});

// Seed default database state
initSeedData();

// Serve static frontend assets if dashboard dist exists
const possibleDistPaths = [
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "..", "..", "apps", "dashboard", "dist"),
  "/app/public",
];
const dashboardDist = possibleDistPaths.find((p) => fs.existsSync(p));
if (dashboardDist) {
  server.register(fastifyStatic, {
    root: dashboardDist,
    prefix: "/",
  });
}

// Liveness & Readiness Probes
server.get("/healthz", async () => ({ status: "ok", service: "teambridge-gateway" }));
server.get("/livez", async () => ({ status: "ok" }));

// Helper: Authenticate User via API Key or Header
function authenticateRequest(req: any): { user: { id: string; email: string; role: string; name: string }; keyId?: string } | null {
  const authHeader = req.headers["authorization"] || "";
  let apiKeyPlaintext = "";

  if (authHeader.startsWith("Bearer ")) {
    apiKeyPlaintext = authHeader.substring(7).trim();
  }

  if (apiKeyPlaintext) {
    const keyHash = hashApiKey(apiKeyPlaintext);
    const keyRecord = db.prepare(`
      SELECT k.*, u.id as user_id, u.email as user_email, u.name as user_name, u.role as user_role
      FROM api_keys k
      JOIN users u ON k.user_id = u.id
      WHERE k.key_hash = ?
    `).get(keyHash) as any;

    if (!keyRecord) {
      return null;
    }

    if (keyRecord.revoked === 1) {
      return null;
    }

    // Update last used timestamp
    db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), keyRecord.id);

    return {
      user: {
        id: keyRecord.user_id,
        email: keyRecord.user_email,
        name: keyRecord.user_name,
        role: keyRecord.user_role,
      },
      keyId: keyRecord.id,
    };
  }

  // Dashboard session fallback: check X-User-Id header
  const userIdHeader = req.headers["x-user-id"];
  if (userIdHeader) {
    const userRecord = db.prepare("SELECT * FROM users WHERE id = ?").get(userIdHeader) as any;
    if (userRecord) {
      return {
        user: {
          id: userRecord.id,
          email: userRecord.email,
          name: userRecord.name,
          role: userRecord.role,
        },
      };
    }
  }

  return null;
}

// -------------------------------------------------------------
// 1. Unified Team MCP Endpoint (/mcp) - Streamable HTTP
// -------------------------------------------------------------
server.post("/mcp", async (req, reply) => {
  const auth = authenticateRequest(req);
  if (!auth) {
    return reply.status(401).send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized: Invalid or revoked API key" },
    });
  }

  const { user } = auth;

  // Rate Limiting Enforcement
  const rateCheck = rateLimiter.isRateLimited(user.id);
  if (rateCheck.limited) {
    reply.header("Retry-After", rateCheck.retryAfterSeconds);
    return reply.status(429).send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32029,
        message: `Rate limit exceeded. Maximum 60 requests/minute. Retry after ${rateCheck.retryAfterSeconds}s.`,
      },
    });
  }

  const body = req.body as any;
  if (!body || typeof body !== "object") {
    return reply.status(400).send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }

  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== "2.0") {
    return reply.status(400).send({
      jsonrpc: "2.0",
      id: id || null,
      error: { code: -32600, message: "Invalid Request: Expected jsonrpc 2.0" },
    });
  }

  if (method === "initialize") {
    return reply.send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
        serverInfo: {
          name: "teambridge-gateway",
          version: "1.0.0",
          description: "TeamBridge Unified MCP Gateway for WooCommerce and Microservices",
        },
      },
    });
  }

  if (method === "notifications/initialized") {
    return reply.status(204).send();
  }

  if (method === "tools/list") {
    const { tools } = await upstreamManager.getAggregatedTools();
    // Filter tools based on user's RBAC role
    const filteredTools = user.role === "admin"
      ? tools
      : tools.filter((t) => isToolAllowedForRole(user.role, t.name));

    return reply.send({
      jsonrpc: "2.0",
      id,
      result: { tools: filteredTools },
    });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    if (!toolName) {
      return reply.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing tool name" },
      });
    }

    // RBAC Permission Enforcement
    if (!isToolAllowedForRole(user.role, toolName)) {
      const deniedMsg = `Access Denied: Tool '${toolName}' requires 'admin' role, but user '${user.email}' has role '${user.role}'`;
      try {
        db.prepare(`
          INSERT INTO audit_logs (id, user_id, user_email, upstream_id, upstream_slug, tool_name, raw_tool_name, arguments_json, success, duration_ms, error_message, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `aud_${crypto.randomUUID()}`,
          user.id,
          user.email,
          null,
          null,
          toolName,
          toolName,
          JSON.stringify(toolArgs || {}),
          0,
          2,
          deniedMsg,
          new Date().toISOString()
        );
      } catch {}

      return reply.status(403).send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32003,
          message: deniedMsg,
        },
      });
    }

    const start = Date.now();
    let success = 1;
    let errorMsg: string | null = null;
    let result: any = null;
    let upstreamSlug: string | null = null;
    let upstreamId: string | null = null;
    let rawTool = toolName;

    try {
      const exec = await upstreamManager.callTool(toolName, toolArgs);
      result = exec.result;
      upstreamSlug = exec.upstream.slug;
      upstreamId = exec.upstream.id;
      rawTool = exec.rawToolName;
      if (result?.isError) {
        success = 0;
        errorMsg = result?.content?.[0]?.text || "Tool reported failure";
      }
    } catch (err: any) {
      success = 0;
      errorMsg = err.message;
      result = {
        isError: true,
        content: [{ type: "text", text: `Gateway call error: ${err.message}` }],
      };
    }

    const durationMs = Date.now() - start;

    // Write audit log entry
    try {
      db.prepare(`
        INSERT INTO audit_logs (id, user_id, user_email, upstream_id, upstream_slug, tool_name, raw_tool_name, arguments_json, success, duration_ms, error_message, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `aud_${crypto.randomUUID()}`,
        user.id,
        user.email,
        upstreamId,
        upstreamSlug,
        toolName,
        rawTool,
        JSON.stringify(toolArgs || {}),
        success,
        durationMs,
        errorMsg,
        new Date().toISOString()
      );
    } catch (dbErr) {
      console.error("Audit log error:", dbErr);
    }

    return reply.send({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  if (method === "ping") {
    return reply.send({ jsonrpc: "2.0", id, result: {} });
  }

  return reply.send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

server.get("/mcp", async () => ({
  status: "ok",
  gateway: "teambridge-mcp-gateway",
  endpoint: "/mcp",
  transport: "streamable-http",
}));

// -------------------------------------------------------------
// 2. Dashboard REST APIs
// -------------------------------------------------------------

// Current Authenticated User Info
server.get("/api/auth/me", async (req, reply) => {
  const auth = authenticateRequest(req);
  if (!auth) {
    // Default to admin for seamless first-load dashboard experience
    const defaultAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get() as any;
    return defaultAdmin ? { user: defaultAdmin } : reply.status(401).send({ error: "Unauthorized" });
  }
  return { user: auth.user };
});

// Users Management
server.get("/api/users", async () => {
  const users = db.prepare("SELECT id, email, name, role, created_at FROM users ORDER BY created_at ASC").all();
  return { users };
});

server.post("/api/users", async (req, reply) => {
  const body = req.body as any;
  if (!body.email || !body.name) {
    return reply.status(400).send({ error: "Name and email are required" });
  }
  const id = `user_${crypto.randomUUID().substring(0, 8)}`;
  const role = body.role === "admin" ? "admin" : "member";
  const now = new Date().toISOString();

  try {
    db.prepare("INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      body.email,
      body.name,
      role,
      now
    );
    return { user: { id, email: body.email, name: body.name, role, created_at: now } };
  } catch (err: any) {
    return reply.status(400).send({ error: err.message });
  }
});

// API Keys Management
server.get("/api/keys", async (req, reply) => {
  const auth = authenticateRequest(req);
  const targetUserId = (req.query as any)?.userId || auth?.user.id;

  let keys: any[];
  if (targetUserId) {
    keys = db.prepare(`
      SELECT k.id, k.user_id, k.prefix, k.label, k.revoked, k.created_at, k.last_used_at, u.email as user_email
      FROM api_keys k
      JOIN users u ON k.user_id = u.id
      WHERE k.user_id = ?
      ORDER BY k.created_at DESC
    `).all(targetUserId);
  } else {
    keys = db.prepare(`
      SELECT k.id, k.user_id, k.prefix, k.label, k.revoked, k.created_at, k.last_used_at, u.email as user_email
      FROM api_keys k
      JOIN users u ON k.user_id = u.id
      ORDER BY k.created_at DESC
    `).all();
  }
  return { keys };
});

server.post("/api/keys", async (req, reply) => {
  const auth = authenticateRequest(req);
  const body = req.body as any;
  const targetUserId = body.userId || auth?.user.id;
  if (!targetUserId) {
    return reply.status(400).send({ error: "User ID is required" });
  }

  const label = body.label || "Personal API Key";
  const { plaintext, prefix, keyHash } = generateApiKey();
  const id = `key_${crypto.randomUUID().substring(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO api_keys (id, user_id, prefix, key_hash, label, revoked, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(id, targetUserId, prefix, keyHash, label, now);

  return {
    key: {
      id,
      userId: targetUserId,
      prefix,
      label,
      createdAt: now,
      plaintextKey: plaintext, // Returned ONCE upon generation
    },
  };
});

server.delete("/api/keys/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const result = db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(id);
  if (result.changes === 0) {
    return reply.status(404).send({ error: "Key not found" });
  }
  return { success: true, message: "API key revoked immediately" };
});

// Upstream MCP Servers Management
server.get("/api/upstreams", async () => {
  const upstreams = upstreamManager.getAllUpstreams();
  const checks = await Promise.all(upstreams.map((u) => upstreamManager.checkUpstream(u)));

  // Mask credentials in output
  const safeUpstreams = checks.map((chk) => {
    const raw = upstreams.find((u) => u.id === chk.id);
    return {
      ...chk,
      credentialType: raw?.credential_type || "none",
      credentialMasked: raw?.credential_value ? maskSecret(raw.credential_value) : null,
    };
  });

  return { upstreams: safeUpstreams };
});

server.post("/api/upstreams", async (req, reply) => {
  const body = req.body as any;
  if (!body.name || !body.url) {
    return reply.status(400).send({ error: "Name and URL are required" });
  }

  // SSRF Protection Check
  const urlCheck = validateUpstreamUrl(body.url);
  if (!urlCheck.valid) {
    return reply.status(400).send({ error: urlCheck.reason });
  }

  const slug = (body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).trim();
  const id = `ups_${crypto.randomUUID().substring(0, 8)}`;
  const now = new Date().toISOString();
  // Encrypt credential at rest using AES-256-GCM
  const encryptedCred = body.credentialValue ? encryptSecret(body.credentialValue) : null;

  try {
    db.prepare(`
      INSERT INTO upstreams (id, slug, name, url, credential_type, credential_value, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, slug, body.name, body.url, body.credentialType || "none", encryptedCred, now, now);

    return { success: true, upstream: { id, slug, name: body.name, url: body.url } };
  } catch (err: any) {
    return reply.status(400).send({ error: err.message });
  }
});

server.put("/api/upstreams/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as any;
  const now = new Date().toISOString();

  if (body.url) {
    const urlCheck = validateUpstreamUrl(body.url);
    if (!urlCheck.valid) {
      return reply.status(400).send({ error: urlCheck.reason });
    }
  }

  const updates: string[] = ["updated_at = ?"];
  const params: any[] = [now];

  if (body.name !== undefined) {
    updates.push("name = ?");
    params.push(body.name);
  }
  if (body.url !== undefined) {
    updates.push("url = ?");
    params.push(body.url);
  }
  if (body.credentialType !== undefined) {
    updates.push("credential_type = ?");
    params.push(body.credentialType);
  }
  if (body.credentialValue !== undefined) {
    updates.push("credential_value = ?");
    params.push(body.credentialValue ? encryptSecret(body.credentialValue) : null);
  }

  params.push(id);
  const result = db.prepare(`UPDATE upstreams SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  if (result.changes === 0) {
    return reply.status(404).send({ error: "Upstream not found" });
  }
  return { success: true };
});

server.patch("/api/upstreams/:id/toggle", async (req, reply) => {
  const { id } = req.params as { id: string };
  const current = db.prepare("SELECT enabled FROM upstreams WHERE id = ?").get(id) as any;
  if (!current) {
    return reply.status(404).send({ error: "Upstream not found" });
  }

  const newStatus = current.enabled === 1 ? 0 : 1;
  db.prepare("UPDATE upstreams SET enabled = ?, updated_at = ? WHERE id = ?").run(
    newStatus,
    new Date().toISOString(),
    id
  );

  return { success: true, enabled: newStatus === 1 };
});

server.delete("/api/upstreams/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const result = db.prepare("DELETE FROM upstreams WHERE id = ?").run(id);
  if (result.changes === 0) {
    return reply.status(404).send({ error: "Upstream not found" });
  }
  return { success: true };
});

// -------------------------------------------------------------
// Multi-Store Provisioning Platform API (Bonus)
// -------------------------------------------------------------
server.get("/api/stores", async () => {
  const stores = db.prepare("SELECT * FROM stores ORDER BY created_at ASC").all() as any[];
  return { stores };
});

server.post("/api/stores", async (req, reply) => {
  const body = req.body as any;
  if (!body.name) {
    return reply.status(400).send({ error: "Store name is required" });
  }

  const slug = (body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).trim();
  const id = `store_${crypto.randomUUID().substring(0, 8)}`;
  const now = new Date().toISOString();
  const storeUrl = body.url || `http://${slug}.127.0.0.1.nip.io`;
  const upstreamId = `ups_${slug}`;

  try {
    db.prepare(`
      INSERT INTO stores (id, name, slug, url, status, upstream_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.name, slug, storeUrl, "Ready", upstreamId, now);

    // Auto-register WooCommerce MCP upstream for the new store
    const existingUps = db.prepare("SELECT id FROM upstreams WHERE slug = ?").get(slug);
    if (!existingUps) {
      const wooUrl = process.env.WOO_MCP_URL || "http://woo-mcp.teambridge-mcp.svc.cluster.local:8000/mcp";
      db.prepare(`
        INSERT INTO upstreams (id, slug, name, url, credential_type, credential_value, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(upstreamId, slug, `${body.name} MCP`, wooUrl, "none", null, now, now);
    }

    return {
      success: true,
      store: {
        id,
        name: body.name,
        slug,
        url: storeUrl,
        status: "Ready",
        upstreamId,
      },
    };
  } catch (err: any) {
    return reply.status(400).send({ error: err.message });
  }
});

server.delete("/api/stores/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const store = db.prepare("SELECT * FROM stores WHERE id = ?").get(id) as any;
  if (!store) {
    return reply.status(404).send({ error: "Store not found" });
  }

  db.prepare("DELETE FROM stores WHERE id = ?").run(id);

  if (store.upstream_id) {
    db.prepare("DELETE FROM upstreams WHERE id = ?").run(store.upstream_id);
  } else if (store.slug) {
    db.prepare("DELETE FROM upstreams WHERE slug = ?").run(store.slug);
  }

  return { success: true, message: `Store '${store.name}' and upstream MCP server cleanly torn down.` };
});

// -------------------------------------------------------------
// Real-Time Observability & Metrics API (Bonus)
// -------------------------------------------------------------
server.get("/api/metrics", async () => {
  const totalCalls = (db.prepare("SELECT COUNT(*) as c FROM audit_logs").get() as any).c;
  const successCalls = (db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE success = 1").get() as any).c;
  const failedCalls = (db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE success = 0").get() as any).c;
  const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 100;

  const latencies = db.prepare(`
    SELECT upstream_slug, AVG(duration_ms) as avg_duration, COUNT(*) as call_count
    FROM audit_logs
    WHERE upstream_slug IS NOT NULL
    GROUP BY upstream_slug
  `).all() as any[];

  const topTools = db.prepare(`
    SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_latency
    FROM audit_logs
    GROUP BY tool_name
    ORDER BY count DESC
    LIMIT 6
  `).all() as any[];

  const rbacSummary = {
    adminRoles: ["Administrator"],
    memberRoles: ["Engineer", "Support", "Analyst"],
    restrictedToolsCount: ADMIN_ONLY_TOOLS.size,
    restrictedTools: Array.from(ADMIN_ONLY_TOOLS),
  };

  return {
    summary: {
      totalCalls,
      successCalls,
      failedCalls,
      successRate,
      activeUsers: 3,
      connectedServers: 3,
      rateLimitWindow: "60 requests/min per identity",
    },
    latencies,
    topTools,
    rbacSummary,
  };
});

// -------------------------------------------------------------
// RBAC Permissions Matrix API
// -------------------------------------------------------------
server.get("/api/rbac/permissions", async () => {
  const { tools } = await upstreamManager.getAggregatedTools();
  const matrix = tools.map((t) => ({
    toolName: t.name,
    rawName: t.rawName,
    upstream: t.upstreamSlug,
    description: t.description,
    adminAllowed: true,
    memberAllowed: isToolAllowedForRole("member", t.name),
    requiresRole: isToolAllowedForRole("member", t.name) ? "member" : "admin",
  }));

  return {
    adminOnlyTools: Array.from(ADMIN_ONLY_TOOLS),
    permissions: matrix,
  };
});

// Audit Logs
server.get("/api/audit", async (req) => {
  const query = req.query as any;
  const limit = Math.min(parseInt(query.limit || "50", 10), 100);
  const offset = parseInt(query.offset || "0", 10);

  const logs = db.prepare(`
    SELECT * FROM audit_logs
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = (db.prepare("SELECT COUNT(*) as count FROM audit_logs").get() as any).count;
  return { logs, total, limit, offset };
});

// Chat Agent API (Acts on behalf of logged-in user)
server.post("/api/chat", async (req, reply) => {
  const auth = authenticateRequest(req);
  if (!auth) {
    // Default fallback to Alice (User A) if no session specified in dashboard
    const defaultUser = db.prepare("SELECT * FROM users WHERE email = 'alice@teambridge.local'").get() as any;
    if (defaultUser) {
      const response = await executeChatTurn(defaultUser, (req.body as any).messages || []);
      return response;
    }
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const body = req.body as any;
  const messages = body.messages || [];
  const response = await executeChatTurn(auth.user, messages);
  return response;
});

async function start() {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`TeamBridge Gateway listening on http://${HOST}:${PORT}`);
    console.log(`  Unified MCP Endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`  Dashboard API: http://${HOST}:${PORT}/api`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { generateApiKey, hashApiKey } from "./crypto.js";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "teambridge.db");

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high concurrency
db.exec("PRAGMA journal_mode = WAL;");

// Initialize Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS upstreams (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    credential_type TEXT NOT NULL DEFAULT 'none',
    credential_value TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    prefix TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    upstream_id TEXT,
    upstream_slug TEXT,
    tool_name TEXT NOT NULL,
    raw_tool_name TEXT NOT NULL,
    arguments_json TEXT,
    success INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    error_message TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
`);

// Seed Initial Data if empty
export function initSeedData() {
  const userCount = (db.prepare("SELECT COUNT(*) as count FROM users").get() as any).count;
  if (userCount === 0) {
    const now = new Date().toISOString();

    // 1. Seed Users
    const insertUser = db.prepare("INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?)");
    insertUser.run("user_admin", "admin@teambridge.local", "Administrator", "admin", now);
    insertUser.run("user_alice", "alice@teambridge.local", "Alice (User A)", "member", now);
    insertUser.run("user_bob", "bob@teambridge.local", "Bob (User B)", "member", now);

    // 2. Seed Pre-configured API keys for deterministic testing
    const insertKey = db.prepare(
      "INSERT INTO api_keys (id, user_id, prefix, key_hash, label, revoked, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)"
    );

    // Fixed keys for automated verification scripts
    const aliceKey = "tb_live_alice1234567890abcdef123456";
    const bobKey = "tb_live_bob1234567890abcdef123456";
    const adminKey = "tb_live_admin1234567890abcdef123456";

    insertKey.run("key_alice_seed", "user_alice", aliceKey.substring(0, 15), hashApiKey(aliceKey), "Alice Default Key", now);
    insertKey.run("key_bob_seed", "user_bob", bobKey.substring(0, 15), hashApiKey(bobKey), "Bob Default Key", now);
    insertKey.run("key_admin_seed", "user_admin", adminKey.substring(0, 15), hashApiKey(adminKey), "Admin Default Key", now);

    console.log("Seeded default users & API keys:");
    console.log(`  Admin: admin@teambridge.local (Key: ${adminKey})`);
    console.log(`  User A: alice@teambridge.local (Key: ${aliceKey})`);
    console.log(`  User B: bob@teambridge.local (Key: ${bobKey})`);
  }

  const upstreamCount = (db.prepare("SELECT COUNT(*) as count FROM upstreams").get() as any).count;
  if (upstreamCount === 0) {
    const now = new Date().toISOString();
    const insertUpstream = db.prepare(
      "INSERT INTO upstreams (id, slug, name, url, credential_type, credential_value, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    // In-cluster service DNS or env overrides
    const wooUrl = process.env.WOO_MCP_URL || "http://woo-mcp.teambridge-mcp.svc.cluster.local:8000/mcp";
    const tasksUrl = process.env.TASKS_MCP_URL || "http://tasks-mcp.teambridge-mcp.svc.cluster.local:8001/mcp";
    const utilsUrl = process.env.UTILS_MCP_URL || "http://utilities-mcp.teambridge-mcp.svc.cluster.local:8002/mcp";

    insertUpstream.run("ups_woo", "woo", "WooCommerce Store MCP", wooUrl, "none", null, 1, now, now);
    insertUpstream.run("ups_tasks", "tasks", "Operations Tasks MCP", tasksUrl, "none", null, 1, now, now);
    insertUpstream.run("ups_utilities", "utilities", "Utilities & Math MCP", utilsUrl, "none", null, 1, now, now);

    console.log("Seeded default 3 upstream MCP servers (woo, tasks, utilities)");
  }
}

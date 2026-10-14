import { db } from "./db.js";
import { decryptSecret } from "./crypto.js";

export interface UpstreamRecord {
  id: string;
  slug: string;
  name: string;
  url: string;
  credential_type: "none" | "bearer" | "header";
  credential_value: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AggregatedTool {
  name: string; // e.g. "woo__list_products" or alias "list_products"
  canonicalName: string; // "woo__list_products"
  rawName: string; // "list_products"
  upstreamId: string;
  upstreamSlug: string;
  upstreamName: string;
  description: string;
  inputSchema: any;
}

export interface UpstreamStatusInfo {
  id: string;
  slug: string;
  name: string;
  url: string;
  enabled: boolean;
  status: "Connected" | "Unreachable" | "Disabled";
  statusReason?: string;
  toolsCount: number;
  tools: string[];
  latencyMs?: number;
}

export class UpstreamManager {
  private timeoutMs: number;

  constructor(timeoutMs = 4000) {
    this.timeoutMs = timeoutMs;
  }

  getAllUpstreams(): UpstreamRecord[] {
    return (db.prepare("SELECT * FROM upstreams ORDER BY created_at ASC").all() as unknown) as UpstreamRecord[];
  }

  getUpstreamById(id: string): UpstreamRecord | null {
    return ((db.prepare("SELECT * FROM upstreams WHERE id = ?").get(id) as unknown) as UpstreamRecord) || null;
  }

  getUpstreamBySlug(slug: string): UpstreamRecord | null {
    return ((db.prepare("SELECT * FROM upstreams WHERE slug = ?").get(slug) as unknown) as UpstreamRecord) || null;
  }

  private getAuthHeaders(upstream: UpstreamRecord): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const secretValue = upstream.credential_value ? decryptSecret(upstream.credential_value) : null;

    if (upstream.credential_type === "bearer" && secretValue) {
      headers["Authorization"] = `Bearer ${secretValue}`;
    } else if (upstream.credential_type === "header" && secretValue) {
      try {
        const parsed = JSON.parse(secretValue);
        Object.assign(headers, parsed);
      } catch {
        headers["X-MCP-API-KEY"] = secretValue;
      }
    }
    return headers;
  }

  async sendJsonRpc(upstream: UpstreamRecord, payload: any, timeoutMs?: number): Promise<any> {
    const timeout = timeoutMs || this.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(upstream.url, {
        method: "POST",
        headers: this.getAuthHeaders(upstream),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`Upstream '${upstream.name}' timed out after ${timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async checkUpstream(upstream: UpstreamRecord): Promise<UpstreamStatusInfo> {
    if (!upstream.enabled) {
      return {
        id: upstream.id,
        slug: upstream.slug,
        name: upstream.name,
        url: upstream.url,
        enabled: false,
        status: "Disabled",
        toolsCount: 0,
        tools: [],
      };
    }

    const start = Date.now();
    try {
      const response = await this.sendJsonRpc(
        upstream,
        { jsonrpc: "2.0", id: "health-list", method: "tools/list", params: {} },
        3000
      );
      const latencyMs = Date.now() - start;
      const tools = response?.result?.tools || [];

      return {
        id: upstream.id,
        slug: upstream.slug,
        name: upstream.name,
        url: upstream.url,
        enabled: true,
        status: "Connected",
        toolsCount: tools.length,
        tools: tools.map((t: any) => t.name),
        latencyMs,
      };
    } catch (err: any) {
      return {
        id: upstream.id,
        slug: upstream.slug,
        name: upstream.name,
        url: upstream.url,
        enabled: true,
        status: "Unreachable",
        statusReason: err.message,
        toolsCount: 0,
        tools: [],
      };
    }
  }

  async getAggregatedTools(): Promise<{ tools: any[]; toolMap: Map<string, { upstream: UpstreamRecord; rawName: string }> }> {
    const upstreams = this.getAllUpstreams().filter((u) => u.enabled === 1);
    const aggregated: any[] = [];
    const toolMap = new Map<string, { upstream: UpstreamRecord; rawName: string }>();

    // Parallel tool discovery with isolated error boundaries
    const fetchPromises = upstreams.map(async (upstream) => {
      try {
        const response = await this.sendJsonRpc(
          upstream,
          { jsonrpc: "2.0", id: "list-tools", method: "tools/list", params: {} },
          3000
        );
        const tools = response?.result?.tools || [];
        return { upstream, tools, ok: true };
      } catch (err) {
        console.warn(`Could not list tools from upstream ${upstream.slug}:`, err);
        return { upstream, tools: [], ok: false };
      }
    });

    const results = await Promise.all(fetchPromises);

    // Track raw tool name frequency to determine if alias can be exposed
    const rawCounts = new Map<string, number>();
    for (const res of results) {
      for (const t of res.tools) {
        rawCounts.set(t.name, (rawCounts.get(t.name) || 0) + 1);
      }
    }

    for (const res of results) {
      for (const t of res.tools) {
        const canonicalName = `${res.upstream.slug}__${t.name}`;
        
        // Expose canonical tool (always unique)
        aggregated.push({
          name: canonicalName,
          description: `[${res.upstream.name}] ${t.description || ""}`,
          inputSchema: t.inputSchema,
        });
        toolMap.set(canonicalName, { upstream: res.upstream, rawName: t.name });

        // If raw name is completely unique across all servers, also register raw alias
        if (rawCounts.get(t.name) === 1) {
          aggregated.push({
            name: t.name,
            description: `[${res.upstream.name}] ${t.description || ""}`,
            inputSchema: t.inputSchema,
          });
          toolMap.set(t.name, { upstream: res.upstream, rawName: t.name });
        }
      }
    }

    return { tools: aggregated, toolMap };
  }

  async callTool(
    toolName: string,
    toolArgs: any
  ): Promise<{ result: any; upstream: UpstreamRecord; rawToolName: string }> {
    const { toolMap } = await this.getAggregatedTools();
    const entry = toolMap.get(toolName);

    if (!entry) {
      throw new Error(`Tool '${toolName}' not found or server is disabled/unreachable`);
    }

    const { upstream, rawName } = entry;
    const response = await this.sendJsonRpc(upstream, {
      jsonrpc: "2.0",
      id: `call-${Date.now()}`,
      method: "tools/call",
      params: {
        name: rawName,
        arguments: toolArgs || {},
      },
    });

    return {
      result: response?.result,
      upstream,
      rawToolName: rawName,
    };
  }
}

export const upstreamManager = new UpstreamManager();

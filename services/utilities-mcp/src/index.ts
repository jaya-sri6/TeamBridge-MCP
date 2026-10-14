import fastify from "fastify";

const PORT = parseInt(process.env.PORT || "8002", 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = fastify({ logger: true });

server.get("/healthz", async () => ({ status: "ok", service: "utilities-mcp" }));
server.get("/livez", async () => ({ status: "ok" }));

const TOOLS = [
  {
    name: "calculate_math",
    description: "Safely evaluate basic arithmetic expressions (addition, subtraction, multiplication, division, percentages).",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Mathematical expression, e.g., '19.99 * 3 * 0.9' for a 10% discount on 3 items." },
      },
      required: ["expression"],
    },
  },
  {
    name: "convert_currency",
    description: "Convert a monetary amount between major currencies (USD, EUR, GBP, JPY, CAD, INR).",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "The numeric amount to convert" },
        from: { type: "string", description: "Source currency code (USD, EUR, GBP, JPY, CAD, INR)" },
        to: { type: "string", description: "Target currency code" },
      },
      required: ["amount", "from", "to"],
    },
  },
  {
    name: "get_system_time",
    description: "Retrieve current server time, UTC timestamp, and day of week.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "Optional IANA timezone name (e.g. 'UTC', 'America/New_York', 'Asia/Kolkata')" },
      },
    },
  },
];

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.78,
  JPY: 155.0,
  CAD: 1.38,
  INR: 84.0,
};

async function handleToolCall(name: string, args: Record<string, any> = {}) {
  switch (name) {
    case "calculate_math": {
      const sanitized = String(args.expression || "").replace(/[^0-9+\-*/().% ]/g, "");
      if (!sanitized) {
        throw new Error("Invalid or empty mathematical expression");
      }
      try {
        // Safe evaluation of sanitized math expression
        const fn = new Function(`"use strict"; return (${sanitized.replace(/%/g, "/100")});`);
        const result = fn();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ expression: sanitized, result: Number(result.toFixed(4)) }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        throw new Error(`Failed to calculate expression: ${err.message}`);
      }
    }

    case "convert_currency": {
      const amount = Number(args.amount);
      const from = String(args.from || "USD").toUpperCase();
      const to = String(args.to || "USD").toUpperCase();

      const fromRate = EXCHANGE_RATES[from] || 1.0;
      const toRate = EXCHANGE_RATES[to] || 1.0;

      const inUSD = amount / fromRate;
      const converted = inUSD * toRate;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                original: `${amount} ${from}`,
                converted: `${Number(converted.toFixed(2))} ${to}`,
                rate: Number((toRate / fromRate).toFixed(4)),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "get_system_time": {
      const now = new Date();
      const timeZone = args.timezone || "UTC";
      let formatted: string;
      try {
        formatted = now.toLocaleString("en-US", { timeZone, dateStyle: "full", timeStyle: "long" });
      } catch {
        formatted = now.toUTCString();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                iso: now.toISOString(),
                utc: now.toUTCString(),
                timezone: timeZone,
                formatted,
                epoch_ms: now.getTime(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: '${name}'`);
  }
}

server.post("/mcp", async (req, reply) => {
  const body = req.body as any;
  if (!body || typeof body !== "object") {
    return reply.status(400).send({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }

  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== "2.0") {
    return reply.status(400).send({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: id || null });
  }

  if (method === "initialize") {
    return reply.send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "utilities-mcp", version: "1.0.0" },
      },
    });
  }

  if (method === "notifications/initialized") {
    return reply.status(204).send();
  }

  if (method === "tools/list") {
    return reply.send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  }

  if (method === "tools/call") {
    try {
      const result = await handleToolCall(params?.name, params?.arguments);
      return reply.send({ jsonrpc: "2.0", id, result });
    } catch (err: any) {
      return reply.send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error in ${params?.name}: ${err.message}` }],
          isError: true,
        },
      });
    }
  }

  if (method === "ping") {
    return reply.send({ jsonrpc: "2.0", id, result: {} });
  }

  return reply.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
});

server.get("/mcp", async () => ({
  status: "ok",
  server: "utilities-mcp",
  tools: TOOLS.map((t) => t.name),
}));

async function start() {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`Utilities MCP Server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();

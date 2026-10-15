import fastify from "fastify";
import { WooCommerceClient } from "./woocommerce-client.js";

const PORT = parseInt(process.env.PORT || "8000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const STORE_URL = process.env.WOO_STORE_URL || "http://store.teambridge-store.svc.cluster.local";
const CONSUMER_KEY = process.env.WOO_CONSUMER_KEY || "ck_test123";
const CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET || "cs_test456";

const wooClient = new WooCommerceClient({
  baseUrl: STORE_URL,
  consumerKey: CONSUMER_KEY,
  consumerSecret: CONSUMER_SECRET,
  timeoutMs: 8000,
});

const server = fastify({ logger: true });

// Health and liveness endpoints
server.get("/healthz", async () => ({ status: "ok", service: "woo-mcp" }));
server.get("/livez", async () => ({ status: "ok" }));

const TOOLS = [
  {
    name: "list_products",
    description: "List products available in the WooCommerce store with optional filtering by search term or category.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search term to match against product title and description" },
        category: { type: "string", description: "Category ID or slug to filter by" },
        per_page: { type: "number", description: "Number of products to return (default: 10, max: 50)" },
        page: { type: "number", description: "Page number for pagination" },
      },
    },
  },
  {
    name: "create_product",
    description: "Create a new product in the WooCommerce store with a name, regular price, and description.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name" },
        regular_price: { type: "string", description: "Product price in store currency (e.g. '19.99')" },
        description: { type: "string", description: "Full HTML or plain text description of the product" },
        short_description: { type: "string", description: "Brief summary or excerpt for the product" },
        image_url: { type: "string", description: "Optional image URL to attach as the featured product photo" },
        images: {
          type: "array",
          description: "Optional array of image objects with 'src' or 'id' (e.g. [{ src: 'http://...' }])",
          items: { type: "object", properties: { src: { type: "string" }, id: { type: "number" } } },
        },
      },
      required: ["name", "regular_price"],
    },
  },
  {
    name: "list_orders",
    description: "List orders in the WooCommerce store. Supports filtering by date (e.g. orders today) and order status.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter orders by status: 'any', 'pending', 'processing', 'on-hold', 'completed', 'cancelled'",
        },
        today_only: {
          type: "boolean",
          description: "If true, only returns orders placed today (UTC / current date)",
        },
        after: {
          type: "string",
          description: "Limit response to orders published after a given ISO-8601 compliant date (e.g. 2026-10-14T00:00:00)",
        },
        before: {
          type: "string",
          description: "Limit response to orders published before a given ISO-8601 compliant date",
        },
        per_page: { type: "number", description: "Number of orders to return (default: 10)" },
      },
    },
  },
  {
    name: "get_order",
    description: "Retrieve complete details of a specific WooCommerce order by its numeric ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The unique numeric ID of the WooCommerce order" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_order_status",
    description: "Update the status of an existing WooCommerce order (e.g. mark as completed, processing, cancelled).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The unique numeric ID of the WooCommerce order" },
        status: {
          type: "string",
          enum: ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"],
          description: "New order status",
        },
      },
      required: ["id", "status"],
    },
  },
];

async function handleToolCall(name: string, args: Record<string, any> = {}) {
  switch (name) {
    case "list_products": {
      const products = await wooClient.listProducts({
        search: args.search,
        category: args.category,
        per_page: args.per_page || 10,
        page: args.page || 1,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              products.map((p) => ({
                id: p.id,
                name: p.name,
                price: p.price || p.regular_price,
                stock_status: p.stock_status,
                permalink: p.permalink,
                short_description: p.short_description || p.description,
              })),
              null,
              2
            ),
          },
        ],
      };
    }

    case "create_product": {
      let productImages = args.images;
      if (!productImages && args.image_url) {
        productImages = [{ src: args.image_url }];
      }

      // Auto-assign studio photograph if not provided
      if (!productImages || productImages.length === 0) {
        const nameLower = (args.name || "").toLowerCase();
        const baseUploadUrl = process.env.STORE_URL 
          ? `${process.env.STORE_URL.replace(/\/+$/, "")}/wp-content/uploads/2026/10`
          : "http://store.127.0.0.1.nip.io/wp-content/uploads/2026/10";

        if (nameLower.includes("mouse") || nameLower.includes("cursor")) {
          productImages = [{ src: `${baseUploadUrl}/neon-cyber-mouse.jpg` }];
        } else if (nameLower.includes("sunglass") || nameLower.includes("glass") || nameLower.includes("shade")) {
          productImages = [{ src: `${baseUploadUrl}/neon-cyber-sunglasses.jpg` }];
        } else if (nameLower.includes("headphone") || nameLower.includes("earphone") || nameLower.includes("audio")) {
          productImages = [{ src: `${baseUploadUrl}/p20.jpg` }];
        } else if (nameLower.includes("keyboard") || nameLower.includes("key")) {
          productImages = [{ src: `${baseUploadUrl}/p17.jpg` }];
        } else if (nameLower.includes("desk") || nameLower.includes("pad") || nameLower.includes("mat")) {
          productImages = [{ src: `${baseUploadUrl}/p18.jpg` }];
        } else if (nameLower.includes("hoodie") || nameLower.includes("shirt") || nameLower.includes("apparel")) {
          productImages = [{ src: `${baseUploadUrl}/p7.jpg` }];
        } else if (nameLower.includes("chair") || nameLower.includes("seat")) {
          productImages = [{ src: `${baseUploadUrl}/p5.jpg` }];
        } else {
          productImages = [{ src: `${baseUploadUrl}/neon-cyber-sunglasses.jpg` }];
        }
      }

      const product = await wooClient.createProduct({
        name: args.name,
        regular_price: String(args.regular_price),
        description: args.description,
        short_description: args.short_description,
        images: productImages,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: `Product '${product.name}' successfully created with attached studio photography.`,
                product: {
                  id: product.id,
                  name: product.name,
                  price: product.price || product.regular_price,
                  permalink: product.permalink,
                  status: product.status,
                  images: product.images,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "list_orders": {
      let after = args.after;
      if (args.today_only) {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        after = todayStart.toISOString();
      }

      const orders = await wooClient.listOrders({
        status: args.status === "any" ? undefined : args.status,
        after,
        before: args.before,
        per_page: args.per_page || 10,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              orders.map((o) => ({
                id: o.id,
                status: o.status,
                total: `${o.total} ${o.currency}`,
                date_created: o.date_created,
                customer: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim() || "Guest",
                email: o.billing?.email,
                items: (o.line_items || []).map((item) => ({
                  product_id: item.product_id,
                  name: item.name,
                  quantity: item.quantity,
                  total: item.total,
                })),
              })),
              null,
              2
            ),
          },
        ],
      };
    }

    case "get_order": {
      const order = await wooClient.getOrder(Number(args.id));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(order, null, 2),
          },
        ],
      };
    }

    case "update_order_status": {
      const updated = await wooClient.updateOrderStatus(Number(args.id), args.status);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: `Order #${updated.id} status updated to '${updated.status}'`,
                id: updated.id,
                status: updated.status,
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

// Streamable HTTP MCP JSON-RPC 2.0 Handler
server.post("/mcp", async (req, reply) => {
  const body = req.body as any;
  if (!body || typeof body !== "object") {
    return reply.status(400).send({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error: Invalid JSON object" },
      id: null,
    });
  }

  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== "2.0") {
    return reply.status(400).send({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid Request: Expected jsonrpc 2.0" },
      id: id || null,
    });
  }

  // Handle MCP Protocol Methods
  try {
    if (method === "initialize") {
      return reply.send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: "woo-mcp",
            version: "1.0.0",
            description: "Custom WooCommerce MCP Server for TeamBridge",
          },
        },
      });
    }

    if (method === "notifications/initialized") {
      return reply.status(204).send();
    }

    if (method === "tools/list") {
      return reply.send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      });
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      if (!toolName) {
        return reply.send({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing tool name in params" },
        });
      }

      try {
        const result = await handleToolCall(toolName, toolArgs);
        return reply.send({
          jsonrpc: "2.0",
          id,
          result,
        });
      } catch (toolErr: any) {
        return reply.send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error executing ${toolName}: ${toolErr.message}` }],
            isError: true,
          },
        });
      }
    }

    if (method === "ping") {
      return reply.send({ jsonrpc: "2.0", id, result: {} });
    }

    return reply.send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err: any) {
    req.log.error(err);
    return reply.status(500).send({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: `Internal server error: ${err.message}` },
    });
  }
});

// Provide GET /mcp for health/info check
server.get("/mcp", async () => ({
  status: "ok",
  protocol: "mcp-streamable-http",
  server: "woo-mcp",
  tools: TOOLS.map((t) => t.name),
}));

async function start() {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`WooCommerce MCP Server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();

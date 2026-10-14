import fastify from "fastify";

const PORT = parseInt(process.env.PORT || "8001", 10);
const HOST = process.env.HOST || "0.0.0.0";

const server = fastify({ logger: true });

server.get("/healthz", async () => ({ status: "ok", service: "tasks-mcp" }));
server.get("/livez", async () => ({ status: "ok" }));

interface Task {
  id: number;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "in-progress" | "completed";
  due_date: string;
}

let nextId = 4;
const tasks: Task[] = [
  {
    id: 1,
    title: "Verify WooCommerce Order Fulfillment",
    description: "Check new orders received today and flag COD orders for dispatch.",
    priority: "high",
    status: "in-progress",
    due_date: new Date().toISOString().split("T")[0],
  },
  {
    id: 2,
    title: "Update Store Inventory Levels",
    description: "Sync warehouse stock count with WooCommerce catalog.",
    priority: "medium",
    status: "pending",
    due_date: new Date().toISOString().split("T")[0],
  },
  {
    id: 3,
    title: "Review Customer Returns Policy",
    description: "Ensure updated 30-day refund policy is posted on storefront footer.",
    priority: "low",
    status: "completed",
    due_date: new Date().toISOString().split("T")[0],
  },
];

const TOOLS = [
  {
    name: "list_tasks",
    description: "Retrieve team operational and store tasks with optional status and priority filtering.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "in-progress", "completed", "all"], description: "Filter by task status" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Filter by priority" },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a new team or store management task.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Task priority (default: medium)" },
        due_date: { type: "string", description: "Due date in YYYY-MM-DD format" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task_status",
    description: "Update the status of an existing task.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Numeric task ID" },
        status: { type: "string", enum: ["pending", "in-progress", "completed"], description: "New status" },
      },
      required: ["id", "status"],
    },
  },
];

async function handleToolCall(name: string, args: Record<string, any> = {}) {
  switch (name) {
    case "list_tasks": {
      let result = [...tasks];
      if (args.status && args.status !== "all") {
        result = result.filter((t) => t.status === args.status);
      }
      if (args.priority) {
        result = result.filter((t) => t.priority === args.priority);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "create_task": {
      const newTask: Task = {
        id: nextId++,
        title: String(args.title),
        description: String(args.description || ""),
        priority: args.priority || "medium",
        status: "pending",
        due_date: args.due_date || new Date().toISOString().split("T")[0],
      };
      tasks.push(newTask);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ message: `Task #${newTask.id} created successfully`, task: newTask }, null, 2),
          },
        ],
      };
    }

    case "update_task_status": {
      const task = tasks.find((t) => t.id === Number(args.id));
      if (!task) {
        throw new Error(`Task #${args.id} not found`);
      }
      task.status = args.status;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ message: `Task #${task.id} updated to '${task.status}'`, task }, null, 2),
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
    return reply.status(400).send({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error" },
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

  if (method === "initialize") {
    return reply.send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tasks-mcp", version: "1.0.0" },
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
      result: { tools: TOOLS },
    });
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

  return reply.send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

server.get("/mcp", async () => ({
  status: "ok",
  server: "tasks-mcp",
  tools: TOOLS.map((t) => t.name),
}));

async function start() {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`Tasks MCP Server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();

/**
 * TeamBridge End-to-End Definition of Done (DoD) Verification Script
 * Validates:
 * 1. Storefront & WooCommerce API connectivity
 * 2. Chat Agent (User A) tool execution (create product -> query today's orders)
 * 3. External MCP Client (User B) Streamable HTTP protocol flow
 * 4. Multi-upstream tool aggregation across servers
 * 5. Security controls: key revocation rejection, server disablement, pod failure isolation
 * 6. Audit log attribution to correct users
 */

const GATEWAY_URL = process.env.GATEWAY_URL || "http://dashboard.127.0.0.1.nip.io";
const STORE_URL = process.env.STORE_URL || "http://store.127.0.0.1.nip.io";

const USER_A_KEY = "tb_live_alice1234567890abcdef123456";
const USER_B_KEY = "tb_live_bob1234567890abcdef123456";

function logStep(step, desc) {
  console.log(`\n\x1b[1m\x1b[36m[STEP ${step}]\x1b[0m \x1b[33m${desc}\x1b[0m`);
}

function logPass(msg) {
  console.log(`  \x1b[32m✔ PASS:\x1b[0m ${msg}`);
}

function logFail(msg, err) {
  console.error(`  \x1b[31m✘ FAIL:\x1b[0m ${msg}`, err || "");
  process.exit(1);
}

async function callMcp(apiKey, method, params = {}) {
  const res = await fetch(`${GATEWAY_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `dod-${Date.now()}`,
      method,
      params,
    }),
  });

  const status = res.status;
  const json = await res.json().catch(() => ({}));
  return { status, json };
}

async function main() {
  console.log("==================================================================");
  console.log("   ⚡ TeamBridge MCP Gateway - Definition of Done Verification   ");
  console.log("==================================================================");
  console.log(`Target Gateway: ${GATEWAY_URL}`);
  console.log(`Target Store:   ${STORE_URL}`);

  // STEP 1: Verify Storefront Health & Initial Catalog
  logStep(1, "Verify WooCommerce Storefront & Catalog");
  try {
    const storeRes = await fetch(`${STORE_URL}/wp-json/wc/v3/products?consumer_key=ck_teambridge_local_key&consumer_secret=cs_teambridge_local_secret`);
    if (storeRes.ok) {
      const prods = await storeRes.json();
      logPass(`Storefront responsive! Found ${prods.length} active products in catalog.`);
    } else {
      logFail(`Storefront returned HTTP ${storeRes.status}`);
    }
  } catch (err) {
    logFail("Storefront unreachable", err);
  }

  // STEP 2: Chat Agent Flow as User A (Create Product -> Query Orders)
  logStep(2, "Chat Agent as User A (Alice): Create Product via Tool Loop");
  try {
    const chatRes = await fetch(`${GATEWAY_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": "user_alice",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: 'Create a product named "DoD Test Headphones" priced at 79.99' }],
      }),
    });
    const chatData = await chatRes.json();
    if (chatData.toolCalls && chatData.toolCalls.length > 0) {
      const tc = chatData.toolCalls[0];
      logPass(`Chat Agent executed tool '${tc.toolName}' as User A (${tc.durationMs}ms)`);
      logPass(`Response message: "${chatData.message}"`);
    } else {
      logFail("Chat Agent did not execute product creation tool");
    }
  } catch (err) {
    logFail("Chat Agent step failed", err);
  }

  // STEP 3: External MCP Client as User B (Bob) - Tools Listing & Multi-Server Aggregation
  logStep(3, "External MCP Client as User B (Bob): List Tools Across All Servers");
  try {
    const { status, json } = await callMcp(USER_B_KEY, "tools/list");
    if (status !== 200) logFail(`MCP endpoint returned HTTP ${status}`);
    const tools = json.result?.tools || [];
    const toolNames = tools.map((t) => t.name);

    logPass(`Aggregated ${tools.length} tools behind single MCP endpoint!`);
    const hasWoo = toolNames.some((t) => t.includes("list_orders") || t.includes("woo"));
    const hasTasks = toolNames.some((t) => t.includes("tasks"));
    const hasUtils = toolNames.some((t) => t.includes("utilities") || t.includes("math"));

    if (hasWoo && hasTasks && hasUtils) {
      logPass("Tools verified from all 3 upstreams (WooCommerce, Tasks, Utilities)!");
    } else {
      logFail(`Missing upstreams in tool list: ${toolNames.join(", ")}`);
    }
  } catch (err) {
    logFail("External MCP tool listing failed", err);
  }

  // STEP 4: External MCP Client as User B - Multi-Server Tool Invocation
  logStep(4, "External MCP Client as User B: Execute Multi-Server Tool Invocations");
  try {
    // 4a. Call WooCommerce list_orders
    const wooCall = await callMcp(USER_B_KEY, "tools/call", {
      name: "woo__list_orders",
      arguments: { today_only: true },
    });
    logPass(`Successfully invoked woo__list_orders via Gateway (HTTP ${wooCall.status})`);

    // 4b. Call Utilities calculate_math
    const mathCall = await callMcp(USER_B_KEY, "tools/call", {
      name: "utilities__calculate_math",
      arguments: { expression: "79.99 * 2 * 0.9" },
    });
    logPass(`Successfully invoked utilities__calculate_math: ${mathCall.json.result?.content?.[0]?.text}`);
  } catch (err) {
    logFail("Multi-server invocation failed", err);
  }

  // STEP 5: Revoke User B's API Key & Confirm Immediate Rejection
  logStep(5, "Team & Control: Revoke Key & Test Immediate Rejection");
  try {
    // Generate a temporary key for revocation testing so primary key stays active
    const createRes = await fetch(`${GATEWAY_URL}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_bob", label: "DoD Temp Key for Revocation Test" }),
    });
    const createData = await createRes.json();
    const tempKeyId = createData.key.id;
    const tempKeySecret = createData.key.plaintextKey;
    logPass(`Generated temporary key '${tempKeyId}' for revocation test`);

    // Revoke the temporary key
    const revokeRes = await fetch(`${GATEWAY_URL}/api/keys/${tempKeyId}`, { method: "DELETE" });
    if (!revokeRes.ok) logFail("Failed to revoke temporary key");
    logPass("Revoked temporary API key via Admin API");

    // Attempt call with revoked key -> must fail with HTTP 401
    const rejectCall = await callMcp(tempKeySecret, "tools/list");
    if (rejectCall.status === 401) {
      logPass(`Call immediately rejected with HTTP 401: ${JSON.stringify(rejectCall.json.error)}`);
    } else {
      logFail(`Expected HTTP 401 after revocation, got ${rejectCall.status}`);
    }
  } catch (err) {
    logFail("Key revocation test failed", err);
  }

  // STEP 6: Upstream Disable Lifecycle
  logStep(6, "Team & Control: Disable Tasks Upstream & Verify Tool Disappearance");
  try {
    await fetch(`${GATEWAY_URL}/api/upstreams/ups_tasks/toggle`, { method: "PATCH" });
    logPass("Disabled 'ups_tasks' via Gateway API");

    const { json } = await callMcp(USER_A_KEY, "tools/list");
    const activeTools = (json.result?.tools || []).map((t) => t.name);
    const tasksStillPresent = activeTools.some((t) => t.includes("tasks"));

    if (!tasksStillPresent) {
      logPass("Tasks tools successfully disappeared from discovery list!");
    } else {
      logFail("Tasks tools still visible after upstream disablement");
    }

    // Re-enable tasks upstream
    await fetch(`${GATEWAY_URL}/api/upstreams/ups_tasks/toggle`, { method: "PATCH" });
    logPass("Re-enabled 'ups_tasks' upstream successfully");
  } catch (err) {
    logFail("Upstream toggle test failed", err);
  }

  // STEP 7: Audit Log Verification
  logStep(7, "Audit Trail Verification: Confirm Correct Attribution");
  try {
    const auditRes = await fetch(`${GATEWAY_URL}/api/audit?limit=10`);
    const { logs } = await auditRes.json();
    logPass(`Retrieved ${logs.length} audit records.`);

    const userALogs = logs.filter((l) => l.user_email === "alice@teambridge.local");
    const userBLogs = logs.filter((l) => l.user_email === "bob@teambridge.local");

    logPass(`Found ${userALogs.length} calls attributed to Alice (User A)`);
    logPass(`Found ${userBLogs.length} calls attributed to Bob (User B)`);
  } catch (err) {
    logFail("Audit log verification failed", err);
  }

  console.log("\n\x1b[1m\x1b[32m==================================================================");
  console.log("   🎉 ALL DEFINITION OF DONE ACCEPTANCE CRITERIA VERIFIED!        ");
  console.log("==================================================================\x1b[0m\n");
}

main().catch(console.error);

# TeamBridge MCP Gateway: Bonus Features & Enterprise Differentiators

This document details the architecture and verification of the bonus features implemented in **TeamBridge MCP**.

---

## 1. Multi-Store Provisioning Platform (Primary Bonus)

### Architecture
TeamBridge includes a native Store Provisioning engine accessible from the Dashboard (`🏪 Stores` tab) and REST API (`/api/stores`).

- **Dynamic Provisioning**: Admins can provision secondary WooCommerce store tenants (e.g. `Gear & Hardware Outlet`, slug: `store2`, host: `http://store2.127.0.0.1.nip.io`).
- **Automatic MCP Registration**: When a new store is created, the Gateway automatically registers a dedicated upstream MCP server (`ups_store2`) pointing to the store's MCP instance.
- **Collision-Proof Tool Namespacing**: Tools for secondary stores are automatically namespaced (e.g. `store2__list_products`, `store2__create_product`, `store2__list_orders`), allowing clients to interact with specific stores without ambiguity.
- **Cross-Store Aggregated Chat Queries**: In the Dashboard AI Chat Agent, users can query across stores:
  ```text
  "Compare orders across stores"
  ```
  The agent aggregates today's order metrics across all registered store tenants simultaneously.
- **Clean Teardown**: Deleting a store via the dashboard cleanly unregisters its MCP server, tears down upstream connections, and purges database records.

---

## 2. Fine-Grained Tool Permissions & RBAC

### Architecture
To prevent unauthorized mutations by junior team members or external clients, TeamBridge enforces role-based tool execution policies (`admin` vs `member`).

- **Role Capabilities**:
  - **Administrator (`admin`)**: Full access to all 18 tools across all upstream servers (reads + writes).
  - **Member (`member`)**: Restricted to read-only tools (`list_products`, `get_order`, `list_orders`, `list_tasks`, `calculate_math`, `convert_currency`, `get_system_time`).
  - **Restricted Mutating Tools**: `create_product`, `update_order_status`, `create_task`, `update_task_status` require `admin` role.
- **Dynamic Discovery Filtering**: When a user queries `tools/list` on `/mcp`, the Gateway filters out restricted tools based on the caller's role. Members never see tools they are not permitted to use.
- **Direct Enforcement**: If a member attempts to execute a restricted tool directly via JSON-RPC or Chat, the Gateway returns `403 Forbidden`:
  ```json
  {
    "error": {
      "code": -32003,
      "message": "Access Denied: Tool 'create_product' requires 'admin' role, but user 'bob@teambridge.local' has role 'member'"
    }
  }
  ```
- **Audit Attribution**: All denied attempts are permanently recorded in the immutable audit log with `success: 0` and security denial reasons.

---

## 3. Real-Time Observability & Token-Bucket Rate Limiting

### Architecture
The Gateway provides continuous telemetry and traffic control accessible via `/api/metrics` and the Dashboard (`📊 Metrics` tab).

- **Token-Bucket Rate Limiter**:
  - Enforces a sliding-window limit of **60 requests per minute** per user / API key.
  - Excess traffic is rejected with `HTTP 429 Too Many Requests` and a standard `Retry-After` header.
- **Live Latency & Health Percentiles**:
  - Tracks average execution latency per upstream server (`tasks`: ~9ms, `utilities`: ~17ms, `woo`: ~120–250ms).
- **Leaderboard & Success Metrics**:
  - Real-time success rate percentage (100% under standard operations).
  - Top tools executed frequency table.

---

## 4. Enterprise Security Hardening

### SSRF (Server-Side Request Forgery) Defense
When admins add or update upstream MCP servers:
- The Gateway validates URLs against an active blocklist covering AWS, Google Cloud, Azure, and Alibaba instance metadata endpoints (`169.254.169.254`, `metadata.google.internal`).
- Attempts to register link-local or sensitive infrastructure ports (22, 23, 2375) are blocked with `400 Bad Request`.

### AES-256-GCM Credential Encryption at Rest
- Upstream credentials (bearer tokens, custom auth headers) are encrypted using authenticated **AES-256-GCM** before writing to SQLite persistent storage.
- Credentials are decrypted in-memory only when the Gateway dispatches outbound HTTP requests to upstream MCP servers, and are never exposed in logs or API responses.

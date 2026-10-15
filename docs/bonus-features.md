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

---

## 5. Ultra-Premium Cloud SaaS Dashboard (Linear / Vercel Aesthetic)

### Architecture & UI/UX Design System
The React dashboard (`apps/dashboard`) is built with state-of-the-art modern cloud SaaS design patterns inspired by Linear, Vercel, and Raycast:

- **Enterprise 2-Tier Sticky Navigation**:
  - **Tier 1 (Top Bar)**: Anchors brand identity, Kubernetes runtime badge, direct storefront launcher (`🛍️ Open Storefront ↗`), and the active user identity switcher (`Administrator (ADMIN)` + role badge).
  - **Tier 2 (Sub-Navigation Bar)**: Houses all 7 platform tabs (`🔌 MCP Servers`, `🤖 AI Chat Agent`, `🔑 Team & API Keys`, `📜 Audit Log`, `🏪 Stores`, `📊 Metrics`, `🛡️ RBAC & Security`) with glassmorphic containers and glowing active indicators.
  - **Zero Horizontal Overflow**: Guaranteed fit across desktop, laptop, and tablet viewports without screen clipping or horizontal scrollbars (`overflow-x: hidden; max-width: 100vw;`).
- **Balanced 2x2 Upstream Grid**:
  - Replaced single-column stacking with a balanced 2-column side-by-side grid (`repeat(2, 1fr)`), presenting upstream servers symmetrically with equal card heights.
- **Pulsing Radar Status Dots**:
  - Connected upstream servers feature animated green radar dots (`@keyframes pulse-dot`) with emerald drop-glows (`#10b981`).
- **One-Click Unified Endpoint Copy Box**:
  - The hero section includes an interactive endpoint copy chip (`http://dashboard.127.0.0.1.nip.io/mcp`) with instant clipboard feedback (`✓ Copied`).
- **Neon Latency Badges**:
  - Upstream latency metrics are rendered in cyan neon micro-badges (`⚡ 2ms latency`).

---

## 6. Authentic Storefront Media & Product Catalog

### High-Resolution Commercial Product Photography
Instead of default WooCommerce grey placeholder icons, the store features studio-grade commercial product photography across the entire catalog:

- **Featured Products**:
  1. **Neon Cyber Headphones** ($49.99): Futuristic cyberpunk over-ear headphones with cyan and violet neon LED strips.
  2. **Laser Engraved Desk Pad** ($34.50): Luxury dark leather desk mat with laser-engraved geometric circuitry patterns.
  3. **Admin Special Keyboard** ($149.00): Custom anodized aluminum mechanical keyboard with coiled aviator cable and RGB underglow.
  4. **Neon Cyber Wireless Headphones** ($79.99): Sleek wireless earbuds with translucent glowing cyber charging case.
  5. **TeamBridge Engineering Hoodie** ($45.00): Luxury heavyweight black developer streetwear hoodie with embroidered tech insignia.
  6. **Ergonomic Developer Chair** ($299.00): High-end mesh developer chair with chrome base and adjustable lumbar support.
- **Automated Responsive Thumbnails**:
  - All images are imported directly into the WordPress media library via WP-CLI (`wp media import --post_id=<id> --featured_image`).
  - WooCommerce automatically generates responsive thumbnail srcsets (`150x150`, `300x300`, `600x600`, `768x768`, `1024w`) for fast, responsive rendering on all devices.

---

## 7. Native OAuth 2.0 Authorization Server on Gateway

### Standards Compliance & Architecture
To support modern external AI clients and enterprise single-sign-on integrations, the Gateway implements native **RFC 6749 and RFC 8414 compliant OAuth 2.0 authorization server endpoints**:

- **Metadata Discovery (RFC 8414 / OIDC)**:
  - `GET /.well-known/oauth-authorization-server`
  - `GET /.well-known/openid-configuration`
  - Publishes supported response types (`code`, `token`), grant types (`authorization_code`, `client_credentials`), and scopes (`mcp:tools`, `openid`, `profile`).
- **Authorization Code Grant (`/oauth/authorize`)**:
  - Handles client authorization requests with `client_id`, `redirect_uri`, `state`, and `user_id`.
  - Generates secure time-limited authorization codes (`tb_code_...`) and redirects or displays an interactive consent card in the dashboard theme.
- **Token Exchange (`/oauth/token`)**:
  - Validates authorization codes or client credentials and issues RFC 6750 standard Bearer access tokens with role metadata.
- **Userinfo Endpoint (`/oauth/userinfo`)**:
  - Provides authenticated caller profile introspection (`sub`, `name`, `email`, `role`).
- **Cryptographic Token Verification**:
  - Access tokens presented to `/mcp` are cryptographically verified against SQLite using salted HMAC SHA-256 hashes with sub-millisecond lookups and instant revocation checks.

# System Design and Tradeoffs Note

## 1. System Architecture Overview

TeamBridge implements a four-tier architecture running entirely within Kubernetes:

```text
                               +-------------------------------------------------+
                               |                   CLIENT TIER                   |
                               |  - React Dashboard (Admin / User A - Alice)     |
                               |  - External MCP Clients (Cursor / User B - Bob) |
                               +------------------------+------------------------+
                                                        |
                                                        | HTTP Request (nip.io)
                                                        v
                               +-------------------------------------------------+
                               |             INGRESS & ROUTING TIER              |
                               |  - NGINX Ingress Controller                     |
                               |  - dashboard.127.0.0.1.nip.io                   |
                               |  - store.127.0.0.1.nip.io                       |
                               |  - store2.127.0.0.1.nip.io                      |
                               +------------------------+------------------------+
                                                        |
                                                        | Proxy to Pod
                                                        v
+--------------------------------------------------------------------------------------------------+
| TIER 1: UNIFIED GATEWAY & CONTROL PLANE (teambridge-gateway)                                     |
| • Unified MCP Endpoint : http://dashboard.127.0.0.1.nip.io/mcp                                   |
| • Transport Protocol   : Streamable HTTP (JSON-RPC 2.0)                                          |
| • Runtime Core         : Fastify on Node.js 22                                                   |
| • Identity & RBAC      : Role-Based Tool Enforcement (Admin: Read/Write, Member: Read-Only)      |
| • Key & OAuth Security : HMAC SHA-256 Hashed API Keys + RFC 6749/8414 OAuth 2.0 Server            |
| • Defenses             : Active SSRF Blocking (169.254.169.254) + Token-Bucket Rate Limiter      |
| • Local Database       : SQLite WAL on PersistentVolumeClaim (/app/data/teambridge.db)           |
+------------------------------------------------+-------------------------------------------------+
                                                 |
                                                 | Internal ClusterIP DNS
                         +-----------------------+-----------------------+
                         |                       |                       |
                         v                       v                       v
+---------------------------------+ +-------------------------+ +----------------------------------+
| TIER 2: WOOCOMMERCE MCP         | | TIER 2: OPERATIONS MCP  | | TIER 2: UTILITIES MCP            |
| • Service : woo-mcp:8000        | | • Service : tasks-mcp   | | • Service : utilities-mcp:8002   |
| • Tool Namespace: woo__...      | | • Tool Namespace:       | | • Tool Namespace: utilities__... |
|   - woo__list_products          | |     tasks__...          | |   - utilities__calculate_math    |
|   - woo__create_product (admin) | |   - tasks__list_tasks   | |   - utilities__convert_currency  |
|   - woo__list_orders            | |   - tasks__create_task  | |   - utilities__get_system_time   |
| • Multi-Tenant: store2__...     | |                         | |                                  |
+----------------+----------------+ +-------------------------+ +----------------------------------+
                 |
                 | REST API v3 / Basic Auth
                 v
+--------------------------------------------------------------------------------------------------+
| TIER 3: STOREFRONT & PERSISTENCE LAYER                                                           |
| • Flagship Storefront  : http://store.127.0.0.1.nip.io (WordPress 6.7 + WooCommerce 9.3)         |
| • Secondary Storefront : http://store2.127.0.0.1.nip.io (Gear & Hardware Store Tenant)           |
| • Backend Database     : MariaDB 10.11 StatefulSet on Kubernetes PVC                             |
| • Media & Assets       : PersistentVolumeClaim (/var/www/html/wp-content) with Studio Photos     |
| • Test Payment Gateway : Pre-configured Cash on Delivery (COD) for zero-credential orders        |
+--------------------------------------------------------------------------------------------------+
```

### Detailed Breakdown by Tier

#### 1. Ingress & Routing Tier
* **DNS Strategy:** Uses zero-config wildcard DNS (`*.127.0.0.1.nip.io`) — no manual `/etc/hosts` or Windows hosts editing required.
* **Ingress Controller:** NGINX Ingress routing external HTTP traffic directly into cluster pods.
* **Public Hosts:**
  - `http://dashboard.127.0.0.1.nip.io` (Admin UI & Gateway)
  - `http://store.127.0.0.1.nip.io` (Flagship Store)
  - `http://store2.127.0.0.1.nip.io` (Secondary Multi-Tenant Store)

#### 2. Unified Gateway Tier (`gateway`)
* **Core Runtime:** Fastify on Node.js 22 with Streamable HTTP MCP support.
* **Unified Endpoint:** `http://dashboard.127.0.0.1.nip.io/mcp`
* **Core Responsibilities:**
  - **Tool Aggregation:** Discovers tools from all upstream servers and applies collision-proof prefixes (`woo__`, `tasks__`, `utilities__`, `store2__`).
  - **Fine-Grained RBAC:** Filters tool listing and blocks unauthorized mutations with `HTTP 403 Forbidden`.
  - **Token-Bucket Rate Limiter:** Enforces 60 requests/minute per identity.
  - **Data Persistence:** SQLite with WAL mode on Kubernetes PVC storing users, HMAC-hashed API keys, and immutable audit logs.

#### 3. Upstream Microservices Tier
Three isolated upstream servers run as independent Kubernetes pods:
* **WooCommerce MCP (`woo-mcp:8000`):** Custom TypeScript server translating MCP tool calls into WooCommerce REST API v3 queries (`list_products`, `create_product`, `list_orders`).
* **Tasks MCP (`tasks-mcp:8001`):** Operations backlog management server (`list_tasks`, `create_task`).
* **Utilities MCP (`utilities-mcp:8002`):** Math evaluation engine, live currency conversion, and cluster system time.
* **Multi-Tenant Stores (`store2`):** Dynamically provisioned store tenants registering dedicated namespaces (`store2__list_products`).

#### 4. Storefront & Persistence Tier
* **Store Engine:** WordPress 6.7 and WooCommerce 9.3 running in Apache/PHP container.
* **Database:** Dedicated **MariaDB 10.11 StatefulSet** backed by Kubernetes PersistentVolumeClaims (`wp-content` and database storage).
* **Payment & Auth:** Automated Cash on Delivery (COD) test gateway with pre-seeded REST credentials.

---

### 🎙️ 10-Second Architecture Opening Script (For Demo Video)

> **"TeamBridge is a 4-tier Kubernetes architecture: Ingress routes external clients to our Gateway, which enforces RBAC and aggregates WooCommerce, Tasks, and Utilities microservices over MariaDB."**

---

## 2. Core Architectural Decisions & Tradeoffs

### 2.1 Upstream Aggregation & Routing
* **Decision**: Dynamically discover and aggregate tools from all registered and enabled upstream MCP servers into a single `/mcp` Streamable HTTP endpoint.
* **Tradeoff**: Querying upstream tool lists on every client request could introduce latency. 
* **Design Solution**:
  - The Gateway queries upstreams in parallel with bounded timeouts (3,000ms).
  - An in-memory cache with periodic/on-demand refresh serves instantaneous tool listings to clients.

### 2.2 Tool Name Collision Resolution
* **Decision**: Namespace every tool canonically with its upstream slug: `${upstream.slug}__${tool.name}` (e.g. `woo__list_orders`, `tasks__create_task`).
* **Conflict Handling**:
  - If a tool name is completely unique across all enabled upstreams (e.g., `calculate_math`), the Gateway also registers the un-prefixed alias (`calculate_math`) for ergonomic developer usage and LLM efficiency.
  - If multiple upstreams register the same tool name (e.g., both offer `search`), only the namespaced canonical forms (`woo__search` and `tasks__search`) are exposed. Routing is strictly deterministic and collision-free.

### 2.3 Upstream Failure Isolation & Resilience
* **Decision**: Zero upstream coupling. A slow, failing, or dead upstream must never degrade discovery or execution of healthy upstreams.
* **Design Solution**:
  - Tool listing uses `Promise.allSettled` / isolated timeouts. If one server is dead, its tools are cleanly excluded, while remaining servers function normally.
  - The Dashboard marks the dead server as `Unreachable` with the root-cause error message.
  - Calls to a failed upstream return standard MCP JSON-RPC responses with `isError: true` and an explicit error explanation instead of hanging the client connection.

### 2.4 Communication Protocol with WooCommerce
* **Decision**: Use the official WooCommerce REST API v3 over HTTP within the cluster.
* **Why REST API over WP-CLI**:
  1. *Sub-process vs HTTP*: WP-CLI spawns a full PHP process for every single command, incurring substantial CPU/memory overhead and process-spawning latency (300-800ms per invocation). The REST API is persistent, non-blocking, and handles concurrent requests gracefully.
  2. *Standardization*: The WooCommerce REST API is the battle-tested industry standard for automated integrations, returning structured JSON with RFC 7807 problem details.
  3. *Zero-Privilege*: WP-CLI requires filesystem access and administrative OS execution permissions. REST API uses granular API key credentials.

### 2.5 Single-Container Gateway + Dashboard Serving
* **Decision**: Serve the compiled React Single Page Application (SPA) directly from the Gateway Fastify server via `@fastify/static`, with API routes mounted at `/api` and `/mcp`.
* **Tradeoff vs Separate Nginx Pod**:
  - Eliminates unnecessary pod overhead, cross-origin CORS negotiation delays, and extra Ingress routing complexity.
  - Ingress routes `dashboard.127.0.0.1.nip.io` to a single backend that handles both browser UI and external MCP client traffic.

---

## 3. Production VPS Deployment Strategy (What Changes)

The same Helm chart (`charts/teambridge`) deploys to both local Kind clusters and production VPS (k3s / managed Kubernetes) using configuration overlays:

| Area | Local Kind (`values-local.yaml`) | Production VPS (`values-prod.yaml`) |
|---|---|---|
| **Domain Strategy** | Wildcard `127.0.0.1.nip.io` (zero hosts file editing) | Real FQDN (e.g. `teambridge.cloud`, `store.teambridge.cloud`) |
| **TLS & Certificates** | Disabled (`http://`) | Automated Let's Encrypt via cert-manager `ClusterIssuer` |
| **Ingress Controller** | `ingress-nginx` with hostPort 80/443 | Traefik (k3s default) or Ingress-Nginx with cloud LoadBalancer |
| **Storage Class** | `standard` (Rancher local-path-provisioner in Kind) | Production storage class (e.g. `local-path`, `hcloud-volumes`, `ebs-gp3`) |
| **Secrets Management** | Kubernetes Secrets populated via Helm values | SealedSecrets, HashiCorp Vault, or External Secrets Operator |
| **High Availability** | 1 Gateway replica | 2+ Gateway replicas with pod anti-affinity and resource limits |
| **Network Security** | Calico NetworkPolicies enforcing inter-pod isolation | Deny-all ingress NetworkPolicies + cloud firewall security groups |

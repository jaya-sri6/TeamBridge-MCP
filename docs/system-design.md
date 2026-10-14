# System Design and Tradeoffs Note

## 1. System Architecture Overview

TeamBridge implements a four-tier architecture running entirely within Kubernetes:

```
[Clients: Claude Code / Cursor / Dashboard]
                      │
           (Ingress via nip.io / DNS)
                      ▼
┌─────────────────────────────────────────────────────────┐
│               Gateway & Dashboard Layer                 │
│  - React Dashboard (Vite, Single Page Application)      │
│  - Fastify Gateway Core (Streamable HTTP MCP + REST)    │
│  - SQLite Database with WAL (Persistent Volume Claim)   │
│  - Dual-mode Chat Agent (LLM Function Calling Engine)   │
└──────────────────────────┬──────────────────────────────┘
                           │ (Streamable HTTP / Internal ClusterIP)
         ┌─────────────────┼──────────────────┐
         ▼                 ▼                  ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐
│ WooCommerce MCP │ │  Tasks MCP   │ │  Utilities MCP  │
│  (Custom Node)  │ │ (Ops Tasks)  │ │ (Math & Time)   │
└────────┬────────┘ └──────────────┘ └─────────────────┘
         │ (REST API v3 Basic Auth)
         ▼
┌─────────────────────────────────────────────────────────┐
│                    Store Layer                          │
│  - WordPress 6.7 + WooCommerce 9.3 (Apache)             │
│  - MariaDB 10.11 StatefulSet with PVC                   │
│  - Auto-seeder mu-plugin (COD, API Keys, Products)      │
└─────────────────────────────────────────────────────────┘
```

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

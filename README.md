# ⚡ TeamBridge - WooCommerce Hosting with Team MCP Gateway on Kubernetes

[![Kubernetes](https://img.shields.io/badge/Kubernetes-v1.35-blue.svg)](https://kubernetes.io)
[![Helm](https://img.shields.io/badge/Helm-v3.17-blueviolet.svg)](https://helm.sh)
[![MCP Protocol](https://img.shields.io/badge/MCP-Streamable%20HTTP-brightgreen.svg)](https://modelcontextprotocol.io)
[![WooCommerce](https://img.shields.io/badge/WooCommerce-v9.3-purple.svg)](https://woocommerce.com)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> Production-ready WooCommerce hosting platform with an enterprise team MCP gateway on Kubernetes. Connect upstream MCP servers once in an intuitive React dashboard, enabling every team member to query and mutate store data and operational tools through a single authenticated MCP endpoint and an integrated AI chat agent.

---

## 🏛️ System Architecture

TeamBridge runs entirely inside Kubernetes and consists of four synchronized tiers:

```mermaid
graph TD
    subgraph Clients["Clients & Users"]
        Browser["React Dashboard (Admin / User A)"]
        ExternalClient["External MCP Client (Cursor / Claude Code / User B)"]
    end

    subgraph Ingress["Kubernetes Ingress (ingress-nginx)"]
        IngressDash["dashboard.127.0.0.1.nip.io"]
        IngressStore["store.127.0.0.1.nip.io"]
    end

    subgraph GatewayNS["Namespace: teambridge"]
        Dashboard["React Dashboard (Vite + Modern Dark UI)"]
        Gateway["Gateway Backend (Fastify + Streamable HTTP)"]
        GatewayDB[(Gateway SQLite DB + WAL on PVC)]
        ChatAgent["Chat Agent Engine (Dual LLM / Deterministic Loop)"]
    end

    subgraph UpstreamNS["Microservices & Upstreams"]
        WooMCP["WooCommerce MCP Server (Custom TypeScript)"]
        TasksMCP["Tasks MCP Server (Operations Tasks)"]
        UtilsMCP["Utilities MCP Server (Math & Time)"]
    end

    subgraph StoreNS["Storefront & Persistence"]
        WP["WordPress 6.7 + WooCommerce 9.3 Engine"]
        MariaDB[(MariaDB 10.11 StatefulSet)]
        StorePVC[(Persistent Volume: wp-content)]
    end

    Browser --> IngressDash
    IngressDash --> Dashboard
    Dashboard --> Gateway
    ExternalClient --> Gateway
    Gateway --> GatewayDB
    Gateway --> ChatAgent
    IngressStore --> WP
    WP --> MariaDB
    WP --> StorePVC

    Gateway -.->|Streamable HTTP / Internal ClusterIP| WooMCP
    Gateway -.->|Streamable HTTP / Internal ClusterIP| TasksMCP
    Gateway -.->|Streamable HTTP / Internal ClusterIP| UtilsMCP
    WooMCP -.->|REST API v3 Basic Auth| WP
```

---

## 🚀 Quick Start: Local Kubernetes (Kind / Minikube / k3d)

### 1. Prerequisites
- **Docker**: Desktop / Engine 24+
- **Kubernetes**: Kind, k3d, or Minikube
- **kubectl**: v1.28+
- **Helm**: v3.12+
- **Node.js**: v22+

### 2. Zero-Friction Domain Strategy
Local routing uses **`*.127.0.0.1.nip.io`**. Because `nip.io` resolves dynamically via public DNS to `127.0.0.1`, **no manual editing of `/etc/hosts` or Windows `System32/drivers/etc/hosts` is required!**
- **Storefront**: `http://store.127.0.0.1.nip.io`
- **Dashboard & Gateway**: `http://dashboard.127.0.0.1.nip.io`
- **Unified MCP Endpoint**: `http://dashboard.127.0.0.1.nip.io/mcp`

### 3. Build & Load Container Images
```bash
# 1. Build all services
docker build -t teambridge/woo-mcp:latest services/woo-mcp
docker build -t teambridge/tasks-mcp:latest services/tasks-mcp
docker build -t teambridge/utilities-mcp:latest services/utilities-mcp
docker build -t teambridge/gateway:latest services/gateway
docker build -t teambridge/store:latest -f images/store/Dockerfile .

# 2. Load images into your Kind cluster
kind load docker-image teambridge/woo-mcp:latest --name meridian
kind load docker-image teambridge/tasks-mcp:latest --name meridian
kind load docker-image teambridge/utilities-mcp:latest --name meridian
kind load docker-image teambridge/gateway:latest --name meridian
kind load docker-image teambridge/store:latest --name meridian
```

### 4. Deploy via Helm
```bash
# Deploy with local Helm values
helm upgrade --install teambridge charts/teambridge \
  --namespace default \
  -f charts/teambridge/values-local.yaml
```

Check rollout status:
```bash
kubectl get pods -w
```
Once all pods transition to `Running (Ready 1/1)`, open `http://dashboard.127.0.0.1.nip.io` in your browser!

---

## 🌐 Production VPS Deployment (k3s / Cloud Kubernetes)

Deploy to any production VPS running Debian/Ubuntu with `k3s`:

### 1. Install k3s on the VPS
```bash
curl -sfL https://get.k3s.io | sh -
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

### 2. Configure Production Helm Values (`charts/teambridge/values-prod.yaml`)
Update `values-prod.yaml` with your custom domain and email:
```yaml
global:
  domain: "teambridge.yourdomain.com"
  tls: true
  storageClass: "local-path"

store:
  ingress:
    host: "store.teambridge.yourdomain.com"

gateway:
  replicaCount: 2  # High Availability multi-replica gateway
  ingress:
    host: "dashboard.teambridge.yourdomain.com"
```

### 3. Deploy
```bash
helm upgrade --install teambridge charts/teambridge \
  --namespace teambridge --create-namespace \
  -f charts/teambridge/values-prod.yaml
```

---

## 🧪 Definition of Done: Walkthrough Guide

The Definition of Done requires showing the end-to-end lifecycle across two users:

### User Identities
- **Admin**: `admin@teambridge.local` (Pre-seeded key: `tb_live_admin1234567890abcdef123456`)
- **User A (Alice)**: `alice@teambridge.local` (Pre-seeded key: `tb_live_alice1234567890abcdef123456`)
- **User B (Bob)**: `bob@teambridge.local` (Pre-seeded key: `tb_live_bob1234567890abcdef123456`)

---

### Step 1: Storefront Order Placement
1. Open `http://store.127.0.0.1.nip.io`.
2. Browse the pre-seeded catalog (e.g. *Ergonomic Developer Chair*, *Mechanical Keyboard*).
3. Add a product to your cart and proceed to Checkout.
4. Select **Cash on Delivery (Test)** as the payment method and click **Place Order**.
5. Order confirmation displays the order number (e.g. Order #12).

---

### Step 2: Chat Agent as User A (Alice)
1. In the Dashboard header, ensure the active user is set to **Alice (User A)**.
2. Navigate to the **🤖 AI Chat Agent** tab.
3. Type:
   ```text
   Create a product named "Neon Cyber Sunglasses" priced at 39.99
   ```
4. Observe the tool trace card: `woo__create_product` executes and returns the new product ID.
5. Verify on `http://store.127.0.0.1.nip.io` that *Neon Cyber Sunglasses* is now live on the storefront!
6. Place an order for it on the storefront.
7. Return to the chat and ask:
   ```text
   What orders came in today?
   ```
8. The Chat Agent calls `woo__list_orders(today_only=true)` and returns your newly placed order!

---

### Step 3: External MCP Client as User B (Bob)
Connect any external MCP client (Claude Code, Cursor, or MCP Inspector) using:
- **Transport**: `streamable-http`
- **URL**: `http://dashboard.127.0.0.1.nip.io/mcp`
- **Authorization**: `Bearer tb_live_bob1234567890abcdef123456`

#### Example Cursor / Claude Code Configuration:
```json
{
  "mcpServers": {
    "teambridge": {
      "transport": "streamable-http",
      "url": "http://dashboard.127.0.0.1.nip.io/mcp",
      "headers": {
        "Authorization": "Bearer tb_live_bob1234567890abcdef123456"
      }
    }
  }
}
```

1. Run `tools/list` to inspect all tools aggregated from WooCommerce, Tasks, and Utilities.
2. Prompt the external client:
   ```text
   What orders came in today? Also list our open operational tasks and calculate a 10% discount on order #12.
   ```
   The client invokes `woo__list_orders`, `tasks__list_tasks`, and `utilities__calculate_math` seamlessly through the single endpoint!

---

### Step 4: Team and Security Controls
1. **Key Revocation**:
   - In the Dashboard **🔑 Team & API Keys** tab, locate Bob's active key and click **Revoke Key**.
   - Attempt an MCP request with Bob's key. It is immediately rejected with **HTTP 401 Unauthorized**.
2. **Upstream Disablement**:
   - As Admin in the **🔌 MCP Servers** tab, toggle `Operations Tasks MCP` to **Disabled**.
   - Refresh tool listing in the Chat Agent or external client: tasks tools disappear instantly.
3. **Fault Tolerance & Pod Killing**:
   - Kill the pod of `utilities-mcp`:
     ```bash
     kubectl delete pod -l app=utilities-mcp --now
     ```
   - In the dashboard, `Utilities & Math MCP` transitions to **Unreachable**.
   - Notice that calls to `woo-mcp` and `tasks-mcp` continue working without delay or degradation!
4. **Audit Log Inspection**:
   - Open the **📜 Audit Log** tab.
   - Inspect the table: every single tool call from Step 2, Step 3, and Step 4 is recorded with user email, upstream slug, tool name, execution duration, and outcome status.

---

### Step 5: Automated Verification Suite
To run the automated test suite covering all steps in seconds:
```bash
node scripts/verify-dod.mjs
```

---

## 🔒 Security Posture & Isolation

- **Zero-Trust NetworkPolicies**: Calico policies ensure that upstream MCP servers accept traffic **only** from Gateway pods. Direct external access to MCP upstreams or MariaDB is blocked at the packet level.
- **Credential Masking**: Upstream credentials remain server-side and are never exposed to browser clients or external MCP tools.
- **Hashed API Keys**: All user API keys are stored as SHA-256 HMAC digests with salt. Plaintext keys are shown only once upon generation.
- **Least-Privilege Execution**: All container workloads run as non-root users (`USER node`).

---

## 📁 Repository Structure

```
├── apps/
│   └── dashboard/             # React + Vite admin dashboard & AI chat UI
├── services/
│   ├── gateway/               # Fastify Gateway core, MCP aggregator, SQLite WAL DB
│   ├── woo-mcp/               # Custom WooCommerce Streamable HTTP MCP server
│   ├── tasks-mcp/             # Operations Tasks MCP server
│   └── utilities-mcp/         # Math & Utilities MCP server
├── images/
│   └── store/                 # Custom WordPress 6.7 + WooCommerce 9.3 container
├── charts/
│   └── teambridge/            # Unified Helm Chart
│       ├── values.yaml        # Base chart values
│       ├── values-local.yaml  # Kind cluster values with nip.io
│       ├── values-prod.yaml   # Production VPS values with TLS & high availability
│       └── templates/         # Kubernetes manifests & NetworkPolicies
├── docs/
│   ├── system-design.md       # Architecture choices, tool routing, and VPS strategy
│   ├── threat-model.md        # Security threat model & cross-tenant isolation
│   └── standout-features.md   # Differentiators: NetworkPolicies, Dual LLM engine
├── scripts/
│   ├── teambridge-init.php    # WooCommerce auto-seeder mu-plugin
│   └── verify-dod.mjs         # Automated Definition of Done verification test
└── README.md
```

---

## 🌟 Stand-Out Differentiators Implemented

1. **Production-like VPS Deployment**: Complete Helm values architecture supporting both local Kind (`values-local.yaml`) and production VPS (`values-prod.yaml`) with cert-manager TLS annotations.
2. **Security Hardening**: Enforced Calico `NetworkPolicies` denying external traffic to upstreams and database, containers running as non-root, and hashed HMAC credentials.
3. **High Availability Multi-Replica Gateway**: Stateless Streamable HTTP session routing with SQLite WAL persistence.
4. **Dual-Mode AI Chat Agent**: Fully operational offline via deterministic heuristics AND compatible with cloud LLMs (OpenAI, Claude, Groq) via standard API key configuration.
5. **Tool Name Collision Scheme**: Canonical namespacing (`${slug}__${tool}`) with smart transparent aliasing for unique tools.

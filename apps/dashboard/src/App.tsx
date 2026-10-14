import React, { useState, useEffect } from "react";

interface Upstream {
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
  credentialType: string;
  credentialMasked?: string | null;
}

interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  created_at: string;
}

interface ApiKey {
  id: string;
  user_id: string;
  prefix: string;
  label: string;
  revoked: number;
  created_at: string;
  last_used_at: string | null;
  user_email: string;
}

interface AuditLog {
  id: string;
  user_id: string;
  user_email: string;
  upstream_id: string;
  upstream_slug: string;
  tool_name: string;
  raw_tool_name: string;
  arguments_json: string;
  success: number;
  duration_ms: number;
  error_message: string | null;
  timestamp: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    toolName: string;
    arguments: any;
    result: any;
    durationMs: number;
    success: boolean;
  }>;
}

export function App() {
  const [activeTab, setActiveTab] = useState<"servers" | "chat" | "team" | "audit">("servers");
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [upstreams, setUpstreams] = useState<Upstream[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Welcome to TeamBridge MCP! I am your AI operations assistant. You can ask me to create products in WooCommerce, check today's orders, list operational tasks, or perform math and utility calculations.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Modals
  const [showAddServerModal, setShowAddServerModal] = useState(false);
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newKeyPlaintext, setNewKeyPlaintext] = useState<string | null>(null);

  // Forms
  const [newServerForm, setNewServerForm] = useState({
    name: "",
    slug: "",
    url: "",
    credentialType: "none",
    credentialValue: "",
  });
  const [newKeyLabel, setNewKeyLabel] = useState("Developer Workstation Key");
  const [newMemberForm, setNewMemberForm] = useState({ name: "", email: "", role: "member" });

  const getHeaders = () => {
    return {
      "Content-Type": "application/json",
      ...(currentUser ? { "X-User-Id": currentUser.id } : {}),
    };
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Users
      const usersRes = await fetch("/api/users");
      const usersData = await usersRes.json();
      setUsers(usersData.users || []);
      if (!currentUser && usersData.users?.length > 0) {
        setCurrentUser(usersData.users[0]);
      }

      // 2. Fetch Upstreams
      const upsRes = await fetch("/api/upstreams");
      const upsData = await upsRes.json();
      setUpstreams(upsData.upstreams || []);

      // 3. Fetch Keys
      const keysRes = await fetch("/api/keys", { headers: getHeaders() });
      const keysData = await keysRes.json();
      setKeys(keysData.keys || []);

      // 4. Fetch Audit Logs
      const auditRes = await fetch("/api/audit?limit=50");
      const auditData = await auditRes.json();
      setAuditLogs(auditData.logs || []);
    } catch (err) {
      console.error("Failed to load initial data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 8000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  const handleToggleUpstream = async (id: string) => {
    await fetch(`/api/upstreams/${id}/toggle`, { method: "PATCH", headers: getHeaders() });
    loadData();
  };

  const handleDeleteUpstream = async (id: string) => {
    if (confirm("Are you sure you want to remove this upstream MCP server?")) {
      await fetch(`/api/upstreams/${id}`, { method: "DELETE", headers: getHeaders() });
      loadData();
    }
  };

  const handleCreateUpstream = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/upstreams", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(newServerForm),
    });
    setShowAddServerModal(false);
    setNewServerForm({ name: "", slug: "", url: "", credentialType: "none", credentialValue: "" });
    loadData();
  };

  const handleGenerateKey = async () => {
    if (!currentUser) return;
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ userId: currentUser.id, label: newKeyLabel }),
    });
    const data = await res.json();
    setNewKeyPlaintext(data.key.plaintextKey);
    loadData();
  };

  const handleRevokeKey = async (keyId: string) => {
    if (confirm("Revoke this API key immediately? External clients using it will be rejected.")) {
      await fetch(`/api/keys/${keyId}`, { method: "DELETE", headers: getHeaders() });
      loadData();
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/users", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(newMemberForm),
    });
    setShowInviteModal(false);
    setNewMemberForm({ name: "", email: "", role: "member" });
    loadData();
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userText = chatInput.trim();
    const newHistory: ChatMessage[] = [...chatMessages, { role: "user", content: userText }];
    setChatMessages(newHistory);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ messages: newHistory.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      setChatMessages([
        ...newHistory,
        {
          role: "assistant",
          content: data.message || "Done.",
          toolCalls: data.toolCalls,
        },
      ]);
      // Refresh audit logs immediately to show the chat tool call
      const auditRes = await fetch("/api/audit?limit=25");
      const auditData = await auditRes.json();
      setAuditLogs(auditData.logs || []);
    } catch (err: any) {
      setChatMessages([
        ...newHistory,
        {
          role: "assistant",
          content: `Error: ${err.message}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">⚡</div>
          <div>
            <div className="brand-title">TeamBridge MCP</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              WooCommerce & Team Gateway on Kubernetes
            </div>
          </div>
          <span className="brand-badge">Kubernetes v1.35</span>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === "servers" ? "active" : ""}`}
            onClick={() => setActiveTab("servers")}
          >
            🔌 MCP Servers
          </button>
          <button
            className={`nav-tab ${activeTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            🤖 AI Chat Agent
          </button>
          <button
            className={`nav-tab ${activeTab === "team" ? "active" : ""}`}
            onClick={() => setActiveTab("team")}
          >
            🔑 Team & API Keys
          </button>
          <button
            className={`nav-tab ${activeTab === "audit" ? "active" : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            📜 Audit Log
          </button>
        </nav>

        {/* User Identity Switcher */}
        <div className="user-switcher">
          <a
            href="http://store.127.0.0.1.nip.io"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: "0.78rem", padding: "0.35rem 0.7rem" }}
          >
            🛍️ Open Storefront ↗
          </a>

          <select
            className="user-select"
            value={currentUser?.id || ""}
            onChange={(e) => {
              const u = users.find((x) => x.id === e.target.value);
              if (u) setCurrentUser(u);
            }}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role.toUpperCase()})
              </option>
            ))}
          </select>
          {currentUser && (
            <span className={`role-badge ${currentUser.role}`}>{currentUser.role}</span>
          )}
        </div>
      </header>

      {/* Main Body */}
      <main className="main-content">
        {/* TAB 1: MCP UPSTREAM SERVERS */}
        {activeTab === "servers" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2>Registered Upstream MCP Servers</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem" }}>
                  The Gateway aggregates all tools behind the single MCP endpoint:{" "}
                  <code style={{ color: "#a5b4fc", fontFamily: "var(--font-mono)" }}>
                    http://dashboard.127.0.0.1.nip.io/mcp
                  </code>
                </p>
              </div>
              {currentUser?.role === "admin" && (
                <button className="btn btn-primary" onClick={() => setShowAddServerModal(true)}>
                  + Add MCP Server
                </button>
              )}
            </div>

            <div className="cards-grid">
              {upstreams.map((ups) => (
                <div key={ups.id} className="glass-panel server-card">
                  <div>
                    <div className="server-header">
                      <div>
                        <div className="server-name">{ups.name}</div>
                        <div className="server-url">{ups.url}</div>
                      </div>
                      <span className={`status-pill ${ups.status.toLowerCase()}`}>
                        <span className="status-dot"></span>
                        {ups.status}
                      </span>
                    </div>

                    {ups.latencyMs !== undefined && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                        ⚡ Latency: {ups.latencyMs}ms | Slug: <code>{ups.slug}</code>
                      </div>
                    )}

                    <div style={{ marginTop: "0.75rem" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                        Exposed Tools ({ups.toolsCount}):
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                        {ups.tools.map((tool) => (
                          <span key={tool} className="tool-tag">
                            {tool}
                          </span>
                        ))}
                        {ups.tools.length === 0 && (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            No tools active (server {ups.status.toLowerCase()})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {currentUser?.role === "admin" && (
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
                      <button
                        className={`btn ${ups.enabled ? "btn-secondary" : "btn-primary"}`}
                        style={{ flex: 1, fontSize: "0.78rem" }}
                        onClick={() => handleToggleUpstream(ups.id)}
                      >
                        {ups.enabled ? "Disable Server" : "Enable Server"}
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ fontSize: "0.78rem" }}
                        onClick={() => handleDeleteUpstream(ups.id)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: AI CHAT AGENT */}
        {activeTab === "chat" && (
          <div>
            <div style={{ marginBottom: "1rem" }}>
              <h2>AI Operations Chat Agent</h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem" }}>
                Acting as: <strong>{currentUser?.name}</strong> ({currentUser?.email}). Tool calls are executed on the Gateway under your user identity and logged to the audit trail.
              </p>
            </div>

            <div className="chat-container">
              <div className="chat-messages">
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`chat-bubble ${msg.role}`}>
                    <div>{msg.content}</div>

                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#818cf8" }}>
                          🔧 Tools Executed in this Turn:
                        </div>
                        {msg.toolCalls.map((tc, tcIdx) => (
                          <div key={tcIdx} className="tool-trace-card">
                            <div style={{ display: "flex", justifyContent: "space-between", color: tc.success ? "#34d399" : "#f87171" }}>
                              <span>Tool: {tc.toolName}</span>
                              <span>{tc.durationMs}ms ({tc.success ? "SUCCESS" : "FAILED"})</span>
                            </div>
                            <div style={{ color: "#94a3b8", marginTop: "0.25rem" }}>
                              Arguments: {JSON.stringify(tc.arguments)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {chatLoading && (
                  <div className="chat-bubble assistant" style={{ fontStyle: "italic", color: "var(--text-muted)" }}>
                    Thinking and calling Gateway tools...
                  </div>
                )}
              </div>

              {/* Sample Prompts */}
              <div style={{ display: "flex", gap: "0.5rem", padding: "0.5rem 1.25rem", background: "rgba(0,0,0,0.2)", overflowX: "auto" }}>
                <button
                  className="tool-tag"
                  style={{ cursor: "pointer" }}
                  onClick={() => setChatInput('Create a product named "Neon Cyber Headphones" priced at 49.99')}
                >
                  💡 Create WooCommerce Product
                </button>
                <button
                  className="tool-tag"
                  style={{ cursor: "pointer" }}
                  onClick={() => setChatInput("What orders came in today?")}
                >
                  💡 Check Today's Orders
                </button>
                <button
                  className="tool-tag"
                  style={{ cursor: "pointer" }}
                  onClick={() => setChatInput("List all open operational tasks")}
                >
                  💡 Query Tasks MCP
                </button>
                <button
                  className="tool-tag"
                  style={{ cursor: "pointer" }}
                  onClick={() => setChatInput("Calculate a 15% discount on a 99.99 order")}
                >
                  💡 Calculate Discount
                </button>
              </div>

              <form className="chat-input-row" onSubmit={handleSendChat}>
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Ask a question or issue a store command..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={chatLoading}
                />
                <button type="submit" className="btn btn-primary" disabled={chatLoading || !chatInput.trim()}>
                  Send
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 3: TEAM & API KEYS */}
        {activeTab === "team" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2>Team Members & API Key Credentials</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem" }}>
                  Each member generates their own personal API key. Keys are stored as secure HMAC SHA-256 hashes and can be revoked instantly.
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn btn-primary" onClick={() => setShowAddKeyModal(true)}>
                  + Generate Personal API Key
                </button>
                {currentUser?.role === "admin" && (
                  <button className="btn btn-secondary" onClick={() => setShowInviteModal(true)}>
                    + Invite Member
                  </button>
                )}
              </div>
            </div>

            {/* Team Members List */}
            <div className="glass-panel" style={{ marginTop: "1.5rem", padding: "1.5rem" }}>
              <h3>Team Directory</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>User ID</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td><strong>{u.name}</strong></td>
                        <td>{u.email}</td>
                        <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                        <td><code>{u.id}</code></td>
                        <td>{new Date(u.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* API Keys Table */}
            <div className="glass-panel" style={{ marginTop: "1.5rem", padding: "1.5rem" }}>
              <h3>Active API Keys</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>User</th>
                      <th>Key Prefix</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Last Used</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id}>
                        <td><strong>{k.label}</strong></td>
                        <td>{k.user_email}</td>
                        <td><code>{k.prefix}...</code></td>
                        <td>
                          {k.revoked ? (
                            <span className="status-pill unreachable">REVOKED</span>
                          ) : (
                            <span className="status-pill connected">ACTIVE</span>
                          )}
                        </td>
                        <td>{new Date(k.created_at).toLocaleDateString()}</td>
                        <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleTimeString() : "Never"}</td>
                        <td>
                          {!k.revoked && (
                            <button
                              className="btn btn-danger"
                              style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                              onClick={() => handleRevokeKey(k.id)}
                            >
                              Revoke Key
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: AUDIT LOG */}
        {activeTab === "audit" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2>Gateway Tool Call Audit Log</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem" }}>
                  Immutable audit trail recording every tool execution: who, server, tool, duration, and outcome.
                </p>
              </div>
              <button className="btn btn-secondary" onClick={loadData}>
                ↻ Refresh Log
              </button>
            </div>

            <div className="glass-panel" style={{ marginTop: "1.5rem", padding: "1.5rem" }}>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>User</th>
                      <th>Server</th>
                      <th>Tool Called</th>
                      <th>Arguments</th>
                      <th>Duration</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.timestamp).toLocaleTimeString()}</td>
                        <td><strong>{log.user_email}</strong></td>
                        <td><span className="tool-tag">{log.upstream_slug || "system"}</span></td>
                        <td><code>{log.tool_name}</code></td>
                        <td style={{ maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <code>{log.arguments_json}</code>
                        </td>
                        <td>{log.duration_ms}ms</td>
                        <td>
                          {log.success ? (
                            <span className="status-pill connected">SUCCESS</span>
                          ) : (
                            <span className="status-pill unreachable" title={log.error_message || ""}>
                              FAILED
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                          No tool calls recorded yet. Execute a prompt in the chat or via external MCP client to generate logs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal: Add Upstream */}
      {showAddServerModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Register New MCP Upstream Server</h3>
            <form onSubmit={handleCreateUpstream}>
              <div className="form-group">
                <label className="form-label">Server Display Name</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Analytics MCP"
                  value={newServerForm.name}
                  onChange={(e) => setNewServerForm({ ...newServerForm, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Streamable HTTP URL</label>
                <input
                  type="url"
                  required
                  className="form-input"
                  placeholder="http://analytics-mcp.teambridge-mcp.svc.cluster.local:8000/mcp"
                  value={newServerForm.url}
                  onChange={(e) => setNewServerForm({ ...newServerForm, url: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Credential Type</label>
                <select
                  className="form-input"
                  value={newServerForm.credentialType}
                  onChange={(e) => setNewServerForm({ ...newServerForm, credentialType: e.target.value })}
                >
                  <option value="none">None (Internal cluster or public)</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="header">Custom Header / Token</option>
                </select>
              </div>
              {newServerForm.credentialType !== "none" && (
                <div className="form-group">
                  <label className="form-label">Credential Secret Value</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Secret token (never sent to clients)"
                    value={newServerForm.credentialValue}
                    onChange={(e) => setNewServerForm({ ...newServerForm, credentialValue: e.target.value })}
                  />
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddServerModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Register Server
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add API Key */}
      {showAddKeyModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Generate API Key for {currentUser?.name}</h3>
            {newKeyPlaintext ? (
              <div>
                <div style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "8px", padding: "1rem", marginBottom: "1.25rem" }}>
                  <div style={{ color: "#34d399", fontWeight: 700, marginBottom: "0.4rem" }}>
                    API Key Created Successfully!
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                    Copy this key now. It is stored as an HMAC hash and will not be displayed again.
                  </p>
                  <input
                    type="text"
                    readOnly
                    className="form-input"
                    style={{ fontFamily: "var(--font-mono)", color: "#ffffff", fontWeight: 700 }}
                    value={newKeyPlaintext}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      navigator.clipboard.writeText(newKeyPlaintext);
                      setNewKeyPlaintext(null);
                      setShowAddKeyModal(false);
                    }}
                  >
                    Copy Key & Close
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="form-group">
                  <label className="form-label">Key Description / Label</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newKeyLabel}
                    onChange={(e) => setNewKeyLabel(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddKeyModal(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleGenerateKey}>
                    Generate Key
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Invite Member */}
      {showInviteModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Invite New Team Member</h3>
            <form onSubmit={handleInviteMember}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. John Doe"
                  value={newMemberForm.name}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  className="form-input"
                  placeholder="john@company.com"
                  value={newMemberForm.email}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select
                  className="form-input"
                  value={newMemberForm.role}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, role: e.target.value as any })}
                >
                  <option value="member">Member (Can use tools, generate keys, chat)</option>
                  <option value="admin">Administrator (Full server management & audit access)</option>
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowInviteModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Invite Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

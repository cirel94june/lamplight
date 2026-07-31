import { useCallback, useEffect, useState } from "react";
import type { SceneDefinition } from "@lamplight/contracts";
import { AGENT_META } from "../../constants/agents.js";
import { AssetUploader } from "./AssetUploader.js";

type Tab = "assets" | "providers" | "agents";

interface ApiProvider {
  id: string;
  provider_type: string;
  display_name: string;
  base_url: string;
  api_key_masked: string;
  is_active: boolean;
}

interface AgentBinding {
  id: string;
  api_provider_id: string;
  provider_id: string;
  model_id: string;
  fault_state: string;
}

interface AgentConfig {
  agent_id: string;
  display_name: string;
  binding: AgentBinding | null;
}

// ── Provider Management ──

function ProviderForm({ provider, onSaved, onCancel }: {
  provider?: ApiProvider;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    provider_type: provider?.provider_type ?? "anthropic",
    display_name: provider?.display_name ?? "",
    base_url: provider?.base_url ?? "",
    api_key: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!form.display_name || !form.base_url || (!provider && !form.api_key)) {
      setError("请填写所有必填项");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        provider_type: form.provider_type,
        display_name: form.display_name,
        base_url: form.base_url,
      };
      if (form.api_key) body.api_key = form.api_key;

      const url = provider ? `/api/settings/providers/${provider.id}` : "/api/settings/providers";
      const res = await fetch(url, {
        method: provider ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        onSaved();
      } else {
        setError(json.error ?? "保存失败");
      }
    } catch {
      setError("保存失败");
    } finally {
      setSaving(false);
    }
  }, [form, provider, onSaved]);

  return (
    <div className="provider-form">
      <label className="gateway-label">
        类型
        <select
          className="gateway-input"
          value={form.provider_type}
          onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
        </select>
      </label>
      <label className="gateway-label">
        名称
        <input
          className="gateway-input"
          type="text"
          placeholder="如：小克的中转站"
          value={form.display_name}
          onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
        />
      </label>
      <label className="gateway-label">
        Base URL
        <input
          className="gateway-input"
          type="text"
          placeholder="https://relay.example.com/v1"
          value={form.base_url}
          onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
        />
      </label>
      <label className="gateway-label">
        API Key {provider && <span className="gateway-env-badge">当前: {provider.api_key_masked}</span>}
        <input
          className="gateway-input"
          type="password"
          placeholder={provider ? "留空不修改" : "必填"}
          value={form.api_key}
          onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
        />
      </label>
      {error && <span className="gateway-msg-err">{error}</span>}
      <div className="gateway-actions">
        <button className="gateway-save-btn" onClick={handleSubmit} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
        <button className="provider-cancel-btn" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

function ProviderSettings() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [editing, setEditing] = useState<ApiProvider | "new" | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/providers");
      const json = await res.json();
      if (json.ok) setProviders(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/settings/providers/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) load();
    else alert(json.error ?? "删除失败");
  }, [load]);

  const handleTest = useCallback(async (id: string) => {
    setTesting(id);
    setTestResult((r) => ({ ...r, [id]: "testing" }));
    try {
      const res = await fetch(`/api/settings/providers/${id}/test`, { method: "POST" });
      const json = await res.json();
      setTestResult((r) => ({ ...r, [id]: json.ok ? "connected" : json.error ?? "failed" }));
    } catch {
      setTestResult((r) => ({ ...r, [id]: "failed" }));
    }
    setTesting(null);
  }, []);

  if (loading) return <div className="settings-section"><p className="gateway-loading">加载中…</p></div>;

  if (editing) {
    return (
      <div className="settings-section">
        <h3 className="settings-section-title">{editing === "new" ? "添加 Provider" : `编辑: ${editing.display_name}`}</h3>
        <ProviderForm
          provider={editing === "new" ? undefined : editing}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="settings-section">
      <div className="provider-header-row">
        <h3 className="settings-section-title">API Providers</h3>
        <button className="gateway-save-btn" onClick={() => setEditing("new")}>添加</button>
      </div>
      {providers.length === 0 && <p className="gateway-loading">尚未配置任何 provider</p>}
      {providers.map((p) => (
        <div key={p.id} className="provider-card">
          <div className="provider-card-header">
            <span className="provider-card-name">{p.display_name}</span>
            <span className="gateway-env-badge">{p.provider_type}</span>
            {!p.is_active && <span className="gateway-msg-err">已停用</span>}
          </div>
          <div className="provider-card-url">{p.base_url}</div>
          <div className="provider-card-key">Key: {p.api_key_masked}</div>
          <div className="gateway-actions">
            <button className="provider-action-btn" onClick={() => setEditing(p)}>编辑</button>
            <button
              className="provider-action-btn"
              onClick={() => handleTest(p.id)}
              disabled={testing === p.id}
            >
              {testing === p.id ? "测试中…" : "测试连接"}
            </button>
            <button className="provider-delete-btn" onClick={() => handleDelete(p.id)}>删除</button>
          </div>
          {testResult[p.id] && testResult[p.id] !== "testing" && (
            <span className={testResult[p.id] === "connected" ? "gateway-msg-ok" : "gateway-msg-err"}>
              {testResult[p.id] === "connected" ? "连接成功" : testResult[p.id]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Agent Model Config ──

function AgentModelSettings() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/settings/agents").then((r) => r.json()),
      fetch("/api/settings/providers").then((r) => r.json()),
    ]).then(([agentRes, providerRes]) => {
      if (agentRes.ok) setAgents(agentRes.data);
      if (providerRes.ok) setProviders(providerRes.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async (agentId: string, providerId: string, modelId: string, apiProviderId: string) => {
    setSaving(agentId);
    setMessage((m) => ({ ...m, [agentId]: "" }));
    try {
      const res = await fetch(`/api/settings/agents/${agentId}/model-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: providerId, model_id: modelId, api_provider_id: apiProviderId }),
      });
      const json = await res.json();
      if (json.ok) {
        setMessage((m) => ({ ...m, [agentId]: "saved" }));
        setAgents((prev) => prev.map((a) =>
          a.agent_id === agentId
            ? { ...a, binding: { id: a.binding?.id ?? "", api_provider_id: apiProviderId, provider_id: providerId, model_id: modelId, fault_state: "ok" } }
            : a,
        ));
      } else {
        setMessage((m) => ({ ...m, [agentId]: json.error ?? "failed" }));
      }
    } catch {
      setMessage((m) => ({ ...m, [agentId]: "failed" }));
    }
    setSaving(null);
  }, []);

  if (loading) return <div className="settings-section"><p className="gateway-loading">加载中…</p></div>;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Agent 模型配置</h3>
      {agents.map((agent) => {
        const meta = AGENT_META[agent.agent_id as keyof typeof AGENT_META];
        return (
          <AgentConfigCard
            key={agent.agent_id}
            agent={agent}
            emoji={meta?.emoji ?? "🤖"}
            providers={providers}
            saving={saving === agent.agent_id}
            message={message[agent.agent_id]}
            onSave={handleSave}
          />
        );
      })}
    </div>
  );
}

function AgentConfigCard({ agent, emoji, providers, saving, message, onSave }: {
  agent: AgentConfig;
  emoji: string;
  providers: ApiProvider[];
  saving: boolean;
  message?: string;
  onSave: (agentId: string, providerId: string, modelId: string, apiProviderId: string) => void;
}) {
  const [providerId, setProviderId] = useState(agent.binding?.provider_id ?? "");
  const [modelId, setModelId] = useState(agent.binding?.model_id ?? "");
  const [apiProviderId, setApiProviderId] = useState(agent.binding?.api_provider_id ?? "");

  return (
    <div className="provider-card">
      <div className="provider-card-header">
        <span className="provider-card-name">{emoji} {agent.display_name}</span>
      </div>
      <label className="gateway-label">
        API Provider
        <select
          className="gateway-input"
          value={apiProviderId}
          onChange={(e) => {
            setApiProviderId(e.target.value);
            const p = providers.find((pr) => pr.id === e.target.value);
            if (p) setProviderId(p.provider_type);
          }}
        >
          <option value="">未配置</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.display_name} ({p.provider_type})</option>
          ))}
        </select>
      </label>
      <label className="gateway-label">
        SDK 类型
        <input className="gateway-input" type="text" value={providerId} onChange={(e) => setProviderId(e.target.value)} />
      </label>
      <label className="gateway-label">
        模型
        <input className="gateway-input" type="text" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="claude-opus-4-6" />
      </label>
      <div className="gateway-actions">
        <button
          className="gateway-save-btn"
          disabled={saving || !apiProviderId}
          onClick={() => onSave(agent.agent_id, providerId, modelId, apiProviderId)}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        {message === "saved" && <span className="gateway-msg-ok">已保存</span>}
        {message && message !== "saved" && <span className="gateway-msg-err">{message}</span>}
      </div>
    </div>
  );
}

// ── Main Panel ──

interface Props {
  open: boolean;
  onClose: () => void;
  scenes: SceneDefinition[];
  getAvatarUrl: (id: string) => string | undefined;
  getRoomImageUrl: (id: string) => string | undefined;
  uploadAsset: (type: string, id: string, file: File) => Promise<string>;
  deleteAsset: (type: string, id: string) => Promise<void>;
}

export function SettingsPanel({
  open, onClose, scenes,
  getAvatarUrl, getRoomImageUrl,
  uploadAsset, deleteAsset,
}: Props) {
  const [tab, setTab] = useState<Tab>("assets");

  if (!open) return null;

  const agents = Object.values(AGENT_META);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">设置</h2>
          <button className="settings-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="settings-tabs">
          <button className={`settings-tab ${tab === "assets" ? "active" : ""}`} onClick={() => setTab("assets")}>素材</button>
          <button className={`settings-tab ${tab === "providers" ? "active" : ""}`} onClick={() => setTab("providers")}>API Providers</button>
          <button className={`settings-tab ${tab === "agents" ? "active" : ""}`} onClick={() => setTab("agents")}>Agent 配置</button>
        </div>

        {tab === "assets" && (
          <>
            <section className="settings-section">
              <h3 className="settings-section-title">角色头像</h3>
              <div className="settings-grid">
                {agents.map((agent) => (
                  <AssetUploader
                    key={agent.agent_id}
                    label={`${agent.emoji} ${agent.display_name}`}
                    currentUrl={getAvatarUrl(agent.agent_id)}
                    onUpload={(file) => uploadAsset("avatars", agent.agent_id, file)}
                    onDelete={() => deleteAsset("avatars", agent.agent_id)}
                  />
                ))}
              </div>
            </section>

            <section className="settings-section">
              <h3 className="settings-section-title">房间插画</h3>
              <div className="settings-grid">
                {scenes.map((scene) => (
                  <AssetUploader
                    key={scene.scene_id}
                    label={scene.display_name}
                    currentUrl={getRoomImageUrl(scene.scene_id)}
                    onUpload={(file) => uploadAsset("rooms", scene.scene_id, file)}
                    onDelete={() => deleteAsset("rooms", scene.scene_id)}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {tab === "providers" && <ProviderSettings />}
        {tab === "agents" && <AgentModelSettings />}
      </div>
    </div>
  );
}

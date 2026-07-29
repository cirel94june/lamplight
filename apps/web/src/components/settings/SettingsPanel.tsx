import { useCallback, useEffect, useState } from "react";
import type { SceneDefinition } from "@lamplight/contracts";
import { AGENT_META } from "../../constants/agents.js";
import { AssetUploader } from "./AssetUploader.js";

type Tab = "assets" | "api";

interface GatewayData {
  anthropic_api_key: string;
  anthropic_base_url: string;
  openai_api_key: string;
  openai_base_url: string;
  anthropic_env?: boolean;
  openai_env?: boolean;
}

function GatewaySettings() {
  const [data, setData] = useState<GatewayData | null>(null);
  const [form, setForm] = useState({
    anthropic_api_key: "",
    anthropic_base_url: "",
    openai_api_key: "",
    openai_base_url: "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/gateway")
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setData(res.data);
          setForm({
            anthropic_api_key: "",
            anthropic_base_url: res.data.anthropic_base_url ?? "",
            openai_api_key: "",
            openai_base_url: res.data.openai_base_url ?? "",
          });
        }
      })
      .catch(() => setMessage("无法加载配置"));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, string> = {};
      if (form.anthropic_api_key) body.anthropic_api_key = form.anthropic_api_key;
      if (form.openai_api_key) body.openai_api_key = form.openai_api_key;
      body.anthropic_base_url = form.anthropic_base_url;
      body.openai_base_url = form.openai_base_url;

      const res = await fetch("/api/settings/gateway", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setData({ ...json.data, anthropic_env: data?.anthropic_env, openai_env: data?.openai_env });
        setForm((f) => ({ ...f, anthropic_api_key: "", openai_api_key: "" }));
        setMessage("已保存");
      } else {
        setMessage("保存失败");
      }
    } catch {
      setMessage("保存失败");
    } finally {
      setSaving(false);
    }
  }, [form, data]);

  if (!data) return <div className="settings-section"><p className="gateway-loading">加载中…</p></div>;

  return (
    <div className="settings-section">
      <div className="gateway-provider">
        <h3 className="settings-section-title">Anthropic</h3>
        {data.anthropic_env && <span className="gateway-env-badge">环境变量已设置</span>}
        <label className="gateway-label">
          API Key
          <input
            className="gateway-input"
            type="password"
            placeholder={data.anthropic_api_key || "未设置"}
            value={form.anthropic_api_key}
            onChange={(e) => setForm((f) => ({ ...f, anthropic_api_key: e.target.value }))}
          />
        </label>
        <label className="gateway-label">
          Base URL
          <input
            className="gateway-input"
            type="text"
            placeholder="默认官方地址"
            value={form.anthropic_base_url}
            onChange={(e) => setForm((f) => ({ ...f, anthropic_base_url: e.target.value }))}
          />
        </label>
      </div>

      <div className="gateway-provider">
        <h3 className="settings-section-title">OpenAI</h3>
        {data.openai_env && <span className="gateway-env-badge">环境变量已设置</span>}
        <label className="gateway-label">
          API Key
          <input
            className="gateway-input"
            type="password"
            placeholder={data.openai_api_key || "未设置"}
            value={form.openai_api_key}
            onChange={(e) => setForm((f) => ({ ...f, openai_api_key: e.target.value }))}
          />
        </label>
        <label className="gateway-label">
          Base URL
          <input
            className="gateway-input"
            type="text"
            placeholder="默认官方地址"
            value={form.openai_base_url}
            onChange={(e) => setForm((f) => ({ ...f, openai_base_url: e.target.value }))}
          />
        </label>
      </div>

      <div className="gateway-actions">
        <button className="gateway-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
        {message && <span className={message === "已保存" ? "gateway-msg-ok" : "gateway-msg-err"}>{message}</span>}
      </div>
    </div>
  );
}

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
          <button className={`settings-tab ${tab === "api" ? "active" : ""}`} onClick={() => setTab("api")}>API 配置</button>
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

        {tab === "api" && <GatewaySettings />}
      </div>
    </div>
  );
}

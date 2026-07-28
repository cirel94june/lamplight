import type { SceneDefinition } from "@lamplight/contracts";
import { AGENT_META } from "../../constants/agents.js";
import { AssetUploader } from "./AssetUploader.js";

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
  if (!open) return null;

  const agents = Object.values(AGENT_META);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">设置</h2>
          <button className="settings-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

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
      </div>
    </div>
  );
}

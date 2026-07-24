import type { WsStatus } from "@lamplight/api-client";

interface Props {
  status: WsStatus;
}

export function StatusBar({ status }: Props) {
  const label =
    status === "connected" ? "已连接" :
    status === "connecting" ? "连接中…" :
    "未连接";

  const color =
    status === "connected" ? "#4CAF50" :
    status === "connecting" ? "#FFC107" :
    "#F44336";

  return (
    <div className="status-bar">
      <span className="status-dot" style={{ backgroundColor: color }} />
      <span className="status-label">{label}</span>
    </div>
  );
}

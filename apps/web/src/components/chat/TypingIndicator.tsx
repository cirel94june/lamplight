import { getAgentMeta } from "../../constants/agents.js";

interface Props {
  agentIds: string[];
}

export function TypingIndicator({ agentIds }: Props) {
  if (agentIds.length === 0) return null;

  const names = agentIds.map((id) => getAgentMeta(id).display_name);
  const label = names.length === 1
    ? `${names[0]} 正在输入`
    : `${names.join("、")} 正在输入`;

  return (
    <div className="typing-indicator">
      <span className="typing-label">{label}</span>
      <span className="typing-dots">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

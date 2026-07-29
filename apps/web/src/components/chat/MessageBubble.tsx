import type { ChatMessage } from "../../types/chat.js";
import { getAgentMeta } from "../../constants/agents.js";
import { formatRelativeTime } from "../../utils/time.js";

interface Props {
  message: ChatMessage;
  isConsecutive: boolean;
  isNew?: boolean;
  avatarUrl?: string;
}

export function MessageBubble({ message, isConsecutive, isNew, avatarUrl }: Props) {
  const isUser = message.sender.type === "user";
  const isAi = message.sender.type === "ai";
  const meta = isAi && message.sender.ai_id
    ? getAgentMeta(message.sender.ai_id)
    : null;

  const rowClass = [
    "message-row",
    isUser ? "message-row--user" : "message-row--ai",
    isConsecutive ? "message-row--consecutive" : "",
    isNew ? "message-enter" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={rowClass}>
      {isAi && !isConsecutive && (
        <div
          className="message-avatar"
          style={meta ? { backgroundColor: meta.color + "22" } : undefined}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={meta?.display_name ?? ""} className="message-avatar-img" />
          ) : (
            <span className="message-avatar-emoji">{meta?.emoji ?? "🤖"}</span>
          )}
        </div>
      )}
      {isAi && isConsecutive && <div className="message-avatar-spacer" />}
      <div className="message-content">
        {isAi && !isConsecutive && meta && (
          <span className="message-sender" style={{ color: meta.color }}>
            {meta.display_name}
          </span>
        )}
        <div
          className={`message-bubble ${isUser ? "message-bubble--user" : "message-bubble--ai"}`}
          style={isAi && meta ? { borderColor: meta.color + "30" } : undefined}
        >
          {message.content}
        </div>
        {!isConsecutive && (
          <span className="message-time">
            {formatRelativeTime(message.created_at)}
          </span>
        )}
      </div>
    </div>
  );
}

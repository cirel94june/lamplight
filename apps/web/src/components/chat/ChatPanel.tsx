import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types/chat.js";
import { MessageBubble } from "./MessageBubble.js";
import { TypingIndicator } from "./TypingIndicator.js";
import { ChatInput } from "./ChatInput.js";

interface Props {
  roomName: string;
  messages: ChatMessage[];
  typingAgents: Set<string>;
  hasMore: boolean;
  loading: boolean;
  onSend: (content: string) => void;
  onLoadMore: () => void;
  onClose: () => void;
  getAvatarUrl?: (agentId: string) => string | undefined;
}

export function ChatPanel({
  roomName,
  messages,
  typingAgents,
  hasMore,
  loading,
  onSend,
  onLoadMore,
  onClose,
  getAvatarUrl,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevLenRef = useRef(messages.length);

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typingAgents.size, autoScroll]);

  useEffect(() => {
    if (messages.length > prevLenRef.current && autoScroll) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevLenRef.current = messages.length;
  }, [messages.length, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAutoScroll(atBottom);
  }, []);

  const isConsecutive = (msg: ChatMessage, idx: number): boolean => {
    if (idx === 0) return false;
    const prev = messages[idx - 1];
    return prev.sender.type === msg.sender.type && prev.sender.ai_id === msg.sender.ai_id;
  };

  const isNew = (idx: number): boolean => {
    return idx >= prevLenRef.current - 1 && prevLenRef.current > 1;
  };

  const typingIds = Array.from(typingAgents);

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-header-title">{roomName}</span>
        <button className="chat-close-btn" onClick={onClose} aria-label="关闭聊天">
          ×
        </button>
      </div>

      <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
        {hasMore && (
          <button className="chat-load-more" onClick={onLoadMore} disabled={loading}>
            {loading ? "加载中…" : "加载更多"}
          </button>
        )}
        {messages.map((msg, i) => {
          const aiId = msg.sender.type === "ai" ? msg.sender.ai_id : undefined;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isConsecutive={isConsecutive(msg, i)}
              isNew={isNew(i)}
              avatarUrl={aiId && getAvatarUrl ? getAvatarUrl(aiId) : undefined}
            />
          );
        })}
        <TypingIndicator agentIds={typingIds} />
      </div>

      <ChatInput onSend={onSend} disabled={loading && messages.length === 0} />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types/chat.js";
import { mergeMessages } from "./merge.js";

export function useChat(conversationId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingAgents, setTypingAgents] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const convIdRef = useRef(conversationId);
  convIdRef.current = conversationId;

  useEffect(() => {
    setMessages([]);
    setTypingAgents(new Set());
    setHasMore(false);
    nextCursorRef.current = null;
    loadMoreAbortRef.current?.abort();

    if (!conversationId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    fetch(`/api/conversations/${conversationId}/messages?limit=50`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((body) => {
        if (controller.signal.aborted) return;
        if (body.ok) {
          const fetched: ChatMessage[] = body.data.slice().reverse();
          setMessages((prev) => mergeMessages(prev, fetched));
          nextCursorRef.current = body.next_cursor;
          setHasMore(!!body.next_cursor);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[useChat] fetch failed:", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    const id = convIdRef.current;
    const cursor = nextCursorRef.current;
    if (!id || !cursor || loading) return;

    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;

    try {
      const res = await fetch(
        `/api/conversations/${id}/messages?limit=50&cursor=${cursor}`,
        { signal: controller.signal },
      );
      const body = await res.json();
      if (controller.signal.aborted || id !== convIdRef.current) return;
      if (body.ok) {
        const older: ChatMessage[] = body.data.slice().reverse();
        setMessages((prev) => mergeMessages(older, prev));
        nextCursorRef.current = body.next_cursor;
        setHasMore(!!body.next_cursor);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[useChat] loadMore failed:", err);
    }
  }, [loading]);

  const sendMessage = useCallback(
    async (content: string, mentionedAgentIds?: string[]) => {
      const id = convIdRef.current;
      if (!id || !content.trim()) return;

      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          ...(mentionedAgentIds?.length ? { mentioned_agent_ids: mentionedAgentIds } : {}),
        }),
      });
      const body = await res.json();
      if (id !== convIdRef.current) return;
      if (body.ok) {
        setMessages((prev) => mergeMessages(prev, [body.data]));
      }
    },
    [],
  );

  const handleNewMessage = useCallback(
    (data: Record<string, unknown>) => {
      const msg = data as unknown as ChatMessage;
      if (msg.conversation_id !== convIdRef.current) return;
      setMessages((prev) => mergeMessages(prev, [msg]));
      if (msg.sender.type === "ai" && msg.sender.ai_id) {
        setTypingAgents((prev) => {
          const next = new Set(prev);
          next.delete(msg.sender.ai_id!);
          return next;
        });
      }
    },
    [],
  );

  const handleTyping = useCallback(
    (data: Record<string, unknown>) => {
      const { conversation_id, agent_id } = data as {
        conversation_id: string;
        agent_id: string;
      };
      if (conversation_id !== convIdRef.current) return;
      setTypingAgents((prev) => {
        if (prev.has(agent_id)) return prev;
        return new Set(prev).add(agent_id);
      });
    },
    [],
  );

  const handleDone = useCallback(
    (data: Record<string, unknown>) => {
      const { conversation_id, agent_id } = data as {
        conversation_id: string;
        agent_id: string;
      };
      if (conversation_id !== convIdRef.current) return;
      setTypingAgents((prev) => {
        if (!prev.has(agent_id)) return prev;
        const next = new Set(prev);
        next.delete(agent_id);
        return next;
      });
    },
    [],
  );

  return {
    messages,
    typingAgents,
    hasMore,
    loading,
    sendMessage,
    loadMore,
    handleNewMessage,
    handleTyping,
    handleDone,
  };
}

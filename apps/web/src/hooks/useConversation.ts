import { useEffect, useRef, useState } from "react";
import type { ConversationInfo } from "../types/chat.js";

export function useConversation(sceneId: string | null) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sceneId) {
      setConversationId(null);
      setConversation(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    fetch(`/api/scenes/${sceneId}/conversation`, { signal: controller.signal })
      .then((r) => r.json())
      .then((body) => {
        if (controller.signal.aborted) return;
        if (body.ok) {
          setConversation(body.data);
          setConversationId(body.data.id);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[useConversation] fetch failed:", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [sceneId]);

  return { conversationId, conversation, loading };
}

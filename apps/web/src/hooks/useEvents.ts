import { useCallback, useEffect, useState } from "react";
import { mergeEvents } from "./merge.js";

export interface HouseEventItem {
  id: string;
  type: string;
  actor: { type: string; ai_id?: string };
  scene_id?: string;
  payload: unknown;
  description?: string;
  context: { context_type: string; set_by: string };
  conversation_kind: string;
  created_at: string;
}

export function useEvents() {
  const [events, setEvents] = useState<HouseEventItem[]>([]);

  useEffect(() => {
    fetch("/api/house-events?limit=50")
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) {
          setEvents((prev) => mergeEvents(prev, body.data));
        }
      });
  }, []);

  const prependEvent = useCallback((event: HouseEventItem) => {
    setEvents((prev) => mergeEvents(prev, [event]));
  }, []);

  return { events, prependEvent };
}

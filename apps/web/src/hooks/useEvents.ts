import { useEffect, useState } from "react";

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
    const token = import.meta.env.VITE_OWNER_TOKEN ?? "";
    fetch("/api/house-events?limit=50", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) setEvents(body.data);
      });
  }, []);

  const prependEvent = (event: HouseEventItem) => {
    setEvents((prev) => [event, ...prev].slice(0, 200));
  };

  return { events, prependEvent };
}

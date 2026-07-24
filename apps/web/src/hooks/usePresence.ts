import { useEffect, useState } from "react";
import type { Presence } from "@lamplight/contracts";

export function usePresence() {
  const [presence, setPresence] = useState<Presence[]>([]);

  useEffect(() => {
    const token = import.meta.env.VITE_OWNER_TOKEN ?? "";
    fetch("/api/presence", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) setPresence(body.data);
      });
  }, []);

  const updatePresence = (data: Presence) => {
    setPresence((prev) => {
      const idx = prev.findIndex((p) => p.ai_id === data.ai_id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = data;
        return next;
      }
      return [...prev, data];
    });
  };

  return { presence, updatePresence };
}

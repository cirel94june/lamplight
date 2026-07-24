import { useCallback, useEffect, useState } from "react";
import { mergePresence } from "./merge.js";
import type { Presence } from "@lamplight/contracts";

export function usePresence() {
  const [presence, setPresence] = useState<Presence[]>([]);

  useEffect(() => {
    fetch("/api/presence")
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) {
          setPresence((prev) => mergePresence(prev, body.data));
        }
      });
  }, []);

  const updatePresence = useCallback((data: Presence) => {
    setPresence((prev) => mergePresence(prev, [data]));
  }, []);

  return { presence, updatePresence };
}

import { useEffect, useState } from "react";
import type { SceneDefinition } from "@lamplight/contracts";

export function useScenes() {
  const [scenes, setScenes] = useState<SceneDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/scenes")
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) setScenes(body.data);
      })
      .finally(() => setLoading(false));
  }, []);

  return { scenes, loading };
}

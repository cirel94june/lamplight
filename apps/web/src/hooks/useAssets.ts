import { useCallback, useEffect, useState } from "react";

const EXTENSIONS = ["png", "jpg", "webp", "svg"];

async function probeUrl(base: string, id: string): Promise<string | null> {
  for (const ext of EXTENSIONS) {
    const url = `/assets/${base}/${id}.${ext}`;
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return url;
    } catch {
      /* skip */
    }
  }
  return null;
}

export function useAssets() {
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const getAvatarUrl = useCallback(
    (agentId: string): string | undefined => avatarUrls[agentId],
    [avatarUrls],
  );

  useEffect(() => {
    const agentIds = ["xiaoke", "lucien", "jasper", "therapist"];
    let cancelled = false;
    Promise.all(agentIds.map((id) => probeUrl("avatars", id).then((url) => [id, url] as const)))
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const [id, url] of results) {
          if (url) map[id] = url;
        }
        setAvatarUrls(map);
      });
    return () => { cancelled = true; };
  }, [version]);

  const uploadAsset = useCallback(
    async (type: string, id: string, file: File): Promise<string> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/assets/${type}/${id}`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error?.message ?? "upload failed");
      refresh();
      return body.data.url;
    },
    [refresh],
  );

  const deleteAsset = useCallback(
    async (type: string, id: string): Promise<void> => {
      const res = await fetch(`/api/assets/${type}/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error?.message ?? "delete failed");
      refresh();
    },
    [refresh],
  );

  return { getAvatarUrl, uploadAsset, deleteAsset, refresh };
}

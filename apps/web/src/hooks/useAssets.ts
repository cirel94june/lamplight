import { useCallback, useEffect, useState } from "react";

export function useAssets() {
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const [roomUrls, setRoomUrls] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const getAvatarUrl = useCallback(
    (agentId: string): string | undefined => avatarUrls[agentId],
    [avatarUrls],
  );

  const getRoomImageUrl = useCallback(
    (sceneId: string): string | undefined => roomUrls[sceneId],
    [roomUrls],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [avatarRes, roomRes] = await Promise.all([
          fetch("/api/assets/avatars"),
          fetch("/api/assets/rooms"),
        ]);
        const [avatarBody, roomBody] = await Promise.all([
          avatarRes.json(),
          roomRes.json(),
        ]);
        if (cancelled) return;
        if (avatarBody.ok) setAvatarUrls(avatarBody.data);
        if (roomBody.ok) setRoomUrls(roomBody.data);
      } catch {
        /* API not available */
      }
    }

    load();
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

  return { getAvatarUrl, getRoomImageUrl, uploadAsset, deleteAsset, refresh };
}

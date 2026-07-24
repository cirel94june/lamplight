import type { Presence } from "@lamplight/contracts";
import type { HouseEventItem } from "./useEvents.js";

const MAX_EVENTS = 200;

export function mergeEvents(
  existing: HouseEventItem[],
  incoming: HouseEventItem[],
): HouseEventItem[] {
  const seen = new Map<string, HouseEventItem>();
  for (const e of existing) seen.set(e.id, e);
  for (const e of incoming) seen.set(e.id, e);
  return [...seen.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, MAX_EVENTS);
}

export function mergePresence(
  existing: Presence[],
  incoming: Presence[],
): Presence[] {
  const byAi = new Map<string, Presence>();
  for (const p of existing) byAi.set(p.ai_id, p);
  for (const p of incoming) {
    const current = byAi.get(p.ai_id);
    if (!current || new Date(p.updated_at).getTime() >= new Date(current.updated_at).getTime()) {
      byAi.set(p.ai_id, p);
    }
  }
  return [...byAi.values()];
}

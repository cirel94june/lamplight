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
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
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
    if (!current || p.updated_at >= current.updated_at) {
      byAi.set(p.ai_id, p);
    }
  }
  return [...byAi.values()];
}

import { describe, it, expect } from "vitest";
import { mergeEvents, mergePresence } from "../../web/src/hooks/merge.js";
import type { HouseEventItem } from "../../web/src/hooks/useEvents.js";

function makeEvent(id: string, created_at: string): HouseEventItem {
  return {
    id,
    type: "room_enter",
    actor: { type: "ai", ai_id: "xiaoke" },
    scene_id: "room-living-room",
    payload: {},
    description: `event ${id}`,
    context: { context_type: "out_of_world", set_by: "server" },
    conversation_kind: "house_chat",
    created_at,
  };
}

function makePresence(ai_id: string, scene_id: string, updated_at: string) {
  return { ai_id, scene_id, state: "active" as const, updated_at };
}

describe("mergeEvents", () => {
  it("deduplicates by id", () => {
    const e1 = makeEvent("e1", "2026-07-24T01:00:00Z");
    const e1dup = makeEvent("e1", "2026-07-24T01:00:00Z");
    const e2 = makeEvent("e2", "2026-07-24T01:01:00Z");

    const result = mergeEvents([e1, e2], [e1dup]);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("sorts newest first", () => {
    const e1 = makeEvent("e1", "2026-07-24T01:00:00Z");
    const e2 = makeEvent("e2", "2026-07-24T02:00:00Z");
    const e3 = makeEvent("e3", "2026-07-24T01:30:00Z");

    const result = mergeEvents([], [e1, e2, e3]);
    expect(result.map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
  });

  it("WS event arriving before REST snapshot is not duplicated", () => {
    const wsEvent = makeEvent("e1", "2026-07-24T02:00:00Z");
    const restSnapshot = [
      makeEvent("e1", "2026-07-24T02:00:00Z"),
      makeEvent("e2", "2026-07-24T01:00:00Z"),
    ];

    const result = mergeEvents([wsEvent], restSnapshot);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("REST snapshot arriving after multiple WS events merges correctly", () => {
    const ws1 = makeEvent("e3", "2026-07-24T03:00:00Z");
    const ws2 = makeEvent("e4", "2026-07-24T04:00:00Z");
    const rest = [
      makeEvent("e1", "2026-07-24T01:00:00Z"),
      makeEvent("e2", "2026-07-24T02:00:00Z"),
      makeEvent("e3", "2026-07-24T03:00:00Z"),
    ];

    const result = mergeEvents([ws2, ws1], rest);
    expect(result).toHaveLength(4);
    expect(result.map((e) => e.id)).toEqual(["e4", "e3", "e2", "e1"]);
  });

  it("caps at 200 events", () => {
    const events = Array.from({ length: 210 }, (_, i) =>
      makeEvent(`e${i}`, `2026-07-24T${String(i).padStart(2, "0")}:00:00Z`),
    );
    const result = mergeEvents([], events);
    expect(result).toHaveLength(200);
  });
});

describe("mergePresence", () => {
  it("keeps newer update when WS arrives before REST", () => {
    const wsUpdate = makePresence("xiaoke", "room-study", "2026-07-24T02:00:00Z");
    const restSnapshot = [
      makePresence("xiaoke", "room-living-room", "2026-07-24T01:00:00Z"),
      makePresence("lucien", "room-study", "2026-07-24T01:30:00Z"),
    ];

    const result = mergePresence([wsUpdate], restSnapshot);
    const xiaoke = result.find((p) => p.ai_id === "xiaoke")!;
    expect(xiaoke.scene_id).toBe("room-study");
    expect(xiaoke.updated_at).toBe("2026-07-24T02:00:00Z");
    expect(result).toHaveLength(2);
  });

  it("keeps newer update when REST arrives before WS", () => {
    const restSnapshot = [
      makePresence("xiaoke", "room-living-room", "2026-07-24T01:00:00Z"),
    ];
    const wsUpdate = makePresence("xiaoke", "room-study", "2026-07-24T02:00:00Z");

    const result = mergePresence(restSnapshot, [wsUpdate]);
    const xiaoke = result.find((p) => p.ai_id === "xiaoke")!;
    expect(xiaoke.scene_id).toBe("room-study");
  });

  it("rejects stale REST data that arrives after a newer WS update", () => {
    const wsUpdate = makePresence("xiaoke", "room-study", "2026-07-24T02:00:00Z");
    const staleRest = [
      makePresence("xiaoke", "room-living-room", "2026-07-24T01:00:00Z"),
    ];

    const result = mergePresence([wsUpdate], staleRest);
    const xiaoke = result.find((p) => p.ai_id === "xiaoke")!;
    expect(xiaoke.scene_id).toBe("room-study");
    expect(xiaoke.updated_at).toBe("2026-07-24T02:00:00Z");
  });

  it("adds new AI from REST without affecting existing WS updates", () => {
    const wsUpdate = makePresence("xiaoke", "room-study", "2026-07-24T02:00:00Z");
    const restSnapshot = [
      makePresence("lucien", "room-counseling", "2026-07-24T01:30:00Z"),
    ];

    const result = mergePresence([wsUpdate], restSnapshot);
    expect(result).toHaveLength(2);
    expect(result.find((p) => p.ai_id === "xiaoke")!.scene_id).toBe("room-study");
    expect(result.find((p) => p.ai_id === "lucien")!.scene_id).toBe("room-counseling");
  });

  it("handles equal timestamps by taking the incoming value", () => {
    const existing = makePresence("xiaoke", "room-living-room", "2026-07-24T01:00:00Z");
    const incoming = makePresence("xiaoke", "room-study", "2026-07-24T01:00:00Z");

    const result = mergePresence([existing], [incoming]);
    const xiaoke = result.find((p) => p.ai_id === "xiaoke")!;
    expect(xiaoke.scene_id).toBe("room-study");
  });
});

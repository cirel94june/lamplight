import { describe, expect, it } from "vitest";
import {
  memoryFragmentSchema,
  privateNoteSchema,
  personContextViewSchema,
  memoryRecallRequestSchema,
} from "../src/index.js";

describe("memoryFragmentSchema", () => {
  const valid = {
    id: "mem_1",
    content: "小猫喜欢喝冰美式",
    room: "preferences",
    relevance_score: 0.85,
    created_at: "2026-07-24T10:00:00Z",
  };

  it("accepts valid fragment", () => {
    expect(memoryFragmentSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects relevance_score above 1", () => {
    expect(
      memoryFragmentSchema.safeParse({ ...valid, relevance_score: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects relevance_score below 0", () => {
    expect(
      memoryFragmentSchema.safeParse({ ...valid, relevance_score: -0.1 }).success,
    ).toBe(false);
  });

  it("rejects empty content", () => {
    expect(
      memoryFragmentSchema.safeParse({ ...valid, content: "" }).success,
    ).toBe(false);
  });
});

describe("privateNoteSchema", () => {
  const valid = {
    id: "note_1",
    ai_id: "xiaoke",
    content: "小猫今天心情不太好",
    created_at: "2026-07-24T10:00:00Z",
    updated_at: "2026-07-24T10:00:00Z",
  };

  it("accepts valid note without TTL", () => {
    expect(privateNoteSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts valid note with TTL", () => {
    expect(
      privateNoteSchema.safeParse({ ...valid, ttl_ms: 3600000 }).success,
    ).toBe(true);
  });

  it("rejects non-positive TTL", () => {
    expect(
      privateNoteSchema.safeParse({ ...valid, ttl_ms: 0 }).success,
    ).toBe(false);
  });

  it("rejects empty ai_id", () => {
    expect(
      privateNoteSchema.safeParse({ ...valid, ai_id: "" }).success,
    ).toBe(false);
  });
});

describe("personContextViewSchema", () => {
  it("accepts empty memories and notes", () => {
    expect(
      personContextViewSchema.safeParse({
        memories: [],
        private_notes: [],
      }).success,
    ).toBe(true);
  });

  it("accepts with optional recent_events_summary", () => {
    expect(
      personContextViewSchema.safeParse({
        memories: [],
        private_notes: [],
        recent_events_summary: "小猫刚进了客厅",
      }).success,
    ).toBe(true);
  });
});

describe("memoryRecallRequestSchema", () => {
  it("accepts minimal request with only agent_id", () => {
    expect(
      memoryRecallRequestSchema.safeParse({ agent_id: "xiaoke" }).success,
    ).toBe(true);
  });

  it("accepts full request", () => {
    expect(
      memoryRecallRequestSchema.safeParse({
        agent_id: "xiaoke",
        scene_id: "room-living-room",
        conversation_id: "conv_1",
        query: "小猫的生日",
        max_fragments: 10,
      }).success,
    ).toBe(true);
  });

  it("rejects empty agent_id", () => {
    expect(
      memoryRecallRequestSchema.safeParse({ agent_id: "" }).success,
    ).toBe(false);
  });
});

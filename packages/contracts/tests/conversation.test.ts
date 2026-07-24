import { describe, expect, it } from "vitest";
import {
  conversationSchema,
  contextBuildRequestSchema,
} from "../src/index.js";

describe("conversationSchema — B3 fields", () => {
  const base = {
    id: "conv_1",
    kind: "house_chat",
    participant_ai_ids: ["xiaoke", "lucien"],
    created_at: "2026-07-24T10:00:00Z",
    updated_at: "2026-07-24T10:00:00Z",
  };

  it("defaults status to active when omitted", () => {
    const result = conversationSchema.parse(base);
    expect(result.status).toBe("active");
  });

  it("accepts explicit status", () => {
    for (const status of ["active", "archived"]) {
      expect(
        conversationSchema.safeParse({ ...base, status }).success,
      ).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(
      conversationSchema.safeParse({ ...base, status: "deleted" }).success,
    ).toBe(false);
  });

  it("accepts null turn_policy", () => {
    const result = conversationSchema.parse({ ...base, turn_policy: null });
    expect(result.turn_policy).toBeNull();
  });

  it("accepts valid turn_policy", () => {
    const result = conversationSchema.parse({
      ...base,
      turn_policy: {
        policy_id: "custom",
        triggers: {
          on_user_message: "mentioned_only",
          on_agent_message: {
            mention: true,
            random: false,
            cooldown_ms: 0,
            max_consecutive: 1,
          },
        },
      },
    });
    expect(result.turn_policy?.policy_id).toBe("custom");
  });

  it("omitted turn_policy defaults to undefined", () => {
    const result = conversationSchema.parse(base);
    expect(result.turn_policy).toBeUndefined();
  });
});

describe("contextBuildRequestSchema", () => {
  it("accepts minimal request", () => {
    expect(
      contextBuildRequestSchema.safeParse({
        agent_id: "xiaoke",
        conversation_id: "conv_1",
        conversation_kind: "house_chat",
      }).success,
    ).toBe(true);
  });

  it("accepts full request", () => {
    expect(
      contextBuildRequestSchema.safeParse({
        agent_id: "xiaoke",
        conversation_id: "conv_1",
        scene_id: "room-living-room",
        conversation_kind: "house_chat",
        max_history_messages: 50,
      }).success,
    ).toBe(true);
  });

  it("rejects invalid conversation_kind", () => {
    expect(
      contextBuildRequestSchema.safeParse({
        agent_id: "xiaoke",
        conversation_id: "conv_1",
        conversation_kind: "invalid",
      }).success,
    ).toBe(false);
  });

  it("rejects empty agent_id", () => {
    expect(
      contextBuildRequestSchema.safeParse({
        agent_id: "",
        conversation_id: "conv_1",
        conversation_kind: "house_chat",
      }).success,
    ).toBe(false);
  });

  it("rejects non-positive max_history_messages", () => {
    expect(
      contextBuildRequestSchema.safeParse({
        agent_id: "xiaoke",
        conversation_id: "conv_1",
        conversation_kind: "house_chat",
        max_history_messages: 0,
      }).success,
    ).toBe(false);
  });
});

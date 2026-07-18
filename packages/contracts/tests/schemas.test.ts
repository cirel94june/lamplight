import { describe, expect, it } from "vitest";
import {
  apiResponseSchema,
  houseEventSchema,
  messageSchema,
  presenceSchema,
  worldStateSchema,
} from "../src/index.js";

describe("ApiResponse 包裹", () => {
  it("成功/失败两种形态都能判别", () => {
    const wrapped = apiResponseSchema(presenceSchema);
    expect(
      wrapped.safeParse({
        ok: true,
        data: {
          ai_id: "lucien",
          scene_id: "study",
          state: "active",
          updated_at: "2026-07-17T12:00:00Z",
        },
      }).success
    ).toBe(true);
    expect(
      wrapped.safeParse({
        ok: false,
        error: { code: "NOT_FOUND", message: "no such ai" },
      }).success
    ).toBe(true);
    expect(wrapped.safeParse({ ok: true }).success).toBe(false);
  });
});

describe("HouseEvent / Message 必须携带语境", () => {
  it("缺 context 的 HouseEvent 不合法", () => {
    expect(
      houseEventSchema.safeParse({
        id: "ev_1",
        type: "scene_entered",
        actor: { type: "ai", ai_id: "jasper" },
        payload: { scene_id: "game_room" },
        conversation_kind: "system",
        created_at: "2026-07-17T12:00:00Z",
      }).success
    ).toBe(false);
  });

  it("缺 context 的 Message 不合法", () => {
    expect(
      messageSchema.safeParse({
        id: "msg_1",
        conversation_id: "conv_1",
        conversation_kind: "house_chat",
        sender: { type: "user" },
        content: "hello",
        created_at: "2026-07-17T12:00:00Z",
      }).success
    ).toBe(false);
  });
});

describe("Message / HouseEvent 的语境组合校验（schema 内置，不靠调用方自觉）", () => {
  const baseMessage = {
    id: "msg_1",
    conversation_id: "conv_1",
    conversation_kind: "house_chat",
    sender: { type: "user" },
    content: "hello",
    context: { context_type: "out_of_world", set_by: "server" },
    created_at: "2026-07-17T12:00:00Z",
  } as const;

  it("house_chat + out_of_world + world_id 被 Message schema 拒绝", () => {
    expect(
      messageSchema.safeParse({
        ...baseMessage,
        context: { context_type: "out_of_world", world_id: "w1", set_by: "server" },
      }).success
    ).toBe(false);
    expect(messageSchema.safeParse(baseMessage).success).toBe(true);
  });

  it("game_discussion 例外：out_of_world 可带 world_id", () => {
    expect(
      messageSchema.safeParse({
        ...baseMessage,
        conversation_kind: "game_discussion",
        context: { context_type: "out_of_world", world_id: "w1", set_by: "server" },
      }).success
    ).toBe(true);
  });

  it("in_world 消息只许出现在 game_world 对话", () => {
    const inWorld = {
      context_type: "in_world",
      world_id: "w1",
      session_id: "s1",
      branch_id: "b1",
      set_by: "server",
    } as const;
    expect(
      messageSchema.safeParse({ ...baseMessage, context: inWorld }).success
    ).toBe(false);
    expect(
      messageSchema.safeParse({
        ...baseMessage,
        conversation_kind: "game_world",
        context: inWorld,
      }).success
    ).toBe(true);
  });

  it("house_chat + out_of_world + world_id 被 HouseEvent schema 拒绝", () => {
    const baseEvent = {
      id: "ev_1",
      type: "scene_entered",
      actor: { type: "ai", ai_id: "jasper" },
      payload: { scene_id: "game_room" },
      conversation_kind: "house_chat",
      context: { context_type: "out_of_world", set_by: "server" },
      created_at: "2026-07-17T12:00:00Z",
    } as const;
    expect(houseEventSchema.safeParse(baseEvent).success).toBe(true);
    expect(
      houseEventSchema.safeParse({
        ...baseEvent,
        context: { context_type: "out_of_world", world_id: "w1", set_by: "server" },
      }).success
    ).toBe(false);
  });
});

describe("WorldState 浅 schema（围栏一）", () => {
  it("只允许五个顶层键", () => {
    const valid = {
      characters: {},
      locations: {},
      items: {},
      threads: {},
      rules: {},
    };
    expect(worldStateSchema.safeParse(valid).success).toBe(true);
    expect(
      worldStateSchema.safeParse({ ...valid, diplomacy: {} }).success
    ).toBe(false);
  });
});

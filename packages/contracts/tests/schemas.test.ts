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
        sender: { type: "user" },
        content: "hello",
        created_at: "2026-07-17T12:00:00Z",
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

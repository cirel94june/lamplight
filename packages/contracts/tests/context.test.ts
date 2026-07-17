import { describe, expect, it } from "vitest";
import {
  contextEnvelopeSchema,
  validateContextForKind,
  type ContextEnvelope,
} from "../src/index.js";

const outOfWorld: ContextEnvelope = {
  context_type: "out_of_world",
  set_by: "server",
};

describe("ContextEnvelope", () => {
  it("set_by 只允许 server（钉子 #3：模型/客户端提交的值一律忽略覆盖）", () => {
    expect(
      contextEnvelopeSchema.safeParse({ context_type: "out_of_world", set_by: "model" })
        .success
    ).toBe(false);
    expect(contextEnvelopeSchema.safeParse(outOfWorld).success).toBe(true);
  });

  it("in_world 必须三 ID 齐全", () => {
    expect(
      contextEnvelopeSchema.safeParse({
        context_type: "in_world",
        world_id: "w1",
        session_id: "s1",
        set_by: "server",
      }).success
    ).toBe(false);

    expect(
      contextEnvelopeSchema.safeParse({
        context_type: "in_world",
        world_id: "w1",
        session_id: "s1",
        branch_id: "b1",
        set_by: "server",
      }).success
    ).toBe(true);
  });

  it("out_of_world 不得携带世界 ID——house_chat 拒绝，game_discussion 例外", () => {
    const withWorld: ContextEnvelope = {
      context_type: "out_of_world",
      world_id: "w1",
      set_by: "server",
    };
    expect(validateContextForKind(withWorld, "house_chat")).not.toHaveLength(0);
    expect(validateContextForKind(withWorld, "game_discussion")).toHaveLength(0);
    expect(validateContextForKind(outOfWorld, "house_chat")).toHaveLength(0);
  });

  it("in_world 只允许出现在 game_world 对话中", () => {
    const inWorld: ContextEnvelope = {
      context_type: "in_world",
      world_id: "w1",
      session_id: "s1",
      branch_id: "b1",
      set_by: "server",
    };
    expect(validateContextForKind(inWorld, "game_world")).toHaveLength(0);
    expect(validateContextForKind(inWorld, "house_chat")).not.toHaveLength(0);
  });
});

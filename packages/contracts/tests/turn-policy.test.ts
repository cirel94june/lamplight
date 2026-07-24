import { describe, expect, it } from "vitest";
import {
  agentChainTriggerSchema,
  turnPolicySchema,
  turnEvaluationSchema,
} from "../src/index.js";

describe("agentChainTriggerSchema", () => {
  const valid = {
    on_user_message: "all_present",
    on_agent_message: {
      mention: true,
      random: false,
      cooldown_ms: 5000,
      max_consecutive: 2,
    },
  };

  it("accepts valid trigger config", () => {
    expect(agentChainTriggerSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts all on_user_message values", () => {
    for (const v of ["all_present", "mentioned_only", "none"]) {
      expect(
        agentChainTriggerSchema.safeParse({ ...valid, on_user_message: v }).success,
      ).toBe(true);
    }
  });

  it("rejects invalid on_user_message value", () => {
    expect(
      agentChainTriggerSchema.safeParse({ ...valid, on_user_message: "some" }).success,
    ).toBe(false);
  });

  it("rejects negative cooldown_ms", () => {
    expect(
      agentChainTriggerSchema.safeParse({
        ...valid,
        on_agent_message: { ...valid.on_agent_message, cooldown_ms: -1 },
      }).success,
    ).toBe(false);
  });

  it("rejects zero max_consecutive", () => {
    expect(
      agentChainTriggerSchema.safeParse({
        ...valid,
        on_agent_message: { ...valid.on_agent_message, max_consecutive: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("turnPolicySchema", () => {
  const valid = {
    policy_id: "living-room-default",
    triggers: {
      on_user_message: "all_present",
      on_agent_message: {
        mention: true,
        random: true,
        cooldown_ms: 5000,
        max_consecutive: 3,
      },
    },
  };

  it("accepts valid policy", () => {
    expect(turnPolicySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty policy_id", () => {
    expect(turnPolicySchema.safeParse({ ...valid, policy_id: "" }).success).toBe(false);
  });
});

describe("turnEvaluationSchema", () => {
  const valid = {
    conversation_id: "conv_1",
    trigger_message_id: "msg_1",
    eligible_agent_ids: ["xiaoke", "lucien"],
    reason: "on_user_message: all_present",
    evaluated_at: "2026-07-24T10:00:00Z",
  };

  it("accepts valid evaluation", () => {
    expect(turnEvaluationSchema.safeParse(valid).success).toBe(true);
  });

  it("allows empty eligible_agent_ids", () => {
    expect(
      turnEvaluationSchema.safeParse({ ...valid, eligible_agent_ids: [] }).success,
    ).toBe(true);
  });

  it("rejects missing reason", () => {
    const { reason, ...rest } = valid;
    expect(turnEvaluationSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects non-datetime evaluated_at", () => {
    expect(
      turnEvaluationSchema.safeParse({ ...valid, evaluated_at: "not-a-date" }).success,
    ).toBe(false);
  });
});

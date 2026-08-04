import { describe, expect, it } from "vitest";
import {
  agentChainTriggerSchema,
  turnPolicySchema,
  turnEvaluationSchema,
  selfChatLimitsSchema,
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
    for (const v of ["all_present", "mentioned_only", "speaker_selection", "none"]) {
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

  it("defaults reply_mode to sequential when omitted", () => {
    const result = turnPolicySchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reply_mode).toBe("sequential");
    }
  });

  it("accepts concurrent reply_mode", () => {
    const result = turnPolicySchema.safeParse({ ...valid, reply_mode: "concurrent" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reply_mode).toBe("concurrent");
    }
  });

  it("accepts sequential reply_mode", () => {
    const result = turnPolicySchema.safeParse({ ...valid, reply_mode: "sequential" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reply_mode).toBe("sequential");
    }
  });

  it("rejects invalid reply_mode", () => {
    expect(
      turnPolicySchema.safeParse({ ...valid, reply_mode: "round_robin" }).success,
    ).toBe(false);
  });

  it("accepts speaker_selection on_user_message", () => {
    const result = turnPolicySchema.safeParse({
      ...valid,
      triggers: { ...valid.triggers, on_user_message: "speaker_selection" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts self_chat_limits", () => {
    const result = turnPolicySchema.safeParse({
      ...valid,
      self_chat_limits: {
        per_agent_max_per_minute: 4,
        max_agent_rounds_without_user: 3,
        max_total_messages: 50,
      },
    });
    expect(result.success).toBe(true);
  });

  it("self_chat_limits defaults to safe values when omitted", () => {
    const result = turnPolicySchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.self_chat_limits).toEqual({
        per_agent_max_per_minute: 4,
        max_agent_rounds_without_user: 3,
        max_total_messages: 50,
      });
    }
  });
});

describe("selfChatLimitsSchema", () => {
  it("provides defaults for all fields", () => {
    const result = selfChatLimitsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.per_agent_max_per_minute).toBe(4);
      expect(result.data.max_agent_rounds_without_user).toBe(3);
      expect(result.data.max_total_messages).toBe(50);
    }
  });

  it("rejects non-positive per_agent_max_per_minute", () => {
    expect(
      selfChatLimitsSchema.safeParse({ per_agent_max_per_minute: 0 }).success,
    ).toBe(false);
  });

  it("allows zero max_agent_rounds_without_user (no agent chaining)", () => {
    const result = selfChatLimitsSchema.safeParse({ max_agent_rounds_without_user: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive max_total_messages", () => {
    expect(
      selfChatLimitsSchema.safeParse({ max_total_messages: 0 }).success,
    ).toBe(false);
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

import { describe, expect, it } from "vitest";
import {
  agentProfileSchema,
  channelBindingSchema,
  modelConfigSchema,
} from "../src/index.js";

describe("ModelConfig", () => {
  it("合法配置能通过", () => {
    expect(
      modelConfigSchema.safeParse({
        provider_id: "anthropic",
        model_id: "claude-opus-4-6",
      }).success
    ).toBe(true);
  });

  it("provider_id / model_id 不接受空字符串", () => {
    expect(
      modelConfigSchema.safeParse({ provider_id: "", model_id: "gpt-4o" })
        .success
    ).toBe(false);
    expect(
      modelConfigSchema.safeParse({ provider_id: "openai", model_id: "" })
        .success
    ).toBe(false);
  });
});

const validProfile = {
  agent_id: "cloudy",
  display_name: "小克",
  model_config: { provider_id: "anthropic", model_id: "claude-opus-4-6" },
  memory_scope: "cloudy",
} as const;

describe("AgentProfile", () => {
  it("最小合法 profile 能通过（可选字段省略）", () => {
    expect(agentProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  it("带可选字段能通过", () => {
    expect(
      agentProfileSchema.safeParse({
        ...validProfile,
        tool_policy_id: "default",
        prompt_version: "v3.2",
      }).success
    ).toBe(true);
  });

  it("agent_id 不接受空字符串", () => {
    expect(
      agentProfileSchema.safeParse({ ...validProfile, agent_id: "" }).success
    ).toBe(false);
  });

  it("可选字段不接受空字符串", () => {
    expect(
      agentProfileSchema.safeParse({
        ...validProfile,
        tool_policy_id: "",
      }).success
    ).toBe(false);
    expect(
      agentProfileSchema.safeParse({
        ...validProfile,
        prompt_version: "",
      }).success
    ).toBe(false);
  });

  it("model_config 必填", () => {
    const { model_config, ...rest } = validProfile;
    expect(agentProfileSchema.safeParse(rest).success).toBe(false);
  });
});

describe("ChannelBinding", () => {
  it("合法 binding 能通过", () => {
    expect(
      channelBindingSchema.safeParse({
        agent_id: "cloudy",
        channel: "telegram",
        external_id: "cloudy_bot",
      }).success
    ).toBe(true);
  });

  it("channel 只接受已定义的渠道", () => {
    expect(
      channelBindingSchema.safeParse({
        agent_id: "cloudy",
        channel: "discord",
        external_id: "abc",
      }).success
    ).toBe(false);
  });

  it("external_id 不接受空字符串", () => {
    expect(
      channelBindingSchema.safeParse({
        agent_id: "cloudy",
        channel: "telegram",
        external_id: "",
      }).success
    ).toBe(false);
  });

  it("两种渠道类型均合法", () => {
    for (const ch of ["telegram", "lamplight_web"]) {
      expect(
        channelBindingSchema.safeParse({
          agent_id: "lucien",
          channel: ch,
          external_id: `${ch}_id`,
        }).success
      ).toBe(true);
    }
  });
});

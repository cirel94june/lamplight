import { z } from "zod";

/**
 * Agent 身份与模型解耦（v2.1 §2a）。
 * 小克不是 Claude Opus，小克是小克。agent_id 是稳定身份，model_config 可换。
 */

export const modelConfigSchema = z.object({
  /** provider 标识：anthropic / openai / google / deepseek / custom */
  provider_id: z.string().min(1),
  /** 模型 ID：claude-opus-4-6 / gpt-4o / gemini-2.5-pro 等 */
  model_id: z.string().min(1),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const agentProfileSchema = z.object({
  /** 稳定标识，全系统唯一：cloudy / lucien / jasper */
  agent_id: z.string().min(1),
  /** 展示名 */
  display_name: z.string().min(1),
  /** 当前使用的模型——可换，身份不变 */
  model_config: modelConfigSchema,
  /** Hub 侧记忆隔离范围（对应 Hub 的 memory scope / AI identity） */
  memory_scope: z.string().min(1),
  /** 指向工具权限配置 */
  tool_policy_id: z.string().min(1).optional(),
  /** 排查用：当前 prompt 模板版本号 */
  prompt_version: z.string().min(1).optional(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

/**
 * Channel Binding：平台 bot ID 到 agent_id 的映射（v2.1 §2b）。
 * 内部始终使用稳定 agent_id，external_id 语义由 channel 决定：
 * - telegram: bot username（如 "cloudy_bot"）
 * - lamplight_web: 固定实例标识（如 "lamplight-web-v1"），不填 session ID
 */
export const channelBindingSchema = z.object({
  agent_id: z.string().min(1),
  /** 渠道类型 */
  channel: z.enum(["telegram", "lamplight_web"]),
  /** 渠道侧的外部标识，语义由 channel 决定 */
  external_id: z.string().min(1),
});
export type ChannelBinding = z.infer<typeof channelBindingSchema>;

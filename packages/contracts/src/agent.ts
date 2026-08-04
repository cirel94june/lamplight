import { z } from "zod";

/**
 * Agent 身份与模型解耦（v2.1 §2a）。
 * 小克不是 Claude Opus，小克是小克。agent_id 是稳定身份，model_config 可换。
 */

export const modelConfigSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  api_provider_id: z.string().min(1),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const agentModelBindingSchema = z.object({
  agent_id: z.string().min(1),
  api_provider_id: z.string().min(1),
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  timeout_ms: z.number().int().positive().optional(),
  retry_max: z.number().int().nonnegative().optional(),
  fault_state: z.enum(["ok", "degraded", "offline"]).optional(),
});
export type AgentModelBinding = z.infer<typeof agentModelBindingSchema>;

export const agentProfileSchema = z.object({
  agent_id: z.string().min(1),
  display_name: z.string().min(1),
  memory_scope: z.string().min(1),
  tool_policy_id: z.string().min(1).optional(),
  prompt_version: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  trigger_keywords: z.array(z.string().min(1)).optional(),
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

/**
 * AgentRuntimeConfig：运行时行为参数，与身份（AgentProfile）分离。
 * random_reply_affinity 控制 AI 在多人房间中被 TurnEvaluator 选中随机回复的概率权重。
 */
export const agentRuntimeConfigSchema = z.object({
  agent_id: z.string().min(1),
  random_reply_affinity: z.number().min(0).max(1),
  max_response_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  system_prompt_template: z.string().min(1).optional(),
});
export type AgentRuntimeConfig = z.infer<typeof agentRuntimeConfigSchema>;

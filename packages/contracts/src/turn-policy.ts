import { z } from "zod";

/**
 * TurnPolicy：发言人选择 + 自聊防护 + 回复模式。
 * 决定"用户发了一条消息后，哪些 AI 应该回复"以及"AI 回复后，其他 AI 是否跟进"。
 */

export const selfChatLimitsSchema = z.object({
  per_agent_max_per_minute: z.number().int().positive().default(4),
  max_agent_rounds_without_user: z.number().int().nonnegative().default(3),
  max_total_messages: z.number().int().positive().default(50),
  max_total_tokens: z.number().int().positive().optional(),
});
export type SelfChatLimits = z.infer<typeof selfChatLimitsSchema>;

export const agentChainTriggerSchema = z.object({
  on_user_message: z.enum(["all_present", "mentioned_only", "speaker_selection", "none"]),
  on_agent_message: z.object({
    mention: z.boolean(),
    random: z.boolean(),
    cooldown_ms: z.number().int().nonnegative(),
    max_consecutive: z.number().int().positive(),
  }),
});
export type AgentChainTrigger = z.infer<typeof agentChainTriggerSchema>;

export const turnPolicySchema = z.object({
  policy_id: z.string().min(1),
  triggers: agentChainTriggerSchema,
  reply_mode: z.enum(["concurrent", "sequential"]).default("sequential"),
  self_chat_limits: selfChatLimitsSchema.optional(),
});
export type TurnPolicy = z.infer<typeof turnPolicySchema>;

export const turnEvaluationSchema = z.object({
  conversation_id: z.string().min(1),
  trigger_message_id: z.string().min(1),
  eligible_agent_ids: z.array(z.string().min(1)),
  reason: z.string().min(1),
  evaluated_at: z.string().datetime(),
});
export type TurnEvaluation = z.infer<typeof turnEvaluationSchema>;

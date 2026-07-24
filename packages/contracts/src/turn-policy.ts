import { z } from "zod";

/**
 * TurnPolicy：三层评估链路的规则定义（Resident → Presence → Participant）。
 * 决定"用户发了一条消息后，哪些 AI 应该回复"以及"AI 回复后，其他 AI 是否跟进"。
 */

export const agentChainTriggerSchema = z.object({
  on_user_message: z.enum(["all_present", "mentioned_only", "none"]),
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

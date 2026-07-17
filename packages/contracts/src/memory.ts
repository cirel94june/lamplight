import { z } from "zod";
import {
  claimTypeSchema,
  conversationKindSchema,
  proposalStatusSchema,
  recallPolicySchema,
  speechModeSchema,
  visibilitySchema,
} from "./enums.js";

/** 敏感度双字段设计：visibility + recall_policy，不设第四档。 */
export const sensitivitySchema = z.object({
  visibility: visibilitySchema,
  recall_policy: recallPolicySchema,
});
export type Sensitivity = z.infer<typeof sensitivitySchema>;

/**
 * MemoryProposal：记忆申请表（Track A 的心脏）。
 * 小模型不能直接写正式记忆库，只能填这张表；claim_type 是灵魂字段——
 * fact（你亲口说的）/ observation（AI 看到的）/ hypothesis（AI 猜的），
 * 三种类型走三种完全不同的待遇（阈值、去向、召回策略），逻辑接入见施工单第 2 项。
 *
 * 🔩 钉子 #4：source_message_ids + evidence_excerpt 是证据要求——
 * 审核时不该翻完整个线程才知道自己说没说过。
 */
export const memoryProposalSchema = z
  .object({
    id: z.string(),
    content: z.string().min(1),
    claim_type: claimTypeSchema,
    speech_mode: speechModeSchema,
    /** 来源容器（语境三件套之二）。 */
    conversation_kind: conversationKindSchema,
    /** 主题分类（去哪个房间）。 */
    proposed_room: z.string(),
    /** 发生场所——只是分类先验，不决定分类。 */
    scene_id: z.string().optional(),
    source_conversation_id: z.string(),
    /** 钉子 #4：证据消息 ID + 可直接支持 proposal 的原文片段。 */
    source_message_ids: z.array(z.string()).min(1),
    evidence_excerpt: z.string().min(1),
    /** 哪个 AI / 哪个模型提的。 */
    proposer: z.object({
      ai_id: z.string(),
      model: z.string().optional(),
    }),
    confidence: z.number().min(0).max(1),
    sensitivity: sensitivitySchema,
    /** 与已有记忆冲突时必填（冲突记忆不许静默覆盖，必须进候选区）。 */
    conflicts_with: z.array(z.string()).optional(),
    status: proposalStatusSchema,
    created_at: z.string().datetime(),
  })
  .superRefine((p, ctx) => {
    if (p.conflicts_with && p.conflicts_with.length > 0 && p.status === "auto_approved") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "与已有记忆冲突的提案不得 auto_approved，必须进候选区人工裁决",
      });
    }
  });
export type MemoryProposal = z.infer<typeof memoryProposalSchema>;

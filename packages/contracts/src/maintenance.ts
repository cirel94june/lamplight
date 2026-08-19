import { z } from "zod";
import {
  claimTypeSchema,
  maintenanceActionSchema,
  maintenanceTaskTypeSchema,
  proposalStatusSchema,
} from "./enums.js";

/** 维护任务输入：手动触发时传入。 */
export const maintenanceTaskSchema = z.object({
  conversation_id: z.string().min(1),
  task_type: maintenanceTaskTypeSchema,
});
export type MaintenanceTask = z.infer<typeof maintenanceTaskSchema>;

/**
 * 维护模型的一条输出候选。
 * 所有维护输出先进这张表，Ceci 审批后才落入正式记忆。
 * correct/supersede 候选不得 auto_approved（MVP 红线 #15）。
 */
export const maintenanceProposalSchema = z
  .object({
    id: z.string(),
    conversation_id: z.string().min(1),
    action: maintenanceActionSchema,
    target_id: z.string().optional(),
    content: z.string().min(1),
    claim_type: claimTypeSchema,
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
    conflicts_with: z.array(z.string()).optional(),
    status: proposalStatusSchema,
    proposer_model: z.string().min(1),
    source_message_ids: z.array(z.string()).optional(),
    evidence_excerpt: z.string().optional(),
    created_at: z.string().datetime(),
  })
  .superRefine((p, ctx) => {
    if (
      (p.action === "correct" || p.action === "supersede") &&
      p.status === "auto_approved"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "correct/supersede 候选不得 auto_approved，必须人工确认（红线 #15）",
      });
    }
    if (p.conflicts_with && p.conflicts_with.length > 0 && p.status === "auto_approved") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "有冲突的候选不得 auto_approved",
      });
    }
  });
export type MaintenanceProposal = z.infer<typeof maintenanceProposalSchema>;

/**
 * 公共事实摘要——HouseholdDigest 是一等实体。
 * 只存公共事实（"客厅里 Cloudy 和 Jasper 讨论了 API"），
 * 不存主观理解（红线 #11）。
 */
export const householdDigestSchema = z.object({
  id: z.string(),
  proposal_id: z.string().optional(),
  scene_id: z.string(),
  conversation_id: z.string(),
  content: z.string().min(1),
  claim_type: claimTypeSchema,
  topic: z.string().optional(),
  participant_ai_ids: z.array(z.string()).optional(),
  period_start: z.string(),
  period_end: z.string(),
  proposer_model: z.string(),
  created_at: z.string(),
});
export type HouseholdDigest = z.infer<typeof householdDigestSchema>;

/** 审计记录——所有维护动作必须留痕（红线 #16）。 */
export const maintenanceAuditEntrySchema = z.object({
  id: z.string(),
  proposal_id: z.string().optional(),
  action: maintenanceActionSchema,
  target_id: z.string().optional(),
  decision_reason: z.string().min(1),
  actor_model_id: z.string().min(1),
  actor_provider_id: z.string().min(1),
  auto_executed: z.boolean(),
  created_at: z.string().datetime(),
});
export type MaintenanceAuditEntry = z.infer<typeof maintenanceAuditEntrySchema>;

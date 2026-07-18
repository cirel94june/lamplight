import { z } from "zod";
import { proposalStatusSchema } from "./enums.js";

/**
 * ActionProposal：AI 想在房子里做一件事（换家具、发起活动……）的结构化提案。
 * AI 只输出提案，执行与否由审批流决定。
 */
export const actionProposalSchema = z.object({
  id: z.string(),
  proposer_ai_id: z.string(),
  action_type: z.string(),
  params: z.record(z.unknown()),
  scene_id: z.string().optional(),
  status: proposalStatusSchema,
  created_at: z.string().datetime(),
});
export type ActionProposal = z.infer<typeof actionProposalSchema>;

/** Approval：对某个提案（Action 或 Memory）的人工裁决记录。 */
export const approvalSchema = z.object({
  id: z.string(),
  proposal_id: z.string(),
  proposal_type: z.enum(["action", "memory"]),
  decision: z.enum(["approved", "rejected"]),
  decided_by: z.literal("user"),
  reason: z.string().optional(),
  decided_at: z.string().datetime(),
});
export type Approval = z.infer<typeof approvalSchema>;

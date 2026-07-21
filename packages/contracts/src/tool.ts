import { z } from "zod";

/**
 * 工具层契约（v2.1 §7a-7c）。
 * 小手机是统一工具入口，不是 MCP 管理页。
 * 所有工具调用都经过权限判断和审计，结果默认不进长期记忆（§4 隔离原则）。
 */

/** 工具动作风险级别（§7b）。同一 App 的不同动作可处于不同级别。 */
export const toolRiskLevelSchema = z.enum([
  "read_only",
  "internal_write",
  "device_action",
  "external_side_effect",
  "forbidden",
]);
export type ToolRiskLevel = z.infer<typeof toolRiskLevelSchema>;

/** 工具动作定义（注册时用，不是每次调用时传）。 */
export const toolActionDefinitionSchema = z
  .object({
    /** 能力名：maps.search_place, music.search, web.search 等 */
    tool_id: z.string().min(1),
    /** 动作名：search_place, plan_route, save_to_inbox 等 */
    action: z.string().min(1),
    /** 风险级别 */
    risk_level: toolRiskLevelSchema,
    /** 该风险级别下的审批策略 */
    approval_policy: z.enum([
      "auto",
      "auto_revocable",
      "configurable",
      "require_confirmation",
      "forbidden",
    ]),
    /** 人类可读说明 */
    description: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.risk_level === "forbidden" && d.approval_policy !== "forbidden") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "forbidden 风险级别的动作只能搭配 forbidden 审批策略",
      });
    }
    if (
      d.risk_level === "external_side_effect" &&
      (d.approval_policy === "auto" || d.approval_policy === "auto_revocable")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "external_side_effect 风险级别不允许 auto/auto_revocable 审批策略",
      });
    }
  });
export type ToolActionDefinition = z.infer<typeof toolActionDefinitionSchema>;

/** 工具调用来源（§7c）。 */
export const toolRunSourceSchema = z.enum([
  "user_request",
  "conversation",
  "autonomous_pulse",
]);
export type ToolRunSource = z.infer<typeof toolRunSourceSchema>;

/**
 * tool_runs：工具调用审计记录（§7c）。
 * Lamplight 拥有（§5 数据归属）。
 * 敏感结果本身不一定永久保存，可只保存摘要。
 */
export const toolRunSchema = z.object({
  id: z.string().min(1),
  /** 谁发起的（agent_id 或 "owner"） */
  actor_id: z.string().min(1),
  /** 能力名 */
  tool_id: z.string().min(1),
  /** 动作名 */
  action: z.string().min(1),
  /** 调用来源 */
  source: toolRunSourceSchema,
  /** 该动作的风险级别（冗余存储，审计用） */
  risk_level: toolRiskLevelSchema,
  /** 权限判定结果 */
  permission_decision: z.enum(["approved", "auto_approved", "denied", "pending"]),
  /** 执行状态 */
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  /** 入参摘要（不存完整入参，避免泄漏敏感数据） */
  arguments_summary: z.string().optional(),
  /** 结果引用（可以是 ID 或摘要，原始结果可能已过期删除） */
  result_ref: z.string().optional(),
  created_at: z.string().datetime(),
  /** 短期结果过期时间（如实时位置查询） */
  expires_at: z.string().datetime().optional(),
})
  .superRefine((r, ctx) => {
    const validTransitions: Record<string, readonly string[]> = {
      approved: ["pending", "running", "completed", "failed", "cancelled"],
      auto_approved: ["pending", "running", "completed", "failed", "cancelled"],
      denied: ["cancelled"],
      pending: ["pending"],
    };
    const allowed = validTransitions[r.permission_decision];
    if (allowed && !allowed.includes(r.status)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `permission_decision="${r.permission_decision}" 不允许 status="${r.status}"`,
      });
    }
    if (r.risk_level === "forbidden" && r.permission_decision !== "denied") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "forbidden 风险级别的调用 permission_decision 只能是 denied",
      });
    }
    if (
      r.risk_level === "external_side_effect" &&
      r.permission_decision === "auto_approved"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "external_side_effect 风险级别不允许 auto_approved（§7b：外部副作用必须审批）",
      });
    }
    if (r.expires_at) {
      const created = new Date(r.created_at).getTime();
      const expires = new Date(r.expires_at).getTime();
      if (expires <= created) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "expires_at 必须晚于 created_at",
        });
      }
    }
  });
export type ToolRun = z.infer<typeof toolRunSchema>;

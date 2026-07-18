import { z } from "zod";
import { contextTypeSchema, type ConversationKind } from "./enums.js";

/**
 * 语境三件套之一：ContextEnvelope。
 * 凡是可能流向记忆提取管线的消息和事件都必须携带它。
 *
 * 🔩 钉子 #3：context_type 由服务端根据 Conversation/Session 类型注入，
 * 模型和客户端提交的值一律忽略覆盖——set_by 只允许 "server"。
 *
 * 命名注：施工单原文写作 contextType/worldId/setBy，为满足「同一个字段
 * 全仓库只许一套名字」的验收，contracts 统一采用 snake_case。
 *
 * 结构校验（schema 内置）：in_world 必须 world_id/session_id/branch_id 三 ID 齐全。
 * out_of_world 是否允许携带 world_id 取决于 conversationKind（GameDiscussion 例外），
 * 该规则见 validateContextForKind。
 */
export const contextEnvelopeSchema = z
  .object({
    context_type: contextTypeSchema,
    world_id: z.string().optional(),
    session_id: z.string().optional(),
    branch_id: z.string().optional(),
    set_by: z.literal("server"),
  })
  .superRefine((env, ctx) => {
    if (env.context_type === "in_world") {
      if (!env.world_id || !env.session_id || !env.branch_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "in_world 语境必须 world_id/session_id/branch_id 三 ID 齐全",
        });
      }
    }
  });
export type ContextEnvelope = z.infer<typeof contextEnvelopeSchema>;

/**
 * 结合 conversationKind 的完整语境校验：
 * out_of_world 不得携带任何世界 ID——唯一例外是 game_discussion
 * （场外讨论是 out_of_world，但需要指向被讨论的世界）。
 * 返回错误消息数组，空数组即合法。
 */
export function validateContextForKind(
  env: ContextEnvelope,
  kind: ConversationKind
): string[] {
  const errors: string[] = [];
  if (env.context_type === "out_of_world" && kind !== "game_discussion") {
    if (env.world_id || env.session_id || env.branch_id) {
      errors.push(
        `out_of_world 语境（conversationKind=${kind}）不得携带 world_id/session_id/branch_id`
      );
    }
  }
  if (env.context_type === "in_world" && kind !== "game_world") {
    errors.push(`in_world 语境只允许出现在 game_world 对话中（当前 ${kind}）`);
  }
  return errors;
}

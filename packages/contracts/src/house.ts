import { z } from "zod";
import { contextEnvelopeSchema } from "./context.js";
import { conversationKindSchema } from "./enums.js";

/**
 * HouseEvent：房子里的动态流事件。
 * payload 是结构化数据源；description 只用于展示，任何逻辑不得从 description 解析数据。
 */
export const houseEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  actor: z.object({
    type: z.enum(["user", "ai", "system"]),
    ai_id: z.string().optional(),
  }),
  scene_id: z.string().optional(),
  /** 结构化 payload——唯一数据源。 */
  payload: z.record(z.unknown()),
  /** 仅供人类阅读的展示文案，不是数据源。 */
  description: z.string().optional(),
  /** 可能流向记忆提取管线，必须携带语境（钉子 #3）。 */
  context: contextEnvelopeSchema,
  conversation_kind: conversationKindSchema,
  created_at: z.string().datetime(),
});
export type HouseEvent = z.infer<typeof houseEventSchema>;

/** AI 在房子里的在场状态。 */
export const presenceSchema = z.object({
  ai_id: z.string(),
  scene_id: z.string().nullable(),
  state: z.enum(["active", "idle", "away"]),
  updated_at: z.string().datetime(),
});
export type Presence = z.infer<typeof presenceSchema>;

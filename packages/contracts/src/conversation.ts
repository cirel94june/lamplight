import { z } from "zod";
import { contextEnvelopeSchema, validateContextForKind } from "./context.js";
import { conversationKindSchema, speechModeSchema } from "./enums.js";

/** 消息发送者。ai 必须带 ai_id。 */
export const messageSenderSchema = z
  .object({
    type: z.enum(["user", "ai", "system"]),
    ai_id: z.string().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.type === "ai" && !s.ai_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sender.type=ai 时必须携带 ai_id",
      });
    }
  });
export type MessageSender = z.infer<typeof messageSenderSchema>;

/**
 * 生成 AI 消息时的 prompt 快照——审计用，回答"这句话是在什么 prompt 下说出来的"。
 */
export const promptSnapshotSchema = z.object({
  model: z.string(),
  rendered_prompt: z.string(),
  created_at: z.string().datetime(),
});
export type PromptSnapshot = z.infer<typeof promptSnapshotSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  kind: conversationKindSchema,
  scene_id: z.string().optional(),
  world_id: z.string().optional(),
  session_id: z.string().optional(),
  participant_ai_ids: z.array(z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageSchema = z
  .object({
    id: z.string(),
    conversation_id: z.string(),
    /** 来源容器（语境三件套之二）——流向提取管线的消息必须自带，不依赖回查 Conversation。 */
    conversation_kind: conversationKindSchema,
    sender: messageSenderSchema,
    content: z.string(),
    /** 服务端注入的语境信封（钉子 #3）。 */
    context: contextEnvelopeSchema,
    /** 仅在用户显式标记（/ooc、游戏按钮）时携带；不给每条消息实时盖章。 */
    speech_mode: speechModeSchema.optional(),
    /** AI 消息的生成快照；用户/系统消息没有。 */
    prompt_snapshot: promptSnapshotSchema.optional(),
    created_at: z.string().datetime(),
  })
  .superRefine((msg, ctx) => {
    for (const message of validateContextForKind(msg.context, msg.conversation_kind)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["context"] });
    }
  });
export type Message = z.infer<typeof messageSchema>;

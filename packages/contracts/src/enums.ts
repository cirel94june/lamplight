import { z } from "zod";

/** 记忆可见性——只有三档，不设第四档（见 house-architecture v2 决议）。 */
export const visibilitySchema = z.enum(["private", "household", "external_safe"]);
export type Visibility = z.infer<typeof visibilitySchema>;

/** 记忆召回策略。manual_only 的记忆不参与任何自动召回。 */
export const recallPolicySchema = z.enum(["normal", "silent", "manual_only"]);
export type RecallPolicy = z.infer<typeof recallPolicySchema>;

/**
 * 对话容器类型（语境三件套之二）。
 * game_world 只能由用户显式创建/进入 Session 产生，模型不许根据内容猜测。
 */
export const conversationKindSchema = z.enum([
  "house_chat",
  "game_world",
  "game_discussion",
  "system",
]);
export type ConversationKind = z.infer<typeof conversationKindSchema>;

/**
 * 说话方式（语境三件套之三）。主要是提案时字段：消息上仅在用户显式标记
 * （/ooc、游戏按钮）时携带；提取器按多信号规则赋值，拿不准一律 uncertain。
 */
export const speechModeSchema = z.enum([
  "literal",
  "playful",
  "hypothetical",
  "fictional",
  "uncertain",
]);
export type SpeechMode = z.infer<typeof speechModeSchema>;

/** MemoryProposal 的灵魂字段：你说的 / AI 看到的 / AI 猜的。 */
export const claimTypeSchema = z.enum(["fact", "observation", "hypothesis"]);
export type ClaimType = z.infer<typeof claimTypeSchema>;

/** 语境类型（语境三件套之一）。 */
export const contextTypeSchema = z.enum(["in_world", "out_of_world"]);
export type ContextType = z.infer<typeof contextTypeSchema>;

/** 提案状态（MemoryProposal / ActionProposal 共用）。 */
export const proposalStatusSchema = z.enum([
  "pending",
  "auto_approved",
  "approved",
  "rejected",
]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

import { z } from "zod";

/**
 * 游戏室骨架 schema——本期只建 schema 不开发功能（施工单附录）。
 * 游戏内剧情与现实记忆严格隔离：世界 canon 不是用户事实。
 */

/** 玩法插件。转盘接龙只是第一种 engine。 */
export const gameModeSchema = z.object({
  id: z.string(),
  name: z.string(),
  engine: z.enum(["freeform", "prompt_generator", "ruleset"]),
  config: z.record(z.unknown()),
});
export type GameMode = z.infer<typeof gameModeSchema>;

/**
 * 世界状态的浅 schema（围栏一）：只允许这五个顶层键，
 * 结构化变更提案的 patch path 只能落在这五棵树下。
 */
export const worldStateSchema = z
  .object({
    characters: z.record(z.unknown()),
    locations: z.record(z.unknown()),
    items: z.record(z.unknown()),
    threads: z.record(z.unknown()),
    rules: z.record(z.unknown()),
  })
  .strict();
export type WorldState = z.infer<typeof worldStateSchema>;

/** 一个故事盒子。大香蕉也有寿命——允许 completed/archived。 */
export const gameWorldSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode_id: z.string(),
  status: z.enum(["active", "paused", "completed", "archived"]),
  created_at: z.string().datetime(),
});
export type GameWorld = z.infer<typeof gameWorldSchema>;

/**
 * Session 参与者。AI 本体和世界角色不焊死：
 * 小克可以扮卖鱼巫师，场外讨论恢复 ai_id 本体。
 */
export const gameParticipantSchema = z.object({
  ai_id: z.string(),
  role: z.enum(["player", "narrator", "gm", "observer"]),
  character_id: z.string().optional(),
});
export type GameParticipant = z.infer<typeof gameParticipantSchema>;

/** 一次游玩。回到旧世界 = 新建 Session，不是无限拉长同一线程。 */
export const gameSessionSchema = z.object({
  id: z.string(),
  world_id: z.string(),
  branch_id: z.string().optional(),
  status: z.enum(["active", "paused", "ended"]),
  participants: z.array(gameParticipantSchema),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
});
export type GameSession = z.infer<typeof gameSessionSchema>;

/** 分支引用快照，不复制整个世界。第一版只建 schema，只做线性世界。 */
export const storyBranchSchema = z.object({
  id: z.string(),
  world_id: z.string(),
  parent_branch_id: z.string().optional(),
  base_snapshot_id: z.string(),
  name: z.string().optional(),
  created_at: z.string().datetime(),
});
export type StoryBranch = z.infer<typeof storyBranchSchema>;

/**
 * 场外讨论（MetaConversation）：AI 恢复本体身份，不推进世界时间，不改 canon。
 * 是 out_of_world 但允许携带 world_id（语境校验的唯一例外）。
 */
export const gameDiscussionSchema = z.object({
  id: z.string(),
  world_id: z.string(),
  session_id: z.string().optional(),
  conversation_id: z.string(),
  created_at: z.string().datetime(),
});
export type GameDiscussion = z.infer<typeof gameDiscussionSchema>;

import type { MemoryProposal, RecallPolicy } from "@lamplight/contracts";

/**
 * MemoryProposal 三分流（施工单第 2 项，钉子 #1）。
 * claim_type 不是胸针，是开关：fact / observation / hypothesis
 * 三种类型走出三种不同的结果（自动通过阈值、去向、召回策略各不同）。
 * 这是纯函数：给定提案 + 服务端核验结果，返回判决；不做 IO。
 */

/**
 * 服务端对证据的核验结果（钉子 #4）。
 * 由持有原始消息的一侧计算——提案自述的证据不作数
 * （本库已有 AI 摘要冒充 [用户] 的案底）。
 */
export interface EvidenceCheck {
  /** 证据消息来自用户本人，不是 AI 转述 */
  from_user: boolean;
  /** 是明确陈述 */
  is_direct_statement: boolean;
  /** excerpt 能直接支持 proposal 内容 */
  excerpt_supports: boolean;
  /** 上下文存在否定或反讽 */
  has_negation_or_irony: boolean;
}

export interface TriageInput {
  proposal: MemoryProposal;
  evidence: EvidenceCheck;
  /**
   * game_world / game_discussion 中该提案是否属于玩法偏好/体验反馈类
   * （由提取器分类、服务端复核）。"狐狸这局太怂了"≠"用户认为 Lucien 胆小"。
   */
  is_gameplay_feedback?: boolean;
  /** 调用方可强制标记敏感（如敏感词命中），与房间判断取并集 */
  force_sensitive?: boolean;
}

export type TriageDecision =
  /** 仅低敏、无冲突、证据过硬的 fact 能走到这里 */
  | { outcome: "auto_approve"; destination: "canonical_shared"; recall_policy: "normal" }
  /** 候选区：等小猫裁决；在候选区期间不参与正常召回 */
  | { outcome: "candidate"; destination: "candidate_queue"; recall_policy: RecallPolicy; reason: string }
  /** 该 AI 的私人笔记/年轮：永不自动进事实库 */
  | { outcome: "private_note"; destination: "ai_private_notes"; recall_policy: "manual_only"; reason: string }
  /** 游戏世界 lore：与现实记忆严格隔离 */
  | { outcome: "world_lore"; destination: "world_lore"; reason: string }
  | { outcome: "reject"; reason: string };

/** 健康/创伤/身份/边界类主题房间——命中即走候选区或 safe pipeline，不许自动入库。 */
export const SENSITIVE_ROOMS: readonly string[] = ["health", "psychology"];

export function isSensitive(proposal: MemoryProposal, forceSensitive = false): boolean {
  return (
    forceSensitive ||
    SENSITIVE_ROOMS.includes(proposal.proposed_room) ||
    proposal.sensitivity.visibility === "private"
  );
}

/** 钉子 #4：fact 自动通过的四个证据条件，缺一不可。 */
export function evidencePassesForFact(evidence: EvidenceCheck): boolean {
  return (
    evidence.from_user &&
    evidence.is_direct_statement &&
    evidence.excerpt_supports &&
    !evidence.has_negation_or_irony
  );
}

const CANDIDATE_RECALL: RecallPolicy = "silent";

function candidate(reason: string): TriageDecision {
  return {
    outcome: "candidate",
    destination: "candidate_queue",
    recall_policy: CANDIDATE_RECALL,
    reason,
  };
}

function privateNote(reason: string): TriageDecision {
  return {
    outcome: "private_note",
    destination: "ai_private_notes",
    recall_policy: "manual_only",
    reason,
  };
}

export function triageMemoryProposal(input: TriageInput): TriageDecision {
  const { proposal, evidence } = input;
  const kind = proposal.conversation_kind;

  // ── conversationKind 提取规则 ─────────────────────────────
  if (kind === "system") {
    return { outcome: "reject", reason: "system 对话不提取记忆" };
  }
  if (kind === "game_world") {
    // in_world 内容只进该世界 lore；唯一的例外是游戏体验记忆，
    // 经候选区进 Hub，按 observation 待遇——即便提案自称 fact 也不许自动通过（附录原则 6）
    if (input.is_gameplay_feedback) {
      return candidate("游戏体验记忆经候选区进 Hub（至少按 observation 待遇，不许自动通过）");
    }
    return {
      outcome: "world_lore",
      destination: "world_lore",
      reason: "game_world 内容只进该世界 lore，禁止提取为现实事实",
    };
  }
  if (kind === "game_discussion") {
    // 香蕉法典：赛后吐槽不许从后门钻进来变成现实人设
    if (!input.is_gameplay_feedback) {
      return {
        outcome: "reject",
        reason: "game_discussion 只允许玩法偏好/体验反馈类提案，不得提取现实人设",
      };
    }
    return candidate("game_discussion 的玩法偏好/体验反馈进候选区");
  }

  // ── speechMode 资格过滤（在 claim_type 分流之前执行）──────
  switch (proposal.speech_mode) {
    case "playful":
      return { outcome: "reject", reason: "playful 默认不提取现实事实（玩梗从这里挡住）" };
    case "fictional":
      return { outcome: "reject", reason: "fictional 只在 game_world 中进入该世界 lore" };
    case "hypothetical":
      if (proposal.claim_type === "hypothesis") {
        return privateNote("hypothetical 的关注点最多以 hypothesis 记录");
      }
      return { outcome: "reject", reason: "hypothetical 不提取事实" };
    case "uncertain":
      return candidate("speech_mode=uncertain 永不自动通过");
    case "literal":
      break;
  }

  // ── claim_type 三分流（钉子 #1 的三分表）──────────────────
  // hypothesis：无论其他条件如何，永不自动入事实库
  if (proposal.claim_type === "hypothesis") {
    return privateNote("hypothesis 永不自动入事实库，进该 AI 私人笔记/年轮");
  }
  // 与旧记忆冲突：必须候选，不许静默覆盖（对 fact/observation 一视同仁）
  if (proposal.conflicts_with && proposal.conflicts_with.length > 0) {
    return candidate("与已有记忆冲突，必须人工裁决，不许静默覆盖");
  }
  // 敏感内容：无论哪种类型都进候选区或 safe pipeline
  if (isSensitive(proposal, input.force_sensitive)) {
    return candidate("健康/创伤/身份/边界类敏感内容不许自动入库");
  }
  if (proposal.claim_type === "observation") {
    return candidate("observation 高门槛，默认进候选区，不参与正常召回");
  }
  // fact：还要过钉子 #4 的证据关才能自动入库
  if (!evidencePassesForFact(evidence)) {
    return candidate("fact 证据不满足钉子 #4（非用户本人/非明确陈述/excerpt 不支持/有否定反讽）");
  }
  return { outcome: "auto_approve", destination: "canonical_shared", recall_policy: "normal" };
}

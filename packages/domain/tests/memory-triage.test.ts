import { describe, expect, it } from "vitest";
import type { ClaimType, MemoryProposal } from "@lamplight/contracts";
import {
  evidencePassesForFact,
  triageMemoryProposal,
  type EvidenceCheck,
  type TriageDecision,
} from "../src/index.js";

/** 一条"最顺利"的提案：literal、house_chat、低敏、无冲突。 */
function makeProposal(overrides: Partial<MemoryProposal> = {}): MemoryProposal {
  return {
    id: "mp_1",
    content: "小猫今天开始学吉他",
    claim_type: "fact",
    speech_mode: "literal",
    conversation_kind: "house_chat",
    proposed_room: "learning",
    source_conversation_id: "conv_1",
    source_message_ids: ["msg_1"],
    evidence_excerpt: "我今天报了吉他课",
    proposer: { ai_id: "cloudy", model: "small-extractor-v1" },
    confidence: 0.9,
    sensitivity: { visibility: "household", recall_policy: "normal" },
    status: "pending",
    created_at: "2026-07-18T12:00:00Z",
    ...overrides,
  };
}

const goodEvidence: EvidenceCheck = {
  from_user: true,
  is_direct_statement: true,
  excerpt_supports: true,
  has_negation_or_irony: false,
};

function triage(
  overrides: Partial<MemoryProposal> = {},
  extra: { evidence?: EvidenceCheck; is_gameplay_feedback?: boolean; force_sensitive?: boolean } = {}
): TriageDecision {
  return triageMemoryProposal({
    proposal: makeProposal(overrides),
    evidence: extra.evidence ?? goodEvidence,
    is_gameplay_feedback: extra.is_gameplay_feedback,
    force_sensitive: extra.force_sensitive,
  });
}

describe("钉子 #1：三种 claim_type 走出三种不同结果", () => {
  it("fact（低敏、无冲突、证据过硬）→ 自动入共享库，召回 normal", () => {
    const d = triage({ claim_type: "fact" });
    expect(d).toEqual({
      outcome: "auto_approve",
      destination: "canonical_shared",
      recall_policy: "normal",
    });
  });

  it("observation → 候选区，不参与正常召回", () => {
    const d = triage({ claim_type: "observation" });
    expect(d.outcome).toBe("candidate");
    if (d.outcome === "candidate") {
      expect(d.destination).toBe("candidate_queue");
      expect(d.recall_policy).not.toBe("normal");
    }
  });

  it("hypothesis → 该 AI 私人笔记/年轮，manual_only，永不自动入事实库", () => {
    const d = triage({ claim_type: "hypothesis" });
    expect(d).toMatchObject({
      outcome: "private_note",
      destination: "ai_private_notes",
      recall_policy: "manual_only",
    });
  });

  it("三种结果的（去向, 召回策略）两两不同——不是同一个开关贴三个标签", () => {
    const results = (["fact", "observation", "hypothesis"] as ClaimType[]).map((ct) => {
      const d = triage({ claim_type: ct });
      if (d.outcome === "reject") throw new Error("不应 reject");
      return `${d.outcome}|${d.destination}|${d.recall_policy}`;
    });
    expect(new Set(results).size).toBe(3);
  });

  it("hypothesis 即使证据完美、房间低敏，也进不了事实库", () => {
    const d = triage({ claim_type: "hypothesis", confidence: 1 });
    expect(d.outcome).toBe("private_note");
  });
});

describe("冲突记忆无法绕过候选区直接入库", () => {
  it("fact 带 conflicts_with → 候选区，不许静默覆盖", () => {
    const d = triage({ conflicts_with: ["mem_old_1"] });
    expect(d.outcome).toBe("candidate");
  });

  it("observation 带 conflicts_with 同样候选", () => {
    const d = triage({ claim_type: "observation", conflicts_with: ["mem_old_1"] });
    expect(d.outcome).toBe("candidate");
  });
});

describe("回归（review 4727721304）：敏感/冲突硬门压在私人笔记通道之前", () => {
  it("敏感 hypothesis → 候选区，不得绕道私人笔记", () => {
    const d = triage({ claim_type: "hypothesis", proposed_room: "health" });
    expect(d.outcome).toBe("candidate");
  });

  it("冲突 hypothesis → 候选区，不得绕道私人笔记", () => {
    const d = triage({ claim_type: "hypothesis", conflicts_with: ["mem_old_1"] });
    expect(d.outcome).toBe("candidate");
  });

  it("hypothetical + hypothesis 且敏感/冲突 → 候选区", () => {
    expect(
      triage({
        speech_mode: "hypothetical",
        claim_type: "hypothesis",
        proposed_room: "psychology",
      }).outcome
    ).toBe("candidate");
    expect(
      triage({
        speech_mode: "hypothetical",
        claim_type: "hypothesis",
        conflicts_with: ["mem_old_1"],
      }).outcome
    ).toBe("candidate");
  });

  it("无敏感无冲突时 hypothesis 仍走私人笔记（原路径不受影响）", () => {
    expect(triage({ claim_type: "hypothesis" }).outcome).toBe("private_note");
    expect(
      triage({ speech_mode: "hypothetical", claim_type: "hypothesis" }).outcome
    ).toBe("private_note");
  });
});

describe("钉子 #4：fact 自动通过的证据关，缺一不可", () => {
  it.each([
    ["证据非用户本人（AI 转述冒充案底）", { ...goodEvidence, from_user: false }],
    ["非明确陈述", { ...goodEvidence, is_direct_statement: false }],
    ["excerpt 不能直接支持", { ...goodEvidence, excerpt_supports: false }],
    ["存在否定或反讽", { ...goodEvidence, has_negation_or_irony: true }],
  ] as const)("%s → 不自动通过，进候选区", (_name, evidence) => {
    expect(evidencePassesForFact(evidence)).toBe(false);
    const d = triage({}, { evidence });
    expect(d.outcome).toBe("candidate");
  });
});

describe("speechMode 资格过滤（在 claim_type 分流之前）", () => {
  it("playful → 不提取现实事实（Telegram 玩梗从这里挡住）", () => {
    expect(triage({ speech_mode: "playful" }).outcome).toBe("reject");
  });

  it("hypothetical + fact → 不提取；hypothetical + hypothesis → 私人笔记", () => {
    expect(triage({ speech_mode: "hypothetical", claim_type: "fact" }).outcome).toBe("reject");
    expect(triage({ speech_mode: "hypothetical", claim_type: "hypothesis" }).outcome).toBe(
      "private_note"
    );
  });

  it("fictional 在 house_chat → 不提取（只在 game_world 进世界 lore）", () => {
    expect(triage({ speech_mode: "fictional" }).outcome).toBe("reject");
  });

  it("uncertain → 永不自动通过，进候选区", () => {
    expect(triage({ speech_mode: "uncertain" }).outcome).toBe("candidate");
  });

  it("playful/hypothetical/fictional 永远不能作为现实事实自动通过", () => {
    for (const mode of ["playful", "hypothetical", "fictional"] as const) {
      const d = triage({ speech_mode: mode, claim_type: "fact" });
      expect(d.outcome).not.toBe("auto_approve");
    }
  });
});

describe("conversationKind 提取规则", () => {
  it("system → 不提取", () => {
    expect(triage({ conversation_kind: "system" }).outcome).toBe("reject");
  });

  it("game_world → 只进该世界 lore，即便自称 literal fact", () => {
    const d = triage({ conversation_kind: "game_world", speech_mode: "fictional" });
    expect(d.outcome).toBe("world_lore");
    expect(triage({ conversation_kind: "game_world" }).outcome).toBe("world_lore");
  });

  it("game_world 的游戏体验记忆 → 候选区，且不许自动通过", () => {
    const d = triage(
      { conversation_kind: "game_world", claim_type: "fact" },
      { is_gameplay_feedback: true }
    );
    expect(d.outcome).toBe("candidate");
  });

  it("game_discussion 非玩法反馈 → 不提取（赛后吐槽不得变成现实人设）", () => {
    const d = triage({ conversation_kind: "game_discussion", claim_type: "observation" });
    expect(d.outcome).toBe("reject");
  });

  it("game_discussion 玩法偏好/体验反馈 → 候选区", () => {
    const d = triage(
      { conversation_kind: "game_discussion", claim_type: "observation" },
      { is_gameplay_feedback: true }
    );
    expect(d.outcome).toBe("candidate");
  });
});

describe("敏感内容分流", () => {
  it("health/psychology 房间的 fact → 候选区，不自动入库", () => {
    expect(triage({ proposed_room: "health" }).outcome).toBe("candidate");
    expect(triage({ proposed_room: "psychology" }).outcome).toBe("candidate");
  });

  it("visibility=private → 候选区", () => {
    const d = triage({
      sensitivity: { visibility: "private", recall_policy: "normal" },
    });
    expect(d.outcome).toBe("candidate");
  });

  it("调用方 force_sensitive → 候选区", () => {
    expect(triage({}, { force_sensitive: true }).outcome).toBe("candidate");
  });
});

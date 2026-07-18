import { describe, expect, it } from "vitest";
import { memoryProposalSchema } from "../src/index.js";

const base = {
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
  created_at: "2026-07-17T12:00:00Z",
} as const;

describe("MemoryProposal", () => {
  it("合法提案能通过", () => {
    expect(memoryProposalSchema.safeParse(base).success).toBe(true);
  });

  it("sensitivity.allowed_ai_ids 留 nullable，缺省解析为 null（v2 §4）", () => {
    const parsed = memoryProposalSchema.parse(base);
    expect(parsed.sensitivity.allowed_ai_ids).toBeNull();
    const withList = memoryProposalSchema.parse({
      ...base,
      sensitivity: {
        visibility: "private",
        recall_policy: "manual_only",
        allowed_ai_ids: ["cloudy"],
      },
    });
    expect(withList.sensitivity.allowed_ai_ids).toEqual(["cloudy"]);
  });

  it("claim_type 只接受 fact/observation/hypothesis", () => {
    expect(
      memoryProposalSchema.safeParse({ ...base, claim_type: "guess" }).success
    ).toBe(false);
  });

  it("证据字段（钉子 #4）不可缺省或为空", () => {
    expect(
      memoryProposalSchema.safeParse({ ...base, source_message_ids: [] }).success
    ).toBe(false);
    expect(
      memoryProposalSchema.safeParse({ ...base, evidence_excerpt: "" }).success
    ).toBe(false);
  });

  it("与已有记忆冲突的提案不得 auto_approved（结构约束；分流逻辑见施工单第 2 项）", () => {
    expect(
      memoryProposalSchema.safeParse({
        ...base,
        conflicts_with: ["mem_old"],
        status: "auto_approved",
      }).success
    ).toBe(false);
    expect(
      memoryProposalSchema.safeParse({
        ...base,
        conflicts_with: ["mem_old"],
        status: "pending",
      }).success
    ).toBe(true);
  });
});

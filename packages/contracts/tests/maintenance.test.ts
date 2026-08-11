import { describe, expect, it } from "vitest";
import {
  maintenanceActionSchema,
  maintenanceTaskTypeSchema,
  maintenanceTaskSchema,
  maintenanceProposalSchema,
  maintenanceAuditEntrySchema,
} from "../src/index.js";

const NOW = "2026-08-11T12:00:00Z";

function validProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "mp-1",
    conversation_id: "conv-1",
    action: "create",
    content: "小克提到她喜欢猫",
    claim_type: "fact",
    reason: "用户原话直接证据",
    confidence: 0.9,
    status: "pending",
    proposer_model: "deepseek-chat",
    created_at: NOW,
    ...overrides,
  };
}

describe("maintenanceActionSchema", () => {
  it("accepts all 9 actions", () => {
    const actions = [
      "create", "update", "supplement", "correct", "supersede",
      "annotate", "resolve_thread", "reopen_thread", "no_change",
    ];
    for (const a of actions) {
      expect(maintenanceActionSchema.parse(a)).toBe(a);
    }
  });

  it("rejects unknown action", () => {
    expect(() => maintenanceActionSchema.parse("delete")).toThrow();
  });
});

describe("maintenanceTaskTypeSchema", () => {
  it("accepts digest/classify/conflict_detect", () => {
    expect(maintenanceTaskTypeSchema.parse("digest")).toBe("digest");
    expect(maintenanceTaskTypeSchema.parse("classify")).toBe("classify");
    expect(maintenanceTaskTypeSchema.parse("conflict_detect")).toBe("conflict_detect");
  });
});

describe("maintenanceTaskSchema", () => {
  it("parses valid task", () => {
    const result = maintenanceTaskSchema.parse({
      conversation_id: "conv-1",
      task_type: "digest",
    });
    expect(result.conversation_id).toBe("conv-1");
    expect(result.task_type).toBe("digest");
  });

  it("rejects empty conversation_id", () => {
    expect(() =>
      maintenanceTaskSchema.parse({ conversation_id: "", task_type: "digest" }),
    ).toThrow();
  });
});

describe("maintenanceProposalSchema", () => {
  it("parses valid proposal", () => {
    const result = maintenanceProposalSchema.parse(validProposal());
    expect(result.action).toBe("create");
    expect(result.status).toBe("pending");
  });

  it("accepts optional fields", () => {
    const result = maintenanceProposalSchema.parse(
      validProposal({
        target_id: "mem-old",
        conflicts_with: ["mem-old"],
        source_message_ids: ["msg-1", "msg-2"],
        evidence_excerpt: "我喜欢猫",
      }),
    );
    expect(result.target_id).toBe("mem-old");
    expect(result.source_message_ids).toEqual(["msg-1", "msg-2"]);
  });

  it("rejects correct + auto_approved (红线 #15)", () => {
    expect(() =>
      maintenanceProposalSchema.parse(
        validProposal({ action: "correct", status: "auto_approved" }),
      ),
    ).toThrow("correct/supersede");
  });

  it("rejects supersede + auto_approved (红线 #15)", () => {
    expect(() =>
      maintenanceProposalSchema.parse(
        validProposal({ action: "supersede", status: "auto_approved" }),
      ),
    ).toThrow("correct/supersede");
  });

  it("rejects conflicts_with + auto_approved", () => {
    expect(() =>
      maintenanceProposalSchema.parse(
        validProposal({
          conflicts_with: ["mem-old"],
          status: "auto_approved",
        }),
      ),
    ).toThrow("冲突");
  });

  it("allows annotate + auto_approved (MVP safe action)", () => {
    const result = maintenanceProposalSchema.parse(
      validProposal({ action: "annotate", status: "auto_approved" }),
    );
    expect(result.status).toBe("auto_approved");
  });

  it("allows no_change + auto_approved (MVP safe action)", () => {
    const result = maintenanceProposalSchema.parse(
      validProposal({ action: "no_change", status: "auto_approved" }),
    );
    expect(result.status).toBe("auto_approved");
  });

  it("rejects empty content", () => {
    expect(() =>
      maintenanceProposalSchema.parse(validProposal({ content: "" })),
    ).toThrow();
  });

  it("rejects confidence out of range", () => {
    expect(() =>
      maintenanceProposalSchema.parse(validProposal({ confidence: 1.5 })),
    ).toThrow();
  });
});

describe("maintenanceAuditEntrySchema", () => {
  it("parses valid audit entry", () => {
    const result = maintenanceAuditEntrySchema.parse({
      id: "audit-1",
      proposal_id: "mp-1",
      action: "create",
      decision_reason: "用户原话直接证据",
      actor_model_id: "deepseek-chat",
      actor_provider_id: "test-provider",
      auto_executed: false,
      created_at: NOW,
    });
    expect(result.action).toBe("create");
    expect(result.auto_executed).toBe(false);
  });

  it("allows missing proposal_id (no_change case)", () => {
    const result = maintenanceAuditEntrySchema.parse({
      id: "audit-2",
      action: "no_change",
      decision_reason: "无需变更",
      actor_model_id: "deepseek-chat",
      actor_provider_id: "test-provider",
      auto_executed: true,
      created_at: NOW,
    });
    expect(result.proposal_id).toBeUndefined();
  });
});

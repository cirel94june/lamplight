import { describe, expect, it } from "vitest";
import { worldChangeProposalSchema, worldPatchOpSchema } from "../src/index.js";

const baseProposal = {
  id: "wcp_1",
  world_id: "w1",
  session_id: "s1",
  proposer_ai_id: "jasper",
  base_snapshot_id: "snap_18",
  base_version: 18,
  ops: [{ op: "add", path: "/characters/banana_cat", value: { name: "香蕉猫" } }],
  status: "pending",
  created_at: "2026-07-18T12:00:00Z",
} as const;

describe("WorldChangeProposal（钉子 #5）", () => {
  it("合法提案能通过", () => {
    expect(worldChangeProposalSchema.safeParse(baseProposal).success).toBe(true);
  });

  it("base_snapshot_id / base_version 缺一不可（乐观锁）", () => {
    const { base_version, ...noVersion } = baseProposal;
    expect(worldChangeProposalSchema.safeParse(noVersion).success).toBe(false);
    const { base_snapshot_id, ...noSnapshot } = baseProposal;
    expect(worldChangeProposalSchema.safeParse(noSnapshot).success).toBe(false);
    expect(
      worldChangeProposalSchema.safeParse({ ...baseProposal, base_version: -1 }).success
    ).toBe(false);
  });

  it("ops 不许为空——空提案没有意义", () => {
    expect(
      worldChangeProposalSchema.safeParse({ ...baseProposal, ops: [] }).success
    ).toBe(false);
  });

  it("patch path 只允许落在五棵树下（围栏一）", () => {
    expect(
      worldPatchOpSchema.safeParse({
        op: "add",
        path: "/diplomacy/banana_republic",
        value: {},
      }).success
    ).toBe(false);
    expect(
      worldPatchOpSchema.safeParse({ op: "replace", path: "/", value: {} }).success
    ).toBe(false);
    expect(
      worldPatchOpSchema.safeParse({
        op: "replace",
        path: "/threads/main_quest",
        value: { status: "resolved" },
      }).success
    ).toBe(true);
  });

  it("add/replace 必带 value，remove 不得带 value", () => {
    expect(
      worldPatchOpSchema.safeParse({ op: "add", path: "/items/lamp" }).success
    ).toBe(false);
    expect(
      worldPatchOpSchema.safeParse({
        op: "remove",
        path: "/items/lamp",
        value: {},
      }).success
    ).toBe(false);
    expect(
      worldPatchOpSchema.safeParse({ op: "remove", path: "/items/lamp" }).success
    ).toBe(true);
  });
});

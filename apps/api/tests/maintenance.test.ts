import { describe, expect, it, beforeEach, vi } from "vitest";
import type { GatewayCompletionRequest, GatewayCompletionResponse } from "@lamplight/contracts";

const { mockComplete } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
}));

vi.mock("../src/services/gateway/index.js", () => ({
  initGateway: () => ({ complete: mockComplete }),
}));

import { app } from "../src/app.js";
import { db, schema } from "../src/db/index.js";
import { sql } from "drizzle-orm";
import { validateThirdPerson, validateMaintenanceOutput } from "../src/services/maintenance/validator.js";

const TOKEN = "test-token-123";
process.env.OWNER_TOKEN = TOKEN;
const authHeaders = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function seedMaintenance() {
  await db.run(sql`DELETE FROM maintenance_proposals`);
  await db.run(sql`DELETE FROM maintenance_audit`);
  await db.run(sql`DELETE FROM messages`);
  await db.run(sql`DELETE FROM conversations`);
  await db.run(sql`DELETE FROM agent_model_bindings`);
  await db.run(sql`DELETE FROM agent_runtime_configs`);
  await db.run(sql`DELETE FROM agent_profiles`);
  await db.run(sql`DELETE FROM scenes`);

  await db.insert(schema.scenes).values({
    scene_id: "room-living",
    display_name: "客厅",
    type: "room",
    prompt_weight_overrides: {},
  });

  await db.insert(schema.agentProfiles).values([
    { agent_id: "xiaoke", display_name: "小克", memory_scope: "xiaoke" },
    { agent_id: "maintenance", display_name: "维护模型", memory_scope: "maintenance" },
  ]);

  await db.insert(schema.agentModelBindings).values([
    { id: "bind-xiaoke", agent_id: "xiaoke", api_provider_id: "provider-a", provider_id: "anthropic", model_id: "claude-opus-4-6" },
    { id: "bind-maintenance", agent_id: "maintenance", api_provider_id: "provider-b", provider_id: "anthropic", model_id: "deepseek-chat" },
  ]);

  await db.insert(schema.agentRuntimeConfigs).values([
    { agent_id: "xiaoke", random_reply_affinity: 0.7, max_response_tokens: 1024 },
    { agent_id: "maintenance", random_reply_affinity: 0, max_response_tokens: 2048, temperature: 0.3,
      system_prompt_template: "你是后台维护模型。客观整理，第三人称。" },
  ]);

  await db.insert(schema.conversations).values({
    id: "conv-maint-test",
    kind: "house_chat",
    scene_id: "room-living",
    participant_ai_ids: JSON.stringify(["xiaoke"]) as any,
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at) VALUES ('msg-u1', 'conv-maint-test', 'house_chat', 1, 'user', '我最近在学钢琴', 'out_of_world', 'server', datetime('now'))`);
  await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at) VALUES ('msg-a1', 'conv-maint-test', 'house_chat', 2, 'ai', 'xiaoke', '学钢琴好棒！你练了多久了？', 'out_of_world', 'server', datetime('now'))`);
}

describe("validator", () => {
  it("accepts third-person content", () => {
    expect(validateThirdPerson("小克提到她喜欢猫").valid).toBe(true);
    expect(validateThirdPerson("用户表示最近在学钢琴").valid).toBe(true);
  });

  it("rejects first-person content (中文)", () => {
    const r1 = validateThirdPerson("我觉得这段对话很有意思");
    expect(r1.valid).toBe(false);

    const r2 = validateThirdPerson("我认为小克应该更主动");
    expect(r2.valid).toBe(false);
  });

  it("rejects first-person content (English)", () => {
    const r = validateThirdPerson("I think the user is feeling sad");
    expect(r.valid).toBe(false);
  });

  it("rejects all standalone 我 usage including bypass attempts", () => {
    expect(validateThirdPerson("我很难过").valid).toBe(false);
    expect(validateThirdPerson("我爱 Ceci").valid).toBe(false);
    expect(validateThirdPerson("我希望用户开心").valid).toBe(false);
    expect(validateThirdPerson("我现在非常难过，也依然很喜欢 Ceci").valid).toBe(false);
    expect(validateThirdPerson("I feel sad about this").valid).toBe(false);
    expect(validateThirdPerson("I'm worried about them").valid).toBe(false);
    expect(validateThirdPerson("I've noticed a pattern").valid).toBe(false);
  });

  it("allows legitimate compound words containing 我: 自我/忘我/我们", () => {
    expect(validateThirdPerson("用户有很强的自我意识").valid).toBe(true);
    expect(validateThirdPerson("小克忘我地投入工作").valid).toBe(true);
    expect(validateThirdPerson("我们观察到用户的变化").valid).toBe(true);
  });

  it("batch validates: filters out first-person items", () => {
    const items = [
      { action: "create", content: "用户提到喜欢猫", claim_type: "fact", reason: "原话", confidence: 0.9 },
      { action: "create", content: "我觉得用户很孤独", claim_type: "hypothesis", reason: "推测", confidence: 0.3 },
      { action: "create", content: "小克和用户讨论了钢琴", claim_type: "observation", reason: "观察", confidence: 0.7 },
    ];
    const result = validateMaintenanceOutput(items);
    expect(result.accepted.length).toBe(2);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain("我");
  });
});

describe("Maintenance API", () => {
  beforeEach(async () => {
    mockComplete.mockReset();
    await seedMaintenance();
  });

  describe("POST /maintenance/run", () => {
    it("produces proposals in maintenance_proposals table, not in messages", async () => {
      mockComplete.mockResolvedValue({
        content: JSON.stringify([
          { action: "create", content: "用户提到最近在学钢琴", claim_type: "fact", reason: "用户原话", confidence: 0.9 },
        ]),
        usage: { input_tokens: 100, output_tokens: 50 },
        model_id: "deepseek-chat",
        provider_id: "anthropic",
        finish_reason: "end_turn",
      } satisfies GatewayCompletionResponse);

      const res = await app.request("/maintenance/run", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ conversation_id: "conv-maint-test", task_type: "digest" }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.accepted.length).toBe(1);
      expect(data.accepted[0].status).toBe("pending");

      // Verify proposals table has the entry
      const proposals = await db.select().from(schema.maintenanceProposals);
      expect(proposals.length).toBe(1);
      expect(proposals[0].content).toBe("用户提到最近在学钢琴");
      expect(proposals[0].proposer_model).toBe("deepseek-chat");

      // Verify messages table has NO maintenance entries
      const msgs = await db.select().from(schema.messages).where(sql`sender_ai_id = 'maintenance'`);
      expect(msgs.length).toBe(0);
    });

    it("uses maintenance binding, not resident binding", async () => {
      mockComplete.mockResolvedValue({
        content: "[]",
        usage: { input_tokens: 50, output_tokens: 10 },
        model_id: "deepseek-chat",
        provider_id: "anthropic",
        finish_reason: "end_turn",
      });

      await app.request("/maintenance/run", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ conversation_id: "conv-maint-test", task_type: "digest" }),
      });

      // Verify gateway was called with maintenance model, not xiaoke's
      expect(mockComplete).toHaveBeenCalledTimes(1);
      const req = mockComplete.mock.calls[0][0] as GatewayCompletionRequest;
      expect(req.model_id).toBe("deepseek-chat");
      expect(req.api_provider_id).toBe("provider-b");
    });

    it("rejects first-person output from maintenance model", async () => {
      mockComplete.mockResolvedValue({
        content: JSON.stringify([
          { action: "create", content: "我觉得用户很孤独", claim_type: "hypothesis", reason: "推测", confidence: 0.3 },
          { action: "create", content: "用户提到在学钢琴", claim_type: "fact", reason: "原话", confidence: 0.9 },
        ]),
        usage: { input_tokens: 100, output_tokens: 80 },
        model_id: "deepseek-chat",
        provider_id: "anthropic",
        finish_reason: "end_turn",
      });

      const res = await app.request("/maintenance/run", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ conversation_id: "conv-maint-test", task_type: "digest" }),
      });

      const data = (await res.json()).data;
      expect(data.accepted.length).toBe(1);
      expect(data.rejected.length).toBe(1);
      expect(data.rejected[0].reason).toContain("我");

      // Only accepted proposal in DB
      const proposals = await db.select().from(schema.maintenanceProposals);
      expect(proposals.length).toBe(1);
      expect(proposals[0].content).toBe("用户提到在学钢琴");

      // Audit trail records both accepted and rejected
      const audits = await db.select().from(schema.maintenanceAudit);
      expect(audits.length).toBe(2);
      const rejectedAudit = audits.find((a) => a.decision_reason.includes("REJECTED"));
      expect(rejectedAudit).toBeDefined();
    });

    it("validates conversation exists", async () => {
      const res = await app.request("/maintenance/run", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ conversation_id: "nonexistent", task_type: "digest" }),
      });
      expect(res.status).toBe(404);
    });

    it("validates task_type", async () => {
      const res = await app.request("/maintenance/run", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ conversation_id: "conv-maint-test", task_type: "invalid" }),
      });
      expect(res.status).toBe(400);
    });

    it("drops items with invalid action, claim_type, empty content, or empty reason", async () => {
      mockComplete.mockResolvedValue({
        content: JSON.stringify([
          { action: "DESTROY", content: "非法动作", claim_type: "fact", reason: "test", confidence: 0.9 },
          { action: "create", content: "非法分类", claim_type: "rumor", reason: "test", confidence: 0.5 },
          { action: "create", content: "confidence 越界", claim_type: "fact", reason: "test", confidence: 1.5 },
          { action: "create", content: "", claim_type: "fact", reason: "test", confidence: 0.8 },
          { action: "create", content: "空理由", claim_type: "fact", reason: "", confidence: 0.8 },
          { action: "create", content: 12345, claim_type: "fact", reason: "test", confidence: 0.8 },
          { action: "create", content: "合法条目", claim_type: "fact", reason: "test", confidence: 0.8 },
        ]),
        usage: { input_tokens: 100, output_tokens: 80 },
        model_id: "deepseek-chat",
        provider_id: "anthropic",
        finish_reason: "end_turn",
      });

      const res = await app.request("/maintenance/run", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ conversation_id: "conv-maint-test", task_type: "digest" }),
      });

      const data = (await res.json()).data;
      expect(data.accepted.length).toBe(1);
      expect(data.accepted[0].content).toBe("合法条目");

      const proposals = await db.select().from(schema.maintenanceProposals);
      expect(proposals.length).toBe(1);
    });
  });

  describe("GET /maintenance/proposals", () => {
    it("lists proposals with status filter", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.maintenanceProposals).values([
        { id: "mp-1", conversation_id: "conv-maint-test", action: "create", content: "fact 1", claim_type: "fact", reason: "test", confidence: 0.9, status: "pending", proposer_model: "test", created_at: now },
        { id: "mp-2", conversation_id: "conv-maint-test", action: "create", content: "fact 2", claim_type: "fact", reason: "test", confidence: 0.8, status: "approved", proposer_model: "test", created_at: now },
      ]);

      const allRes = await app.request("/maintenance/proposals", { headers: authHeaders });
      expect((await allRes.json()).data.length).toBe(2);

      const pendingRes = await app.request("/maintenance/proposals?status=pending", { headers: authHeaders });
      expect((await pendingRes.json()).data.length).toBe(1);
    });
  });

  describe("POST /maintenance/proposals/:id/review", () => {
    it("approves pending proposal", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.maintenanceProposals).values({
        id: "mp-review", conversation_id: "conv-maint-test", action: "create", content: "test fact", claim_type: "fact", reason: "test", confidence: 0.9, status: "pending", proposer_model: "test", created_at: now,
      });

      const res = await app.request("/maintenance/proposals/mp-review/review", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ decision: "approved", reason: "看过了没问题" }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.status).toBe("approved");

      // Verify DB updated
      const rows = await db.select().from(schema.maintenanceProposals).where(sql`id = 'mp-review'`);
      expect(rows[0].status).toBe("approved");
    });

    it("rejects already-reviewed proposal", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.maintenanceProposals).values({
        id: "mp-done", conversation_id: "conv-maint-test", action: "create", content: "already done", claim_type: "fact", reason: "test", confidence: 0.9, status: "approved", proposer_model: "test", created_at: now,
      });

      const res = await app.request("/maintenance/proposals/mp-done/review", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ decision: "rejected" }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe("presence guard", () => {
    it("blocks maintenance from being set to active presence", async () => {
      const res = await app.request("/presence/maintenance", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ scene_id: "room-living", state: "active", updated_at: new Date().toISOString() }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("concurrent approval", () => {
    it("only one of N concurrent reviews succeeds", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.maintenanceProposals).values({
        id: "mp-race", conversation_id: "conv-maint-test", action: "create", content: "race test", claim_type: "fact", reason: "test", confidence: 0.9, status: "pending", proposer_model: "test", created_at: now,
      });

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          app.request("/maintenance/proposals/mp-race/review", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ decision: "approved" }),
          }),
        ),
      );

      const statuses = results.map((r) => r.status);
      const successes = statuses.filter((s) => s === 200);
      const conflicts = statuses.filter((s) => s === 409);
      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(4);

      const audits = await db.select().from(schema.maintenanceAudit);
      expect(audits.length).toBe(1);
    });
  });

  describe("residual presence filtering", () => {
    it("excludes maintenance from new conversation participants even if in ai_presence", async () => {
      await db.run(sql`DELETE FROM ai_presence`);
      await db.run(sql`DELETE FROM conversations`);

      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "maintenance", scene_id: "room-living", state: "active", updated_at: new Date().toISOString() },
      ]);

      const res = await app.request("/scenes/room-living/conversation", {
        method: "GET",
        headers: authHeaders,
      });

      expect([200, 201]).toContain(res.status);
      const data = (await res.json()).data;
      const participants = data.participant_ai_ids as string[];
      expect(participants).toContain("xiaoke");
      expect(participants).not.toContain("maintenance");
    });
  });

  describe("isolation guarantees", () => {
    it("swapping maintenance provider does not lose existing proposals", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.maintenanceProposals).values({
        id: "mp-survive", conversation_id: "conv-maint-test", action: "create", content: "should survive", claim_type: "fact", reason: "test", confidence: 0.9, status: "pending", proposer_model: "deepseek-chat", created_at: now,
      });

      // Swap maintenance binding to a different provider
      await db.update(schema.agentModelBindings)
        .set({ api_provider_id: "provider-c", model_id: "haiku-4.5" })
        .where(sql`agent_id = 'maintenance'`);

      // Old proposals still there
      const proposals = await db.select().from(schema.maintenanceProposals);
      expect(proposals.length).toBe(1);
      expect(proposals[0].content).toBe("should survive");
      expect(proposals[0].proposer_model).toBe("deepseek-chat");
    });

    it("maintenance binding fault does not affect resident binding", async () => {
      // Set maintenance offline
      await db.update(schema.agentModelBindings)
        .set({ fault_state: "offline" })
        .where(sql`agent_id = 'maintenance'`);

      // Resident binding still ok
      const residentRows = await db.select().from(schema.agentModelBindings).where(sql`agent_id = 'xiaoke'`);
      expect(residentRows[0].fault_state).toBe("ok");

      // Maintenance run fails gracefully
      const res = await app.request("/maintenance/run", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ conversation_id: "conv-maint-test", task_type: "digest" }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("offline");
    });
  });
});

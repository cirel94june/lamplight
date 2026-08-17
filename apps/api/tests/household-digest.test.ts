import { describe, expect, it, beforeEach, vi } from "vitest";
import type { GatewayCompletionResponse } from "@lamplight/contracts";

const { mockComplete } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
}));

vi.mock("../src/services/gateway/index.js", () => ({
  initGateway: () => ({ complete: mockComplete }),
}));

import { app } from "../src/app.js";
import { db, schema } from "../src/db/index.js";
import { sql } from "drizzle-orm";
import { validateDigestObjectivity } from "../src/services/maintenance/validator.js";

const TOKEN = "test-token-123";
process.env.OWNER_TOKEN = TOKEN;
const authHeaders = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function seedDigestScenario() {
  await db.run(sql`DELETE FROM household_digests`);
  await db.run(sql`DELETE FROM maintenance_proposals`);
  await db.run(sql`DELETE FROM maintenance_audit`);
  await db.run(sql`DELETE FROM messages`);
  await db.run(sql`DELETE FROM conversations`);
  await db.run(sql`DELETE FROM agent_model_bindings`);
  await db.run(sql`DELETE FROM agent_runtime_configs`);
  await db.run(sql`DELETE FROM agent_profiles`);
  await db.run(sql`DELETE FROM ai_presence`);
  await db.run(sql`DELETE FROM scenes`);

  await db.insert(schema.scenes).values([
    { scene_id: "room-living", display_name: "客厅", type: "room", prompt_weight_overrides: {} },
    { scene_id: "room-private-lucien", display_name: "Lucien的房间", type: "private", prompt_weight_overrides: {} },
  ]);

  await db.insert(schema.agentProfiles).values([
    { agent_id: "lucien", display_name: "Lucien", memory_scope: "lucien" },
    { agent_id: "cloudy", display_name: "Cloudy", memory_scope: "cloudy" },
    { agent_id: "jasper", display_name: "Jasper", memory_scope: "jasper" },
    { agent_id: "maintenance", display_name: "维护模型", memory_scope: "maintenance" },
  ]);

  await db.insert(schema.agentModelBindings).values([
    { id: "bind-lucien", agent_id: "lucien", api_provider_id: "prov-a", provider_id: "anthropic", model_id: "claude-opus-4-6" },
    { id: "bind-cloudy", agent_id: "cloudy", api_provider_id: "prov-a", provider_id: "anthropic", model_id: "claude-opus-4-6" },
    { id: "bind-jasper", agent_id: "jasper", api_provider_id: "prov-a", provider_id: "anthropic", model_id: "claude-opus-4-6" },
    { id: "bind-maint", agent_id: "maintenance", api_provider_id: "prov-b", provider_id: "anthropic", model_id: "deepseek-chat" },
  ]);

  await db.insert(schema.agentRuntimeConfigs).values([
    { agent_id: "lucien", random_reply_affinity: 0.7, max_response_tokens: 1024 },
    { agent_id: "cloudy", random_reply_affinity: 0.7, max_response_tokens: 1024 },
    { agent_id: "jasper", random_reply_affinity: 0.7, max_response_tokens: 1024 },
    { agent_id: "maintenance", random_reply_affinity: 0, max_response_tokens: 2048, temperature: 0.3,
      system_prompt_template: "你是后台维护模型。客观整理，第三人称。" },
  ]);

  const now = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  await db.insert(schema.conversations).values([
    {
      id: "conv-living",
      kind: "house_chat",
      scene_id: "room-living",
      participant_ai_ids: ["lucien", "cloudy", "jasper"] as any,
      status: "active",
      created_at: oneHourAgo,
      updated_at: now,
    },
    {
      id: "conv-private",
      kind: "house_chat",
      scene_id: "room-private-lucien",
      participant_ai_ids: ["lucien"] as any,
      status: "active",
      created_at: oneHourAgo,
      updated_at: now,
    },
  ]);

  await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at) VALUES ('msg-u1', 'conv-living', 'house_chat', 1, 'user', '今天天气真好，要不要出去走走？', 'out_of_world', 'server', ${oneHourAgo})`);
  await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at) VALUES ('msg-l1', 'conv-living', 'house_chat', 2, 'ai', 'lucien', '好主意，我知道一条不错的散步路线。', 'out_of_world', 'server', ${oneHourAgo})`);
  await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at) VALUES ('msg-c1', 'conv-living', 'house_chat', 3, 'ai', 'cloudy', '我也想去！可以带上相机拍照。', 'out_of_world', 'server', ${oneHourAgo})`);
  await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at) VALUES ('msg-j1', 'conv-living', 'house_chat', 4, 'ai', 'jasper', '天气确实不错，但别忘了明天还有事。', 'out_of_world', 'server', ${now})`);

  await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at) VALUES ('msg-priv1', 'conv-private', 'house_chat', 1, 'ai', 'lucien', '今天有点累，想安静待一会儿。', 'out_of_world', 'server', ${now})`);
}

describe("Digest objectivity validator", () => {
  it("accepts objective public facts", () => {
    expect(validateDigestObjectivity("用户提议出去散步，Lucien 和 Cloudy 表示赞同").valid).toBe(true);
    expect(validateDigestObjectivity("Jasper 提醒明天还有事").valid).toBe(true);
    expect(validateDigestObjectivity("客厅讨论了天气和散步计划").valid).toBe(true);
  });

  it("rejects collective subjective statements (red line #11)", () => {
    expect(validateDigestObjectivity("大家都认为 Ceci 真正担心的是工作").valid).toBe(false);
    expect(validateDigestObjectivity("大家都觉得天气很好应该出门").valid).toBe(false);
    expect(validateDigestObjectivity("所有人都认为 Lucien 太累了").valid).toBe(false);
    expect(validateDigestObjectivity("Ceci 真正担心的是项目进度").valid).toBe(false);
    expect(validateDigestObjectivity("Lucien 内心其实不想出门").valid).toBe(false);
  });

  it("rejects English subjective collective patterns", () => {
    expect(validateDigestObjectivity("everyone thinks Ceci is worried").valid).toBe(false);
    expect(validateDigestObjectivity("they all feel that the mood was tense").valid).toBe(false);
    expect(validateDigestObjectivity("what Lucien really means is he wants to rest").valid).toBe(false);
  });

  it("still rejects first-person content in digest mode", () => {
    expect(validateDigestObjectivity("我觉得用户心情不好").valid).toBe(false);
    expect(validateDigestObjectivity("I think the user is sad").valid).toBe(false);
  });
});

describe("HouseholdDigest API", () => {
  beforeEach(async () => {
    mockComplete.mockReset();
    await seedDigestScenario();
  });

  describe("POST /maintenance/generate-digest", () => {
    it("generates digest from public room conversations only", async () => {
      mockComplete.mockResolvedValue({
        content: JSON.stringify([
          { action: "create", content: "用户提议出去散步，三位居民讨论了天气", claim_type: "fact", reason: "公共事实", confidence: 0.9 },
        ]),
        usage: { input_tokens: 100, output_tokens: 50 },
        model_id: "deepseek-chat",
        provider_id: "anthropic",
        finish_reason: "end_turn",
      } satisfies GatewayCompletionResponse);

      const res = await app.request("/maintenance/generate-digest", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.results.length).toBe(1);
      expect(data.results[0].scene_id).toBe("room-living");
      expect(data.results[0].accepted.length).toBe(1);

      const proposals = await db.select().from(schema.maintenanceProposals);
      expect(proposals.length).toBe(1);
      expect(proposals[0].task_type).toBe("digest");
    });

    it("excludes private room conversations", async () => {
      mockComplete.mockResolvedValue({
        content: JSON.stringify([
          { action: "create", content: "公共事实", claim_type: "fact", reason: "test", confidence: 0.9 },
        ]),
        usage: { input_tokens: 50, output_tokens: 20 },
        model_id: "deepseek-chat",
        provider_id: "anthropic",
        finish_reason: "end_turn",
      });

      const res = await app.request("/maintenance/generate-digest", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({}),
      });

      const data = (await res.json()).data;
      const sceneIds = data.results.map((r: any) => r.scene_id);
      expect(sceneIds).not.toContain("room-private-lucien");
    });

    it("rejects subjective content in digest mode", async () => {
      mockComplete.mockResolvedValue({
        content: JSON.stringify([
          { action: "create", content: "大家都认为 Ceci 真正担心的是工作", claim_type: "hypothesis", reason: "推测", confidence: 0.3 },
          { action: "create", content: "用户和三位居民讨论了散步计划", claim_type: "fact", reason: "公共事实", confidence: 0.9 },
        ]),
        usage: { input_tokens: 100, output_tokens: 80 },
        model_id: "deepseek-chat",
        provider_id: "anthropic",
        finish_reason: "end_turn",
      });

      const res = await app.request("/maintenance/generate-digest", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({}),
      });

      const data = (await res.json()).data;
      expect(data.results[0].accepted.length).toBe(1);
      expect(data.results[0].rejected.length).toBe(1);
      expect(data.results[0].rejected[0].reason).toContain("大家都认为");
    });
  });

  describe("approval → household_digests materialization", () => {
    it("approved digest proposal materializes into household_digests", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.maintenanceProposals).values({
        id: "mp-digest-1",
        conversation_id: "conv-living",
        action: "create",
        content: "客厅讨论了散步计划",
        claim_type: "fact",
        reason: "公共事实",
        confidence: 0.9,
        status: "pending",
        proposer_model: "deepseek-chat",
        task_type: "digest",
        created_at: now,
      });

      const res = await app.request("/maintenance/proposals/mp-digest-1/review", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ decision: "approved", reason: "确认" }),
      });

      expect(res.status).toBe(200);

      const digests = await db.select().from(schema.householdDigests);
      expect(digests.length).toBe(1);
      expect(digests[0].content).toBe("客厅讨论了散步计划");
      expect(digests[0].scene_id).toBe("room-living");
      expect(digests[0].proposal_id).toBe("mp-digest-1");
      expect(digests[0].proposer_model).toBe("deepseek-chat");
    });

    it("rejected digest proposal does NOT materialize", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.maintenanceProposals).values({
        id: "mp-digest-rej",
        conversation_id: "conv-living",
        action: "create",
        content: "something rejected",
        claim_type: "fact",
        reason: "test",
        confidence: 0.9,
        status: "pending",
        proposer_model: "deepseek-chat",
        task_type: "digest",
        created_at: now,
      });

      await app.request("/maintenance/proposals/mp-digest-rej/review", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ decision: "rejected", reason: "不准确" }),
      });

      const digests = await db.select().from(schema.householdDigests);
      expect(digests.length).toBe(0);
    });

    it("approved non-digest proposal does NOT write to household_digests", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.maintenanceProposals).values({
        id: "mp-classify-1",
        conversation_id: "conv-living",
        action: "create",
        content: "classified item",
        claim_type: "fact",
        reason: "test",
        confidence: 0.9,
        status: "pending",
        proposer_model: "deepseek-chat",
        task_type: "classify",
        created_at: now,
      });

      await app.request("/maintenance/proposals/mp-classify-1/review", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ decision: "approved", reason: "ok" }),
      });

      const digests = await db.select().from(schema.householdDigests);
      expect(digests.length).toBe(0);
    });
  });

  describe("GET /household-digest", () => {
    it("returns all digests when no time filter", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.householdDigests).values([
        { id: "hd-1", scene_id: "room-living", conversation_id: "conv-living", content: "fact 1", claim_type: "fact", period_start: "2026-08-16T00:00:00Z", period_end: "2026-08-16T12:00:00Z", proposer_model: "deepseek-chat", created_at: now },
        { id: "hd-2", scene_id: "room-living", conversation_id: "conv-living", content: "fact 2", claim_type: "fact", period_start: "2026-08-17T00:00:00Z", period_end: "2026-08-17T12:00:00Z", proposer_model: "deepseek-chat", created_at: now },
      ]);

      const res = await app.request("/household-digest", { headers: authHeaders });
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.length).toBe(2);
    });

    it("filters by time range", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.householdDigests).values([
        { id: "hd-old", scene_id: "room-living", conversation_id: "conv-living", content: "old fact", claim_type: "fact", period_start: "2026-08-10T00:00:00Z", period_end: "2026-08-10T12:00:00Z", proposer_model: "test", created_at: now },
        { id: "hd-new", scene_id: "room-living", conversation_id: "conv-living", content: "new fact", claim_type: "fact", period_start: "2026-08-17T00:00:00Z", period_end: "2026-08-17T12:00:00Z", proposer_model: "test", created_at: now },
      ]);

      const res = await app.request("/household-digest?since=2026-08-15T00:00:00Z", { headers: authHeaders });
      const data = (await res.json()).data;
      expect(data.length).toBe(1);
      expect(data[0].content).toBe("new fact");
    });
  });

  describe("provider swap resilience", () => {
    it("changing maintenance provider does not lose existing digests", async () => {
      const now = new Date().toISOString();
      await db.insert(schema.householdDigests).values({
        id: "hd-survive", scene_id: "room-living", conversation_id: "conv-living",
        content: "should survive provider swap", claim_type: "fact",
        period_start: "2026-08-17T00:00:00Z", period_end: "2026-08-17T12:00:00Z",
        proposer_model: "deepseek-chat", created_at: now,
      });

      await db.update(schema.agentModelBindings)
        .set({ api_provider_id: "prov-c", model_id: "haiku-4.5" })
        .where(sql`agent_id = 'maintenance'`);

      const digests = await db.select().from(schema.householdDigests);
      expect(digests.length).toBe(1);
      expect(digests[0].content).toBe("should survive provider swap");
      expect(digests[0].proposer_model).toBe("deepseek-chat");
    });
  });
});

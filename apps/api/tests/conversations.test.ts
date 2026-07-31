import { describe, expect, it, beforeAll, beforeEach, vi, afterEach } from "vitest";
import { app } from "../src/app.js";
import { db, schema } from "../src/db/index.js";
import { sql } from "drizzle-orm";
import * as broadcastModule from "../src/broadcast.js";

const TOKEN = "test-token-123";

beforeAll(() => {
  process.env.OWNER_TOKEN = TOKEN;
});

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

async function seedScene() {
  await db.run(sql`DELETE FROM scenes`);
  await db.insert(schema.scenes).values({
    scene_id: "room-living-room",
    display_name: "客厅",
    type: "room",
    prompt_weight_overrides: {},
    default_turn_policy: {
      policy_id: "living-room-default",
      triggers: {
        on_user_message: "all_present",
        on_agent_message: {
          mention: true,
          random: true,
          cooldown_ms: 5000,
          max_consecutive: 2,
        },
      },
    },
  });
}

async function seedPresence() {
  await db.run(sql`DELETE FROM ai_presence`);
  await db.insert(schema.aiPresence).values([
    { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
    { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
  ]);
}

describe("Conversation API", () => {
  beforeEach(async () => {
    await db.run(sql`DELETE FROM messages`);
    await db.run(sql`DELETE FROM conversations`);
    await seedScene();
    await seedPresence();
  });

  describe("POST /conversations", () => {
    it("creates a conversation bound to scene", async () => {
      const res = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.scene_id).toBe("room-living-room");
      expect(body.data.kind).toBe("house_chat");
      expect(body.data.status).toBe("active");
      expect(body.data.participant_ai_ids).toContain("xiaoke");
      expect(body.data.participant_ai_ids).toContain("lucien");
      expect(body.data.turn_policy).toBeDefined();
      expect(body.data.turn_policy.policy_id).toBe("living-room-default");
    });

    it("returns 404 for nonexistent scene", async () => {
      const res = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "nonexistent" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when scene already has an active conversation", async () => {
      const res1 = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      expect(res1.status).toBe(201);

      const res2 = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      expect(res2.status).toBe(409);
      const body = await res2.json();
      expect(body.error.code).toBe("CONFLICT");
    });

    it("concurrent POST /conversations returns 409 not 500", async () => {
      const requests = Array.from({ length: 12 }, () =>
        app.request("/conversations", {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ scene_id: "room-living-room" }),
        }),
      );

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);
      const created = statuses.filter((s) => s === 201);
      const conflicts = statuses.filter((s) => s === 409);
      const serverErrors = statuses.filter((s) => s >= 500);

      expect(created.length).toBe(1);
      expect(conflicts.length).toBe(11);
      expect(serverErrors.length).toBe(0);
    });

    it("returns 400 without scene_id", async () => {
      const res = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /conversations/:id", () => {
    it("returns conversation details", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: created } = await createRes.json();

      const res = await app.request(`/conversations/${created.id}`, {
        headers: authHeaders,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe(created.id);
      expect(body.data.kind).toBe("house_chat");
    });

    it("returns 404 for nonexistent conversation", async () => {
      const res = await app.request("/conversations/nonexistent", {
        headers: authHeaders,
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /conversations/:id/messages", () => {
    it("creates a user message and returns it", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "大家好！" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.content).toBe("大家好！");
      expect(body.data.sender.type).toBe("user");
      expect(body.data.conversation_id).toBe(conv.id);
      expect(body.data.conversation_kind).toBe("house_chat");
      expect(body.data.context.context_type).toBe("out_of_world");
      expect(body.data.context.set_by).toBe("server");
    });

    it("rejects empty content", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects messages to nonexistent conversation", async () => {
      const res = await app.request("/conversations/nonexistent/messages", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(res.status).toBe(404);
    });

    it("rejects malformed mentioned_agent_ids", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello", mentioned_agent_ids: [{ id: "xiaoke" }] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("string array");
    });

    it("rejects empty-string mentioned_agent_ids", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello", mentioned_agent_ids: [""] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("empty");
    });

    it("rejects whitespace-only mentioned_agent_ids", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello", mentioned_agent_ids: ["  "] }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects messages to archived conversation", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      await db.run(sql`UPDATE conversations SET status = 'archived' WHERE id = ${conv.id}`);

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("CONVERSATION_ARCHIVED");
    });
  });

  describe("GET /conversations/:id/messages", () => {
    it("returns message history", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "message 1" }),
      });
      await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "message 2" }),
      });

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        headers: authHeaders,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      const userMsgs = body.data.filter((m: any) => m.sender.type === "user");
      expect(userMsgs.length).toBe(2);
    });

    it("returns 404 for nonexistent conversation", async () => {
      const res = await app.request("/conversations/nonexistent/messages", {
        headers: authHeaders,
      });

      expect(res.status).toBe(404);
    });

    it("supports pagination with cursor", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      for (let i = 0; i < 3; i++) {
        await app.request(`/conversations/${conv.id}/messages`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ content: `message ${i}` }),
        });
      }

      const res1 = await app.request(`/conversations/${conv.id}/messages?limit=2`, {
        headers: authHeaders,
      });
      const body1 = await res1.json();
      expect(body1.data.length).toBe(2);
      expect(body1.next_cursor).toBeTruthy();

      const res2 = await app.request(
        `/conversations/${conv.id}/messages?limit=2&cursor=${body1.next_cursor}`,
        { headers: authHeaders },
      );
      const body2 = await res2.json();
      expect(body2.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /scenes/:id/conversation", () => {
    it("creates a new conversation for scene with no active conversation", async () => {
      const res = await app.request("/scenes/room-living-room/conversation", {
        headers: authHeaders,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.scene_id).toBe("room-living-room");
      expect(body.data.kind).toBe("house_chat");
      expect(body.data.status).toBe("active");
      expect(body.data.participant_ai_ids).toContain("xiaoke");
    });

    it("returns existing active conversation", async () => {
      const res1 = await app.request("/scenes/room-living-room/conversation", {
        headers: authHeaders,
      });
      const body1 = await res1.json();

      const res2 = await app.request("/scenes/room-living-room/conversation", {
        headers: authHeaders,
      });
      const body2 = await res2.json();

      expect(res2.status).toBe(200);
      expect(body2.data.id).toBe(body1.data.id);
    });

    it("returns 404 for nonexistent scene", async () => {
      const res = await app.request("/scenes/nonexistent/conversation", {
        headers: authHeaders,
      });

      expect(res.status).toBe(404);
    });
  });

  describe("server-injected context", () => {
    it("always sets context_type and set_by from server, ignoring client values", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "test",
          context_type: "in_world",
          set_by: "client",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.context.context_type).toBe("out_of_world");
      expect(body.data.context.set_by).toBe("server");
    });

    it("derives conversation_kind from conversation, not client input", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();

      const res = await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "test" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.conversation_kind).toBe("house_chat");
    });
  });

  describe("active-only presence filtering", () => {
    it("excludes idle/away agents from conversation participants", async () => {
      await db.run(sql`DELETE FROM ai_presence`);
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
        { ai_id: "jasper", scene_id: "room-living-room", state: "away", updated_at: new Date().toISOString() },
      ]);

      const res = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.participant_ai_ids).toContain("xiaoke");
      expect(body.data.participant_ai_ids).not.toContain("lucien");
      expect(body.data.participant_ai_ids).not.toContain("jasper");
    });

    it("GET /scenes/:id/conversation also excludes non-active agents", async () => {
      await db.run(sql`DELETE FROM ai_presence`);
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
      ]);

      const res = await app.request("/scenes/room-living-room/conversation", {
        headers: authHeaders,
      });

      const body = await res.json();
      expect(body.data.participant_ai_ids).toContain("xiaoke");
      expect(body.data.participant_ai_ids).not.toContain("lucien");
    });
  });

  describe("concurrent get-or-create safety", () => {
    it("parallel requests produce exactly one active conversation", async () => {
      const requests = Array.from({ length: 8 }, () =>
        app.request("/scenes/room-living-room/conversation", {
          headers: authHeaders,
        }),
      );

      const responses = await Promise.all(requests);
      const bodies = await Promise.all(responses.map((r) => r.json()));

      const ids = new Set(bodies.map((b: any) => b.data.id));
      expect(ids.size).toBe(1);

      const activeConvs = await db
        .select()
        .from(schema.conversations)
        .where(sql`scene_id = 'room-living-room' AND status = 'active'`);
      expect(activeConvs.length).toBe(1);
    });
  });

  describe("WebSocket broadcast integration", () => {
    let broadcastSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      broadcastSpy = vi.spyOn(broadcastModule, "broadcast");
    });

    afterEach(() => {
      broadcastSpy.mockRestore();
    });

    it("broadcasts new_message for user message", async () => {
      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();
      broadcastSpy.mockClear();

      await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello everyone" }),
      });

      const newMsgCalls = broadcastSpy.mock.calls.filter(
        ([msg]) => msg.type === "new_message",
      );
      expect(newMsgCalls.length).toBeGreaterThanOrEqual(1);

      const userBroadcast = newMsgCalls[0][0] as broadcastModule.BroadcastMessage;
      expect(userBroadcast.type).toBe("new_message");
      expect((userBroadcast.data as any).content).toBe("hello everyone");
      expect((userBroadcast.data as any).sender.type).toBe("user");
    });

    it("agent failure broadcasts agent_done to clear typing state", async () => {
      // Seed agent profiles so TurnEvaluator returns eligible agents
      await db.run(sql`DELETE FROM agent_profiles`);
      await db.insert(schema.agentProfiles).values([
        { agent_id: "xiaoke", display_name: "小克", memory_scope: "xiaoke" },
      ]);
      await db.run(sql`DELETE FROM agent_model_bindings`);
      await db.insert(schema.agentModelBindings).values([
        { id: "bind-xiaoke", agent_id: "xiaoke", api_provider_id: "test-provider", provider_id: "anthropic", model_id: "claude-opus-4-6" },
      ]);
      await db.run(sql`DELETE FROM agent_runtime_configs`);
      await db.insert(schema.agentRuntimeConfigs).values([
        {
          agent_id: "xiaoke",
          random_reply_affinity: 0.7,
          max_response_tokens: 1024,
          temperature: 0.8,
          system_prompt_template: "test",
        },
      ]);

      const createRes = await app.request("/conversations", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "room-living-room" }),
      });
      const { data: conv } = await createRes.json();
      broadcastSpy.mockClear();

      // No API keys configured → gateway will fail → agent fails
      await app.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      // Wait for async trigger to complete
      await new Promise((r) => setTimeout(r, 200));

      const typingCalls = broadcastSpy.mock.calls.filter(
        ([msg]) => msg.type === "agent_typing",
      );
      const doneCalls = broadcastSpy.mock.calls.filter(
        ([msg]) => msg.type === "agent_done",
      );

      // Every agent that started typing must have a corresponding agent_done
      for (const [typingMsg] of typingCalls) {
        const agentId = (typingMsg.data as any).agent_id;
        const hasDone = doneCalls.some(
          ([doneMsg]) => (doneMsg.data as any).agent_id === agentId,
        );
        expect(hasDone).toBe(true);
      }
    });
  });
});

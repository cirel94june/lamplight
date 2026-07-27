import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { app } from "../src/app.js";
import { db, schema } from "../src/db/index.js";
import { sql } from "drizzle-orm";

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
    { ai_id: "xiaoke", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
    { ai_id: "lucien", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
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
});

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { app } from "../src/app.js";
import { db, schema } from "../src/db/index.js";

const TOKEN = "test-token-123";

beforeAll(() => {
  process.env.OWNER_TOKEN = TOKEN;
});

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

describe("PUT /presence/:ai_id", () => {
  beforeEach(async () => {
    await db.delete(schema.aiPresence);
  });

  it("requires auth", async () => {
    const res = await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-living-room",
        state: "active",
        updated_at: new Date().toISOString(),
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("creates presence for a new AI", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-living-room",
        state: "active",
        updated_at: now,
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.ai_id).toBe("xiaoke");
    expect(body.data.state).toBe("active");
  });

  it("updates existing presence (upsert)", async () => {
    const now = new Date().toISOString();
    await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-study",
        state: "active",
        updated_at: now,
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });

    const res = await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-living-room",
        state: "idle",
        updated_at: now,
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);

    const listRes = await app.request("/presence", { headers: authHeaders });
    const listBody = await listRes.json();
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].scene_id).toBe("room-living-room");
    expect(listBody.data[0].state).toBe("idle");
  });

  it("rejects invalid state", async () => {
    const res = await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-study",
        state: "sleeping",
        updated_at: new Date().toISOString(),
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects future updated_at", async () => {
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-study",
        state: "active",
        updated_at: futureTime,
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("future");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await app.request("/presence/xiaoke", {
      method: "PUT",
      body: "not json{",
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for null body", async () => {
    const res = await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify(null),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("accepts null scene_id (AI not in any room)", async () => {
    const res = await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: null,
        state: "away",
        updated_at: new Date().toISOString(),
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scene_id).toBeNull();
  });
});

describe("GET /presence", () => {
  beforeEach(async () => {
    await db.delete(schema.aiPresence);
  });

  it("requires auth", async () => {
    const res = await app.request("/presence");
    expect(res.status).toBe(401);
  });

  it("returns all AI presence", async () => {
    const now = new Date().toISOString();
    for (const id of ["xiaoke", "lucien", "jasper"]) {
      await app.request(`/presence/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          scene_id: "room-living-room",
          state: "active",
          updated_at: now,
        }),
        headers: { ...authHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await app.request("/presence", { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });

  it("expires active presence older than threshold to idle", async () => {
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-study",
        state: "active",
        updated_at: staleTime,
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });

    const res = await app.request("/presence", { headers: authHeaders });
    const body = await res.json();
    expect(body.data[0].state).toBe("idle");
  });

  it("does not expire recently active presence", async () => {
    const recentTime = new Date().toISOString();
    await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-study",
        state: "active",
        updated_at: recentTime,
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });

    const res = await app.request("/presence", { headers: authHeaders });
    const body = await res.json();
    expect(body.data[0].state).toBe("active");
  });

  it("does not expire idle or away states", async () => {
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await app.request("/presence/xiaoke", {
      method: "PUT",
      body: JSON.stringify({
        scene_id: "room-study",
        state: "away",
        updated_at: staleTime,
      }),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });

    const res = await app.request("/presence", { headers: authHeaders });
    const body = await res.json();
    expect(body.data[0].state).toBe("away");
  });
});

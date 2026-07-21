import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { app } from "../src/app.js";
import { db, schema } from "../src/db/index.js";

const TOKEN = "test-token-123";

beforeAll(() => {
  process.env.OWNER_TOKEN = TOKEN;
});

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: "ai_moved",
    actor: { type: "ai", ai_id: "xiaoke" },
    scene_id: "room-living-room",
    payload: { from: "room-study", to: "room-living-room" },
    description: "小克走进了客厅",
    context: {
      context_type: "out_of_world",
      set_by: "server",
    },
    conversation_kind: "house_chat",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("POST /house-events", () => {
  beforeEach(async () => {
    await db.delete(schema.houseEvents);
  });

  it("requires auth", async () => {
    const res = await app.request("/house-events", {
      method: "POST",
      body: JSON.stringify(makeEvent()),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("creates an event with valid payload", async () => {
    const event = makeEvent();
    const res = await app.request("/house-events", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(event.id);
  });

  it("rejects invalid event (missing context)", async () => {
    const { context, ...rest } = makeEvent();
    const res = await app.request("/house-events", {
      method: "POST",
      body: JSON.stringify(rest),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects event with invalid context for conversation_kind", async () => {
    const event = makeEvent({
      context: {
        context_type: "in_world",
        set_by: "server",
      },
      conversation_kind: "house_chat",
    });
    const res = await app.request("/house-events", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /house-events", () => {
  beforeEach(async () => {
    await db.delete(schema.houseEvents);
  });

  it("requires auth", async () => {
    const res = await app.request("/house-events");
    expect(res.status).toBe(401);
  });

  it("returns events in descending order", async () => {
    const e1 = makeEvent({ id: "evt-1", created_at: "2026-07-21T01:00:00Z" });
    const e2 = makeEvent({ id: "evt-2", created_at: "2026-07-21T02:00:00Z" });

    for (const ev of [e1, e2]) {
      await app.request("/house-events", {
        method: "POST",
        body: JSON.stringify(ev),
        headers: { ...authHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await app.request("/house-events", { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("evt-2");
    expect(body.data[1].id).toBe("evt-1");
  });

  it("filters by since parameter", async () => {
    const e1 = makeEvent({ id: "evt-old", created_at: "2026-07-20T01:00:00Z" });
    const e2 = makeEvent({ id: "evt-new", created_at: "2026-07-21T02:00:00Z" });

    for (const ev of [e1, e2]) {
      await app.request("/house-events", {
        method: "POST",
        body: JSON.stringify(ev),
        headers: { ...authHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await app.request("/house-events?since=2026-07-21T00:00:00Z", {
      headers: authHeaders,
    });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("evt-new");
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await app.request("/house-events", {
        method: "POST",
        body: JSON.stringify(
          makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }),
        ),
        headers: { ...authHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await app.request("/house-events?limit=3", {
      headers: authHeaders,
    });
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });
});

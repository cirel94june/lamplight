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
    },
    conversation_kind: "house_chat",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

async function postEvent(event: Record<string, unknown>) {
  return app.request("/house-events", {
    method: "POST",
    body: JSON.stringify(event),
    headers: { ...authHeaders, "Content-Type": "application/json" },
  });
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
    const res = await postEvent(event);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe(event.id);
  });

  it("server injects set_by regardless of client value", async () => {
    const event = makeEvent({
      context: { context_type: "out_of_world", set_by: "client" },
    });
    const res = await postEvent(event);
    expect(res.status).toBe(201);

    const listRes = await app.request("/house-events", { headers: authHeaders });
    const listBody = await listRes.json();
    expect(listBody.data[0].context.set_by).toBe("server");
  });

  it("accepts event without set_by (server provides it)", async () => {
    const event = makeEvent({
      context: { context_type: "out_of_world" },
    });
    const res = await postEvent(event);
    expect(res.status).toBe(201);
  });

  it("rejects invalid event (missing context)", async () => {
    const { context, ...rest } = makeEvent();
    const res = await postEvent(rest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects event with invalid context for conversation_kind", async () => {
    const event = makeEvent({
      context: { context_type: "in_world" },
      conversation_kind: "house_chat",
    });
    const res = await postEvent(event);
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await app.request("/house-events", {
      method: "POST",
      body: "not json{",
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("stores created_at in normalized UTC ISO format", async () => {
    const event = makeEvent({
      id: "evt-normalize",
      created_at: "2026-07-21T08:00:00Z",
    });
    await postEvent(event);

    const res = await app.request("/house-events", { headers: authHeaders });
    const body = await res.json();
    expect(body.data[0].created_at).toBe("2026-07-21T08:00:00.000Z");
  });

  it("orders correctly when timestamps have varying precision", async () => {
    const e1 = makeEvent({ id: "evt-no-ms", created_at: "2026-07-21T01:00:00Z" });
    const e2 = makeEvent({ id: "evt-ms", created_at: "2026-07-21T02:00:00.500Z" });
    const e3 = makeEvent({ id: "evt-late", created_at: "2026-07-21T03:00:00Z" });

    await postEvent(e1);
    await postEvent(e2);
    await postEvent(e3);

    const res = await app.request("/house-events", { headers: authHeaders });
    const body = await res.json();
    expect(body.data.map((e: { id: string }) => e.id)).toEqual([
      "evt-late",
      "evt-ms",
      "evt-no-ms",
    ]);
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
      await postEvent(ev);
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
      await postEvent(ev);
    }

    const res = await app.request("/house-events?since=2026-07-21T00:00:00Z", {
      headers: authHeaders,
    });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("evt-new");
  });

  it("supports before parameter for backward pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await postEvent(
        makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }),
      );
    }

    const res = await app.request(
      "/house-events?before=2026-07-21T03:00:00Z&limit=2",
      { headers: authHeaders },
    );
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("evt-2");
    expect(body.data[1].id).toBe("evt-1");
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await postEvent(
        makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }),
      );
    }

    const res = await app.request("/house-events?limit=3", {
      headers: authHeaders,
    });
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });

  it("clamps limit=-1 to default 50", async () => {
    for (let i = 0; i < 3; i++) {
      await postEvent(
        makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }),
      );
    }

    const res = await app.request("/house-events?limit=-1", {
      headers: authHeaders,
    });
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });

  it("clamps limit=banana to default 50", async () => {
    for (let i = 0; i < 3; i++) {
      await postEvent(
        makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }),
      );
    }

    const res = await app.request("/house-events?limit=banana", {
      headers: authHeaders,
    });
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });
});

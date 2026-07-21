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

  it("server injects context and conversation_kind, ignoring client values", async () => {
    const event = makeEvent({
      context: { context_type: "in_world", set_by: "client", world_id: "fake" },
      conversation_kind: "game_world",
    });
    const res = await postEvent(event);
    expect(res.status).toBe(201);

    const listRes = await app.request("/house-events", { headers: authHeaders });
    const listBody = await listRes.json();
    const stored = listBody.data[0];
    expect(stored.context.context_type).toBe("out_of_world");
    expect(stored.context.set_by).toBe("server");
    expect(stored.context).not.toHaveProperty("world_id");
    expect(stored.conversation_kind).toBe("house_chat");
  });

  it("accepts event without context or conversation_kind (server provides them)", async () => {
    const event = makeEvent();
    const res = await postEvent(event);
    expect(res.status).toBe(201);

    const listRes = await app.request("/house-events", { headers: authHeaders });
    const listBody = await listRes.json();
    expect(listBody.data[0].context.context_type).toBe("out_of_world");
    expect(listBody.data[0].conversation_kind).toBe("house_chat");
  });

  it("rejects invalid event (missing type)", async () => {
    const { type, ...rest } = makeEvent();
    const res = await postEvent(rest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await app.request("/house-events", {
      method: "POST",
      body: "not json{",
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for null body", async () => {
    const res = await app.request("/house-events", {
      method: "POST",
      body: JSON.stringify(null),
      headers: { ...authHeaders, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("stores created_at in normalized UTC ISO format", async () => {
    const event = makeEvent({ id: "evt-normalize", created_at: "2026-07-21T08:00:00Z" });
    await postEvent(event);

    const res = await app.request("/house-events", { headers: authHeaders });
    const body = await res.json();
    expect(body.data[0].created_at).toBe("2026-07-21T08:00:00.000Z");
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
    for (const ev of [e1, e2]) await postEvent(ev);

    const res = await app.request("/house-events", { headers: authHeaders });
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("evt-2");
    expect(body.data[1].id).toBe("evt-1");
  });

  it("filters by since parameter", async () => {
    const e1 = makeEvent({ id: "evt-old", created_at: "2026-07-20T01:00:00Z" });
    const e2 = makeEvent({ id: "evt-new", created_at: "2026-07-21T02:00:00Z" });
    for (const ev of [e1, e2]) await postEvent(ev);

    const res = await app.request("/house-events?since=2026-07-21T00:00:00Z", {
      headers: authHeaders,
    });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("evt-new");
  });

  it("since and before work together", async () => {
    const events = [
      makeEvent({ id: "evt-1", created_at: "2026-07-20T01:00:00Z" }),
      makeEvent({ id: "evt-2", created_at: "2026-07-21T01:00:00Z" }),
      makeEvent({ id: "evt-3", created_at: "2026-07-22T01:00:00Z" }),
    ];
    for (const ev of events) await postEvent(ev);

    const res = await app.request(
      "/house-events?since=2026-07-20T12:00:00Z&before=2026-07-22T00:00:00Z",
      { headers: authHeaders },
    );
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("evt-2");
  });

  it("returns 400 for invalid since", async () => {
    const res = await app.request("/house-events?since=banana", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid before", async () => {
    const res = await app.request("/house-events?before=not-a-date", {
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await postEvent(makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }));
    }

    const res = await app.request("/house-events?limit=3", { headers: authHeaders });
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });

  it("clamps limit=-1 to default 50", async () => {
    for (let i = 0; i < 3; i++) {
      await postEvent(makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }));
    }
    const res = await app.request("/house-events?limit=-1", { headers: authHeaders });
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });

  it("clamps limit=banana to default 50", async () => {
    for (let i = 0; i < 3; i++) {
      await postEvent(makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }));
    }
    const res = await app.request("/house-events?limit=banana", { headers: authHeaders });
    const body = await res.json();
    expect(body.data).toHaveLength(3);
  });

  it("returns next_cursor when page is full", async () => {
    for (let i = 0; i < 5; i++) {
      await postEvent(makeEvent({ id: `evt-${i}`, created_at: `2026-07-21T0${i}:00:00Z` }));
    }

    const res = await app.request("/house-events?limit=3", { headers: authHeaders });
    const body = await res.json();
    expect(body.next_cursor).toBeTruthy();
    expect(body.data).toHaveLength(3);
  });

  it("returns null next_cursor when no more pages", async () => {
    await postEvent(makeEvent({ id: "evt-only" }));
    const res = await app.request("/house-events?limit=50", { headers: authHeaders });
    const body = await res.json();
    expect(body.next_cursor).toBeNull();
  });

  it("cursor pagination works across same-timestamp events", async () => {
    const sameTime = "2026-07-21T12:00:00Z";
    for (let i = 0; i < 3; i++) {
      await postEvent(makeEvent({ id: `evt-same-${i}`, created_at: sameTime }));
    }

    const page1 = await app.request("/house-events?limit=2", { headers: authHeaders });
    const body1 = await page1.json();
    expect(body1.data).toHaveLength(2);
    expect(body1.next_cursor).toBeTruthy();

    const page2 = await app.request(
      `/house-events?limit=2&cursor=${encodeURIComponent(body1.next_cursor)}`,
      { headers: authHeaders },
    );
    const body2 = await page2.json();
    expect(body2.data).toHaveLength(1);

    const allIds = [...body1.data, ...body2.data].map((e: { id: string }) => e.id);
    expect(new Set(allIds).size).toBe(3);
  });

  it("cursor works when event ID contains pipe characters", async () => {
    const sameTime = "2026-07-21T12:00:00Z";
    for (let i = 0; i < 3; i++) {
      await postEvent(makeEvent({ id: `evt|pipe|${i}`, created_at: sameTime }));
    }

    const page1 = await app.request("/house-events?limit=2", { headers: authHeaders });
    const body1 = await page1.json();
    expect(body1.data).toHaveLength(2);

    const page2 = await app.request(
      `/house-events?limit=2&cursor=${encodeURIComponent(body1.next_cursor)}`,
      { headers: authHeaders },
    );
    expect(page2.status).toBe(200);
    const body2 = await page2.json();
    expect(body2.data).toHaveLength(1);

    const allIds = [...body1.data, ...body2.data].map((e: { id: string }) => e.id);
    expect(new Set(allIds).size).toBe(3);
  });
});

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sceneDefinitionSchema } from "@lamplight/contracts";
import { app } from "../src/app.js";
import { db, schema } from "../src/db/index.js";
import { ROOMS } from "../seed/rooms.js";

const TOKEN = "test-token-123";

beforeAll(() => {
  process.env.OWNER_TOKEN = TOKEN;
});

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

async function seedRooms() {
  for (const room of ROOMS) {
    await db
      .insert(schema.scenes)
      .values({
        scene_id: room.scene_id,
        display_name: room.display_name,
        type: room.type,
        prompt_weight_overrides: room.prompt_weight_overrides,
        max_participants: room.max_participants ?? null,
        furniture_slots: room.furniture_slots ?? null,
      })
      .onConflictDoUpdate({
        target: schema.scenes.scene_id,
        set: {
          display_name: room.display_name,
          type: room.type,
          prompt_weight_overrides: room.prompt_weight_overrides,
          max_participants: room.max_participants ?? null,
          furniture_slots: room.furniture_slots ?? null,
        },
      });
  }
}

describe("GET /scenes", () => {
  beforeEach(async () => {
    await db.delete(schema.scenes);
    await seedRooms();
  });

  it("requires auth", async () => {
    const res = await app.request("/scenes");
    expect(res.status).toBe(401);
  });

  it("returns all 7 rooms", async () => {
    const res = await app.request("/scenes", { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(7);
  });

  it("each room has id, display_name, and prompt_weight_overrides", async () => {
    const res = await app.request("/scenes", { headers: authHeaders });
    const body = await res.json();
    for (const room of body.data) {
      expect(room.scene_id).toBeTruthy();
      expect(room.display_name).toBeTruthy();
      expect(room.prompt_weight_overrides).toBeDefined();
    }
  });

  it("every room validates against sceneDefinitionSchema", async () => {
    const res = await app.request("/scenes", { headers: authHeaders });
    const body = await res.json();
    for (const room of body.data) {
      expect(() => sceneDefinitionSchema.parse(room)).not.toThrow();
    }
  });
});

describe("GET /scenes/:id", () => {
  beforeEach(async () => {
    await db.delete(schema.scenes);
    await seedRooms();
  });

  it("requires auth", async () => {
    const res = await app.request("/scenes/room-living-room");
    expect(res.status).toBe(401);
  });

  it("returns a specific room", async () => {
    const res = await app.request("/scenes/room-counseling", {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.display_name).toBe("心理咨询室");
    expect(body.data.prompt_weight_overrides).toEqual({ psychology: 0.35 });
  });

  it("returns 404 for unknown scene", async () => {
    const res = await app.request("/scenes/nonexistent", {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

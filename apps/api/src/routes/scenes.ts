import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";

type SceneRow = typeof schema.scenes.$inferSelect;

function toResponse({ created_at, ...rest }: SceneRow) {
  return rest;
}

const scenes = new Hono();

scenes.get("/", async (c) => {
  const rows = await db.select().from(schema.scenes);
  return c.json({ ok: true, data: rows.map(toResponse) });
});

scenes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await db
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.scene_id, id));

  if (!row) {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "scene not found" } },
      404,
    );
  }

  return c.json({ ok: true, data: toResponse(row) });
});

// GET /scenes/:id/conversation — get or create active conversation for a scene
scenes.get("/:id/conversation", async (c) => {
  const sceneId = c.req.param("id");

  const [scene] = await db
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.scene_id, sceneId))
    .limit(1);

  if (!scene) {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "scene not found" } },
      404,
    );
  }

  const [existing] = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.scene_id, sceneId),
        eq(schema.conversations.status, "active"),
      ),
    )
    .limit(1);

  if (existing) {
    return c.json({
      ok: true,
      data: {
        id: existing.id,
        kind: existing.kind,
        scene_id: existing.scene_id ?? undefined,
        participant_ai_ids: existing.participant_ai_ids,
        turn_policy: existing.turn_policy ?? undefined,
        status: existing.status,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
      },
    });
  }

  const presenceRows = await db
    .select({ ai_id: schema.aiPresence.ai_id })
    .from(schema.aiPresence)
    .where(eq(schema.aiPresence.scene_id, sceneId));

  const participantAiIds = presenceRows.map((r) => r.ai_id);
  const now = new Date().toISOString();
  const id = `conv_${randomUUID()}`;

  await db.insert(schema.conversations).values({
    id,
    kind: "house_chat",
    scene_id: sceneId,
    participant_ai_ids: participantAiIds,
    turn_policy: scene.default_turn_policy as Record<string, unknown> | null,
    status: "active",
    created_at: now,
    updated_at: now,
  });

  const [conv] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id))
    .limit(1);

  return c.json({
    ok: true,
    data: {
      id: conv.id,
      kind: conv.kind,
      scene_id: conv.scene_id ?? undefined,
      participant_ai_ids: conv.participant_ai_ids,
      turn_policy: conv.turn_policy ?? undefined,
      status: conv.status,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
    },
  }, 201);
});

export { scenes };

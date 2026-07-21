import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { presenceSchema } from "@lamplight/contracts";
import { db, schema } from "../db/index.js";

const IDLE_THRESHOLD_MS = Number(process.env.PRESENCE_IDLE_MS ?? 30 * 60 * 1000);

type PresenceRow = typeof schema.aiPresence.$inferSelect;

function applyExpiry(row: PresenceRow): PresenceRow {
  if (row.state !== "active") return row;
  const age = Date.now() - new Date(row.updated_at).getTime();
  if (age > IDLE_THRESHOLD_MS) {
    return { ...row, state: "idle" };
  }
  return row;
}

function toResponse(row: PresenceRow) {
  const expired = applyExpiry(row);
  return {
    ai_id: expired.ai_id,
    scene_id: expired.scene_id,
    state: expired.state,
    updated_at: expired.updated_at,
  };
}

const presence = new Hono();

presence.get("/", async (c) => {
  const rows = await db.select().from(schema.aiPresence);
  return c.json({ ok: true, data: rows.map(toResponse) });
});

presence.put("/:ai_id", async (c) => {
  const ai_id = c.req.param("ai_id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "invalid JSON" } },
      400,
    );
  }

  const input = { ...(body as Record<string, unknown>), ai_id };
  const parsed = presenceSchema.safeParse(input);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } },
      400,
    );
  }

  const updatedAt = new Date(parsed.data.updated_at);
  if (updatedAt.getTime() > Date.now()) {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "updated_at cannot be in the future" } },
      400,
    );
  }

  await db
    .insert(schema.aiPresence)
    .values({
      ai_id: parsed.data.ai_id,
      scene_id: parsed.data.scene_id,
      state: parsed.data.state,
      updated_at: parsed.data.updated_at,
    })
    .onConflictDoUpdate({
      target: schema.aiPresence.ai_id,
      set: {
        scene_id: parsed.data.scene_id,
        state: parsed.data.state,
        updated_at: parsed.data.updated_at,
      },
    });

  return c.json({ ok: true, data: parsed.data });
});

export { presence };

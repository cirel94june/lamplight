import { Hono } from "hono";
import { desc, gte, lt } from "drizzle-orm";
import { houseEventSchema } from "@lamplight/contracts";
import { db, schema } from "../db/index.js";

const events = new Hono();

function normalizeToUTC(iso: string): string {
  return new Date(iso).toISOString();
}

function toRow(ev: ReturnType<typeof houseEventSchema.parse>) {
  return {
    id: ev.id,
    type: ev.type,
    actor_type: ev.actor.type,
    actor_ai_id: ev.actor.ai_id ?? null,
    scene_id: ev.scene_id ?? null,
    payload: ev.payload,
    description: ev.description ?? null,
    context_type: ev.context.context_type,
    context_world_id: ev.context.world_id ?? null,
    context_session_id: ev.context.session_id ?? null,
    context_branch_id: ev.context.branch_id ?? null,
    conversation_kind: ev.conversation_kind,
    created_at: normalizeToUTC(ev.created_at),
  };
}

type EventRow = typeof schema.houseEvents.$inferSelect;

function toResponse(row: EventRow) {
  return {
    id: row.id,
    type: row.type,
    actor: {
      type: row.actor_type,
      ...(row.actor_ai_id ? { ai_id: row.actor_ai_id } : {}),
    },
    scene_id: row.scene_id ?? undefined,
    payload: row.payload,
    description: row.description ?? undefined,
    context: {
      context_type: row.context_type,
      set_by: "server" as const,
      ...(row.context_world_id ? { world_id: row.context_world_id } : {}),
      ...(row.context_session_id ? { session_id: row.context_session_id } : {}),
      ...(row.context_branch_id ? { branch_id: row.context_branch_id } : {}),
    },
    conversation_kind: row.conversation_kind,
    created_at: row.created_at,
  };
}

events.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "invalid JSON" } },
      400,
    );
  }

  const input = body as Record<string, unknown>;
  if (input.context && typeof input.context === "object") {
    (input.context as Record<string, unknown>).set_by = "server";
  }

  const parsed = houseEventSchema.safeParse(input);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } },
      400,
    );
  }

  await db.insert(schema.houseEvents).values(toRow(parsed.data));
  return c.json({ ok: true, data: { id: parsed.data.id } }, 201);
});

events.get("/", async (c) => {
  const sinceRaw = c.req.query("since");
  const beforeRaw = c.req.query("before");
  const limitRaw = c.req.query("limit");

  const limitNum = Number(limitRaw ?? 50);
  const limit = Number.isFinite(limitNum) && limitNum >= 1
    ? Math.min(Math.floor(limitNum), 200)
    : 50;

  let query = db
    .select()
    .from(schema.houseEvents)
    .orderBy(desc(schema.houseEvents.created_at))
    .limit(limit);

  if (sinceRaw) {
    const since = normalizeToUTC(sinceRaw);
    query = query.where(gte(schema.houseEvents.created_at, since)) as typeof query;
  }

  if (beforeRaw) {
    const before = normalizeToUTC(beforeRaw);
    query = query.where(lt(schema.houseEvents.created_at, before)) as typeof query;
  }

  const rows = await query;
  return c.json({ ok: true, data: rows.map(toResponse) });
});

export { events };

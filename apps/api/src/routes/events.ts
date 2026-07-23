import { Hono } from "hono";
import { and, desc, gte, lt, or, eq } from "drizzle-orm";
import { houseEventSchema } from "@lamplight/contracts";
import { db, schema } from "../db/index.js";
import { broadcast } from "../broadcast.js";

const events = new Hono();

function normalizeToUTC(iso: string): string {
  return new Date(iso).toISOString();
}

function isValidISO(s: string): boolean {
  const d = new Date(s);
  return !isNaN(d.getTime());
}

function encodeCursor(time: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: time, i: id })).toString("base64url");
}

function decodeCursor(cursor: string): { t: string; i: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (typeof parsed.t === "string" && typeof parsed.i === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
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

  if (body === null || typeof body !== "object") {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "request body must be an object" } },
      400,
    );
  }

  const input = {
    ...(body as Record<string, unknown>),
    context: {
      context_type: "out_of_world",
      set_by: "server",
    },
    conversation_kind: "house_chat",
  };

  const parsed = houseEventSchema.safeParse(input);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } },
      400,
    );
  }

  const ev = parsed.data;
  const normalizedCreatedAt = normalizeToUTC(ev.created_at);
  await db.insert(schema.houseEvents).values({
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
    created_at: normalizedCreatedAt,
  });

  broadcast({
    type: "house_event",
    data: {
      id: ev.id,
      type: ev.type,
      actor: {
        type: ev.actor.type,
        ...(ev.actor.ai_id ? { ai_id: ev.actor.ai_id } : {}),
      },
      scene_id: ev.scene_id ?? undefined,
      payload: ev.payload,
      description: ev.description ?? undefined,
      context: {
        context_type: ev.context.context_type,
        set_by: "server" as const,
      },
      conversation_kind: ev.conversation_kind,
      created_at: normalizedCreatedAt,
    },
  });

  return c.json({ ok: true, data: { id: ev.id } }, 201);
});

events.get("/", async (c) => {
  const sinceRaw = c.req.query("since");
  const beforeRaw = c.req.query("before");
  const cursorRaw = c.req.query("cursor");
  const limitRaw = c.req.query("limit");

  const limitNum = Number(limitRaw ?? 50);
  const limit = Number.isFinite(limitNum) && limitNum >= 1
    ? Math.min(Math.floor(limitNum), 200)
    : 50;

  const conditions = [];

  if (sinceRaw) {
    if (!isValidISO(sinceRaw)) {
      return c.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "invalid since timestamp" } },
        400,
      );
    }
    conditions.push(gte(schema.houseEvents.created_at, normalizeToUTC(sinceRaw)));
  }

  if (beforeRaw) {
    if (!isValidISO(beforeRaw)) {
      return c.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "invalid before timestamp" } },
        400,
      );
    }
    conditions.push(lt(schema.houseEvents.created_at, normalizeToUTC(beforeRaw)));
  }

  if (cursorRaw) {
    const cursor = decodeCursor(cursorRaw);
    if (!cursor || !isValidISO(cursor.t)) {
      return c.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "invalid cursor" } },
        400,
      );
    }
    const normalizedTime = normalizeToUTC(cursor.t);
    conditions.push(
      or(
        lt(schema.houseEvents.created_at, normalizedTime),
        and(
          eq(schema.houseEvents.created_at, normalizedTime),
          lt(schema.houseEvents.id, cursor.i),
        ),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(schema.houseEvents)
    .where(where)
    .orderBy(desc(schema.houseEvents.created_at), desc(schema.houseEvents.id))
    .limit(limit);

  const nextCursor = rows.length === limit
    ? encodeCursor(rows[rows.length - 1].created_at, rows[rows.length - 1].id)
    : null;

  return c.json({
    ok: true,
    data: rows.map(toResponse),
    next_cursor: nextCursor,
  });
});

export { events };

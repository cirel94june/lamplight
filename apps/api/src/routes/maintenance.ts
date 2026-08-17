import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, client } from "../db/index.js";
import * as schema from "../db/schema.js";
import { initGateway } from "../services/gateway/index.js";
import { ConversationRepository } from "../services/runtime/conversation-repository.js";
import { MaintenanceRunner } from "../services/maintenance/runner.js";

const maintenance = new Hono();
const gateway = initGateway(db);
const conversationRepo = new ConversationRepository(db);
const runner = new MaintenanceRunner({ db, gateway, conversationRepo });

maintenance.post("/run", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.conversation_id || !body.task_type) {
    return c.json({ ok: false, error: "conversation_id and task_type are required" }, 400);
  }

  const validTypes = ["digest", "classify", "conflict_detect"];
  if (!validTypes.includes(body.task_type)) {
    return c.json({ ok: false, error: `task_type must be one of: ${validTypes.join(", ")}` }, 400);
  }

  const conv = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, body.conversation_id))
    .limit(1);

  if (conv.length === 0) {
    return c.json({ ok: false, error: "Conversation not found" }, 404);
  }

  try {
    const result = await runner.run({
      conversation_id: body.conversation_id,
      task_type: body.task_type,
    });
    return c.json({ ok: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Maintenance run failed";
    return c.json({ ok: false, error: message }, 500);
  }
});

maintenance.post("/generate-digest", async (c) => {
  const body = await c.req.json().catch(() => null);
  const since = body?.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until = body?.until ?? new Date().toISOString();
  const sceneFilter = body?.scene_id;

  const scenes = await db
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.type, "room"));

  const targetScenes = sceneFilter
    ? scenes.filter((s) => s.scene_id === sceneFilter)
    : scenes;

  if (targetScenes.length === 0) {
    return c.json({ ok: false, error: "No public rooms found" }, 404);
  }

  const allResults: Array<{ scene_id: string; conversation_id: string; accepted: unknown[]; rejected: unknown[] }> = [];

  for (const scene of targetScenes) {
    const convs = await db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.scene_id, scene.scene_id),
          gte(schema.conversations.updated_at, since),
          lte(schema.conversations.created_at, until),
        ),
      );

    for (const conv of convs) {
      try {
        const result = await runner.run({
          conversation_id: conv.id,
          task_type: "digest",
        });
        allResults.push({
          scene_id: scene.scene_id,
          conversation_id: conv.id,
          accepted: result.accepted,
          rejected: result.rejected,
        });
      } catch {
        // skip conversations that fail
      }
    }
  }

  return c.json({ ok: true, data: { since, until, results: allResults } });
});

maintenance.get("/proposals", async (c) => {
  const status = c.req.query("status");

  let rows;
  if (status) {
    rows = await db
      .select()
      .from(schema.maintenanceProposals)
      .where(eq(schema.maintenanceProposals.status, status))
      .orderBy(schema.maintenanceProposals.created_at);
  } else {
    rows = await db
      .select()
      .from(schema.maintenanceProposals)
      .orderBy(schema.maintenanceProposals.created_at);
  }

  return c.json({ ok: true, data: rows });
});

maintenance.post("/proposals/:id/review", async (c) => {
  const proposalId = c.req.param("id");
  const body = await c.req.json().catch(() => null);

  if (!body || !body.decision) {
    return c.json({ ok: false, error: "decision is required (approved|rejected)" }, 400);
  }

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return c.json({ ok: false, error: "decision must be 'approved' or 'rejected'" }, 400);
  }

  const existing = await db
    .select()
    .from(schema.maintenanceProposals)
    .where(eq(schema.maintenanceProposals.id, proposalId))
    .limit(1);

  if (existing.length === 0) {
    return c.json({ ok: false, error: "Proposal not found" }, 404);
  }

  if (existing[0].status !== "pending") {
    return c.json({ ok: false, error: `Proposal already ${existing[0].status}` }, 409);
  }

  const now = new Date().toISOString();
  const auditId = `ma_${randomUUID()}`;
  const decisionReason = body.reason ?? `User ${body.decision}`;

  const results = await client.batch(
    [
      {
        sql: "UPDATE maintenance_proposals SET status = ? WHERE id = ? AND status = 'pending'",
        args: [body.decision, proposalId],
      },
      {
        sql: "INSERT INTO maintenance_audit (id, proposal_id, action, target_id, decision_reason, actor_model_id, actor_provider_id, auto_executed, created_at) SELECT ?, ?, ?, ?, ?, 'user', 'user', 0, ? WHERE changes() > 0",
        args: [auditId, proposalId, existing[0].action, existing[0].target_id ?? null, decisionReason, now],
      },
    ],
    "write",
  );

  if (results[0].rowsAffected === 0) {
    return c.json({ ok: false, error: `Proposal already ${existing[0].status}` }, 409);
  }

  if (body.decision === "approved" && existing[0].task_type === "digest") {
    const conv = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, existing[0].conversation_id))
      .limit(1);

    const msgRange = await db
      .select({
        earliest: sql<string>`MIN(created_at)`,
        latest: sql<string>`MAX(created_at)`,
      })
      .from(schema.messages)
      .where(eq(schema.messages.conversation_id, existing[0].conversation_id));

    await db.insert(schema.householdDigests).values({
      id: `hd_${randomUUID()}`,
      proposal_id: proposalId,
      scene_id: conv[0]?.scene_id ?? "unknown",
      conversation_id: existing[0].conversation_id,
      content: existing[0].content,
      claim_type: existing[0].claim_type,
      participant_ai_ids: conv[0]?.participant_ai_ids ?? null,
      period_start: msgRange[0]?.earliest ?? now,
      period_end: msgRange[0]?.latest ?? now,
      proposer_model: existing[0].proposer_model,
      created_at: now,
    });
  }

  return c.json({
    ok: true,
    data: { id: proposalId, status: body.decision },
  });
});

export { maintenance };

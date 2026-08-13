import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

  return c.json({
    ok: true,
    data: { id: proposalId, status: body.decision },
  });
});

export { maintenance };

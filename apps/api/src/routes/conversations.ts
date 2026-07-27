import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, and, desc, lt, or } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { broadcast } from "../broadcast.js";
import { ConversationRepository } from "../services/runtime/conversation-repository.js";
import { TurnEvaluator } from "../services/runtime/turn-evaluator.js";
import { ContextBuilder } from "../services/runtime/context-builder.js";
import { AgentRuntime } from "../services/runtime/agent-runtime.js";
import { MockMemoryAdapter } from "../services/runtime/mock-memory-adapter.js";
import { createGateway } from "../services/gateway/index.js";
import { LamplightWebAdapter } from "../adapters/lamplight-web.js";

const conversations = new Hono();

const conversationRepo = new ConversationRepository(db);
const turnEvaluator = new TurnEvaluator({ db });
const gateway = createGateway();
const memoryAdapter = new MockMemoryAdapter();
const contextBuilder = new ContextBuilder({ db, memoryAdapter, conversationRepo });
const runtime = new AgentRuntime({
  gateway,
  contextBuilder,
  conversationRepo,
});
const webAdapter = new LamplightWebAdapter();

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

function messageToResponse(row: typeof schema.messages.$inferSelect) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    conversation_kind: row.conversation_kind,
    sender: {
      type: row.sender_type,
      ...(row.sender_ai_id ? { ai_id: row.sender_ai_id } : {}),
    },
    content: row.content,
    context: {
      context_type: row.context_type,
      set_by: row.context_set_by,
      ...(row.context_world_id ? { world_id: row.context_world_id } : {}),
      ...(row.context_session_id ? { session_id: row.context_session_id } : {}),
      ...(row.context_branch_id ? { branch_id: row.context_branch_id } : {}),
    },
    ...(row.speech_mode ? { speech_mode: row.speech_mode } : {}),
    ...(row.prompt_snapshot ? { prompt_snapshot: row.prompt_snapshot } : {}),
    created_at: row.created_at,
  };
}

function conversationToResponse(row: typeof schema.conversations.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    scene_id: row.scene_id ?? undefined,
    world_id: row.world_id ?? undefined,
    session_id: row.session_id ?? undefined,
    participant_ai_ids: row.participant_ai_ids,
    turn_policy: row.turn_policy ?? undefined,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// POST /conversations — create a new conversation
conversations.post("/", async (c) => {
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

  const { scene_id } = body as { scene_id?: string };
  if (!scene_id || typeof scene_id !== "string") {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "scene_id is required" } },
      400,
    );
  }

  const [scene] = await db
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.scene_id, scene_id))
    .limit(1);

  if (!scene) {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "scene not found" } },
      404,
    );
  }

  const [existingActive] = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.scene_id, scene_id),
        eq(schema.conversations.status, "active"),
      ),
    )
    .limit(1);

  if (existingActive) {
    return c.json(
      { ok: false, error: { code: "CONFLICT", message: "scene already has an active conversation" } },
      409,
    );
  }

  const presenceRows = await db
    .select({ ai_id: schema.aiPresence.ai_id })
    .from(schema.aiPresence)
    .where(
      and(
        eq(schema.aiPresence.scene_id, scene_id),
        eq(schema.aiPresence.state, "active"),
      ),
    );

  const participantAiIds = presenceRows.map((r) => r.ai_id);
  const now = new Date().toISOString();
  const id = `conv_${randomUUID()}`;

  await conversationRepo.createConversation({
    id,
    kind: "house_chat",
    scene_id,
    participant_ai_ids: participantAiIds,
    turn_policy: scene.default_turn_policy as Record<string, unknown> | null,
    status: "active",
    created_at: now,
    updated_at: now,
  });

  const conv = await conversationRepo.getConversation(id);
  return c.json({ ok: true, data: conversationToResponse(conv!) }, 201);
});

// GET /conversations/:id
conversations.get("/:id", async (c) => {
  const id = c.req.param("id");
  const conv = await conversationRepo.getConversation(id);

  if (!conv) {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "conversation not found" } },
      404,
    );
  }

  return c.json({ ok: true, data: conversationToResponse(conv) });
});

// GET /conversations/:id/messages — paginated message history
conversations.get("/:id/messages", async (c) => {
  const convId = c.req.param("id");
  const conv = await conversationRepo.getConversation(convId);

  if (!conv) {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "conversation not found" } },
      404,
    );
  }

  const cursorRaw = c.req.query("cursor");
  const limitRaw = c.req.query("limit");

  const limitNum = Number(limitRaw ?? 50);
  const limit = Number.isFinite(limitNum) && limitNum >= 1
    ? Math.min(Math.floor(limitNum), 200)
    : 50;

  const conditions = [eq(schema.messages.conversation_id, convId)];

  if (cursorRaw) {
    const cursor = decodeCursor(cursorRaw);
    if (!cursor) {
      return c.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "invalid cursor" } },
        400,
      );
    }
    conditions.push(
      or(
        lt(schema.messages.created_at, cursor.t),
        and(
          eq(schema.messages.created_at, cursor.t),
          lt(schema.messages.id, cursor.i),
        ),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(...conditions))
    .orderBy(desc(schema.messages.created_at), desc(schema.messages.id))
    .limit(limit);

  const nextCursor = rows.length === limit
    ? encodeCursor(rows[rows.length - 1].created_at, rows[rows.length - 1].id)
    : null;

  return c.json({
    ok: true,
    data: rows.map(messageToResponse),
    next_cursor: nextCursor,
  });
});

// POST /conversations/:id/messages — user sends a message
conversations.post("/:id/messages", async (c) => {
  const convId = c.req.param("id");

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

  const { content, mentioned_agent_ids } = body as {
    content?: string;
    mentioned_agent_ids?: string[];
  };

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return c.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "content is required" } },
      400,
    );
  }

  const conv = await conversationRepo.getConversation(convId);
  if (!conv) {
    return c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "conversation not found" } },
      404,
    );
  }

  if (conv.status === "archived") {
    return c.json(
      { ok: false, error: { code: "CONVERSATION_ARCHIVED", message: "cannot send messages to an archived conversation" } },
      403,
    );
  }

  let internal;
  try {
    internal = webAdapter.toInternal(
      { content: content.trim(), mentioned_agent_ids },
      conv.kind as import("@lamplight/contracts").ConversationKind,
    );
  } catch (err) {
    if (err instanceof TypeError) {
      return c.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: err.message } },
        400,
      );
    }
    throw err;
  }

  const messageId = `msg_${randomUUID()}`;
  const now = new Date().toISOString();

  await conversationRepo.createMessage({
    id: messageId,
    conversation_id: convId,
    conversation_kind: internal.conversation_kind,
    sender_type: internal.sender_type,
    content: internal.content,
    context_type: internal.context.context_type,
    context_set_by: internal.context.set_by,
    created_at: now,
  });

  const userMsg = (await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .limit(1))[0];

  broadcast({
    type: "new_message",
    data: messageToResponse(userMsg),
  });

  // Trigger AI responses asynchronously
  triggerAgentResponses(convId, messageId, conv.scene_id ?? undefined, conv.kind, mentioned_agent_ids).catch((err) => {
    console.error("[conversations] agent response trigger failed:", err);
  });

  return c.json({ ok: true, data: messageToResponse(userMsg) }, 201);
});

async function executeEvaluation(
  evaluation: { eligible_agent_ids: string[]; conversation_id: string },
  conversationId: string,
  sceneId: string | undefined,
  conversationKind: string,
) {
  if (evaluation.eligible_agent_ids.length === 0) return [];

  const typingAgents = new Set(evaluation.eligible_agent_ids);
  for (const agentId of typingAgents) {
    broadcast({
      type: "agent_typing",
      data: { conversation_id: conversationId, agent_id: agentId },
    });
  }

  const responses = await runtime.processEvaluation(
    evaluation as import("@lamplight/contracts").TurnEvaluation,
    { scene_id: sceneId, conversation_kind: conversationKind },
  );

  const respondedAgentIds = new Set(responses.map((r) => r.agent_id));

  for (const response of responses) {
    const msgRow = (await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, response.message_id))
      .limit(1))[0];

    if (msgRow) {
      broadcast({
        type: "new_message",
        data: messageToResponse(msgRow),
      });
    }

    broadcast({
      type: "agent_done",
      data: {
        conversation_id: conversationId,
        agent_id: response.agent_id,
        message_id: response.message_id,
      },
    });
  }

  // Broadcast agent_done for agents that failed (were typing but didn't respond)
  for (const agentId of typingAgents) {
    if (!respondedAgentIds.has(agentId)) {
      broadcast({
        type: "agent_done",
        data: {
          conversation_id: conversationId,
          agent_id: agentId,
          message_id: "",
        },
      });
    }
  }

  return responses;
}

async function triggerAgentResponses(
  conversationId: string,
  messageId: string,
  sceneId: string | undefined,
  conversationKind: string,
  mentionedAgentIds?: string[],
) {
  const evaluation = await turnEvaluator.evaluateUserMessage({
    conversation_id: conversationId,
    message_id: messageId,
    scene_id: sceneId,
    mentioned_agent_ids: mentionedAgentIds,
  });

  const responses = await executeEvaluation(
    evaluation, conversationId, sceneId, conversationKind,
  );

  for (const response of responses) {
    const chainEval = await turnEvaluator.evaluateAgentMessage({
      conversation_id: conversationId,
      message_id: response.message_id,
      sender_agent_id: response.agent_id,
      scene_id: sceneId,
    });

    await executeEvaluation(
      chainEval, conversationId, sceneId, conversationKind,
    );
  }
}

export { conversations };

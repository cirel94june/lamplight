import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import type { GatewayCompletionRequest, GatewayCompletionResponse } from "@lamplight/contracts";

const { mockComplete } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
}));

vi.mock("../src/services/gateway/index.js", () => ({
  initGateway: () => ({ complete: mockComplete }),
}));

import { app } from "../src/app.js";
import { db, schema } from "../src/db/index.js";
import { sql } from "drizzle-orm";

const TOKEN = "test-token-123";
beforeAll(() => {
  process.env.OWNER_TOKEN = TOKEN;
});
const authHeaders = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

describe("end-to-end chain via POST /conversations/:id/messages", () => {
  beforeEach(async () => {
    await db.run(sql`DELETE FROM messages`);
    await db.run(sql`DELETE FROM conversations`);
    await db.run(sql`DELETE FROM scenes`);
    await db.run(sql`DELETE FROM agent_profiles`);
    await db.run(sql`DELETE FROM agent_model_bindings`);
    await db.run(sql`DELETE FROM agent_runtime_configs`);
    await db.run(sql`DELETE FROM ai_presence`);

    mockComplete.mockReset();
    mockComplete.mockImplementation(async (req: GatewayCompletionRequest): Promise<GatewayCompletionResponse> => ({
      content: `Reply from ${req.model_id}`,
      usage: { input_tokens: 10, output_tokens: 5 },
      model_id: req.model_id,
      provider_id: req.provider_id,
      finish_reason: "end_turn",
    }));

    const chainPolicy = {
      policy_id: "chain-e2e",
      triggers: {
        on_user_message: "all_present",
        on_agent_message: {
          mention: false,
          random: true,
          cooldown_ms: 0,
          max_consecutive: 100,
        },
      },
      reply_mode: "sequential",
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 2,
        max_total_messages: 100,
      },
    };

    await db.insert(schema.scenes).values({
      scene_id: "room-chain",
      display_name: "Chain Room",
      type: "room",
      prompt_weight_overrides: {},
      default_turn_policy: chainPolicy as any,
    });

    await db.insert(schema.agentProfiles).values([
      { agent_id: "agent-a", display_name: "Agent A", memory_scope: "agent-a" },
      { agent_id: "agent-b", display_name: "Agent B", memory_scope: "agent-b" },
    ]);

    await db.insert(schema.agentModelBindings).values([
      { id: "bind-a", agent_id: "agent-a", api_provider_id: "test", provider_id: "anthropic", model_id: "test-model" },
      { id: "bind-b", agent_id: "agent-b", api_provider_id: "test", provider_id: "anthropic", model_id: "test-model" },
    ]);

    await db.insert(schema.agentRuntimeConfigs).values([
      { agent_id: "agent-a", random_reply_affinity: 1.0, max_response_tokens: 100 },
      { agent_id: "agent-b", random_reply_affinity: 1.0, max_response_tokens: 100 },
    ]);

    await db.insert(schema.aiPresence).values([
      { ai_id: "agent-a", scene_id: "room-chain", state: "active", updated_at: new Date().toISOString() },
      { ai_id: "agent-b", scene_id: "room-chain", state: "active", updated_at: new Date().toISOString() },
    ]);
  });

  it("M=2: user message triggers agents, chain stops at 2 AI rounds", async () => {
    // Create conversation
    const createRes = await app.request("/conversations", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ scene_id: "room-chain" }),
    });
    expect(createRes.status).toBe(201);
    const convId = (await createRes.json()).data.id;

    // Send user message — triggers async agent chain
    const msgRes = await app.request(`/conversations/${convId}/messages`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ content: "hello everyone" }),
    });
    expect(msgRes.status).toBe(201);

    // Wait for async chain to complete (fire-and-forget in route)
    await new Promise((r) => setTimeout(r, 2000));

    // Query all messages from DB
    const allMessages = await db
      .select()
      .from(schema.messages)
      .where(sql`conversation_id = ${convId}`)
      .orderBy(schema.messages.seq);

    // Should have: 1 user + up to 2 AI rounds (M=2)
    const userMessages = allMessages.filter((m) => m.sender_type === "user");
    const aiMessages = allMessages.filter((m) => m.sender_type === "ai");

    expect(userMessages.length).toBe(1);
    // M=2 means max 2 consecutive AI messages without user intervention
    // Initial eval selects both agents (round 1 = 2 messages),
    // then chain eval checks consecutive count (already 2 >= M=2) → stops
    expect(aiMessages.length).toBe(2);

    // Verify the while loop actually ran (gateway was called at least once)
    expect(mockComplete.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("M=3: chain continues for 3 AI rounds then stops", async () => {
    // Update policy to M=3
    const m3Policy = {
      policy_id: "chain-e2e-m3",
      triggers: {
        on_user_message: "all_present",
        on_agent_message: {
          mention: false,
          random: true,
          cooldown_ms: 0,
          max_consecutive: 100,
        },
      },
      reply_mode: "sequential",
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 3,
        max_total_messages: 100,
      },
    };

    await db.run(sql`UPDATE scenes SET default_turn_policy = ${JSON.stringify(m3Policy)} WHERE scene_id = 'room-chain'`);

    const createRes = await app.request("/conversations", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ scene_id: "room-chain" }),
    });
    const convId = (await createRes.json()).data.id;

    await app.request(`/conversations/${convId}/messages`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ content: "chat with me" }),
    });

    await new Promise((r) => setTimeout(r, 3000));

    const allMessages = await db
      .select()
      .from(schema.messages)
      .where(sql`conversation_id = ${convId}`)
      .orderBy(schema.messages.seq);

    const aiMessages = allMessages.filter((m) => m.sender_type === "ai");

    // M=3: initial eval selects 2 agents (uses 2 of 3 slots),
    // chain eval: 2 consecutive < 3 → selects 1 more → now 3 consecutive = M → stops
    expect(aiMessages.length).toBe(3);
  });
});

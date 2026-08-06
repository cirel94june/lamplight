import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/db/index.js";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema.js";
import { TurnEvaluator } from "../src/services/runtime/turn-evaluator.js";

const SPEAKER_SELECTION_POLICY = {
  policy_id: "test-speaker-selection",
  triggers: {
    on_user_message: "speaker_selection",
    on_agent_message: {
      mention: true,
      random: true,
      cooldown_ms: 10000,
      max_consecutive: 2,
    },
  },
  reply_mode: "sequential",
  self_chat_limits: {
    per_agent_max_per_minute: 4,
    max_agent_rounds_without_user: 3,
    max_total_messages: 50,
    max_total_tokens: 10000,
  },
};

async function seedSpeakerSelectionData() {
  await db.run(sql`DELETE FROM scenes WHERE scene_id = 'room-te-living-room'`);
  await db.run(sql`DELETE FROM agent_profiles WHERE agent_id IN ('te-xiaoke','te-lucien','te-jasper')`);
  await db.run(sql`DELETE FROM agent_runtime_configs WHERE agent_id IN ('te-xiaoke','te-lucien','te-jasper')`);
  await db.run(sql`DELETE FROM agent_model_bindings WHERE agent_id IN ('te-xiaoke','te-lucien','te-jasper')`);
  await db.run(sql`DELETE FROM ai_presence WHERE ai_id IN ('te-xiaoke','te-lucien','te-jasper')`);
  await db.run(sql`DELETE FROM conversations WHERE id = 'conv-te-test'`);
  await db.run(sql`DELETE FROM messages WHERE conversation_id = 'conv-te-test'`);

  await db.insert(schema.scenes).values({
    scene_id: "room-te-living-room",
    display_name: "客厅",
    type: "room",
    prompt_weight_overrides: {},
    default_turn_policy: SPEAKER_SELECTION_POLICY as any,
  });

  await db.insert(schema.agentProfiles).values([
    {
      agent_id: "te-xiaoke",
      display_name: "小克",
      memory_scope: "te-xiaoke",
      aliases: ["小克", "Cloudy", "cloudy"] as any,
      trigger_keywords: ["基建", "代码", "架构", "技术"] as any,
    },
    {
      agent_id: "te-lucien",
      display_name: "Lucien",
      memory_scope: "te-lucien",
      aliases: ["Lucien", "te-lucien", "路西恩"] as any,
      trigger_keywords: ["哲学", "思考", "分析"] as any,
    },
    {
      agent_id: "te-jasper",
      display_name: "Jasper",
      memory_scope: "te-jasper",
      aliases: ["Jasper", "te-jasper", "狗蛋"] as any,
      trigger_keywords: ["冒险", "运动", "游戏"] as any,
    },
  ]);

  await db.insert(schema.agentModelBindings).values([
    { id: "te-bind-xiaoke", agent_id: "te-xiaoke", api_provider_id: "test-provider", provider_id: "anthropic", model_id: "claude-opus-4-6" },
    { id: "te-bind-lucien", agent_id: "te-lucien", api_provider_id: "test-provider", provider_id: "anthropic", model_id: "claude-opus-4-6" },
    { id: "te-bind-jasper", agent_id: "te-jasper", api_provider_id: "test-provider", provider_id: "openai", model_id: "gpt-4o" },
  ]);

  await db.insert(schema.agentRuntimeConfigs).values([
    { agent_id: "te-xiaoke", random_reply_affinity: 0.7 },
    { agent_id: "te-lucien", random_reply_affinity: 0.5 },
    { agent_id: "te-jasper", random_reply_affinity: 0.6 },
  ]);

  await db.insert(schema.aiPresence).values([
    { ai_id: "te-xiaoke", scene_id: "room-te-living-room", state: "active", updated_at: new Date().toISOString() },
    { ai_id: "te-lucien", scene_id: "room-te-living-room", state: "active", updated_at: new Date().toISOString() },
    { ai_id: "te-jasper", scene_id: "room-te-living-room", state: "active", updated_at: new Date().toISOString() },
  ]);

  const now = new Date().toISOString();
  await db.insert(schema.conversations).values({
    id: "conv-te-test",
    kind: "house_chat",
    scene_id: "room-te-living-room",
    participant_ai_ids: ["te-xiaoke", "te-lucien", "te-jasper"],
    turn_policy: SPEAKER_SELECTION_POLICY as any,
    status: "active",
    created_at: now,
    updated_at: now,
  });
}

describe("TurnEvaluator speaker_selection", () => {
  beforeEach(async () => {
    await seedSpeakerSelectionData();
  });

  it("@Cloudy triggers only xiaoke", async () => {
    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      mentioned_agent_ids: ["te-xiaoke"],
      content: "hey @Cloudy",
    });

    expect(result.eligible_agent_ids).toEqual(["te-xiaoke"]);
    expect(result.reason).toContain("mentioned");
  });

  it("name alias '狗蛋' in content triggers jasper", async () => {
    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      content: "狗蛋你今天怎么样？",
    });

    expect(result.eligible_agent_ids).toContain("te-jasper");
    expect(result.reason).toContain("mentioned: te-jasper");
  });

  it("keyword '基建' boosts xiaoke priority but does not force answer", async () => {
    // RNG always returns 1 (never passes threshold) → keyword boost alone doesn't force
    const evaluator = new TurnEvaluator({ db, rng: () => 1 });

    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      content: "我们聊聊基建的事吧",
    });

    // RNG=1 means all rolls fail, even with keyword boost → silence
    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("silence");
  });

  it("keyword boosts affinity so agent passes roll it would otherwise fail", async () => {
    // Set xiaoke affinity to 0.5 — needs boost to exceed 0.75
    await db.run(sql`UPDATE agent_runtime_configs SET random_reply_affinity = 0.5 WHERE agent_id = 'te-xiaoke'`);
    // Others at 0 so only xiaoke is relevant
    await db.run(sql`UPDATE agent_runtime_configs SET random_reply_affinity = 0 WHERE agent_id != 'te-xiaoke'`);

    // RNG returns 0.75 — without boost (0.5) xiaoke fails, with boost (0.5+0.3=0.8) xiaoke passes
    const evaluator = new TurnEvaluator({ db, rng: () => 0.75 });

    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      content: "基建问题",
    });

    expect(result.eligible_agent_ids).toContain("te-xiaoke");
    expect(result.reason).toContain("keyword_boosted_roll");
  });

  it("no triggers → silence (empty eligible)", async () => {
    // RNG always fails
    const evaluator = new TurnEvaluator({ db, rng: () => 1 });

    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      content: "...",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("silence");
  });
});

describe("TurnEvaluator cooldown", () => {
  beforeEach(async () => {
    await seedSpeakerSelectionData();
  });

  it("cooldown is hard block: RNG selects xiaoke but cooldown rejects", async () => {
    const now = new Date().toISOString();
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-recent', 'conv-te-test', 'house_chat', 1, 'ai', 'te-xiaoke', 'hi', 'out_of_world', 'server', ${now})`);

    // Set only xiaoke with affinity, RNG always passes
    await db.run(sql`UPDATE agent_runtime_configs SET random_reply_affinity = 0 WHERE agent_id != 'te-xiaoke'`);
    const evaluator = new TurnEvaluator({ db, rng: () => 0 });

    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-2",
      scene_id: "room-te-living-room",
      content: "random chat",
    });

    // xiaoke in cooldown → hard blocked, not just penalized
    expect(result.eligible_agent_ids).not.toContain("te-xiaoke");
  });

  it("@小克 bypasses cooldown", async () => {
    const now = new Date().toISOString();
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-recent', 'conv-te-test', 'house_chat', 1, 'ai', 'te-xiaoke', 'hi', 'out_of_world', 'server', ${now})`);

    const evaluator = new TurnEvaluator({ db, rng: () => 1 });

    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-2",
      scene_id: "room-te-living-room",
      content: "小克你来看看",
    });

    // Mention bypasses cooldown
    expect(result.eligible_agent_ids).toContain("te-xiaoke");
  });
});

describe("TurnEvaluator mention bypass limits", () => {
  beforeEach(async () => {
    await seedSpeakerSelectionData();
  });

  it("@offline agent → not selected (mention does not bypass offline)", async () => {
    // Set xiaoke binding to offline
    await db.run(sql`UPDATE agent_model_bindings SET fault_state = 'offline' WHERE agent_id = 'te-xiaoke'`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      mentioned_agent_ids: ["te-xiaoke"],
      content: "@小克",
    });

    expect(result.eligible_agent_ids).not.toContain("te-xiaoke");
  });

  it("@absent agent → not selected (mention does not bypass presence)", async () => {
    // Remove jasper from presence
    await db.run(sql`DELETE FROM ai_presence WHERE ai_id = 'te-jasper'`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      mentioned_agent_ids: ["te-jasper"],
      content: "@狗蛋",
    });

    expect(result.eligible_agent_ids).not.toContain("te-jasper");
  });
});

describe("TurnEvaluator self-chat protection (three layers)", () => {
  beforeEach(async () => {
    await seedSpeakerSelectionData();
  });

  it("explicit counterexample: M+1th agent blocked even if keyword+affinity+no-cooldown+online+present", async () => {
    const now = new Date().toISOString();
    // Insert exactly M=3 consecutive AI messages
    for (let i = 1; i <= 3; i++) {
      await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
        VALUES (${`msg-ai-${i}`}, 'conv-te-test', 'house_chat', ${i}, 'ai', ${i % 2 === 0 ? "te-lucien" : "te-xiaoke"}, 'ai chat', 'out_of_world', 'server', ${now})`);
    }

    // RNG always passes, jasper matches keyword, not in cooldown, online, present
    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-ai-3",
      sender_agent_id: "te-xiaoke",
      scene_id: "room-te-living-room",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("self_chat_limit");
    expect(result.reason).toContain("max_agent_rounds_without_user");
  });

  it("user message resets self-chat counter", async () => {
    const now = new Date().toISOString();
    // AI, AI, AI, then USER, then AI → only 1 consecutive
    for (let i = 1; i <= 3; i++) {
      await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
        VALUES (${`msg-ai-${i}`}, 'conv-te-test', 'house_chat', ${i}, 'ai', 'te-xiaoke', 'ai', 'out_of_world', 'server', ${now})`);
    }
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at)
      VALUES ('msg-user', 'conv-te-test', 'house_chat', 4, 'user', 'hello', 'out_of_world', 'server', ${now})`);
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-ai-4', 'conv-te-test', 'house_chat', 5, 'ai', 'te-lucien', 'hey', 'out_of_world', 'server', ${now})`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-ai-4",
      sender_agent_id: "te-lucien",
      scene_id: "room-te-living-room",
    });

    // Only 1 AI message since last user → under limit of 3
    expect(result.reason).not.toContain("self_chat_limit");
  });

  it("max_total_messages blocks when total reached", async () => {
    const lowLimitPolicy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 4,
        max_agent_rounds_without_user: 100,
        max_total_messages: 5,
        max_total_tokens: 999999,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(lowLimitPolicy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    for (let i = 1; i <= 5; i++) {
      await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at)
        VALUES (${`msg-${i}`}, 'conv-te-test', 'house_chat', ${i}, ${i % 2 === 0 ? "ai" : "user"}, 'msg', 'out_of_world', 'server', ${now})`);
    }

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-5",
      sender_agent_id: "te-xiaoke",
      scene_id: "room-te-living-room",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("max_total_messages");
  });

  it("max_total_tokens blocks when token budget exhausted", async () => {
    const tokenPolicy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 100,
        max_total_messages: 100,
        max_total_tokens: 500,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(tokenPolicy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    // Insert messages with total (input+output) = 600 tokens (over 500 budget)
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, usage_input_tokens, usage_output_tokens, created_at)
      VALUES ('msg-1', 'conv-te-test', 'house_chat', 1, 'ai', 'te-xiaoke', 'hi', 'out_of_world', 'server', 200, 100, ${now})`);
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, usage_input_tokens, usage_output_tokens, created_at)
      VALUES ('msg-2', 'conv-te-test', 'house_chat', 2, 'ai', 'te-lucien', 'hey', 'out_of_world', 'server', 200, 100, ${now})`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-2",
      sender_agent_id: "te-lucien",
      scene_id: "room-te-living-room",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("max_total_tokens");
  });

  it("per_agent_max_per_minute blocks rapid-fire agent", async () => {
    const limitPolicy = {
      ...SPEAKER_SELECTION_POLICY,
      triggers: {
        ...SPEAKER_SELECTION_POLICY.triggers,
        on_agent_message: {
          ...SPEAKER_SELECTION_POLICY.triggers.on_agent_message,
          cooldown_ms: 0,
          max_consecutive: 100,
        },
      },
      self_chat_limits: {
        per_agent_max_per_minute: 2,
        max_agent_rounds_without_user: 100,
        max_total_messages: 100,
        max_total_tokens: 999999,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(limitPolicy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    // xiaoke has spoken 2 times in the last minute
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-xk-1', 'conv-te-test', 'house_chat', 1, 'ai', 'te-xiaoke', 'hi', 'out_of_world', 'server', ${now})`);
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-xk-2', 'conv-te-test', 'house_chat', 2, 'ai', 'te-xiaoke', 'again', 'out_of_world', 'server', ${now})`);
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-lu-1', 'conv-te-test', 'house_chat', 3, 'ai', 'te-lucien', 'hello', 'out_of_world', 'server', ${now})`);

    // RNG always passes
    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-lu-1",
      sender_agent_id: "te-lucien",
      scene_id: "room-te-living-room",
    });

    // xiaoke blocked by per-agent frequency
    expect(result.eligible_agent_ids).not.toContain("te-xiaoke");
    // jasper should pass (0 messages, under limit)
    expect(result.eligible_agent_ids).toContain("te-jasper");
  });
});

describe("TurnEvaluator backward compat", () => {
  beforeEach(async () => {
    await seedSpeakerSelectionData();
  });

  it("all_present still returns all online agents", async () => {
    const allPresentPolicy = {
      policy_id: "test-all",
      triggers: {
        on_user_message: "all_present",
        on_agent_message: { mention: false, random: false, cooldown_ms: 0, max_consecutive: 1 },
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(allPresentPolicy)} WHERE id = 'conv-te-test'`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      content: "hello",
    });

    expect(result.eligible_agent_ids.sort()).toEqual(["te-jasper", "te-lucien", "te-xiaoke"]);
  });

  it("mentioned_only still filters to mentioned agents", async () => {
    const mentionPolicy = {
      policy_id: "test-mention",
      triggers: {
        on_user_message: "mentioned_only",
        on_agent_message: { mention: false, random: false, cooldown_ms: 0, max_consecutive: 1 },
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(mentionPolicy)} WHERE id = 'conv-te-test'`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      mentioned_agent_ids: ["te-jasper"],
      content: "hey jasper",
    });

    expect(result.eligible_agent_ids).toEqual(["te-jasper"]);
  });

  it("old policy without self_chat_limits or speaker_selection still works", async () => {
    const oldPolicy = {
      policy_id: "old-style",
      triggers: {
        on_user_message: "all_present",
        on_agent_message: { mention: true, random: false, cooldown_ms: 0, max_consecutive: 1 },
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(oldPolicy)} WHERE id = 'conv-te-test'`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      scene_id: "room-te-living-room",
      content: "hello",
    });

    expect(result.eligible_agent_ids.length).toBeGreaterThan(0);
  });
});

describe("TurnEvaluator persistence", () => {
  beforeEach(async () => {
    await seedSpeakerSelectionData();
  });

  it("counts derive from persisted messages, not in-process state", async () => {
    const now = new Date().toISOString();
    // Insert 3 AI messages directly into DB (simulating data surviving restart)
    for (let i = 1; i <= 3; i++) {
      await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
        VALUES (${`msg-${i}`}, 'conv-te-test', 'house_chat', ${i}, 'ai', 'te-xiaoke', 'msg', 'out_of_world', 'server', ${now})`);
    }

    // New evaluator instance (simulates restart) sees persisted data
    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-3",
      sender_agent_id: "te-xiaoke",
      scene_id: "room-te-living-room",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("max_agent_rounds_without_user");
  });

  it("token budget from persisted usage survives restart", async () => {
    const tokenPolicy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 100,
        max_total_messages: 100,
        max_total_tokens: 300,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(tokenPolicy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, usage_input_tokens, usage_output_tokens, created_at)
      VALUES ('msg-1', 'conv-te-test', 'house_chat', 1, 'ai', 'te-xiaoke', 'hi', 'out_of_world', 'server', 200, 150, ${now})`);

    // New evaluator (post-restart) — total=350 > budget=300
    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-1",
      sender_agent_id: "te-xiaoke",
      scene_id: "room-te-living-room",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("max_total_tokens");
  });
});

describe("TurnEvaluator codex review fixes", () => {
  beforeEach(async () => {
    await seedSpeakerSelectionData();
  });

  it("@mention does NOT bypass total message budget", async () => {
    const budgetPolicy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 100,
        max_total_messages: 1,
        max_total_tokens: 999999,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(budgetPolicy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at)
      VALUES ('msg-user-1', 'conv-te-test', 'house_chat', 1, 'user', 'hi', 'out_of_world', 'server', ${now})`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-2",
      scene_id: "room-te-living-room",
      mentioned_agent_ids: ["te-xiaoke"],
      content: "@小克",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("max_total_messages");
  });

  it("M>20 consecutive AI messages counted correctly (no truncation)", async () => {
    const highMPolicy = {
      ...SPEAKER_SELECTION_POLICY,
      triggers: {
        ...SPEAKER_SELECTION_POLICY.triggers,
        on_agent_message: {
          ...SPEAKER_SELECTION_POLICY.triggers.on_agent_message,
          cooldown_ms: 0,
          max_consecutive: 100,
        },
      },
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 25,
        max_total_messages: 1000,
        max_total_tokens: 999999,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(highMPolicy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    for (let i = 1; i <= 25; i++) {
      const agentId = i % 2 === 0 ? "te-lucien" : "te-xiaoke";
      await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
        VALUES (${`msg-chain-${i}`}, 'conv-te-test', 'house_chat', ${i}, 'ai', ${agentId}, 'msg', 'out_of_world', 'server', ${now})`);
    }

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-chain-25",
      sender_agent_id: "te-xiaoke",
      scene_id: "room-te-living-room",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("max_agent_rounds_without_user");
  });

  it("batch capped to remaining quota: 2 candidates but only 1 slot", async () => {
    const tightPolicy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 3,
        max_total_messages: 1000,
        max_total_tokens: 999999,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(tightPolicy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    // 2 consecutive AI messages → 1 slot remaining (M=3, used=2)
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-a1', 'conv-te-test', 'house_chat', 1, 'ai', 'te-xiaoke', 'hi', 'out_of_world', 'server', ${now})`);
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-a2', 'conv-te-test', 'house_chat', 2, 'ai', 'te-lucien', 'hey', 'out_of_world', 'server', ${now})`);

    // All 3 agents have affinity=1, RNG=0 → all would pass
    await db.run(sql`UPDATE agent_runtime_configs SET random_reply_affinity = 1.0 WHERE agent_id IN ('te-xiaoke','te-lucien','te-jasper')`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-user",
      scene_id: "room-te-living-room",
      content: "hi everyone",
    });

    // Only 1 agent should be eligible despite all passing affinity roll
    expect(result.eligible_agent_ids.length).toBe(1);
  });

  it("old policy without self_chat_limits gets safe defaults from schema", async () => {
    const oldPolicy = {
      policy_id: "old-style",
      triggers: {
        on_user_message: "speaker_selection",
        on_agent_message: { mention: true, random: true, cooldown_ms: 0, max_consecutive: 2 },
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(oldPolicy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    // Insert 3 consecutive AI messages (default max_agent_rounds_without_user=3)
    for (let i = 1; i <= 3; i++) {
      await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
        VALUES (${`msg-old-${i}`}, 'conv-te-test', 'house_chat', ${i}, 'ai', 'te-xiaoke', 'msg', 'out_of_world', 'server', ${now})`);
    }

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-old-3",
      sender_agent_id: "te-xiaoke",
      scene_id: "room-te-living-room",
    });

    // Old policy should get default self_chat_limits (M=3), so 3rd message should block
    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("self_chat_limit");
  });

  it("@mention blocked by per_agent_max_per_minute: xiaoke at limit=4, @小克 still rejected", async () => {
    const policy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 4,
        max_agent_rounds_without_user: 100,
        max_total_messages: 1000,
        max_total_tokens: 999999,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(policy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    // Insert a user message first so consecutive-AI-count resets
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at)
      VALUES ('msg-user-freq', 'conv-te-test', 'house_chat', 1, 'user', 'hi', 'out_of_world', 'server', ${now})`);
    // xiaoke already spoke 4 times in the last minute (hitting the limit)
    for (let i = 1; i <= 4; i++) {
      await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
        VALUES (${`msg-freq-${i}`}, 'conv-te-test', 'house_chat', ${i + 1}, 'ai', 'te-xiaoke', 'msg', 'out_of_world', 'server', ${now})`);
    }

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-user-mention",
      scene_id: "room-te-living-room",
      mentioned_agent_ids: ["te-xiaoke"],
      content: "@小克 你好",
    });

    // xiaoke at per_agent_max_per_minute limit → must NOT be selected even via @mention
    expect(result.eligible_agent_ids).not.toContain("te-xiaoke");
  });

  it("total messages remaining=1 caps batch to 1: 3 candidates but only 1 slot", async () => {
    const policy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 100,
        max_total_messages: 4,
        max_total_tokens: 999999,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(policy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    // 3 existing messages → total=3, max=4, remaining=1
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at)
      VALUES ('msg-tot-1', 'conv-te-test', 'house_chat', 1, 'user', 'hi', 'out_of_world', 'server', ${now})`);
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at)
      VALUES ('msg-tot-2', 'conv-te-test', 'house_chat', 2, 'ai', 'te-xiaoke', 'hey', 'out_of_world', 'server', ${now})`);
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at)
      VALUES ('msg-tot-3', 'conv-te-test', 'house_chat', 3, 'user', 'again', 'out_of_world', 'server', ${now})`);

    // All 3 agents have affinity=1 so all pass affinity roll
    await db.run(sql`UPDATE agent_runtime_configs SET random_reply_affinity = 1.0 WHERE agent_id IN ('te-xiaoke','te-lucien','te-jasper')`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-user-tot",
      scene_id: "room-te-living-room",
      content: "大家好",
    });

    // Only 1 message slot remaining → at most 1 agent selected
    expect(result.eligible_agent_ids.length).toBeLessThanOrEqual(1);
  });

  it("token budget tracks total (input+output) — budget=20, used 26 → hard stop", async () => {
    const policy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 100,
        max_total_messages: 1000,
        max_total_tokens: 20,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(policy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    // Two AI messages: (8 input + 5 output) each → total = 26 > budget 20
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at, usage_input_tokens, usage_output_tokens)
      VALUES ('msg-tok-1', 'conv-te-test', 'house_chat', 1, 'ai', 'te-xiaoke', 'hi', 'out_of_world', 'server', ${now}, 8, 5)`);
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at, usage_input_tokens, usage_output_tokens)
      VALUES ('msg-tok-2', 'conv-te-test', 'house_chat', 2, 'ai', 'te-lucien', 'hey', 'out_of_world', 'server', ${now}, 8, 5)`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateAgentMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-tok-2",
      sender_agent_id: "te-lucien",
      scene_id: "room-te-living-room",
    });

    expect(result.eligible_agent_ids).toEqual([]);
    expect(result.reason).toContain("max_total_tokens");
  });

  it("remaining_token_budget reflects total (input+output) usage", async () => {
    const policy = {
      ...SPEAKER_SELECTION_POLICY,
      self_chat_limits: {
        per_agent_max_per_minute: 100,
        max_agent_rounds_without_user: 100,
        max_total_messages: 1000,
        max_total_tokens: 100,
      },
    };
    await db.run(sql`UPDATE conversations SET turn_policy = ${JSON.stringify(policy)} WHERE id = 'conv-te-test'`);

    const now = new Date().toISOString();
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, content, context_type, context_set_by, created_at)
      VALUES ('msg-conc-usr', 'conv-te-test', 'house_chat', 1, 'user', 'hello', 'out_of_world', 'server', ${now})`);
    // 50 input + 6 output = 56 total used
    await db.run(sql`INSERT INTO messages (id, conversation_id, conversation_kind, seq, sender_type, sender_ai_id, content, context_type, context_set_by, created_at, usage_input_tokens, usage_output_tokens)
      VALUES ('msg-conc-ai', 'conv-te-test', 'house_chat', 2, 'ai', 'te-xiaoke', 'hi', 'out_of_world', 'server', ${now}, 50, 6)`);

    await db.run(sql`UPDATE agent_runtime_configs SET random_reply_affinity = 1.0 WHERE agent_id IN ('te-xiaoke','te-lucien','te-jasper')`);

    const evaluator = new TurnEvaluator({ db, rng: () => 0 });
    const result = await evaluator.evaluateUserMessage({
      conversation_id: "conv-te-test",
      message_id: "msg-conc-usr2",
      scene_id: "room-te-living-room",
      content: "大家好",
    });

    // Budget=100, used total=56 → remaining=44
    expect(result.remaining_token_budget).toBe(44);
    expect(result.eligible_agent_ids.length).toBeGreaterThan(0);
  });
});

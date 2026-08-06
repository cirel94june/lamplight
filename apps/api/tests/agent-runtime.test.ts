import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "../src/db/index.js";
import { sql } from "drizzle-orm";
import type {
  AIGateway,
  GatewayCompletionRequest,
  GatewayCompletionResponse,
} from "@lamplight/contracts";
import { TurnEvaluator } from "../src/services/runtime/turn-evaluator.js";
import { ContextBuilder } from "../src/services/runtime/context-builder.js";
import { AgentRuntime } from "../src/services/runtime/agent-runtime.js";
import { ConversationRepository } from "../src/services/runtime/conversation-repository.js";
import { MockMemoryAdapter } from "../src/services/runtime/mock-memory-adapter.js";
import * as schema from "../src/db/schema.js";

function mockGateway(): AIGateway & { calls: GatewayCompletionRequest[] } {
  const calls: GatewayCompletionRequest[] = [];
  return {
    calls,
    complete: vi.fn().mockImplementation(async (req: GatewayCompletionRequest) => {
      calls.push(req);
      return {
        content: `Reply from ${req.provider_id}/${req.model_id}`,
        usage: { input_tokens: 10, output_tokens: 5 },
        model_id: req.model_id,
        provider_id: req.provider_id,
        finish_reason: "end_turn",
      } satisfies GatewayCompletionResponse;
    }),
  };
}

const LIVING_ROOM_POLICY = {
  policy_id: "living-room-default",
  triggers: {
    on_user_message: "all_present",
    on_agent_message: {
      mention: true,
      random: true,
      cooldown_ms: 5000,
      max_consecutive: 2,
    },
  },
};

const BEDROOM_POLICY = {
  policy_id: "bedroom-default",
  triggers: {
    on_user_message: "all_present",
    on_agent_message: {
      mention: true,
      random: false,
      cooldown_ms: 0,
      max_consecutive: 1,
    },
  },
};

async function seedTestData() {
  // Scenes
  await db.run(sql`DELETE FROM scenes`);
  await db.insert(schema.scenes).values({
    scene_id: "room-living-room",
    display_name: "客厅",
    type: "room",
    prompt_weight_overrides: {},
    default_turn_policy: LIVING_ROOM_POLICY as any,
  });
  await db.insert(schema.scenes).values({
    scene_id: "room-ceci-bedroom",
    display_name: "小猫卧室",
    type: "room",
    prompt_weight_overrides: { intimacy: 0.3 },
    default_turn_policy: BEDROOM_POLICY as any,
  });

  // Agent profiles
  await db.run(sql`DELETE FROM agent_profiles`);
  await db.insert(schema.agentProfiles).values([
    { agent_id: "xiaoke", display_name: "小克", memory_scope: "xiaoke" },
    { agent_id: "lucien", display_name: "Lucien", memory_scope: "lucien" },
    { agent_id: "jasper", display_name: "Jasper", memory_scope: "jasper" },
    { agent_id: "therapist", display_name: "心理咨询师", memory_scope: "therapist" },
  ]);

  // Agent model bindings
  await db.run(sql`DELETE FROM agent_model_bindings`);
  await db.insert(schema.agentModelBindings).values([
    { id: "bind-xiaoke", agent_id: "xiaoke", api_provider_id: "test-provider", provider_id: "anthropic", model_id: "claude-opus-4-6" },
    { id: "bind-lucien", agent_id: "lucien", api_provider_id: "test-provider", provider_id: "anthropic", model_id: "claude-opus-4-6" },
    { id: "bind-jasper", agent_id: "jasper", api_provider_id: "test-provider", provider_id: "openai", model_id: "gpt-4o" },
    { id: "bind-therapist", agent_id: "therapist", api_provider_id: "test-provider", provider_id: "anthropic", model_id: "claude-opus-4-6" },
  ]);

  // Runtime configs
  await db.run(sql`DELETE FROM agent_runtime_configs`);
  await db.insert(schema.agentRuntimeConfigs).values([
    {
      agent_id: "xiaoke",
      random_reply_affinity: 0.7,
      max_response_tokens: 1024,
      temperature: 0.8,
      system_prompt_template:
        "你是小克，一个温暖的 AI 伙伴。你现在在{{scene_name}}里。\n\n{{prompt_weights}}",
    },
    {
      agent_id: "lucien",
      random_reply_affinity: 0.5,
      max_response_tokens: 1024,
      temperature: 0.7,
      system_prompt_template:
        "你是 Lucien。你现在在{{scene_name}}里。\n\n{{prompt_weights}}",
    },
    {
      agent_id: "jasper",
      random_reply_affinity: 0.6,
      max_response_tokens: 1024,
      temperature: 0.9,
      system_prompt_template:
        "You are Jasper. You are in {{scene_name}}.\n\n{{prompt_weights}}",
    },
    {
      agent_id: "therapist",
      random_reply_affinity: 0.0,
      max_response_tokens: 2048,
      temperature: 0.5,
      system_prompt_template:
        "你是心理咨询师。你现在在{{scene_name}}里。\n\n{{prompt_weights}}",
    },
  ]);

  // Presence + conversations + messages: cleaned per test
  await db.run(sql`DELETE FROM ai_presence`);
  await db.run(sql`DELETE FROM conversations`);
  await db.run(sql`DELETE FROM messages`);
}

describe("Agent Runtime integration", () => {
  let gateway: ReturnType<typeof mockGateway>;
  let conversationRepo: ConversationRepository;
  let contextBuilder: ContextBuilder;
  let turnEvaluator: TurnEvaluator;
  let runtime: AgentRuntime;

  beforeEach(async () => {
    await seedTestData();

    gateway = mockGateway();
    conversationRepo = new ConversationRepository(db);
    contextBuilder = new ContextBuilder({
      db,
      memoryAdapter: new MockMemoryAdapter(),
      conversationRepo,
    });
    turnEvaluator = new TurnEvaluator({ db });
    runtime = new AgentRuntime({
      db,
      gateway,
      contextBuilder,
      conversationRepo,
    });
  });

  describe("场景 1：客厅广播 — 用户发消息，所有在场 AI 回复", () => {
    beforeEach(async () => {
      // Place xiaoke, lucien, jasper in living room
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "jasper", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      // Create conversation with all three as participants
      await conversationRepo.createConversation({
        id: "conv-living",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien", "jasper"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // User sends a message
      await conversationRepo.createMessage({
        id: "msg-user-1",
        conversation_id: "conv-living",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "大家好！",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: new Date().toISOString(),
      });
    });

    it("TurnEvaluator returns all 3 present agents", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-living",
        message_id: "msg-user-1",
        scene_id: "room-living-room",
      });

      expect(evaluation.eligible_agent_ids).toHaveLength(3);
      expect(evaluation.eligible_agent_ids).toContain("xiaoke");
      expect(evaluation.eligible_agent_ids).toContain("lucien");
      expect(evaluation.eligible_agent_ids).toContain("jasper");
      expect(evaluation.reason).toContain("all_present");
    });

    it("full pipeline: user message → evaluation → gateway calls → messages written", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-living",
        message_id: "msg-user-1",
        scene_id: "room-living-room",
      });

      const responses = await runtime.processEvaluation(evaluation, {
        scene_id: "room-living-room",
        conversation_kind: "house_chat",
      });

      // All 3 agents responded
      expect(responses).toHaveLength(3);

      // Gateway was called 3 times
      expect(gateway.calls).toHaveLength(3);

      // Correct providers: xiaoke+lucien → anthropic, jasper → openai
      const providers = gateway.calls.map((c) => c.provider_id).sort();
      expect(providers).toEqual(["anthropic", "anthropic", "openai"]);

      // Messages written to DB
      const allMessages = await conversationRepo.getRecentMessages("conv-living", 100);
      expect(allMessages).toHaveLength(4); // 1 user + 3 AI
      const aiMessages = allMessages.filter((m) => m.sender_type === "ai");
      expect(aiMessages).toHaveLength(3);
      const agentIds = aiMessages.map((m) => m.sender_ai_id).sort();
      expect(agentIds).toEqual(["jasper", "lucien", "xiaoke"]);
    });

    it("ContextBuilder includes system prompt with scene name", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-living",
        message_id: "msg-user-1",
        scene_id: "room-living-room",
      });

      await runtime.processEvaluation(evaluation, {
        scene_id: "room-living-room",
        conversation_kind: "house_chat",
      });

      // Check that gateway was called with system message containing scene name
      for (const call of gateway.calls) {
        const systemMsg = call.messages.find((m) => m.role === "system");
        expect(systemMsg).toBeDefined();
        expect(systemMsg!.content).toContain("客厅");
      }
    });

    it("ContextBuilder includes user message in history", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-living",
        message_id: "msg-user-1",
        scene_id: "room-living-room",
      });

      await runtime.processEvaluation(evaluation, {
        scene_id: "room-living-room",
        conversation_kind: "house_chat",
      });

      for (const call of gateway.calls) {
        const userMsg = call.messages.find(
          (m) => m.role === "user" && m.content === "大家好！",
        );
        expect(userMsg).toBeDefined();
      }
    });
  });

  describe("场景 2：卧室单聊 — 只有一个 AI 在卧室", () => {
    beforeEach(async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-ceci-bedroom", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-bedroom",
        kind: "house_chat",
        scene_id: "room-ceci-bedroom",
        participant_ai_ids: ["xiaoke"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await conversationRepo.createMessage({
        id: "msg-user-bed-1",
        conversation_id: "conv-bedroom",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "小克，今天过得怎么样？",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: new Date().toISOString(),
      });
    });

    it("only xiaoke is eligible in bedroom", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-bedroom",
        message_id: "msg-user-bed-1",
        scene_id: "room-ceci-bedroom",
      });

      expect(evaluation.eligible_agent_ids).toEqual(["xiaoke"]);
    });

    it("full pipeline: single agent responds with correct provider", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-bedroom",
        message_id: "msg-user-bed-1",
        scene_id: "room-ceci-bedroom",
      });

      const responses = await runtime.processEvaluation(evaluation, {
        scene_id: "room-ceci-bedroom",
        conversation_kind: "house_chat",
      });

      expect(responses).toHaveLength(1);
      expect(responses[0].agent_id).toBe("xiaoke");

      expect(gateway.calls).toHaveLength(1);
      expect(gateway.calls[0].provider_id).toBe("anthropic");
      expect(gateway.calls[0].model_id).toBe("claude-opus-4-6");

      // prompt_weight_overrides: intimacy: 0.3 should be in system prompt
      const systemMsg = gateway.calls[0].messages.find((m) => m.role === "system");
      expect(systemMsg!.content).toContain("intimacy: 0.3");
    });

    it("prompt snapshot is saved with the message", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-bedroom",
        message_id: "msg-user-bed-1",
        scene_id: "room-ceci-bedroom",
      });

      await runtime.processEvaluation(evaluation, {
        scene_id: "room-ceci-bedroom",
        conversation_kind: "house_chat",
      });

      const allMessages = await conversationRepo.getRecentMessages("conv-bedroom", 100);
      const aiMsg = allMessages.find((m) => m.sender_type === "ai");
      expect(aiMsg).toBeDefined();
      expect(aiMsg!.prompt_snapshot).toBeDefined();
      const snapshot = aiMsg!.prompt_snapshot as { model: string; rendered_prompt: string };
      expect(snapshot.model).toBe("claude-opus-4-6");
      expect(snapshot.rendered_prompt).toContain("小猫卧室");
    });
  });

  describe("场景 3：mention 触发 — mentioned_only 策略", () => {
    beforeEach(async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "jasper", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      // Conversation with mentioned_only policy
      await conversationRepo.createConversation({
        id: "conv-mention",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien", "jasper"],
        turn_policy: {
          policy_id: "mention-only",
          triggers: {
            on_user_message: "mentioned_only",
            on_agent_message: {
              mention: true,
              random: false,
              cooldown_ms: 0,
              max_consecutive: 1,
            },
          },
        },
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await conversationRepo.createMessage({
        id: "msg-user-mention-1",
        conversation_id: "conv-mention",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "@小克 你觉得呢？",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: new Date().toISOString(),
      });
    });

    it("only mentioned agent is eligible", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-mention",
        message_id: "msg-user-mention-1",
        scene_id: "room-living-room",
        mentioned_agent_ids: ["xiaoke"],
      });

      expect(evaluation.eligible_agent_ids).toEqual(["xiaoke"]);
      expect(evaluation.reason).toContain("mentioned_only");
    });

    it("no mentioned agents → empty eligible list", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-mention",
        message_id: "msg-user-mention-1",
        scene_id: "room-living-room",
        mentioned_agent_ids: [],
      });

      expect(evaluation.eligible_agent_ids).toEqual([]);
    });

    it("mentioning multiple agents returns only those present", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-mention",
        message_id: "msg-user-mention-1",
        scene_id: "room-living-room",
        mentioned_agent_ids: ["xiaoke", "lucien", "therapist"],
      });

      // therapist is not present in living room
      expect(evaluation.eligible_agent_ids).toHaveLength(2);
      expect(evaluation.eligible_agent_ids).toContain("xiaoke");
      expect(evaluation.eligible_agent_ids).toContain("lucien");
      expect(evaluation.eligible_agent_ids).not.toContain("therapist");
    });

    it("full pipeline: only mentioned agent gets gateway call", async () => {
      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-mention",
        message_id: "msg-user-mention-1",
        scene_id: "room-living-room",
        mentioned_agent_ids: ["xiaoke"],
      });

      const responses = await runtime.processEvaluation(evaluation, {
        scene_id: "room-living-room",
        conversation_kind: "house_chat",
      });

      expect(responses).toHaveLength(1);
      expect(responses[0].agent_id).toBe("xiaoke");
      expect(gateway.calls).toHaveLength(1);
    });
  });

  describe("TurnEvaluator — on_agent_message", () => {
    beforeEach(async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-chain",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    it("mention in agent message triggers mentioned agent", async () => {
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-chain",
        message_id: "msg-ai-1",
        sender_agent_id: "xiaoke",
        scene_id: "room-living-room",
        mentioned_agent_ids: ["lucien"],
      });

      expect(evaluation.eligible_agent_ids).toContain("lucien");
    });

    it("sender agent is excluded from eligible list", async () => {
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-chain",
        message_id: "msg-ai-1",
        sender_agent_id: "xiaoke",
        scene_id: "room-living-room",
        mentioned_agent_ids: ["xiaoke", "lucien"],
      });

      expect(evaluation.eligible_agent_ids).not.toContain("xiaoke");
      expect(evaluation.eligible_agent_ids).toContain("lucien");
    });
  });

  describe("TurnEvaluator — no policy configured", () => {
    it("returns empty eligible list when no policy exists", async () => {
      await conversationRepo.createConversation({
        id: "conv-no-policy",
        kind: "house_chat",
        participant_ai_ids: ["xiaoke"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-no-policy",
        message_id: "msg-1",
      });

      expect(evaluation.eligible_agent_ids).toEqual([]);
      expect(evaluation.reason).toContain("no turn policy");
    });
  });

  describe("AgentRuntime — red line: no SDK imports", () => {
    it("AgentRuntime only depends on AIGateway interface, not SDK", async () => {
      // This is a structural assertion — if AgentRuntime imported any SDK,
      // it would fail typecheck since it shouldn't. We verify it works
      // with our mock gateway.
      await conversationRepo.createConversation({
        id: "conv-redline",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-redline",
        message_id: "msg-1",
        scene_id: "room-living-room",
      });

      const responses = await runtime.processEvaluation(evaluation, {
        scene_id: "room-living-room",
        conversation_kind: "house_chat",
      });

      // Runtime produced a response using only the AIGateway interface
      expect(responses).toHaveLength(1);
      expect(gateway.complete).toHaveBeenCalled();
    });
  });

  describe("MockMemoryAdapter", () => {
    it("recall returns empty arrays", async () => {
      const adapter = new MockMemoryAdapter();
      const result = await adapter.recall({ agent_id: "xiaoke" });
      expect(result.memories).toEqual([]);
      expect(result.private_notes).toEqual([]);
    });
  });

  describe("阻塞项修复：affinity 作为概率权重", () => {
    beforeEach(async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "therapist", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-affinity",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["therapist", "xiaoke"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    it("affinity=0 agent is never selected", async () => {
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.01);
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-affinity",
        message_id: "msg-ai-trigger",
        sender_agent_id: "xiaoke",
        scene_id: "room-living-room",
      });
      expect(evaluation.eligible_agent_ids).not.toContain("therapist");
      spy.mockRestore();
    });

    it("affinity=0 agent still excluded even with low roll", async () => {
      // roll=0.0 would pass any non-zero affinity, but therapist has affinity=0
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.0);
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-affinity",
        message_id: "msg-ai-trigger",
        sender_agent_id: "xiaoke",
        scene_id: "room-living-room",
      });
      // therapist affinity=0 → 0 > 0 is false → always excluded
      expect(evaluation.eligible_agent_ids).not.toContain("therapist");
      spy.mockRestore();
    });

    it("affinity=0.7 agent rejected when roll >= 0.7", async () => {
      // Put lucien (affinity=0.5) and jasper (affinity=0.6) in scene
      await db.insert(schema.aiPresence).values([
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);
      await db.run(sql`UPDATE conversations SET participant_ai_ids = '["therapist","xiaoke","lucien"]' WHERE id = 'conv-affinity'`);

      // roll=0.65 → lucien (0.5): 0.65 >= 0.5 → rejected
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.65);
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-affinity",
        message_id: "msg-ai-trigger",
        sender_agent_id: "xiaoke",
        scene_id: "room-living-room",
      });
      expect(evaluation.eligible_agent_ids).not.toContain("lucien");
      spy.mockRestore();
    });

    it("affinity=0.5 agent selected when roll < 0.5", async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);
      await db.run(sql`UPDATE conversations SET participant_ai_ids = '["therapist","xiaoke","lucien"]' WHERE id = 'conv-affinity'`);

      // roll=0.3 → lucien (0.5): 0.3 < 0.5 → selected
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.3);
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-affinity",
        message_id: "msg-ai-trigger",
        sender_agent_id: "xiaoke",
        scene_id: "room-living-room",
      });
      expect(evaluation.eligible_agent_ids).toContain("lucien");
      spy.mockRestore();
    });
  });

  describe("阻塞项修复：cooldown/max_consecutive 查最近历史", () => {
    beforeEach(async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-consecutive",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    it("max_consecutive blocks random when recent tail is all AI messages", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const pastPlus1 = new Date(Date.now() - 59_000).toISOString();
      const pastPlus2 = new Date(Date.now() - 58_000).toISOString();

      // Insert: user msg, then 2 AI messages (max_consecutive=2 for living room)
      await conversationRepo.createMessage({
        id: "msg-old-user",
        conversation_id: "conv-consecutive",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "hi",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: past,
      });
      await conversationRepo.createMessage({
        id: "msg-ai-1",
        conversation_id: "conv-consecutive",
        conversation_kind: "house_chat",
        sender_type: "ai",
        sender_ai_id: "xiaoke",
        content: "reply 1",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: pastPlus1,
      });
      await conversationRepo.createMessage({
        id: "msg-ai-2",
        conversation_id: "conv-consecutive",
        conversation_kind: "house_chat",
        sender_type: "ai",
        sender_ai_id: "lucien",
        content: "reply 2",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: pastPlus2,
      });

      // Living room max_consecutive=2, there are already 2 consecutive AI messages
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-consecutive",
        message_id: "msg-ai-2",
        sender_agent_id: "lucien",
        scene_id: "room-living-room",
      });

      // Random should be blocked because consecutive count (2) >= max_consecutive (2)
      // Only mention path could add agents
      expect(evaluation.eligible_agent_ids).not.toContain("xiaoke");
    });

    it("max_consecutive allows random when user message breaks the streak", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const pastPlus1 = new Date(Date.now() - 59_000).toISOString();
      const pastPlus2 = new Date(Date.now() - 58_000).toISOString();

      await conversationRepo.createMessage({
        id: "msg-ai-old",
        conversation_id: "conv-consecutive",
        conversation_kind: "house_chat",
        sender_type: "ai",
        sender_ai_id: "xiaoke",
        content: "old reply",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: past,
      });
      await conversationRepo.createMessage({
        id: "msg-user-break",
        conversation_id: "conv-consecutive",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "user breaks streak",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: pastPlus1,
      });
      await conversationRepo.createMessage({
        id: "msg-ai-after",
        conversation_id: "conv-consecutive",
        conversation_kind: "house_chat",
        sender_type: "ai",
        sender_ai_id: "lucien",
        content: "new reply",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: pastPlus2,
      });

      // Only 1 consecutive AI message (after user break), max_consecutive=2
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.1);
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-consecutive",
        message_id: "msg-ai-after",
        sender_agent_id: "lucien",
        scene_id: "room-living-room",
      });

      // xiaoke has affinity 0.7, roll=0.1 < 0.7 → selected
      expect(evaluation.eligible_agent_ids).toContain("xiaoke");
      spy.mockRestore();
    });

    it("cooldown excludes the trigger message itself from last-AI-time check", async () => {
      const longAgo = new Date(Date.now() - 120_000).toISOString();
      const justNow = new Date().toISOString();

      // User message long ago
      await conversationRepo.createMessage({
        id: "msg-user-cd",
        conversation_id: "conv-consecutive",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "hello",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: longAgo,
      });
      // Trigger AI message just written (this is the message being evaluated)
      await conversationRepo.createMessage({
        id: "msg-trigger-cd",
        conversation_id: "conv-consecutive",
        conversation_kind: "house_chat",
        sender_type: "ai",
        sender_ai_id: "lucien",
        content: "trigger reply",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: justNow,
      });

      // cooldown_ms=5000; without exclusion, trigger's timestamp (just now) would
      // make cooldown fail. With exclusion, no prior AI message → cooldown passes.
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.1);
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-consecutive",
        message_id: "msg-trigger-cd",
        sender_agent_id: "lucien",
        scene_id: "room-living-room",
      });

      // xiaoke (affinity=0.7, roll=0.1) should be eligible — cooldown must not block
      expect(evaluation.eligible_agent_ids).toContain("xiaoke");
      spy.mockRestore();
    });
  });

  describe("阻塞项修复：同时间戳 id DESC 次级排序", () => {
    beforeEach(async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-tiebreak",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        turn_policy: {
          policy_id: "tiebreak-test",
          triggers: {
            on_user_message: "all_present",
            on_agent_message: {
              mention: false,
              random: true,
              cooldown_ms: 0,
              max_consecutive: 1,
            },
          },
        },
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    it("same-timestamp user+AI messages are ordered by id, consecutive count is correct", async () => {
      const sameTime = new Date(Date.now() - 30_000).toISOString();

      // user message and AI message share the same created_at
      // id "msg-b-user" > "msg-a-ai" lexicographically, so user is "newer"
      await conversationRepo.createMessage({
        id: "msg-a-ai",
        conversation_id: "conv-tiebreak",
        conversation_kind: "house_chat",
        sender_type: "ai",
        sender_ai_id: "xiaoke",
        content: "ai reply",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: sameTime,
      });
      await conversationRepo.createMessage({
        id: "msg-b-user",
        conversation_id: "conv-tiebreak",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "user msg",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: sameTime,
      });

      // max_consecutive=1: without id DESC tiebreaker, nondeterministic order
      // could place msg-a-ai first → consecutive=1 → 1 >= 1 → blocked.
      // With id DESC: msg-b-user (larger id) comes first → consecutive=0 → passes.
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.1);
      const evaluation = await turnEvaluator.evaluateAgentMessage({
        conversation_id: "conv-tiebreak",
        message_id: "msg-b-user",
        sender_agent_id: "xiaoke",
        scene_id: "room-living-room",
      });

      // consecutive=0 < max_consecutive=1, random path runs
      // lucien (affinity=0.5, roll=0.1) should be eligible
      expect(evaluation.eligible_agent_ids).toContain("lucien");
      spy.mockRestore();
    });
  });

  describe("阻塞项修复：单 agent 失败不拖垮整批", () => {
    it("one agent gateway failure does not block other agents", async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-fail",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await conversationRepo.createMessage({
        id: "msg-user-fail",
        conversation_id: "conv-fail",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "hello",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: new Date().toISOString(),
      });

      // Make gateway fail for the first call, succeed for the second
      let callCount = 0;
      const failingGateway: AIGateway = {
        complete: vi.fn().mockImplementation(async (req: GatewayCompletionRequest) => {
          callCount++;
          if (callCount === 1) {
            throw new Error("simulated gateway failure");
          }
          return {
            content: "success",
            usage: { input_tokens: 1, output_tokens: 1 },
            model_id: req.model_id,
            provider_id: req.provider_id,
            finish_reason: "end_turn",
          } satisfies GatewayCompletionResponse;
        }),
      };

      const failRuntime = new AgentRuntime({
        db,
        gateway: failingGateway,
        contextBuilder,
        conversationRepo,
      });

      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-fail",
        message_id: "msg-user-fail",
        scene_id: "room-living-room",
      });

      // Should NOT throw, and should return 1 successful response
      const responses = await failRuntime.processEvaluation(evaluation, {
        scene_id: "room-living-room",
        conversation_kind: "house_chat",
      });

      expect(responses).toHaveLength(1);
    });
  });

  describe("阻塞项修复：message ID 使用 UUID 避免冲突", () => {
    it("parallel agent responses produce unique message IDs", async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "jasper", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-uuid",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien", "jasper"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await conversationRepo.createMessage({
        id: "msg-user-uuid",
        conversation_id: "conv-uuid",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "test",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: new Date().toISOString(),
      });

      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-uuid",
        message_id: "msg-user-uuid",
        scene_id: "room-living-room",
      });

      const responses = await runtime.processEvaluation(evaluation, {
        scene_id: "room-living-room",
        conversation_kind: "house_chat",
      });

      // All 3 agents responded with unique IDs
      expect(responses).toHaveLength(3);
      const ids = new Set(responses.map((r) => r.message_id));
      expect(ids.size).toBe(3);

      // IDs should start with msg_ and contain UUID format
      for (const r of responses) {
        expect(r.message_id).toMatch(/^msg_[0-9a-f-]{36}$/);
      }
    });
  });

  describe("验收场景：公共客厅顺序接话 — 蓝玻璃钥匙 7F3A", () => {
    beforeEach(async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "jasper", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-sequential",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["jasper", "xiaoke"],
        turn_policy: {
          policy_id: "living-room-default",
          triggers: {
            on_user_message: "all_present",
            on_agent_message: {
              mention: true,
              random: true,
              cooldown_ms: 5000,
              max_consecutive: 2,
            },
          },
          reply_mode: "sequential",
        },
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await conversationRepo.createMessage({
        id: "msg-user-key",
        conversation_id: "conv-sequential",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "@Jasper 你有没有蓝玻璃钥匙？",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: new Date().toISOString(),
      });
    });

    it("sequential: xiaoke's gateway INPUT contains Jasper's identity and content", async () => {
      const seqGateway = {
        calls: [] as GatewayCompletionRequest[],
        complete: vi.fn().mockImplementation(async (req: GatewayCompletionRequest) => {
          seqGateway.calls.push(req);
          const isJasper = req.model_id === "gpt-4o";
          return {
            content: isJasper
              ? "有的，编号 7F3A。"
              : "Jasper 说的那把 7F3A 蓝玻璃钥匙我也见过。",
            usage: { input_tokens: 10, output_tokens: 5 },
            model_id: req.model_id,
            provider_id: req.provider_id,
            finish_reason: "end_turn",
          } satisfies GatewayCompletionResponse;
        }),
      };

      const seqRuntime = new AgentRuntime({
        db,
        gateway: seqGateway,
        contextBuilder,
        conversationRepo,
      });

      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-sequential",
        message_id: "msg-user-key",
        scene_id: "room-living-room",
      });

      expect(evaluation.eligible_agent_ids).toContain("jasper");
      expect(evaluation.eligible_agent_ids).toContain("xiaoke");

      const responses = await seqRuntime.processEvaluationSequential(
        evaluation,
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      expect(responses).toHaveLength(2);

      // Gateway called twice (sequential — jasper first, then xiaoke)
      expect(seqGateway.calls).toHaveLength(2);

      // Find xiaoke's gateway call (anthropic provider)
      const xiaokeCall = seqGateway.calls.find((c) => c.provider_id === "anthropic");
      expect(xiaokeCall).toBeDefined();

      // Xiaoke's gateway INPUT must contain Jasper's message with sender_ai_id
      const jasperMsgInContext = xiaokeCall!.messages.find(
        (m) => m.sender_ai_id === "jasper",
      );
      expect(jasperMsgInContext).toBeDefined();
      expect(jasperMsgInContext!.content).toContain("7F3A");
      expect(jasperMsgInContext!.name).toBe("Jasper");

      // Jasper's message is mapped to role "user" with [DisplayName] prefix (other agent's message)
      expect(jasperMsgInContext!.role).toBe("user");
      expect(jasperMsgInContext!.content).toContain("[Jasper]");

      // DB has correct messages
      const allMessages = await conversationRepo.getRecentMessages("conv-sequential", 100);
      expect(allMessages).toHaveLength(3); // 1 user + 2 AI
      const aiMessages = allMessages.filter((m) => m.sender_type === "ai");
      expect(aiMessages).toHaveLength(2);

      // Both AI messages have sender_ai_id set
      for (const msg of aiMessages) {
        expect(msg.sender_ai_id).toBeDefined();
      }
      const jasperMsg = aiMessages.find((m) => m.sender_ai_id === "jasper");
      expect(jasperMsg).toBeDefined();
      expect(jasperMsg!.content).toContain("7F3A");
    });

    it("sequential: Jasper's gateway input does NOT contain xiaoke's message", async () => {
      const seqGateway = {
        calls: [] as GatewayCompletionRequest[],
        complete: vi.fn().mockImplementation(async (req: GatewayCompletionRequest) => {
          seqGateway.calls.push(req);
          return {
            content: req.model_id === "gpt-4o" ? "有的，编号 7F3A。" : "好的",
            usage: { input_tokens: 10, output_tokens: 5 },
            model_id: req.model_id,
            provider_id: req.provider_id,
            finish_reason: "end_turn",
          } satisfies GatewayCompletionResponse;
        }),
      };

      const seqRuntime = new AgentRuntime({
        db,
        gateway: seqGateway,
        contextBuilder,
        conversationRepo,
      });

      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-sequential",
        message_id: "msg-user-key",
        scene_id: "room-living-room",
      });

      await seqRuntime.processEvaluationSequential(
        evaluation,
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      // Jasper's call is first — should NOT contain xiaoke's response
      const jasperCall = seqGateway.calls.find((c) => c.provider_id === "openai");
      expect(jasperCall).toBeDefined();
      const xiaokeInJasperContext = jasperCall!.messages.find(
        (m) => m.sender_ai_id === "xiaoke",
      );
      expect(xiaokeInJasperContext).toBeUndefined();
    });

    it("concurrent mode: processEvaluation does NOT guarantee cross-visibility", async () => {
      const responses = await runtime.processEvaluation(
        await turnEvaluator.evaluateUserMessage({
          conversation_id: "conv-sequential",
          message_id: "msg-user-key",
          scene_id: "room-living-room",
        }),
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      // Both still respond (concurrent mode still works)
      expect(responses).toHaveLength(2);

      // But in concurrent mode, neither agent sees the other's response in their gateway input
      // (they read the timeline at the same time, before either has responded)
      for (const call of gateway.calls) {
        const otherAgentMsgs = call.messages.filter((m) => m.sender_ai_id);
        expect(otherAgentMsgs).toHaveLength(0);
      }
    });

    it("sequential: failed agent creates NO ghost message, next agent still runs", async () => {
      let callIdx = 0;
      const failGateway: AIGateway = {
        complete: vi.fn().mockImplementation(async (req: GatewayCompletionRequest) => {
          callIdx++;
          if (callIdx === 1) throw new Error("jasper gateway down");
          return {
            content: "小克正常回复",
            usage: { input_tokens: 10, output_tokens: 5 },
            model_id: req.model_id,
            provider_id: req.provider_id,
            finish_reason: "end_turn",
          } satisfies GatewayCompletionResponse;
        }),
      };

      const failRuntime = new AgentRuntime({
        db,
        gateway: failGateway,
        contextBuilder,
        conversationRepo,
      });

      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-sequential",
        message_id: "msg-user-key",
        scene_id: "room-living-room",
      });

      const responses = await failRuntime.processEvaluationSequential(
        evaluation,
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      // Only xiaoke responded (jasper failed)
      expect(responses).toHaveLength(1);
      expect(responses[0].agent_id).toBe("xiaoke");

      // DB: 1 user message + 1 AI message (no ghost from jasper)
      const allMessages = await conversationRepo.getRecentMessages("conv-sequential", 100);
      expect(allMessages).toHaveLength(2);
      const aiMessages = allMessages.filter((m) => m.sender_type === "ai");
      expect(aiMessages).toHaveLength(1);
      expect(aiMessages[0].sender_ai_id).toBe("xiaoke");
    });

    it("same-timestamp messages preserve causal order via seq", async () => {
      const sameTime = new Date().toISOString();

      // Jasper's response has the same timestamp as the user message
      const seqGateway = {
        calls: [] as GatewayCompletionRequest[],
        complete: vi.fn().mockImplementation(async (req: GatewayCompletionRequest) => {
          seqGateway.calls.push(req);
          return {
            content: req.model_id === "gpt-4o" ? "有的，编号 7F3A。" : "好",
            usage: { input_tokens: 10, output_tokens: 5 },
            model_id: req.model_id,
            provider_id: req.provider_id,
            finish_reason: "end_turn",
          } satisfies GatewayCompletionResponse;
        }),
      };

      const seqRuntime = new AgentRuntime({
        db,
        gateway: seqGateway,
        contextBuilder,
        conversationRepo,
      });

      const evaluation = await turnEvaluator.evaluateUserMessage({
        conversation_id: "conv-sequential",
        message_id: "msg-user-key",
        scene_id: "room-living-room",
      });

      await seqRuntime.processEvaluationSequential(
        evaluation,
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      const allMessages = await conversationRepo.getRecentMessages("conv-sequential", 100);

      // Causal order must be: user question → jasper answer → xiaoke answer
      expect(allMessages[0].sender_type).toBe("user");
      expect(allMessages[0].content).toContain("蓝玻璃钥匙");
      expect(allMessages[1].sender_ai_id).toBe("jasper");
      expect(allMessages[2].sender_ai_id).toBe("xiaoke");

      // seq must be monotonically increasing
      expect(allMessages[0].seq).toBeLessThan(allMessages[1].seq);
      expect(allMessages[1].seq).toBeLessThan(allMessages[2].seq);
    });
  });

  describe("token budget enforcement in runtime", () => {
    it("sequential: budget deducts total (input+output), caps max_tokens", async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-budget-seq",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const budgetGateway = mockGateway();
      // Each call: 10 input + 5 output = 15 total
      const seqRuntime = new AgentRuntime({
        db,
        gateway: budgetGateway,
        contextBuilder,
        conversationRepo,
      });

      // Budget = 30; first agent uses 15 (10+5), leaving 15; second agent gets max_tokens=15
      const responses = await seqRuntime.processEvaluationSequential(
        {
          conversation_id: "conv-budget-seq",
          trigger_message_id: "msg-test",
          eligible_agent_ids: ["xiaoke", "lucien"],
          reason: "test",
          evaluated_at: new Date().toISOString(),
          remaining_token_budget: 30,
        },
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      expect(responses.length).toBe(2);
      // First call: max_tokens = min(1024, 30) = 30
      expect(budgetGateway.calls[0].max_tokens).toBe(30);
      // Second call: max_tokens = min(1024, 15) = 15 (30 - 15 total = 15 remaining)
      expect(budgetGateway.calls[1].max_tokens).toBe(15);
    });

    it("sequential: skips agent when budget exhausted after first call", async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-budget-exhaust",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const budgetGateway = mockGateway();
      const seqRuntime = new AgentRuntime({
        db,
        gateway: budgetGateway,
        contextBuilder,
        conversationRepo,
      });

      // Budget = 10; first agent uses 15 (10 input + 5 output) → overshoots → budget = -5 → second skipped
      const responses = await seqRuntime.processEvaluationSequential(
        {
          conversation_id: "conv-budget-exhaust",
          trigger_message_id: "msg-test",
          eligible_agent_ids: ["xiaoke", "lucien"],
          reason: "test",
          evaluated_at: new Date().toISOString(),
          remaining_token_budget: 10,
        },
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      expect(responses.length).toBe(1);
      expect(responses[0].agent_id).toBe("xiaoke");
      expect(budgetGateway.calls.length).toBe(1);
    });

    it("concurrent: divides budget equally among agents", async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-budget-conc",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const budgetGateway = mockGateway();
      const concRuntime = new AgentRuntime({
        db,
        gateway: budgetGateway,
        contextBuilder,
        conversationRepo,
      });

      await concRuntime.processEvaluation(
        {
          conversation_id: "conv-budget-conc",
          trigger_message_id: "msg-test",
          eligible_agent_ids: ["xiaoke", "lucien"],
          reason: "test",
          evaluated_at: new Date().toISOString(),
          remaining_token_budget: 10,
        },
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      // Budget 10 / 2 agents = ceil(10/2) = 5 each
      expect(budgetGateway.calls.length).toBe(2);
      for (const call of budgetGateway.calls) {
        expect(call.max_tokens).toBe(5);
      }
    });

    it("concurrent: budget=2 with 3 agents gives ceil(2/3)=1 each, not unlimited", async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "jasper", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-budget-ceil",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien", "jasper"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const budgetGateway = mockGateway();
      const concRuntime = new AgentRuntime({
        db,
        gateway: budgetGateway,
        contextBuilder,
        conversationRepo,
      });

      await concRuntime.processEvaluation(
        {
          conversation_id: "conv-budget-ceil",
          trigger_message_id: "msg-test",
          eligible_agent_ids: ["xiaoke", "lucien", "jasper"],
          reason: "test",
          evaluated_at: new Date().toISOString(),
          remaining_token_budget: 2,
        },
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      // ceil(2/3) = 1 per agent — each gets max_tokens=1, NOT 1024
      expect(budgetGateway.calls.length).toBe(3);
      for (const call of budgetGateway.calls) {
        expect(call.max_tokens).toBe(1);
      }
    });

    it("concurrent: budget=0 produces no gateway calls", async () => {
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-budget-zero",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const budgetGateway = mockGateway();
      const concRuntime = new AgentRuntime({
        db,
        gateway: budgetGateway,
        contextBuilder,
        conversationRepo,
      });

      const responses = await concRuntime.processEvaluation(
        {
          conversation_id: "conv-budget-zero",
          trigger_message_id: "msg-test",
          eligible_agent_ids: ["xiaoke", "lucien"],
          reason: "test",
          evaluated_at: new Date().toISOString(),
          remaining_token_budget: 0,
        },
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );

      // Budget=0 → ceil(0/2)=0 → generateResponse returns null for all → no calls
      expect(responses.length).toBe(0);
      expect(budgetGateway.calls.length).toBe(0);
    });
  });

  describe("end-to-end chain stop via evaluator", () => {
    it("M=2 chain: user → agent1 → agent2 chains → 3rd agent blocked by rounds limit", async () => {
      const chainPolicy = {
        policy_id: "chain-test",
        triggers: {
          on_user_message: "all_present",
          on_agent_message: {
            mention: false,
            random: true,
            cooldown_ms: 0,
            max_consecutive: 100,
          },
        },
        self_chat_limits: {
          per_agent_max_per_minute: 100,
          max_agent_rounds_without_user: 2,
          max_total_messages: 100,
        },
      };

      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "active", updated_at: new Date().toISOString() },
      ]);

      await conversationRepo.createConversation({
        id: "conv-chain-stop",
        kind: "house_chat",
        scene_id: "room-living-room",
        participant_ai_ids: ["xiaoke", "lucien"],
        turn_policy: chainPolicy as any,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // User message
      await conversationRepo.createMessage({
        id: "msg-chain-user",
        conversation_id: "conv-chain-stop",
        conversation_kind: "house_chat",
        sender_type: "user",
        content: "hello everyone",
        context_type: "out_of_world",
        context_set_by: "server",
        created_at: new Date().toISOString(),
      });

      // Set both agents' affinity to 1 so they always want to speak
      await db.run(sql`UPDATE agent_runtime_configs SET random_reply_affinity = 1.0 WHERE agent_id IN ('xiaoke','lucien')`);

      const chainEvaluator = new TurnEvaluator({ db, rng: () => 0 });

      // Step 1: evaluate user message → both agents eligible
      const eval1 = await chainEvaluator.evaluateUserMessage({
        conversation_id: "conv-chain-stop",
        message_id: "msg-chain-user",
        scene_id: "room-living-room",
      });
      expect(eval1.eligible_agent_ids.length).toBe(2);

      // Simulate agent responses (runtime would do this)
      const chainGateway = mockGateway();
      const chainRuntime = new AgentRuntime({
        db, gateway: chainGateway, contextBuilder, conversationRepo,
      });

      const responses1 = await chainRuntime.processEvaluationSequential(
        eval1,
        { scene_id: "room-living-room", conversation_kind: "house_chat" },
      );
      expect(responses1.length).toBe(2);

      // Step 2: evaluate chain from last agent → M=2, already 2 AI messages → blocked
      const eval2 = await chainEvaluator.evaluateAgentMessage({
        conversation_id: "conv-chain-stop",
        message_id: responses1[1].message_id,
        sender_agent_id: responses1[1].agent_id,
        scene_id: "room-living-room",
      });

      expect(eval2.eligible_agent_ids).toEqual([]);
      expect(eval2.reason).toContain("self_chat_limit");
      expect(eval2.reason).toContain("max_agent_rounds_without_user");
    });
  });
});

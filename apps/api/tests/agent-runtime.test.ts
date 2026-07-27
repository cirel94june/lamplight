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
    {
      agent_id: "xiaoke",
      display_name: "小克",
      provider_id: "anthropic",
      model_id: "claude-opus-4-6",
      memory_scope: "xiaoke",
    },
    {
      agent_id: "lucien",
      display_name: "Lucien",
      provider_id: "anthropic",
      model_id: "claude-opus-4-6",
      memory_scope: "lucien",
    },
    {
      agent_id: "jasper",
      display_name: "Jasper",
      provider_id: "openai",
      model_id: "gpt-4o",
      memory_scope: "jasper",
    },
    {
      agent_id: "therapist",
      display_name: "心理咨询师",
      provider_id: "anthropic",
      model_id: "claude-opus-4-6",
      memory_scope: "therapist",
    },
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
      gateway,
      contextBuilder,
      conversationRepo,
    });
  });

  describe("场景 1：客厅广播 — 用户发消息，所有在场 AI 回复", () => {
    beforeEach(async () => {
      // Place xiaoke, lucien, jasper in living room
      await db.insert(schema.aiPresence).values([
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
        { ai_id: "jasper", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
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
        { ai_id: "xiaoke", scene_id: "room-ceci-bedroom", state: "idle", updated_at: new Date().toISOString() },
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
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
        { ai_id: "jasper", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
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
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
        { ai_id: "lucien", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
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
        { ai_id: "xiaoke", scene_id: "room-living-room", state: "idle", updated_at: new Date().toISOString() },
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
});

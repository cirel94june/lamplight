import type {
  AIGateway,
  TurnEvaluation,
  GatewayCompletionResponse,
} from "@lamplight/contracts";
import { ContextBuilder } from "./context-builder.js";
import { ConversationRepository } from "./conversation-repository.js";

export interface AgentRuntimeDeps {
  gateway: AIGateway;
  contextBuilder: ContextBuilder;
  conversationRepo: ConversationRepository;
}

export interface AgentResponse {
  agent_id: string;
  message_id: string;
  content: string;
  usage: { input_tokens: number; output_tokens: number };
}

export class AgentRuntime {
  constructor(private deps: AgentRuntimeDeps) {}

  async processEvaluation(
    evaluation: TurnEvaluation,
    opts: {
      scene_id?: string;
      conversation_kind: string;
    },
  ): Promise<AgentResponse[]> {
    if (evaluation.eligible_agent_ids.length === 0) return [];

    const conv = await this.deps.conversationRepo.getConversation(
      evaluation.conversation_id,
    );
    if (!conv) {
      throw new Error(`Conversation not found: ${evaluation.conversation_id}`);
    }

    const results = await Promise.all(
      evaluation.eligible_agent_ids.map((agentId) =>
        this.generateResponse(agentId, evaluation, opts),
      ),
    );

    return results.filter((r): r is AgentResponse => r !== null);
  }

  private async generateResponse(
    agentId: string,
    evaluation: TurnEvaluation,
    opts: { scene_id?: string; conversation_kind: string },
  ): Promise<AgentResponse | null> {
    const providerConfig =
      await this.deps.contextBuilder.getProviderConfig(agentId);
    if (!providerConfig) {
      console.error(`[runtime] no provider config for agent ${agentId}`);
      return null;
    }

    const runtimeConfig =
      await this.deps.contextBuilder.getRuntimeConfig(agentId);

    const messages = await this.deps.contextBuilder.build({
      agent_id: agentId,
      conversation_id: evaluation.conversation_id,
      scene_id: opts.scene_id,
      conversation_kind: opts.conversation_kind as "house_chat",
    });

    let response: GatewayCompletionResponse;
    try {
      response = await this.deps.gateway.complete({
        provider_id: providerConfig.provider_id,
        model_id: providerConfig.model_id,
        messages,
        max_tokens: runtimeConfig?.max_response_tokens ?? undefined,
        temperature: runtimeConfig?.temperature ?? undefined,
      });
    } catch (error) {
      console.error(`[runtime] gateway error for agent ${agentId}:`, error);
      return null;
    }

    const messageId = `msg_${Date.now()}_${agentId}`;
    const now = new Date().toISOString();

    await this.deps.conversationRepo.createMessage({
      id: messageId,
      conversation_id: evaluation.conversation_id,
      conversation_kind: opts.conversation_kind,
      sender_type: "ai",
      sender_ai_id: agentId,
      content: response.content,
      context_type: "out_of_world",
      context_set_by: "server",
      prompt_snapshot: {
        model: response.model_id,
        rendered_prompt: messages[0]?.content ?? "",
        created_at: now,
      },
      created_at: now,
    });

    return {
      agent_id: agentId,
      message_id: messageId,
      content: response.content,
      usage: response.usage,
    };
  }
}

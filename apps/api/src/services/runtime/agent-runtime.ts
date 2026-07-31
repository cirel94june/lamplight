import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type {
  AIGateway,
  TurnEvaluation,
  GatewayCompletionResponse,
} from "@lamplight/contracts";
import * as schema from "../../db/schema.js";
import { ContextBuilder } from "./context-builder.js";
import { ConversationRepository } from "./conversation-repository.js";

export interface AgentRuntimeDeps {
  db: LibSQLDatabase<typeof schema>;
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
    try {
      const providerConfig =
        await this.deps.contextBuilder.getProviderConfig(agentId);
      if (!providerConfig) {
        console.error(`[runtime] no provider config for agent ${agentId}`);
        return null;
      }

      if (providerConfig.fault_state === "offline") {
        console.warn(`[runtime] agent ${agentId} binding is offline, skipping`);
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

      const completionPromise = this.deps.gateway.complete({
        provider_id: providerConfig.provider_id,
        model_id: providerConfig.model_id,
        api_provider_id: providerConfig.api_provider_id,
        messages,
        max_tokens: runtimeConfig?.max_response_tokens ?? undefined,
        temperature: runtimeConfig?.temperature ?? undefined,
        retry_max: providerConfig.retry_max,
      });

      const timeoutMs = providerConfig.timeout_ms;
      const response: GatewayCompletionResponse = await (timeoutMs > 0
        ? Promise.race([
            completionPromise,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Gateway timeout after ${timeoutMs}ms`)), timeoutMs),
            ),
          ])
        : completionPromise);

      const messageId = `msg_${randomUUID()}`;
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

      await this.updateBindingStats(agentId, now, false);

      return {
        agent_id: agentId,
        message_id: messageId,
        content: response.content,
        usage: response.usage,
      };
    } catch (error) {
      console.error(`[runtime] agent ${agentId} failed:`, error);
      await this.updateBindingStats(agentId, new Date().toISOString(), true);
      return null;
    }
  }

  private async updateBindingStats(agentId: string, now: string, isError: boolean): Promise<void> {
    try {
      const updates: Record<string, unknown> = {
        last_call_at: now,
        total_calls: sql`total_calls + 1`,
        updated_at: now,
      };
      if (isError) {
        updates.total_errors = sql`total_errors + 1`;
        const rows = await this.deps.db
          .select({
            total_errors: schema.agentModelBindings.total_errors,
            total_calls: schema.agentModelBindings.total_calls,
            retry_max: schema.agentModelBindings.retry_max,
            fault_state: schema.agentModelBindings.fault_state,
          })
          .from(schema.agentModelBindings)
          .where(eq(schema.agentModelBindings.agent_id, agentId))
          .limit(1);
        const binding = rows[0];
        if (binding) {
          const newErrors = (binding.total_errors ?? 0) + 1;
          const newCalls = (binding.total_calls ?? 0) + 1;
          const retryMax = binding.retry_max ?? 3;
          const consecutiveThreshold = retryMax + 1;
          if (newErrors >= consecutiveThreshold * 2) {
            updates.fault_state = "offline";
            if (binding.fault_state !== "offline") updates.fault_since = now;
          } else if (newErrors >= consecutiveThreshold) {
            updates.fault_state = "degraded";
            if (binding.fault_state === "ok") updates.fault_since = now;
          }
        }
      } else {
        updates.fault_state = "ok";
        updates.fault_since = null;
        updates.total_errors = 0;
      }
      await this.deps.db
        .update(schema.agentModelBindings)
        .set(updates)
        .where(eq(schema.agentModelBindings.agent_id, agentId));
    } catch (err) {
      console.error(`[runtime] failed to update binding stats for ${agentId}:`, err);
    }
  }
}

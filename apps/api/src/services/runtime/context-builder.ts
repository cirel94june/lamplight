import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type {
  ContextBuildRequest,
  GatewayMessage,
  MemoryAdapter,
} from "@lamplight/contracts";
import * as schema from "../../db/schema.js";
import { ConversationRepository } from "./conversation-repository.js";

export interface ContextBuilderDeps {
  db: LibSQLDatabase<typeof schema>;
  memoryAdapter: MemoryAdapter;
  conversationRepo: ConversationRepository;
}

export class ContextBuilder {
  constructor(private deps: ContextBuilderDeps) {}

  async build(request: ContextBuildRequest): Promise<GatewayMessage[]> {
    const profile = await this.getAgentProfile(request.agent_id);
    if (!profile) {
      throw new Error(`Agent profile not found: ${request.agent_id}`);
    }

    const runtimeConfig = await this.getAgentRuntimeConfig(request.agent_id);
    const scene = request.scene_id
      ? await this.getScene(request.scene_id)
      : null;

    const systemPrompt = this.renderSystemPrompt(
      runtimeConfig?.system_prompt_template ?? `You are ${profile.display_name}.`,
      {
        agent_name: profile.display_name,
        scene_name: scene?.display_name ?? "unknown",
      },
      scene?.prompt_weight_overrides as Record<string, number> | null,
    );

    await this.deps.memoryAdapter.recall({
      agent_id: request.agent_id,
      scene_id: request.scene_id,
      conversation_id: request.conversation_id,
    });

    const limit = request.max_history_messages ?? 50;
    const historyRows = await this.deps.conversationRepo.getRecentMessages(
      request.conversation_id,
      limit,
    );

    const messages: GatewayMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const row of historyRows) {
      const role =
        row.sender_type === "user"
          ? "user"
          : row.sender_type === "ai"
            ? "assistant"
            : "user";
      messages.push({ role, content: row.content });
    }

    return messages;
  }

  getProviderConfig(agentId: string) {
    return this.getAgentProfile(agentId).then((p) =>
      p ? { provider_id: p.provider_id, model_id: p.model_id, api_provider_id: p.api_provider_id ?? "" } : null,
    );
  }

  getRuntimeConfig(agentId: string) {
    return this.getAgentRuntimeConfig(agentId);
  }

  private renderSystemPrompt(
    template: string,
    vars: Record<string, string>,
    promptWeights: Record<string, number> | null,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }

    const weightsText = promptWeights && Object.keys(promptWeights).length > 0
      ? Object.entries(promptWeights)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "";
    result = result.replaceAll("{{prompt_weights}}", weightsText);

    return result;
  }

  private async getAgentProfile(agentId: string) {
    const rows = await this.deps.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.agent_id, agentId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async getAgentRuntimeConfig(agentId: string) {
    const rows = await this.deps.db
      .select()
      .from(schema.agentRuntimeConfigs)
      .where(eq(schema.agentRuntimeConfigs.agent_id, agentId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async getScene(sceneId: string) {
    const rows = await this.deps.db
      .select()
      .from(schema.scenes)
      .where(eq(schema.scenes.scene_id, sceneId))
      .limit(1);
    return rows[0] ?? null;
  }
}

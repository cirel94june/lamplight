import { eq, desc, and, ne } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { TurnPolicy, TurnEvaluation } from "@lamplight/contracts";
import * as schema from "../../db/schema.js";

export interface TurnEvaluatorDeps {
  db: LibSQLDatabase<typeof schema>;
}

export class TurnEvaluator {
  constructor(private deps: TurnEvaluatorDeps) {}

  async evaluateUserMessage(opts: {
    conversation_id: string;
    message_id: string;
    scene_id?: string;
    mentioned_agent_ids?: string[];
  }): Promise<TurnEvaluation> {
    const now = new Date().toISOString();
    const policy = await this.resolvePolicy(opts.conversation_id, opts.scene_id);

    if (!policy) {
      return {
        conversation_id: opts.conversation_id,
        trigger_message_id: opts.message_id,
        eligible_agent_ids: [],
        reason: "no turn policy configured",
        evaluated_at: now,
      };
    }

    const trigger = policy.triggers.on_user_message;

    if (trigger === "none") {
      return {
        conversation_id: opts.conversation_id,
        trigger_message_id: opts.message_id,
        eligible_agent_ids: [],
        reason: "on_user_message: none",
        evaluated_at: now,
      };
    }

    const presentAgentIds = await this.getPresentAgentIds(opts.scene_id);
    const conversationAgentIds = await this.getConversationAgentIds(opts.conversation_id);
    const residentAgentIds = presentAgentIds.filter((id) =>
      conversationAgentIds.includes(id),
    );

    if (trigger === "mentioned_only") {
      const mentioned = opts.mentioned_agent_ids ?? [];
      const eligible = residentAgentIds.filter((id) => mentioned.includes(id));
      return {
        conversation_id: opts.conversation_id,
        trigger_message_id: opts.message_id,
        eligible_agent_ids: eligible,
        reason: `on_user_message: mentioned_only (${mentioned.length} mentioned)`,
        evaluated_at: now,
      };
    }

    // all_present
    return {
      conversation_id: opts.conversation_id,
      trigger_message_id: opts.message_id,
      eligible_agent_ids: residentAgentIds,
      reason: `on_user_message: all_present (${residentAgentIds.length} present)`,
      evaluated_at: now,
    };
  }

  async evaluateAgentMessage(opts: {
    conversation_id: string;
    message_id: string;
    sender_agent_id: string;
    scene_id?: string;
    mentioned_agent_ids?: string[];
  }): Promise<TurnEvaluation> {
    const now = new Date().toISOString();
    const policy = await this.resolvePolicy(opts.conversation_id, opts.scene_id);

    if (!policy) {
      return {
        conversation_id: opts.conversation_id,
        trigger_message_id: opts.message_id,
        eligible_agent_ids: [],
        reason: "no turn policy configured",
        evaluated_at: now,
      };
    }

    const rules = policy.triggers.on_agent_message;
    const presentAgentIds = await this.getPresentAgentIds(opts.scene_id);
    const conversationAgentIds = await this.getConversationAgentIds(opts.conversation_id);
    const candidates = presentAgentIds.filter(
      (id) => id !== opts.sender_agent_id && conversationAgentIds.includes(id),
    );

    const eligible = new Set<string>();

    if (rules.mention && opts.mentioned_agent_ids?.length) {
      for (const id of opts.mentioned_agent_ids) {
        if (candidates.includes(id)) eligible.add(id);
      }
    }

    if (rules.random) {
      const recentConsecutive = await this.getConsecutiveAgentMessageCount(
        opts.conversation_id,
      );
      if (recentConsecutive < rules.max_consecutive) {
        const lastAgentMessageTime = await this.getLastAgentMessageTime(
          opts.conversation_id,
          opts.message_id,
        );
        const cooldownOk =
          !lastAgentMessageTime ||
          Date.now() - new Date(lastAgentMessageTime).getTime() >= rules.cooldown_ms;

        if (cooldownOk) {
          const affinities = await this.getAgentAffinities(candidates);
          for (const id of candidates) {
            const affinity = affinities.get(id) ?? 0;
            if (affinity > 0 && Math.random() < affinity) {
              eligible.add(id);
            }
          }
        }
      }
    }

    return {
      conversation_id: opts.conversation_id,
      trigger_message_id: opts.message_id,
      eligible_agent_ids: [...eligible],
      reason: `on_agent_message: mention=${rules.mention} random=${rules.random}`,
      evaluated_at: now,
    };
  }

  private async resolvePolicy(
    conversationId: string,
    sceneId?: string,
  ): Promise<TurnPolicy | null> {
    const conv = await this.deps.db
      .select({ turn_policy: schema.conversations.turn_policy })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1);

    if (conv[0]?.turn_policy) {
      return conv[0].turn_policy as unknown as TurnPolicy;
    }

    if (sceneId) {
      const scene = await this.deps.db
        .select({ default_turn_policy: schema.scenes.default_turn_policy })
        .from(schema.scenes)
        .where(eq(schema.scenes.scene_id, sceneId))
        .limit(1);

      if (scene[0]?.default_turn_policy) {
        return scene[0].default_turn_policy as unknown as TurnPolicy;
      }
    }

    return null;
  }

  private async getPresentAgentIds(sceneId?: string): Promise<string[]> {
    if (!sceneId) return [];
    const rows = await this.deps.db
      .select({ ai_id: schema.aiPresence.ai_id })
      .from(schema.aiPresence)
      .where(
        and(
          eq(schema.aiPresence.scene_id, sceneId),
          eq(schema.aiPresence.state, "active"),
        ),
      );
    return rows.map((r) => r.ai_id);
  }

  private async getConversationAgentIds(conversationId: string): Promise<string[]> {
    const rows = await this.deps.db
      .select({ participant_ai_ids: schema.conversations.participant_ai_ids })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1);
    return (rows[0]?.participant_ai_ids as string[]) ?? [];
  }

  private async getConsecutiveAgentMessageCount(
    conversationId: string,
  ): Promise<number> {
    const recent = await this.deps.db
      .select({
        sender_type: schema.messages.sender_type,
      })
      .from(schema.messages)
      .where(eq(schema.messages.conversation_id, conversationId))
      .orderBy(desc(schema.messages.created_at), desc(schema.messages.id))
      .limit(10);

    let count = 0;
    for (const row of recent) {
      if (row.sender_type === "ai") {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private async getLastAgentMessageTime(
    conversationId: string,
    excludeMessageId?: string,
  ): Promise<string | null> {
    const conditions = [
      eq(schema.messages.conversation_id, conversationId),
      eq(schema.messages.sender_type, "ai"),
    ];
    if (excludeMessageId) {
      conditions.push(ne(schema.messages.id, excludeMessageId));
    }
    const rows = await this.deps.db
      .select({ created_at: schema.messages.created_at })
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(desc(schema.messages.created_at), desc(schema.messages.id))
      .limit(1);

    return rows[0]?.created_at ?? null;
  }

  private async getAgentAffinities(
    agentIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (agentIds.length === 0) return result;

    for (const id of agentIds) {
      const rows = await this.deps.db
        .select({ random_reply_affinity: schema.agentRuntimeConfigs.random_reply_affinity })
        .from(schema.agentRuntimeConfigs)
        .where(eq(schema.agentRuntimeConfigs.agent_id, id))
        .limit(1);
      result.set(id, rows[0]?.random_reply_affinity ?? 0);
    }
    return result;
  }
}

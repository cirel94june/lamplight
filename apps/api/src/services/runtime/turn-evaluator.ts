import { eq, desc, and, gte, sql as drizzleSql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { turnPolicySchema } from "@lamplight/contracts";
import type { TurnPolicy, TurnEvaluation, SelfChatLimits } from "@lamplight/contracts";
import * as schema from "../../db/schema.js";

export interface TurnEvaluatorDeps {
  db: LibSQLDatabase<typeof schema>;
  rng?: () => number;
}

export class TurnEvaluator {
  constructor(private deps: TurnEvaluatorDeps) {}

  private roll(): number {
    return this.deps.rng ? this.deps.rng() : Math.random();
  }

  async evaluateUserMessage(opts: {
    conversation_id: string;
    message_id: string;
    scene_id?: string;
    mentioned_agent_ids?: string[];
    content?: string;
  }): Promise<TurnEvaluation> {
    const now = new Date().toISOString();
    const policy = await this.resolvePolicy(opts.conversation_id, opts.scene_id);

    if (!policy) {
      return this.result(opts, [], "no turn policy configured", now);
    }

    const trigger = policy.triggers.on_user_message;

    if (trigger === "none") {
      return this.result(opts, [], "on_user_message: none", now);
    }

    // Get physically present + conversation participant agents
    const presentAgentIds = await this.getPresentAgentIds(opts.scene_id);
    const conversationAgentIds = await this.getConversationAgentIds(opts.conversation_id);
    const residentAgentIds = presentAgentIds.filter((id) =>
      conversationAgentIds.includes(id),
    );

    // Filter out offline agents
    const onlineResidents = await this.filterOnlineAgents(residentAgentIds);

    if (trigger === "mentioned_only") {
      const mentioned = opts.mentioned_agent_ids ?? [];
      const eligible = onlineResidents.filter((id) => mentioned.includes(id));
      return this.result(opts, eligible,
        `on_user_message: mentioned_only (${mentioned.length} mentioned)`, now);
    }

    if (trigger === "all_present") {
      return this.result(opts, onlineResidents,
        `on_user_message: all_present (${onlineResidents.length} present)`, now);
    }

    // === speaker_selection pipeline ===

    // Three-layer hard stops apply to ALL paths including mentions
    const limits = policy.self_chat_limits;
    if (limits) {
      const blocked = await this.checkSelfChatLimits(opts.conversation_id, limits);
      if (blocked) {
        return this.result(opts, [], `self_chat_limit: ${blocked}`, now);
      }
    }

    const eligible = new Set<string>();
    const reasons: string[] = [];

    // Layer 1: explicit @ mentions + alias detection (must-answer)
    const mentionedSet = new Set<string>();
    const explicitMentions = opts.mentioned_agent_ids ?? [];
    for (const id of explicitMentions) {
      if (onlineResidents.includes(id)) mentionedSet.add(id);
    }
    if (opts.content) {
      const aliasMentions = await this.detectMentionsByContent(opts.content, onlineResidents);
      for (const id of aliasMentions) mentionedSet.add(id);
    }

    if (mentionedSet.size > 0) {
      for (const id of mentionedSet) {
        eligible.add(id);
        reasons.push(`mentioned: ${id}`);
      }
      let result = [...eligible];
      if (limits) {
        const quota = await this.getRemainingRoundsQuota(opts.conversation_id, limits);
        result = this.capToQuota(result, quota, reasons);
      }
      return this.result(opts, result,
        `speaker_selection: ${reasons.join("; ")}`, now);
    }

    // Layer 2: keyword triggers (soft priority — boosts affinity, doesn't force answer)
    const keywordBoostedAgents = new Set<string>();
    if (opts.content) {
      const matches = await this.detectKeywordMatches(opts.content, onlineResidents);
      for (const id of matches) keywordBoostedAgents.add(id);
    }

    // Layer 3: affinity roll for all candidates, with cooldown as hard block
    const cooldownAgents = await this.getAgentsInCooldown(
      opts.conversation_id, onlineResidents,
      policy.triggers.on_agent_message.cooldown_ms,
    );
    const affinities = await this.getAgentAffinities(onlineResidents);

    for (const id of onlineResidents) {
      if (cooldownAgents.has(id)) continue; // hard block

      let affinity = affinities.get(id) ?? 0;
      if (keywordBoostedAgents.has(id)) {
        affinity = Math.min(1, affinity + 0.3); // keyword boost
      }
      if (affinity > 0 && this.roll() < affinity) {
        eligible.add(id);
        reasons.push(keywordBoostedAgents.has(id)
          ? `keyword_boosted_roll: ${id}`
          : `affinity_roll: ${id}`);
      }
    }

    if (eligible.size === 0) {
      return this.result(opts, [], "speaker_selection: no triggers matched, silence", now);
    }

    let finalEligible = [...eligible];
    if (limits) {
      const quota = await this.getRemainingRoundsQuota(opts.conversation_id, limits);
      finalEligible = this.capToQuota(finalEligible, quota, reasons);
    }

    return this.result(opts, finalEligible,
      `speaker_selection: ${reasons.join("; ")}`, now);
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
      return this.result(opts, [], "no turn policy configured", now);
    }

    // Three-layer hard stops — checked FIRST, before any selection logic
    if (policy.self_chat_limits) {
      const blocked = await this.checkSelfChatLimits(
        opts.conversation_id, policy.self_chat_limits,
      );
      if (blocked) {
        return this.result(opts, [], `self_chat_limit: ${blocked}`, now);
      }
    }

    const rules = policy.triggers.on_agent_message;
    const presentAgentIds = await this.getPresentAgentIds(opts.scene_id);
    const conversationAgentIds = await this.getConversationAgentIds(opts.conversation_id);
    const candidates = presentAgentIds.filter(
      (id) => id !== opts.sender_agent_id && conversationAgentIds.includes(id),
    );
    const onlineCandidates = await this.filterOnlineAgents(candidates);

    const eligible = new Set<string>();

    // Mention in agent-to-agent chain
    if (rules.mention && opts.mentioned_agent_ids?.length) {
      for (const id of opts.mentioned_agent_ids) {
        if (onlineCandidates.includes(id)) eligible.add(id);
      }
    }

    // Random roll with cooldown as hard block
    if (rules.random) {
      const recentConsecutive = await this.getConsecutiveAgentMessageCount(
        opts.conversation_id,
      );
      if (recentConsecutive < rules.max_consecutive) {
        const cooldownAgents = await this.getAgentsInCooldown(
          opts.conversation_id, onlineCandidates, rules.cooldown_ms,
        );
        const affinities = await this.getAgentAffinities(onlineCandidates);

        for (const id of onlineCandidates) {
          if (eligible.has(id)) continue;
          if (cooldownAgents.has(id)) continue;
          const affinity = affinities.get(id) ?? 0;
          if (affinity > 0 && this.roll() < affinity) {
            eligible.add(id);
          }
        }
      }
    }

    // Per-agent frequency limit
    if (policy.self_chat_limits) {
      const limit = policy.self_chat_limits.per_agent_max_per_minute;
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      for (const id of [...eligible]) {
        const count = await this.getAgentMessageCountSince(
          opts.conversation_id, id, oneMinuteAgo,
        );
        if (count >= limit) {
          eligible.delete(id);
        }
      }
    }

    let finalEligible = [...eligible];
    if (policy.self_chat_limits) {
      const quota = await this.getRemainingRoundsQuota(
        opts.conversation_id, policy.self_chat_limits,
      );
      finalEligible = this.capToQuota(finalEligible, quota, []);
    }

    return this.result(opts, finalEligible,
      `on_agent_message: mention=${rules.mention} random=${rules.random}`, now);
  }

  private async checkSelfChatLimits(
    conversationId: string,
    limits: SelfChatLimits,
  ): Promise<string | null> {
    // Layer 1: max_agent_rounds_without_user (count from DB, survives restart)
    const roundsSinceUser = await this.getConsecutiveAgentMessageCount(conversationId);
    if (roundsSinceUser >= limits.max_agent_rounds_without_user) {
      return `max_agent_rounds_without_user: ${roundsSinceUser} >= ${limits.max_agent_rounds_without_user}`;
    }

    // Layer 2: max_total_messages (from DB)
    const totalCount = await this.getTotalMessageCount(conversationId);
    if (totalCount >= limits.max_total_messages) {
      return `max_total_messages: ${totalCount} >= ${limits.max_total_messages}`;
    }

    // Layer 3: max_total_tokens (from DB usage columns)
    if (limits.max_total_tokens != null) {
      const totalTokens = await this.getTotalTokenUsage(conversationId);
      if (totalTokens >= limits.max_total_tokens) {
        return `max_total_tokens: ${totalTokens} >= ${limits.max_total_tokens}`;
      }
    }

    return null;
  }

  private async getRemainingRoundsQuota(
    conversationId: string,
    limits: SelfChatLimits,
  ): Promise<number> {
    const roundsSinceUser = await this.getConsecutiveAgentMessageCount(conversationId);
    return Math.max(0, limits.max_agent_rounds_without_user - roundsSinceUser);
  }

  private capToQuota(eligible: string[], quota: number, reasons: string[]): string[] {
    if (quota <= 0) return [];
    if (eligible.length <= quota) return eligible;
    const capped = eligible.slice(0, quota);
    reasons.push(`capped to remaining quota ${quota}`);
    return capped;
  }

  private async detectMentionsByContent(
    content: string,
    candidateAgentIds: string[],
  ): Promise<string[]> {
    const matched: string[] = [];
    const lowerContent = content.toLowerCase();

    for (const agentId of candidateAgentIds) {
      const profile = await this.getAgentProfile(agentId);
      if (!profile) continue;

      const names = [profile.display_name];
      if (profile.aliases) {
        names.push(...(profile.aliases as string[]));
      }

      for (const name of names) {
        if (lowerContent.includes(name.toLowerCase())) {
          matched.push(agentId);
          break;
        }
      }
    }

    return matched;
  }

  private async detectKeywordMatches(
    content: string,
    candidateAgentIds: string[],
  ): Promise<string[]> {
    const matched: string[] = [];
    const lowerContent = content.toLowerCase();

    for (const agentId of candidateAgentIds) {
      const profile = await this.getAgentProfile(agentId);
      if (!profile?.trigger_keywords) continue;

      const keywords = profile.trigger_keywords as string[];
      for (const keyword of keywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
          matched.push(agentId);
          break;
        }
      }
    }

    return matched;
  }

  private async filterOnlineAgents(agentIds: string[]): Promise<string[]> {
    if (agentIds.length === 0) return [];
    const online: string[] = [];
    for (const id of agentIds) {
      const rows = await this.deps.db
        .select({ fault_state: schema.agentModelBindings.fault_state })
        .from(schema.agentModelBindings)
        .where(eq(schema.agentModelBindings.agent_id, id))
        .limit(1);
      const state = rows[0]?.fault_state ?? "ok";
      if (state !== "offline") {
        online.push(id);
      }
    }
    return online;
  }

  private async getAgentsInCooldown(
    conversationId: string,
    agentIds: string[],
    cooldownMs: number,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (cooldownMs <= 0 || agentIds.length === 0) return result;

    const cutoff = new Date(Date.now() - cooldownMs).toISOString();

    for (const agentId of agentIds) {
      const rows = await this.deps.db
        .select({ created_at: schema.messages.created_at })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.conversation_id, conversationId),
            eq(schema.messages.sender_type, "ai"),
            eq(schema.messages.sender_ai_id, agentId),
            gte(schema.messages.created_at, cutoff),
          ),
        )
        .limit(1);

      if (rows.length > 0) {
        result.add(agentId);
      }
    }

    return result;
  }

  private async getAgentMessageCountSince(
    conversationId: string,
    agentId: string,
    since: string,
  ): Promise<number> {
    const rows = await this.deps.db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversation_id, conversationId),
          eq(schema.messages.sender_type, "ai"),
          eq(schema.messages.sender_ai_id, agentId),
          gte(schema.messages.created_at, since),
        ),
      );
    return rows.length;
  }

  private async getTotalMessageCount(conversationId: string): Promise<number> {
    const rows = await this.deps.db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.conversation_id, conversationId));
    return rows.length;
  }

  private async getTotalTokenUsage(conversationId: string): Promise<number> {
    const rows = await this.deps.db
      .select({
        input: schema.messages.usage_input_tokens,
        output: schema.messages.usage_output_tokens,
      })
      .from(schema.messages)
      .where(eq(schema.messages.conversation_id, conversationId));

    let total = 0;
    for (const row of rows) {
      total += (row.input ?? 0) + (row.output ?? 0);
    }
    return total;
  }

  private async getAgentProfile(agentId: string) {
    const rows = await this.deps.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.agent_id, agentId))
      .limit(1);
    return rows[0] ?? null;
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

    const raw = conv[0]?.turn_policy
      ?? (sceneId ? (await this.deps.db
          .select({ default_turn_policy: schema.scenes.default_turn_policy })
          .from(schema.scenes)
          .where(eq(schema.scenes.scene_id, sceneId))
          .limit(1)
        )[0]?.default_turn_policy
        : null);

    if (!raw) return null;

    const parsed = turnPolicySchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
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
    const rows = await this.deps.db.all(drizzleSql`
      SELECT COUNT(*) as cnt FROM messages
      WHERE conversation_id = ${conversationId}
        AND seq > COALESCE(
          (SELECT MAX(seq) FROM messages
           WHERE conversation_id = ${conversationId} AND sender_type = 'user'),
          0
        )
        AND sender_type = 'ai'
    `);
    return (rows[0] as any)?.cnt ?? 0;
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

  private result(
    opts: { conversation_id: string; message_id?: string; trigger_message_id?: string },
    eligible: string[],
    reason: string,
    evaluated_at: string,
  ): TurnEvaluation {
    return {
      conversation_id: opts.conversation_id,
      trigger_message_id: (opts as any).trigger_message_id ?? (opts as any).message_id ?? "",
      eligible_agent_ids: eligible,
      reason,
      evaluated_at,
    };
  }
}

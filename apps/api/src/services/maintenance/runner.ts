import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { AIGateway, MaintenanceTask } from "@lamplight/contracts";
import * as schema from "../../db/schema.js";
import { ConversationRepository } from "../runtime/conversation-repository.js";
import { validateMaintenanceOutput, rawProposalItemSchema, type RawProposalItem } from "./validator.js";

const MAINTENANCE_AGENT_ID = "maintenance";

export interface MaintenanceRunnerDeps {
  db: LibSQLDatabase<typeof schema>;
  gateway: AIGateway;
  conversationRepo: ConversationRepository;
}

export interface MaintenanceRunResult {
  accepted: Array<{ id: string; action: string; content: string; status: string }>;
  rejected: Array<{ content: string; reason: string }>;
}

export class MaintenanceRunner {
  constructor(private deps: MaintenanceRunnerDeps) {}

  async run(task: MaintenanceTask): Promise<MaintenanceRunResult> {
    const binding = await this.getBinding();
    if (!binding) {
      throw new Error("Maintenance model has no binding configured");
    }

    if (binding.fault_state === "offline") {
      throw new Error("Maintenance model binding is offline");
    }

    const runtimeConfig = await this.getRuntimeConfig();
    const messages = await this.buildContext(task, runtimeConfig);

    const response = await this.deps.gateway.complete({
      provider_id: binding.provider_id,
      model_id: binding.model_id,
      api_provider_id: binding.api_provider_id,
      messages,
      max_tokens: runtimeConfig?.max_response_tokens ?? 2048,
      temperature: runtimeConfig?.temperature ?? 0.3,
    });

    const rawItems = this.parseOutput(response.content);
    const { accepted, rejected } = validateMaintenanceOutput(rawItems, task.task_type);

    const result: MaintenanceRunResult = { accepted: [], rejected: [] };

    for (const item of accepted) {
      const id = `mp_${randomUUID()}`;
      const now = new Date().toISOString();

      await this.deps.db.insert(schema.maintenanceProposals).values({
        id,
        conversation_id: task.conversation_id,
        action: item.action,
        target_id: item.target_id ?? null,
        content: item.content,
        claim_type: item.claim_type,
        reason: item.reason,
        confidence: item.confidence,
        conflicts_with: item.conflicts_with ?? null,
        status: "pending",
        proposer_model: binding.model_id,
        source_message_ids: item.source_message_ids ?? null,
        evidence_excerpt: item.evidence_excerpt ?? null,
        task_type: task.task_type,
        created_at: now,
      });

      await this.deps.db.insert(schema.maintenanceAudit).values({
        id: `ma_${randomUUID()}`,
        proposal_id: id,
        action: item.action,
        target_id: item.target_id ?? null,
        decision_reason: item.reason,
        actor_model_id: binding.model_id,
        actor_provider_id: binding.provider_id,
        auto_executed: 0,
        created_at: now,
      });

      result.accepted.push({ id, action: item.action, content: item.content, status: "pending" });
    }

    for (const { item, reason } of rejected) {
      await this.deps.db.insert(schema.maintenanceAudit).values({
        id: `ma_${randomUUID()}`,
        action: item.action,
        decision_reason: `REJECTED: ${reason}`,
        actor_model_id: binding.model_id,
        actor_provider_id: binding.provider_id,
        auto_executed: 0,
        created_at: new Date().toISOString(),
      });

      result.rejected.push({ content: item.content, reason });
    }

    return result;
  }

  private async getBinding() {
    const rows = await this.deps.db
      .select()
      .from(schema.agentModelBindings)
      .where(eq(schema.agentModelBindings.agent_id, MAINTENANCE_AGENT_ID))
      .limit(1);
    return rows[0] ?? null;
  }

  private async getRuntimeConfig() {
    const rows = await this.deps.db
      .select()
      .from(schema.agentRuntimeConfigs)
      .where(eq(schema.agentRuntimeConfigs.agent_id, MAINTENANCE_AGENT_ID))
      .limit(1);
    return rows[0] ?? null;
  }

  private async buildContext(
    task: MaintenanceTask,
    runtimeConfig: typeof schema.agentRuntimeConfigs.$inferSelect | null,
  ) {
    const historyRows = await this.deps.conversationRepo.getRecentMessages(
      task.conversation_id,
      50,
    );

    const systemPrompt = runtimeConfig?.system_prompt_template
      ?? "你是后台维护模型。客观整理对话信息，第三人称输出，JSON 数组格式。";

    const taskInstruction = this.getTaskInstruction(task.task_type);

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: `${systemPrompt}\n\n${taskInstruction}` },
    ];

    for (const row of historyRows) {
      messages.push({
        role: row.sender_type === "ai" ? "assistant" : "user",
        content: row.sender_ai_id
          ? `[${row.sender_ai_id}]: ${row.content}`
          : row.content,
      });
    }

    messages.push({
      role: "user",
      content: "请根据以上对话内容执行维护任务，输出 JSON 数组。",
    });

    return messages;
  }

  private getTaskInstruction(taskType: string): string {
    switch (taskType) {
      case "digest":
        return "任务：提取对话中的公共事实和事件，生成 HouseholdDigest 候选。只记录客观发生的事：谁说了什么、讨论了什么话题、达成了什么结论。禁止写入主观解释（如『大家都认为……』『X 真正担心的是……』）。每条候选包含 action（通常 create）、content（第三人称客观描述）、claim_type（fact/observation）、reason（为什么值得记录）、confidence（0-1）。";
      case "classify":
        return "任务：对对话中提到的信息进行分类（info_type），识别哪些是事实、观察、假设。每条候选包含 action/content/claim_type/reason/confidence。";
      case "conflict_detect":
        return "任务：检测对话中是否有与已知信息冲突的内容。如有冲突，action 用 correct 或 supersede，填 target_id 和 conflicts_with。无冲突则 action 用 no_change。";
      default:
        return "任务：客观整理对话信息。";
    }
  }

  private parseOutput(content: string): RawProposalItem[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];
      const results: RawProposalItem[] = [];
      for (const item of parsed) {
        const result = rawProposalItemSchema.safeParse(item);
        if (result.success) results.push(result.data);
      }
      return results;
    } catch {
      return [];
    }
  }
}

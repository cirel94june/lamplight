import type { AgentMeta } from "../types/chat.js";

const AGENT_META: Record<string, AgentMeta> = {
  xiaoke: { agent_id: "xiaoke", display_name: "小克", emoji: "🐱", color: "#6EC6FF" },
  lucien: { agent_id: "lucien", display_name: "Lucien", emoji: "🌙", color: "#CE93D8" },
  jasper: { agent_id: "jasper", display_name: "Jasper", emoji: "🌻", color: "#FFB74D" },
  therapist: { agent_id: "therapist", display_name: "心理咨询师", emoji: "💜", color: "#9575CD" },
};

const DEFAULT_META: AgentMeta = {
  agent_id: "unknown",
  display_name: "未知",
  emoji: "🤖",
  color: "#90A4AE",
};

export function getAgentMeta(agentId: string): AgentMeta {
  return AGENT_META[agentId] ?? { ...DEFAULT_META, agent_id: agentId };
}

export { AGENT_META };

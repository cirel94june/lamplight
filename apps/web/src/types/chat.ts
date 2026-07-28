export interface ChatMessage {
  id: string;
  conversation_id: string;
  conversation_kind: string;
  sender: { type: "user" | "ai" | "system"; ai_id?: string };
  content: string;
  context: { context_type: string; set_by: string };
  speech_mode?: string;
  created_at: string;
}

export interface ConversationInfo {
  id: string;
  kind: string;
  scene_id?: string;
  participant_ai_ids: string[];
  turn_policy?: unknown;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AgentMeta {
  agent_id: string;
  display_name: string;
  emoji: string;
  color: string;
}

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const scenes = sqliteTable("scenes", {
  scene_id: text("scene_id").primaryKey(),
  display_name: text("display_name").notNull(),
  type: text("type").notNull(),
  prompt_weight_overrides: text("prompt_weight_overrides", { mode: "json" })
    .$type<Record<string, number>>()
    .default({}),
  max_participants: integer("max_participants"),
  furniture_slots: integer("furniture_slots"),
  default_turn_policy: text("default_turn_policy", { mode: "json" })
    .$type<{ policy_id: string; triggers: { on_user_message: string; on_agent_message: { mention: boolean; random: boolean; cooldown_ms: number; max_consecutive: number } } } | null>(),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const houseEvents = sqliteTable("house_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  actor_type: text("actor_type").notNull(),
  actor_ai_id: text("actor_ai_id"),
  scene_id: text("scene_id"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  description: text("description"),
  context_type: text("context_type").notNull(),
  context_world_id: text("context_world_id"),
  context_session_id: text("context_session_id"),
  context_branch_id: text("context_branch_id"),
  conversation_kind: text("conversation_kind").notNull(),
  created_at: text("created_at").notNull(),
});

export const aiPresence = sqliteTable("ai_presence", {
  ai_id: text("ai_id").primaryKey(),
  scene_id: text("scene_id"),
  state: text("state").notNull().default("idle"),
  updated_at: text("updated_at").notNull(),
});

export const apiProviders = sqliteTable("api_providers", {
  id: text("id").primaryKey(),
  provider_type: text("provider_type").notNull(),
  display_name: text("display_name").notNull(),
  base_url: text("base_url").notNull(),
  api_key_encrypted: text("api_key_encrypted").notNull(),
  is_active: integer("is_active").notNull().default(1),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_at: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const agentProfiles = sqliteTable("agent_profiles", {
  agent_id: text("agent_id").primaryKey(),
  display_name: text("display_name").notNull(),
  memory_scope: text("memory_scope").notNull(),
  tool_policy_id: text("tool_policy_id"),
  prompt_version: text("prompt_version"),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const agentModelBindings = sqliteTable("agent_model_bindings", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id").notNull().unique(),
  api_provider_id: text("api_provider_id").notNull(),
  provider_id: text("provider_id").notNull(),
  model_id: text("model_id").notNull(),
  timeout_ms: integer("timeout_ms").default(30000),
  retry_max: integer("retry_max").default(3),
  fault_state: text("fault_state").notNull().default("ok"),
  fault_since: text("fault_since"),
  last_call_at: text("last_call_at"),
  total_calls: integer("total_calls").notNull().default(0),
  total_errors: integer("total_errors").notNull().default(0),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updated_at: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const agentRuntimeConfigs = sqliteTable("agent_runtime_configs", {
  agent_id: text("agent_id").primaryKey(),
  random_reply_affinity: real("random_reply_affinity").notNull(),
  max_response_tokens: integer("max_response_tokens"),
  temperature: real("temperature"),
  system_prompt_template: text("system_prompt_template"),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  scene_id: text("scene_id"),
  world_id: text("world_id"),
  session_id: text("session_id"),
  participant_ai_ids: text("participant_ai_ids", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  turn_policy: text("turn_policy", { mode: "json" })
    .$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("active"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_conversations_active_scene")
    .on(table.scene_id)
    .where(sql`status = 'active'`),
]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversation_id: text("conversation_id").notNull(),
  conversation_kind: text("conversation_kind").notNull(),
  sender_type: text("sender_type").notNull(),
  sender_ai_id: text("sender_ai_id"),
  content: text("content").notNull(),
  context_type: text("context_type").notNull(),
  context_world_id: text("context_world_id"),
  context_session_id: text("context_session_id"),
  context_branch_id: text("context_branch_id"),
  context_set_by: text("context_set_by").notNull().default("server"),
  speech_mode: text("speech_mode"),
  prompt_snapshot: text("prompt_snapshot", { mode: "json" })
    .$type<{ model: string; rendered_prompt: string; created_at: string } | null>(),
  created_at: text("created_at").notNull(),
});

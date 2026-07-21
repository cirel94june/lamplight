import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const scenes = sqliteTable("scenes", {
  scene_id: text("scene_id").primaryKey(),
  display_name: text("display_name").notNull(),
  type: text("type").notNull(),
  prompt_weight_overrides: text("prompt_weight_overrides", { mode: "json" })
    .$type<Record<string, number>>()
    .default({}),
  max_participants: integer("max_participants"),
  furniture_slots: integer("furniture_slots"),
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

import { beforeAll } from "vitest";
import { db } from "../src/db/index.js";
import { sql } from "drizzle-orm";

beforeAll(async () => {
  await db.run(sql`CREATE TABLE IF NOT EXISTS scenes (
    scene_id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    type TEXT NOT NULL,
    prompt_weight_overrides TEXT DEFAULT '{}',
    max_participants INTEGER,
    furniture_slots INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await db.run(sql`CREATE TABLE IF NOT EXISTS house_events (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_ai_id TEXT,
    scene_id TEXT,
    payload TEXT NOT NULL,
    description TEXT,
    context_type TEXT NOT NULL,
    context_world_id TEXT,
    context_session_id TEXT,
    context_branch_id TEXT,
    conversation_kind TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  await db.run(sql`CREATE TABLE IF NOT EXISTS ai_presence (
    ai_id TEXT PRIMARY KEY NOT NULL,
    scene_id TEXT,
    state TEXT NOT NULL DEFAULT 'idle',
    updated_at TEXT NOT NULL
  )`);
});

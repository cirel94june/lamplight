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
    default_turn_policy TEXT,
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

  await db.run(sql`CREATE TABLE IF NOT EXISTS api_providers (
    id TEXT PRIMARY KEY NOT NULL,
    provider_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await db.run(sql`CREATE TABLE IF NOT EXISTS agent_profiles (
    agent_id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    memory_scope TEXT NOT NULL,
    tool_policy_id TEXT,
    prompt_version TEXT,
    aliases TEXT,
    trigger_keywords TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await db.run(sql`CREATE TABLE IF NOT EXISTS agent_model_bindings (
    id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL UNIQUE,
    api_provider_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    timeout_ms INTEGER DEFAULT 30000,
    retry_max INTEGER DEFAULT 3,
    fault_state TEXT NOT NULL DEFAULT 'ok',
    fault_since TEXT,
    last_call_at TEXT,
    total_calls INTEGER NOT NULL DEFAULT 0,
    total_errors INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await db.run(sql`CREATE TABLE IF NOT EXISTS agent_runtime_configs (
    agent_id TEXT PRIMARY KEY NOT NULL,
    random_reply_affinity REAL NOT NULL,
    max_response_tokens INTEGER,
    temperature REAL,
    system_prompt_template TEXT
  )`);

  await db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    scene_id TEXT,
    world_id TEXT,
    session_id TEXT,
    participant_ai_ids TEXT NOT NULL,
    turn_policy TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  await db.run(sql`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    conversation_kind TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    sender_type TEXT NOT NULL,
    sender_ai_id TEXT,
    content TEXT NOT NULL,
    context_type TEXT NOT NULL,
    context_world_id TEXT,
    context_session_id TEXT,
    context_branch_id TEXT,
    context_set_by TEXT NOT NULL DEFAULT 'server',
    speech_mode TEXT,
    prompt_snapshot TEXT,
    usage_input_tokens INTEGER,
    usage_output_tokens INTEGER,
    created_at TEXT NOT NULL
  )`);

  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_active_scene ON conversations(scene_id) WHERE status = 'active'`);

  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq)`);
});

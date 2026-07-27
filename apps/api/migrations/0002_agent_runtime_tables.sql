CREATE TABLE `agent_profiles` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`memory_scope` text NOT NULL,
	`tool_policy_id` text,
	`prompt_version` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_runtime_configs` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`random_reply_affinity` real NOT NULL,
	`max_response_tokens` integer,
	`temperature` real,
	`system_prompt_template` text
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`scene_id` text,
	`world_id` text,
	`session_id` text,
	`participant_ai_ids` text NOT NULL,
	`turn_policy` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`conversation_kind` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_ai_id` text,
	`content` text NOT NULL,
	`context_type` text NOT NULL,
	`context_world_id` text,
	`context_session_id` text,
	`context_branch_id` text,
	`context_set_by` text DEFAULT 'server' NOT NULL,
	`speech_mode` text,
	`prompt_snapshot` text,
	`created_at` text NOT NULL
);

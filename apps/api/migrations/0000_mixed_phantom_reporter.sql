CREATE TABLE `ai_presence` (
	`ai_id` text PRIMARY KEY NOT NULL,
	`scene_id` text,
	`state` text DEFAULT 'idle' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `house_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_ai_id` text,
	`scene_id` text,
	`payload` text NOT NULL,
	`description` text,
	`context_type` text NOT NULL,
	`context_world_id` text,
	`context_session_id` text,
	`context_branch_id` text,
	`conversation_kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`scene_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`type` text NOT NULL,
	`prompt_weight_overrides` text DEFAULT '{}',
	`max_participants` integer,
	`furniture_slots` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);

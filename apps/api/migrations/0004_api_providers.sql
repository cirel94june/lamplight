CREATE TABLE `api_providers` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_type` text NOT NULL,
  `display_name` text NOT NULL,
  `base_url` text NOT NULL,
  `api_key_encrypted` text NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `agent_model_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL UNIQUE,
  `api_provider_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `timeout_ms` integer DEFAULT 30000,
  `retry_max` integer DEFAULT 3,
  `fault_state` text NOT NULL DEFAULT 'ok',
  `fault_since` text,
  `last_call_at` text,
  `total_calls` integer NOT NULL DEFAULT 0,
  `total_errors` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
-- Migrate existing per-agent provider/model into bindings before dropping columns.
-- api_provider_id uses 'env-{provider_id}' convention; initGateway creates matching rows.
INSERT INTO `agent_model_bindings` (`id`, `agent_id`, `api_provider_id`, `provider_id`, `model_id`)
  SELECT 'migrated-' || `agent_id`, `agent_id`, 'env-' || `provider_id`, `provider_id`, `model_id`
  FROM `agent_profiles`
  WHERE `provider_id` IS NOT NULL AND `model_id` IS NOT NULL;
--> statement-breakpoint
-- Rebuild agent_profiles without provider_id/model_id columns
CREATE TABLE `agent_profiles_new` (
  `agent_id` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL,
  `memory_scope` text NOT NULL,
  `tool_policy_id` text,
  `prompt_version` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
INSERT INTO `agent_profiles_new` (`agent_id`, `display_name`, `memory_scope`, `tool_policy_id`, `prompt_version`, `created_at`)
  SELECT `agent_id`, `display_name`, `memory_scope`, `tool_policy_id`, `prompt_version`, `created_at` FROM `agent_profiles`;
--> statement-breakpoint
DROP TABLE `agent_profiles`;
--> statement-breakpoint
ALTER TABLE `agent_profiles_new` RENAME TO `agent_profiles`;

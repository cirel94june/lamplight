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

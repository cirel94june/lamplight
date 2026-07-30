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

ALTER TABLE `agent_profiles` ADD COLUMN `api_provider_id` text;

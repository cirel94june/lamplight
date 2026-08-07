ALTER TABLE `agent_profiles` ADD `aliases` text;
--> statement-breakpoint
ALTER TABLE `agent_profiles` ADD `trigger_keywords` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `usage_input_tokens` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `usage_output_tokens` integer;

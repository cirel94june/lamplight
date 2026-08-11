CREATE TABLE `maintenance_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text,
	`content` text NOT NULL,
	`claim_type` text NOT NULL,
	`reason` text NOT NULL,
	`confidence` real NOT NULL,
	`conflicts_with` text,
	`status` text NOT NULL DEFAULT 'pending',
	`proposer_model` text NOT NULL,
	`source_message_ids` text,
	`evidence_excerpt` text,
	`created_at` text NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE `maintenance_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text,
	`action` text NOT NULL,
	`target_id` text,
	`decision_reason` text NOT NULL,
	`actor_model_id` text NOT NULL,
	`actor_provider_id` text NOT NULL,
	`auto_executed` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL DEFAULT (datetime('now'))
);

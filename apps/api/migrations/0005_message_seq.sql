ALTER TABLE `messages` ADD `seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE messages SET seq = (
  SELECT COUNT(*) FROM messages m2
  WHERE m2.conversation_id = messages.conversation_id
  AND m2.rowid <= messages.rowid
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_conv_seq` ON `messages` (`conversation_id`, `seq`);
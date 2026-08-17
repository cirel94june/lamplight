CREATE TABLE household_digests (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT,
  scene_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  topic TEXT,
  participant_ai_ids TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  proposer_model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE maintenance_proposals ADD COLUMN task_type TEXT DEFAULT 'digest';

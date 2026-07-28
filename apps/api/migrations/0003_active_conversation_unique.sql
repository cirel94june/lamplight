CREATE UNIQUE INDEX idx_conversations_active_scene ON conversations(scene_id) WHERE status = 'active';

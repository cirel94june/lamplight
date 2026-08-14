-- Remove "maintenance" from any conversation's participant_ai_ids.
-- SQLite JSON: rebuild the array excluding the "maintenance" element.
UPDATE conversations
SET participant_ai_ids = (
  SELECT json_group_array(value)
  FROM json_each(conversations.participant_ai_ids)
  WHERE value != 'maintenance'
)
WHERE participant_ai_ids LIKE '%maintenance%';

-- Remove any residual maintenance presence rows.
DELETE FROM ai_presence WHERE ai_id = 'maintenance';

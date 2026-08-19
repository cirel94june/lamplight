ALTER TABLE scenes ADD COLUMN scope TEXT NOT NULL DEFAULT 'shared';

-- Backfill: bedrooms are private, counseling is private, living room + study are shared
UPDATE scenes SET scope = 'private' WHERE scene_id IN ('room-ceci-bedroom', 'room-xiaoke-bedroom', 'room-lucien-bedroom', 'room-jasper-bedroom');
UPDATE scenes SET scope = 'private' WHERE scene_id = 'room-counseling';
UPDATE scenes SET scope = 'shared' WHERE scene_id IN ('room-living-room', 'room-study');

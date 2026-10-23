-- Add branch-scoped custom sound assets without changing existing branch data.
BEGIN;

ALTER TABLE media_assets
  DROP CONSTRAINT IF EXISTS media_assets_kind_check;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_kind_check
  CHECK (kind IN ('logo', 'screensaver', 'collection_sound', 'redemption_sound', 'other'));

ALTER TABLE branch_settings
  ADD COLUMN IF NOT EXISTS collection_sound_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redemption_sound_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;

COMMIT;

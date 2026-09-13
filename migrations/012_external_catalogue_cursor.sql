ALTER TABLE external_catalogue_sync
ADD COLUMN checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint_json));

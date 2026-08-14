-- Display name shown where a full curriculum name does not fit: chips, radar
-- axes, tab labels. NULL means the full name is already short enough, so
-- readers fall back to `name` rather than storing a duplicate.
ALTER TABLE capability_nodes ADD COLUMN short_name TEXT
  CHECK(short_name IS NULL OR length(short_name) > 0);

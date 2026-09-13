-- A stable File title alone must not approve a later replacement edition.
ALTER TABLE native_resources ADD COLUMN content_sha1 TEXT
  CHECK(content_sha1 IS NULL OR (length(content_sha1)=40 AND content_sha1 NOT GLOB '*[^a-f0-9]*'));

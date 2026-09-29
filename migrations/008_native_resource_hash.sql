-- Commons File titles can be replaced. Approval pins the reviewed edition bytes
-- by the public metadata checksum without retaining any media file.
ALTER TABLE native_resources ADD COLUMN content_sha1 TEXT
  CHECK(content_sha1 IS NULL OR (length(content_sha1)=40 AND content_sha1 NOT GLOB '*[^a-f0-9]*'));

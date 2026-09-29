# Wikipedia Movie/TV metadata delta

`wikipedia-delta.ts` converts an already-reviewed local Wikipedia import into a
small Cloudflare D1 catalogue delta. It is intentionally narrower than the full
snapshot exporter:

- accepted title sources are exactly `wikipedia-movie` and `wikipedia-tv`;
- output tables are `cloud_snapshot_sources`, `genres`, `titles`,
  `title_aliases`, and `title_genres`;
- episodes, versions, providers, mappings, native resources, playback URLs,
  account data, and media bytes are never exported;
- the input SQLite database is opened read-only and must pass integrity and
  foreign-key checks;
- every JSON batch is accepted by the existing protected importer, bounded by
  its row/byte limits, and hashed from the exact UTF-8 bytes written;
- preparation never contacts Wikipedia, Cloudflare, or another upstream and
  never uploads anything.

## Prepare a reviewed delta

Use a completed, immutable full catalogue manifest as the collision authority.
Choose explicit, vacant numeric ranges below `1000000000`; that value and above
are reserved for Worker-generated records. The three ranges are table-local and
need only cover new identities in their respective tables.

```sh
node --import tsx scripts/cloud-data/wikipedia-delta.ts \
  --source-db=/absolute/private/reviewed-wikipedia.sqlite \
  --full-manifest=/absolute/private/complete-cloud-data/manifest.json \
  --out=/absolute/private/new-wikipedia-delta \
  --written-row-budget=2000 \
  --title-id-start=900000000 \
  --genre-id-start=900000000 \
  --alias-id-start=900000000
```

Use a new output directory. The generator refuses to overwrite a previous
manifest or uploader checkpoint. It reuses a pinned ID when the full manifest
already contains the same source identity, and remaps every new local ID in
stable source/Q-ID order. It rejects occupied declared ranges, source/slug
collisions, genre slug/name collisions, changed pinned checksums, malformed
Q-IDs, non-Wikipedia canonical URLs, and unexpected episode or related-title
children. It calculates conservative D1/index/receipt writes before creating
the output and fails without writing files when the explicit budget is too
small.

The manifest records the input SQLite hash, pinned-manifest hash, pinned source
hash, exact per-source counts, allocated ranges, reused identity counts, batch
checksums, and conservative write estimate. Generated SQL is for inspection and
controlled recovery only; the JSON batches are the authoritative upload input.

## Hosted preflight and upload

The pinned manifest proves that the selected ranges do not collide with that
complete snapshot. D1 can also contain newer overlay records, so verify the
same ranges against the specific preview database immediately before upload.
For each non-empty range recorded under `identityAudit.allocatedRanges`, run a
read-only query such as:

```sh
pnpm exec wrangler d1 execute CATALOGUE --remote --command "SELECT id,source,source_id FROM titles WHERE id BETWEEN 900000000 AND 900000099"
pnpm exec wrangler d1 execute CATALOGUE --remote --command "SELECT id,slug,name FROM genres WHERE id BETWEEN 900000000 AND 900000099"
pnpm exec wrangler d1 execute CATALOGUE --remote --command "SELECT id,title_id,alias,language FROM title_aliases WHERE id BETWEEN 900000000 AND 900000099"
```

The result must be empty unless the manifest explicitly reports a reused pinned
identity at that exact ID. Also query the two Wikipedia source namespaces and
compare any existing source/Q-ID rows with the generated title batches. Do not
upload after an unexplained result; regenerate from a newer complete snapshot or
choose newly reviewed vacant ranges.

After review, use only the protected quota-accounted uploader against a verified
preview origin:

```sh
node --import tsx scripts/cloud-data/upload.ts \
  --manifest=/absolute/private/new-wikipedia-delta/manifest.json \
  --origin=https://verified-preview.pages.dev
```

The delta does not provide episode inventory or playback. A successfully
imported Movie or TV title can appear in its scoped catalogue, but watchability
requires separate, authorized episode and provider evidence.

## Verification

```sh
pnpm exec vitest run tests/wikipedia-cloud-delta.test.ts
pnpm typecheck
```

The focused suite checks exact source isolation, parent remapping, pinned-ID
reuse, byte/content checksums, importer validation, input immutability, explicit
budget failure, range collision rejection, pinned-batch tampering, and refusal
to export an unexpected partial episode graph.

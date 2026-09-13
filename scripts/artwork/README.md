# Reviewed artwork enrichment

This optional layer preserves imported source IDs and `imageUrl`. It exposes `posterUrl`, `backdropUrl`, and measured `artwork` lineage only for manually reviewed or exact-source-ID-verified identities. Browsing performs no upstream fetch or migration. A schema-8 database still serves its original poster; absent, malformed, disabled, or portrait-only backdrops return `null`.

The [official AniList API documentation repository](https://github.com/AniList/docs) and [query reference](https://docs.anilist.co/reference/query) document the GraphQL metadata interface. The adapter uses a reviewed numeric AniList ID or an exact `Media(idMal:)` lookup at `https://graphql.anilist.co/`, not automatic name matching. Only exact image URLs returned for that ID on `s4.anilist.co` are accepted. Redirects, non-raster content, mismatched image IDs, oversized bodies, malformed/truncated image containers, animated containers, and explicit access refusals fail closed. Accepted resources are bounded to 8 MB transferred, 8,192 pixels per axis and 8,388,608 decoded pixels. Container validation is not a full pixel-decoder or malware certification. It does not copy episode media, retain image payloads, run an image proxy, guess resizing paths, or claim that reference artwork is licensed for redistribution.

## Identity and evidence

Review bundles contain stable source/title IDs, AniList and MAL IDs, matching English/alternate titles, format and premiere-date checks, and SHA256 references for both manually compared key-art posters. A search result or matching name alone cannot enable artwork. The checked metadata ID remains distinct from the source site's internal ID. Five current featured titles were a verification checkpoint, not a hardcoded runtime registry or completed whole-catalogue artwork import.

The additional exact-ID route uses the normally observed Movy anime metadata endpoint `https://anime.vidy.st/api/episodes/{existing-anikoto-slug}`. It requires an identical original source title ID and slug, an exhaustive response, matching IDs/numbers for **every imported episode**, and one consistent MAL ID throughout the response. First/middle/last matching anchors, total counts, response SHA256, endpoint and observation time are retained; `server_ids` and other opaque provider data are discarded. AniList must return that exact MAL ID, and title aliases, format and year must corroborate it. Conflicts go to operator review; seasons/offsets are never guessed. The public lineage is `source-id-verified`, not `manual-reviewed`, and no poster comparison or independently verified premiere date is invented.

## Whole-catalogue discovery queue

`scripts/artwork/enrich.ts` makes a task-owned online backup and a **separate operator SQLite queue**. Its seed covers every existing title, not five sample IDs. Missing source facts, missing episode anchors, unresolved/ambiguous MAL IDs, metadata conflicts, source refusals and per-role image outcomes remain durable. Original titles/episodes/provider records and unrelated crawl checkpoints are never rewritten. The new local queue is not a cloud import table; cloud receives only validated match/resource deltas through the existing protected route.

```sh
# Creates NEW paths only; canonical source is opened read-only and copied with node:sqlite backup.
node --import tsx scripts/artwork/enrich.ts --source-db=/absolute/source.sqlite --db=/absolute/new-copy.sqlite --queue=/absolute/new-artwork-queue.sqlite --create-copy --reviewed-bundle=/absolute/existing-reviewed-artwork.json --out=/absolute/new-seed-receipt.json

# Read-only queue, reasons, resources and daily budget.
node --import tsx scripts/artwork/enrich.ts --db=/absolute/new-copy.sqlite --queue=/absolute/new-artwork-queue.sqlite

# Explicit bounded selection of actual recent-home/film/related title IDs; not a bulk-source permission grant.
node --import tsx scripts/artwork/enrich.ts --db=/absolute/new-copy.sqlite --queue=/absolute/new-artwork-queue.sqlite --title-ids=visible --execute --max-requests=80 --daily-request-limit=100 --max-seconds=360 --out=/absolute/new-run-receipt.json

# Resume with the same daily allowance and a fresh receipt path. A caller can instead name explicit IDs.
node --import tsx scripts/artwork/enrich.ts --db=/absolute/new-copy.sqlite --queue=/absolute/new-artwork-queue.sqlite --title-ids=180,181,182 --execute --max-requests=20 --daily-request-limit=100 --max-seconds=120 --out=/absolute/new-resume-receipt.json

# Explicit identity-only pass across all Anikoto rows. This retains exact crosswalk evidence but performs no AniList, image, media, or provider fetches.
node --import tsx scripts/artwork/enrich.ts --db=/absolute/new-copy.sqlite --queue=/absolute/new-artwork-queue.sqlite --title-ids=all-anikoto --execute --identity-only --identity-interval-ms=1000 --max-requests=10000 --daily-request-limit=10000 --max-seconds=10800 --out=/absolute/new-identity-receipt.json

# The same explicit pass detached from the current terminal, with durable process/log evidence.
node scripts/artwork/start-identity-enrichment.mjs --db=/absolute/new-copy.sqlite --queue=/absolute/new-artwork-queue.sqlite --title-ids=all-anikoto --execute --identity-only --identity-interval-ms=1000 --max-requests=10000 --daily-request-limit=10000 --max-seconds=10800 --out=/absolute/new-identity-receipt.json --log=/absolute/new-identity-run.log --pid-file=/absolute/new-identity-process.json
```

The reviewed bundle option is optional when there is no earlier approval checkpoint. `--identity-only` stops after identifier discovery, before AniList metadata/image requests. `--title-ids=all-anikoto` is an explicit operator selection, not an implicit startup mode or a playback/source-use approval. `--identity-interval-ms` is opt-in, is bounded to 1,000–60,000 milliseconds and defaults to the unchanged 2,200-millisecond interval. Only that explicit all-Anikoto identity-only pass may use a deadline above one hour, capped at four hours; every other invocation retains the 3,600-second cap. `--seed` is idempotent and never resets completed, failed or refused tasks. No implicit `full` mode or small hidden full-import cap exists. Each lease performs at most one ordinary request; durable host pacing and `Retry-After` remain authoritative, reservations are retained across a crash, and the daily ceiling cannot silently rise during a UTC window. Header values, temporary media URLs, credentials and raw provider responses are not logged or persisted.

On **2026-09-13**, a 75-request bounded run against the populated 8,949-title copy added **18 exact-ID matches, 18 measured posters and 14 separate banners**. Including the five preserved earlier reviews, the checkpoint contains **23 matches, 23 measured posters (22 usable under the minimum dimensions), and 18 banners**. All 13 then-current recent-home IDs 180–192 received useful posters; 180 and 183–192 also have accepted banners. IDs 181/182 have no declared banner. Five additional film-row titles were enriched. This is a real executed checkpoint, **not entire-library artwork coverage**.

At that checkpoint the all-title queue has 23 settled titles, 8,057 pending identifier discovery, 825 needing missing year/format facts, 40 lacking imported episode anchors, one missing a consistent MAL ID, two metadata identity conflicts and one rejected returned image-reference shape. The latter is `INVALID_DESTINATION`, **not proof of an upstream HTTP access refusal**. No retry clears source refusal policy. Task-owned receipts identify the exact affected rows and contain per-role outcomes even when no image row existed.

### Source-use scope

[AniList's current terms](https://docs.anilist.co/guide/terms-of-use) prohibit mass collection/hoarding and use as a backup/data-storage service; they also restrict competing non-complementary list/tracker services. They describe educational leniency for the mass-collection clause, not a blanket exemption from every condition. The executed work was a bounded visible-title educational checkpoint. **Automatic whole-catalogue AniList collection remains on hold for a source-use decision**; an explicit request budget is not permission. Image reuse remains `reference-only`/unknown unless separately documented. The imported catalogue presently has no general MAL/AniList/TMDB identifier columns; the queue discovers and retains a separate corroborated crosswalk. No TMDB credential or guessed ID was borrowed, and no TMDB artwork connection is claimed.

Actual observed image sizes on 2026-09-12:

| Title | Poster improvement | Separate banner |
| --- | --- | --- |
| Even a Replica Can Fall in Love | 283×400 → 460×650 | 1900×400 |
| Magical Sisters Lulutto Lilly | 283×400 → 460×651 | 1900×400 |
| Eren the Southpaw | 230×326 → 460×651 | 1200×254 |
| Reborn as a Cat | 225×300 → 230×307; not selected as an improvement | None declared |
| The Ramparts of Ice | 283×400 → 460×650 | 1900×400 repeating chibi pattern |

The API supplies `backdropUrl` only after measured width/height and role checks. These banners are roughly 4.75:1, not standard 16:9 frames. Keep their actual composition; don't stretch them into a tall hero. Rights/provenance remain `reference-only` unless separately documented; an accessible URL is not a blanket permission grant.

## Local review/import and resume

Use an explicit task-owned backup first. `node:sqlite` online backup preserves a live WAL snapshot; do not copy only the main file while a writer is active. Migrations are additive: local 009/cloud 012. Applying to a canonical database is an explicit operator step, not part of ordinary startup browsing.

```sh
# Read-only validation: no migration, network request, or write.
node --import tsx scripts/artwork/review.ts --db=/absolute/catalogue-copy.sqlite --input=/absolute/reviewed-artwork.json

# Apply the already measured review bundle to that exact copy.
node --import tsx scripts/artwork/review.ts --db=/absolute/catalogue-copy.sqlite --input=/absolute/reviewed-artwork.json --apply

# Read-only progress and blocked-host status.
node --import tsx scripts/artwork/refresh.ts --db=/absolute/catalogue-copy.sqlite

# Explicit bounded refresh of approved identities; no new name-only matches are made.
node --import tsx scripts/artwork/refresh.ts --db=/absolute/catalogue-copy.sqlite --execute --enqueue --refresh-completed --max-requests=20 --max-seconds=60

# Resume pending checkpoints without resetting completed work or refusal policy.
node --import tsx scripts/artwork/refresh.ts --db=/absolute/catalogue-copy.sqlite --execute --max-requests=20 --max-seconds=60
```

On Windows, forward-slash absolute paths such as `E:/CodexProjects/.../catalogue-copy.sqlite` work with these commands. Quote an entire `--db=...` or `--input=...` argument if its path contains spaces.

Each durable phase makes at most one metadata/image request and records the next phase only after a lease-checked commit. The queue retains failures and previous good resources; duplicate deliveries do not erase work. Per-host pacing is durable, `Retry-After` is honored, and 401/403 refusals persist until a separately reviewed operator policy change. Simply retrying a task does not clear a host refusal.

## Cloud data and synchronization

Prepare a new delta directory from the verified copy:

```sh
node --import tsx scripts/artwork/delta.ts --db=/absolute/catalogue-copy.sqlite --out=/absolute/new-artwork-delta --written-row-budget=200
```

The observed five-match/nine-resource checkpoint produces **two batches, 104 conservatively estimated writes**. Its existing title parents must already be imported with exactly the expected source IDs. The protected import endpoint validates complete artwork rows, natural-key ownership, source/media identity, and resource host/role. Updates preserve operator-disabled matches, prior review evidence, and explicit rights states; older image observations cannot replace newer resources or erase later failed checks. This delta is additive to the pinned catalogue snapshot and does not restart or advance its cursor.

The later 23-match/41-resource checkpoint produces **three batches, 378 conservatively estimated writes**, still requiring cloud schema 012 and the matching `source-id-verified` Worker parser. Use a reviewed budget at least that estimate and `--max-batches=3` for that manifest. Optional `--title-ids=<distinct ids>` prepares only selected matches/resources. Batch splitting obeys both row and byte limits; historical delta directories are never overwritten. Do not substitute this additive manifest for `IMPORT_MANIFEST_PATH` or `IMPORT_MANIFEST_SHA256`.

After cloud migration 012 and the matching Worker code are deployed, use the existing operator-token wrapper/environment and quota-accounted uploader:

```sh
node --import tsx scripts/cloud-data/upload.ts --manifest=/absolute/new-artwork-delta/manifest.json --origin=https://cloud-release.solanime.pages.dev --max-batches=2
```

Do not put tokens in arguments, files, examples, or logs. If the shared allowance is exhausted, retain `upload.sqlite` and run the same command after the reported UTC window; do not increase the budget. The generic full snapshot is not rewritten to smuggle artwork into a partially completed import.

The Worker exposes protected `POST /api/admin/artwork/refresh` with `{ "key": "stable-operator-key", "matchIds": ["existing-reviewed-match-id"] }`. It accepts one to five explicit approved identities, not URLs or a whole-catalogue switch. The route retains same-origin/token protections, global operator pause, refusal policy and the shared write/queue allowance. Stable-key replay returns the existing job without resetting its checkpoints; a different match set under the same key is rejected. Completed, paused and failed jobs are not implicitly restarted.

```sh
# No network request or write unless --execute is present.
node --import tsx scripts/artwork/cloud-refresh.ts --origin=https://cloud-release.solanime.pages.dev --key=reviewed-artwork-refresh --match-id=anikoto:8727:anilist:186744

# Explicit refresh; provide the existing operator token privately in the environment.
node --import tsx scripts/artwork/cloud-refresh.ts --origin=https://cloud-release.solanime.pages.dev --key=reviewed-artwork-refresh --match-id=anikoto:8727:anilist:186744 --execute
```

The task type is `artwork_refresh`; queue messages contain ordinary durable task IDs, never URLs. The normal Worker queue registers `createArtworkSyncHandlers`, and its minute scheduler continues each checkpointed phase without a PC. Explicit finite artwork jobs receive dispatch priority so a partially imported catalogue cannot starve them. They allocate no title/episode IDs and preserve the full snapshot pointer/cursor. New title discovery still obeys the existing snapshot barrier. `SYNC_ENABLED` and global operator control must permit work; bulk `SOURCE_REFRESH_ENABLED` is not required for this separately requested metadata refresh. No cloud resource or automatic daily artwork enqueue was added.

The generic cursor-based `enqueueCloudArtwork` remains available for reviewed operator tooling, with at most five matches per call. Neither ordinary browsing nor deployment invokes it. Read task progress through `/api/admin/sync/status`, and use the existing run pause/resume/retry endpoints. A retry never clears a recorded host refusal.

## Verification and rollback

Focused source/local and real D1 tests live in `tests/artwork.test.ts`, `tests/artwork-enrichment.test.ts`, `tests/artwork-delta.test.ts` and `tests/artwork-cloud.test.ts`; they cover strict resource destinations, full episode-ID crosswalks, ambiguous MAL/season identities, ID drift, no-banner fallback, malformed raster containers, stale observations/leases, disabled/review/rights preservation, quota exhaustion, durable refusal, resumed phases, and exact UTF-8 artifact checksums/byte splitting. The 2026-09-13 focused runs passed 23 local, 11 real D1, three delta-file contracts and TypeScript. Test fixtures never enter the production catalogue.

The first expanded delta was correctly rejected by the uploader before any request: its generator hashed a pre-validation JSON serialization but wrote the normalized serialization. The generator now hashes exactly the bytes it writes; regression tests cover this distinction. Preserve that historical failed artifact and its empty upload checkpoint. The corrected directory is `cloud-delta-v2`, with the same 23/41 rows and 378-write estimate. A historical checkpoint manifest referencing the first directory is not an instruction to upload it.

To disable the enrichment without losing evidence, an authorized operator may change only the relevant `artwork_matches.review_status` to `disabled`; APIs immediately use original posters. Preserve all artwork evidence and the original tables. For a local task copy, stop its specific writer first and restore the verified pre-enrichment online backup to a new path, rather than overwriting an active database. For cloud rollback, restore the prior Worker version if needed and leave additive tables intact; reverting the entire D1 database could discard unrelated import/account progress and is not the default rollback.

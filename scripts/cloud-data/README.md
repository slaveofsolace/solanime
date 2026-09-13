# Catalogue, research, and private cloud imports

These tools preserve the local SQLite workflow while preparing the normalized
Cloudflare D1 databases. They do not publish account data, run password hashing,
download episodes, or enable a playback capability from a research observation.
The Worker must authorize every operator API separately.

## Prepare and verify a source snapshot

Use Node with its built-in `node:sqlite` support and the repository's pnpm lockfile.
Run from the repository root. Keep generated data outside the checkout, `public/`,
and Pages `dist/`. On Windows, put temporary files and outputs on the established
E: project volume; on macOS choose an equivalent private, task-owned directory.

```sh
pnpm install --frozen-lockfile
node --import tsx scripts/cloud-data/inspect.ts /absolute/path/to/solanime.sqlite
node --import tsx scripts/cloud-data/prepare.ts --source-db=/absolute/path/to/solanime.sqlite --out=/absolute/private/cloud-data --priority-title-ids=3881,580
```

`prepare.ts` reads the catalogue without changing it, reconstructs the complete
operator research database from `data-dump/`, verifies SQLite integrity and
foreign keys, and emits checksummed JSON batches plus corresponding SQL. The
full manifest has no artificial title cap. Priority titles are early duplicate
upserts, not an additional coverage denominator. The source's unfinished crawl
tasks are retained with their original IDs and state.

The normalized research database contains all listing occurrences, detailed
records, relationships, aliases, supplemental evidence, and a hash inventory of
the source files. Oversized JSON evidence is split into ordered fragments; the
restricted API returns fragment pagination. Research reviews append evidence and
never implicitly enable a provider.

For a useful first preview within an explicit daily allowance:

```sh
node --import tsx scripts/cloud-data/bootstrap.ts --full-manifest=/absolute/private/cloud-data/manifest.json --out=/absolute/private/bootstrap --written-row-budget=40000 --priority-title-ids=3881,580
```

The bootstrap selects complete **currently imported** title graphs and retains
one-hop related-title metadata to satisfy foreign keys. Its manifest explicitly
states which records have only metadata; it is not the complete catalogue.

The restricted source browser can receive the complete canonical site inventory
before the full catalogue job reaches research tables. This only reorders rows
already present in the pinned immutable export:

```sh
# Inspect exact counts/costs without creating files or changing databases:
node --import tsx scripts/cloud-data/priority-research.ts --full-manifest=/absolute/private/cloud-data/manifest.json
# After choosing an explicit allowance, generate in a new private directory:
node --import tsx scripts/cloud-data/priority-research.ts --full-manifest=/absolute/private/cloud-data/manifest.json --out=/absolute/private/priority-research --written-row-budget=30000
```

The priority manifest contains all `sites` records and their fragments,
categories, aliases, and immediate provenance. It verifies each source batch
checksum and reconciles the exact site denominator. Complete original batches
reuse their import receipt IDs; partial batches retain stable row IDs. The full
manifest and asset pin do not change. Detailed site evidence, listing records,
relationships, and remaining collections still require the full import. The
snapshot used for this release has 1,667 sites; its priority manifest requires
117 batches and a conservative 29,406 written rows. Upload it only through the
same protected, shared-budget importer below. This is not a second allowance.

## Private Worker assets: no PC dependency after deployment

```sh
node --import tsx scripts/cloud-data/pack-assets.ts --manifest=/absolute/private/cloud-data/manifest.json --out=/absolute/private/worker-import-assets
```

The packer validates every source batch and creates immutable, checksummed
bundles of at most 450,000 bytes plus a bounded manifest. It prints the exact
`manifestPath` and `manifestSha256` to pin in deployment configuration. These
bundles contain private operational references; do not put them in the Pages
frontend assets, a public source archive, or a public download route.

Configure the **API Worker**, not Pages, with:

```json
{
  "assets": {
    "directory": "/absolute/private/worker-import-assets",
    "binding": "IMPORT_ASSETS",
    "run_worker_first": true,
    "html_handling": "none",
    "not_found_handling": "none"
  }
}
```

The Worker HTTP handler must never return `IMPORT_ASSETS.fetch(request)` and must
return 404 for `/__private-import/*` and `/__private-baseline/*` on every public origin. `run_worker_first`
is mandatory: the platform's default asset-first behavior would expose matching
files before the Worker can deny them. Verify this against the deployed Worker
and Pages origins before starting an import. The internal reader invokes only
the asset binding at the synthetic `https://assets.local` origin; it is not a
network proxy and accepts no user-supplied origin.

The complete catalogue is served from a second immutable package in that same
Worker-only asset binding, while D1 remains the authority for fresher rows,
operator disables, account-independent diagnostics, and synchronization state.
Prepare it from a completed, WAL-free SQLite checkpoint and then assemble both
private packages into a fresh ignored upload directory:

```sh
pnpm cloud:baseline:prepare -- --source-db=/absolute/private/catalogue-final.sqlite --out=/absolute/private/catalogue-baseline --existing-assets=build/cloud-import-assets
pnpm cloud:assets:stage -- --import-assets=build/cloud-import-assets --baseline-assets=/absolute/private/catalogue-baseline --out=build/cloud-worker-assets
```

`stage-worker-assets.ts` resolves the intentional import-root compatibility
junction, rejects nested links and path collisions, checks both configured
manifest pins, verifies every import bundle and baseline payload hash/byte count,
reconciles the aggregate file count, keeps a 1,000-file reserve below the
20,000-file ceiling, and refuses an existing output directory. The resulting
`build/cloud-worker-assets` directory is the `wrangler.jsonc` asset source. It is
never copied into `public/` or `dist/`.

Set `CATALOGUE_BASELINE_ENABLED=true`, `CATALOGUE_BASELINE_ID` to the source
database SHA-256 printed by preparation, and
`CATALOGUE_BASELINE_MANIFEST_SHA256` to the printed manifest hash. Changing a
pin also changes the Worker edge-cache namespace. The request-scoped reader has
no arbitrary URL input and re-verifies every payload it actually consumes.

For an immutable completed checkpoint that already has a prepared baseline,
create a preview-only release plan without editing the checked-in Wrangler file
or opening the SQLite database:

```sh
node --import tsx scripts/cloud-data/prepare-baseline-preview.ts \
  --source-db=/absolute/private/catalogue-final.sqlite \
  --expected-source-sha256=<reviewed-64-character-sha256> \
  --expected-mappings=<reviewed-complete-mapping-count> \
  --baseline-assets=/absolute/private/catalogue-baseline \
  --import-assets=build/cloud-import-assets \
  --out=/absolute/private/fresh-preview-plan \
  --preview-alias=completed-catalogue
```

The planner streams the source hash without opening SQLite, verifies that the
baseline manifest identity and mapping denominator match it, checks every
baseline/import payload while staging a fresh Worker-only asset tree, and writes
an isolated `wrangler.preview.json` plus `preview-plan.json`. The generated
version config enables Preview URLs, pins the completed baseline, and disables
new registration plus snapshot/source synchronization. Preparation performs
zero D1 writes.

Run only the `commands.verifyOnly` argument vector from `preview-plan.json`
first. It uses `wrangler versions upload --dry-run`, so Wrangler compiles and
checks the version without uploading it. After operator review, the separate
`commands.uploadPreviewVersionAfterReview` vector uploads an undeployed Worker
version with a preview alias. Do not substitute `wrangler deploy`,
`wrangler versions deploy`, D1 migration, or D1 execute commands: those cross
the preview-only boundary. Preview URLs are public unless the Worker is covered
by Cloudflare Access, so verify the Worker's private-asset denial routes before
sharing the alias.

An uploaded Worker version cannot be selected by a Pages Service binding: Pages
binds to a deployed Worker service. For an official-YouTube review, prepare a
separately named private Worker and a preview-branch-only Pages binding:

```sh
node --import tsx scripts/cloud-data/prepare-youtube-review.ts \
  --baseline-plan=/absolute/private/completed-baseline/preview-plan.json \
  --resources=/absolute/private/isolated-youtube-review-resources.json \
  --out=/absolute/private/fresh-youtube-review-plan
```

The resource manifest must name `solanime-api-youtube-review`, branch
`youtube-official-review`, three already provisioned and mutually distinct
review D1 databases (`CATALOGUE`, `ACCOUNTS`, and `RESEARCH`), and two distinct
numeric rate-limit namespaces. The generator rejects every D1 ID and namespace
used by the existing API config. It produces a no-route/no-preview-URL Worker
config and a Pages preview binding with `SOLANIME_REVIEW_MODE=youtube-official`.
That gateway mode exposes only public catalogue reads and the playback resolver;
account, community, operator, export, import, and sync routes fail closed.
It also counts regular static-asset files itself and rejects packages above the
20,000-file Workers Free ceiling or the 25 MiB per-file ceiling; no paid plan is
assumed. Wrangler 4.130's `Read ... files` line counts directories as recursive
entries before filtering them, so use the plan's `worker.staticAssets.files`
value for this quota check.

Configuration generation is local-only. A functional deployment still requires
separate review D1 provisioning/migrations, the reviewed YouTube approval in the
review catalogue, review-service secrets, an explicitly approved deployment of
the review Worker, and only then the Pages preview branch. Do not reuse the
existing preview D1 databases: playback resolution records a resolution timestamp
and therefore is not a read-only D1 operation. The generated plan lists local
Worker dry-run, later review-Worker deployment, and later Pages-preview commands
separately.

Apply all catalogue migrations, including `009_cloud_snapshot_jobs.sql` and
`010_cloud_sync_payloads.sql`, then
wire these exports from `server/cloud/data/index.ts`:

```ts
const jobs = createSnapshotImportRepository(env.CATALOGUE, env.IMPORT_ASSETS, budget);
await jobs.ensure({
  manifestPath: env.IMPORT_MANIFEST_PATH,
  manifestSha256: env.IMPORT_MANIFEST_SHA256,
});
const handlers = {
  ...createSnapshotImportHandlers(env.CATALOGUE, env.RESEARCH, env.IMPORT_ASSETS, budget),
  ...createAnikotoSyncHandlers(env.CATALOGUE),
};
// Explicitly enable control only after operator approval and preview tests.
await createSyncRepository(env.CATALOGUE).setEnabled(true);
await dispatchSyncTasks(env.CATALOGUE, env.SYNC_QUEUE, budget, 5, new Date(), ['snapshot_import']);
// Queue handler, one message at a time:
await consumeSyncMessage(message, env.CATALOGUE, handlers, budget);
```

Cron should repeat the idempotent `ensure` and dispatch while enabled. Configure
the queue consumer with `max_batch_size: 1`: all messages in a queue invocation
share its query allowance. Queue messages carry only a task ID. A D1 task cursor, five-minute lease, immutable
snapshot pin, per-target receipt, and guarded completion control progress. Each
delivery handles up to four batches, normally two new full batches, stopping
early at a tracked query ceiling. Each same-column batch uses one checked JSON
parameter expanded into normalized rows by `json_each`; it does not become a
packed catalogue record. The handler permits at most 27 statements, leaving
lease/finalization work and two asset reads inside the 45-operation safety
envelope below D1's free-tier 50-query limit. Progress is written after each
batch. A crash after data commit but before cursor
commit replays the receipt without duplicating rows. A lost notification is
redispatched from D1 after its notification lease expires. A missing or changed
asset never advances the cursor. Preserve old asset sets when updating a Worker
that still has active snapshot jobs.

Catalogue and research imports share the CATALOGUE budget ledger. The current
deployment's 75,000 written-row allowance leaves 25,000 of D1's free 100,000
daily writes for application/account/other account usage. Index writes count.
Upsert estimates are conservative; successful D1 `meta.rows_written` values
settle their reservations with overhead retained. These are not a measurement of
other applications' account usage. Do not promise an exact number of import
days from a worst-case estimate. On quota exhaustion D1 retains the task and
its cursor for the next UTC window; neither a paid upgrade nor a PC is needed.
The dispatcher reads the budget before sending and stops for the exhausted
window. There is no immediate recursive queue retry/dispatch loop. D1's separate
5-million daily read allowance and 500 MB per-database free storage limit still
apply: monitor account-wide use, including other projects and uncached catalogue
searches, before increasing this application's allowance.

Each mutation attempt reserves its own budget: an uncertain or failed write is
not free just because it uses the same batch ID. A completed receipt still skips
the mutation entirely. The atomic receipt guard rejects internal-ID retargeting
or conflicting natural source identities with `IMPORT_IDENTITY_CONFLICT`, before
any row can move to another title, episode, version, or provider. Native resource
imports cannot re-enable an existing operator-disabled row, and older approval
metadata does not overwrite a newer approval.

## Cloud source refresh

After the pinned snapshot completes, the same queue implements Anikoto
`catalogue_page`, `sitemap_index`, `sitemap_page`, `sitemap_title`, `title_detail`,
`title_reconcile`, and `episode_servers` tasks. The Worker has a separate
`SOURCE_REFRESH_ENABLED` configuration gate. The scheduler and protected
`POST /api/admin/sync/start` call
`createAnikotoRefreshRepository(env.CATALOGUE, budget).ensure({ key?, includeProviders? })`.
The default stable key is the UTC day. Existing active or paused refresh runs are
reused, including concurrent requests with different daily keys. A pending
snapshot returns `snapshot_pending`; source processing must stay paused until
the snapshot finishes. Original local task IDs, payloads, and unfinished states
remain intact. Unsupported historical task types are not reinterpreted.

The fixed-origin, allowlisted request chain is catalogue/filter and sitemap
discovery → public watch identity → episode-list JSON → stored server reference
→ server-list JSON → normalized episode/language/provider mappings. The parsers
are shared with the existing verified local source flow. Canonical route changes
retain source and internal IDs. Catalogue cards, episode inventory, fanout, and
stale-record reconciliation are split into bounded deliveries with durable D1
fragments. Fragments are deleted only in the transaction that finishes applying
them; an interrupted or rejected response cannot delete good catalogue rows.
The 1,212-episode acquisition test fits the invocation query envelope without
treating a limited sample as the full inventory. The response and storage byte
limits fail explicitly on larger unexpected shapes.

The shared host policy enforces robots rules, request spacing, bounded same-host
redirects, timeouts, response limits, and Retry-After. An HTTP 401/403/451 refusal
pauses the run and caches a six-hour refusal window; explicit retry does not
clear that policy or send another request through the refusal. Delayed markup,
malformed data, and verified empty inventories remain distinct. Episode,
version, and mapping absence becomes stale only after a complete validated
inventory; approved external native editions remain protected. Whole-title
absence across a discovery run is not treated as a deletion or proof of removal.
Local Miniflare tests establish these contracts, not live upstream playback or
production Worker CPU measurements.

Use protected `POST /api/admin/import/:runId/pause` and `/resume` for active runs.
For failed tasks, `/retry` calls
`createSyncRepository(db).retryRun(runId, { limit: 100, includeBlocked }, budget)`;
the HTTP route retries blocked tasks only with explicit `includeBlocked: true`.
The atomic operation preserves payloads/checkpoints, appends operator evidence,
and resumes the run along with the selected tasks. It returns actual `retried`,
`remaining`, and `runStatus` fields; repeat deliberately if more than 100 tasks
need retry. Cancelled runs remain protected. `GET /api/admin/sync/status` exposes
the shared allowance, durable task states, and recent errors. These operations
never enable a playback adapter from research metadata.

## Bounded operator upload and resume

The initial bootstrap can be uploaded before the private queue is started:

```sh
# Set SOLANIME_ADMIN_TOKEN in the current shell without saving it in a command file.
node --import tsx scripts/cloud-data/upload.ts --manifest=/absolute/private/bootstrap/manifest.json --origin=https://verified-preview.pages.dev
```

The uploader sends `x-admin-token`, throttles requests, validates responses, and
stores receipts in an adjacent `upload.sqlite`. An HTTP failure, quota response,
or Retry-After condition records a precise pause. Repeat the same command to
resume; completed receipt hashes are checked and skipped. `--max-batches=N` is
an explicit operator batch limit; the default has no hidden full-import cap.
Never bulk-execute the generated SQL remotely to bypass the shared allowance.

Before importing an approved-native addition, compare its local numeric IDs with
the complete pinned snapshot, including records not yet hosted:

```sh
node --import tsx scripts/cloud-data/audit-delta.ts --full-manifest=/absolute/private/cloud-data/manifest.json --delta-manifest=/absolute/private/native-delta/manifest.json
node --import tsx scripts/cloud-data/native-delta.ts --source-db=/absolute/private/solanime.sqlite --full-manifest=/absolute/private/cloud-data/manifest.json --out=/absolute/private/new-native-delta --written-row-budget=10000
```

The generator requires this audit, a fresh directory, and a bounded allowance.
It refuses identity collisions, missing parent episodes, and local IDs in the
reserved cloud-generated range. It never silently renumbers existing evidence.
The reported parent episodes must already be present in D1. Delta generation
does not replace the pinned full snapshot or enable a previously disabled
resource through an upsert.

## Backup, restore, and tests

For a local release backup, first check that no ingestion process or current
worker lease is active. The read-only `inspect.ts --operations` option reports
run/task lease timestamps without dumping task payloads. Do not erase an old
running claim: normal import recovery owns that transition.

```sh
node --import tsx scripts/cloud-data/inspect.ts /absolute/private/solanime.sqlite --operations
node --import tsx scripts/cloud-data/release-snapshot.ts --source-db=/absolute/private/solanime.sqlite --run-id=2 --out=/absolute/private/new-release-backup
```

The snapshot tool requires a fresh output directory and all local migrations.
It appends current coverage without replacing historical observations, separates
original source mappings from approved external additions, preserves all durable
task states, and pins a consistent SQLite backup. It restores that backup into a
new sibling test database, runs structural checks, compares task/count hashes,
and emits a SHA-256 manifest. Its `pre-final-verification` label does not claim
later browser or production evidence. The safe generated `data/exports` manifest
contains coverage and individual verified-mapping counts, not private worker
identifiers, crawl payloads, raw errors, or account data. Regenerate exports with
`pnpm export:data` only after choosing the intended source database.

Keep the original catalogue SQLite, generated `research.sqlite`, full batch
manifest, immutable asset directory, and uploader checkpoint together in a
private backup. Preserve the original research commit and required attribution.
The source databases and batch manifests contain no account tables. Account
backups have a different private procedure and must not be appended to these
exports. Temporary playback URLs are not part of the native-resource registry.

For cloud recovery, export D1 with Wrangler into a private directory, restore
with the documented D1 procedure, redeploy the same asset pins, and resume the
retained job. If restoring a fresh database from this source snapshot, apply
migrations and start a new quota-aware snapshot job rather than executing every
SQL file at once. A rollback of code must preserve schema compatibility, D1
data, active job pins, and private assets; do not delete older assets while their
jobs remain pending.

```sh
pnpm exec tsc --noEmit
pnpm exec vitest run tests/cloud-data.test.ts tests/cloud-data-refresh.test.ts tests/cloud-data-priority.test.ts tests/cloud-data-delta.test.ts
node --import tsx scripts/cloud-data/verify-local.ts --manifest=/absolute/private/bootstrap/manifest.json --out=/absolute/private/bootstrap-restore-verification
```

The tests use a real local Miniflare/D1 runtime, including atomic import failure,
idempotency, concurrent quota reservation, queue interruption, expired leases,
malformed assets, separate research writes, and next-window quota resume.
Fixture records exist only in those tests. Playback verification and public
asset-denial checks belong to the integrated Worker/browser suite.

Current platform references: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[Queues JavaScript APIs](https://developers.cloudflare.com/queues/configuration/javascript-apis/),
[Worker asset bindings and worker-first routing](https://developers.cloudflare.com/workers/static-assets/binding/).

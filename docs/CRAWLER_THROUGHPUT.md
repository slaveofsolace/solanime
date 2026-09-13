# Resumable mapping throughput

## Completed standalone run (September 13, 2026)

The task-owned standalone crawl completed run 2 at `2026-09-13T06:40:43.059Z`.
Its retained queue now contains 144,367 completed tasks, zero pending tasks and
zero failures. The resulting database contains 8,949 titles, 134,825 episodes,
184,073 episode versions and 423,236 provider mappings. The supervisor created
a final integrity-checked checkpoint at:

```text
E:\CodexProjects\solanime-cloud-artifacts\mapping-resume-20260913\checkpoints\catalogue-final-20260913T064052Z.sqlite
```

The checkpoint SHA-256 is
`2ac4cd16f061cab1cb44cec53595f84661573b5b906b9a93be608ef9c5d2cc4e`.
No source worker remains live because there is no remaining queue; the installed
current-user startup entry is intentionally idempotent and exits after observing
completion. The source-collection ETA is therefore zero. Cloud synchronization,
native source resolution and actual playback are separate milestones.

The tracked `data/solanime.sqlite` can retain an older crawl heartbeat because
the unattended work deliberately ran against the task-owned database above.
Select the database explicitly when checking either state:

```powershell
pnpm import:status -- --db=E:/CodexProjects/solanime-cloud-artifacts/mapping-resume-20260913/catalogue.sqlite
```

`import:status` accepts both `--db=<path>` and `--db <path>` and rejects unknown,
empty or duplicate selections. This prevents an explicit status request from
silently falling back to the default database.

The source worker defaults to one lane with 1,200 ms between request starts.
The operator can explicitly select a measured start spacing with
`SOLANIME_SOURCE_DELAY_MS` (50–60,000 ms) and use `--concurrency=1` through
`--concurrency=10`. These are operator-selected bounds, not automatic rate ramps.
Concurrency overlaps independent episode-server tasks under one database owner
and one shared host gate. It does not multiply the host request rate.
Discovery, title inventories and reconciliation remain serialized.

Example, after stopping a previous owner at a verified idle task boundary:

```powershell
$env:SOLANIME_DB_PATH = 'E:\path\to\existing\catalogue.sqlite'
$env:SOLANIME_SOURCE_DELAY_MS = '50'
pnpm import:anikoto --mode=full --run-id=2 --concurrency=10
```

Do not run that command beside an existing collector. The worker lease also
rejects a second owner. Keep the original durable run ID, database and pending
tasks. `--max-tasks=100` is an explicit bounded checkpoint, not a full import.
`--exit-when-paused` lets an operator benchmark drain and exit on a held run.

An overload response reduces the rate, never increases it. Retry-After is
shared between lanes and persisted as `sourceRetryAfterAt` in the run
checkpoint. No new tasks are claimed before that deadline, including after a
restart. Access refusals block further queued network dispatch. Schema changes
hold the run; previously good records are preserved. In-flight work drains
before the lease is released. Running tasks count against configured budgets.

Local migration `010_crawl_claim_priority.sql` adds a partial expression index
for pending/retry tasks. It preserves the exact priority order used by the
claim query while avoiding a full queue sort for each claim. This migration
does not add, remove, deduplicate or reset tasks. Existing D1/cloud migrations
and the published catalogue are unaffected by this local index.

The September 13 inspection found one public server-list request per episode
reference, and no duplicate references in the remaining 92,248-task snapshot.
No bulk mapping interface was established in the inspected client workflow.
This is evidence about that workflow, not a claim that no bulk interface exists.
No proprietary client bundle was imported into the product, no hidden endpoint
was guessed, and no media was downloaded or playback verification inferred.

The Windows standalone supervisor keeps its operator-reviewed tuning in
`collector-tuning.json`, uses copied local runtimes and resumes the same queue
after a confirmed process exit. Its summary reports a rolling measured ETA
after two minutes of uninterrupted progress. Source collection, cloud import,
native source resolution and actual playback remain separate milestones.

Focused tests cover shared pacing, queued cancellation, short/long Retry-After,
access refusal, task budgets, bounded concurrency, prerequisite serialization,
resumption, schema holds and database foreign keys.

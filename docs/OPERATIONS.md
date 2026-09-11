# Operations

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SOLANIME_DB_PATH` | `data/solanime.sqlite` | Persistent SQLite database |
| `HOST` | `127.0.0.1` | Local API bind host |
| `PORT` | `8787` | Local API port |
| `SOLANIME_ADMIN_TOKEN` | unset | Enables protected HTTP administration |
| `SOLANIME_SOURCE_DELAY_MS` | `1200` | Minimum request-start spacing for Anikoto |
| `SOLANIME_SOURCE_TIMEOUT_MS` | `20000` | Per-request timeout |

## Run modes

- `slice` validates the entire chain for a bounded number of live titles. Default: three titles from page one, including provider mapping tasks.
- `full` discovers every page exposed by the live filter pager, then enriches every discovered title and episode mapping. It has no implicit task cap.
- `incremental` currently walks the same discoverable pagination with idempotent upserts. Existing records remain available throughout refresh.

Optional CLI controls include `--page-limit`, `--title-limit`, `--task-budget`, `--max-tasks`, `--skip-providers`, and `--run-id`. Limits are explicit in the command and durable run record.

## Resume and recovery

1. Run `pnpm import:status` and note the active run ID.
2. Check `data/logs/full-import.pid.json`. The detached launcher also probes that PID and refuses to create a second worker while it is active.
3. If the run is paused, use `pnpm tsx scripts/control-import.ts <id> resume`.
4. Resume detached with `pnpm import:detached -- <id>`, or run `pnpm import:anikoto --mode=full --run-id=<id>` in the foreground for interactive diagnostics.

The worker requeues any task left in `running` state by an interrupted process and increments its attempt count. Upserts and unique source keys make re-execution safe. A live worker remains idle while a run is paused and resumes when the run is reactivated; future-dated retry tasks are awaited rather than leaving the run stranded. Explicit `retry` resets the bounded attempt window only for terminal failed/blocked tasks.

Explicit access refusals are marked blocked and are not bypassed. Retryable network/5xx/429 failures use bounded attempts, exponential backoff, and `Retry-After`. A malformed schema is reported as `UPSTREAM_CHANGED`. A delayed server list preserves existing mappings for retry. A valid status-200 server list with the observed episode context but no provider buttons is recorded as an `empty_provider_inventory`; it never invents a provider mapping.

For a bounded recheck of terminal server-list failures, pause the run and execute `pnpm audit:provider-failures -- --limit=5`. The report omits opaque references and classifies mapped, delayed, empty, unknown, and request-failed results without modifying crawl state.

Successful complete refresh observations use soft reconciliation: titles, episodes, versions, and provider mappings absent from the corresponding complete response are marked `stale`, never deleted. A loading placeholder is retryable and cannot become an empty inventory. A valid status-200 episode envelope with no episode anchors is retained as a dated `empty_episode_inventory` observation.

## Backup and restore

`pnpm backup` uses SQLite's online backup API, so reads can continue. For restore, stop all API/import writers, run `pnpm restore -- <path> --replace`, and restart. The restore validates `PRAGMA integrity_check` and schema presence; `--replace` preserves the previous target with a timestamped `.bak` suffix.

A smoke restore can target an alternate database via `SOLANIME_DB_PATH`; run `pnpm verify:database` with the same variable before switching application writers to it.

## Coverage interpretation

The catalogue denominator is scoped to the dated union of watch routes found through complete `/filter` pagination and all successfully expanded public sitemap children. It is not a claim about private or hidden records. `discovered_titles` can temporarily exceed `imported_titles` while sitemap-only pages are being validated. Episode/provider denominators are counts discovered from successfully enriched title/episode tasks. During a run, pending counts can grow because completed title tasks enqueue per-episode server tasks.

## Maintenance runtime update (September 2026)

The README supersedes earlier platform-specific startup commands: Node 24.10+, pnpm 11.19.0, `pnpm doctor`, `pnpm dev` for development and `pnpm build && pnpm start` for the complete production runtime. `.env` is loaded by the Node entrypoints. Detached import and browser-test commands are cross-platform.

Bulk HTTP exports now require the admin token. The optional Pages gateway exposes only read APIs and mapping resolution; it still requires a running persistent Node backend. Browser tests use an isolated in-memory database and do not contact live streaming providers.

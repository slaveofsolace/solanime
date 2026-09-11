# Sol Anime

Sol Anime is an independent, local-first catalogue and watch interface reconstructed from Anikoto's publicly observable browsing, episode, language-version, and provider relationships. It is not operated by or endorsed by Anikoto. It does not copy Anikoto's application bundles, advertisements, trackers, cookies, or episode media.

The delivered SQLite database is populated by the same durable ingestion worker used for refreshes. Catalogue pages, search, title detail, episode/version selection, and provider choices all read from that database; test fixtures are confined to tests.

## Requirements

- Node.js 24 or newer (`node:sqlite` is used directly)
- pnpm 11
- Windows, macOS, or Linux for the application; the checked-in database path defaults to `data/solanime.sqlite`

The dependency choices follow the current official guidance for [Node SQLite](https://nodejs.org/api/sqlite.html), [Vite](https://vite.dev/guide/), [React Router](https://reactrouter.com/home), and [Playwright](https://playwright.dev/docs/intro).

## Start locally

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:5173`. The frontend proxies `/api` to the local API at `127.0.0.1:8787`.

For administrative controls, set `SOLANIME_ADMIN_TOKEN` before starting the API and open `/admin`. The token is kept in browser session storage, not local storage. Copy `.env.example` only as a reference; this project does not auto-load or commit secrets.

## Ingestion

Validate a bounded real-data slice:

```bash
pnpm import:anikoto --mode=slice --title-limit=3
```

Start full discovery and enrichment in the foreground:

```bash
pnpm import:anikoto --mode=full
```

Resume an existing durable run:

```bash
pnpm import:anikoto --mode=full --run-id=<run-id>
```

On Windows, resume it as a detached worker with the same durable run ID:

```bash
pnpm import:detached <run-id>
```

The detached launcher records its exact PID and log paths in `data/logs/full-import.pid.json` and refuses to start while that PID is still active.

Inspect progress or control a run locally:

```bash
pnpm import:status
pnpm tsx scripts/control-import.ts <run-id> pause
pnpm tsx scripts/control-import.ts <run-id> resume
pnpm tsx scripts/control-import.ts <run-id> retry
pnpm audit:provider-failures -- --limit=5
pnpm audit:empty-episodes
```

The worker is sequential per source host, defaults to a 1.2-second start-to-start delay, uses timeouts and bounded retries, respects `Retry-After`, stops on explicit access refusals, and never turns a failed fetch into a deletion. Set `SOLANIME_SOURCE_DELAY_MS`, `SOLANIME_SOURCE_TIMEOUT_MS`, and task/process budgets explicitly when needed. There is no hidden "full" cap.

The queue stores filter-catalogue, sitemap-index/page/title, title-detail, and per-episode server-list tasks. Full discovery reconciles the public `/filter` pagination with every same-origin child of `/sitemap.xml` before the long provider-enrichment tail. Claims, attempts, retry timestamps, errors, checkpoints, and run state survive process restarts. Interrupted running tasks are re-queued as idempotent work.

## Data and provider boundaries

- Source IDs, routes, titles, aliases, genres, episodes, language variants, and provider mappings are persisted.
- Opaque provider references remain private inside SQLite because they are needed for on-demand resolution. They are excluded from default JSON/CSV exports and logs.
- Temporary embed URLs are resolved only when a user selects a stored mapping. They are not retained in public exports.
- The resolver accepts only database-backed mapping IDs, calls only the exact allowlisted first-party endpoint, and validates returned embeds against provider-specific hostname and path allowlists. It is not an open proxy.
- Provider buttons remain distinct even when their observed backend hostname is shared.
- "Mapping imported", "source resolved", "provider document responded", and "playback verified" are separate states.
- No episode files, DRM bypass, access-block bypass, private APIs, credentials, or session captures are included.

## Routes and APIs

Frontend routes:

- `/catalogue` and `/search` — database-backed browsing, filtering, sorting, and pagination
- `/title/:slug` — metadata, aliases, genres, versions, and scalable episode directory
- `/watch/:slug/:episodeId?language=...&server=...` — refresh-safe watch workflow and provider selection
- `/library` — local watchlist, history, preferences, and theme
- `/admin` — token-gated import diagnostics and controls

Primary APIs:

- `GET /api/health`
- `GET /api/titles?q=&genre=&type=&status=&language=&page=&pageSize=&sort=`
- `GET /api/titles/:slug`
- `GET /api/episodes/:episodeId/providers?language=`
- `POST /api/providers/:mappingId/resolve`
- `GET /api/meta/filters`
- `GET /api/exports/catalogue.json`
- `GET /api/exports/catalogue.csv`
- `GET /api/exports/coverage.csv`
- token-gated `/api/admin/import/*` and `/api/admin/backup`

## Verification, exports, backup, and restore

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm verify:database
pnpm verify:providers
pnpm test:e2e
pnpm export:data
pnpm backup
pnpm restore -- <backup.sqlite> --replace
```

Set `PLAYWRIGHT_BROWSERS_PATH` to a task-owned D: or E: directory before installing/running Playwright on Windows.

`restore --replace` is intentionally explicit. It validates the source database and preserves the current database as a timestamped pre-restore backup before replacement. Stop API/import writers first.

`verify:providers` performs a bounded current SUB/DUB resolution check for every implemented provider adapter. Its output intentionally excludes temporary player URLs and opaque upstream references, and it never promotes source resolution to a playback claim. `pnpm audit:empty-episodes` rechecks titles with zero episode rows and records valid empty public inventories separately from loading/error states. `pnpm audit:provider-failures -- --limit=<n>` is a read-only, paced diagnosis for terminal server-list failures and requires the run to be paused.

More detail:

- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Upstream observations](docs/UPSTREAM_OBSERVATIONS.md)
- [Provider inventory](docs/PROVIDER_INVENTORY.md)
- [Interface system](docs/DESIGN_SYSTEM.md)
- [Evidence ledger](docs/EVIDENCE_LEDGER.md)
- [Documentary outline](docs/DOCUMENTARY_OUTLINE.md)
- [Resource registry](docs/RESOURCE_REGISTRY.json)

## Cloudflare alpha

The current authorized Cloudflare Pages alpha is `https://solanime.pages.dev`. It deploys the built React frontend from `dist/` for public visual/navigation review. The checked-in database and Node SQLite API remain the authoritative working runtime, so production catalogue APIs on Pages are a tracked loose end until a Cloudflare D1/Functions backend is added and imported from the SQLite checkpoint.

Provider playback remains evidence-gated. SolAnime no longer adds a sandbox attribute to the in-site MegaPlay iframe, but current MegaPlay player behavior still appears parent-origin allowlist restricted; source resolution, provider document load, and playback verification are recorded separately.

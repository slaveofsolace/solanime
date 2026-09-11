from pathlib import Path
r=Path.cwd()
(r/'src/styles.css').write_text((r/'.review/styles-1.css').read_text()+(r/'.review/styles-2.css').read_text())
(r/'README.md').write_text('''# Sol Anime

An independent anime catalogue and watch interface. React handles browsing; a Node.js API reads the imported SQLite catalogue and resolves stored provider mappings on demand. It is not operated by or endorsed by Anikoto.

## Run locally

Requirements: **Node.js 24.10 or newer** (24 LTS recommended) and **pnpm 11.19.0**.

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
pnpm doctor
pnpm dev
```

Open **http://127.0.0.1:5173**. The API listens on `127.0.0.1:8787`. Both processes load `.env`; existing shell environment variables take precedence. No secret is required for browsing.

The complete review ZIP includes the database. For a Git clone, fetch the large files first:

```sh
git lfs install
git lfs pull
```

`doctor` checks the runtime, database integrity, and record counts. A Git LFS pointer is not a SQLite database: startup detects it and gives a recovery command instead of silently creating a replacement.

### Mac prerequisites

With Homebrew already installed:

```sh
brew install node@24 git-lfs
export PATH="$(brew --prefix node@24)/bin:$PATH"
npm install --global pnpm@11.19.0
node --version
pnpm --version
```

The `export` affects this Terminal session. Add it to your shell configuration to use Node 24 in new sessions.

## Check a change

```sh
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Unit/API tests use temporary databases. Browser tests use an **in-memory fictional catalogue on port 18787**, controlled iframe responses, and an original motion clip. They do not modify the imported database or contact live streaming providers. The four browser projects cover desktop/mobile Chromium and WebKit; WebKit emulation is not physical iPhone or macOS Safari certification.

`test-results/` and `playwright-report/` contain ignored browser evidence. Fixture playback is not proof that an external provider permits playback from your deployment origin.

## Serve the complete application

```sh
pnpm build
pnpm start
```

Open **http://127.0.0.1:8787**. This serves both the built frontend and SQLite API, including title/watch deep links. `pnpm preview` requires the separate API; `pnpm start` is the complete runtime.

For hosting, run this Node process behind HTTPS, configure `HOST`/`PORT`, and keep `data/` on persistent storage. A static-only deployment cannot run Node SQLite. Never publish `.env`, raw databases, backups, or private provider references as static assets.

### Optional Cloudflare Pages frontend

`public/_worker.js` is a same-origin gateway. It forwards catalogue reads and stored-mapping resolution to **one configured backend origin**. It does not host SQLite, transcode media, forward arbitrary URLs, or expose administration/exports.

1. Host the Node API on a reachable HTTPS origin.
2. Set the Pages runtime binding `SOLANIME_API_ORIGIN` to that origin, without an API path.
3. Set `SOLANIME_ALLOWED_ORIGINS` on the Node API to exact Pages/custom frontend origins, comma separated.
4. Build and deploy `dist/`. Test health, search, and deep links before promoting a deployment.

Without the binding, API requests return a JSON configuration error rather than an HTML page that crashes the interface. After configuring the backend and binding, deployment is a separate deliberate command:

```sh
pnpm build
pnpm exec wrangler pages deploy dist --project-name solanime --branch review
```

Review the preview before promoting it. This maintenance pass does not deploy or merge automatically.

## Data and providers

The imported checkpoint contains **8,949 titles, 134,825 episodes, 183,769 language versions, and 121,116 provider mappings**. These are local record counts, not proof of complete upstream coverage or that every source plays. Five provider records remain, including unavailable/download-only entries.

Stable source identifiers, language groups, and provider mappings stay separate. Temporary player references are resolved on selection, not retained as permanent public URLs. Resolution, player-document load, and verified playback are distinct. History records a player the user opened, not an episode silently marked watched on resolution.

The application includes no episode media, copied upstream bundles, advertising scripts, or access-control bypasses. Third-party players can change or restrict embedding. Failures remain visible instead of being disguised with replacement content.

## Administration and ingestion

Generate an admin token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, put it in `.env` as `SOLANIME_ADMIN_TOKEN`, restart the API, and open `/admin`. An empty token disables administration. The browser uses session storage; bulk exports also require authentication. Keep administration off the public gateway.

Existing paced, resumable import commands remain available:

```sh
pnpm import:status
pnpm import:anikoto --mode=slice --title-limit=3
pnpm import:anikoto --mode=full --run-id=YOUR_RUN_ID
pnpm import:detached YOUR_RUN_ID
```

Only run live imports deliberately. The detached launcher invokes Node directly on macOS/Linux/Windows, retains process checks, and does not use a Windows shell. Respect source limits and access conditions. Failed requests do not establish deletion.

```sh
pnpm verify:database
pnpm export:data
pnpm backup
# Stop API/import writers before restoring. Review the backup path first.
pnpm restore -- /absolute/path/to/backup.sqlite --replace
```

`verify:providers` is an opt-in live resolution check, not part of CI or a video-playback guarantee.

## Repository map

`src/` contains the UI, routes, player and local preferences. `server/` owns API/query/provider logic; `server/ingestion/` owns parsing and the durable queue. `migrations/` contains additive schema updates; `scripts/` contains operations commands. `tests/` contains isolated regressions. `public/` contains assets and the optional gateway; `docs/` preserves architecture, operations and source research.

Start with [Operations](docs/OPERATIONS.md), [Architecture](docs/ARCHITECTURE.md), and [Provider inventory](docs/PROVIDER_INVENTORY.md). Earlier observations and screenshots are historical evidence, not current playback certification.
''')
(r/'docs/DESIGN_SYSTEM.md').write_text('''# Interface system

A catalogue, not a promotional landing page: search, a real recent title, episode navigation and server selection take priority. Research controls stay in administration.

Use the shared CSS tokens and components. Dark mode uses neutral charcoal with an orange action color. Light mode uses white surfaces and darker orange for readable controls. Typography uses system fonts; no bundled webfonts are required.

Keep artwork unfiltered with stable poster ratios and explicit missing-image states. Do not add fabricated statistics, decorative badges or repeated oversized headings.

Desktop catalogue grids use six columns, reducing to four, three and two as width narrows. The source selector moves below the player on mobile. Rails scroll independently without widening the page.

Controls need visible focus, accurate selected/disabled states, readable contrast and reduced-motion behavior. SVG icons share geometry. Connection evidence is expandable, not dominant chrome.

Acceptance combines screenshots, desktop/mobile interactions, both themes, overflow checks and automated WCAG A/AA checks. Automated checks do not replace visual review.
''')
p=r/'docs/OPERATIONS.md';p.write_text(p.read_text()+'''\n## Maintenance runtime update (September 2026)

The README supersedes earlier platform-specific startup commands: Node 24.10+, pnpm 11.19.0, `pnpm doctor`, `pnpm dev` for development and `pnpm build && pnpm start` for the complete production runtime. `.env` is loaded by the Node entrypoints. Detached import and browser-test commands are cross-platform.

Bulk HTTP exports now require the admin token. The optional Pages gateway exposes only read APIs and mapping resolution; it still requires a running persistent Node backend. Browser tests use an isolated in-memory database and do not contact live streaming providers.
''')
(r/'.github/workflows/quality.yml').write_text('''name: Quality
on:
  push:
    branches: [main, fix/solanime-quality-pass]
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: quality-${{ github.ref }}
  cancel-in-progress: true
jobs:
  checks:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm install --global pnpm@11.19.0
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
  browser:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm install --global pnpm@11.19.0
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium webkit
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: browser-evidence
          path: |
            playwright-report/
            test-results/
          retention-days: 7
''')

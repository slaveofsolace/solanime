# Solanime

An independently built anime catalogue and native player. React/TypeScript on
Cloudflare Pages, a Workers API, separate D1 catalogue/accounts/research stores,
and Firebase Spark email/password authentication. Node/SQLite remains supported
locally. No paid service or always-on personal computer is required by the hosted
application.

Current integration: **0.7.0-alpha**, based on `feat/studio-v05@632a82a`, with only
`data-dump/` imported from `data-dump/fmhy-video@3e53fb2`. Historical branches and
the original catalogue checkpoint are preserved.

## What is available

- Search, filters, title/episode/version navigation, watchlist, Continue Watching,
  real native playback progress, private episode notes, and up to five profiles.
- Charcoal and warm-ivory themes, an orange default accent, locally hosted fonts,
  responsive navigation, keyboard controls, and reduced-motion support. Existing
  saved themes and custom accents are retained.
- A shared ribbon/sun identity, readiness-driven opening animation, quiet loading
  loop and static navigation assets. The [branding studio](docs/BRANDING.md)
  documents component states, reduced motion and reproducible GIF/WebM exports.
- Restricted `/admin` import controls and `/admin/sources` research search.
  Research reviews do not enable playback. The ordinary frontend never downloads
  the research inventory or account database.
- Durable, checksummed catalogue/research import with D1 checkpoints, bounded
  Queues delivery, per-day free-plan budgets, and restart-safe progress.

The local catalogue has **8,949 titles and 134,825 episodes**. It contains 183,769
original versions and 121,116 original provider mappings, plus one explicitly
reviewed restored-silent version and two independent mappings, Internet Archive
and Wikimedia Commons. Source
coverage and current cloud-import counts are separate; see the
[release record](docs/cloud-release-checklist.md).

See the [dated review status](docs/RELEASE_STATUS.md) for current cloud counts,
verified functionality and remaining blockers; local and hosted coverage differ.

**Imported does not mean playable.** Webpage-only providers are retained but
unavailable in the native player. No iframe, ad script, sandbox bypass, open media
proxy, or episode copy is shipped. Approved connections for *The Dull Sword*
use documented metadata APIs and ordinary MP4/WebM delivery. The restored
edition is distinct from the original SUB inventory. See
[identity, rights, and playback evidence](docs/native-provider-evidence.md).

## Run locally

Use Node **24.10+** (24 LTS recommended), Git LFS, and **pnpm 11.19.0**. Clone the
private repository into a new directory; do not extract over an existing running
installation or replace newer catalogue/private data with this checkpoint.

```sh
git lfs pull
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm verify:database
pnpm build
pnpm start
```

Open `http://127.0.0.1:8787`. `pnpm dev` starts the frontend on port 5173 and its
local API. `pnpm preview` alone is not the database backend. Optional environment
settings are described in `.env.example`; copy it only if `.env` does not exist:

```powershell
# Windows PowerShell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

```sh
# macOS / POSIX shell
test -f .env || cp .env.example .env
```

Keep canonical projects, temporary outputs, and browser profiles on the project's
established storage volume. Private local accounts use `data/private/accounts.sqlite`;
operator native-source configuration is ignored by Git and must be preserved.

## Verify and maintain

```sh
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
pnpm verify:database
pnpm verify:deployment -- http://127.0.0.1:8787
python -m unittest discover -s data-dump/tests -v
python -m unittest discover -s data-dump/curated/tests -v
```

The Python inventory tools need the dependencies in `data-dump/requirements.txt`.
Browser fixtures test direct/HLS/DASH behavior and failure handling; they are not
production catalogue records or evidence of a live provider. Browsers without a
delivery capability must show a useful unavailable state, not simulated playback.

```sh
pnpm backup /absolute/private/catalogue-backups
pnpm backup:accounts
pnpm export:data
pnpm import:status
pnpm package:source --out=/absolute/private/solanime-source.zip --include-research
```

See [cloud deployment, rollback and operation](docs/CLOUD_RELEASE.md),
[catalogue import and resume](scripts/cloud-data/README.md), and
[managed authentication and legacy migration](scripts/cloud-auth/README.md).
Cloud sign-in keeps the existing interface and recovery-code flow; this release
does not send password-reset or verification email. Missing legacy private data
is not treated as a completed account migration.

Production promotion requires real catalogue playback on the deployed origin,
current integrated tests, and per-enabled-provider evidence. A successful build,
HTTP 200, or loaded video element alone does not meet that gate.

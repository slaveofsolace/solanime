# Solanime

An independently built anime catalogue and in-site player. React/TypeScript on
Cloudflare Pages, a Workers API, separate D1 catalogue/accounts/research stores,
and Firebase Spark email/password authentication. Node/SQLite remains supported
locally. No paid service or always-on personal computer is required by the hosted
application.

Current integration: **0.8.4-alpha**, based on `feat/studio-v05@632a82a`, with only
`data-dump/` imported from `data-dump/fmhy-video@3e53fb2`. Historical branches and
the original catalogue checkpoint are preserved.

## What is available

- Search, filters, title/episode/version navigation, watchlist, Continue Watching,
  real playback progress where the selected source exposes it, private episode
  notes, and up to five profiles.
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

The immutable 2026-09-18 catalogue checkpoint has **9,185 titles, 165,944
episodes, 215,331 language/version records, and 428,103 episode-provider
mappings**. Of those mappings, **423,552** contain a canonical MegaPlay embed
reference reconstructed from the completed resolver run. It also retains the
explicitly reviewed restored-silent edition and its two native connections,
Internet Archive and Wikimedia Commons. Imported mappings and canonical embed
references describe source relationships; they are not blanket playback
verification. Source coverage, player support, observed media progress, and
current cloud state are separate; see the [release record](docs/cloud-release-checklist.md).

See the [dated review status](docs/RELEASE_STATUS.md) for current cloud counts,
verified functionality and remaining blockers; local and hosted coverage differ.

**Imported or resolved does not mean playback verified.** HD-1, HD-2, and
Vidstream-2 may load their canonical provider iframe in compatible mode. The
optional desktop Guard extension provides additional filtering when active;
the ordinary website and installable web app cannot promise popup containment
inside that cross-origin player. This path does not
extract, proxy, re-host, or label the provider page as native media. Approved
native connections for *The Dull Sword* use documented metadata APIs and
ordinary MP4/WebM delivery; that restored edition is distinct from the original
SUB inventory. See the [playback contract](docs/NATIVE_PLAYBACK.md) and
[identity, rights, and native playback evidence](docs/native-provider-evidence.md).

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

Provider-embed testing should cover both ordinary browser mode and the optional
`extensions/solanime-guard` Chromium extension. The Guard is a narrow desktop
companion, not a general ad blocker or a requirement for the compatible iframe.
For Mac and iPhone web-app installation, see [install steps](docs/WEB_APP_INSTALL.md).

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

The private-site candidate adds an approval gate for *new* accounts. When
`SOLANIME_PRIVATE_SITE=true`, catalogue and watch APIs require an approved
session; when `SOLANIME_APPROVAL_REQUIRED=true`, registration creates a pending
account and does not sign it in. The operator reviews requests in `/admin`.
No email is sent for requests or decisions; the `/admin` queue is the only
notification surface, and no frontend flag grants access. See the [approval operating notes](docs/CLOUD_RELEASE.md#private-account-approval).

Production promotion requires real catalogue playback on the deployed origin,
current integrated tests, and per-enabled-provider evidence. A successful build,
HTTP 200, or loaded video element alone does not meet that gate.

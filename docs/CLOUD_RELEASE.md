# Cloud release and operation

This guide supersedes the older patch-installation instructions. Use the private
`sol/cloud-release` integration, not an unrelated historical branch. The current
application version is `0.8.4-alpha`; exact deployment and verification results
belong in [the release record](cloud-release-checklist.md).

## Hosting and privacy

```text
Browser → Cloudflare Pages (React player)
             │ same-origin /api; explicit route allowlist
             ▼ private SOLANIME_API service binding
          API Worker
             ├─ CATALOGUE D1: titles → episodes → versions → provider mappings
             ├─ ACCOUNTS D1: private profiles, revisions, sessions, recovery
             │       └─ Firebase Spark: password authentication
             ├─ RESEARCH D1: FMHY evidence and operator reviews
             ├─ approved native adapter → metadata → validated media destination
             │                                  Browser video → media host
             └─ validated stored embed → exact MegaPlay iframe URL
                                                Chromium + Solanime Guard

Minute cron → D1 due-task lookup → Queue {taskId} → leased import/refresh
                   ▲                                  │
                   └──── durable cursor + receipts ────┘
                              ▲
                 private Worker asset binding
                 (full checksummed source snapshot)
```

The hosted API does not open SQLite files or run password scrypt. Local
Node/SQLite tooling remains independently usable. There is no Firebase Hosting,
SMS authentication, billing account, AI backend, R2 dependency, or public media
proxy. Do not upgrade billing to clear an import quota.

The checked configuration uses three separate D1 bindings, not account tables in
the catalogue. Cloud database names initially end in `-preview`; retain their
stable IDs during promotion instead of duplicating the imported data. A later
separate staging environment must use separate account data and secrets.

Secrets are Worker-only: `SOLANIME_ADMIN_TOKEN`, `FIREBASE_API_KEY`,
`FIREBASE_SERVICE_ACCOUNT_JSON`, and `AUTH_CREDENTIAL_KEY`. Never use `VITE_*` for
them. Account cookies are host-only, secure, HttpOnly and CSRF-protected. Retained
Firebase refresh credentials are encrypted; catalogue exports exclude them.
See [managed accounts](../scripts/cloud-auth/README.md) for configuration,
legacy standard-scrypt imports and interrupted-operation reconciliation.

## Private account approval

`SOLANIME_PRIVATE_SITE=true` requires an approved session for catalogue,
metadata, title, episode, provider, watch, and community APIs. The SPA sends
anonymous visitors to sign-in and returns them to the requested route after
authentication. Static HTML and the sign-in assets remain public so applicants
can request access; exports and operator routes retain their separate admin-token
authorization. The Pages gateway forwards only one validated session cookie to
catalogue and playback APIs; without that forwarding, approved users would be
locked out after sign-in. Shared edge caching is disabled in private mode.

`SOLANIME_APPROVAL_REQUIRED=true` makes each *new* registration pending. Existing
account rows are marked approved by `migrations/cloud/accounts/0004_private_approval.sql`;
verify an operator can sign in before promoting the gate. A pending or rejected
account cannot create or use a session, even through a direct API request. A
new applicant must save the displayed recovery code, then await approval.

The owner notification uses the established FormSubmit AJAX destination
`slaveofsolace@gmail.com`. `/admin` remains reachable before the first account
is approved so the operator can bootstrap access; its data and actions require
the existing operator token. Review the applicant email, then approve or
decline. Approval changes the D1 state first and attempts a FormSubmit notice
with the applicant as a copy recipient; a failed notification remains visible
for retry and does not reverse the approval. The notification contains no
password, recovery code, cookie, or operator token. `sent` means FormSubmit
acknowledged the request, **not** that a mailbox delivery was confirmed. Test a
real request/approval/inbox cycle before treating email as operational.

On 2026-09-28, the first owner-approved synthetic request preceded FormSubmit
activation and returned `acceptedByTransport: false`. After the owner activated
the form and explicitly approved one fresh test, FormSubmit returned HTTP 200
and `success: "true"` in a JSON body labeled `text/html`. The client initially
reported false because it required a JSON content-type; it now validates the
parsed acknowledgement instead, with a regression test. FormSubmit accepted
the second request, and the owner confirmed that this synthetic request arrived
at `slaveofsolace@gmail.com`. An applicant approval-notice/inbox cycle remains
to be tested before calling the full email flow operational.

Apply the account migration before deploying the Worker, confirm at least one
approved owner account and the admin-token route, then run an anonymous API and
browser gate check. Rolling back the feature flags to `false` reopens public
browsing without deleting account or approval records; preserve the D1 backup
and do not roll back the schema while newer code is live. Local Node defaults
both flags to `false` in `.env.example` so existing local test workflows remain
usable until explicitly enabled.

## Reproduce a preview

Use the Node/pnpm versions in the [README](../README.md), an existing authorized
Cloudflare login, and a verified no-cost Firebase Spark project with only
email/password enabled. Review the actual Cloudflare account and resource IDs in
`wrangler.jsonc` before any remote command. Do not create duplicate resources if
the configured databases and queue already exist.

```sh
pnpm install --frozen-lockfile
pnpm cloud:types
pnpm cloud:migrate:catalogue
pnpm cloud:migrate:accounts
pnpm cloud:migrate:research
```

Prepare the complete catalogue/research snapshot and pack its immutable assets
using [the import guide](../scripts/cloud-data/README.md). Configure
`assets.directory` to the fully assembled ignored output and pin both the import
and catalogue-baseline manifests. The current candidate uses
`build/cloud-worker-assets-promoted-20260925`, containing the retained private import
package and the complete immutable catalogue baseline. Preserve all asset sets needed by
unfinished jobs. Files are bounded under the
platform's per-asset limit; they never enter the Pages `dist` directory.

Set the four secrets through private Wrangler secret input. Never paste their
values into a checked-in shell script, release document, or terminal transcript.
Then:

```sh
pnpm check
pnpm cloud:deploy:api
pnpm cloud:deploy:preview
pnpm verify:deployment -- https://cloud-release.solanime.pages.dev
```

The Pages helper runs from `cloud/pages`, selects the reviewed account via the
environment, and uses that directory's default Wrangler configuration. Pages
does not accept a Worker-style `account_id` field or an arbitrary `--config` path.
Do not deploy from the root Worker configuration. Preview authentication is
allowlisted for the stable branch origin, not every immutable deployment URL.
Use the stable branch URL for account and playback acceptance.

## Start, pause and resume imports

After privately supplying `SOLANIME_ADMIN_TOKEN` in the current shell:

```sh
pnpm cloud:control start --origin=https://cloud-release.solanime.pages.dev
pnpm cloud:control status --origin=https://cloud-release.solanime.pages.dev
pnpm cloud:control refresh --origin=https://cloud-release.solanime.pages.dev
```

`start` verifies the deployed manifest and creates an idempotent D1 snapshot job.
Queue messages contain only task IDs. Lease checks reject duplicates and stale
workers; each committed batch has a content-hash receipt and a durable cursor.
Minute cron redispatches due work. The computer may be shut down after the
private assets and job have been deployed successfully.

`refresh` starts or reuses a public-source refresh. It returns an explicit
`snapshot_pending` checkpoint until the full pinned snapshot has finished.
Subsequent daily UTC refreshes reconcile catalogue pagination, sitemaps, title
metadata, episode/version inventories and provider options. An operator pause,
quota exhaustion or explicit upstream refusal remains authoritative; the worker
does not bypass access conditions or delete good records after failed requests.

Use `/admin` with the operator token for a specific run's Pause, Resume or bounded
Retry failed control. Tokens remain in memory and are cleared by Lock screen or
refresh. A manual nudge, if needed, is:

```sh
pnpm cloud:control dispatch --origin=https://cloud-release.solanime.pages.dev
```

Do not repeatedly dispatch a quota-paused job. The shared catalogue/research
ledger reserves at most 75,000 written rows and 2,500 queue operations per UTC
day, leaving capacity for the application and other account usage. Index and
control writes count. Successful measured D1 write costs settle conservative
reservations; uncertain outcomes retain their charge. Work resumes in the next
eligible window, not by bypassing the quota or purchasing a plan. Cloudflare's
account-wide quota may pause work earlier when other projects consume capacity.

The dispatcher keeps another 1,500 written rows and three queue operations of
headroom before sending a delivery. `dispatchAllowance` in restricted status
responses explains this earlier pause and its next UTC retry time; an unchanged
task cursor is not itself a failed import. The operator screen uses that effective
retry time instead of presenting the task's older due time as a stalled job.

The full manifest has no hidden title cap. Initial bootstrap counts, full local
counts and completed cloud counts must not be added together. Priority upserts
overlap deliberately. Metadata-only related-title records are not complete
episode libraries; unavailable or unimported mappings are not playable sources.

## Player acceptance

### Provider embeds and optional Desktop Guard

HD-1, HD-2, and Vidstream-2 mappings are eligible only when the database row has
an exact canonical `https://megaplay.buzz/stream/s-2/...` reference. The API
reconstructs and compares the provider, mapping identity, and resource path; it
does not accept an arbitrary caller URL. The current compatible provider iframe
has **no `sandbox` attribute**: the provider refused the former sandbox. A
loaded frame does not prove video progress, and the ordinary website cannot
block popups or redirects initiated inside that cross-origin frame. The page
states this limitation instead of labeling the mode a built-in guard.

An active `extensions/solanime-guard` handshake selects the optional desktop
mode; changing modes remounts the frame and discards its opaque playback state.
That extension is not available in an ordinary iPhone/Android webpage or PWA and
does not satisfy the requested no-extension phone protection. The content policy
admits only YouTube's privacy-enhanced host and MegaPlay's exact HTTPS host.
See [the mobile player checkpoint](MOBILE_PLAYER_CHECKPOINT_20260928.md) for
separate Android popup and iPhone playback observations.

The optional desktop Guard blocks provider-origin top-level navigation and
closes navigation targets created by the approved provider frame. It does not
rewrite media, extract temporary URLs, proxy traffic, or make an unsafe source
safe by label. Without it, do not claim popup containment on mobile or desktop.
Run its exact Chromium acceptance before any provider claim:

```sh
pnpm exec playwright install chromium
pnpm test:guard
```

For a real mapping, verify the selected database mapping and provider shown in
the UI, a stable parent URL, no unexpected pages, and actual video progress.
An API `200`, iframe load, or Guard test by itself is not media-playback evidence.
Test with and without the optional desktop Guard as distinct modes. In the
no-extension campaign, record any popup or redirect as a protection failure;
do not claim a built-in blocker. The adversarial fixture tests exercise popup
and navigation attempts independently of real provider playback. Test the
frame's actual video/time progression, not only provider messages. Silence
before a user presses Play is not a provider failure; the source must remain
selectable after the waiting notice appears.

### Native media

Test an actual imported identity, not fixture media. The currently approved
restored-silent film is:

```text
/title/the-dull-sword-uhfkd
/watch/the-dull-sword-uhfkd/58614?language=silent
title 3881 / episode 58614 / version 183770
mapping 121117: internet-archive / namakura-gatana-1917
mapping 121118: wikimedia-commons / reviewed restored-edition File title
```

Use the page's controls to play, observe time progressing, seek, pause, refresh,
resume, switch episode/version, and leave the player. Record duration and times,
verify old media is stopped, inspect browser errors and unexpected navigation,
and capture desktop/mobile screenshots. This silent edition has no captions;
do not invent subtitles to satisfy a checklist. HLS/DASH and caption behavior
are additionally tested with deterministic fixtures on capable browsers.

The [provider evidence](native-provider-evidence.md) documents the reviewed
identity, public-domain source chain, normal metadata/HEAD flow, direct-video
CORS behavior and precise scope. Other provider labels remain unsupported unless
their own validated native or Guarded-embed connection exists. A canonical
stored embed is not a native source.

For bounded resolution-only diagnostics (no temporary URL is printed):

```sh
node scripts/verify-native-resolution.mjs --origin=https://cloud-release.solanime.pages.dev --mapping=121117 --language=silent
```

After actual browser observation, record a private JSON object with `mappingId`,
`language`, a checked-in `evidenceRef`, and numeric `progressFrom`, `progressTo`,
`duration`, `seekFrom`, `seekTo`, and `restoredTime`. This command validates and
records operator evidence; it does not perform or manufacture the browser test:

```sh
node --import tsx scripts/record-native-verification.ts --input=/absolute/private/native-observation.json --origin=https://cloud-release.solanime.pages.dev --local-db=/absolute/private/solanime.sqlite --confirm-observed
```

Only the exact approved mapping receives a playback timestamp. A corresponding
canonical research capability receives the same scoped evidence if that record
has been imported. No alias, shared hostname, or untested episode is certified.

## Production promotion and rollback

Before promotion, require all of the following:

- Current source/type/API/data tests and browser acceptance pass.
- Frontend and API versions match on the stable preview origin.
- A real catalogue episode progresses in its supported Solanime player mode;
  every enabled provider has its own dated evidence. Native media and guarded
  provider embeds remain separate capabilities. Loaded elements and HTTP 200
  responses do not count as playback.
- Registration/login, profile isolation, private recovery, API authorization,
  public private-asset denial and import pause/resume have been checked live.
- Review the exact staged/outgoing source and archive contents; keep account
  data, credentials and private import assets out of the source package.

Configure `env.production.services` in the Pages config to the tested API Worker,
allow the exact production origin in the API account/origin configuration, and
retain preview access for verification. Deploy the API first, then the same tested
frontend artifact without rebuilding between preview and promotion:

Keep the existing Worker service name and bindings; do not create a separate
Worker with `--env production`. Verify the Pages project's production branch is
`main`. Set `SOLANIME_APP_ORIGIN` to `https://solanime.pages.dev` and retain only
the exact intended branch alias in `SOLANIME_ALLOWED_ORIGINS`. Host-only cookies
require a new sign-in on the canonical origin. Guest browser state does not
migrate across origins. After promotion the preview alias shares the production
databases and must not be used as an isolated destructive test environment.

```sh
node scripts/deploy-pages.mjs --branch=main --promote-verified-release
pnpm verify:deployment -- https://solanime.pages.dev
```

To promote an already-tested build outside `dist`, add
`--directory=/absolute/path/to/reviewed-build` to both preview and production
commands. The helper rejects a build whose release metadata differs from
`package.json`. Keep that exact directory unchanged between preview and promotion.

The 0.8.2 account integration additionally uses optional server-only MAL settings
and an additive accounts migration; see [MyAnimeList](MYANIMELIST.md). Missing MAL
application registration disables connection, not ordinary Solanime sign-in.

Repeat the real native playback and account smoke checks on production. Record
the Pages deployment ID, Worker version ID, source commit and artifact hashes.
If a release gate fails, keep the preview and completed local work but do not
promote production.

For code rollback, preserve D1 data, encryption secrets, queue cursors and private
asset pins. Use the previous known-good **compatible** Worker version:

```sh
pnpm exec wrangler rollback VERIFIED_WORKER_VERSION_ID --yes
```

Choose the matching known-good Pages deployment in Cloudflare's Pages deployment
history and use **Rollback to this deployment**. Verify the canonical origin
again. The pre-integration frontend is historical recovery evidence, not a
working API fallback. Rolling back frontend code cannot restore deleted account
data or undo a schema migration; do not run destructive down-migrations.
Pages rollback targets must be production deployments, not preview IDs. Likewise,
a preview-only-origin Worker is not a compatible canonical rollback. D1 rollback
does not roll back Firebase passwords or account deletions; avoid account-data
restoration as a code-release rollback.

## Backup and restore

Keep catalogue, research and private account backups separate. For a consistent
local snapshot, use `pnpm backup /absolute/private/catalogue-backups`; it includes
committed WAL data. `pnpm backup:accounts` uses its separate private store.

```sh
pnpm exec wrangler d1 export CATALOGUE --remote --output /absolute/private/catalogue.sql
pnpm exec wrangler d1 export RESEARCH --remote --output /absolute/private/research.sql
pnpm exec wrangler d1 export ACCOUNTS --remote --output /absolute/private/accounts.sql
```

Never publish the third export. Retain the encryption secret and exact Firebase
project/UID ownership with the private recovery procedure. Firebase password
state is not part of a D1 export. For large data restoration into a fresh D1
database, use migrations and the quota-aware source snapshot job rather than
bulk-executing every SQL file beyond the free daily allowance.

To test a local catalogue restore, set `SOLANIME_DB_PATH` to a new, unused
absolute path in the current shell, then run:

```sh
pnpm restore /absolute/private/catalogue-backup.sqlite
pnpm verify:database
```

Only restore over an existing database after stopping its exact API/import
writers and taking backups. The explicit `--replace` option preserves the old
database and sidecars as a pre-restore backup; do not use a blanket filesystem
cleanup command. Neither source ZIP extraction nor Git LFS checkout is a safe
replacement procedure for a live private database.

## Platform references

Checked against current [Pages environment configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/),
[private Worker asset bindings](https://developers.cloudflare.com/workers/static-assets/binding/),
[D1 free-plan limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and
[Firebase Spark pricing](https://firebase.google.com/pricing).

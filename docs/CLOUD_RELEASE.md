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
stable IDs during promotion instead of duplicating the imported data. The checked-in
Pages preview (`cloud-release`) configuration targets a separate
`solanime-api-staging` Worker with isolated databases, queue, Firebase project and
secrets. Provisioning that environment is incomplete; configuration alone is not
evidence of a deployed staging service. See
[production and staging separation](CLOUD_ENVIRONMENTS.md) for the bindings and
the migration steps.

**2026-10-01 read-only deployment checkpoint.** Production still serves the
previous frontend from source `acbc4dd`, Pages deployment
`453a3e2e-c212-4944-b96f-cba1568679fb`. The UI candidate extending `0bb17b5`
has not been deployed. Production `verify:deployment` passed all five checks and
`verify:private-approval` passed all eight anonymous checks. These checks establish
the observed version, frame policy and anonymous account boundary, not new
authenticated or native-playback acceptance. The active production Worker is
`95263948-dbd5-431b-9f06-5df2a3f61525` at 100%, with both approval flags enabled
and only `https://solanime.pages.dev` allowed as the application origin.

The configured staging Worker is absent (Cloudflare error `10007`), and its D1,
queue and Firebase setup is incomplete. The old preview alias still reports
`channel: production`; it is not an isolated test environment. Its current
deployment verification fails the exact frame-host check, and the anonymous
approval verifier receives HTTP 403 rather than its expected 401 for resolve.
Do not reconnect the preview to production to bypass staging setup. The
production-promotion gates below remain in force; this audit made no deployment
or data changes.

**2026-10-01 isolated staging provisioning.** The owner enabled Workers Paid;
three dedicated staging D1 databases and the staging queue were created after
private production exports. Firebase `solanime-staging` uses Email/Password
and a dedicated recovery identity limited to `firebaseauth.users.update`.
The staging Worker dry-run passed, followed by deployment of
`5a07a1bb-2eb6-4af4-bfa3-9ae1e9afc6d7`. Registration remains closed; private-site
and approval flags remain true. Its 12,613 private assets are a verified earlier
local catalogue snapshot, not a production clone, and lack mapping 384944.
This supersedes the staging-absent observation above; Pages preview and live
account acceptance are verified separately. No production promotion or native
release follows from this provisioning result.

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

No email is sent for account requests or decisions, so no third-party mail
relay receives applicant addresses. `/admin` lists pending requests; it remains
reachable before the first account is approved so the operator can bootstrap
access, and its data and actions require the existing operator token. Review
the applicant email, then approve or decline. An approved applicant finds out
by signing in. (Earlier releases relayed notices through FormSubmit; that path
was removed on 2026-10-03.)

Apply the account migration before deploying the Worker, confirm at least one
approved owner account and the admin-token route, then run an anonymous API and
browser gate check. Rolling back the feature flags to `false` reopens public
browsing without deleting account or approval records; preserve the D1 backup
and do not roll back the schema while newer code is live. Local Node defaults
both flags to `false` in `.env.example` so existing local test workflows remain
usable until explicitly enabled.

### Existing Worker with private assets absent from the checkout

`pnpm verify:private-approval -- https://solanime.pages.dev` checks the deployed
session flags and anonymous catalogue, metadata, provider, and resolve routes.
It must pass before describing the application as owner approved. A release
version string alone does not establish this boundary.

If the pinned `build/cloud-worker-assets-*` directory is absent, do not run
ordinary `wrangler deploy`: it cannot safely replace the complete private asset
set. `node scripts/cloud-approval-promotion.mjs plan` makes a read-only comparison
of the active Worker bindings, verifies a health canary that reads the pinned
private baseline through `IMPORT_ASSETS`, and bundles the current source locally.
Review the ignored `build/cloud-approval-promotion/plan.json`. It contains binding
names and a source digest, not credential values. The plan requires the latest
uploaded Worker version to equal the active reviewed version, then uses
Cloudflare's `keep_assets: true` with strict `latest` binding inheritance.
The uploaded bindings are compared exactly with the reviewed version. Version
URLs are disabled for this Worker, so the
new version cannot be treated as tested merely because upload succeeds.

After reviewing the exact plan and current branch, upload and then deploy with
the active version ID and bundle SHA-256 printed by the plan:

```sh
node scripts/cloud-approval-promotion.mjs upload --apply --expect-current=<reviewed-version-id> --expect-bundle=<reviewed-sha256>
node scripts/cloud-approval-promotion.mjs deploy --apply --expect-current=<reviewed-version-id> --expect-bundle=<reviewed-sha256>
```

The upload creates a version without traffic and compares its bindings and asset
routing with the old version. Deployment runs the anonymous gate check and the
same private baseline canary. On either failure, the script redeploys the
previous version. An operator can also roll back explicitly with
`pnpm exec wrangler versions deploy <previous-version-id>@100% --name solanime-api-preview --yes`.
Keep version IDs and canary results in the release handoff; never copy Wrangler
OAuth tokens, account emails, recovery codes, or profiles into it.

**2026-09-29 15:20 CDT approval-gate repair.** Before the repair, the active
Worker version was `9f8088b8-3619-4b13-bca1-d8c0450dd0fd`. It had 25
bindings, lacking exactly `SOLANIME_PRIVATE_SITE` and
`SOLANIME_APPROVAL_REQUIRED`; the deployed session response lacked both flags,
and anonymous titles, filters, and providers all returned HTTP 200. All remote
account migrations were applied. A read-only count found two approved account
rows; this does not identify whether both had owner review.

`node scripts/cloud-approval-promotion.mjs plan` bundled the current Worker at
SHA-256 `df60116b5a98a160f299b20cea309c972b8a2e62a4b31653d0c9d9c18a7c6578`
(1,049,008 bytes). The plan inherited 25 existing bindings, added the two gate
flags as `true`, retained the private asset set, and recorded the baseline-backed
health canary SHA-256
`1372afce0f38b1626209d83d5fd3c3186c793e0d9549ec62c4ca8ad6a558dce7`.
Cloudflare rejected an initial non-serving upload using explicit UUID binding
inheritance with HTTP 400/code 10057: this API accepted only `version_id: latest`.
After adding a guard that the latest uploaded version equaled the active reviewed
version, these commands succeeded:

```sh
node scripts/cloud-approval-promotion.mjs upload --apply --expect-current=9f8088b8-3619-4b13-bca1-d8c0450dd0fd --expect-bundle=df60116b5a98a160f299b20cea309c972b8a2e62a4b31653d0c9d9c18a7c6578
node scripts/cloud-approval-promotion.mjs deploy --apply --expect-current=9f8088b8-3619-4b13-bca1-d8c0450dd0fd --expect-bundle=df60116b5a98a160f299b20cea309c972b8a2e62a4b31653d0c9d9c18a7c6578
pnpm verify:private-approval -- https://solanime.pages.dev
```

Uploaded and active Worker version: `67aa15e8-b169-40a7-b6ba-eb07e9f0617d`
at 100%. Its 27 bindings and private asset routing matched the plan; the health
canary digest remained unchanged. The guarded deployment reported all anonymous
approval checks passing. One immediate independent check briefly returned HTTP
200 for `/api/titles?pageSize=1` while the other protected routes returned 401,
consistent with rollout propagation. Ten subsequent title requests and three
serial checks returned HTTP 401; a fresh verifier run passed all eight checks.
This establishes the observed anonymous gate at the tested edge, not an
approved/pending user-cycle test or native app release. No Pages assets were
changed by this Worker repair.

**2026-09-29 16:09 CDT preview UI deployment.** After the account, mobile
viewing, episode-label, splash, compact Library, and catalogue-filter fixes,
`pnpm check` passed 105 test files / 889 tests, typecheck, and Vite build.
Focused mobile WebKit account, watch, catalogue-filter, and splash recovery
checks passed. The splash artwork no longer intercepts the recovery controls. The
exact command `node scripts/deploy-pages.mjs --branch=cloud-release` deployed
the revised frontend to `https://f923b8ce.solanime.pages.dev`, with stable
alias `https://cloud-release.solanime.pages.dev`. The alias served
`/assets/index-DZS_Ltcq.js` and `/assets/index-Drq2TriB.css`.
`pnpm verify:deployment -- https://cloud-release.solanime.pages.dev` passed
the frontend/API release and frame-policy checks, and
`pnpm verify:private-approval -- https://cloud-release.solanime.pages.dev`
passed all eight anonymous checks. Cloudflare's first alias read briefly
returned the previous asset hashes after deployment; a fresh request then
returned the new hashes. No `main` Pages deployment was made. These checks
do not establish approved-account login or physical iPhone video progress.

The restricted `/admin` console now places account requests and failed email
notices above import diagnostics. Its pending, approval, decline, and retry UI
passed three focused local tests. The live preview entry screen displayed the
operator-token form; an anonymous `GET /api/admin/accounts/pending` returned
HTTP 401. No operator token was entered during this readback, so a live
authenticated queue action and mailbox delivery remain unverified. The
previously requested account was approved by exact remote D1 readback as
recorded in the native handoff; applicant notification was not verified.

**2026-09-30 13:33 CDT iPhone presentation preview.** The signed iPhone host
marks only its first-party main document with `solanime-native-ios`; the new
stylesheet and four-destination tab bar do not activate in the website/PWA or
provider frame. The design uses system type, safe areas, consistent grouped
surfaces, readable controls, and a restrained Solanime accent. The updated
native loading/error surfaces are compiled into locally signed Debug build 5.
`pnpm check` completed with 105 files / 891 tests plus typecheck and Vite build;
`tests/e2e/native-ios-ui.spec.ts` passed in mobile WebKit and Chromium (2/2)
with dark/light WCAG A/AA title-screen checks. Browser screenshots and Xcode
logs are local ignored artifacts; no account or device identifier is in Git.

The exact command `node scripts/deploy-pages.mjs --branch=cloud-release`
deployed the frontend to `https://67d2f39a.solanime.pages.dev`, alias
`https://cloud-release.solanime.pages.dev`. Local `dist` and alias readback
agreed on `assets/index-CTfZ1oId.js` and `assets/index-BrrNoOo3.css`.
`pnpm verify:deployment -- https://cloud-release.solanime.pages.dev` passed
frontend/API version and frame-host checks, and
`pnpm verify:private-approval -- https://cloud-release.solanime.pages.dev`
passed all eight anonymous checks. The Worker gate version did not change and
production Pages was not promoted. The app install attempt failed before
transfer because the paired iPhone was disconnected (CoreDevice 4016); the
candidate's on-device appearance and physical-video acceptance remain open.

**2026-09-30 15:18 CDT iPhone UX preview update.** Build 7 was subsequently
signed, installed, and launched on the iPhone 16 Pro; its verified WebKit host
allows eligible PiP/AirPlay and retains the popup/navigation protection. The
latest iPhone-first frontend has a shorter full-art Home hero, adjacent carousel
indicators, lateral feature transitions, grouped Settings and profile controls,
and a slower coordinated splash. `pnpm check` passed 106 files / 895 tests plus
typecheck/build; `tests/e2e/native-ios-ui.spec.ts` passed mobile WebKit 1/1.
The preview deploy command above produced immutable
`https://e19e0c1c.solanime.pages.dev`; the stable alias and local `dist` both
served `assets/index-DqP40ye8.js` and `assets/index-7PN-gExF.css`.
`pnpm verify:deployment -- https://cloud-release.solanime.pages.dev` passed;
`pnpm verify:private-approval -- https://cloud-release.solanime.pages.dev`
passed eight anonymous checks, with catalogue, filters, providers and resolve
returning 401. The API Worker and production Pages were not changed. The paired
iPhone became unavailable to `devicectl` after the build-7 installation, so
the exact latest frontend and real protected video remain unverified on device.
The release is still gated; see the newest checkpoint in the native handoff.
At 15:38 CDT the paired iPhone reconnected and `devicectl` read back build 7.
The protected watch page for requested mapping `384944` opened in Mirroring,
but Play input and video-frame verification remained incomplete; the newest
native handoff records the exact blocker. The preview deployment and release
gate status above did not change.

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

Configure `env.production.services` in the Pages config to the tested production
API Worker and allow the exact production origin in that Worker's account/origin
configuration. Keep preview verification on its separate staging Worker and
origin. Deploy any reviewed API changes before the frontend, then promote the
same tested frontend artifact without rebuilding between preview and promotion.
An accepted frontend-only update does not require an unchanged API redeployment.

Keep the existing Worker service name and bindings; do not create a separate
Worker with `--env production`. Verify the Pages project's production branch is
`main`. Set production `SOLANIME_APP_ORIGIN` and `SOLANIME_ALLOWED_ORIGINS` to
`https://solanime.pages.dev`; staging uses its own exact branch origin. Host-only cookies
require a new sign-in on the canonical origin. Guest browser state does not
migrate across origins. Historically, the promoted preview shared production
databases; the stale preview still has that legacy binding at the 2026-10-01
checkpoint. It must not be used for destructive testing. Completing the staging
migration must preserve isolation during subsequent production promotions.

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

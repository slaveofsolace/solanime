# Release verification: 0.7.0-alpha

Application baseline: `feat/studio-v05@632a82a`. Research baseline:
`data-dump/fmhy-video@3e53fb2`, importing only `data-dump/`. The canonical
checkout and historical branches remain preserved. This record describes an
alpha with an incomplete hosted import, not a complete streaming library.

## Release state

- Asynchronous Workers/D1 catalogue, accounts and research repositories implemented.
- Firebase Spark email/password bridge, secure sessions, recovery, profile
  isolation and private migration tooling implemented. No legacy account file
  was supplied; a real legacy-account migration is not claimed.
- Durable Queue imports, checksummed private assets, bounded retries, atomic
  identity checks, operator pause/resume and next-UTC quota resumption implemented.
- Netflix-inspired Solanime navigation, artwork-led home, title previews, browsing,
  private library, watch controls, notes, themes and compact readiness states built.
- Earlier preview playback passed for both enabled native providers; the dated
  measurements below cover one film, not the original commercial catalogue.
- The current app/API and separate brand studio are deployed for review.
  **Production remains unchanged**; canonical-origin acceptance and final
  outgoing-publication review are not implied by these preview checks.

## Current review deployments

Verified on 2026-09-12 against the served files, not just the shared version label:

| Surface | Review deployment | Verification |
| --- | --- | --- |
| [Application](https://cloud-release.solanime.pages.dev) | [1c30bac1](https://1c30bac1.solanime.pages.dev) | All 38 served static files match the local SHA-256 values. Entry assets: `index-DXoZ09mO.js` and `index-DIy0wi3h.css`. |
| API Worker | `4cf59055-0fa4-4736-905d-585d11345a00` | Workers JSON health, schema 11, protected APIs and database-backed workflows passed. |
| [Brand studio](https://branding-motion.solanime.pages.dev/branding) | [01582826](https://01582826.solanime.pages.dev/branding) | All 15 served studio files match the local SHA-256 values. |

The application hash receipt was captured at 21:51 UTC; the studio receipt at
21:56 UTC. `review-deployed-20260912.json` and
`branding-review-deployed-20260912.json` retain the per-file checks in the private
release artifacts. No promotion to `https://solanime.pages.dev` occurred in this
review-deployment step. Historical failed runs and earlier deployment IDs remain
diagnostic evidence, not the current release result or a rollback certificate.

## Data coverage

| Scope | Titles | Episodes | Versions | Provider mappings |
| --- | ---: | ---: | ---: | ---: |
| Local catalogue, 2026-09-12 | 8,949 | 134,825 | 183,770 | 121,118 |
| Hosted checkpoint, 21:56 UTC | 3,521 | 368 | 599 | 1,764 |

The local title denominator is the discovered public union: 8,913 filter-discovered
records plus 36 sitemap-only records, reconciled across 293 sitemap children.
This is not a claim about the operator's private database or undiscovered records.
The mapping total is **121,116 original source relationships plus two independently
reviewed external native mappings**; the added silent edition is a separate
version. There are no duplicate natural keys or foreign-key errors.

The retained original ingestion has 96,339 unfinished episode-server tasks:
96,338 pending and one expired running lease. The earlier writer check found no
ingestion process.
All 144,397 durable tasks and 2,025 historical coverage rows were preserved;
coverage row 2,026 was appended. The exact resume command is:

```sh
pnpm import:anikoto -- --mode=full --run-id=2
```

At the 21:56 UTC checkpoint, the cloud full-snapshot job has committed 111 of
28,364 batches; 28,253 remain. Run/task `1000000001` retains its durable cursor;
the API reports two pending tasks overall, with one task representing this
snapshot's remaining batches.
The full manifest contains 876,362 row occurrences, including deliberate overlap,
not that many unique catalogue records. Bootstrap and priority-import counts must
not be added to full counts. The shared budget is 73,991 reserved written rows
of 75,000 and 174 queue operations of 2,500. Dispatch is `quota_paused` because
its 1,500-row safety headroom no longer fits. Its next eligible window is
**2026-09-13 00:00 UTC**. The private Worker assets and durable job are deployed;
resumption does not require this computer. Actual next-window advancement has
not yet been observed. Source refresh waits for this snapshot: the live refresh
check returned 202 `snapshot_pending` without changing its cursor. No dispatch,
quota increase or ingestion restart was used for verification.

The complete local research database contains 1,667 sites, 33,671 normalized
records and 81,773 relationships. All **1,667/1,667 canonical sites** are also
available in the restricted cloud source browser via the completed 117-batch
priority import. Detailed evidence/relationship collections remain part of the
unfinished full cloud snapshot. Research observations never enable playback.

The local catalogue is `data/solanime.sqlite`, migration 8. Read-only structural
checks reconfirmed zero foreign-key, duplicate-natural-key or native-resource
ownership errors. Its previously checkpointed main-file SHA-256 is
`70010385d696b0d039ab0d0bd0a24297451192bceb4861050035595bfa8ff9a6`.
The consistent private backup restored successfully with SHA-256
`9b0de136807a893635dee13fa85eb17c23abd373ea36c406c3816496714ed11f`;
the physical files differ, but verified rows, history and task identities agree.
Tracked JSON/CSV exports exclude private account, worker and temporary-resolution
fields. Use the separate backup manifest for restoration, not a source ZIP.

## Native playback

The exact real catalogue path is
`/watch/the-dull-sword-uhfkd/58614?language=silent`: title 3881, episode 58614,
version 183770, the reviewed restored-silent edition of the 1917 film.
Rights, identity and host evidence are in [the provider register](native-provider-evidence.md).

| Provider / mapping | Implemented connection | Earlier deployed result, 2026-09-12 |
| --- | --- | --- |
| Internet Archive / 121117 | Public item metadata → bounded validated HEAD redirects → direct MP4 | Progress 191.945340 → 208.404359 s; seek 209.832374 → 199.832374; refresh restored 199.832374. Duration 258.856054 s. |
| Wikimedia Commons / 121118 | Exact File title + pinned SHA-1 + public rights metadata → validated original WebM | Progress 199.844602 → 226.356163 s; seek 227.869370 → 217.869370; refresh restored 217.869370. Duration 258.8 s. |

These earlier checks ran on the deployed Netflix-style preview, recorded at
19:54:17 UTC for Archive and 19:55:17 UTC for Commons. They are not certification
of the final branded review artifact or canonical production. Both providers
used the native video element, with no iframe, no media error and no unexpected navigation.
Switching Archive → Commons retained 199.832374 s; switching back retained
217.869370 s. Only one video element remained. Browser warning/error logs were
empty. The transient-resolution-retry switch case is additionally covered by
cross-browser deterministic tests; it was not artificially injected upstream.
Only these two mappings receive playback-verification timestamps. This silent
edition has no captions; no live HLS/DASH provider is claimed from fixture tests.

A separately dated receipt is required for final branded-preview playback. An
API capability record, player load or SPA HTTP 200 response does not establish
media progression on that deployment.

| Original observed provider | Local mappings | Native state |
| --- | ---: | --- |
| HD-1 | 48,477 | Webpage relationship retained; no verified supported native flow. |
| HD-2 | 23,783 | Separate button/mappings retained; no verified supported native flow. |
| Vidstream-2 | 48,856 | Webpage relationship retained; no verified supported native flow. |
| Kiwi | 0 | Inventory-only observation; no mapped native resource. |
| VidPlay-1 | 0 | Inventory-only observation; no mapped native resource. |

MegaPlay is an observed backend relationship, not an invented sixth visible
server. No captured temporary URL, metadata endpoint, scraped iframe declaration
or unrelated clip is represented as a supported commercial episode connection.
The [current MegaPlay investigation](provider-investigation-current.md) separates
provider-origin playback, the standalone source-request refusal, and the still
unverified Solanime-native connection; it does not declare every embed impossible.

## Verification commands

- `pnpm check`: TypeScript passed, **481/481 tests across 42 files passed**,
  production build passed. HLS/DASH remain lazy chunks; the build reports their
  size warning, not a failing check. `pnpm-check-review-current.log` records the
  build with the entry assets listed above.
- Final full browser matrix: **192 passed, 8 intentional skips, zero failures**
  across desktop/mobile Chromium and WebKit, exit 0, in 4.0 minutes
  (`playwright-review-current.log`). The skips are device-specific desktop/touch
  geometry contracts, not failed playback tests. Earlier failing attempts and
  smaller passing subsets are superseded for this candidate, not erased.
- FMHY Python suites rerun with `python -B -m unittest discover -s data-dump/tests -v`
  and `python -B -m unittest discover -s data-dump/curated/tests -v`: **17/17 and
  10/10 passed**, respectively.
- Database integrity, schema 8, foreign keys, duplicate detection, private-field
  export checks, online backup restoration and main-file-only restoration passed.
- Current preview runtime verification: **42 bounded requests passed** at
  21:54:49–21:55:00 UTC (`cloud-runtime-review-current.json`), including JSON health,
  unauthorized admin 401, private import assets 404, all 1,667 paginated canonical
  sites, bounded evidence-fragment checksum/exhaustion, and the refresh barrier.
  Pause/resume restored the original queued run, global enabled setting and
  cursor 111. Native-capability checks read existing mapping-specific evidence;
  this HTTP verifier does not play media.
- Current preview managed-account QA: **34/34 passed** at 21:55:14–21:55:22 UTC,
  including concurrent profile limits, isolation, cookie/CSRF controls, revision
  conflicts, recovery and revocation.
  Exactly two disposable identities were created and deleted, with no overlapping
  auth run. An independent read-only check confirmed zero matching Firebase QA
  identities on a complete response and zero D1 QA accounts/active/pending rows.
  `auth-review-current.json` and `auth-cleanup-review-current.json` retain dated,
  redacted results. Account restoration does not block public catalogue rendering.
- `node scripts/verify-deployment.mjs https://cloud-release.solanime.pages.dev`:
  matching frontend/API 0.7.0-alpha, JSON health, native-only frame policy passed.
  This version/header check is supplemented by the exact served-file hashes above.

`review-runtime-auth-manifest-20260912.json` binds the current review deployment,
runtime/authentication receipts and partial hosted counts with SHA-256 hashes.
The receipts retain neither account identities nor credentials; private browser
evidence remains outside the release publication set. No canonical-production
auth or playback acceptance is claimed by these preview results.

Visual checks covered desktop, laptop, tablet and 320px layouts in both themes,
with keyboard/focus, reduced motion, deep links, loading failures and artwork
fallbacks. At a 320px viewport with a classic scrollbar, client width and document
scroll width are both 305px. Missing source artwork remains a labelled fallback;
poster crops are a visual deviation from Netflix's separately commissioned
landscape artwork. Public episode comments are not claimed: notes remain private.

See [cloud operation and rollback](CLOUD_RELEASE.md), [architecture](ARCHITECTURE.md)
and [documentary demonstration](DOCUMENTARY_OUTLINE.md). Screenshots and exact
review-artifact hashes accompany the handoff. The final source commit,
canonical-production deployment and compatible rollback IDs must be recorded only
after those separate publication and promotion steps occur.

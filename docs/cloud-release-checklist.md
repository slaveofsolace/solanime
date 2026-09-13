# Release verification: 0.7.0-alpha cloud baseline candidate

Application baseline: `feat/studio-v05@632a82a`. Research baseline:
`data-dump/fmhy-video@3e53fb2`, importing only `data-dump/`. The integration lives
on `sol/cloud-release`; historical branches and the canonical data checkout remain
preserved.

## Current candidate

- Workers/D1 repositories separate catalogue, account/profile, and operator
  research data.
- Firebase Spark email/password authentication is bridged through secure,
  host-only cookies with CSRF, recovery, revocation, revision-conflict, and
  profile-isolation contracts.
- Durable Queue synchronization uses D1 task IDs, leases, receipts, bounded
  retries, request budgets, and next-window quota resumption.
- The immutable Worker-only catalogue baseline lets normal browse/title/episode/
  mapping APIs serve the full completed local snapshot immediately while D1
  retains fresher overlays and operator state.
- The frontend uses the supplied Netflix/Cinejoy hierarchy: a conventional
  masthead, full-bleed feature art, dense landscape rails, compact episode access,
  restrained controls, and responsive bottom navigation.
- The old review deployment remains historical evidence until the new candidate
  is deployed and separately verified. `https://solanime.pages.dev` is not being
  promoted as part of this pre-deployment record.

## Data evidence

| Scope | Titles | Episodes | Versions | Provider mappings |
| --- | ---: | ---: | ---: | ---: |
| Completed SQLite checkpoint | 8,949 | 134,825 | 184,073 | 423,236 |
| Immutable Worker baseline | 8,949 | 134,825 | 184,073 | 423,236 |

- Source database: `catalogue-final-20260913T064052Z.sqlite`, 492,740,608 bytes.
- Source SHA-256/baseline ID:
  `2ac4cd16f061cab1cb44cec53595f84661573b5b906b9a93be608ef9c5d2cc4e`.
- Schema version 10; `PRAGMA integrity_check` is `ok`; foreign-key violations,
  structural duplicates, and orphaned rows are zero.
- All 144,397 crawl tasks are complete. The task table records 144,532 attempts
  and has no pending, running, retry, or failed work.
- Forty titles without episodes reconcile exactly with forty explicit empty
  observations. Failed requests were not converted into deletions.
- 5,758 versions have no mappings: 4,882 sub, 860 dub, and 16 unknown. They remain
  unavailable without destructive normalization or a fabricated provider.
- Baseline manifest: 13,791 payload files, 636,631,933 payload bytes, bucket spans
  16 title / 256 browse / 64 episode / 256 mapping. Combined staged Worker asset
  count is 15,312. Manifest SHA-256:
  `5bc07b44dd00a9b8fe7a358c184a4ccab7798087620facdb76ff8886c6e93a2d`.

The title count is coverage of the reconciled discoverable public union, not a
claim that an operator's private database or undiscovered records were obtained.
FMHY research observations remain restricted evidence and never enable playback.

## Provider evidence

The exact approved catalogue route is
`/watch/the-dull-sword-uhfkd/58614?language=silent`: title 3881, episode 58614,
version 183770, with mappings 121117 and 121118.

| Provider / mapping | Connection | Verification state |
| --- | --- | --- |
| Internet Archive / 121117 | Public item metadata, bounded validated redirects, and direct MP4 | Adapter implemented; earlier review progressed in the native video element. New candidate deployment verification pending. |
| Wikimedia Commons / 121118 | Exact File title, pinned SHA-1 and rights metadata, and original WebM | Adapter implemented; earlier review progressed after a source switch. New candidate deployment verification pending. |

Original observable relationships are retained separately:

| Provider | Mapping rows | Native state |
| --- | ---: | --- |
| Vidstream-2 | 178,314 | Unsupported: webpage/embed relationship only. |
| HD-1 | 177,935 | Unsupported: webpage/embed relationship only. |
| HD-2 | 66,985 | Unsupported: webpage/embed relationship only. |
| Kiwi | 0 | Inventory only. |
| VidPlay-1 | 0 | Inventory only. |

MegaPlay remains an observed host relationship, not a fictional additional
button. A provider-origin page, captured expiring URL, 200 response, or iframe
declaration is not represented as a native source. No referrer spoofing, access
block bypass, credential reuse, media copying, or unrelated substitute is used.

## Pre-deployment verification

- Focused cloud-data tests: 5 files, 78 tests passed.
- FMHY inventory and curated suites: 17/17 and 10/10 passed.
- Worker asset staging validates both configured manifest pins, every payload
  hash/byte count, collisions, links, aggregate file count, and reserved headroom.
- Wrangler upload dry-run passed with the complete ignored staging tree.
- `pnpm check` passed: TypeScript, 599/599 tests across 58 files, and the
  production build. HLS and DASH remain lazy player chunks; the size notices are
  build warnings rather than failed checks.
- Full Playwright matrix: 270 passed, 10 intentional platform-specific skips,
  and zero failures across desktop/mobile Chromium and WebKit in 4.5 minutes.

Deployment evidence must be appended only after the current Worker and Pages
artifacts are uploaded. Required checks are: JSON health/version match; full
baseline browse/search/title/episode/mapping results; unauthorized admin 401;
private asset paths 404; authentication/profile contracts; deep links and browser
errors; desktop/mobile visual review; and real progression, seek, switch, cleanup,
and restoration for mappings 121117 and 121118.

## Promotion and rollback gate

Do not promote the canonical origin until the deployed candidate passes all
checks above and the supplied visual direction receives acceptance. For rollback,
select a previously verified Pages deployment and a schema-compatible Worker
version that retains the same D1 bindings, secrets, and required immutable asset
pins. Never roll back or delete catalogue/account data merely to reverse frontend
CSS. See [CLOUD_RELEASE.md](CLOUD_RELEASE.md) for exact commands.

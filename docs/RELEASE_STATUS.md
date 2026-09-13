# Review release — 2026-09-13

Review: https://cloud-release.solanime.pages.dev

Immutable frontend: https://6be5aea6.solanime.pages.dev

API Worker version: `6a917582-d63a-4518-92ce-a980aeea5ef5`, catalogue schema 12.
This is an incomplete alpha, not a production promotion.

## Data and playback

| Records | Local catalogue | Cloud review at verification |
| --- | ---: | ---: |
| Titles | 8,949 | 8,949 |
| Episodes | 134,825 | 368 |
| Language/version variants | 183,770 | 599 |
| Provider mappings | 121,118 | 1,764 |

The durable cloud snapshot is 341/28,364 batches. Dispatch pauses at the configured
75,000 daily import-write allowance, preserving capacity for application traffic;
73,951 writes were reserved at the last check. The next quota window is
2026-09-14T00:00:00Z. The deployed scheduler retries the existing job; do not
start a replacement snapshot or raise billing to accelerate it.

An additive artwork import contains 23 identity-reviewed matches, 18 banners and 22
size-accepted posters. Exact title/episode identifiers corroborate new matches;
unresolved matches are not guessed. This is partial enrichment, and reference-only
artwork status does not assert redistribution clearance.

Only **The Dull Sword**, restored silent edition, is enabled natively through
Internet Archive and Wikimedia Commons. Both were checked on the deployed review
origin: media advanced, Archive seeking/pause worked, and Commons restored the
saved position then advanced. No captions are supplied for that edition.
These checks do not verify other episodes or legacy provider mappings.

Original webpage-only providers remain unsupported by the native player. Additional
movie/TV catalogue integration still requires an authorized metadata source; Cinejoy's
site credential is not reused. Its streaming-service filters are not playback servers.
A further archival candidate, The Blossom Man, is held for an edition-specific
reuse conflict rather than enabled solely from the original film's age.

## Interface and verification

The reference-led layout uses a floating navigation dock, full-bleed artwork,
consistent poster cards, verified-banner rows, compact episode navigation, and
an adjacent desktop watch inventory. History supports search, continuation, removal,
and pagination. Themes, saved accents, reduced motion, private notes and profiles
remain available. Unknown playback positions are not represented as measured progress.

- `pnpm check`: 537 tests across 50 files, typecheck and build passed.
- Browser acceptance: 270 passed, 10 platform-specific skips across Chromium/WebKit
  desktop and mobile. Deterministic media fixtures stay in tests.
- FMHY inventory tests: 17 passed; curated evidence tests: 10 passed.
- Deployed frontend: 47/47 served files matched the verified build.

Remaining release gates: cloud dataset completion, broad supported provider coverage,
non-anime catalogue integration, and user acceptance of the visual direction.
No overall completion percentage or full-library playback claim is made.

## Operation and rollback

Use the [setup commands](../README.md), [cloud runbook](CLOUD_RELEASE.md),
[resumable import tooling](../scripts/cloud-data/README.md), and
[native configuration guidance](NATIVE_PLAYBACK.md). The Git LFS catalogue is a
separate data checkpoint; the source ZIP deliberately excludes database/private state.

For a frontend rollback, select a previously verified Pages review deployment in
the existing project; do not promote it to production automatically. Worker rollback
must preserve its D1 bindings, secrets, private snapshot assets and schema compatibility.
Do not roll back catalogue data merely to revert CSS or frontend code.

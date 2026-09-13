# Solanime cloud candidate — 2026-09-13

Review origin: <https://cloud-release.solanime.pages.dev>

The origin above still serves the superseded review until the current candidate is
deployed and verified. This record describes the source and data package being
prepared for that review deployment. It does not claim a canonical production
promotion or complete commercial-provider playback.

## Catalogue and cloud package

| Records | Verified local catalogue | Packaged cloud baseline |
| --- | ---: | ---: |
| Titles | 8,949 | 8,949 |
| Episodes | 134,825 | 134,825 |
| Language/version variants | 184,073 | 184,073 |
| Provider mappings | 423,236 | 423,236 |

The source is the completed schema-10 checkpoint at
`catalogue-final-20260913T064052Z.sqlite`. Its SHA-256 and immutable baseline ID
are `2ac4cd16f061cab1cb44cec53595f84661573b5b906b9a93be608ef9c5d2cc4e`.
SQLite integrity and foreign-key checks pass. There are no duplicate natural
keys or orphaned relationships. All 144,397 crawl tasks are complete; none are
pending, running, retryable, or failed. Forty titles have an explicit verified
empty-episode observation. A further 5,758 version rows have no provider mapping
and remain accurately unavailable rather than being assigned a substitute.

The private Worker baseline contains 13,791 payload files and 636,631,933 payload
bytes. Together with the retained private import package it stages 15,312 files,
below the configured 20,000-file ceiling. Its manifest SHA-256 is
`5bc07b44dd00a9b8fe7a358c184a4ccab7798087620facdb76ff8886c6e93a2d`.
Worker-first routing and explicit `/__private-import/*` and
`/__private-baseline/*` denials keep both packages unavailable as public assets.
D1 remains authoritative for account data, research state, operator disables,
refresh checkpoints, and fresher catalogue overlays.

## Provider and playback truth

| Provider | Mappings | Native state |
| --- | ---: | --- |
| Vidstream-2 | 178,314 | Observable webpage/embed relationship retained; no verified supported native flow. |
| HD-1 | 177,935 | Observable webpage/embed relationship retained; no verified supported native flow. |
| HD-2 | 66,985 | Separate provider identity retained; no verified supported native flow. |
| Internet Archive | 1 | Approved native MP4 adapter for the restored silent edition of *The Dull Sword*. |
| Wikimedia Commons | 1 | Approved native WebM adapter for the same edition. |
| Kiwi | 0 | Provider inventory only. |
| VidPlay-1 | 0 | Provider inventory only. |

Earlier deployed review evidence established real media progression and
Archive-to-Commons switching for the two approved mappings on one public-domain
film. It does not verify the new deployment, the other 134,824 episodes, or any
original commercial provider. The current candidate must repeat progression,
seek, cleanup, switching, and restoration checks on its deployed origin before
production promotion. A successful HTTP response, iframe load, or adapter result
is not counted as playback.

## Interface

The candidate replaces the floating desktop dock and boxed catalogue composition
with a conventional transparent-to-dark masthead, full-bleed artwork hero, dense
16:9 rails, direct title/episode actions, compact mobile navigation, a flatter
desktop episode inventory, and route-specific loading/error states. Home, Browse,
TV Shows, Films, Dubbed, My List, title, watch, profiles, private notes, saved
themes and reduced motion remain connected to application state.

This is a reference-led independent implementation, not a pixel-identical Netflix
copy. Its information hierarchy and density now follow the supplied Netflix and
Cinejoy references, but source artwork is often poster-shaped or low resolution;
the interface labels unavailable artwork instead of inventing replacements.
Public episode comments are not claimed—episode notes are private to a profile.

## Verification state

- `pnpm check`: typecheck, 599/599 tests across 58 files, and the production
  build passed after the latest timeout-tolerance patch.
- Browser matrix: 270 passed and 10 intentional platform-specific tests skipped
  across desktop/mobile Chromium and WebKit in 4.5 minutes; zero failures.
- FMHY inventory suites: 17/17 and 10/10 passed in the isolated Python environment.
- Cloud baseline preparation, pin validation, collision checks, link rejection,
  file limits, and Wrangler dry-run passed.

See the [cloud runbook](CLOUD_RELEASE.md), [release evidence](cloud-release-checklist.md),
[data tooling](../scripts/cloud-data/README.md), and
[native playback guidance](NATIVE_PLAYBACK.md). Production remains gated on a
matching deployed frontend/API, full-baseline API checks, both approved native
providers progressing in the in-site player, publication review, and visual
acceptance.

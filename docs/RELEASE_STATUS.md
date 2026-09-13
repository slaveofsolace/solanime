# Solanime cloud candidate — 2026-09-13

Review origin: <https://cloud-release.solanime.pages.dev>

Immutable frontend: <https://fbe8c6a5.solanime.pages.dev>

Source commit: `3d8ba38`. API Worker version:
`80730f1d-1d3b-43d5-9b93-c5efc8594f5c`. The review origin now serves this
candidate. This is not a canonical production promotion or a claim of complete
commercial-provider playback.

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

The current deployed review was checked through the title-to-watch flow on the
same origin. Internet Archive advanced from 90.220716 to 96.944256 seconds. The
source switch restored compatible progress at 103.866789 seconds, and Wikimedia
Commons advanced from 104.018676 to 111.979475 seconds. Both had ready state 4,
no media error, and a single in-site native video element. The browser warning/
error log was empty. This evidence covers only mappings 121117 and 121118 on one
public-domain film; it does not verify the other 134,824 episodes or any original
commercial provider. A successful HTTP response, iframe load, or adapter result
alone is not counted as playback.

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
  file limits, Wrangler dry-run, and the real Worker upload passed.
- Deployed health reports Workers runtime, schema 12, matching `0.7.0-alpha`, and
  8,949 titles. Catalogue pagination reports 8,949 records; the verified title
  returns its real episode, silent version, and two native choices. Private
  baseline paths return 404 and unauthenticated admin requests return 401.
- Desktop home/watch and 390px mobile title/watch views were inspected after
  readiness. The title primary action now ranks an explicitly available native
  version ahead of merely observed provider mappings.

See the [cloud runbook](CLOUD_RELEASE.md), [release evidence](cloud-release-checklist.md),
[data tooling](../scripts/cloud-data/README.md), and
[native playback guidance](NATIVE_PLAYBACK.md). Production remains gated on
broader provider coverage and user visual acceptance; the current review has
passed its matching-version, full-baseline, publication, and two-provider native
playback checks.

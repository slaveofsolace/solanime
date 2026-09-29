# Solanime cloud candidate — 2026-09-13

Review origin: <https://cloud-release.solanime.pages.dev>

Immutable frontend: <https://aadc4fe2.solanime.pages.dev>

The deployed frontend includes source through `1264bc0`. API Worker version:
`b9fcc0c7-a471-409c-af6e-c69c7e849b5b`. The review origin now serves this
candidate. This is not a canonical production promotion, a claim of complete
commercial-provider playback, or a pixel-identical copy of a third-party site.

## Catalogue and cloud package

| Records | Completed anime checkpoint | Hosted combined baseline |
| --- | ---: | ---: |
| Titles | 8,949 | 9,185 |
| Episodes | 134,825 | 165,913 |
| Language/version variants | 184,073 | 215,161 |
| Provider mappings | 423,236 | 423,236 |

The source is the completed schema-10 checkpoint at
`catalogue-final-20260913T064052Z.sqlite`. Its SHA-256 and immutable baseline ID
are `2ac4cd16f061cab1cb44cec53595f84661573b5b906b9a93be608ef9c5d2cc4e`.
SQLite integrity and foreign-key checks pass. There are no duplicate natural
keys or orphaned relationships. All 144,367 crawl tasks are complete; none are
pending, running, retryable, or failed. Forty titles have an explicit verified
empty-episode observation. A further 5,758 version rows have no provider mapping
and remain accurately unavailable rather than being assigned a substitute.

The hosted baseline adds the first quota-bounded TVmaze discovery page: 236 TV
series and 31,088 metadata-only episodes. These records use separate provenance
and stable source identifiers. They deliberately have zero playback providers;
metadata ingestion is not represented as media availability.

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
same origin after this frontend deployment. The Internet Archive source advanced
from 153.351544 to 155.488674 seconds (+2.137130 seconds), with ready state 4,
no media error, a single in-site native video element, and an empty browser
warning/error log. Earlier source-switch evidence also covers the Wikimedia
Commons mapping. This evidence covers only mappings 121117 and 121118 on one
public-domain film; it does not verify the other catalogue episodes or any
original commercial provider. A successful HTTP response, iframe load, or
adapter result alone is not counted as playback.

## Interface

The candidate uses a transparent-to-dark masthead, 68svh full-bleed artwork hero,
dense edge-to-edge 16:9 rails, visible first-viewport discovery, direct title and
episode actions, and compact responsive navigation. Anime, TV Shows, and Movies
are first-class destinations on desktop; Anime, TV, Search, Home, and My List are
available in the five-item mobile bar. Continue Watching exposes real progress,
the title view uses a full-width artwork composition and compact episode inventory,
and the watch view prioritizes the native player with a bounded desktop episode
rail. Saved themes, reduced motion, watchlist, history, and profile state remain
connected to application behavior.

This is a reference-led independent implementation, not a pixel-identical Netflix
copy. Its information hierarchy and density now follow the supplied Netflix and
Cinejoy references, but source artwork is often poster-shaped or low resolution;
the interface labels unavailable artwork instead of inventing replacements.
Episode comments are public to read and authenticated to post. Private episode
notes remain a separate profile-only feature.

## Verification state

- `pnpm check`: typecheck, 620/620 tests across 63 files, and the production
  build passed after the integrated navigation and fidelity work.
- Focused system-Chrome browser matrix: 46/46 passed across desktop and mobile,
  covering home/title composition, navigation, title/watch fidelity, native
  controls, iframe refusal, unsupported sources, HLS, and DASH.
- FMHY inventory suites: 17/17 and 10/10 passed in the isolated Python environment.
- Cloud baseline preparation, pin validation, collision checks, link rejection,
  file limits, Wrangler dry-run, and the real Worker upload passed.
- Deployed health reports Workers runtime, schema 12, matching `0.7.0-alpha`, and
  9,185 titles. Live catalogue checks returned an 8,949-title Anikoto scope and a
  236-title TVmaze scope; a TV detail returned 138 real episodes. The verified
  film returns its real episode, silent version, and two native choices. Private
  baseline paths return 404 and unauthenticated admin requests return 401.
- Desktop home/title/watch and 390px mobile home/watch views were inspected after
  readiness. The title primary action ranks an explicitly available native
  version ahead of merely observed provider mappings, and the mobile player does
  not overflow its viewport.

See the [cloud runbook](CLOUD_RELEASE.md), [release evidence](cloud-release-checklist.md),
[data tooling](../scripts/cloud-data/README.md), and
[native playback guidance](NATIVE_PLAYBACK.md). Production remains gated on
broader provider coverage and user visual acceptance; the current review has
passed its matching-version, full-baseline, publication, and two-provider native
playback checks.

# BEYBLADE official YouTube approval registry

This registry records 252 exact, English-dub catalogue crosswalks to full episodes on the `BEYBLADE English - Official Channel`. It is deliberately separate from fuzzy discovery and from the active production approval list.

## Evidence and scope

- Publisher: `BEYBLADE English - Official Channel`
- Stable channel ID: `UCktgoAFaL39_rYfiMZiD9jw`
- Stable handle: `@BeybladeOfficial`
- Publisher evidence: <https://beyblade.com/> and <https://beyblade.com/episodes/>
- Review snapshot: 1,853 enumerable channel videos, observed September 13, 2026
- Current identity check: 255 strict candidates returned an exact YouTube oEmbed response on September 15, 2026; three regional duplicates were removed, leaving 252 unique catalogue mappings
- Language: English audio mapped only to existing `dub` versions

The exact registry covers:

| Catalogue series | Exact mappings | Catalogue dub episodes |
| --- | ---: | ---: |
| BEYBLADE X | 95 | 120 |
| Beyblade Burst Evolution | 50 | 51 |
| Beyblade Burst Turbo | 49 | 51 |
| Beyblade Metal Fusion | 28 | 51 |
| Beyblade: Metal Masters | 25 | 50 |
| Beyblade Burst | 5 | 51 |
| **Total** | **252** | **374** |

Every row fixes the Anikoto title source ID and slug, episode source ID and number, dub-version source ID, YouTube video ID, exact observed video title, publisher channel identity, and observation time. Numeric local title, episode, and version IDs are retained as audit evidence. Runtime resolution still fails closed on the stable source identities.

## Held material

The registry excludes multi-episode packs, regional duplicates, fuzzy title matches, and season identities that do not line up exactly with the catalogue:

- The 2001 series, V-Force, and G-Revolution uploads are mostly two-episode packs. No segment timestamps were inferred.
- Rise, Surge, and QuadDrive use 26 broadcast uploads while the relevant catalogue inventories contain 52 segments; Rise has dub rows but no exact per-segment start identity, and the other two lack compatible dub versions.
- QuadStrike has no established exact catalogue title.
- Metal Fury and Shogun Steel have no current enumerable full-episode candidates in the reviewed inventory.

These are review holds, not parser failures and not permission to map one source to two catalogue episodes.

## Verification boundary

`server/ingestion/youtubeOfficialBeybladeApprovals.ts` is an explicit review registry. Importing it does not mutate a database, add it to the active approval command, or deploy it. The focused test confirms exact counts, unique mappings, numeric catalogue equality in an exact fixture, idempotent application, strict publisher/video oEmbed identity, and fail-closed catalogue drift.

Fresh oEmbed and player checks are still required when this registry is integrated. Successful oEmbed metadata does not by itself prove current media progression, regional availability, or deployed-origin playback for every episode.

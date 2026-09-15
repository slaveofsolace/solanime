# After War Gundam X official YouTube approval

## Approval basis

Bandai Namco Filmworks' current [After War Gundam X announcement](https://en.gundam-official.com/gundam-x/news/mh8xey7310egn849s70ifaon/) states that all 39 episodes are released free on GUNDAM CHANNEL INTL, beginning June 20 with one episode per day. The page identifies the series, episode count, channel, and subtitle distribution directly. It was rechecked on 2026-09-15.

The application continues to use the existing exact GUNDAM publisher policy:

- Channel label: `GUNDAM CHANNEL INTL`
- Stable channel ID: `UCejtUitnpnf8Be-v5NuDSLw`
- Handle: `https://www.youtube.com/@GundamInfo`
- Playback: standard privacy-enhanced YouTube embed only

This evidence supports a manual series-and-episode crosswalk. It does not grant ownership of the media, permit copying or restreaming, or make other uploads on the channel eligible.

## Exact crosswalk

`server/ingestion/youtubeOfficial.ts` contains 39 explicit approval rows. No title, episode, or language inference runs during import.

| Field | Reviewed value |
| --- | --- |
| Catalogue title | `After War Gundam X` |
| Title ID / source ID | `6930` / `2106` |
| Slug | `after-war-gundam-x-nawe0` |
| Episode IDs | `101860` through `101898` |
| Episode source IDs | `37531` through `37569` |
| Version IDs | `132527` through `132565` |
| Version source IDs | `37531:sub` through `37569:sub` |
| Language | `sub` |
| Approved videos | 39 unique 11-character YouTube IDs |

The immutable discovery review observed every row as a single regular episode, embeddable, available in the United States, and approximately 24 minutes long. The published titles are preserved byte-for-byte, including the uploader's `sbtitles` spelling in episodes 11 through 18, because live oEmbed is an exact identity gate.

Live oEmbed was rechecked on 2026-09-15 for a bounded first/middle/last sample:

| Episode | Video ID | Exact current title | Result |
| ---: | --- | --- | --- |
| 1 | `TTnmp3_vAX4` | `After War Gundam X -Episode1(w/subtitles)` | Exact GUNDAM CHANNEL INTL author and embed ID |
| 20 | `M92RqwckLbU` | `After War Gundam X -Episode20(w/subtitles)` | Exact GUNDAM CHANNEL INTL author and embed ID |
| 39 | `CBfwAD0uWN4` | `After War Gundam X -Episode39(w/subtitles)` | Exact GUNDAM CHANNEL INTL author and embed ID |

## Verification boundary

The importer resolves stable catalogue source identifiers, rejects a missing or changed identity, and creates one idempotent mapping and native-resource row per episode. The resolver returns the video ID and `www.youtube-nocookie.com` allowlist, never a captured media URL.

Current oEmbed availability and a successful API resolution do not establish that playback progressed in a deployed browser. Each deployed mapping remains subject to YouTube's uploader, regional, embedding, and availability controls, and production playback verification is recorded separately.

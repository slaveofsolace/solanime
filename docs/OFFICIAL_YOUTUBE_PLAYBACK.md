# Official YouTube publisher playback

## Scope and safety boundary

`youtube-official` is a deliberately narrow provider. It renders YouTube's standard privacy-enhanced player for a manually reviewed full-episode upload on an explicitly allowlisted official publisher channel. It does not resolve, extract, proxy, cache, download, restream, or replace YouTube media. YouTube retains its controls, branding, captions, quality UI, geographic restrictions, uploader restrictions, and advertising.

The first allowlist contains one publisher only:

- Publisher label: `It's Anime powered by REMOW`
- Stable YouTube channel ID: `UCsj_CYajUSQ2ca8bYCMan9g`
- Channel: <https://www.youtube.com/channel/UCsj_CYajUSQ2ca8bYCMan9g>
- Handle: <https://www.youtube.com/@ItsAnimeJP>
- REMOW's channel description: <https://www.remow.com/en/service/>

REMOW describes It's Anime as its global anime brand and says the official YouTube channel carries full-length episodes. That establishes the channel as an ordinary publisher-supported distribution surface; it does not mean Solanime owns the video or that every upload is licensed in every region.

No arbitrary video or channel can be supplied through the API. A playable row must pass all of these gates:

1. Exact Anikoto title, episode, version, and language identifiers from a reviewed crosswalk.
2. Exact 11-character YouTube video identifier in both the mapping and approval row.
3. Exact allowlisted stable channel URL and approval basis.
4. A current public YouTube oEmbed response whose video title, publisher label, handle URL, and embed identifier all match the review record.
5. A resolver result that contains only the video ID and exact `www.youtube-nocookie.com` host; arbitrary URLs are rejected.

## First reviewed crosswalk

Observed and rechecked on 2026-09-13:

| Relationship | Reviewed value |
| --- | --- |
| Solanime title | `B-Project: Netsuretsu*Love Call` |
| Anikoto title | source ID `6771`; slug `b-project-netsuretsu-love-call-27sfl` |
| Episode/version | episode source ID `104039`, episode `1`; version `104039:sub` |
| Official upload | `Full Episode 01 \| B-PROJECT Passion*Love Call \| It's Anime [Multi-Subs]` |
| YouTube video | <https://www.youtube.com/watch?v=_3Gcm-iGAQk> |
| Series identity | <https://www.bpro-anime.com/> |
| Official episode 1 | <https://www.bpro-anime.com/story/episode1/> |

The official Japanese series site identifies the season as `B-PROJECT～熱烈＊ラブコール`, while REMOW's English upload calls it `B-PROJECT Passion*Love Call`. That publisher-level title relationship and the explicit episode-1 labels are the basis for this crosswalk; name similarity alone is not accepted.

The public oEmbed check currently confirms the exact video title and author. oEmbed does not return a stable channel ID, so the stable channel ID is retained from the separately reviewed verified channel page and required by the local approval record. If any identity field changes, the approval command fails closed for review.

## Review and import

The command is a read-only dry run by default and checks the current catalogue crosswalk plus live public oEmbed metadata:

```sh
pnpm approve:youtube-official
```

It refuses to mutate the default catalogue. Applying requires both an explicit flag and an explicit reviewed database path:

```sh
pnpm approve:youtube-official -- --apply --db=/absolute/path/to/reviewed-catalogue.sqlite
```

Run the normal Cloudflare catalogue-delta preparation and audit after applying to the reviewed release database. Never put session cookies, API tokens, or captured playback URLs in the approval record. No YouTube API key is required for this exact manually reviewed path.

## Browser contract

The frontend constructs this URL itself from the approved video ID:

```text
https://www.youtube-nocookie.com/embed/<video-id>?enablejsapi=1&origin=<exact-page-origin>&playsinline=1&rel=0
```

The iframe uses `strict-origin-when-cross-origin`, an exact CSP allowlist, and a sandbox without popups, top navigation, downloads, or forms. YouTube's in-player play, pause, seek, caption, quality, and fullscreen controls remain available, while links cannot open an unexpected window or navigate Solanime's parent page.

The official [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) supplies ready, playback-state, progress, completion, and documented error events. The implementation follows YouTube's [player parameter contract](https://developers.google.com/youtube/player_parameters) and [privacy-enhanced embed mode](https://support.google.com/youtube/answer/171780). Ads are not stripped or suppressed; YouTube documents that [embedded-player ads remain under its normal controls](https://support.google.com/youtube/answer/132596). Uploaders can disable embedding, and YouTube describes that limitation in its [embed restriction guidance](https://support.google.com/youtube/answer/97363).

## Verification states and errors

These states remain distinct:

- `adapter implemented`: resolver, approval gate, API contract, and browser component exist and pass deterministic tests.
- `source resolved`: the API returned an approved video identifier and publisher record.
- `player loaded`: the YouTube IFrame API emitted `onReady` in a real browser.
- `playback verified`: the specific reviewed mapping visibly progressed after a user play action on the tested origin and region.

Local browser verification on 2026-09-13 used the shipping React component and the standard privacy-enhanced iframe on `http://127.0.0.1`. The IFrame API reached ready state; after an explicit click on YouTube's own play control, the component reported `25.01 / 1434.00` seconds while the parent URL remained on the Solanime test origin. A second live check removed popup permission from the sandbox and observed continuous progression from `36.05` to `38.04 / 1434.00` seconds; the parent URL and task tab count remained unchanged. This establishes local in-site playback without popup permission for this mapping and region. It is not evidence for a deployed origin, another region, another episode, or uninterrupted completion. Production promotion still requires the same check after the reviewed mapping is imported and deployed.

The adapter exposes explicit errors for an invalid ID (`2`), HTML5 startup failure (`5`), removed/private upload (`100`), disabled embedding (`101`/`150`), and a missing/invalid HTTP referrer (`153`). Other errors are reported as browser-or-region availability failures. A failed video is not silently replaced with another upload.

This adapter does not imply broad REMOW, YouTube, Anikoto, or catalogue coverage. Every additional full episode needs its own authoritative episode crosswalk and current publisher check before it may be enabled.

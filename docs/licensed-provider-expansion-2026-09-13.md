# Licensed provider expansion — 2026-09-13

## Result

The fastest legitimate scaling mechanism is **not** to resolve the 423,237
legacy mapping rows one at a time. Those rows describe observed source choices,
mostly multiple labels for the same episode/version, and do not grant access to
media. The scalable mechanism is:

1. a publisher-controlled catalogue or channel with stable video IDs;
2. a documented third-party player or media API;
3. exact title/episode/version crosswalks from publisher identifiers;
4. automated metadata, embed, region and availability probes; and
5. human review only for identity/rights exceptions.

No new playable mapping is approved by this investigation. Dailymotion is the
strongest additional **provider-player** contract found, and a bounded read-only
probe is implemented, but no current full-episode anime item with independently
verified rights-holder identity was established. It therefore does not change
the current playback percentage or satisfy the selected native-player production
gate.

## Evidence matrix

| Service | May an independent site embed? | Identifier / matching contract | Region / expiry | Scale and disposition |
| --- | --- | --- | --- | --- |
| Dailymotion | **Yes, per-video.** Its current oEmbed documentation explicitly describes embedding on third-party sites; public metadata exposes `allow_embed`, and the supported iframe is hosted at `geo.dailymotion.com`. | Stable public video ID (`x…`), canonical watch URL, owner ID/name/profile, title and duration. A Solanime approval still needs an external rights-holder identity chain and an exact catalogue episode/version crosswalk. | Public `geoblocking` reports allow/deny countries. An embed has no documented fixed expiry, but the owner can unpublish, delete, disable embedding or change region policy. Direct stream URLs are owner-token-only, secured and expiring, so they are not a public native-player interface. | **Prototype complete; zero episodes approved.** Best non-YouTube platform lead. The observed `crunchyrolltv` profile currently exposes 9 embeddable videos; all are clips, maximum duration 189 seconds, and the API reports `verified:false`. Do not infer official identity from the display name. |
| Vimeo | **Yes, per-video.** Vimeo documents external embeds and an `Anywhere` setting where anyone may embed; owners may instead choose `Nowhere` or up to 50 specific domains. | Stable video URI/ID and `player_embed_url`; API privacy reports `public`, `whitelist` or `private` embed permission. Publisher identity and episode crosswalk remain separate gates. | Domain privacy can change at any time; unlisted videos require the full unlisted URL. No verified full-episode anime publisher inventory was found. | **Technical candidate, content upper bound 0.** Reusable only after a rights-holder supplies or publicly links an eligible catalogue. |
| Twitch | **Yes.** Twitch documents live/VOD iframe and JavaScript embeds; HTTPS, minimum dimensions, an exact `parent` domain, and unobscured official player are required. | Channel, VOD ID (with `v` prefix in iframe), or collection ID. The Get Videos API requires a client ID and app/user token for inventory. | Ordinary VODs are deleted after 14 days, or 60 days for partners; highlights/uploads do not expire. Broadcasters may delete content earlier. | **Poor episode catalogue fit.** No stable rights-holder anime VOD inventory was verified; ordinary VOD expiry prevents durable mappings. |
| TikTok | **Yes, for public posts.** TikTok documents oEmbed and a first-party iframe player with playback events. | Numeric post ID plus creator profile; Display API inventory requires app review, user authorization and `video.list`. | Embed availability follows the TikTok post: removal/moderation removes the embed. Region/browser behavior can differ. | **No verified full-episode inventory.** Good clip/social surface, not a current series-scale anime source. |
| Crunchyroll first-party service | **No public third-party episode player/API was located.** Current help says licensed shows are for personal, non-commercial viewing and it does not grant public-screening licenses. | Internal series/season/episode identities are not a documented third-party playback contract. | Subscription, title, language and region availability vary. | **Partnership required.** Do not treat a Crunchyroll name on another platform as rights proof without an official identity link. |
| HIDIVE, RetroCrush, Tubi, Pluto TV, Plex, Roku Channel, Netflix, Prime Video, Hulu, Disney+ | No current public independent-site full-episode embed/API contract was established in primary documentation during this bounded audit. | Service-internal IDs alone do not authorize embedding or media resolution. | Subscription/ad entitlement, DRM, account and regional restrictions vary. | **Hold / business-development path.** A documented partner player/feed and origin authorization would change this assessment; ordinary consumer playback does not. |
| Bilibili / NicoNico | Public share/player URLs are observable, but no sufficiently clear current English-language third-party full-episode authorization and rights-holder inventory contract was verified in this bounded audit. | Platform video IDs are not, by themselves, a rights or episode-identity crosswalk. | Region, login, premium windows and delisting are common. | **Hold.** Do not ship an adapter from an observed iframe pattern alone. |

Primary documentation used:

- Dailymotion oEmbed: <https://developers.dailymotion.com/docs/embed-with-oembed>
- Dailymotion iframe: <https://developers.dailymotion.com/docs/iframe-web>
- Dailymotion public video fields and geoblocking: <https://developers.dailymotion.com/v0/reference/video-fields>
- Dailymotion v2 migration, including embed and owner-only time-limited stream behavior: <https://developers.dailymotion.com/docs/migrating-from-legacy-api-to-api-v2>
- Vimeo external embedding/privacy: <https://help.vimeo.com/hc/en-us/articles/12426259908881-How-to-embed-my-video>
- Vimeo video API representation: <https://developer.vimeo.com/api/reference/response/video>
- Twitch video/VOD embeds: <https://dev.twitch.tv/docs/embed/video-and-clips/>
- Twitch embed requirements: <https://dev.twitch.tv/docs/embed>
- Twitch VOD retention: <https://dev.twitch.tv/docs/api/videos>
- TikTok embeds and availability: <https://developers.tiktok.com/docs/en/embed-videos>
- TikTok iframe player/events: <https://developers.tiktok.com/docs/en/embed-player>
- Crunchyroll public-use statement: <https://help.crunchyroll.com/hc/en-us/articles/43593544952596-Can-I-host-a-public-screening-of-Crunchyroll-content>

## Implemented bounded probe

`server/providers/dailymotionPublicEmbed.ts` and
`scripts/probe-official-dailymotion.ts` use only fixed Dailymotion origins and
documented public endpoints. The probe:

- validates a public `x…` video ID and exact expected owner ID/name/profile;
- reads only bounded JSON (64 KiB maximum);
- requires published status, `allow_embed:true`, exact canonical URL/title and a
  caller-set minimum duration;
- normalizes documented allow/deny country policy;
- verifies that oEmbed returns exactly one `geo.dailymotion.com/player.html`
  iframe for the same video ID;
- returns neither provider HTML nor a media URL; and
- explicitly reports `rightsApproved:false` and `catalogueMapped:false`.

It does not register an adapter, approve a mapping, alter the database, download
media, request an owner stream URL, use a token, or weaken the native-only gate.

Verification on the current checkout:

```text
pnpm exec vitest run tests/dailymotion-public-embed.test.ts
1 file passed; 6 tests passed

pnpm exec tsc --noEmit
passed

Live public probe, minimum-duration=1:
x9if82u -> exact Dailymotion owner/profile and iframe contract verified;
duration 189 seconds; worldwide allow policy; rightsApproved:false;
catalogueMapped:false

Live public probe, default minimum-duration=900:
DAILYMOTION_DURATION_TOO_SHORT
```

## Why `3 / 423,237` is so low

The numerator counts individually reviewed safe playback connections. The
denominator counts observed provider mapping rows, not episodes that still need
the same mechanical operation. Most of those rows point to the three retained
Anikoto labels whose documented interface is a provider-hosted MegaPlay iframe;
they do not expose a supported native-media contract. Two approved public-domain
resources also point to the same reviewed film version, so even the numerator is
not a count of distinct playable episodes.

Therefore `3 / 423,237 = 0.0007088%` is a truthful **connection-row ratio**, but
it is a poor project-completion metric. Release reporting should add:

- distinct playable episode versions / 184,073 imported versions;
- distinct playable episodes / 134,825 imported episodes; and
- titles with at least one playable episode / 8,949 titles.

One valid provider mapping can make an episode version playable; reproducing all
three legacy mirror labels is neither required nor legitimate.

## ETA and exponential path

### Current unconditional ETA

There is no honest calendar ETA for broad playback from the currently evidenced
providers. The missing input is not compute throughput; it is an authorized
full-episode catalogue and supported player/media contract. The new Dailymotion
probe has **zero eligible full episodes today**, so running it faster still adds
zero mappings.

### Once a rights-holder supplies an authorized feed

The following planning range starts only after Solanime receives a documented
provider contract, origin approval if required, stable episode IDs and a
publisher catalogue/export:

| Deliverable after prerequisites | ETA | Evidence required before claiming it |
| --- | ---: | --- |
| First provider integration and 10–50 reviewed episodes | 3–7 working days | Exact crosswalk, player load/progression/seek/error behavior on review origin, region handling, rights record |
| 1,000 episode versions | 1–3 weeks | Batch import plus automated probes; human exception queue; sampling across languages/regions |
| 10,000 episode versions | 3–8 weeks | Publisher feed stability, deterministic external IDs, quota/rate-limit headroom, deployed monitoring |
| 100,000 episode versions | 3–6 months | Multiple rights-holder feeds, contractual region windows, continuous delisting/expiry sync, large-scale QA |

These are capacity ranges, not promises that a provider owns that many matching
episodes. At the current evidence boundary the upper bound is still zero new
non-YouTube full episodes.

### Throughput model

At the legacy mapping-row denominator, reaching 1% requires 4,233 total safe
connections (4,230 additions), 10% requires 42,324 (42,321 additions), and 100%
requires 423,237 (423,234 additions). Approximate ingestion time after a fully
authorized deterministic feed exists:

| Sustained verified additions | 1% | 10% | 100% |
| ---: | ---: | ---: | ---: |
| 500/day (semi-automated review) | 9 days | 85 days | 847 days |
| 5,000/day (publisher manifest + automated crosswalk/probes) | <1 day | 9 days | 85 days |

The only exponential route is the second lane: ingest publisher manifests in
bulk, join on AniList/MAL/TMDB/publisher episode IDs, probe in bounded parallel
batches, and send only ambiguous identity/rights cases to reviewers. Scraping
temporary media URLs, reverse-engineering protected players, or treating mirror
rows as permissions would be faster only by producing an unsupported and
misrepresented system.

## Exact next action

Do not bulk-run the Dailymotion probe yet. First obtain one independently linked
rights-holder Dailymotion/Vimeo/Twitch catalogue containing a real full episode,
or a partner feed from Crunchyroll/HIDIVE/RetroCrush/Tubi/Pluto/Plex/Roku. For
that single candidate, record the publisher identity evidence and exact local
title/episode/version crosswalk, then run the probe and verify real playback on
the Cloudflare review origin. If the product decision remains native-only,
Dailymotion/Vimeo/Twitch/TikTok are research-only and the next action is a
documented native/media partnership rather than further iframe engineering.

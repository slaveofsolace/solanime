# Official publisher source candidates
# Official publisher source candidates

Reviewed: 2026-09-13
Disposition: **REFERENCE ONLY**
Machine-readable registry: `research/official-publisher-source-candidates.json`
Fail-closed package envelope: `research/official-publisher-source-candidate-package.resource-registry.json`

## Result

The registry contains **30 distinct channel or playlist candidates** with stable
YouTube channel IDs, grouped under eight publisher evidence sets. Every row is a
discovery input candidate, not an approved episode mapping or a playback policy.
Nothing in this package registers a source, enables an adapter, changes the
database, or treats public visibility as permission to redistribute media.

The 30 candidates break down as follows:

| Network / publisher | Candidate surfaces | Why they count |
| --- | ---: | --- |
| Muse Communication | 7 | Muse's corporate social registry names the Asia, India, Indonesia, Malaysia, Philippines, Thailand, and Vietnam channels. Current public channel indexes show numbered 20-plus-minute episodes or complete-series compilations. |
| Medialink / Ani-One | 7 | Medialink names Ani-One Asia, the Chinese channel, and regional Thailand, Philippines, Vietnam, Indonesia, and India channels. Its corporate material distinguishes ordinary AVOD from ULTRA membership programming. |
| The Pokémon Company | 5 | Pokémon's official India portal links exact Pokémon Horizons playlists for English, Hindi, Tamil, Telugu, and Bengali and identifies them as official channels. |
| ADK Emotions / TOMY / Beyblade | 7 | The official Beyblade site links seven language channels and exposes a numbered episode catalogue. Current official-channel results include full episodes. |
| REMOW / It's Anime | 1 | REMOW explicitly says its official channel carries full-length anime episodes. |
| TMS Entertainment | 1 | TMS links its official channel and maintains a publisher-owned catalogue page for anime available there. |
| Bandai Namco Filmworks / GUNDAM.INFO | 1 | Official Gundam pages link the channel and numbered episode viewing pages; the catalogue is intentionally rotational. |
| Kodansha / Full Anime TV | 1 | Kodansha's publisher release identifies its channel and complete-season promotional windows. |

## Strongest concrete observations

- Pokémon's official portal links five exact full-series playlist IDs. A Telugu
  episode (`RAX24CIKazg`, 1,277 seconds) matched the official channel and reported
  `playableInEmbed: true` during the audit. English and Hindi samples were valid
  21-minute episodes with explicit country allowlists, but were unavailable from
  the audit egress. That is a regional result, not an embed failure.
- The official Brazilian Portuguese Beyblade channel sample `8qEYBf7WAMI` is a
  1,361-second numbered episode and reported `playableInEmbed: true`.
- The previously reviewed REMOW sample `_3Gcm-iGAQk` is a 1,420-second episode,
  matches REMOW's channel, reports embeddable playback, and has an exact local
  episode/version crosswalk. It remains review-only until the separate approval
  registry says otherwise.
- Muse channel indexes currently expose high-volume numbered episodes and
  complete-series marathons. Medialink documents daily episode publication, but
  its ULTRA membership catalogue must never be mixed into the public AVOD lane.

These observations are intentionally per-video and per-region. A channel-level
identity record cannot be inherited as a blanket playback approval.

## Primary identity and programming evidence

- Muse corporate channel registry: <https://www.e-muse.com/en/social-media/>
- Muse rights and clearance statement: <https://www.e-muse.com.sg/intellectualproperty/>
- Medialink Ani-One ownership and programme model: <https://www.medialink.com.hk/en/Anione.aspx>
- Medialink corporate enumeration of regional channels: <https://www.medialink.com.hk/en/News.aspx?id=812>
- Medialink AVOD/ULTRA disclosure: <https://www1.hkexnews.hk/listedco/listconews/sehk/2023/1129/2023112901559.pdf>
- Pokémon official five-language Horizons announcement and playlist links: <https://in.portal-pokemon.com/topics/pokemon_horizons_is_now_available_on_youtube_also_pokemon_south_asia_official_english_channel_has_be/>
- Pokémon corporate official-channel statement: <https://corporate.pokemon.co.jp/information/newsreleases/i-63/>
- Beyblade official episode catalogue and regional channel links: <https://beyblade.com/episodes/> and <https://beyblade.com/>
- REMOW official service description: <https://www.remow.com/en/service/>
- TMS official channel links and catalogue: <https://tmsanime.com/links> and <https://tmsanime.com/anime-on-tms-official-channel>
- GUNDAM.INFO official episode publication: <https://en.gundam.info/news/video-music/01_12737.html>
- Kodansha-operated Full Anime TV season-window announcement: <https://prtimes.jp/main/html/rd/p/000007621.000001719.html>

## Constraints represented in the manifest

The registry records each channel separately because territory, language, dub,
membership, and rotation behavior differ even under one operator. The fields are
deliberately fail-closed:

- `enumerationStatus` states whether a public channel/playlist can be inventoried
  or whether this audit saw a regional filter.
- `embedStatus` distinguishes an observed playable full episode from a candidate
  that still needs a title/region/membership probe.
- `accessModel` prevents Ani-One ULTRA and other gated content from entering a
  public AVOD batch.
- `sampleObservation` exists only when an exact video ID, title, duration, and
  embed result were recorded. It contains no media URL or provider HTML.
- `disposition` is always `reference-only`; there are no adapter, auto-enable,
  approval, or authoritative-mapping fields.

## Requested publishers not counted in the 30

These are useful leads, but the evidence did not meet the same current-source
bar during this bounded pass:

| Lead | Disposition | Why it is not counted yet |
| --- | --- | --- |
| Nozomi Entertainment | HOLD | The channel still exposes historic full series, but Right Stuf's acquisition removed the clean current publisher-owned identity chain needed for a new registry row. Re-establish ownership/operations with Crunchyroll before ingesting. |
| Tatsunoko Production | HOLD | Tatsunoko's site links authorized full first episodes, often explicitly time-limited. A current active episode and embed observation are still required. |
| Toei Animation Museum Channel | HOLD | Toei clearly owns the channel, but the strongest official episode announcements found were limited windows that have expired. Inventory only after an active window is observed. |
| Discotek Media | HOLD | No current publisher-owned page proving a repeatable full-episode YouTube catalogue was found. Trailers and licence announcements do not qualify. |
| RetroCrush | HOLD | RetroCrush is a genuine licensed service, but its consumer service catalogue is not evidence that its YouTube channel provides a current, reusable full-episode inventory. |
| Yu-Gi-Oh! OCG / Konami | REFERENCE ONLY | Konami's current official YouTube animation is a promotional short-anime series, not 15-plus-minute television episodes for this ingestion gate. |

Holding these sources avoids inflating the registry with recognizable names that
do not yet satisfy the operational contract.

## Coordination and ingestion sequence

1. Review this registry and import selected source rows into
   `config/official-youtube-discovery.json`.
2. Import selected rows as `reference-only` sources with **no new playback
   policy**. Inventory public channel uploads or the exact publisher-linked
   playlist with resumable checkpoints.
3. Probe only items at least 900 seconds long. Require exact channel ID, playable
   embed status, public/non-membership access, and an explicit country policy.
4. Match title, episode number, season/version, and language. Ambiguous aliases,
   compilations, specials, and dubs go to manual review.
5. Add an approval-registry entry only after identity, rights scope, region,
   version crosswalk, playback progression, seeking, and failure behavior pass
   review-origin verification.
6. Re-probe continuously and expire mappings when a publisher removes, gates, or
   geographically narrows a video.

The scalable gain comes from channel/playlist inventory plus exact episode
crosswalks—not from assuming that all 30 channels, or all videos within them, are
universally playable.

The package envelope uses the resource-review registry contract and remains at
`discovered` / `HOLD`. The streaming-source manifest has its own stricter,
domain-specific test contract because it records public publisher discovery
surfaces rather than downloadable assets; the envelope prevents that distinction
from being mistaken for cleared rights or an approved acquisition.

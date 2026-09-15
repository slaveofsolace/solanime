# Official YouTube second-wave approval registry

This registry is an explicit, fail-closed crosswalk for 98 full-episode uploads identified by the 2026-09-15 v3 official-publisher review. It is application code, not a runtime dependency on the external review artifact, and it does not use fuzzy title matching.

## Included rows

| Publisher policy | Catalogue title | Exact `sub` episodes |
| --- | --- | ---: |
| Anime! on TMS Official Channel | Tetsujin 28 | 1–26 (26) |
| Anime! on TMS Official Channel | God Mazinger | 1–23 (23) |
| Anime! on TMS Official Channel | Actually, I am… | 1–13 (13) |
| Anime! on TMS Official Channel | We Rent Tsukumogami | 1–12 (12) |
| Anime! on TMS Official Channel | Brave 10 | 1–12 (12) |
| It's Anime powered by REMOW | Boogiepop Phantom | 1–12 (12) |
| **Total** | **6 titles** | **98** |

Every row pins the Anikoto title source ID and slug, episode source ID and number, `sub` version source ID, reviewed local episode/version IDs, exact YouTube video ID and title, official publisher channel identity, and observation time. Runtime lookup uses the stable source identifiers and fails if any catalogue identity drifts.

## Evidence and gates

- TMS publisher and title-family evidence: [Anime! On TMS Official YouTube Channel](https://tmsanime.com/anime-on-tms-official-channel).
- REMOW service identity evidence: [REMOW services](https://www.remow.com/en/service/).
- The source review required an official channel identity, a duration longer than 15 minutes, an embeddable response observed from the United States, exactly one matching catalogue `sub` version, and no existing official-YouTube mapping.
- The application’s existing YouTube approval path separately checks the live oEmbed title, uploader label, uploader URL, and exact embedded video ID before an approval may be applied.

On 2026-09-15, all 98 rows passed a fresh request to YouTube's public oEmbed endpoint: 98 exact upload titles, publisher labels and handle URLs, and embedded video IDs matched; no request failed. The external verification record is `official-youtube-publisher-review-20260915-v3/second-wave-oembed-verification.json` (SHA-256 `dec1ad47401b774de2b66b87790a66d1b90499c2ba6e33ab3dd64904b8b0059a`). It is identity and current embed evidence only, not media-progression evidence.

## Deliberate exclusions

The registry does not contain the 143 held English-dub uploads for Sonic X, The Devil Lady, Sherlock Hound, and Cybersix because those catalogue targets expose only `sub` versions. It also excludes New Tetsujin 28 episodes 27–51, Saint Seiya: The Lost Canvas, and The Gutsy Frog. The latter two families did not have a unique correct catalogue target: Lost Canvas pointed at Knights of the Zodiac, while Gutsy Frog produced ambiguous unrelated fuzzy hits.

## Activation boundary

`SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS` is a reviewable registry only. It is not included in the active approval list by this change, does not modify the catalogue database, and does not make a production playback claim. A separate reviewed integration change must add it to the approval command, rerun live identity checks, apply it to the intended database, rebuild the cloud catalogue artifacts, and verify playback on the deployed origin.

YouTube and the uploader retain control over availability, geography, embedding, and removal. oEmbed success establishes identity and current embed support; it does not prove media progression. The application embeds publisher-hosted media through YouTube’s supported player and does not copy or redistribute the media file.

# Episode still source review (2026-09-29)

This is a candidate-source review, not an approval to bulk-import images. The live Solanime title API was read on 2026-09-29. The sampled episodes below returned no `thumbnailUrl`; full-title image coverage was not measured. Keep numbered text cards when no episode-specific still has been verified; do not fill every episode with the title poster or a generated image that appears to depict its contents.

| Solanime title and source ID | Exact Solanime episode identity | Candidate source | Coverage observed |
| --- | --- | --- | --- |
| [Unlimited Psychic Squad](https://solanime.pages.dev/api/titles/unlimited-psychic-squad-h8xyy), Anikoto `686` | 12 episodes; episode 1 is internal ID `124545`, source ID `11682` | [TVmaze show 15210](https://api.tvmaze.com/shows/15210/episodes) | 12 episodes, **zero** episode images |
| ["Deji" Meets Girl](https://solanime.pages.dev/api/titles/deji-meets-girl-fkgwz), Anikoto `6883` | 12 episodes; episode 1 is internal ID `39378`, source ID `105626` | [TVmaze show 58299](https://api.tvmaze.com/shows/58299/episodes) | 12 episodes, **zero** episode images; TVmaze also has only generic episode labels |
| [One Piece](https://solanime.pages.dev/api/titles/one-piece-odmau), Anikoto `1642` | 1,178 episodes; **internal ID `508` is absolute episode 1**, while internal ID `1015` is absolute episode 508 | [TVmaze show 1505](https://api.tvmaze.com/shows/1505/episodes) | 1,181 regular episode records, 1,177 with images; includes episodes newer than Solanime's current inventory |

The TVmaze One Piece list is in air order. Its `season` is a calendar year and its `number` resets each season, so those fields cannot be joined directly to Solanime's absolute episode number. Spot checks of the list's ordinal, title and airdate against the primary [official One Piece episode 1](https://one-piece.com/anime/1/index.html), [episode 508](https://one-piece.com/anime/508/index.html), and [episode 1000](https://one-piece.com/anime/o5961/index.html) pages agree:

| Absolute episode | TVmaze episode ID and airdate | Candidate landscape still URL |
| --- | --- | --- |
| 1 | `256125`, 1999-10-20 | `https://static.tvmaze.com/uploads/images/medium_landscape/293/734143.jpg` |
| 508 | `256632`, 2011-07-31 | `https://static.tvmaze.com/uploads/images/medium_landscape/294/736238.jpg` |
| 1000 | `2211448`, 2021-11-21 | `https://static.tvmaze.com/uploads/images/medium_landscape/419/1048178.jpg` |

These three checks do **not** establish a safe 1,178-row crosswalk. Recaps, specials, missing entries, and future episodes can shift ordinals. Before attaching a still to an Anikoto episode, store a reviewed, one-to-one mapping from title source ID + episode source ID + absolute number to the TVmaze episode ID, with the external episode title and airdate as evidence. Reject duplicate or conflicting pairs and leave `thumbnailUrl` null when the match is uncertain. Use a dry-run report before any database write, and make a first release batch small enough to review image by image. The current schema can store the URL, source page and reuse status in `episodes.thumbnail_url`, `thumbnail_origin`, and `thumbnail_reuse_status`.

## Source use

[TVmaze's API](https://www.tvmaze.com/api) says episode images are landscape, permits direct image links and caching, and licenses API use under CC BY-SA with attribution. Its [copyright policy](https://www.tvmaze.com/site/copyright) describes the categories of material it accepts. This is a basis for an attributed TVmaze integration, but the API response does not provide per-image ownership or permission evidence for each anime still. Before a release that redistributes or caches the stills, review the image rights and attribution treatment, especially if the app becomes commercial. Show a link to the relevant TVmaze episode and credit TVmaze in the UI or credits where its material appears.

[TMDB's episode-image endpoint](https://developer.themoviedb.org/reference/tv-episode-images) could supply candidate stills, but it needs an API key and a verified series/season/episode crosswalk. [TMDB's FAQ](https://developer.themoviedb.org/docs/faq) says free API image use is for noncommercial projects with prescribed attribution, and commercial use needs a separate license. No TMDB stills were imported in this review.

[Crunchyroll's Unlimited Psychic Squad page](https://www.crunchyroll.com/series/GRWEMM83R/the-unlimited-hyobu-kyosuke) confirms its numbered English episode titles. Its [terms](https://www.crunchyroll.com/tos) restrict copying and integration of its images and content into other apps. Use the episode list as a manual identity cross-check only; do not copy or hotlink its thumbnails without permission. The title's source already exposes specific names, so there is no image coverage gain from this route.

## UI behavior until a still is verified

Use an accessible number/title row with a restrained visual marker. Reserve the episode thumbnail slot for an actual episode still with recorded provenance. Do not promote title posters, unrelated backdrops, or AI art into episode `thumbnailUrl`. Distinguish a missing image from a failed download; neither changes the episode identity or watch route.

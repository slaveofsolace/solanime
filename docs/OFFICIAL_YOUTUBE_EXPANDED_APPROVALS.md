# Official YouTube expanded approvals

This registry contains 133 manually reviewable, deterministic catalogue-to-video crosswalks:

- 64 subtitled episodes of **God Mars**, published by Anime! on TMS Official Channel.
- 69 subtitled episodes of **Yakitate!! Japan**, published by It's Anime powered by REMOW.

Each record fixes the Solanime title, regular episode, language version, YouTube video ID, exact observed video title, publisher channel, and observation time. The records are exported from `server/ingestion/youtubeOfficialExpandedApprovals.ts`; they are deliberately separate from the default approval registry and do not modify a database merely by being imported.

## Evidence and boundary

- TMS identifies its official YouTube channel, God Mars, and full-episode programming on [Anime on TMS Official Channel](https://tmsanime.com/anime-on-tms-official-channel).
- REMOW identifies It's Anime as its full-length animation distribution service on the [REMOW service page](https://www.remow.com/en/service/).
- All playback remains the standard YouTube privacy-enhanced embed. Solanime does not extract, proxy, download, or rehost media, and preserves YouTube controls, branding, advertising, regional availability, and uploader restrictions.

Publisher identity and public embed availability do not transfer copyright or establish a general reuse licence. These explicit records represent only the reviewed mapping contract; production activation remains a separate release decision.

## Verification snapshot

On 2026-09-15, YouTube oEmbed returned the exact stored title, publisher identity, handle, and embed video ID for episodes 1, 33, and 64 of God Mars and episodes 1, 35, and 69 of Yakitate!! Japan.

All 133 records were also checked against an immutable catalogue copy:

- every title, regular episode, source ID, and subtitled version resolved exactly;
- no proposed video/version pair already existed;
- the first application added exactly 133 mappings, native resources, and verification observations;
- a second application added no rows;
- SQLite integrity passed and foreign-key violations remained zero.

The repository test `tests/youtube-official-expanded-approvals.test.ts` enforces counts, consecutive episode coverage, unique IDs, exact publisher policies, URL construction, and fail-closed publisher validation.

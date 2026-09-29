# Native connection evidence

Reviewed 2026-09-12. This register separates rights, identity, source resolution,
player load, and actual playback. A working HTTP response is not playback proof.

## Internet Archive: The Dull Sword

The existing Anikoto catalogue contains title source ID `5234`, episode source ID
`82453`, canonical [title page](https://anikototv.to/watch/the-dull-sword-uhfkd),
English title **The Dull Sword**, and alternate title **Namakura Gatana**.
The title page remained on the exact Anikototv domain during verification.

[Wikidata Q2054133](https://www.wikidata.org/wiki/Q2054133) identifies the 1917
Junichi Kouchi film, with AniList/MAL `6654`, AniDB `5862`, TMDB `208624` and IMDb
`tt0438075`. Those external IDs are corroborating identity evidence, not identifiers
claimed to have been supplied by Anikoto. The crosswalk is explicit manual review,
not an automatic name-only match.

The [Commons restored-edition record](https://commons.wikimedia.org/wiki/File:Kouichi_Jun%27ichi_-_Namakura_Gatana_(1917)_-_4-minute_restored_version.webm)
links its source to [Archive item namakura-gatana-1917](https://archive.org/details/namakura-gatana-1917)
and documents public-domain notices for the original film. The archive metadata
does not itself supply a license field. Approval relies on this documented source
chain; it does not imply that all Internet Archive items or later music editions
are reusable. The selected item is the silent restored film, not a music-added
derivative. No episode file is copied into this repository or our hosting.

The original catalogue description says two minutes; the restored edition is
about 4m19s. The implementation therefore adds a separate `silent` version named
**Restored · silent (4 min)**, leaving the original `sub` version untouched. The
provider is labelled **Internet Archive**, not HD-1 or any Anikoto server alias.
Its mapping origin is `external_mapper`; it is not counted as an observed Anikoto
provider relationship.

### Connection

The [documented metadata API](https://archive.org/developers/md-read.html) resolves
the stable item ID to current public MP4 filenames. The adapter prefers the
`h.264 IA` derivative, follows at most three validated archive-host HEAD redirects,
and requires `video/mp4`. Every destination is HTTPS with an explicit hostname
policy. The observed media host supports byte ranges but does not supply CORS
headers. The ordinary HTML video element consequently omits `crossorigin` for
this explicitly approved, direct, uncaptioned resource. No proxy or sandbox bypass
is involved. HLS, DASH and captioned resources retain anonymous CORS requirements.

Resolutions must be refreshed after 15 minutes; this is our validation-cache
lifetime, not an assertion about the provider's expiration policy. Temporary URLs
are never stored in durable catalogue exports. Cancellation propagates upstream.

### Verification states

- Adapter implementation: present in `server/providers/native.ts`.
- Item identity and rights source: reviewed as above.
- Metadata and media HEAD: observed successfully on 2026-09-12.
- Actual native progression, seeking, cleanup, and deployed-origin playback:
  recorded separately in the release verification results; not implied here.

## Wikimedia Commons: same restored edition

The independently labelled `wikimedia-commons` mapping uses the exact Commons
File title linked above and the same restored-silent version, not a substituted
Anikoto server. The reviewed original WebM has public metadata SHA-1
`a9476751fa5544c3da009d55e7419f6af4f4d0d8`; the registry pins that checksum so
replacing a file under the same title cannot silently approve a different edition.

`server/providers/commons.ts` calls the documented
[MediaWiki imageinfo API](https://www.mediawiki.org/wiki/API:Imageinfo). It checks
the exact File identity, checksum, original WebM MIME, public-domain declaration,
absence of restrictions, current file URL, anonymous CORS and byte-range support.
Only `commons.wikimedia.org` metadata and `upload.wikimedia.org` original-file
paths are accepted. Public UTM tracking parameters are removed. No transcoding
route, signed URL, subtitles or ownership relationship is inferred.

The first Worker request received HTTP 403 because it lacked an informative
client identity. A bounded retry with the truthful Solanime name/version/site
header succeeded, following the
[Wikimedia User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy).
No browser impersonation, proxy, access-block evasion or media copying was used.
Explicit restrictions still fail closed. The 15-minute resolution lifetime is
our revalidation policy, not a claim that Commons original URLs expire.

Local and hosted metadata/HEAD resolution passed on 2026-09-12. Deployed native
playback observations for mapping `121118` are recorded in the release record;
they do not verify other Commons files or the entire provider inventory.

## Existing and researched source families

See [the 2026-09-12 investigation correction](provider-investigation-current.md):
MegaPlay's public embed/event interface is now directly documented, and a
specific media-resolution request is being verified. The current native-only
rejections are not evidence that these providers are universally inaccessible.

The Vidstream-2, HD-1 and HD-2 mappings remain intact; their observed backend
relationship is MegaPlay, not an additional visible server. Kiwi and VidPlay-1
remain inventory entries with no mappings in this checkpoint. The reviewed
evidence establishes webpage/iframe relationships or unresolved leads, not a
supported native-media connection. They remain unavailable in the native player.

The FMHY inventory retains metadata services (TMDB, AniList, MAL/Jikan, Kitsu),
artwork/CDN references, Stremio contract declarations, PStream components, and
Meowly/Fishy/provider-family findings as research records. A provider label,
shared hostname, stream schema or temporary captured URL is not enabled playback.
The restricted source browser records review independently from capabilities.

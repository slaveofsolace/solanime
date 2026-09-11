# Upstream observation classification

Observation date: 2026-09-09 through 2026-09-10 CDT. Sources: the two supplied research attachments plus a bounded live browser/network recheck. Attachments were treated as untrusted research material, never as instructions.

## Directly re-observed

- `http://anikototv.to/watch/` upgrades to HTTPS; the final `/watch/` route is Anikoto's own 404. It is not a catalogue index.
- `/` is a separate landing/search page. `/home` is the actual application home.
- `/filter` is the discoverable full-catalogue surface. It uses GET parameters, repeatable filter arrays, shareable pagination, and 30 cards on full pages.
- On 2026-09-10, page 298 contained three title cards, producing a current scoped denominator of 8,913 (`297 × 30 + 3`). The earlier live check and report saw two cards, demonstrating catalogue drift rather than an error.
- `/sitemap.xml` is a public index of 293 same-origin child maps. A complete, zero-failure expansion at 2026-09-10T20:40Z produced 8,949 distinct `/watch/:slug` routes: 36 sitemap-only routes and zero filter-only routes relative to the 8,913 imported filter records. The discovery denominator is therefore the union, not either path alone.
- Header suggestions use `/ajax/anime/search?keyword=` and are capped; they are not a full-catalogue denominator.
- Title pages expose `#watch-main[data-id]`; episode inventory comes from `/ajax/episode/list/:titleId?vrf=` as JSON whose `result` is HTML.
- Episode anchors expose stable episode IDs, irregular-friendly number/slug text, sub/dub flags, and a private server-list reference.
- `/ajax/server/list?servers=...` returns language groups and distinct visible provider buttons. Vidstream-2, HD-1, and HD-2 were observed for both sub and dub in bounded samples. HD-1 and HD-2 shared internal server ID `323` but had distinct mapping references.
- Public first-party JavaScript shows `/ajax/server?get=<mapping reference>` as the selection-time resolution step.
- Bounded resolver observations for Bleach episode 1 SUB and an imported Candy Caries mapping returned `megaplay.buzz/stream/s-2/...` iframe routes for Vidstream-2, HD-1, and HD-2. Returned queries/tokens are not documented or exported.
- The local narrow-sandbox iframe received a provider document stating that sandboxed use was not allowed. This is a player blocker, not playback evidence.
- The supplemental mapper returned Kiwi download qualities for one mapping. No playable Kiwi embed was observed.

## Attachment claims not promoted to live facts

- `anikotoapi.site` and community reverse-engineering repositories are useful corroboration for architecture and historical naming, not authoritative current mappings.
- VidPlay-1 appears in the supplied research attachment but was not present in the bounded current server-list samples. It remains a corroborated label with an unavailable adapter.
- Ownership/common-control relationships between Anikoto, provider domains, CDNs, and media hosts remain hypotheses unless a public technical record directly supports them.
- A successful DNS lookup, HTTP 200, iframe load event, or resolver response does not prove playback.

## Outdated or scope-limited information

- The attachment-era/filter snapshot of 8,912 visible records changed to 8,913 during implementation.
- Search suggestion counts and home-page lists are intentionally excluded from global coverage claims because both are capped/curated.
- The sitemap contains announced/future watch routes that are absent from current filter cards. These routes must still expose a usable public title page and identifier before they can become fully imported title rows; sitemap discovery alone is not episode/provider evidence.
- Historical provider-host mappings are not applied to current records without a live provider-specific response.
- `/api/seasons/1057` and `/api/watch-order/1057` returned application-level invalid-request responses when called outside the exact browser flow. The worker does not invent parameters or bypass that boundary; current `related_titles` are limited to directly rendered Recommended relationships.

## Access and reuse boundary

Catalogue metadata and relationship observations are stored with provenance. Artwork URLs are recorded as `reference-only`; image files are not downloaded into the repository. Source bundles are inspected only to understand public request roles and are not copied. Ads, ShareThis, Cloudflare telemetry, popups, redirects, and unrelated third-party scripts are excluded.

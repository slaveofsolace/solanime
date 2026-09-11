# Architecture and request chains

## Independent application

```text
Public Anikoto catalogue HTML
        │  rate-limited GET /filter?page=N + /sitemap.xml child maps
        ▼
catalogue_page/sitemap tasks ── reconcile watch-route union ── upsert title shells ── enqueue title detail
        │
        │  GET /watch/:slug
        │  GET /ajax/episode/list/:sourceId?vrf=
        ▼
title_detail task ── upsert metadata/episodes/versions ── enqueue episode_servers
        │
        │  GET /ajax/server/list?servers=<stored private reference>
        ▼
episode_servers task ── upsert distinct mappings or record verified empty provider inventory
        │
        ▼
SQLite WAL database + crawl queue + coverage + verification observations
        │
        ├── browse/detail/filter/export/admin APIs
        └── mapping selection → dedicated adapter → first-party temporary resolver
                                      │
                                      └── allowlisted provider embed URL
```

No source-site JavaScript is shipped. Cheerio parsers independently interpret stable public HTML attributes and JSON envelopes observed in normal browser requests. Parser-shape failures are durable task errors, not empty-record updates.

## Observable upstream chain

```text
/filter?page=N
  → title card: data-tip title ID + /watch/:slug[/ep-1]
  → /watch/:slug: #watch-main data-id
  → /ajax/episode/list/:titleId?vrf=
  → episode data-id + sub/dub flags + private server-list reference
  → /ajax/server/list?servers=<reference>
  → language group + visible label + server ID + private link reference
  → /ajax/server?get=<private link reference> (only at selection time)
  → provider-supported iframe URL, if currently resolvable and allowlisted
```

The public sitemap index is expanded through durable `sitemap_index` and `sitemap_page` tasks. Same-origin watch routes absent from the filter-derived database become `sitemap_title` tasks; those pages must expose `#watch-main[data-id]` before the normal title → episode → provider chain proceeds. Queue keys deduplicate overlap across 293 child maps.

The frontend never receives the private server-list reference. It selects a numeric internal mapping ID. The backend looks up that row, applies the dedicated provider adapter, validates the upstream response, and returns a temporary player result.

## Data ownership

- `titles` owns aliases, genre joins, related-title observations, and episodes. Schema 4 links each relation to its imported internal title when available while preserving the original source ID/URL for unresolved observations.
- `episodes` own language/version rows; irregular number text is preserved separately from numeric sort hints.
- `episode_versions` own provider mappings.
- `providers` represent visible provider identities; `provider_connections` represents observed hostname relationships. A shared hostname does not merge buttons.
- `crawl_runs` and `crawl_tasks` form the durable work queue.
- `verification_observations` records evidence stages without promoting a source-resolution response into a playback claim.

## Failure and freshness model

Availability is not a boolean. Records and mappings distinguish observed, available, unavailable, blocked, stale, and unknown states. Rows retain first-seen, last-seen, last-successful-import, last-successful-resolution, and last-playback-verification timestamps where applicable.

Sparse refreshes use `COALESCE` for descriptive fields and upserts for child rows. A transient failure or missing field cannot delete previously verified episodes or mappings. After a separately verified complete title or server-list observation, child rows absent from that response are marked `stale`; they are never deleted. Delayed, failed, blocked, or schema-invalid responses do not trigger reconciliation.

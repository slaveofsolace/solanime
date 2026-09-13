# Wikipedia Movie and TV metadata import

`pnpm import:wikipedia --` is a bounded, no-key metadata importer for public English Wikipedia category listings. It is used instead of hardcoding Movy's deployment-specific Next.js build route or copying the TMDB credential observed in Cinejoy's browser requests.

The importer has two independent lanes: `--media=movie` reads article members of `Category:<year> films`, and `--media=tv` reads `Category:<year> television series debuts`. The year defaults to the current UTC year and can be set explicitly. Each lane stores its official MediaWiki `gcmcontinue` token in `external_catalogue_sync.checkpoint_json`, so a later run resumes after the last committed response. Each accepted article must expose a Wikidata Q-ID; rows without one are counted and skipped. Movie and TV records use separate `wikipedia-movie` and `wikipedia-tv` source namespaces, and repeated Q-IDs update the same `(source, Q-ID)` title instead of adding duplicates.

Imported fields are limited to the stable Q-ID, English Wikipedia source URL, article title and plain-text introduction, Movie/TV format, category year, a conservative genre vocabulary derived from public article categories/short descriptions, Upcoming status when categorized that way, and the page image returned by the MediaWiki API. Anime-categorized pages are skipped. Page-image aspect ratio is recorded only as a poster or backdrop candidate, and `artwork_reuse_status` remains `unknown` because the individual file license is not resolved by this batch request.

Example bounded runs against a separate database:

```text
pnpm import:wikipedia -- --db=E:\CodexProjects\solanime-imports\catalogue.sqlite --media=movie --year=2026 --batch-limit=1 --page-size=25
pnpm import:wikipedia -- --db=E:\CodexProjects\solanime-imports\catalogue.sqlite --media=tv --year=2026 --batch-limit=1 --page-size=25
```

This is not a full Movies/TV catalogue. Coverage is only the selected public category, year, and fetched continuation batches. The importer adds no episodes, provider mappings, embeds, playback media URLs, account data, source-site keys, or media bytes. It sends an identifying user agent, paces requests, honors `Retry-After`, bounds retries and response size, and caps an individual API response at 50 article members.

References:

- <https://www.mediawiki.org/wiki/API:Categorymembers>
- <https://www.mediawiki.org/wiki/API:Etiquette>
- <https://www.wikidata.org/wiki/Wikidata:Licensing>
- Local observations: `docs/source-observations/2026-09-12.json` and `docs/source-observations/2026-09-13.json`

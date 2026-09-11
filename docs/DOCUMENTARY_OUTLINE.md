# Documentary demonstration outline

## 1. Establish the scope

- Show the supplied `/watch/` URL upgrading to HTTPS and ending at a site-owned 404.
- Contrast the landing page, `/home`, capped search suggestions, and `/filter` pagination.
- Expand the 293-child public sitemap index and reconcile it with `/filter`: 8,949 union routes, including 36 sitemap-only announced/future titles in the dated observation.
- State the claim precisely: reconstruction of publicly observable records, not possession of an operator's private database.

## 2. Follow one public record

- Open a filter card and identify the title route and source ID.
- Show the title-page `data-id` feeding the episode-list request.
- Compare episode ID, number/slug, and independent sub/dub flags.
- Open the server selector and show why HD-1 and HD-2 remain distinct despite a shared server ID/hostname.

## 3. Show the independent implementation

- Diagram the durable queue and SQLite relationships.
- Interrupt and resume a run; show the same task being safely reclaimed.
- Show discovery-stage priority, a retryable loading placeholder, a verified empty episode inventory, and soft-stale reconciliation without deletion.
- Query the local browse API, then navigate catalogue → title → episode/version → servers.
- Emphasize that frontend results come from SQLite, not a fixture or exported JSON file.

## 4. Provider evidence ladder

- Mapping imported.
- Temporary source resolved through the ordinary first-party selection endpoint.
- Provider document responded in the sandbox.
- Provider rejected sandboxed playback.
- Playback remains unverified.

This sequence demonstrates why HTTP 200 and iframe load are not equivalent to playing media. Show the manual provider fallback without opening it during the documentary unless content permissions are separately confirmed.

## 5. Safety and provenance

- Show allowlisted source hosts, database-backed resolver IDs, redacted exports, and the resource registry.
- Confirm that source bundles, session data, ads, trackers, and episode media are absent.
- Show that artwork is referenced remotely and marked `reference-only`, not copied into the repository.

## 6. QA and honest close

- Run unit/parser/queue tests, TypeScript, production build, database integrity, and the desktop/mobile Playwright matrix.
- Generate the nested JSON/CSV coverage exports, create an online backup, restore it to an alternate path, and run the same integrity verifier there.
- Show light/dark, reduced motion, keyboard focus, deep-link refresh, source switching, and unavailable-provider messaging.
- End with exact imported/discovered/pending/failure counts from `pnpm import:status`, the database path, dated provider states, and the resume command if enrichment is still running.

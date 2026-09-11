# Sol Anime implementation checklist

Updated: 2026-09-10 America/Chicago

## Completion gates

- [x] Read both supplied research reports in full.
- [x] Confirm the repository is empty and establish the canonical physical root at `E:\CodexProjects\solanime`.
- [x] Verify `http://anikototv.to/watch/` redirects to HTTPS and that `/watch/` itself is a real 404.
- [x] Verify the current public catalogue, filter, title, and episode-list request shapes without playing or downloading media.
- [x] Implement migrations and the persistent SQLite schema.
- [x] Implement resumable, idempotent catalogue/title/episode/provider ingestion with explicit budgets and retry records.
- [x] Run a real vertical-slice import and structural-integrity checks.
- [x] Audit all 298 currently observable filter pages and all 293 public sitemap children; establish the 8,949-route union (8,913 filter records plus 36 sitemap-only routes).
- [x] Complete the durable application run for all 36 sitemap-only title routes and reconcile their episode inventories.
- [x] Link all 107,245 related-title observations to imported internal titles and verify zero unresolved relations.
- [x] Distinguish contextual empty provider inventories from delayed, malformed, blocked, and failed server-list responses; requeue transient failures without deleting mappings.
- [ ] Complete all per-episode provider-mapping tasks; preserve exact remaining queue state if interrupted.
- [x] Implement an explicit adapter for every currently observed provider label, with fail-closed unavailable states where supported embedding cannot be established.
- [x] Connect browse, search, title, episode/version, provider selection, and playback UI to the populated database.
- [x] Implement local watchlist, history, preferences, deep links, pagination, cancellation, and stale-response rejection.
- [x] Verify server switching and browser Back/Forward synchronization; prevent failed auto-resolution loops and stale episode/language responses.
- [x] Implement token-gated admin diagnostics, pause/resume/retry, coverage export, JSON/CSV export, and database backup/restore.
- [x] Run unit, database-integrity, browser, accessibility, responsive, console/network, and visual acceptance checks for the implemented vertical slice.
- [x] Capture local evidence and write the documentary request-chain outline.
- [ ] Finish the durable per-title/episode/provider enrichment queue and regenerate final exports, backup, coverage ledger, and exact handoff from the completed run.

## Protected invariants

- External design references are read-only input material and are not part of this repository.
- No copyrighted episode files, session cookies, tokens, signed media URLs, or raw secret-bearing captures enter the repository.
- No CAPTCHA, DRM, authentication, access-block, or anti-bot bypass.
- Publicly visible labels and identifiers are observations; provider ownership and hidden origins remain inference unless independently corroborated.
- A provider adapter, successful resolution, loaded player, and verified playback are separate states.
- A partial import remains partial and resumable; it is never reported as the complete catalogue.

## Current alpha state

The staged alpha database is structurally valid and populated, but the durable provider-enrichment tail is not finished. Resume the run with `pnpm import:detached <run-id>` after publication if continuing the full import.

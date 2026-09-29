# Solanime implementation handoff

Resume the ongoing Solanime UI/player work and use the research dataset on `data-dump/fmhy-video` as an evidence base. This is an implementation task, not a request for another plan or cosmetic pass.

## 1. Preserve current work and establish the real baseline

Inspect the latest application branch/PR, working tree, commits, tests and deployment state first. The separate UI/player redesign is already in progress. Do not reset it, replace it with main, overwrite uncommitted work or assume the old v0.5 state was accepted. The research branch is based on the older main solely for isolation; import only `data-dump/`, not its application baseline. Work on a reviewable integration branch and do not deploy or merge to production without review.

Read `data-dump/README.md`, `SUMMARY.json`, `reports/architecture-map.md`, `reports/architecture-footprints.md`, `reports/shared-infrastructure.md`, `reports/data-quality-audit.json`, `reports/validation.json`, `indexes/coverage.json` and the curated claims before making integration decisions.

The inventory is broad, but infrastructure depth is incomplete. A source literal is not a tested API, a metadata host is not a video host, a listed mirror is not automatically verified, and a shared CDN/IP/bundle is not proof of the same backend. Never turn uncertain research into a working-provider claim.

## 2. Make the complete dataset usable without discarding entries

Implement a validated import and query layer for the entire dataset, with stable IDs, aliases, provenance, observation dates, confidence and research status. Retain all categories and observations, including unavailable, old, unverified and unsupported entries. Do not discard data merely because it is not immediately useful for playback.

Keep research status separate from operational integration status. Example operational states: research-only, needs-verification, approved-metadata, approved-subtitles, approved-native-media, approved-controlled-embed, unsupported, temporarily-unavailable and retired. Every state change needs evidence and a reason. Unknown authorization or incomplete endpoint behavior must not silently become enabled production playback.

Use `valid_hostname`, `reference_class`, repository verification state and edge verification scope. Preserve unresolved URL expressions and documentation placeholders as research data, but never attempt to call them as concrete endpoints. Canonicalize aliases without losing the original observed URL or redirect chain. Do not automatically activate every discovered domain, script or API.

Provide a searchable operator-facing research/source browser with categories, statuses, provider relationships, evidence and unresolved tasks. Keep engineering diagnostics out of the ordinary viewing interface. No runtime execution of untrusted research strings, HTML or downloaded repository code.

## 3. Build explicit source adapters, not a universal URL scraper

Separate adapter contracts for catalog/search, metadata/identifier mapping, artwork, subtitles, playback resolution, supported embeds and account integrations. Keep account synchronization separate from source resolution and media transport.

For each proposed integration, inspect its current official documentation/source, identify the actual public or authorized interface, verify configuration/authentication/terms requirements, and record the supported functions. Prioritize evidenced shared components so one adapter can serve multiple frontends without duplicating code.

Implement metadata adapters and explicit IMDb/TMDB/MAL/AniList mappings only where supported and configured. Do not infer IDs by matching title text alone. Handle alternative titles, seasons, specials, episode offsets, sub/dub variants, missing metadata and conflicting matches with explicit uncertainty.

Stremio-style adapters must respect manifest resource capabilities: catalog, meta, stream and subtitles are different contracts. Inspect the specific addon instance and its configuration rather than assuming every fork or public instance exposes the same behavior. Add plugin/adapter interfaces for systems that cannot yet be integrated, retaining their research records with precise reasons.

Use operator-supplied credentials through the existing secret/configuration system when required; do not copy keys, cookies or tokens from the dump. Do not bypass authentication, DRM, access controls or provider restrictions. Public visibility alone does not authorize production redistribution or arbitrary request proxying.

## 4. Finish the real Solanime player path

Trace the actual catalogue -> title -> episode/language -> server -> adapter -> resolved source -> player DOM path. Populate and exercise the native registry with genuinely supported sources; an empty registry plus provider iframes is not completion.

Define a discriminated playback result such as:

- native: supported MP4/HLS/DASH media, expiry/capabilities and subtitle information;
- controlled-embed: a documented integration contract with tested behavior and explicit limits;
- unsupported: a precise reason and linked evidence.

For native playback, render a real media element with Solanime-owned play/pause, seek, time, volume, speed, captions, fullscreen, theater, keyboard/touch controls, loading/errors and episode navigation. Preserve position and intended playback state through supported source changes. Handle expiring URLs, abort stale requests, distinguish resolution errors from playback errors and avoid cross-profile progress writes.

Never silently downgrade native playback to an unrestricted advertising iframe. Do not cover or hide an iframe to pretend its controls and scripts were removed. Do not describe removing sandbox restrictions as popup blocking. Unsupported sources should fail clearly and remain in the research/source browser, not regain unwanted redirects through a fallback.

Any media proxy must be narrowly scoped to explicitly supported and permitted upstreams. Enforce URL/redirect/DNS safety, size/time limits, content types, cache policy and secret handling. Do not create an open proxy or use it to defeat upstream access controls.

## 5. Integrate with the ongoing design and existing application

Preserve the substantial site-wide UI/animation redesign, cleaner surface hierarchy and playback-first watch page. Use one design system; do not add a box for every source detail or turn the watch page into a research dashboard.

Retain registration/login, the five-profile limit, profile isolation, watchlists/history/watched episodes, appearance/reduced-motion preferences, account/session security, accessibility, responsive behavior and catalogue integrity. Do not overwrite `.env`, `data/private/`, newer catalogue imports or existing native-source configuration.

Add per-adapter request limits, timeouts, cancellation, cache/expiry rules, bounded retries and circuit breakers. Keep unavailable sources from stalling the whole interface. Record sanitized diagnostics and explicit failure reasons without storing signed media URLs or credentials in logs. Maintain an operator-controlled refresh/review workflow for changing domains and providers; do not auto-enable a replacement because an old URL redirected there.

## 6. Validate behavior, not labels

Add schema and referential-integrity tests, adapter contract tests, identifier-mapping edge cases, source capability tests, SSRF/open-proxy checks and account/profile isolation regressions.

For the actual supported player path, test Play, video-area clicks, seeking, captions, fullscreen, source/server changes, episode changes and reload. Assert no unexpected tabs, windows, parent navigation or unsafe fallback. Use real media events; an iframe load event, invented playback event or mocked success response cannot certify playback.

Use controlled fixtures and authorized test footage for reproducibility, plus explicitly scoped live checks of each enabled integration. Separate fixture success, public endpoint validation, browser runtime observation and real playback verification in the report. Retain failures and blocked cases instead of deleting tests or disguising retries.

Visually inspect the integrated desktop/tablet/mobile watch, discovery, account and source-management screens, including a narrow 320px viewport. Maintain reduced-motion and keyboard/focus behavior. Test current supported browsers and label physical-device coverage honestly.

## 7. Deliver implementation and honest coverage

Implement everything supported by verified interfaces and current permissions. For remaining research-only or unsupported items, deliver the typed adapter boundary, evidence, exact blocker and next verification step rather than fabricating a connection or silently omitting the entry.

Push a dedicated integration branch/PR, provide the exact commit SHA, an updated-source ZIP, precise macOS and frontend/backend deployment instructions, screenshots and a reproducible QA report. Include a per-source matrix showing research evidence, implemented capabilities, actual live checks, unresolved gaps and why disabled sources remain disabled.

Completion means the live Solanime application visibly uses the redesigned interface and genuinely supported custom-player integrations. It does not mean a large dataset exists, an iframe loaded, or the source registry has names without working adapters. Do not call universal ecosystem integration complete while unsupported providers or unresolved playback chains remain.

## Supplemental source audit

Also read `curated/README.md` and `curated/source-audit.json.gz`; use `curated/query.py` for evidence bindings, shared providers and combined coverage. The Meowly/FishyStream provider declarations are implementation leads, not validated native streams. Preserve exact domains, distinguish empty Direct mapping sentinels from servers, and verify custom-player capability before integrating a provider. Do not add supplemental counts to bulk counts without deduplicating shared entities. The combined coverage joins differing observation methods rather than pretending every site passed the same crawler.

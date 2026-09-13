# Architecture and request chains

## Independent application

The hosted runtime is React/Vite on Pages, an asynchronous Workers API, and three
D1 databases: catalogue, private accounts, and operator research. The local
Node/SQLite API and ingestion worker remain supported. See the runtime and
durable queue diagram in [CLOUD_RELEASE.md](CLOUD_RELEASE.md).

The frontend searches imported rows through `/api/titles`, loads a title through
`/api/titles/:slug`, then selects an episode/version using
`/api/episodes/:id/providers?language=...`. A source choice posts the stored
mapping ID to `/api/providers/:mappingId/resolve`. No arbitrary upstream URL,
private account data, or research dump is accepted by the public browsing API.

## Observed source chain

```text
/filter?page=N + /sitemap.xml and its child maps
  → distinct canonical watch route and title source ID
  → /watch/:slug: #watch-main[data-id]
  → /ajax/episode/list/:titleId?vrf=
  → episode source ID, irregular number text, independent language flags
  → /ajax/server/list?servers=<stored reference>
  → language group, visible label, internal provider ID, resource reference
  → historical source selection: /ajax/server?get=<stored reference>
  → observed provider webpage relationship (not native playback)
```

This is the source's observed architecture, not a claim about its hidden origin or
private database. The supplied HTTP `/watch/` reference upgrades to HTTPS and
ends at a same-site 404; valid title routes remain on `anikototv.to`. No similarly
named replacement domain is silently used. The dated catalogue/sitemap evidence
and response shapes are in [UPSTREAM_OBSERVATIONS.md](UPSTREAM_OBSERVATIONS.md).

The original snapshot reconciles 8,913 distinct filter records and 36 sitemap-only
routes, yielding 8,949 observed title routes. It includes 298 filter pages and
293 child sitemaps. This is a dated public-discovery denominator, not a claim to
know all hidden or future source records. The dataset retains 96,339 unfinished
episode-server tasks at the source checkpoint.

## Approved native connection

```text
Existing title 3881 / episode 58614
  → independently reviewed restored-silent version 183770
  → stored provider mapping 121117
  → identity + rights approval (not just enabled=true)
  → Internet Archive documented metadata API
  → current public MP4 filename
  → bounded HEAD redirects, each destination validated
  → native result with mapping identity, capabilities and revalidation lifetime
  → Solanime video element → ordinary media host
```

The result contract is `native | unsupported`. Webpage-only mappings remain in
the catalogue but cannot load a provider frame. A resolved URL, loaded element,
and observed playback are separate evidence stages. Temporary playback URLs are
not imported into permanent exports. Native approval does not relabel an external
provider as an Anikoto server; the restored silent edition is not the original
SUB inventory. [Provider evidence](native-provider-evidence.md) records the exact
crosswalk and rights source.

## Durable import and synchronization

Local export preparation verifies SQLite integrity and foreign keys, normalizes
the complete FMHY inventory, and emits immutable bounded batches. Private Worker
assets hold the full snapshot; no raw snapshot path is served over HTTP. A D1
manifest pin, task ID, lease, per-target receipt and cursor govern the import.
Queue duplication, process interruption or lost notifications cannot turn an
uncommitted batch into completion.

Catalogue and research writes share a conservative daily budget; each delivery
stays within the free-plan query envelope. Quota exhaustion records a next-window
resume time. HTTP errors, delayed content, schema changes and access refusals
remain distinct states and do not delete good data. Unavailable providers remain
attached to their original episode/version and identity.

See [import tooling](../scripts/cloud-data/README.md) for implemented cloud
refresh task types, exact commands, quota limits and recovery behavior. Operator
research status and review actions are independent from enabled playback or
metadata capabilities.

## Data boundaries

- Titles own aliases, genres, related-title observations, episodes and provenance.
- Episodes preserve number text separately from sort hints and own version rows.
- Versions own provider mappings; external mappings carry an explicit origin.
- Providers represent visible identities; connections/aliases preserve observed
  hostname relationships without merging distinct source buttons.
- Native resources store stable references and reviewed identity/rights evidence.
- Crawl runs/tasks, receipts, budgets and observations hold resumable state.
- Account/profile data, revision conflicts, revocation and encrypted refresh
  credentials belong only to the private accounts database.
- Research records, fragments, relationships and reviews belong only to the
  restricted research database; they are not a delivered playback registry.

Source HTML/scripts are untrusted evidence. Parsers are independently written;
no source bundle, advertisement, popup code or copyrighted episode copy is
shipped. Source and media requests have fixed origins or explicit host policies,
bounded responses, timeouts and cancellation. The application is not an open proxy.

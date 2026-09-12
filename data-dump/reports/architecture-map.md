# Architecture map and interpretation

The dataset contains an observed-reference graph, not a single verified media-delivery graph. Join indexes/relationships.json, indexes/clusters.json and indexes/architecture-footprints.json. Human-readable sampled footprints are in architecture-footprints.md. Documentation-backed statements are separately typed in curated/architecture-claims.json.

## P-Stream family: separate the account server from media delivery

Documented pattern:

```text
static frontend
  +-> metadata/artwork services
  +-> account synchronization backend (progress, bookmarks, settings)
  +-> source selection -> optional media-request proxy or local component
                       -> upstream streaming source -> media host (not verified here)
```

P-Stream's documentation distinguishes those components; its account backend does not deliver video. The inspected pstream.cfd homepage/bundle records contain references to sync.pstream.cfd, TMDB/AniList artwork and metadata-related origins. Those static references are not proof that every one is used on each playback. The inspected bundle also contains names associated with other frontend frameworks; those can belong to upstream-source handling and are not attributed to P-Stream itself.

Sources: https://docs.pstream.cfd/connections ; https://docs.pstream.cfd/backend/introduction ; https://docs.pstream.cfd/proxy/introduction ; sites/site-9ca5736237e2df7e/metadata.json.

FMHY's P-Stream Forks category identifies a project family, not one shared deployed backend. Preserve site-specific evidence before deduplicating services: https://fmhy.net/video#p-stream-forks.

## Stremio ecosystem: manifests are not media URLs

```text
client -> addon manifest
       -> catalog / metadata resource
       -> stream resource -> returned source or transport -> media delivery (not verified here)
       -> subtitle resource
```

The official protocol defines separate resources. AIOStreams adds an aggregation/filtering layer over configured addons and source integrations; AIOMetadata adds a metadata/artwork layer. Neither relationship establishes which media host an arbitrary public instance uses.

Sources: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md ; https://github.com/Viren070/AIOStreams ; https://github.com/cedya77/aiometadata.

## Metadata and artwork are separate from playable media

TMDB image URLs and AniList GraphQL references belong to metadata/artwork relationships. They must not become native playback sources merely because many sites reference them. Source identifiers from IMDb/TMDB/MAL/AniList also need explicit mapping rather than title-string substitution.

Sources: https://developer.themoviedb.org/docs/image-basics ; https://github.com/AniList/docs/blob/master/README.md.

## Redirects and shared infrastructure

Observed HTTP chains are in indexes/redirects.json. For example, the Fireflix listing's pages.dev origin redirected to fireflix3.pages.dev during collection; its final page exposed Next.js asset paths. That supports a redirect and frontend indicator, not service ownership or final media delivery. Evidence: sites/site-38be832b2881c53a/metadata.json.

Shared cloud IPs, CDN services, DNS results or identical library files are weaker evidence than the same confirmed application API. Even identical client application bytes do not establish a shared account database or media backend. Keep these cluster types separate.

## What is not yet mapped

No complete authenticated or playback-activated session was performed. Provider menus generated only after episode selection, signed media URLs, quality variants, regional differences, nested ad routes, full historical domain lineage and all transitive repositories remain incomplete. Each resource retains its unvisited references and unresolved state. Do not fill missing links in a chain with a provider from a neighboring site.

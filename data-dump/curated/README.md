# Supplemental public-source audit

This layer supplements the bulk research snapshot and existing curated claims without replacing them. Observation date: 2026-09-12. Reconciled against bulk commit `04c8326f7e360084b9065b1cd35a683ecef767f5`. Read the top-level `HANDOFF.md` for implementation instructions.

`source-audit.json.gz` is UTF-8 JSON compressed with gzip. It contains 61 source documents, 121 scoped entities, 106 evidence-bearing relationships, 98 documented endpoint/route templates and 47 inspection observations. Counts overlap the bulk indexes and must not simply be added to them. No endpoint template was executed and no end-to-end playback chain is certified.

## Important findings

Meowly's public VideoPlayer source configures 11 third-party iframe providers, all with its sandbox flag disabled. FishyStream's provider catalogue declares 27 external providers; its empty Direct mapping sentinel is not an additional server. Their exact shared provider origins include Peachify, Videasy and VidKing. Same-name providers on different domains remain distinct until evidence establishes an alias.

FishyStream declares React/Vite, Convex, Clerk and HLS tooling, but a dependency declaration does not prove the public deployment runs that version or serves native video. Several provider entries declare custom-UI support; these are leads requiring live validation, not guarantees of popup-free playback.

Movy's public page links Vidy's iframe API documentation. Those iframe routes must not be classified as native media URLs. TMDB/wsrv.nl image references identify artwork handling, not final video CDNs. P-Stream documents separate account-sync backends and stream-request proxies; shared frontend ancestry does not prove a shared deployed backend. The source audit also maps metadata/subtitle dependencies and records historical/redirect observations with their scope.

Evidence URLs and exact Git blob SHAs, where obtained, are in the JSON. Verify declarations against current deployments before enabling integrations. No public reference constitutes authorization to redistribute content, copy code without license review, or use another operator's credentials.

## Offline queries

From the repository root, using Python 3.11 or newer:

```sh
python data-dump/curated/query.py validate
python data-dump/curated/query.py summary
python data-dump/curated/query.py upstreams fishystream
python data-dump/curated/query.py shared meowly fishystream
python data-dump/curated/query.py upstreams aiometadata
python data-dump/curated/query.py coverage
python data-dump/curated/query.py bindings
python -m unittest discover -s data-dump/curated/tests -v
```

`bindings` joins audit entities to bulk site/domain/repository IDs by exact URL or hostname, not presumed ownership. `coverage` joins all 946 listing occurrences to supplemental page observations. The bounded bulk run attempted 945 listings; the supplemental readable CageMatch observation accounts for the remaining primary listing. The combined view therefore records 946/946 primary inspection attempts, not 946 healthy services or complete infrastructure maps. Conflicting observations, including Reelix's unavailable bulk fetch and readable web representation, remain separate.

Generated query output is intentionally not duplicated in Git. Regenerate bindings/coverage from the current indexes. `FILE_MANIFEST.txt` describes the preceding bulk snapshot; these supplemental files are listed in `curated/FILE_MANIFEST.txt`.

## Schema and evidence scope

- documents: source URL, observation date, evidence type, capture scope, notes and optional Git blob SHA.
- entities: stable audit ID, kind, URLs, evidence references and explicit runtime-verification flag.
- relationships: source/target IDs, relation type, evidence, confidence and verification scope.
- endpoints: owner entity, route/template, method, authentication qualification, evidence and test status.
- inspections: requested URL, outcome, method scope, observation date and caveats.
- findings: concise claims with source-document IDs.

Verified source text is not verified deployed behavior. Image hosts are not media hosts. Repository archival does not establish website death. Unknown final media hosts, permissions, real player behavior and unsupported integrations remain unknown. Refresh observation dates only after repeating the relevant inspection.

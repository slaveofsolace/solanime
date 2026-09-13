# Official YouTube discovery

This worker inventories public metadata from explicitly configured anime publisher channels. It does not download, extract, proxy, or retain media URLs. A publisher uploading a video does not by itself grant Solanime a licence, so discovered records remain review-only until the separate approval gate succeeds.

## Safe inputs and outputs

The worker requires an explicit read-only catalogue path and refuses `data/solanime.sqlite`. Its output directory must be outside the repository. Use an immutable catalogue copy and a task-specific E: artifact directory:

```powershell
pnpm discover:youtube-official -- `
  --catalogue=E:\path\to\catalogue-copy.sqlite `
  --out=E:\path\to\discovery-run `
  --shard-count=500 `
  --worker-range=0-499 `
  --global-concurrency=2 `
  --per-host-concurrency=1 `
  --requests-per-second=0.75 `
  --burst=1 `
  --request-budget=5000 `
  --probe-budget=2000 `
  --max-pages=500
```

Five hundred shards are deterministic queue partitions, not 500 simultaneous requests. Multiple standalone processes can own disjoint `--worker-index=N` or `--worker-range=A-B` partitions. A source or shard lock prevents duplicate writers. Checkpoints are written atomically after every listing page and video probe.

For a hidden process that survives the invoking terminal, use `pnpm discover:youtube-official:detached` with the same arguments. The launcher writes a process manifest, append-only log, per-source inventory, per-shard probes, aggregate coverage, and a review-candidate ledger.

## Approval gate

Run the planner only against completed discovery artifacts and a source database whose SHA-256 is already known:

```powershell
pnpm plan:youtube-official -- `
  --run-dir=E:\path\to\completed-discovery `
  --config=E:\path\to\official-youtube-discovery.json `
  --source-db=E:\path\to\immutable-catalogue.sqlite `
  --expected-source-sha256=<reviewed-sha256> `
  --out=E:\path\to\fresh-batch-output
```

Eligibility requires a stable official channel and video identity, configured publisher evidence, full-episode duration, a playable embed, confirmed United States availability, one regular episode rather than a range or compilation, a unique catalogue episode/version crosswalk, compatible language, and no existing mapping. Fuzzy and scored aliases are always held. Exact aliases are also held unless a separate independently reviewed approval record proves the title and episode identity.

The planner validates the crawl ledger against every checkpoint before copying the database. Eligible approvals are idempotent; held records are never inserted. It then runs SQLite integrity and foreign-key checks and writes source/destination hashes, eligible and held ledgers, a sanity sample, and a package manifest.

Discovery, approval, player loading, and successful media progression are separate verification states. A successful metadata probe is not a playback-verification claim.

## Adding publishers without widening playback

The configuration contract is defined in `config/official-youtube-discovery.schema.json`. A new `sources` entry must use a stable YouTube channel ID, its exact canonical channel URL, HTTPS evidence from the publisher or rights holder, an explicit territory note, and `reference-only` disposition. Channel and playlist rows remain distinct so a curated playlist can coexist with its channel inventory without hiding overlap.

Adding a discovery source never enables it in the player. Playback permission is a second, explicit `playbackPolicies` allowlist keyed by the same stable channel ID and source IDs. Runtime validation rejects a policy whose channel does not match every referenced source. A policy can be added only after its provider adapter, publisher-specific approval registry, focused tests, and evidence review exist; the current configuration contains only the implemented REMOW policy.

Public page labels such as “7,002 videos” are stored as unreconciled advertised counts. They are not treated as crawl completion denominators or pending queue items. The enumerable count is the number of normalized videos reached through ordinary public playlist continuations in the observation region. Differences may represent region restrictions, member-only uploads, unavailable/private/deleted items, or an upstream listing limitation and stay visible as a coverage caveat.

On 2026-09-13, the Ani-One uploads playlist advertised 7,002 videos but its ordinary public continuation chain from the US observation region returned 29 items, then four items, then an empty terminal page: 33 enumerable records. No request or page budget, retry, redirect, parse error, or rate limit ended that chain. [Medialink’s own Ani-One page](https://www.medialink.com.hk/en/Anione.aspx) confirms daily YouTube episode uploads and a separate paid ULTRA catalogue. That supports access-tier caution but does not prove how many of the missing 6,969 labels are member-only, region-restricted, private, deleted, or withheld by YouTube’s public listing interface. Solanime therefore records 33 as the reachable denominator and retains the 7,002 label only as an unresolved visibility observation.

# FMHY Video ecosystem research

**Full parsed listing inventory; partial infrastructure research.** All categories and sanitized public findings remain in one connected dataset. This is not an approved playback registry or a claim that every transitive service was exhaustively mapped.

Start with SUMMARY.md, reports/architecture-map.md, reports/architecture-footprints.md, reports/shared-infrastructure.md and HANDOFF.md. Exact final file paths are in FILE_MANIFEST.txt. indexes/entries.json and indexes/coverage.json preserve the per-listing denominator.

## Layout

- sources/: sanitized FMHY listing, source response hash/timestamp, listing annotations, request policy and installed environment.
- sites/<stable-id>/{README.md,metadata.json}: per-resource evidence, HTTP outcomes/redirects, public references, frameworks with attribution limits, provider IDs, repository checks, browser observations and unresolved work.
- indexes/: normalized entries, resources, domains, providers, endpoint/repository candidates, relationships, coverage, clusters, redirects, architecture footprints, aliases and unresolved expressions.
- repositories/public-checks.json: independent public repository metadata and selected README/package inspections.
- curated/: reviewed primary-source architecture claims and documented endpoint patterns.
- reports/: machine-readable and Markdown findings, limitations, browser traces without private headers/bodies, validation and collection logs.
- tools/: collect, resume/enrich, deepen, audit and query commands; non-active workflow template.
- tests/: collector and evidence-quality regression tests.

Canonical entities live in indexes rather than being copied into hundreds of provider folders. Repeated URLs in an FMHY bullet are co-listed relationships, not automatically mirrors or a common operator.

## Reading the evidence

A verified source reference means the reference was present in the inspected material. It does NOT mean that code executes, that an endpoint responds, that playback succeeds, or that Solanime has permission to integrate it. A browser request marked sent is stronger than a source literal, but this pass captures bounded homepages, not complete playback sessions.

Use domains[].valid_hostname to distinguish syntactically valid hostname references from unresolved JS expressions. Valid syntax is not proof of DNS registration or service availability. Endpoint reference_class separates concrete references, URL templates, documentation placeholders and schema identifiers. The endpoint registry is NOT a tested API inventory. Repositories have separate candidate and verified-public states. A package declaration is not proof of the currently deployed backend.

Framework names found only inside a JS bundle are NOT attributed to the hosting site: they can describe scraped upstream pages, dependencies, examples or dead code. Identical client bundles, shared IP addresses and shared CDN hosts do not prove a shared backend or owner. The audit preserves uncertain observations while correcting their interpretation.

## Refresh and resume

Use Python 3.11+ in a virtual environment. Preserve an existing snapshot before refreshing for historical comparisons.

```sh
python3 -m venv data-dump/.venv
. data-dump/.venv/bin/activate
python -m pip install -r data-dump/requirements.txt
python -m unittest discover -s data-dump/tests -v
python data-dump/tools/collect.py --seconds 600 --workers 8 --max-js 2
python -m playwright install chromium
python data-dump/tools/enrich.py --seconds 600 --repositories 35 --browser-sites 16
python data-dump/tools/deepen.py --seconds 180 --modules 8
python data-dump/tools/enrich.py --offline
python data-dump/tools/audit.py
```

An individual source can be revisited without re-crawling everything:

```sh
python data-dump/tools/collect.py --site example.org --seconds 120
python data-dump/tools/deepen.py --site example.org --seconds 120 --modules 8
python data-dump/tools/enrich.py --offline
python data-dump/tools/audit.py
```

Offline rebuild: run enrich.py --offline followed by audit.py. The audit is required after rebuilding to restore canonical aliases, reference classification and attribution safeguards. Re-run reviewed documentation claims separately when their source changes; curated claims are dated, not automatically re-certified.

## Query

```sh
python data-dump/tools/query.py --summary
python data-dump/tools/query.py --site pstream.cfd
python data-dump/tools/query.py --provider TMDB
python data-dump/tools/query.py --api-host graphql.anilist.co
python data-dump/tools/query.py --redirects
```

Join site IDs to indexes/sites.json and edge targets to canonical entity indexes. clusters.json distinguishes shared API references, identical downloaded JavaScript and shared resolved IPs. curated/architecture-claims.json supplies documentation-based context. Do not flatten these evidence types into a single unqualified uses-provider relationship.

## Request policy and exclusions

Public GET and DNS only; no authentication, private account data, credential harvesting, admin probing, destructive requests, CAPTCHA solving, proxy rotation, access-control bypass or video downloads. Robots exclusions and Crawl-delay/Request-rate are respected. Redirects are checked, responses bounded and requests rate-limited per host. Failed robots retrieval is treated conservatively. Discovered API references are not automatically invoked.

Raw response bodies, HAR files with headers, cookies, tokens, binary media, private config, .env and installed dependencies are excluded. Sensitive query values, opaque URL tokens, passwords and invite codes are redacted. Public source code is inspected as text; no third-party repository code is executed. Browser sampling blocks non-GET requests, binary media/font requests, downloads and WebSockets, uses ephemeral contexts and disables service workers. This alters behavior and therefore cannot establish playback compatibility or absence of advertising during playback.

## Repository isolation

This research branch starts from the old main baseline solely to isolate data-dump/. Import only that directory into the current application branch; do not use this research branch to replace or roll back the ongoing UI/player work. Main, production, accounts and catalogue databases are unchanged. A branch-only execution workflow was used during collection and removed from the final tree. A reusable, non-active template remains under data-dump/tools/.

# FMHY Video ecosystem research

One connected research dataset covering every parsed FMHY Video listing and its related public resources. All categories are retained; no source is discarded merely because it is not currently usable by Solanime. Findings are research evidence, not an approved playback registry.

## Scope and evidence

Start at https://fmhy.net/video. Retain each listing occurrence separately from deduplicated URLs, domains, providers, endpoints and repositories. Multiple URLs in one listing do not prove common ownership, mirrors or a shared backend. HTTP reachability does not certify playback. Public endpoint references are not automatically called or approved for use.

Each important reference has its source URL, observation timestamp, evidence type and verification scope. Framework signatures are strongly inferred. Unobservable backend details, licensing, runtime dependency chains and private infrastructure remain unknown. A timeout, 403, CAPTCHA, unavailable robots.txt or geo restriction is not labeled dead.

## Data layout

- SUMMARY.md and SUMMARY.json: computed counts and limitations.
- sources/: sanitized seed listing, response hash, collection settings and timestamps.
- sites/<stable-id>/metadata.json: public HTTP observations, redirects, references, framework indicators, canonical entity IDs and unresolved work.
- sites/<stable-id>/README.md: human-readable entry point.
- indexes/: canonical entries, sites, domains, providers, endpoints, repositories, relationship edges and coverage.
- reports/: architecture, shared infrastructure, provider references, redirects, unresolved entries and findings.
- tools/: reproducible collection and index generation.
- tests/: normalization and collection safety regression tests.

Indexes contain canonical entity records. Site records reference those IDs instead of duplicating provider profiles.

## Refresh

Use Python 3.11 or later in a virtual environment:

```sh
python3 -m venv data-dump/.venv
. data-dump/.venv/bin/activate
python -m pip install -r data-dump/requirements.txt
python -m unittest discover -s data-dump/tests -v
python data-dump/tools/collect.py --seconds 600 --workers 8 --max-js 2
python data-dump/tools/collect.py --site example.org --seconds 120
python data-dump/tools/collect.py --reindex
```

The run budget is explicit. URLs left unvisited remain queued, not silently omitted or called complete. Increase it deliberately for a deeper refresh. Archive an existing snapshot before refreshing when historical comparisons are needed.

## Request policy

GET requests and public DNS resolution only. Public-address checks on each redirect, bounded redirects and response sizes, per-host request spacing, robots.txt and Crawl-delay/Request-rate handling, no cookie/session persistence and no environmental authentication. No login, CAPTCHA solving, proxy rotation, browser impersonation, admin access, destructive requests, media downloads or credential extraction. JS is inspected as text, not executed. Sensitive query values, opaque path tokens, passwords and invite codes are redacted. Robots failures are recorded and not bypassed.

Raw response bodies, cookies, credentials, signed playback links and binary media are not committed. References found in a bundle are recorded as references, not claimed as observed runtime requests. A provider can be mentioned in unused code; investigate before integration.

## Repository isolation

This branch starts at the existing main baseline only to isolate the dataset. Do not merge it as an application rollback. Import only data-dump/ into the current application branch after reviewing the ongoing UI/player work. Main, production, accounts and catalogue databases are not modified. A temporary branch-only GitHub Actions launcher may be used to collect the snapshot and is removed from the final delivered tree; the reusable workflow template belongs under data-dump/tools/.

# Findings and limitations

## Substantive findings

1. The full parsed FMHY Video listing is preserved at listing-occurrence level, while URL resources and infrastructure entities are normalized independently. Many bullets contain alternate domains, documentation and repositories; they are not all separate streaming services.
2. Static bundles expose useful API, image, embed, analytics and hosting references, but also templates, schema namespaces, dependency documentation and unused code. The quality audit keeps those observations while correcting their classification.
3. The P-Stream architecture separates account sync from media delivery. AIOStreams and AIOMetadata illustrate separate aggregation and metadata roles. See architecture-map.md and curated/architecture-claims.json for primary-source evidence.
4. Real redirect chains, matching JavaScript bytes, shared API-host references and shared DNS addresses are separately indexed. They support different inferences and must not be merged into a common-owner claim.
5. Repository metadata and package declarations provide stronger project-level evidence than a footer link, but do not establish the code actually deployed at an arbitrary site.

## Coverage limits

SUMMARY.json contains computed counts. Every parsed listing is represented in indexes/coverage.json. Inspected resources can still be incomplete: only bounded documents/modules were read, selected repositories were independently checked and browser observation covered a limited set of homepages. No entry is labeled fully complete and no service is conclusively labeled dead solely from this pass.

A successful HTTP response is reachability, not functional playback. Browser sampling deliberately blocks media, non-GET requests and certain resource classes and therefore cannot certify normal user playback, mobile/Safari behavior, popup-free interaction or ad-free operation. Some endpoints exist only in source strings or documentation; they were not called. Public source code may expose references unrelated to the deployed application.

## Intentional exclusions

No credentials, cookies, session data, private accounts, signed access material, secrets, binary videos or raw authenticated network archives. No login, administrative exploration, destructive calls, CAPTCHA solving, rotating proxies, access-control/DRM bypass or unauthorized source activation. Sensitive values are redacted rather than retained. Publicly listed password/invite-code text is not reproduced as usable access material.

All relevant categories are retained, including tools, indexers, old/unavailable resources and uncertain architecture findings. Being unsuitable for Solanime's production player does not remove a resource from the research dataset.

## Refresh caveats

Collection is a dated snapshot. Link availability and deployed origins change. Source checks and observations have timestamps, and redirects are preserved. Re-run only permitted public requests, respect new robots restrictions/rate limits, and retain older snapshots instead of silently rewriting history. Curated documentation claims require explicit re-verification.

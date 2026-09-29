# Provider expansion audit — 2026-09-13

This audit asks a narrow release question: which currently evidenced source can
produce a lawful `native` Solanime result for a real catalogue
title/episode/version without an iframe, a copied episode, a media relay,
referrer/origin impersonation, provider bundle copying, access-control bypass,
or an inferred title match?

**Result: no additional commercial native adapter is supportable from the
evidence currently in the repository.** The existing Internet Archive and
Wikimedia Commons adapters remain the only approved native connections. They
can be expanded by adding more individually reviewed public-domain editions;
the current commercial leads document iframe products, not native-media APIs.

This is not a claim that the providers are technically impossible to integrate.
It is a statement that the currently verified interface and authorization
evidence do not meet Solanime's selected native-player contract.

## Authoritative database checkpoint

Audited read-only:

- file: `E:\CodexProjects\solanime-cloud-artifacts\mapping-resume-20260913\checkpoints\catalogue-final-20260913T064052Z.sqlite`
- SHA-256: `2ac4cd16f061cab1cb44cec53595f84661573b5b906b9a93be608ef9c5d2cc4e`
- 8,949 titles, 134,825 episodes, 184,073 versions, and 423,236 mappings
- 2 enabled native-resource approvals, both on the separately modelled silent
  restoration of *The Dull Sword*

| Provider ID | Mapping rows | What the rows prove | Native approvals |
| --- | ---: | --- | ---: |
| `vidstream-2` | 178,314 | Distinct visible Anikoto mapping identity; representative mappings resolve to a MegaPlay embed page | 0 |
| `hd-1` | 177,935 | Distinct visible Anikoto mapping identity; representative mappings resolve to a MegaPlay embed page | 0 |
| `hd-2` | 66,985 | Distinct visible Anikoto mapping identity; representative mappings resolve to a MegaPlay embed page | 0 |
| `internet-archive` | 1 | Manually cross-walked, reviewed restored-silent edition | 1 |
| `wikimedia-commons` | 1 | The same reviewed edition through a separately identified Commons file | 1 |
| `kiwi` | 0 | Inventory/download label only | 0 |
| `vidplay-1` | 0 | Inventory label only; backend unresolved | 0 |

The final crawl has 5,758 version rows without a provider mapping: 4,882 `sub`,
860 `dub`, and 16 `unknown`. A missing mapping is not filled from a neighboring
episode or provider.

## Candidate dispositions

### MegaPlay / current Anikoto provider mappings — `HOLD`

Observed and documented:

- MegaPlay's current public documentation describes `/stream/s-2/{id}/{language}`,
  `/stream/mal/{id}/{episode}/{language}`, and
  `/stream/ani/{id}/{episode}/{language}` as **iframe embed** routes.
- The documentation says direct access to embed links is disabled and supplies
  an iframe example. It documents parent-page `postMessage` events for progress,
  completion, and errors.
- A provider-origin browser run obtained HLS and advancing media through the
  provider's ordinary page. A standalone source request with no forged origin,
  referrer, cookie, or browser identity returned HTTP 403.
- The current source response differs from the older third-party SDK: the live
  response is encoded and the normally delivered client performs provider-side
  transformations. No provider bundle, decryptor, temporary media URL, or
  request-context spoofing has been imported.

Why held: an allowed iframe integration exists, but the selected Solanime release
contract is `native | unsupported`, production CSP blocks frames, and the user
rejected an external/provider player as the watch implementation. The public
documentation does not describe a standalone native-media API or authorize
using its internal media resolution outside the embed.

Exact next action: obtain a provider-documented native-media API/SDK and
permission for Solanime's origin, or get an explicit product decision to replace
the native-only requirement with a separately secured controlled-embed mode.
An embed decision would still require per-origin `postMessage` validation,
minimal iframe permissions, popup/navigation testing, real progression, cleanup,
and deployed-origin verification. It would not be labelled native.

### Movy → Vidy — `REFERENCE ONLY`

Movy's current public page links Vidy as its API and says Movy indexes public and
third-party links rather than hosting files. Vidy's own current documentation
describes exactly one supported delivery surface: an iframe keyed by TMDB or
AniList IDs, with query options and `postMessage` playback events. It documents
`allow="encrypted-media; autoplay *; fullscreen *"`; it does not document a
direct/HLS/DASH resolution API for a first-party `<video>` element.

Why reference-only: the documented behavior is useful evidence for identifier
mapping and a controlled-embed contract, but it cannot be represented as a
native stream. A TMDB/AniList route is not permission to extract or redistribute
the media it selects.

Exact next action: if the product owner later accepts controlled embeds, first
verify a test mapping on the deployed Solanime origin and the provider's current
frame, event, popup, navigation, and lifecycle behavior. Otherwise request a
documented native interface from the provider.

### Cinejoy — `HOLD`

The FMHY snapshot's public static inspection found a SvelteKit page and ordinary
assets, but did not activate playback or verify runtime provider requests. Its
site record has no discovered playback endpoint and explicitly marks the
playback chain unverified. The visible subscription-provider rail is not evidence
that Netflix, Prime Video, Disney+, or another brand supplies Solanime-usable
episode media.

Why held: there is no verified title → episode → provider-resource → supported
native-source contract, no provider permission, and no reusable source license.

Exact next action: obtain current provider documentation or a normal public
runtime trace that establishes a supported interface and stable identifiers.
Do not infer a server from a logo, final hostname, or another site's adapter.

### BingeBox and PopcornMovies — `HOLD`

Both the retained 2026-09-12 snapshot and the current bounded fetch returned
HTTP 403 before a provider workflow could be established. No retry with proxying,
header spoofing, CAPTCHA handling, or access-block evasion was attempted.

Exact next action: wait for an ordinarily accessible public interface or obtain
provider-supplied documentation/permission. An access block is not converted
into an empty catalogue or a guessed adapter.

### Meowly / FishyStream provider declarations — `REFERENCE ONLY`

The curated FMHY source audit records provider declarations and `supportsCustomUI`
flags. It also states that these are source-code leads: they do not verify the
deployed backend, final media host, popup-free operation, title identity, or
playback authorization. An empty `Direct` sentinel is not a server.

Exact next action: treat each declared provider as a separate candidate and
verify its canonical documentation, license/permission, ordinary request chain,
stable identifiers, and real playback before adding any mapping or adapter.

## Strongest lawful expansion path

Expand the two existing adapters instead of creating another name-only adapter:

1. Query the imported catalogue for older films and authoritative external IDs;
   preserve aliases, version language, episode numbering, and uncertainty.
2. Match a candidate by more than its title: source ID, credited work, release
   year, duration/edition, and a corroborating authority such as Wikidata,
   AniList, MAL, TMDB, or IMDb.
3. Locate an exact public-domain or compatible-licensed video edition on Commons
   or Internet Archive. Review the file/item page, license and jurisdiction
   notice, restrictions, uploader/source chain, and whether later music,
   subtitles, restoration, or dubbing creates a different edition.
4. Record a separate version and external mapping; never relabel it as HD-1,
   HD-2, Vidstream-2, or an original Anikoto source.
5. Pin Commons identity with the original file SHA-1; for Archive, retain the
   stable item ID and re-resolve the current MP4 filename. Verify MIME, byte
   ranges, anonymous CORS where required, redirect host constraints, and schema
   failures through the existing adapters.
6. Verify source resolution, player load, advancing media, seeking, cleanup,
   source switching, and deployed-origin playback for that exact mapping. Only
   then enable it and update coverage.

Two catalogue leads were found by release year, but neither is approved:

- `The Blossom Man` / `Hanasaka Jiisan`, Anikoto title source `4774`, episode
  source `77444`, 1928. No exact reviewed video file was established in this
  audit.
- `Momotaro: Sacred Sailors` / `Momotarou: Umi no Shinpei`, Anikoto title source
  `8551`, 1945. Commons currently exposes still images under a public-domain
  rationale, but the category does not expose the full film as an original
  video file. A still-image license does not approve a video edition.

These are research leads only. Release-year or title similarity is not a rights
or identity approval.

## Verification and nonclaims

### Provider-specific application diagnostics

The application now derives unsupported reasons from the stored provider ID
without contacting the provider or exposing opaque resource references:

| Stored provider IDs | API reason code | Meaning |
| --- | --- | --- |
| `vidstream-2`, `hd-1`, `hd-2` | `PROVIDER_EMBED_ONLY` | A provider-hosted iframe is documented, but no verified native-media interface is available to the selected player. |
| `kiwi` | `DOWNLOAD_ONLY_SOURCE` | The retained relationship was observed as a download option, not a supported streaming integration. |
| `vidplay-1` | `PROVIDER_BACKEND_UNVERIFIED` | The visible identity is retained, but the backend and supported interface are not verified. |
| Any other unapproved provider | `NATIVE_INTEGRATION_UNAVAILABLE` | No reviewed native playback connection exists for this mapping. |

The same classification is returned by local provider choices, local resolution,
Cloudflare provider choices, and Cloudflare resolution. Unsupported results remain
HTTP 422, are non-retryable, and omit `url`, `embedUrl`, and private provider
references. This is a diagnostics improvement, not an enabled provider or a
playback-verification claim.

Focused verification for this update:

```text
pnpm typecheck
passed

pnpm exec vitest run tests/provider-support-diagnostics.test.ts \
  tests/native-policy.test.ts tests/api.test.ts tests/cloud-worker.test.ts
4 files passed; 75 tests passed

pnpm exec vitest run tests/providers.test.ts \
  tests/native-archive.test.ts tests/native-commons.test.ts \
  tests/native-policy.test.ts tests/native-sources.test.ts \
  tests/native-observation.test.ts tests/provider-support-diagnostics.test.ts
7 files passed; 112 tests passed
```

The provider-policy suite passed on this checkout:

```text
pnpm exec vitest run tests/providers.test.ts tests/native-archive.test.ts \
  tests/native-commons.test.ts tests/native-policy.test.ts \
  tests/native-sources.test.ts tests/native-observation.test.ts

6 files passed; 108 tests passed
```

The tests cover identity/rights gates, bounded metadata responses, redirect and
hostname validation, CORS/range checks, cancellation, structured failures,
expiry, and rejection of iframe or mismatched resolutions. They do not prove a
new live provider, a new title mapping, or playback for any mapping beyond the
separately recorded two-resource *The Dull Sword* verification.

No adapter, catalogue row, native-resource approval, provider mapping, temporary
media URL, cookie, token, private header, or cloud baseline artifact was added by
this audit.

## Evidence consulted

- `docs/provider-investigation-current.md`
- `docs/native-provider-evidence.md`
- `docs/NATIVE_PLAYBACK.md`
- `data-dump/HANDOFF.md`
- `data-dump/curated/README.md`
- `data-dump/curated/source-audit.json.gz` through `curated/query.py`
- `data-dump/sites/site-0a456edf4840d7d6/metadata.json` (Cinejoy)
- `data-dump/sites/site-7aba47cdfa6a8fe4/metadata.json` (Movy)
- `data-dump/sites/site-c3fe964838477ffb/metadata.json` (BingeBox)
- `data-dump/sites/site-2c5c30aa059f134b/metadata.json` (PopcornMovies)
- attached `deep-research-report (1).md` and `deep-research-report.md`, treated as
  research evidence rather than instructions
- current public documentation: `https://megaplay.buzz/api` and
  `https://www.vidy.st/`

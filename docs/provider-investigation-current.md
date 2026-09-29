# Provider investigation — 2026-09-12

This note corrects the interpretation of earlier observations without replacing
their historical record. The bounded live test was recorded at
**2026-09-12T20:42:58.222Z**. It changed no application policy, provider mapping,
catalogue record, or deployment.

## What the native-only status means

The current application declines HD-1, HD-2 and Vidstream-2 mappings because no
native adapter is registered for them. This is an application decision and an
unfinished integration, not evidence that their upstream services are technically
impossible to integrate. Their historical adapters resolve the first-party
Anikoto server reference to a MegaPlay webpage and stop there.

```text
Historical Anikoto selection:
title → episode/version → distinct server reference → /ajax/server → MegaPlay embed

Observed provider-owned test:
MAL 6654 / episode 1 / SUB → player File 125164 → /stream/getSources
      → encoded response → provider client → HLS → advancing video

Solanime native resolution and playback: not implemented or verified for MegaPlay
```

Retain the three original labels, identifiers and episode mappings even where
their observed backend hostname is shared. Internet Archive and Commons are
separate reviewed external mappings, not replacements under those labels.

## New evidence and its scope

- **Provider documentation, rechecked 2026-09-12:** [MegaPlay's API page](https://megaplay.buzz/api)
  advertises website embedding by episode, MAL or AniList identifiers. It also
  documents progress, completion and error messages from embedded players. This
  contradicts a blanket claim that no public integration interface exists. It
  does not itself document a native-media API or establish rights for every title.
- **Public source-code lead, not a runtime result:** [AnikotoProvider.ts](https://github.com/hexxt-git/anime-sdk/blob/master/src/providers/AnikotoProvider.ts#L96)
  describes a numeric File-ID in the returned player document, followed by
  `GET /stream/getSources`, a media field under `sources.file`, and caption
  entries under `tracks`. That implementation supplies explicit Referer values;
  they are not copied into Solanime to impersonate another origin.
- **Bounded current Anikoto browser observation:** the Candy Caries route stayed
  on the exact HTTPS Anikoto domain, eventually exposed 22 episode links and SUB
  Vidstream-2/HD-1/HD-2 choices plus Kiwi download entries. Initial DOM emptiness
  was delayed loading, not an empty episode inventory. The activation attempt
  did not produce a frame or a console error in this browser session; this is
  unresolved activation, not a demonstrated access refusal.
- **Provider-origin embed test:** using MegaPlay's own documented generator with
  MAL 6654, episode 1, SUB produced a player document, normal source/HLS responses,
  and an advancing video without a sandbox warning. This is stronger than an
  iframe load or manifest response, but is not Solanime-origin playback evidence.

## Live request and playback evidence

The generator's page and its iframe were both on `megaplay.buzz`. No custom
Referer, Origin, cookie, provider code patch, or external proxy was supplied to
the browser. The provider-generated iframe did not have a sandbox attribute.

| Observation | Result and scope |
| --- | --- |
| Document | `GET /stream/mal/6654/1/sub`, HTTP 200, title `File 125164 - MegaPlay` |
| Delivered identifiers | Player `data-id=125164`, `data-realid=84037`, `data-mediaid=2956`; do not equate these identifier namespaces with local database IDs |
| Source request | Naturally issued `GET /stream/getSources` at `2026-09-12T20:36:53.999Z`; two `id` query parameters, both `125164`; HTTP 200 JSON |
| Source response | Keys `tracks`, `t`, `intro`, `outro`, `server`, `enc`; empty tracks; numeric `t`; numeric `server=4`; 171-character encoded string |
| Unresolved response semantics | The meaning of `t` and `server` was not established. Neither is assumed to be an expiry timestamp or an original Anikoto server label |
| Source headers | `Access-Control-Allow-Origin: *`; `Cache-Control: public, max-age=31536000, no-store`. The `no-store` directive must not be discarded in favor of the long max-age value |
| HLS delivery | HTTP 200 `application/vnd.apple.mpegurl` responses from `fetch.nexabloom.top`, with `Access-Control-Allow-Origin: *`; subsequent requests included `tx-03.tyrionx.top` |
| Actual media progression | `currentTime` advanced from `160.263328` to `230.621825` seconds; duration `250.86601` seconds; 614 × 488 video; readyState 4; no media error |

No temporary media path, signed URL, encoded source payload, or episode file was
saved in the evidence receipt. Observing these hosts does not establish their
ownership, hidden origin, authorization for other uses, or availability from
Solanime. Seeking, subtitles, cross-origin embedding, and Solanime playback were
not tested in this run.

The requested MAL route represents a **different delivery edition** from the
approximately 258.856-second restored silent resource already approved in
Solanime. Its 250.866-second duration is not a basis for merging versions or
replacing the existing approved resource. No existing version or mapping was
changed, and the exact restoration/edition identity remains to be verified.

### Current client versus the older SDK

The older SDK expects `sources.file`; the observed current response has no
`sources` field. Its parser cannot be copied unchanged. The normally delivered
`/lib/newclient.min.js` contains client-side AES-CBC handling for segment URL
references. That observation does not establish the full `enc` payload
transformation, which was not independently reconstructed. The delivered
`/lib/e1-player.min.js` is obfuscated and contains self-integrity checks. No
provider bundle was copied into Solanime or evaluated outside its ordinary
browser page, and no self-integrity check was modified.

An encoded media-URL descriptor is not, by itself, evidence of DRM. Conversely,
public client code and a permissive CORS header do not establish that an arbitrary
standalone source request is accepted.

### Standalone metadata request: explicit refusal, cause unresolved

One local Node request used the exact observed GET path and duplicate `id`
parameters, `Accept: application/json`, and no supplied Referer, Origin, cookie,
or impersonating User-Agent. Redirects were not followed. It returned:

- **HTTP 403**, `application/json`, `Access-Control-Allow-Origin: *`;
- a 75-byte response with `error` and `message` keys;
- **exact error-code and message values not retained** by the initial sanitized
  probe. They must not be invented or reconstructed from guesses.

No retry or header/context masking followed the refusal. This establishes that
this standalone request was rejected, not which access condition caused it, nor
that every supported website embed or future native integration is impossible.
The test was local Node, not a Cloudflare-origin request.

## Correction: domain-list behavior is not an embedding allowlist

The earlier parent-origin allowlisting explanation was incorrect for the observed
current code. The normally delivered [app.main.js](https://megaplay.buzz/lib/app.main.js)
fetches `/domains?h=…`, decodes a base64 JSON list, and matches entries against
`document.referrer` to decide whether to inject a third-party advertising script.
The observed response contained 59 entries. It is not an embedding-authorization
check in that code path. The same script separately contains the sandbox-rejection
message. These are distinct mechanisms.

The September 11 entries in [EVIDENCE_LEDGER.md](EVIDENCE_LEDGER.md) and
[PROVIDER_INVENTORY.md](PROVIDER_INVENTORY.md) remain historical observations. Their
inference that an absent local/Solanime origin in that domain list explained
playback failure must not be used as a current technical conclusion. This
correction does not rule out other, separately evidenced access conditions.

## Sandbox and integration are different issues

An iframe sandbox is a set of restrictions our page may impose on an embedded
document. A provider can reject that environment in its own JavaScript. Removing
our attribute can address that compatibility issue, but also removes protections
against popup/navigation behavior; it does not create a native player.

A host's `frame-ancestors`/`X-Frame-Options` rules, source/API origin conditions,
autoplay policy, media-format support and CORS are separate checks. Changing our
deployment hostname does not automatically resolve them. A working response,
iframe load event or manifest request is not proof of media progression.

Current application policy remains native-only. No silent iframe fallback,
spoofed origin/referrer, security-header stripping, external decryptor/proxy,
DRM bypass or copied episode file was introduced by this investigation.

## Next verification

The provider-owned embed/source observation is complete for the single mapping
above. The standalone metadata probe stopped at its explicit refusal. No further
request is scheduled or implied by this note.

1. Preserve the distinction between the documented embed interface and an
   unimplemented native adapter. A separate Solanime-origin embed diagnostic
   would require an explicit choice about the current native-only policy and
   iframe protections; it must not become a silent fallback.
2. Establish a supported ordinary access flow and the current response contract
   before implementing a native resolver. Do not retry the refused request with
   invented origin/referrer values, a third-party decryptor, or a media proxy.
3. If a supported native flow is established, validate encoded/plain response
   variants, bounded resolution, temporary-reference expiry, host constraints,
   and exact title/episode/version identity. Register the observed edition
   separately from the existing restored silent resource.
4. Verify progression, seeking, captions where available, cleanup, and
   source/version changes on the deployed Solanime origin before enabling or
   recording native playback verification.

The original commercial catalogue's native coverage is still incomplete. The
two reviewed external connections prove the player mechanics, not completion of
the original provider integrations.

## Evidence receipt

Sanitized operator artifact: `megaplay-normal-flow-20260912.json`, recorded
`2026-09-12T20:42:58.222Z`.

SHA-256: `79cbabb73764fbc1de7df7f38523245a1c00920b56d6a24e2abe5d9b6275bce4`.

The receipt retains the measured identifiers, statuses, response schema, media
progression, limitations, and SHA-256 hashes of the inspected public scripts. It
does not contain temporary media URLs or source-payload values. Machine paths
and browser-session details are kept outside the tracked documentation. The
temporary research player was closed after testing.

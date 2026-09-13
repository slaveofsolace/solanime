> Historical documentation. Native-player candidate 0.6 removes provider webpage playback. Follow [NATIVE_PLAYBACK.md](NATIVE_PLAYBACK.md) and [DEPLOY_NATIVE.md](DEPLOY_NATIVE.md), not the iframe/compatibility instructions below.

# Provider inventory

> 2026-09-12 correction: the parent-origin limitation below was an incorrect
> inference from an advertising-script domain list in the currently observed
> client code. Public MegaPlay embed/event documentation
> has been rechecked, and the remaining media-resolution step is under active
> investigation. See [current evidence](provider-investigation-current.md).

States below are dated 2026-09-11 and intentionally separate identity, mapping import, source resolution, provider-document response, and playback.

| Visible label | Internal ID | Observed backend relationship | Adapter | Current evidence | Limitation |
| --- | --- | --- | --- | --- | --- |
| Vidstream-2 | `vidstream-2` | `megaplay.buzz`, `/stream/s-2/` | Dedicated first-party resolver + strict MegaPlay iframe allowlist | Label/server list observed; mappings imported; representative source resolved | Playback not verified; provider frame uses an opaque interface |
| HD-1 | `hd-1` | `megaplay.buzz`, `/stream/s-2/` | Dedicated first-party resolver + strict MegaPlay iframe allowlist | Label/server list observed; mappings imported; representative source resolved; provider document responded | No SolAnime sandbox attribute is applied; current blocker appears to be MegaPlay parent-origin allowlisting |
| HD-2 | `hd-2` | `megaplay.buzz`, `/stream/s-2/` | Dedicated first-party resolver + strict MegaPlay iframe allowlist | Label/server list observed; mappings imported; representative source resolved | Distinct button/ref despite shared server ID and hostname; playback unverified |
| Kiwi | `kiwi` | Not established | Explicit unavailable/download adapter | Supplemental mapper returned download qualities in one sample | No supported player integration observed; URLs were not followed or copied |
| VidPlay-1 | `vidplay-1` | Not established | Explicit unavailable adapter | Supplied research attachment only | Not re-observed in bounded current samples; no host mapping guessed |

MegaPlay is modeled in `provider_connections` as an observed backend for three separate visible identities. It is not exposed as a fourth visible server. Unknown future labels are preserved as `observed-*` providers with unavailable adapters rather than being silently discarded or routed through another label.

The bounded runtime verifier was rerun at 2026-09-10T20:16Z against current database mappings. One SUB and one DUB mapping for each implemented label resolved through Anikoto's normal first-party selection request to the allowlisted `megaplay.buzz` iframe route (mapping IDs 7339/7336, 7346/7349, and 7359/7368). Additional browser inspection on 2026-09-11 confirmed a MegaPlay player document and source requests on a known-good mapping, while the provider's public domain metadata did not include local or SolAnime parent origins. The verifier stores source-resolution observations but omits opaque references and temporary URLs. None of these checks establishes stable playback.

The selection endpoint returns structured unavailable/blocked/upstream-changed errors. Cancellation and request sequencing prevent late source responses from replacing a newer episode/server selection. Iframes are torn down by React when selections change; direct HLS/DASH players destroy their player instances and clear media elements.

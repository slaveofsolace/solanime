> Historical documentation. Native-player candidate 0.6 removes provider webpage playback. Follow [NATIVE_PLAYBACK.md](NATIVE_PLAYBACK.md) and [DEPLOY_NATIVE.md](DEPLOY_NATIVE.md), not the iframe/compatibility instructions below.

# Provider inventory

> 2026-09-13 correction: the earlier parent-origin limitation was an incorrect
> inference from an advertising-script domain list in the observed client code.
> MegaPlay's current public documentation explicitly supports provider-hosted
> iframe embeds, explicitly disables direct access, and does not document a
> native-media interface. See [current evidence](provider-expansion-2026-09-13.md).

States below are dated 2026-09-11 and intentionally separate identity, mapping import, source resolution, provider-document response, and playback.

| Visible label | Internal ID | Observed backend relationship | Adapter | Current evidence | Limitation |
| --- | --- | --- | --- | --- | --- |
| Vidstream-2 | `vidstream-2` | `megaplay.buzz`, `/stream/s-2/` | Retained clean-room resolver; production classifies it as `PROVIDER_EMBED_ONLY` | Label/server list observed; mappings imported; representative iframe source resolved | Provider documents iframe use only; no verified native interface or Solanime playback |
| HD-1 | `hd-1` | `megaplay.buzz`, `/stream/s-2/` | Retained clean-room resolver; production classifies it as `PROVIDER_EMBED_ONLY` | Label/server list observed; mappings imported; representative iframe source resolved; provider document responded | Provider documents iframe use only; native-only release does not load provider webpages |
| HD-2 | `hd-2` | `megaplay.buzz`, `/stream/s-2/` | Retained clean-room resolver; production classifies it as `PROVIDER_EMBED_ONLY` | Label/server list observed; mappings imported; representative iframe source resolved | Distinct button/ref despite shared backend; no verified native interface or playback |
| Kiwi | `kiwi` | Not established | Explicit unavailable/download adapter | Supplemental mapper returned download qualities in one sample | No supported player integration observed; URLs were not followed or copied |
| VidPlay-1 | `vidplay-1` | Not established | Explicit unavailable adapter | Supplied research attachment only | Not re-observed in bounded current samples; no host mapping guessed |

MegaPlay is modeled in `provider_connections` as an observed backend for three separate visible identities. It is not exposed as a fourth visible server. Unknown future labels are preserved as `observed-*` providers with unavailable adapters rather than being silently discarded or routed through another label.

The bounded runtime verifier was rerun at 2026-09-10T20:16Z against current database mappings. One SUB and one DUB mapping for each implemented label resolved through Anikoto's normal first-party selection request to the allowlisted `megaplay.buzz` iframe route (mapping IDs 7339/7336, 7346/7349, and 7359/7368). Additional browser inspection on 2026-09-11 confirmed a MegaPlay player document and advancing provider-origin media on a known-good mapping. The provider documentation was rechecked on 2026-09-13: it identifies the route as an iframe embed, says direct access is disabled, and documents only parent-page event messages. The verifier stores source-resolution observations but omits opaque references and temporary URLs. None of these checks establishes a native source or Solanime playback.

The selection endpoint returns structured unavailable/blocked/upstream-changed errors. Cancellation and request sequencing prevent late source responses from replacing a newer episode/server selection. Iframes are torn down by React when selections change; direct HLS/DASH players destroy their player instances and clear media elements.

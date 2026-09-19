# Playback contracts and provider findings

> Current investigation correction (2026-09-12): the older iframe adapters stop
> before the media-resolution step. MegaPlay now has directly verified public
> embed/event documentation and there is a concrete native-resolution source
> lead. Native-only rejection is not proof of upstream impossibility. See
> [the current investigation](provider-investigation-current.md).

## Integrated 0.8 release

Solanime now keeps two playback contracts distinct:

1. `native`: the application receives a validated direct/HLS/DASH resource and
   controls its own media element.
2. `embed`: the application receives an exact canonical provider-player URL.
   MegaPlay embeds are rendered only after the Solanime Guard extension proves
   its containment rules are active.

The local operator registry and approved `native_resources` path remain
supported. The Internet Archive connection for the reviewed restored-silent
*The Dull Sword* edition is implemented; see [current provider evidence](native-provider-evidence.md)
and [cloud deployment](CLOUD_RELEASE.md). An embed does not inherit native-media
capabilities, and neither kind is called playback-verified until media progress
has been observed.

## What the supplied code establishes

The inspected PR #4 base was `4fd60a177f06afd2e43a79e1521c4888b4eda545`. Its `server/providers/adapters.ts` implements HD-1, HD-2 and Vidstream-2 through `AnikotoMegaPlayEmbedAdapter`. The adapter resolves a webpage at the approved MegaPlay `/stream/s-2/` route and returns `playbackType: iframe`. Its own capability contract reports no seek, volume, subtitle or progress interface. VidPlay-1 has an unresolved backend; Kiwi is not an integrated native streaming source.

That is evidence about **our integration**, not proof that these operators can never provide another API. No source permission, verified native SDK contract or direct-media registration for those library mappings was supplied. Public SDK searches did not establish one. No authentication, anti-bot, DRM, sandbox or provider access restriction was bypassed to manufacture a media address.

| Stored source | Validated path | Current player behavior |
|---|---|---|
| HD-1 | Canonical MegaPlay `/stream/s-2/` embed | In-site embed when Guard is active; otherwise no iframe |
| HD-2 | Canonical MegaPlay `/stream/s-2/` embed | In-site embed when Guard is active; otherwise no iframe |
| Vidstream-2 | Canonical MegaPlay `/stream/s-2/` embed | In-site embed when Guard is active; otherwise no iframe |
| VidPlay-1 | Unknown supported backend | Unsupported |
| Kiwi | Download-only/unintegrated entry | Unsupported |

Records and source identifiers remain intact. `getProviderAdapter` is retained for historical investigation scripts, but `createApp` no longer uses it for playback. Production browsing returns the observed inventory with separate native support status. A stored mapping is not evidence of playable availability.

## Enforcement layers

1. The backend accepts approved native adapters, the local native registry, and
   validated stored MegaPlay embeds. Embed resolution reconstructs the canonical
   URL from the mapping and requires exact provider/resource/URL agreement.
2. The frontend validates the resolved kind and URL. Native media uses the
   Solanime media element. A provider embed is not created until the page receives
   the active Guard handshake; a missing or disabled Guard produces a typed,
   actionable state.
3. Production Node, Vite development/preview, and Pages policies restrict
   `frame-src` to `https://www.youtube-nocookie.com` and
   `https://megaplay.buzz`; objects remain blocked. Deployment verification checks
   this exact host set, but does not call it playback proof.
4. The Guard blocks provider-origin top-level navigation and removes navigation
   targets created by the provider frame. It does not extract media, spoof the
   provider origin, or relay arbitrary URLs.
5. Native controls operate on the actual media element. Opaque embeds expose only
   the progress/events the provider documents; Solanime does not fake unsupported
   seek, caption, quality, or seamless-switching capabilities.

These defenses limit the approved provider-player path; they do not make the
extension a universal network filter. The provider and approved media hosts still
receive requests and may log them. Native HLS and DASH can load referenced
segments; operator permissions and CORS must cover every required resource. The
HLS JavaScript loader restricts configured request hosts, but no claim is made
that it intercepts every browser-native HLS/DASH redirect. Do not treat a
hostname allowlist as playback or rights verification.

## Register authorized media

`SOLANIME_NATIVE_SOURCES` points to a local operator-controlled JSON array. `config/native-sources.example.json` stays empty to avoid inventing working integrations. Keep the populated file out of Git and public assets. Restart the API after changes.

Illustrative schema only — the example hostname below is not a working stream:

```json
[
  {
    "mappingId": 123,
    "language": "sub",
    "type": "hls",
    "url": "https://media.example.org/authorized-title/master.m3u8",
    "allowedHosts": ["media.example.org"],
    "authorization": {
      "basis": "licensed",
      "reference": "Internal license or provider permission record"
    },
    "captions": [
      {"url": "https://media.example.org/authorized-title/en.vtt", "language": "en", "label": "English"}
    ]
  }
]
```

Use an actual stored numeric episode-provider mapping ID, its exact language/version, and a resource the operator has authority to deliver. Accepted authorization bases are `owned`, `licensed` and `provider-permission`. This records the operator's attestation; it does not establish legal authorization by itself. The reference stays server-side. HTTPS, credential-free URLs and explicit media/caption hosts are validated. Optional ISO `expiresAt` is respected by resolution and cache expiry. Expired sources become unavailable; there is no fabricated token renewal.

MP4 needs compatible encoding and normal range delivery. HLS requires its playlist, child playlists, segments and any authorized keys to be reachable with suitable CORS. DASH likewise requires the manifest and referenced media. Captions use WebVTT. Native Safari HLS differs from JavaScript HLS; physical Safari validation is still required.

This configuration deliberately does not relay arbitrary URLs, extract private streams, spoof referrers, bypass DRM or copy episodes. Until an authorized mapping is configured, its episode can be browsed but cannot be played here.

## Controls and lifecycle

Play/pause state, time and completion come from the media element's real events. A successful URL resolution is not a playback success. Seeking pauses first and resumes only after the real seeked event when playback was intended; failures leave an explicit error. Episode/source/version changes abort obsolete requests and destroy old media instances. Appearance and theater changes preserve the video element. Progress is written only when enabled and completion resets it.

Supported controls: play/pause, native-center play, seek slider, ±10 seconds, mute/volume, elapsed/remaining time, speed, available captions, fullscreen, theater and previous/next episode. Focus the controls group for K/Space, arrows, M, F, T, N and P. Inputs retain their own keyboard behavior. Mobile controls remain touch-sized and wrap below the video instead of covering episode metadata.

## Evidence and limits

Unit/API tests validate canonical embed reconstruction and reject mismatched
provider data. Chromium Guard acceptance verifies the handshake, disabled-state
cleanup, tracker request blocking, and no surviving provider-created page for its
controlled fixture. Offline Chromium also exercises MP4/HLS/DASH decoding,
controls, captions, and stale-response cleanup with deterministic footage. Those
tests do not certify every external media URL, deployed cookies, WebKit, or the
full library. Random live mappings require a separate, dated campaign whose
results report actual progress independently from successful resolution.

Primary implementation references:
- MDN frame-src: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-src
- MDN same-origin policy: https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- HLS.js official project and CORS requirements: https://github.com/video-dev/hls.js
- DASH-IF dash.js setup: https://dashif.org/dash.js/pages/quick-start.html

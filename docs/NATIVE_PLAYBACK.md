# Native playback contract and provider findings

> Current investigation correction (2026-09-12): the older iframe adapters stop
> before the media-resolution step. MegaPlay now has directly verified public
> embed/event documentation and there is a concrete native-resolution source
> lead. Native-only rejection is not proof of upstream impossibility. See
> [the current investigation](provider-investigation-current.md).

## Integrated 0.7 release

The local operator registry described below remains supported, but is no longer
the only native path. The hosted/local APIs also resolve explicitly approved
stable resources from `native_resources`, with a shared identity/rights gate and
a discriminated `native | unsupported` result. The Internet Archive connection
for the reviewed restored-silent *The Dull Sword* edition is implemented; see
[current provider evidence](native-provider-evidence.md) and
[cloud deployment](CLOUD_RELEASE.md). Earlier candidate observations below are
historical, not the current release verification matrix.

## What the supplied code establishes

The inspected PR #4 base was `4fd60a177f06afd2e43a79e1521c4888b4eda545`. Its `server/providers/adapters.ts` implements HD-1, HD-2 and Vidstream-2 through `AnikotoMegaPlayEmbedAdapter`. The adapter resolves a webpage at the approved MegaPlay `/stream/s-2/` route and returns `playbackType: iframe`. Its own capability contract reports no seek, volume, subtitle or progress interface. VidPlay-1 has an unresolved backend; Kiwi is not an integrated native streaming source.

That is evidence about **our integration**, not proof that these operators can never provide another API. No source permission, verified native SDK contract or direct-media registration for those library mappings was supplied. Public SDK searches did not establish one. No authentication, anti-bot, DRM, sandbox or provider access restriction was bypassed to manufacture a media address.

| Stored source | Previously implemented path | Current production behavior without native registration |
|---|---|---|
| HD-1 | MegaPlay webpage embed | Unsupported; no resolver call or provider document load |
| HD-2 | MegaPlay webpage embed | Unsupported; no resolver call or provider document load |
| Vidstream-2 | MegaPlay webpage embed | Unsupported; no resolver call or provider document load |
| VidPlay-1 | Unknown supported backend | Unsupported |
| Kiwi | Download-only/unintegrated entry | Unsupported |

Records and source identifiers remain intact. `getProviderAdapter` is retained for historical investigation scripts, but `createApp` no longer uses it for playback. Production browsing returns the observed inventory with separate native support status. A stored mapping is not evidence of playable availability.

## Enforcement layers

1. The backend uses approved native adapters, plus the separately configured local native registry. Unsupported mappings return typed errors with no embed URL. A plugin/test resolver returning an iframe is rejected by `enforceNativeResolution` before caching or recording successful resolution.
2. The frontend requires a resolved native delivery, a supported media kind and a valid media URL. A legacy or malicious `200 OK` iframe response still becomes Unsupported source. No fallback frame, external launch or compatibility switch exists.
3. Production Node, Vite development/preview and Pages asset policies specify `frame-src 'none'` and block object embedding. The deployment check verifies the release and frame policy.
4. Solanime controls operate on the actual media element. The only central overlay is a native play button over `<video>`; no webpage is hidden underneath.

These defenses prevent provider-page advertising scripts from being included through the playback path. They are not a browser extension or a universal network filter. An approved media host still sees requests and can log them. Native HLS and DASH can load their referenced segments; operator permissions and CORS must cover every required resource. The HLS JavaScript loader restricts configured request hosts, but no claim is made that this intercepts every browser-native HLS/DASH redirect. Do not treat a hostname allowlist as independent content-rights verification.

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

The candidate's local unit/API tests reject old iframe resolutions and confirm no production upstream fetch for unsupported records. Offline Chromium exercised real MP4/HLS/DASH decoding, frame changes, controls, captions and no extra windows or provider document requests with original fixture footage. Tests do not certify every external media URL, licensing, deployed cookies, WebKit or the full library.

Primary implementation references:
- MDN frame-src: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-src
- MDN same-origin policy: https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
- HLS.js official project and CORS requirements: https://github.com/video-dev/hls.js
- DASH-IF dash.js setup: https://dashif.org/dash.js/pages/quick-start.html

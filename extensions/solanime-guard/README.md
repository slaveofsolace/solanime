# Solanime Guard (optional Chromium extension)

Install deliberately in Chrome/Edge on your own browser: open `chrome://extensions` or `edge://extensions`, enable Developer mode, select **Load unpacked**, and choose this directory. This is unpacked source, not a signed/store-reviewed release. Reload Solanime after installation. Keep this directory; deleting it breaks the unpacked extension. Safari requires a separate signed Safari extension build that is not included.

## Scope and behavior

Supports `solanime.pages.dev`, its preview subdomains, and `127.0.0.1` on ports 5173, 8787, 4173 and 18787 (isolated test server). Only `megaplay.buzz/stream/` player frames are styled. The manifest must request localhost without a port because match patterns do not support ports; both content scripts and the background worker reject all other local ports. For an owned custom domain, add the exact domain to the manifest matches/host permissions, `isProjectUrl` and the mirrored guard in site.js, then test and reload the extension. No `<all_urls>` permission is requested.

Session-scoped DNR rules apply to supported tabs and provider-initiated requests only. They block an independently maintained starter set of advertising/analytics domains and third-party pings. A separate provider-origin rule blocks top-frame navigation before a popup receives its new tab id, and a navigation-target listener closes any blank target created by `window.open`. They are not an EasyList/AdBlock clone or exhaustive filter list. Solanime waits for the extension handshake before creating an unsandboxed provider frame.

**Strict mode is optional and off by default.** It denies other third-party requests initiated by the supported player unless their host is listed under Verified media hosts. Unknown CDN segments, subtitle services and player dependencies can stop working. Media-host exceptions do not override the known tracker block rules. Do not add a domain merely because an error tells you to; inspect and verify it first.

The worker reads the site's accent and inserts USER-origin CSS into verified provider frame document IDs. It supports common JW Player/Plyr/Video.js HTML selectors and updates when the accent changes. It does not rewrite video, inject a fake player, override media authorization, spoof origins, remove DRM/challenges, or strip provider security headers. Frame styling cannot force arbitrary canvas, closed-shadow-root, or unknown player implementations to match. The page itself cannot do cross-origin DOM styling without this installed permissioned extension or provider cooperation.

## Limits and privacy

No filter can guarantee zero tracking: same-origin analytics, unknown domains, nested third-party initiators, cached/service-worker responses and essential host logging are not exhaustively covered. Provider requests still disclose an IP address and may use cookies. Strict-mode rules distinguish origin domains, not the semantic purpose of each request. The provider rejects sandboxed embedding. Solanime therefore creates its unsandboxed frame only after Guard confirms its navigation protection is enabled; disabling or removing Guard leaves that source unavailable. This gate does not make the provider private or eliminate ordinary host logging.

No telemetry, browsing-history database, cookies API, remote code or remote filter downloads. Theme state and frame-CSS references are stored in browser session storage and removed on tab navigation/closure. Only extension options persist in local extension storage. Disabling Guard removes its session network rules and injected styles from active supported frames. The extension does not delete preexisting third-party cookies.

## Test evidence

The repository contains pure policy tests and a separate unpacked-extension Chromium test. Those tests use isolated fixture pages and intercepted provider documents, never live episode streams. Review the actual CI results before relying on a particular browser build. Unit rule matching alone is not proof of a real network block.

Architecture references: Chrome DNR, scripting and content-script documentation; MDN iframe/same-origin documentation. See `docs/NETFLIX_DESIGN_RESEARCH.md` and `docs/PLAYBACK_PROTECTION.md` in the project.

# Playback protection and styling boundaries

## Website, enabled by default

The requested third-party-player paragraph is removed. The Play here action remains intentional; player networking does not begin merely because a watch page or title card is displayed.

Supported iframes are restricted to the existing verified HTTPS provider stream path. `allow-scripts allow-same-origin` supports ordinary foreign player execution while withholding popup, download, forms and top-navigation capabilities. Camera, microphone, location and payment are denied. No unsandboxed compatibility switch or automatic protection downgrade is provided.

This can prevent a source from playing when the provider refuses sandboxed embedding. Choose another source. The explicit external-link fallback is under Player options and leaves the site's frame restrictions; it uses noopener/noreferrer. We do not spoof origins or proxy third-party HTML to evade an embed policy.

The website's protection is not equivalent to a browser-wide ad blocker. It does not erase cookies, block every analytics call, stop the provider logging an IP address, or prevent all navigation inside the iframe. Parent CSP cannot restyle or govern every subrequest of an independently served cross-origin page.

## Native player

Direct/HLS/DASH sources that already resolve through supported integrations use Solanime-owned controls. Colors update live; playback state, progress, speed, mute, captions and fullscreen use actual video APIs. Native controls are not layered over an opaque iframe. Missing provider mappings remain missing; no synthetic movie is inserted into the live catalogue.

## Optional Guard extension

See `extensions/solanime-guard/README.md`. Installing the website does not install the extension. The extension has its own explicit host permissions and is scoped to supported Solanime tabs. It inserts theme CSS into known HTML control families and adds Chrome DNR filtering. The starter list is not exhaustive, and strict mode can stop legitimate video/CDN traffic.

No promise of “all ads blocked”, “zero tracking” or “every player fully themed” is made. No tests bypass authentication, CAPTCHA, DRM, media authorization or provider origin checks. Browser tests use isolated fixture origins and original test footage. A successful test is evidence of the tested capability, not a guarantee against all hostile code.

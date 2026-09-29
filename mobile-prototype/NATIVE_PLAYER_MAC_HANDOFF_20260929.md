# Solanime native protected-player handoff (2026-09-29)

## Purpose and exact state

The installed Solanime website/PWA is not a browser with control over a foreign iframe. This branch adds app-owned browser hosts so a future Mac app and iPhone app can refuse new windows and disallowed document navigation without adding the HTML `sandbox` attribute that MegaPlay rejects. The source is intended to be merged for Mac-side continuation; it is **not** evidence that an iPhone binary exists, that every provider plays, or that the ordinary website now blocks provider popups.

The Windows Electron host has one bounded combined result: on 2026-09-29 mapping `384944` (`Unlimited Psychic Squad`, episode `124554`, subtitled, MegaPlay iframe `https://megaplay.buzz/stream/s-2/20121/sub?s=tcdn`) advanced from 16.42 to 21.99 seconds and 47 to 181 decoded frames. A real click inside that provider frame called `window.open('https://example.com/solanime-popup-probe', '_blank')`; it returned `null`, zero additional windows appeared, and the Solanime route stayed stable. A separate external-link click stayed on Solanime. The updated packaged Windows x64 app then passed the same combined probe: 22.71 to 28.29 seconds and 32 to 166 frames, zero new windows, stable route. This is not a Mac or iPhone run. Do not generalize it to other mappings or devices.

The Mac package target exists but **did not produce a bundle on Windows**: Electron Packager reported that Windows symlink privileges were unavailable. `package:mac` now fails nonzero in that case rather than silently reporting success. The iOS Xcode project and shared scheme are source-complete but cannot be compiled or run on this Windows host. Static source-contract tests are not a substitute for Xcode or device acceptance.

## Source map

- `desktop-prototype/main.cjs`: Electron host. Renderer sandbox, no Node integration, no preload/native bridge, no webview tag; rejects all new windows, downloads, non-fullscreen permissions, and disallowed frame navigations. A network-stage rule independently blocks disallowed document loads while leaving unrelated media, captions, manifests, and scripts alone.
- `desktop-prototype/policy.cjs` and `policy.test.cjs`: exact site/provider-document policy and one observed ad-host filter. This is deliberately not an arbitrary network allowlist. A CDN host may be required to deliver video while still being forbidden as a document destination.
- `desktop-prototype/smoke.cjs`: clicked popup and off-site navigation probes.
- `desktop-prototype/real-playback-smoke.cjs`: real mapping plus a user-clicked popup probe inside the provider frame; measures media time, decoded frames, video dimensions, ready state, window count, and parent route.
- `desktop-prototype/package-mac.cjs`: unsigned Apple Silicon `.app` packaging. Must be run on a Mac. `package-win.cjs` remains the Windows path.
- `mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj`: iPhone app project and shared scheme; no signing team or secret committed.
- `mobile-prototype/ios/SolanimeProtectedPlayerApp.swift`: WKWebView host; denies nil-target navigations and `createWebViewWith`, checks navigation actions and redirected document responses, compiles content rules before loading, blocks all `popup`-typed loads plus the single observed `wuytg.com` ad host, and shows Retry if rule compilation fails. No native bridge is exposed.
- `mobile-prototype/ios/source-contract.test.cjs`: source-level checks only.
- `mobile-prototype/android/`: earlier Android WebView experiment, not part of this Mac/iPhone acceptance claim.

The website still mounts a provider iframe without HTML sandbox for compatibility. Do not “fix” this by claiming a parent-page userscript can control a cross-origin frame, or by automatically relaxing native protection when playback fails. The native app, not the PWA, is the intended container.

## Mac agent: first steps

1. Use the existing physical canonical checkout on your Mac or a fresh Mac checkout of the merged private `main`. Keep all local user data and ignored files; do not reset or clean an existing dirty checkout. Record root, branch, HEAD, and `git status` before editing.
2. With Node 24.10+ and pnpm 11.19 available, run from the repo root:

   ```sh
   pnpm --dir desktop-prototype install
   pnpm --dir desktop-prototype test
   node --test mobile-prototype/ios/source-contract.test.cjs
   pnpm --dir desktop-prototype smoke
   pnpm --dir desktop-prototype smoke:playback
   pnpm --dir desktop-prototype package:mac
   ```

3. Inspect the produced `.app` under `build/desktop-preview/solanime-mac-preview-*/`. Run it on the Mac, then repeat both smoke tests against the packaged executable by setting `SOLANIME_PREVIEW_EXE` to its full executable path inside `Solanime Preview.app/Contents/MacOS/` and `SOLANIME_ARTIFACTS_DIR` to a task-scoped Mac folder. Do not report a package as tested merely because Packager returned a path.
4. The cross-built Mac app is unsigned. For a distributable download, sign and notarize on the Mac with owner-managed Apple credentials kept out of Git and logs. Do not use a command that disables macOS quarantine as a shipping shortcut. No public or private binary should be advertised as protected until the packaged-app tests pass.
5. Open `mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj` in Xcode. Choose the shared `SolanimeProtectedPlayer` scheme and build the iOS Simulator target first. Resolve actual Swift/Xcode diagnostics in source. Then select the owner's local Apple development team in Signing & Capabilities and run on a **physical iPhone**. The bundle identifier may need owner-specific adjustment locally; do not commit credentials or provisioning profiles.

Useful compile-only command on Mac (does not prove device playback):

```sh
xcodebuild -project mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj -scheme SolanimeProtectedPlayer -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## Physical acceptance: both requirements together

Use mapping `384944` as the first known control, then at least three independently selected mappings from different provider labels and a title with a different episode structure. For each tested mapping record the exact title, episode ID, language, provider label and internal mapping ID, device/OS/app version, timestamp, resolved iframe origin, and any browser-host rejection counts. Do not equate one provider-host result with the whole catalogue.

Test this sequence on **both** packaged Mac and physical iPhone:

1. Fresh launch, sign in if needed, reach the selected watch route. Confirm the real provider content is visible, not a black rectangle, error code, or an audio-only page.
2. Tap/click the provider Play control. Confirm playback time advances by at least five seconds and visible frames change. Where measurable, record decoded/presented frame counts and dimensions. Record whether sound works separately.
3. Trigger known popup-prone player controls and a controlled `window.open`/`target=_blank` test. Observe that no new native window, Safari tab, external app, or same-window ad page is created; the trusted Solanime route must remain stable.
4. Seek, fullscreen and exit fullscreen, pause/resume, switch source, move to another episode, return, and restart the app. Check that stale audio stops and no off-site window opens.
5. Exercise delayed popups, blank-window-then-redirect, `_top` navigation, GET/POST forms, HTTP redirects, external-app schemes, and long-press link actions in a controlled adversarial page or test fixture. A rejected popup is not enough if the same request replaces the player or launches Safari.
6. On iPhone specifically, determine whether the prior `102630` media error persists. Capture WebKit console/device logs without cookies or token-bearing URLs. If playback fails under protection, keep the protection on and record the exact failure. Do not fall back to an unrestricted WKWebView.

Acceptance requires **visible video progress and zero unwanted windows/escapes in the same protected configuration**. An iframe load, 200 response, sound, or a synthetic blocked popup by itself is insufficient. The WebKit content-rule compilation must succeed before the site is loaded; the Retry state should appear on failure rather than a permanent blank view. The in-app player should never expose a native JavaScript bridge to provider frames.

## Release and deployment boundary

- Source merge to private `main` is a handoff for Mac-side building; it is not a native app release.
- Cloudflare Pages hosts the website/PWA. Re-deploying it will **not** add WKWebView/Electron popup control to installed web apps on Mac or iPhone.
- Only after packaged Mac **and** physical iPhone acceptance should the Mac agent produce owner-signed installables, decide private distribution, and update a Solanime download route. Before that, keep downloads labelled experimental or absent.
- Do not disable the iframe/document policy to convert a failure into an apparent pass. If a provider requires an unwanted popup, record that as a compatibility blocker for that provider and retain its catalogue mapping.

Official platform references: [Electron window-open and navigation events](https://www.electronjs.org/docs/latest/api/web-contents), [Electron request interception](https://www.electronjs.org/docs/latest/api/web-request), [Electron macOS signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Apple content-rule syntax](https://developer.apple.com/documentation/safariservices/creating-a-content-blocker), [Apple physical-device run/signing](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices).

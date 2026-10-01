# Solanime native protected-player handoff (2026-09-29)

## Main integration, production promotion, and build 8 checkpoint, 2026-10-01 00:24 CDT

Pull request `#14` merged the native Mac/iPhone host and the current iPhone-first UI into `main` at commit `4c44ff906699507597b592975f2501fcfe64de99`. The final pull-request head was `d04861306370bcdce44af727e9cb83685a993d09`. All seven required checks passed at that head: the protected iOS simulator build, Ubuntu and macOS type/unit/build jobs, and desktop/mobile Chromium/WebKit browser suites. The final CI-only correction made the touch tests reflect the shipping mobile layout: touch catalogue cards hide redundant action buttons, and phone layouts hide desktop theater mode.

All three remote D1 migration commands reported `No migrations to apply`. The guarded production Worker promotion retained its existing private assets and all 23 inherited bindings, changed only `SOLANIME_PRIVATE_SITE`, `SOLANIME_APPROVAL_REQUIRED`, `SOLANIME_ALLOWED_ORIGINS`, and `RELEASE_CHANNEL`, and reverified the anonymous approval boundary before deploying. Production Pages was then promoted from exact `main`; its immutable deployment was `https://f87dd6c0.solanime.pages.dev`. Production health read back channel `production`, release `0.8.4-alpha`, connected database, schema 13, and 9,185 titles. `verify:deployment` passed the exact frame-host restriction and version checks, and `verify:private-approval` passed all eight checks with HTTP 401 for anonymous catalogue, filter, provider, and resolve requests. The ordinary website/PWA still does not gain native popup containment from this deployment.

The signed physical-device installation remains **Solanime 0.1.0 (8)**. Device inventory read it back while the trusted iPhone was connected. Before production promotion, Mirroring visibly showed the old production readiness screen, proving that the current native shell was still loading the stale frontend rather than the handoff UI. After production promotion, the app process was terminated for a clean restart. The Mac/device session then locked, and CoreDevice refused relaunch for that specific reason. A post-promotion physical-device visual readback is therefore still pending; build/install/route loading must not be counted as playback evidence.

Exact production and package commands, with local device/signing identifiers deliberately omitted:

```sh
pnpm cloud:migrate:catalogue
pnpm cloud:migrate:accounts
pnpm cloud:migrate:research
node scripts/cloud-approval-promotion.mjs plan
node scripts/cloud-approval-promotion.mjs upload --apply --expect-current=<verified-current-version> --expect-bundle=<verified-bundle-sha256>
node scripts/cloud-approval-promotion.mjs deploy --apply --expect-current=<verified-current-version> --expect-bundle=<verified-bundle-sha256>
node scripts/deploy-pages.mjs --branch=main --promote-verified-release
pnpm verify:deployment -- https://solanime.pages.dev
pnpm verify:private-approval -- https://solanime.pages.dev
pnpm --dir desktop-prototype test
pnpm --dir desktop-prototype package:mac
```

From exact `main`, the desktop policy suite passed 4/4 and `package:mac` produced a fresh unsigned Apple Silicon app at `build/desktop-preview/solanime-mac-preview-qdhECU/Solanime Preview-darwin-arm64/Solanime Preview.app`. The packaged popup/navigation smoke ended on the approved-account login route with zero created windows. The packaged mapping `384944` playback smoke again timed out after 30 seconds waiting for `iframe[title="MegaPlay provider player"]`, because that fresh package had no approved account session. This is a precise login-gate blocker, not a playback pass and not evidence that the protection failed.

The handoff UI now on production includes the full-art phone hero, compact logo/actions, continuous top fade, six-second feature auto-advance with a 240 ms lateral transition, compact indicators near the watch action, Continue Watching before Recent Updates when present, tighter tab-bar spacing, grouped Settings with native-sized controls, the slower coordinated splash, and configured PiP/AirPlay eligibility with a native AirPlay picker on allowed watch routes. These source and browser checks do not replace an on-device visual or protected-playback acceptance run.

**Release status remains unreleased.** A signed build 8 is installed, but there is still no post-promotion physical-iPhone readback and no measured five-second video/frame advance, popup count, external-launch count, stable final mapping, Play/seek/fullscreen/source/episode/restart result, PiP/AirPlay result, or `102630` determination on that build. The current packaged Mac run is blocked by the approved-account login gate before provider playback. Keep both native protections enabled and do not publish an installable release as passing.

## Physical iPhone reconnection, 2026-09-30 15:38 CDT

The paired iPhone 16 Pro is **connected** again. `xcrun devicectl list devices` reported it connected; `xcrun devicectl device info apps` read back `Solanime`, bundle `dev.solanime.protectedplayer.preview`, version `0.1.0`, build `7`. A normal `devicectl device process launch --terminate-existing` succeeded and Mirroring displayed the latest full-art Home layout. The Debug-only, first-party watch-route launch was then attempted with `https://cloud-release.solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384944`. One launch returned CoreDevice `10004` before a process ID was determined; a retry with `--console` launched and the process remained running. Mirroring displayed the watch page with its Play triangle. This establishes a requested route and loaded player surface, **not** video playback or final source selection.

Reproduction commands, omitting the paired-device identifier:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl list devices
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device info apps --device '<connected trusted iPhone>'
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device process launch --console --terminate-existing --device '<connected trusted iPhone>' dev.solanime.protectedplayer.preview '--solanime-watch-url=https://cloud-release.solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384944'
```

Mirroring initially said **iPhone in Use** until the phone was locked, then showed the Home and watch screens. Its current computer-control screenshot is only 80×258 pixels, and attempts to click the video Play coordinate failed with `windowNotFoundAtPosition`; this is a Mirroring input failure, not evidence that Play or the video failed. A `devicectl device capture screenshot` on the locked phone returned an all-black 1206×2622 PNG, also not a video result. The owner was asked to tap Play once on the unlocked physical phone and leave it on the video for frame capture. No response or post-Play capture was available at this checkpoint. Thus no five-second visible progress, decoded-frame change, popup count, external-window result, or stable final `server=384944` observation is claimed. The protected-player release remains **unreleased**.

## iPhone UX and device checkpoint, 2026-09-30 15:18 CDT

This checkpoint supersedes the build-5 installation status below. The working branch is `sol/native-protected-player-mac-iphone`, based on `main` commit `e2f4361903f708b05d4c60fa708d3688ca226c77`; the prior remote branch HEAD was `b343eccc28079fea43a2e3ba65d88bace8d58232`. All pre-existing dirty work was preserved. The owner explicitly authorized pushing this branch to the public repository. The tested source/UI commit is `93ed5a9eec0e8f00f95d95619845d4641a380db2`; its author and committer use the existing GitHub noreply identity. This documentation update follows that source commit.

The iPhone 16 Pro previously accepted a locally signed **Solanime 0.1.0 (7)** Debug build: `xcodebuild` for the shared `SolanimeProtectedPlayer` scheme succeeded, `codesign --verify --deep --strict` passed, `devicectl` reported installation, its app inventory read back build 7, and process launch succeeded. The build uses the app-owned WKWebView protection rules and adds Apple WebKit PiP/AirPlay eligibility, an AVAudioSession playback category, audio background mode, and a native AirPlay picker only on a permitted `/watch/` route. It does not add a provider bridge, enable unrestricted navigation, or permit autoplay. `node --test mobile-prototype/ios/source-contract.test.cjs` passed 4/4. The built `Solanime.app/Info.plist` reads `CFBundleVersion=7` and `UIBackgroundModes=[audio]`, and the app still passes strict code-signature verification. The binary remains **Solanime**, without “Protected” in its displayed name. The locally selected Personal Team, profile, credentials, and device identifier are excluded from Git.

The owner supplied a Crunchyroll iPhone Home screenshot, and a readable live Crunchyroll Home mirror was inspected. Its hero uses full-width art, a dark top fade under a small emblem and search/cast actions, a short title/meta/synopsis block, one orange watch action, a bookmark action, compact progress pills, and a nearby next rail. In the supplied screenshot, the phone display occupies about 810 pixels of its 1098-pixel image width; normalized to Solanime's 390-point fixture screenshot, Solanime's next rail was visually about 45–50 points lower. The iPhone-only hero was shortened from `70svh` to `64svh` (with bounds), the indicators were moved close beneath the watch action, the top fade was made continuous, and the next rail is visible sooner. The featured carousel auto-advances every six seconds when visible and unfocused, uses a 240 ms lateral slide, and has no pause button. Reduced-motion preferences suppress automatic movement. Current Settings now has a profile-switch row, grouped playback/appearance controls, full-row touch targets, system-sized switches, and an Account & privacy entry. The splash sun rise now overlaps the ribbon animation over a slower 3400 ms intro; blurred atmospheric light replaced sharp triangular streaks. PiP and AirPlay routing are only **configured**, not physically verified.

The live Crunchyroll audit is incomplete: iPhone Mirroring displayed Home, but app click/scroll injection failed with `noWindowsAvailable` or `windowNotFoundAtPosition`, and ScreenCaptureKit briefly returned capture error `-3811`. Crunchyroll Settings and scroll behavior were **not** clicked through or measured. The Solanime screenshots below use fictional fixture art, so they verify geometry and controls, not the appearance of live catalogue artwork. Ignored, credential-free evidence: `build/native-ios-ui-shipping-7/**/native-home.png`, `native-settings.png`, `native-title.png`, `native-watch.png`, and splash frames in `build/brand-soft-bloom-7/`.

Exact final frontend commands and results:

```sh
pnpm check
pnpm exec playwright test tests/e2e/native-ios-ui.spec.ts --project=mobile-webkit --workers=1 --retries=0 --output=build/native-ios-ui-shipping-7 --reporter=line
pnpm exec playwright test tests/e2e/native-ios-navigation.spec.ts tests/e2e/profile-prompt.spec.ts tests/e2e/admin-approvals.spec.ts --project=mobile-webkit --workers=1 --retries=0 --output=build/native-ios-flow-shipping-7 --reporter=line
node --test mobile-prototype/ios/source-contract.test.cjs
node scripts/deploy-pages.mjs --branch=cloud-release
pnpm verify:deployment -- https://cloud-release.solanime.pages.dev
pnpm verify:private-approval -- https://cloud-release.solanime.pages.dev
```

The signed build can be reproduced with the owner's team selected locally, without writing it to source or this handoff:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj -scheme SolanimeProtectedPlayer -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/ios-device/DerivedData -allowProvisioningUpdates DEVELOPMENT_TEAM=<locally selected team> build
codesign --verify --deep --strict build/ios-device/DerivedData/Build/Products/Debug-iphoneos/Solanime.app
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device install app --device '<connected trusted iPhone>' build/ios-device/DerivedData/Build/Products/Debug-iphoneos/Solanime.app
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device info apps --device '<connected trusted iPhone>'
```

`pnpm check` passed 106 test files / 895 tests, TypeScript, and Vite build. The focused mobile WebKit UI test passed 1/1 after asserting the actual carousel animation events, near-action indicator spacing, Home layout, Settings controls, and dark/light accessibility checks. The frontend preview deployment is immutable `https://e19e0c1c.solanime.pages.dev`; the stable `https://cloud-release.solanime.pages.dev` alias served the same `assets/index-DqP40ye8.js` and `assets/index-7PN-gExF.css` as local `dist`. Deployment verification passed and all eight anonymous approval-gate checks passed, including HTTP 401 for catalogue, filters, providers, and source resolve. This is preview Pages only; production Pages and the API Worker were not promoted in this batch.
Four additional mobile WebKit flows passed: operator approval layout, Discover/Library/Account navigation without a page error, return to a single saved profile without a blocking prompt, and required choice among multiple profiles. These are fixture-browser results, not a physical iPhone readback.

At this checkpoint `xcrun devicectl list devices` reports the paired iPhone 16 Pro **unavailable**. The previously installed build 7 should fetch the new preview assets on its next launch, but an on-device readback of this exact frontend is not established. There is no measured five-second advancing video or decoded-frame count on iPhone build 7, no tested PiP/AirPlay receiver route, and no same-configuration popup/window/route result. The current approval gate also blocks a fresh packaged-Mac real-playback test without an approved session. Earlier packaged-Mac mapping evidence in the chronological notes predates that gate. The protected-player release remains **unreleased**; do not infer video success from iframe load, audio, the signed install, or the owner's earlier uninstrumented playback observation.

## iPhone design and release checkpoint, 2026-09-30 13:33 CDT

The branch remains `sol/native-protected-player-mac-iphone`; the source checkpoint before this batch was `b343eccc28079fea43a2e3ba65d88bace8d58232`. Existing uncommitted work was retained. This batch is an iPhone-first visual revision; it does **not** satisfy protected-player release acceptance. Its final Git commit is recorded in the follow-up commit note below.

The signed host's `WKUserScript` marks only the first-party main document at document start with `solanime-native-ios`. A separate native-app stylesheet applies Apple system typography with Dynamic Type's WebKit font shorthand, safe-area insets, a four-destination Home/Discover/Library/Account tab bar, 44-point-or-larger controls, grouped Account/Settings surfaces, and a dark/light accent with sufficient text contrast. Category selection moved out of the iPhone tab bar and remains available in Discover. The title save action is now a 48-point icon control with its accessible text retained; its prior label clipped at 390 CSS pixels. The header uses a conventional settings gear and drops the duplicate Account icon in the signed iPhone presentation. The website/PWA never gets the native class or this tab bar. These are WebKit-rendered first-party controls, not SwiftUI `TabView` controls; the provider frame receives no script or native bridge. Native loading now uses a smaller mark and a plain black surface, and the failure state has a clear shield icon and large Retry control. The installed app is still named **Solanime**.

The current physical-device candidate is **Solanime 0.1.0 (5)**, locally signed for Debug with the previously selected Personal Team and `dev.solanime.protectedplayer.preview`. `xcodebuild` for both `generic/platform=iOS Simulator` without signing and `generic/platform=iOS` with locally managed signing ended `** BUILD SUCCEEDED **`; `codesign --verify --deep --strict` passed. The source-contract tests passed 2/2 and `swift mobile-prototype/ios/validate-content-rules.swift` compiled the content rules. No credential, team ID, provisioning profile, or device ID is committed. Exact build and static checks:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj -scheme SolanimeProtectedPlayer -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO -derivedDataPath build/ios-simulator-design-5 build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj -scheme SolanimeProtectedPlayer -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/ios-device/DerivedData -allowProvisioningUpdates DEVELOPMENT_TEAM=<locally selected team> build
codesign --verify --deep --strict build/ios-device/DerivedData/Build/Products/Debug-iphoneos/Solanime.app
node --test mobile-prototype/ios/source-contract.test.cjs
swift mobile-prototype/ios/validate-content-rules.swift
pnpm check
pnpm exec playwright test tests/e2e/native-ios-ui.spec.ts --project=mobile-webkit --project=mobile-chromium --workers=1 --retries=0 --output=build/native-ios-ui-5d --reporter=line
```

`pnpm check` completed with 105 test files, 891 tests, typecheck, and Vite build. The focused signed-style iPhone presentation passed 2/2 across mobile WebKit and Chromium at 390×844: no horizontal overflow on home/title/watch, four visible tab destinations with the website tab bar hidden, 48-point title-save control, 44-point source select, and zero WCAG A/AA violations on the title page in dark or light appearance. Ignored screenshots are `build/native-ios-ui-5d/**/native-home.png`, `native-title.png`, and `native-watch.png`; they contain fictional fixture titles. The first run exposed a 59-point bar against a 60-point target, the second exposed light-mode primary-button contrast, and a screenshot exposed a clipped “My List” label; each was fixed before the passing run. The full mobile WebKit suite against the prior stable dist passed 100 tests with 4 skips in 7.4 minutes. These browser fixtures do not prove playback on the phone.

`node scripts/deploy-pages.mjs --branch=cloud-release` deployed the latest frontend preview to immutable `https://67d2f39a.solanime.pages.dev` and stable `https://cloud-release.solanime.pages.dev`; both local `dist/index.html` and the alias served `assets/index-CTfZ1oId.js` and `assets/index-BrrNoOo3.css` at readback. `pnpm verify:deployment -- https://cloud-release.solanime.pages.dev` passed version/frame checks and `pnpm verify:private-approval -- https://cloud-release.solanime.pages.dev` passed all eight anonymous gate checks, including 401 on catalogue, filters, providers, and resolve. This was a preview Pages deployment only, not production or native release.

Installation of build 5 on the previously paired physical iPhone 16 Pro was attempted with `xcrun devicectl device install app --device '<paired iPhone>' --timeout 45 --json-output build/ios-install-5.json build/ios-device/DerivedData/Build/Products/Debug-iphoneos/Solanime.app`. It failed before transfer with `com.apple.dt.CoreDeviceError 4016`: no currently assertable connectivity/service states. The last reported phone connection was earlier that morning. **Build 5 is not installed on the physical iPhone yet.** The owner has been asked to reconnect and unlock it. The existing phone installation remains build 3 unless an independent device readback proves otherwise.

The protected Mac package still cannot demonstrate current real playback behind the approval gate without an approved session; earlier mapping/frame results below predate that gate. Build 5 has no physical iPhone Play, seek, fullscreen, switch, restart, five-second frame, popup, or route measurement. Error `102630` remains neither reproduced nor ruled out in build 5. Keep protection in place and the native release unreleased. Episode metadata audit found 134,825 Anikoto episodes and **zero episode stills** in the live D1; no artwork was fabricated. The importer now rejects provider quality markers such as `HD-1080p` and `Full` as episode titles. One Piece route `/508` is local episode ID 508 (canonical episode number 1), not episode number 508.

## Latest Mac and physical iPhone checkpoint, 16:09 CDT

This section supersedes the earlier chronological notes below where they say Xcode or a phone was unavailable. The working checkout is `~/Developer/solanime-native-player`, branch `sol/native-protected-player-mac-iphone`. Before these edits, HEAD was `ae4a099d21d51140626d8f357ac182d4ae5617d1`; the checkout had local changes, which were preserved. The original base remains `main` commit `e2f4361903f708b05d4c60fa708d3688ca226c77`.

The verified source/UI/gate batch was committed as `37d62142c3205522339eae8b7a6b54e1efe0a121` with the repository's GitHub noreply identity. This handoff update records that SHA in a follow-up documentation commit; the branch is public by the owner's explicit direction. Local build artifacts, iPhone provisioning material, device identifiers, and the approved applicant's address were excluded from Git.

Xcode 27 is now installed. The shared `SolanimeProtectedPlayer` scheme compiled with locally managed automatic signing; the installed display name is **Solanime**, the native launch screen uses the brand mark on a dark background, and no team identifier or profile is stored in source. The physical device is an iPhone 16 Pro (`iPhone17,1`) on iOS 27.0 (`24A5424a`). The locally signed Debug app was built, code-signature verified, installed, launched, and read back as **Solanime 0.1.0 (3)** (`dev.solanime.protectedplayer.preview`). The owner was told the phone can be unplugged after installation. The app-owned WKWebView still compiles its rules before the first page load, denies new windows and disallowed document navigation, and exposes no provider bridge. Debug build 3 opens the exact first-party preview origin `https://cloud-release.solanime.pages.dev/`; Release remains pinned to `https://solanime.pages.dev/`. This is a development UI preview, not distribution.

Reproduction commands (the local Personal Team value is deliberately redacted):

```sh
node --test mobile-prototype/ios/source-contract.test.cjs
swift mobile-prototype/ios/validate-content-rules.swift
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj -scheme SolanimeProtectedPlayer -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath build/ios-device/DerivedData DEVELOPMENT_TEAM=<locally selected team> CODE_SIGN_STYLE=Automatic build > build/ios-device-build-3.log 2>&1
codesign --verify --deep --strict build/ios-device/DerivedData/Build/Products/Debug-iphoneos/Solanime.app
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device install app --device '<connected trusted iPhone>' build/ios-device/DerivedData/Build/Products/Debug-iphoneos/Solanime.app
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device process launch --terminate-existing --device '<connected trusted iPhone>' dev.solanime.protectedplayer.preview
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device info apps --device '<connected trusted iPhone>'
```

The build log ends `** BUILD SUCCEEDED **`, the strict signature check passed, `devicectl` reported an installed app and a launched process, and its app inventory reported version `0.1.0`, build `3`. The source-contract tests passed 2/2 and WebKit content-rule compilation passed. The owner reported seeing video playback on an earlier phone build, but our device capture was black and iPhone Mirroring later reported **iPhone in Use**, so this run does not establish the exact mapping played, five seconds of visible progress, frame changes, popup attempts, actual Safari/external launches, or a stable watch route on build 3. Error `102630` has not been reproduced or ruled out. Do not turn the owner's observation into a measured acceptance result.

The live API approval gate was repaired on Worker version `67aa15e8-b169-40a7-b6ba-eb07e9f0617d` (previous serving version `9f8088b8-3619-4b13-bca1-d8c0450dd0fd`) using an asset-preserving version upload. `pnpm verify:private-approval -- https://solanime.pages.dev` and the same check on the preview alias passed all eight anonymous checks: catalogue, filters, providers, and resolve were 401. A single immediate catalogue check returned 200 during Worker propagation; later repeated checks returned 401. The private baseline health canary remained unchanged. One specifically requested pending account was approved in the remote ACCOUNTS D1 database after matching its exact email and account ID; readback was `approved`, `auth_state=active`, `auth_revision=2`, with zero pre-existing sessions. Its owner notification had failed and no applicant email was verified; the address is omitted from this public handoff. A successful sign-in and a fresh pending-account approval flow remain to be tested. See `docs/CLOUD_RELEASE.md` for the Worker plan, digests, commands, and propagation observation.

The mobile viewing UI, account/registration/recovery screens, episode list fallback, and splash loading fallback were revised. Anikoto-backed episode-name repairs were read back for `Unlimited Psychic Squad` (12/12 specific names) and `Deji Meets Girl` (10/12); One Piece was intentionally not modified because the source inventory did not match D1. Actual per-episode stills were absent for those two titles, so the UI uses numbered text rows instead of repeating title art. See `docs/EPISODE_STILL_SOURCE_REVIEW_20260929.md` for candidate rights and crosswalk limits. At 320px in mobile WebKit, the account cards now have insets, profile name/status are separated, the filter panel is opaque, catalogue options omit misleading global counts, and the watch page has no horizontal overflow. The player now shows Play after metadata without a pre-Play false timeout. The splash artwork no longer intercepts its recovery controls; all three mobile WebKit splash E2Es passed. Mobile WebKit fixture checks covered these layouts and Play/source behavior; they do not prove physical-device video. The restricted operator console now has a clearer approval queue and failed-email retry controls, with three focused tests passing. `pnpm check` passed 105 files / 889 tests, typecheck, and Vite build. A mobile WebKit registration/sign-in/recovery E2E passed. The refreshed frontend was deployed only to `https://cloud-release.solanime.pages.dev` (immutable deployment `https://f923b8ce.solanime.pages.dev`), with alias asset hashes and verification in `docs/CLOUD_RELEASE.md`. The production Pages frontend was not promoted. The installed Debug iPhone build 3 points to the alias and can fetch this UI on restart; an on-device visual readback after this deployment has not been captured.

At 15:53 CDT, `pnpm --dir desktop-prototype test` passed 4/4, `node --test mobile-prototype/ios/source-contract.test.cjs` passed 2/2, and `swift mobile-prototype/ios/validate-content-rules.swift` compiled the WebKit rules. `pnpm --dir desktop-prototype package:mac` produced a fresh unsigned arm64 app at `build/desktop-preview/solanime-mac-preview-YmXV64/Solanime Preview-darwin-arm64/Solanime Preview.app`. With `SOLANIME_PREVIEW_EXE` pointing to its `Contents/MacOS/Solanime Preview`, `SOLANIME_ARTIFACTS_DIR` set to `build/desktop-preview/packaged-after-gate-popup`, and `pnpm --dir desktop-prototype smoke`, the synthetic top-level popup/navigation probe reported zero new windows and a stable `https://solanime.pages.dev/` route. Its screenshot shows the private sign-in gate, not a provider player. With the same executable, `SOLANIME_ARTIFACTS_DIR=build/desktop-preview/packaged-after-gate-playback-384944`, `SOLANIME_WATCH_URL='https://solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384944'`, and `pnpm --dir desktop-prototype smoke:playback`, the run failed after 30 seconds waiting for `iframe[title="MegaPlay provider player"]`; no approved account session was supplied to the newly gated production origin. This is a precise current playback blocker, not a protected-player failure or a pass. The screenshot/log artifacts are local and ignored by Git.

**Native release remains blocked.** The packaged Apple Silicon Mac video evidence below was measured before the approval gate and preview UI changes; it must be repeated with an approved session for the current configuration. No per-mapping, five-second video/frame, and zero-window run has been captured on the physical iPhone in build 3. Play, seek, fullscreen, episode/source switching, restart, and adversarial document navigation remain unmeasured on build 3. Keep both native protections in place and do not advertise installable distribution as passing.

## Purpose and exact state

The installed Solanime website/PWA is not a browser with control over a foreign iframe. This branch adds app-owned browser hosts so a future Mac app and iPhone app can refuse new windows and disallowed document navigation without adding the HTML `sandbox` attribute that MegaPlay rejects. The source is intended to be merged for Mac-side continuation; it is **not** evidence that an iPhone binary exists, that every provider plays, or that the ordinary website now blocks provider popups.

The Windows Electron host has one bounded combined result: on 2026-09-29 mapping `384944` (`Unlimited Psychic Squad`, episode `124554`, subtitled, MegaPlay iframe `https://megaplay.buzz/stream/s-2/20121/sub?s=tcdn`) advanced from 16.42 to 21.99 seconds and 47 to 181 decoded frames. A real click inside that provider frame called `window.open('https://example.com/solanime-popup-probe', '_blank')`; it returned `null`, zero additional windows appeared, and the Solanime route stayed stable. A separate external-link click stayed on Solanime. The updated packaged Windows x64 app then passed the same combined probe: 22.71 to 28.29 seconds and 32 to 166 frames, zero new windows, stable route. This is not a Mac or iPhone run. Do not generalize it to other mappings or devices.

The Mac package target exists but **did not produce a bundle on Windows**: Electron Packager reported that Windows symlink privileges were unavailable. `package:mac` now fails nonzero in that case rather than silently reporting success. The iOS Xcode project and shared scheme are source-complete but cannot be compiled or run on this Windows host. Static source-contract tests are not a substitute for Xcode or device acceptance.

## Mac continuation started 2026-09-29 at 13:31 CDT

The clean working checkout is `~/Developer/solanime-native-player`, branch `sol/native-protected-player-mac-iphone`, based on `main` commit `e2f4361903f708b05d4c60fa708d3688ca226c77`. The original checkout under the cloud-managed Documents folder was abandoned after macOS made `.git/HEAD` dataless; no pre-existing checkout was reset or cleaned. The Mac is Apple Silicon (`arm64`) on macOS 27.0 (26A5416b); desktop package version is `0.1.0`. Node is 24.16.0 and pnpm is 11.19.0.

Commands and bounded results from the clean checkout:

```sh
pnpm --dir desktop-prototype install --frozen-lockfile # passed
pnpm --dir desktop-prototype test                    # 4/4 passed
node --test mobile-prototype/ios/source-contract.test.cjs # 2/2 passed
pnpm --dir desktop-prototype smoke                   # passed; 0 new windows, Solanime route stable
pnpm --dir desktop-prototype smoke:playback          # first run failed: provider frame detached
pnpm --dir desktop-prototype smoke:playback          # rerun exited 0, but screenshot showed Vidstream-2 fallback
pnpm --dir desktop-prototype package:mac             # produced unsigned arm64 .app
SOLANIME_PREVIEW_EXE='<app>/Contents/MacOS/Solanime Preview' SOLANIME_ARTIFACTS_DIR='<checkout>/build/desktop-preview/packaged-test' pnpm --dir desktop-prototype smoke # passed
SOLANIME_PREVIEW_EXE='<app>/Contents/MacOS/Solanime Preview' SOLANIME_ARTIFACTS_DIR='<checkout>/build/desktop-preview/packaged-test' pnpm --dir desktop-prototype smoke:playback # exited 0
```

The package is at `build/desktop-preview/solanime-mac-preview-ZCUJVn/Solanime Preview-darwin-arm64/Solanime Preview.app`. In its popup/navigation smoke, there were zero new windows and the top-level route remained `https://solanime.pages.dev/`. In its playback smoke, the requested route was Unlimited Psychic Squad episode `124554`, subtitled, `server=384944`; the iframe origin was `https://megaplay.buzz`, observed media time advanced from 0 to 6.234 seconds, decoded frames from 0 to 108 at 1920×1080, and a clicked `window.open` inside the provider frame returned denied with zero new windows. The screenshot showed visible video and the `HD-1` source label. The live providers API maps `384944` to `HD-1` and `384943` to `Vidstream-2`. However, the smoke script checked only the route path, not the final `server` query or selected `<select>` value. The first source rerun ended on `Vidstream-2`, demonstrating that a provider error can auto-switch mappings while still making the current script exit zero. Therefore these runs are **preliminary Mac evidence**, not a verified per-mapping acceptance result. The ignored local screenshots are `build/desktop-preview/desktop-real-playback-smoke.png` and `build/desktop-preview/packaged-test/desktop-real-playback-smoke.png`; neither contains account credentials. Additional mapping, seek, fullscreen, episode/source-switch, restart, and adversarial navigation tests remain.

### Packaged Mac acceptance update, 14:10 CDT

`desktop-prototype/real-playback-smoke.cjs` now requires the final `server` query **and** selected source value to match the requested mapping, plus at least five seconds of advancing media time and increasing decoded frames. This closes the automatic-fallback false pass above. Using the same unsigned packaged Apple Silicon `0.1.0` app on macOS 27.0, with `SOLANIME_PREVIEW_EXE` set to its `Contents/MacOS/Solanime Preview` executable and a separate `SOLANIME_ARTIFACTS_DIR` per mapping, the exact command `pnpm --dir desktop-prototype smoke:playback` produced:

| Title / local episode ID / language | Mapping / selected label | Video time (seconds) | Decoded frames / dimensions | Clicked popup / new windows / route |
| --- | --- | --- | --- | --- |
| Unlimited Psychic Squad / `124554` / sub | `384944` / `HD-1` | `6.015611` → `12.605612` | `9` → `169`, 1920×1080 | attempted, denied / `0` / exact watch route and mapping stable |
| Unlimited Psychic Squad / `124554` / sub | `384943` / `Vidstream-2` | `12` → `18.193266` | `5` → `247`, 1920×1080 | attempted, denied / `0` / exact watch route and mapping stable |
| 100 Meters / `16066` / sub | `52635` / `HD-1` | `0.148277` → `6.691812` | `9` → `173`, 1920×1080 | attempted, denied / `0` / exact watch route and mapping stable |
| One Piece / `508` / sub | `1996` / `HD-1` | `0` → `6.127595` | `0` → `151`, 1440×1080 | attempted, denied / `0` / exact watch route and mapping stable |

Reproduction commands from the repository root (the app path is the actual packaged output):

```sh
APP_EXE="$PWD/build/desktop-preview/solanime-mac-preview-ZCUJVn/Solanime Preview-darwin-arm64/Solanime Preview.app/Contents/MacOS/Solanime Preview"
SOLANIME_PREVIEW_EXE="$APP_EXE" SOLANIME_ARTIFACTS_DIR="$PWD/build/desktop-preview/packaged-mapping-384944" SOLANIME_WATCH_URL='https://solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384944' pnpm --dir desktop-prototype smoke:playback
SOLANIME_PREVIEW_EXE="$APP_EXE" SOLANIME_ARTIFACTS_DIR="$PWD/build/desktop-preview/packaged-mapping-384943" SOLANIME_WATCH_URL='https://solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384943' pnpm --dir desktop-prototype smoke:playback
SOLANIME_PREVIEW_EXE="$APP_EXE" SOLANIME_ARTIFACTS_DIR="$PWD/build/desktop-preview/packaged-mapping-52635" SOLANIME_WATCH_URL='https://solanime.pages.dev/watch/100-meters-5zlwp/16066?language=sub&server=52635' pnpm --dir desktop-prototype smoke:playback
SOLANIME_PREVIEW_EXE="$APP_EXE" SOLANIME_ARTIFACTS_DIR="$PWD/build/desktop-preview/packaged-mapping-1996" SOLANIME_WATCH_URL='https://solanime.pages.dev/watch/one-piece-odmau/508?language=sub&server=1996' pnpm --dir desktop-prototype smoke:playback
```

The respective full watch routes are `https://solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384944`, the same route with `server=384943`, `https://solanime.pages.dev/watch/100-meters-5zlwp/16066?language=sub&server=52635`, and `https://solanime.pages.dev/watch/one-piece-odmau/508?language=sub&server=1996`. Each iframe resolved on `https://megaplay.buzz`; the screenshots in `build/desktop-preview/packaged-mapping-<id>/desktop-real-playback-smoke.png` show actual anime frames and the selected source. They are retained locally, ignored by Git, and contain no credentials. No Safari or external-app launch was observed during these runs; the harness counted Electron windows and asserted the top-level route, but did not instrument OS-level external launches.

The watch-route segment `508` for One Piece is Solanime's **local episode ID**, corresponding to canonical episode **number 1** (Anikoto source episode ID `30298`). Canonical One Piece episode number 508 has local ID `1015` and Anikoto source episode ID `30805`. The packaged Mac run above therefore tested One Piece episode 1; it must not be reported as a test of episode number 508.

The exact command `SOLANIME_PREVIEW_EXE='<packaged executable>' SOLANIME_ARTIFACTS_DIR='<checkout>/build/desktop-preview/packaged-interaction' node desktop-prototype/interaction-smoke.cjs` passed on a later run. On `384944`, the player control paused at 56.640712 seconds and resumed to 58.142117 seconds with frames 66 → 102. The provider Seek slider's ArrowRight moved 58.150802 → 64.471708 seconds with frames 103 → 154. Fullscreen entered and exited. Source switching selected `384943` and advanced 69.297821 → 74.813246 seconds, frames 270 → 402. Next episode `124555` advanced 1.212902 → 6.723209 seconds, frames 35 → 167, then the route returned to `124554`. After app restart, `384944` advanced 75.115459 → 80.626461 seconds, frames 58 → 190, and new windows remained `0`. The complete redacted JSON is local at `build/desktop-preview/packaged-interaction/interaction-smoke.json`, with screenshot `after-restart.png`.

This sequence was intermittent: a first run failed while waiting for a provider frame that detached; a second passed controls but missed the source-switch five-second threshold; a third passed through episode return but timed out waiting for a video element after restart; the next run passed all stages. These are recorded as transient provider/load observations, not erased by the later pass. The current interaction harness does not yet cover delayed popups, `_top`, form redirects, external-app schemes, or long-press behavior. The native protection was never disabled.

The iOS project was opened with `open -a Xcode mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj`, but that command failed because Xcode was not installed on this Mac; the exact `xcodebuild -project ... -scheme SolanimeProtectedPlayer -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` command failed because only Command Line Tools were active. No physical iPhone was detected over USB at that initial check. `mas install 497799835` failed because it requested a terminal sudo password, which was not entered. `swiftc -frontend -parse mobile-prototype/ios/SolanimeProtectedPlayerApp.swift`, `plutil -lint` on the project, and `xmllint --noout` on the shared scheme passed, but none is an iOS build or device run. The Mac WebKit compiler initially rejected the iOS ad rule with `Disjunctions are not supported yet`; the rule now uses a WebKit-supported host boundary, and `swift mobile-prototype/ios/validate-content-rules.swift` reports `WebKit content rules compiled successfully.` The source still fails closed if rule compilation fails at runtime. Debug-only Web Inspector access and app version `0.1.0 (1)` were added for device diagnostics.

The branch was pushed at commit `f8f02831790af21f2091c5f5ed078fba0f9ecc83`. Its GitHub Actions run `https://github.com/slaveofsolace/solanime/actions/runs/36615557123` built the shared `SolanimeProtectedPlayer` scheme for a generic iOS Simulator with signing disabled on Xcode 26.6 (17F113); its rule-validation and build steps both succeeded. This is a real Xcode compile but still **not** a local Xcode run, a signed build, or physical iPhone playback evidence. GitHub reports this repository public, and the owner explicitly authorized pushing this branch publicly; no signing identities, credentials, or profiles were committed.

At 14:10 CDT, the user's iPhone enumerates as `iPhone@00100000` in `ioreg -p IOUSB -w0`, and the user reports trusting this Mac. Xcode is still absent (`open -Ra Xcode` fails, `xcodebuild -version` selects only Command Line Tools). The official App Store Xcode 27 redownload reached 45.1% but was paused when free disk space fell below 1 GiB; the App Store listing reports a 10.24 GB installed size. The owner has been asked to free space or identify specific disposable data. Device model/iOS version, local signing, install, playback, and whether error `102630` recurs all remain unverified. No attempt was made to use a different unrestricted WebView.

**Release state: blocked.** The protected iPhone app has not been built or tested on the physical device, and some Mac adversarial cases remain. No signed/notarized Mac distribution, signed iPhone distribution, or protected download route should be offered yet.

## Source map

- `desktop-prototype/main.cjs`: Electron host. Renderer sandbox, no Node integration, no preload/native bridge, no webview tag; rejects all new windows, downloads, non-fullscreen permissions, and disallowed frame navigations. A network-stage rule independently blocks disallowed document loads while leaving unrelated media, captions, manifests, and scripts alone.
- `desktop-prototype/policy.cjs` and `policy.test.cjs`: exact site/provider-document policy and one observed ad-host filter. This is deliberately not an arbitrary network allowlist. A CDN host may be required to deliver video while still being forbidden as a document destination.
- `desktop-prototype/smoke.cjs`: clicked popup and off-site navigation probes.
- `desktop-prototype/real-playback-smoke.cjs`: real mapping plus a user-clicked popup probe inside the provider frame; measures media time, decoded frames, video dimensions, ready state, window count, and parent route.
- `desktop-prototype/package-mac.cjs`: unsigned Apple Silicon `.app` packaging. Must be run on a Mac. `package-win.cjs` remains the Windows path.
- `mobile-prototype/ios/SolanimeProtectedPlayer.xcodeproj`: iPhone app project and shared scheme; no signing team or secret committed.
- `mobile-prototype/ios/SolanimeProtectedPlayerApp.swift`: WKWebView host; denies nil-target navigations and `createWebViewWith`, checks navigation actions and redirected document responses, compiles content rules before loading, blocks all `popup`-typed loads plus the single observed `wuytg.com` ad host, and shows Retry if rule compilation fails. No native bridge is exposed.
- `mobile-prototype/ios/source-contract.test.cjs`: source-level checks only.
- `mobile-prototype/ios/validate-content-rules.swift`: compiles the iPhone source's actual content-rule JSON with macOS WebKit for a rule-syntax preflight; does not replace the Xcode or physical-device run.
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

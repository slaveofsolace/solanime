# Solanime desktop preview

This is a separate Windows test app for the popup-containment experiment. It loads the deployed Solanime site inside an app-owned Electron/Chromium window. It is **not** a native media resolver, a Brave fork, or a substitute for the Android/iPhone prototypes.

The host rejects all new windows, cancels document navigation outside the exact Solanime or known provider embed hosts, declines downloads and non-fullscreen permissions, and blocks the single ad hostname observed in the prior Android test. It does not claim complete ad filtering; an ad inside the allowed provider page or a newly observed request host may still appear. The provider can also refuse playback under these controls.

Electron's remote-content security settings remain enabled: no Node integration, no preload/native bridge, context isolation, process sandboxing, and web security. No provider code is given filesystem access. The desktop app stores its own session separately from the user's normal browser.

From this directory, run `pnpm install`, `pnpm test`, `pnpm smoke`, `pnpm smoke:playback`, then `pnpm package:win`. The package script creates a new uniquely named directory under the repository's ignored `build/desktop-preview/` folder; it never overwrites an older build. Set `SOLANIME_ARTIFACTS_DIR` to use a different output folder. Run the `Solanime Preview.exe` inside the generated directory. Set `SOLANIME_PREVIEW_EXE` to the packaged executable path to run either smoke test against the packaged app. No production website deployment is part of this preview.

On 2026-09-28, the packaged Windows x64 build passed a click-triggered synthetic popup test with zero created windows and a stable Solanime route. The known mapping `384944` (Unlimited Psychic Squad, episode `124554`, subtitled, MegaPlay) advanced from 5 to 136 decoded video frames and from 0.04 to 5.61 seconds across a real click, with no observed extra window and a stable watch route. This is one bounded mapping-level result, not all-provider coverage or proof that the provider attempted a popup in that test. Test fullscreen, seek, source switch, episode switch, sign-in, restart, and other provider mappings separately.

The iOS folder under `mobile-prototype/` is source only. There is no signed iPhone build or TestFlight link yet; sending the ordinary website URL does not give it this desktop host's popup controls.

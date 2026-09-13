# Solanime branding and motion

The approved ribbon S, play triangle, illustrated sun and original wordmark form one reusable identity. Navigation uses a cropped horizontal asset. The splash uses independently composited artwork layers, not a sequence of reference slides.

## Application integration

Import `SolanimeBrand` and `BrandReadiness` from `src/branding`. The components import their namespaced CSS; they add no application fonts, animation dependency, account calls or player behavior.

```tsx
import { SolanimeBrand, BrandReadiness } from './branding';

// Inside an existing Home link. Keep the parent link's accessible name.
<SolanimeBrand variant="compact" motion="static" theme={theme}
  decorative style={{ width: 144 }} />

// Mount once for the first primary catalogue request, not for account restore
// or optional home rails. Keep mounted when ready becomes true.
<BrandReadiness
  ready={catalogue.ready}
  error={catalogue.error}
  onRetry={catalogue.retry}
  reducedMotion={preferences.motion === 'reduced'}
  theme={theme}
  sessionKey="solanime-home-boot"
/>

// A small route or player-independent loading indicator.
<SolanimeBrand variant="emblem" motion="loading"
  reducedMotion={preferences.motion === 'reduced'} style={{ width: 32 }} />
```

`ready` is authoritative at any point. A ready-first mount renders nothing. A transition to ready immediately releases pointer interception and fades the current partial composition for at most 180ms, or 80ms with reduced motion. It does not jump to the completed logo first. There is no minimum intro duration, percentage, progress fabrication or dependency on account restoration.

Use one stable `sessionKey` for the logical application boot. Elapsed intro time survives React StrictMode and route remounts in the same document. A resolved boot, including “Continue without waiting”, will not replay. The bounded in-memory session cache is not account storage and resets on a full page load. The owning application decides whether a subsequent full page load needs the readiness screen.

Do not key this component to every route, server selection or title. Do not mount a second readiness overlay around the account boundary. Normal navigation stays static; its asset is about 5:1 and has no square canvas or background container. Saved application accents remain the shell's concern; the approved gold/indigo brand colors stay consistent.

| Interface | Values / behavior |
| --- | --- |
| `variant` | `full`, `compact`, `emblem` |
| `motion` | `static` (default), `intro`, `loading`, `ready`, `error` |
| `theme` | `dark` or `light`; light uses the same wordmark silhouette in readable ink/gold |
| `reducedMotion` | Combined with the OS preference using OR; either disables ribbon/sunrise motion |
| `onExitComplete` | Called once when an animated instance exits, including an already resolved intro |
| `onAssetError` | Reports a missing motion layer; a readable wordmark fallback remains |
| `decorative` | Use inside an already labelled link or readiness region |
| `elapsedMs` | Deterministic timeline sampling for the demo/export only; omit from the app |
| `rendering="layers"` | Force SVG layers when reviewing static geometry; normal static placements use optimized images |

`BrandReadiness` adds `ready`, `error`, `onRetry`, `onDismiss`, `timeoutMs` (default 12 seconds) and `inline`. Error or timeout stops animation and exposes retry/continue actions. `onDismiss` describes a visible overlay being dismissed; an already-ready or already-resolved first mount does not need that callback to render the application.

The main application connects this overlay to Home's primary catalogue request,
uses the static compact mark in its existing home link, and shows the small
emblem in route loaders. `isBrandSessionResolved(sessionKey)` is a read-only cache
query for a parent that must suppress a duplicate inline error while the first
overlay is visible; it does not create or restart a brand session.

## Motion source

`timeline.ts` is the shared, deterministic timeline. `BrandArtwork.tsx` holds fixed contours, clipping, texture placement and letter masks. `dom.ts` applies a sampled frame without rendering the React tree at animation-frame frequency.

The opening is 3 seconds when actual readiness lasts that long:

1. The warm ribbon tip appears, followed by front and rear path reveals. Fixed texture and overlapping masks retain dimensional depth.
2. The central triangle settles crisply; the sun rises behind the solid foreground, revealing the illustrated clouds through an occluded aperture.
3. The original eight letter silhouettes reveal with a short 34ms stagger. One restrained sheen and a thin lower flare connect the wordmark to the sunrise.
4. The completed composition continues into a 4.8-second quiet light cycle. Geometry, letter positions and triangle proportions remain fixed. The wrapping travel highlight has zero opacity at the seam.

The intro never repeats while waiting. Hidden tabs and offscreen marks stop their animation-frame scheduler and resume from the same visible time. Static/reduced-motion marks schedule no ongoing animation. Unmounting cancels the frame, observer, media-query listener and visibility listener. Assets are preloaded together so a missing layer does not create a partially assembled moving logo.

## Assets and provenance

- `public/branding/solanime-approved-master.png` is the unchanged first supplied reference; SHA-256 `7e7373bc192b5a57e2001e4d4e9554cfa68f4f1a2bc7697cd4051248b24b9ed8`.
- The other five supplied lighting references and their hashes are in `src/branding/references`. They are not runtime animation frames.
- `sun-cloudscape-source.png` and `ribbon-foreground-source.png` are separate image-generation edits of that approved identity. Their signed Content Credentials remain intact. Hidden lower clouds were reconstructed because they were not present in the flattened reference.
- The extracted foreground has small contour and alignment differences from the flattened master. It is fixed throughout this implementation, but the emblem is not claimed to be a pixel-exact trace. The wordmark uses the original glyph pixels and spacing, not a replacement typeface. Transparent edge masking and the light-theme tint change compositing, not the glyph designs.
- The refined layered master SVG embeds the same source sprites used by the web component. The rich master is raster-backed SVG, not a fully editable vector illustration. Its paths, occlusion, placements, lighting and timeline remain editable.
- `solanime-{full,compact,emblem}-{dark,light}.webp` are derived static placements. `solanime-icon-{32,192,512}.png` are transparent app-icon exports.
- `solanime-sun.webp`, `solanime-ribbon.webp` and `solanime-wordmark-sprite.webp` are runtime textures. Original PNGs are retained; ordinary navigation downloads only its compact WebP, not the masters or research data.

This asset set contains the project-supplied brand and its derivatives only. It includes no catalogue artwork, episode media, external site branding, account data or credentials.

## Preview and export

With the repository's dependencies installed using its existing pnpm lockfile:

```sh
pnpm exec vite --host 127.0.0.1 --port 5188 --strictPort
```

Open `/branding.html`. The standalone studio has Intro, Loading, Static, Exit and Error states, theme/placement controls, reduced motion, a timeline scrubber, repeated mounts and an actual-readiness test. Use “Replay at normal speed” for motion review. `?state=loading&time=4800` is a deterministic seam endpoint, not normal-speed evidence.

No production route is added automatically. The owning application can lazy-load `BrandDemo` behind a development/restricted route, or build an isolated static preview:

```sh
node scripts/branding/build-demo.mjs --output=./test-results/branding-demo
```

The destination must be empty. The build includes only the studio and needed brand assets, not the application's private configuration, catalogue or account APIs. Serve that folder with an ordinary static HTTP server and open `/branding.html`.

To regenerate assets and previews from the running studio, install Playwright's Chromium and FFmpeg once, then:

```sh
node scripts/branding/render.mjs --output=./test-results/branding-exports
node scripts/branding/package.mjs --exports=./test-results/branding-exports --output=./test-results/solanime-branding-assets.zip
```

Optional `--browser-dir` uses an existing Playwright browser installation; `--ffmpeg` accepts an explicit executable. The renderer accepts only a loopback preview origin and does not download media. Windows and macOS use the same Node commands. Use a task-owned output directory on the project's storage volume.

The output contains a refined self-contained `solanime-master.svg`, full/compact/emblem PNGs, a 25fps splash GIF, a seamless loop GIF, VP9 WebM previews, source hashes and output hashes. The splash GIF includes a short settled hold for review; the application does not impose that hold. GIFs are previews, not the runtime player for the splash. The ZIP packages an explicit brand-source/export allowlist and excludes temporary frame sequences, dependencies, private data and browser state.

## Verification

```sh
pnpm exec tsc --noEmit
pnpm exec vitest run tests/branding-timeline.test.ts tests/branding-components.test.tsx
node scripts/branding/test-browser.mjs --output=./test-results/branding-browser
```

The focused suite tests continuous timing, intro/loop seams, frozen partial exits, both reduced-motion preferences, offscreen pause, StrictMode cleanup, remount persistence, early readiness, actionable errors and timeout recovery. Browser tests run at 1440px, 768px and 320px, checking real-time motion, stable bounds, keyboard focus, both themes, accessibility, missing-layer fallback and source-independent readiness.

Recorded browser video and deterministic exports serve different purposes: video records a real requestAnimationFrame timeline, while the export samples the exact timeline reproducibly. Review both at normal speed for clipping, lighting jumps, letter ghosting and the loading seam. Passing tests does not substitute for human approval of the refined logo or for integrated application/player QA.

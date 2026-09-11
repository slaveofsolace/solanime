# Netflix-informed interface research and Solanime implementation

Research date: September 11, 2026. Scope: public primary sources, consumer-interface behavior, accessibility standards, and browser constraints. This is an independently implemented adaptation, not an export of Netflix's private design library or a claim of pixel-identical behavior across all Netflix platforms.

## 1. What “Netflix's design system” actually describes

Three related but distinct subjects matter. Netflix's **brand guidance** specifies its marks and their colors. Its **consumer experience** describes browsing, finding, saving and watching titles. **Hawkins** is the design-system infrastructure connecting design and engineering. A branded signup landing page is not a specification for a logged-in streaming catalogue.

Public Netflix recruiting descriptions identify Hawkins as spanning consumer TV, mobile and web [3], and distinguish Hawkins Consumer from Hawkins Professional for internal enterprise tooling [4,5]. The Consumer foundations role describes reusable visual/motion tokens, consistent taxonomy between design and code, domain libraries, and WCAG 2.2 AA governance. The Professional role emphasizes component APIs, accessibility, motion, theming and structured documentation. These sources establish system goals and organizational scope; they do not publish the complete token tables, component source or Figma library.

**Implementation consequence:** borrow disciplined primitives and interaction consistency rather than renaming generic components “Hawkins” or using an unaffiliated template as an official Netflix library. Solanime's theme helpers, shared dialog, artwork component, catalogue rail and native media controls are its own code. There is no imported Netflix bundle, proprietary font, Netflix logo or original Netflix marketing artwork.

## 2. Consumer navigation and discovery

Netflix's May 7, 2025 product announcement is explicitly a **TV experience** announcement. It emphasizes more immediately useful title information, moving Search/My List to more visible top navigation, and a less obstructive interface [1]. Netflix's TV help page describes the current top-menu categories and personal destination for lists, history and continued viewing [2]. Neither source is proof that every desktop browser or mobile release has exactly the same layout.

**Solanime adaptation:** retain top-level Home, Browse and My list alongside Search and Appearance; use the actual imported catalogue as the content surface. Recently updated titles, films, genres and the user's locally saved records form meaningful rows. Do not invent match percentages, recommendations derived from nonexistent viewing models, “Top 10” rankings, awards, or release dates. A recently updated database record means recently synchronized metadata, not necessarily a newly released show.

The home feature is a route into the selected title's real episode list. A More info action opens a dismissible detail dialog without losing catalogue location. Row arrows perform real horizontal scrolling and become disabled at actual boundaries. Keyboard and touch interactions have equivalent access; hover is an enhancement, not the only way to expose actions. These are Solanime design decisions inspired by content-first browsing, not claims of exact Netflix implementation details.

## 3. Brand color versus interface color

Netflix's published brand guidance specifies **Netflix Red #E50914 (RGB 229, 9, 20)** and **Symbol Dark Red #B20710** [6]. The darker red is specified in a symbol context; treating it as a mandatory universal button-hover token would go beyond the evidence. The public brand page does not establish every shade needed by Solanime's forms, disabled states, focus rings or light theme.

Solanime therefore uses the verified red as the default accent and an explicitly **adapted neutral scale**:

| Semantic role | Dark theme | Light theme | Status |
|---|---|---|---|
| Canvas | #141414 | #FFFFFF | Solanime adaptation |
| Surface | #181818 | #F5F5F5 | Solanime adaptation |
| Raised surface | #2B2B2B | #E7E7E7 | Solanime adaptation |
| Main text | #FFFFFF | #181818 | Solanime adaptation |
| Secondary text | #B3B3B3 | #5C5C5C | Solanime adaptation |
| Default accent fill | #E50914 | #E50914 | Matches published Netflix Red |

Artwork carries most of the visual variety. Accent color communicates actions and selected states, rather than tinting every panel or covering posters. White “View episodes” controls provide a strong hierarchy on the cinematic feature. These choices are not presented as Netflix's private token names.

## 4. User accents without unreadable controls

A raw color picker is insufficient: yellow text on white and dark blue on charcoal can be unusable. WCAG's text contrast criterion requires at least 4.5:1 for normal text and 3:1 for qualifying large text, with defined exceptions [7]. The color of a decorative sample swatch is not equivalent to the color of its label.

**Implemented algorithm:** preserve the user's exact six-digit hex as the fill. Choose black or white foreground by the larger contrast ratio. Separately derive an accent text/focus shade that meets 4.5:1 on each of the three active theme surfaces. Derive a dark-player shade independently because video controls remain dark even when catalogue browsing is light. Reject malformed hex rather than assigning arbitrary CSS strings.

Six presets, an arbitrary hex field, a native color picker and reset are available in Appearance and My list. Preferences persist locally and valid older settings remain intact. Invalid records recover to a working default. The same CSS custom properties drive selected server states, buttons, focus, and direct-player controls. Accent changes do not remount the iframe or reset direct-media time.

Those details implement the requested customization; the presets and algorithm are Solanime's own additions, not Netflix features. Automated tests sample both themes, extrema such as black/white, and hundreds of intermediate colors. Browser checks remain necessary because compositing and artwork backgrounds can introduce contrast problems beyond isolated token calculations.

## 5. Typography, imagery, spacing and motion

The interface uses system sans-serif fonts, clear title/metadata distinctions and consistent control sizes. It does not distribute Netflix Sans or pretend an independently chosen system font is the same proprietary typeface. The headline is large enough to establish hierarchy but bounded for long imported titles. Poster frames have stable aspect ratios and explicit missing-image behavior.

The feature's edge fades create reading space without recoloring the underlying artwork. Solanime currently has mainly portrait artwork rather than a Netflix-like editorial library of landscape key art and title lockups. The design accommodates that input; it does not fabricate extra assets or claim that enlarging a poster creates true high-resolution landscape artwork. Poster crop/fade choices are reviewable, intentional deviations from any Netflix reference.

Rails keep surrounding navigation stable. Preview dialogs trap focus through the native dialog element, support Escape and backdrop dismissal, lock background scroll while open, and restore focus to the trigger. Motion is short and functional; reduced-motion preferences disable smooth transitions. Preview video does not autoplay on hover. Netflix documents a user preference for automatic previews [8], which supports treating this behavior as controllable rather than essential to the visual identity.

## 6. Playback: authentic controls, not decorative overlays

Netflix documents keyboard actions including play/pause, fullscreen, ten-second seeking, volume and mute [9]. Its accessibility help also describes screen readers, captions and playback adjustments [10]. These establish useful interaction references, not authority to claim control over a foreign embedded video.

For direct media already supported by the application, Solanime implements theme-aware controls connected to the real HTML video element: play/pause, progress, seek, mute/volume, speed, available caption tracks, fullscreen and keyboard operation. Unsupported operations report a failure rather than animate a pretend result. No skip-intro button appears because reliable intro timing is not in the dataset. End-of-episode behavior depends on real ended events, not a timer or a synthetic success flag.

For third-party frames, the app themes the surrounding player surface and source selector. It cannot inspect or replace the foreign player's internals merely by assigning CSS to the parent page. Same-origin policy separates documents by scheme, host and port [11]. An overlay that merely imitates controls would neither change the actual provider UI nor guarantee media state. A provider's supported integration API or a permissioned local extension is needed for deeper coordination.

## 7. Redirect and tracking protection

The embedded player now receives only `sandbox="allow-scripts allow-same-origin"`; popup, download, form and top-navigation allowances are absent. MDN documents how iframe sandbox tokens grant these capabilities and cautions about combining script/same-origin permissions on a same-origin frame [12]. Solanime avoids that escape condition by allowing only the verified foreign player hostname and stream path. The app never silently removes the sandbox because a provider fails.

This is a navigation and capability boundary, **not a network firewall**. A sandboxed frame can still request resources, use permitted storage, log requests and navigate its own frame. Parent-page CSP does not become an exhaustive policy for a separately served foreign document. Keeping or removing an informational paragraph does not alter these capabilities. The requested paragraph has been removed; detailed limitations remain in technical documentation and optional Player options, not a large pre-play warning.

The optional **Solanime Guard** extension uses Chrome's documented request-rule API [13]. Standard mode blocks a small maintained tracker/ad-domain set, third-party pings, and supported-provider top-frame requests, scoped to verified Solanime tabs. Strict mode additionally denies unrecognized third-party provider requests, with explicit media-host exceptions. It can also block legitimate video/CDN requests; it is opt-in and does not bypass anti-adblock checks or authorization.

Chrome's scripting API permits CSS insertion into a specified permitted frame/document [14], and content scripts execute in isolated contexts [15]. Guard validates the top page and browser-issued frame identity, then applies the current accent to supported JW Player, Plyr and Video.js HTML selectors. It does not inject arbitrary remote code, remove DRM, spoof origin headers, or turn opaque canvas UI into editable HTML.

## 8. What this design pass can and cannot establish

The target is a coherent Netflix-informed experience: a cinematic feature, real title rows, fast detail previews, minimal navigation, controllable color and honest playback state. Success requires repeatable browsing and playback interactions, not only a visually appealing screenshot.

It does not establish a 1:1 copy of every Netflix platform, access to private Hawkins sources, complete imported episode coverage, permission for every third-party stream, or total elimination of tracking. Extension installation is per browser; deploying the site does not install Guard for visitors. Safari needs a separate signed extension implementation. Closed shadow DOM, canvas controls, changing provider markup, unknown trackers, same-origin analytics and provider request logs remain limitations.

Review includes type/unit/API tests, four desktop/mobile Chromium/WebKit browser projects, malicious-frame popup/top-navigation attempts, custom accent persistence/contrast, dialogs, rails, native controls, and a separate unpacked-extension test. Controlled test media and intercepted provider documents are not a certification of live provider playback. The release QA report records actual results and any remaining failures; this research document is not a substitute for them.

## Primary-source registry

All consulted September 11, 2026. “Undated” means the page did not provide a stable publication date in the retrieved text; dates are not inferred from search-engine crawl times.

1. Netflix, **Unveiling Our Innovative New TV Experience…**, May 7, 2025. https://about.netflix.com/en/news/unveiling-our-innovative-new-tv-experience — TV discovery/navigation goals and platform scope.
2. Netflix Help, **An update to the Netflix TV experience and layout**, undated. https://help.netflix.com/en/node/321880164349028 — navigation and My Netflix behavior.
3. Netflix Jobs, **Technical Program Manager — Hawkins Design System**, JR41124, undated. https://netflix.wd108.myworkdayjobs.com/en-US/Netflix/job/Technical-Program-Manager---Hawkins-Design-System_JR41124 — consumer cross-platform system scope; not a token release.
4. Netflix Jobs, **Systems Designer, Design Foundations**, JR41714, undated. https://netflix.wd108.myworkdayjobs.com/netflix/job/usa---remote/systems-designer--design-foundations_jr41714 — Consumer Core, tokens, taxonomy and accessibility governance.
5. Netflix Jobs, **Senior Product Designer, Design Systems**, JR40967, undated. https://netflix.wd108.myworkdayjobs.com/en-US/Netflix/job/Senior-Product-Designer--Design-Systems_JR40967 — Hawkins Professional and reusable component standards.
6. Netflix Brand, **Brand assets / Terms & Conditions**, undated. https://brand.netflix.com/en/terms/ — published red and symbol-dark-red values. JS shell did not render in direct text-open; color content was available through the search-indexed official page. No private design kit was obtained.
7. W3C WAI, **Understanding SC 1.4.3: Contrast (Minimum)**, living guidance. https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html — text contrast requirements.
8. Netflix Help, **How to turn preview autoplay on or off**, undated. https://help.netflix.com/en/node/2102 — previews as user preference.
9. Netflix Help, **Using keyboard shortcuts on Netflix**, undated. https://help.netflix.com/en/node/24855 — playback keyboard behavior.
10. Netflix Help, **Accessibility on Netflix**, undated. https://help.netflix.com/en/node/116022 — accessibility capabilities, not a copied player specification.
11. MDN, **Same-origin policy**, living documentation. https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy — foreign-frame access boundary.
12. MDN, **iframe element**, living documentation. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe — sandbox and permissions behavior.
13. Chrome Developers, **declarativeNetRequest**, living API reference. https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest — scoped blocking, session rules, initiators and limits.
14. Chrome Developers, **scripting**, living API reference. https://developer.chrome.com/docs/extensions/reference/api/scripting — document-targeted CSS injection/removal.
15. Chrome Developers, **Content scripts**, living documentation. https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts — isolated worlds, matching and permissions.
16. Playwright, **Chrome extensions**, living documentation. https://playwright.dev/docs/chrome-extensions — persistent Chromium contexts for extension tests.
17. Cloudflare, **Pages Functions advanced mode**, living documentation. https://developers.cloudflare.com/pages/functions/advanced-mode/ — deploying the existing optional `_worker.js` gateway; it is not persistent SQLite hosting.

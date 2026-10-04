# Solanime design system

## Direction

Artwork-first streaming cinema: near-black viewing-room surfaces, ember-orange signature details, large title-led hero imagery, dense landscape discovery rows, and a player-first watch page. The browsing hierarchy takes current streaming-product cues from Netflix's official 2025 TV redesign and 2026 mobile announcement, while the mark, language, data model, controls, and presentation remain independently implemented Solanime work. It uses no Netflix artwork, logo, ranking, recommendation claim, trailer, or autoplay preview.

## Type, color, and shape

Bundled `Manrope Local` is the display and interface face; the strong sans hierarchy replaces the earlier editorial-serif identity. The WOFF2 file and OFL notice live under `public/fonts/`, with Segoe UI as fallback.

Canonical tokens are in `src/styles/tokens.css`, the single palette for every route (the iPhone app adds one system-colour variant in `native-ios.css` and never overrides the viewer's accent):

- Dark: background `#090A0C`, surface `#17191D`, raised surface `#25272D`, line `#36383F`, text `#F6F6F7`, muted `#A6A8B1`.
- Light: background `#F7F7F8`, surface `#FFFFFF`, raised surface `#E9E9EE`, line `#D4D5DC`, text `#1B1C22`, muted `#585B66`.
- Cinema signature: `#EE791F`; soft dark-theme ink `#FFAE6F`. Orange is the default accent, while saved custom accents and light/dark choices remain intact. Focus and player-control inks are contrast-derived from the selected accent.
- Spacing: 4/8/12/16/24/32/48/64px. Landscape artwork and controls use 4px radii; dialogs use 8px. Shadows support player, hero, card hover, and overlay depth.

## Navigation and responsive behavior

The desktop shell uses a translucent horizontal masthead with primary destinations, Series/Films/Dubbed shortcuts, compact global search, appearance, and profile access. At 1180px category shortcuts collapse; at 820px primary labels become icons. At 760px and below the bottom navigation has five destinations (Home, Discover, Explore, Library, Account), while focused watch/auth/profile/operator routes omit audience navigation. At 360px gutters reduce to 12px. The supported minimum viewport is 320px, validated against the document client width so a classic scrollbar gutter cannot hide overflow.

## Product surfaces

- Home uses a title-led cinematic hero followed by actual Continue Watching, browse shortcuts, dense landscape catalogue rows, My List, genres, and films. Hero calls to action open known title/episode inventory; they never imply unverified playback.
- Browse/Search use shareable controls, a dense responsive landscape grid, real imported metadata, and quick-look dialogs without invented ranks, scores, or popularity.
- Title pages distinguish a metadata-only/pending episode inventory from a verified empty inventory.
- Watch keeps video, episode navigation, source, version, provenance, and previous/next actions together. The player leads; an "Up next" button carries the next episode's name; audio and server are pill choices, not dropdowns. On phones the masthead, tab bar and footer step away, a slim top bar (back + title) and the player pin to the top, and the episode list follows. On desktop the episode rail sits beside the player and opens scrolled to the current episode. `src/styles/watch.css` is the only owner of watch layout; do not add watch rules to other sheets. Native controls use the selected accent; unsupported modes fail explicitly and never fall back to an iframe.
- Library, history, appearance, and notes are local/profile-scoped and remain useful without an account. Unresolved account restoration permits public reads but no guest writes.
- Operator diagnostics are separate focused routes. Tokens are memory-only; evidence fragments load explicitly in bounded pages with cancellation, cloud diagnostics show snapshot progress and quotas, and cloud backups remain explicit CLI operations.
- Route readiness is a compact branded skeleton. Errors retain useful retry actions and do not turn transient failures into empty content.

## Interaction and motion

All visible controls require a real state transition or a clear unavailable state. Focus is visible, touch targets are at least 44px, tables and long evidence scroll within their containers, and 320px layouts must not overflow the page. Motion is short and user-controlled: 160–320ms transforms, capped tile staggering, no automatic carousel rotation, and no opacity-only text reveal. OS reduced motion overrides all animation; the profile preference can reduce it further.

## Review gates

Review at 1440×1000, tablet width, 390×844, and 320px. Exercise Home, Browse/Search, Title, Watch, Library, Auth, Profiles, Account, Appearance, operator screens, loading/error states, deep links, keyboard control, both themes, source switching, and real native playback. Fixture media and artwork prove mechanics only; they are never catalogue or live-provider evidence. Automated checks and screenshots do not substitute for human acceptance.

# Cinema interface system

The primary design record is [Netflix-informed research](NETFLIX_DESIGN_RESEARCH.md). The default accent matches Netflix Red #E50914; the neutral scale, light mode and adjustable accent palette are Solanime adaptations, not a private Hawkins export.

Core color logic lives in `src/lib/theme.ts`. The chosen fill is preserved, with separately derived foreground, text/focus and dark-player shades. Shared layout lives in `src/styles.css`; the presentation layer is `src/styles/cinematic.css`. Do not reintroduce hardcoded orange controls or tint imported artwork with an accent overlay.

Reuse CatalogueRail, Dialog, TitlePreview, AppearanceSettings and MediaControls. Preview dialogs are dismissible and restore focus. Server changes and accent changes are independent: an accent update must not restart a player or claim media is playing.

Direct video controls are ours. Foreign iframe controls remain separate unless a provider interface or the installed optional Guard extension supports them. Exact limits are in PLAYBACK_PROTECTION.md.

Acceptance checks real navigation, actual scroll edges, mobile overflow, both themes, extreme accent colors, focus restoration, intentional playback, native time progression and sandbox behavior. System fonts only; no proprietary Netflix font assets are included.

# Solanime native redesign system

## Direction

A quiet media library, not a settings dashboard or Netflix skin. Page hierarchy is background → open section → poster or media → controls. Most grouping is achieved by spacing, type size and alignment; borders belong to inputs, separators and exceptional overlays. The previous cinematic/studio override stylesheets are removed rather than layered underneath the new system.

## Tokens

`src/styles/tokens.css` is the common vocabulary. Dark background `#0C0D10`, major surface `#15161C`, control surface `#22242D`, text `#F3F2F7`, muted text `#ADB0C2`; light mode uses true white. Default iris accent `#AE9CFF` can be changed. Existing account preferences are preserved. Derived accent/focus colors retain readable contrast without rewriting the user's selected value.

Spacing uses 4/8/12/16/24/32/48/64 pixels. Controls use a 6px radius, artwork 8px, dialogs 14px. Shadows are reserved for overlays. System fonts provide display and interface type without redistributing font files. Display type scales from 32 to 60px, headings and metadata step down consistently.

## Shells and components

- Desktop browse/home/search/library: 192px navigation rail, open reading area and discreet search utility.
- Mobile: simple brand/appearance/account header and four bottom navigation destinations; content includes bottom clearance.
- Watch and authentication/profile selection: focused composition without a competing sidebar around the media.
- Catalogue cards: artwork plus title/metadata/actions, no outer card panel.
- Title: editorial title/poster/synopsis with open facts and a shared episode list.
- Watch: video, owned control rail, episode/source/version selectors, title and save action, synopsis, episodes, collapsed notes and optional unsupported-source explanation.
- Account: open two-column sections with rules, not nested settings cards. Auth is a two-column type/form composition; mobile stacks it.
- Profiles: original initial avatars in circles, clear selection/editing actions and one dialog for the editor.
- Dialogs: one modal surface, constrained width, focus restoration, Escape dismissal and backdrop. Appearance shares the same control rules.
- Empty/loading/error: concise state and action, not a large decorative card. Unsupported playback has no fake play button.

## Motion

Use short transform movement and artwork hover scaling, not persistent bouncing or text-opacity fades. Route movement is cancelled on navigation and never rekeys a watch player. Feature changes are user-controlled, with no timed rotation. Staggering is capped at six tiles. Dialog entrance is 200ms; routine UI motion is 160–320ms. OS reduced motion takes precedence; the profile setting can reduce it further. Palette changes are immediate so a mid-transition foreground does not lose contrast against a changed background.

## Review gates

Check desktop 1440×1000 and mobile 390×844, plus 320px narrow interactions. Inspect Home, Browse/Search, Title, Watch, Auth, Profiles/Editor, Account, Appearance, quick look, empty/error states and loading geometry. Verify meaningful controls, readable type, absence of redundant boxes, focus visibility, keyboard behavior, no horizontal overflow and actual media control behavior. Synthetic fixture images used in QA are not production artwork or purported imported content.

This is a review candidate. Automated layout/accessibility tests and developer inspection do not imply user acceptance or a claim that the entire site is perfect.

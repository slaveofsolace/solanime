# Solanime 0.5: browsing, motion and playback repair

This release builds on the account/profile branch. It does not replace private account data or require a browser extension. Review before merging or deploying.

## Why the sandbox warning kept returning

In 0.4, `PlayerSurface` initialized a component-local `embedMode` to `restricted`. Every new episode, language or resolved provider URL mounted a new component, resetting a user's compatibility selection. There was no persistent preference. Changing the setting on one video therefore did not fix the next one.

The default for the currently reviewed provider embed is now **Provider compatibility**. Missing/legacy preferences migrate to that default. Explicit **Restricted embed** choices remain available under **Playback settings & help**, and both modes persist in guest storage or the selected account profile. Changing modes or pressing Reload player creates a new iframe document, not just an attribute update on a loaded document. Accent, motion and Theater changes do not remount the player.

`Fix sandbox warning` is available when restricted mode is selected; it changes the stored preference and recreates the frame. It is not a spoof. Compatibility mode loads the provider normally without our sandbox and therefore does **not** provide the popup, top-navigation or tracker restrictions of a sandbox. Native sources still use Solanime's controls, but this release does not populate the native-source registry or bypass provider restrictions.

A parent preview frame or a hosting `Content-Security-Policy: sandbox` can independently restrict the application. Open the application in its own browser tab. The deployment checker identifies old frontend/API versions and a sandbox directive in the served document's CSP. It cannot introspect a cross-origin provider's internal errors or establish successful video playback from its load event.

## Interface and motion

The home feature now provides five manually navigable selections from actual catalogue records, with real title/action changes and no timer that interrupts reading. The foreground poster retains its native portrait proportions; the decorative backdrop is separate. Rails support arrow-key/Home/End scrolling while focused. The watch page has a compact episode header, calmer source panel and full-width player surface; settings no longer occupy the top of the video.

Motion uses native browser animation and CSS rather than another runtime dependency: short route entrances, staggered catalogue cards, featured selection transitions, focused control states and dialog entrances. **Appearance → Motion → Reduce motion** persists per profile. Operating-system reduced-motion preferences always take precedence. Route animation skips watch pages, and changing presentation settings does not change player identity. Theater mode survives episode changes within the watch route.

## Run a clean local review

```sh
# Node 24.10+ and pnpm 11.19.0
pnpm install --frozen-lockfile
[ -f .env ] || cp .env.example .env
pnpm run doctor
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
pnpm build
pnpm start
```

Open `http://127.0.0.1:8787` directly. In a second Terminal:

```sh
pnpm run verify:deployment -- http://127.0.0.1:8787
```

Both frontend and API must report `0.5.0`. The UI footer also displays its build version. A `0.4.0`, missing release or HTML fallback response means the new deployment is not what the browser is receiving.

## Upgrade without losing data

Before replacing code, run `pnpm run backup` and `pnpm run backup:accounts` in the existing installation. Stop application/import writers. Keep the existing `.env`, configured catalogue path, **`data/private/`**, private backup directory, and operator-registered `config/native-sources.json`. The supplied catalogue is a historical checkpoint, not a replacement for a newer production import. Use persistent database paths outside the release directory for production.

For a clean Git review, clone `feat/studio-v05` into a separate directory and fetch Git LFS. Never overlay a source ZIP onto a running installation or blindly overwrite a populated database with the package checkpoint.

## Pages preview deployment

Pages still requires a separately running persistent Node/SQLite API. Deploy the 0.5 backend as well as the frontend. Keep the prior HTTPS account configuration: `SOLANIME_APP_ORIGIN`, exact `SOLANIME_ALLOWED_ORIGINS`, private database paths and a server-only gateway token if configured. Set Pages `SOLANIME_API_ORIGIN` to the HTTPS backend origin. Never place secrets in `VITE_*` variables.

```sh
pnpm build
pnpm exec wrangler login
pnpm exec wrangler pages deploy dist --project-name solanime --branch studio-review
# Use the actual preview URL returned by Wrangler:
pnpm run verify:deployment -- https://YOUR-PREVIEW.pages.dev
```

Configure that exact preview origin in the backend before testing accounts, or use a separate staging backend to avoid disrupting the production cookie/origin setup. Verify login, five-profile switching, search, deep-link refresh, playback-mode persistence and the actual intended provider from the standalone preview URL. No promotion or main-branch merge is performed automatically.

## Verification scope

New regressions cover default compatibility, legacy preference migration, explicit restrictions, source/episode/language changes, iframe replacement on a mode change, saved motion settings, stable Theater presentation, actual spotlight links and deployed-version/CSP checks. Restricted-mode popup/top-navigation tests remain; they now explicitly select restricted mode instead of relying on the old broken default.

Browser fixtures and original test footage do not certify live provider availability. A normal un-sandboxed provider can still fail because of its own policy, an outage, extensions, browser privacy settings or media availability. Universal tracker filtering, native conversion of the full catalogue, and outgoing account email remain outside this repair.

## Primary references

- MDN iframe reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe — sandbox capabilities, inherited restrictions and why load events do not prove successful content loading.
- WHATWG iframe processing: https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox — sandbox flag behavior.
- MDN Web Animations API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API — DOM animation lifecycle.
- MDN reduced motion: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion — device preference handling.

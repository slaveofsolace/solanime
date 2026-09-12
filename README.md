# Solanime — native-player redesign candidate (0.6.0)

A media catalogue with an independently styled native player, email/password accounts and five profiles. This candidate continues `feat/studio-v05` / PR #4 from `4fd60a177f06afd2e43a79e1521c4888b4eda545`. It is not an acceptance of the previous v0.5 player or design.

## Important playback change

**Third-party webpage players are no longer loaded.** There is no Provider Compatibility mode, iframe fallback, hidden frame or extension requirement. The server refuses webpage-only resolutions, the client independently refuses them, and the site sends `frame-src 'none'`.

MP4, HLS and DASH resources registered by the operator with an ownership/license/permission reference use Solanime's own `<video>` controls. The distributed registry is intentionally empty. Existing catalogue mappings are retained, but unregistered or unsafe sources display **Unsupported source**. This does not turn the entire imported library into playable native video.

See [native playback and provider findings](docs/NATIVE_PLAYBACK.md). A configuration attestation is not independent verification of media rights. Native media hosts still receive delivery requests; this is not a claim of universal tracking protection.

## Run locally

Use Node.js **24.10+** (24 LTS recommended) and **pnpm 11.19.0**. The complete source ZIP contains the catalogue. A Git clone needs hydrated Git LFS objects.

```sh
pnpm install --frozen-lockfile
[ -f .env ] || cp .env.example .env
pnpm run doctor
pnpm check
pnpm build
pnpm start
```

Open `http://127.0.0.1:8787`. This runs both the application and catalogue/account APIs. In another terminal, run:

```sh
pnpm run verify:deployment -- http://127.0.0.1:8787
```

Both sides should report **0.6.0** and the checker should confirm that frames are blocked. `pnpm dev` starts Vite on port 5173 with its separate API. `pnpm preview` alone is not a database backend.

## Design and controls

The old layered cinema/studio styles are replaced by six cohesive modules: tokens, shell, components, catalogue, player and accounts. Desktop browsing uses a sidebar and open editorial sections; mobile uses a compact header and bottom navigation. Watch and identity screens use a focused layout. Borders distinguish form inputs and row separators, not a card around every group.

A pale iris accent is the default. Existing user accents, custom colors, dark/light themes and reduced-motion settings remain configurable. Presentation changes do not recreate active media. Profile data and credentials stay separate from the catalogue.

The native player provides play/pause, seeking, elapsed/remaining time, volume/mute, speed, available captions, fullscreen, theater, episode navigation, loading/errors and keyboard controls. Its buttons interact with the media element, not another website. Format/codec/CORS support still depends on the supplied resource and browser.

## Accounts and private data

Email/password sign-in and up to five server-persisted profiles are preserved. Passwords use salted asynchronous scrypt. Sessions use HttpOnly cookies, CSRF/origin checks and rate limits. Lists, history, notes, watched state and supported playback progress are profile-specific.

**Email verification and outgoing reset emails remain unimplemented.** Recovery uses the private code shown during registration; keep it securely. Profiles share the account password and are not parental-control boundaries.

Private accounts live in `data/private/accounts.sqlite` unless configured otherwise. Never overwrite or distribute that directory. The catalogue in the download is an old checkpoint and must not replace a newer production import.

```sh
pnpm run backup
pnpm run backup:accounts
```

## Tests

```sh
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Unit/API tests use temporary databases. Auth, navigation, native MP4/HLS/DASH, malicious legacy response, popup/network and screenshot tests are in `tests/e2e/`. Their media fixtures are original synthetic footage, not anime episodes; fixtures are not included in the production build.

For this candidate, local typecheck, 189 unit/API tests and build were executed. Self-contained Chromium component review exercised actual media decoding and controls with controlled fixture responses. The available browser environment denied top-level navigation, so full deployed/HTTP browser E2E, WebKit and current GitHub CI were **not run**. The current GitHub connector offered reads but no writes: the distributed patch has not been pushed by this session. Do not reuse earlier v0.5 CI results as evidence for this candidate.

## Deploy

Use a persistent Node host behind HTTPS, with separate persistent catalogue and private-account paths. Cloudflare Pages may host the frontend and fixed-origin API gateway, but does not replace the Node/SQLite backend. See [deployment and exact-branch application](docs/DEPLOY_NATIVE.md).

Deploy only after applying the patch, running the full checks and reviewing its supported-source behavior. No merge or public deployment is automatic. Existing research and earlier release notes remain historical; this README and the native-playback guide supersede instructions that enable provider iframe playback.

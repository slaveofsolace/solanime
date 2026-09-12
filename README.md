# Sol Anime 0.5

**0.5 update:** persistent provider-compatibility mode fixes the per-video sandbox reset; refreshed browsing and motion preserve account data. See [the release and deployment guide](docs/RELEASE_05.md).

An independent anime catalogue with a cinema-style interface, custom accents, email/password login, and up to five profiles per account. React handles the interface; a Node API serves the catalogue and private account data from separate SQLite databases.

This branch includes the earlier quality and cinema revisions. Main and production are not updated by the review package.

## Run on your Mac

Requirements: Node.js **24.10+** (24 LTS recommended), pnpm **11.19.0**, and the actual catalogue database. With Homebrew already installed:

```sh
brew install node@24 git-lfs
export PATH="$(brew --prefix node@24)/bin:$PATH"
npm install --global pnpm@11.19.0
```

Extract the complete source ZIP into a new directory and enter its `solanime` folder. A Git clone additionally needs `git lfs install && git lfs pull`; the complete ZIP already includes the original catalogue.

```sh
pnpm install --frozen-lockfile
[ -f .env ] || cp .env.example .env
pnpm run doctor
pnpm check
pnpm build
pnpm start
```

Open **http://127.0.0.1:8787**. This serves the complete interface and API. `pnpm dev` instead starts the development interface on port 5173 and its API on port 8787.

Use **`pnpm run doctor`**, not plain `pnpm doctor`: the latter invokes the package manager's own diagnostic. The project check detects Git LFS pointers, checks catalogue integrity and reports counts. Local HTTP sessions are for development, not production.

## Accounts and profiles

Open `/register`, save the private recovery code, and choose a profile. `/profiles` provides creation, editing and switching; `/account` provides password changes, recovery-code rotation, session revocation, export and account deletion.

Each of the five profiles has its own list, history, watched status, notes, appearance and supported native-player progress. Profiles share one login; they are not separate passwords, PINs or parental controls. Guest browsing remains available and does not silently migrate its browser-local records into an account.

Private data lives in `data/private/accounts.sqlite`, separately from the distributable catalogue. Passwords are salted and hashed with asynchronous scrypt; sessions use HttpOnly cookies, server-side expiry and CSRF checks. Profile writes enforce ownership and revisions. A conflicting tab displays a warning rather than overwriting newer records; account settings also permit explicit discard-and-sign-out.

**Email ownership verification and outgoing reset emails are not implemented.** Email is the sign-in identifier. Recovery uses the private code shown once at registration and rotates that code after use. Do not deploy an unconfigured email workflow or claim an email was sent. Preserve the private account database across upgrades and never put it in a public ZIP or static asset directory.

## Playback status

No browser extension installation is required to run the site. The current choices are explicit:

- **Restricted embed** retains sandbox restrictions. A provider that rejects sandboxing may refuse playback.
- **Provider compatibility (default)** persists per profile or guest browser and recreates the selected provider frame without the sandbox. This may address its rejection, but it does **not** provide popup or tracker blocking.
- **Native media** loads an operator-registered MP4/HLS/DASH source in Solanime's own theme-aware controls without the provider webpage or its advertising scripts. The registry is empty by default: the existing library has not been converted into native streams.

A hidden iframe with an overlay would not remove its network activity. This release does not claim a universal extension-free blocker, arbitrary cross-origin player styling, or verified live playback for every mapping. Earlier Guard files remain optional legacy tooling, not a new required installation. See [the account and playback architecture](docs/ACCOUNTS_AND_PLAYBACK.md) for exact boundaries and native-source registration.

The original catalogue checkpoint remains unchanged: **8,949 titles, 134,825 episodes, 183,769 language versions and 121,116 provider mappings**. Those are stored-record counts, not complete playable coverage. Only 38,015 episodes have a stored mapping. No full upstream recrawl is part of this release.

## Verify a change

```sh
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Tests use temporary/in-memory account and catalogue databases, fictional titles, original test footage and controlled iframe responses. They do not modify your production database or certify live providers. Chromium and WebKit cover desktop/mobile layouts; browser emulation is not physical iPhone certification. Logs and screenshots are written to ignored test directories.

## Deploy and back up

Use a persistent Node host behind HTTPS. In production, set `NODE_ENV=production` and an HTTPS `SOLANIME_APP_ORIGIN`, and keep both database paths on persistent storage. Set `SOLANIME_REGISTRATION=closed` during review; change it to `open` deliberately. Add email verification, delivery and operational anti-abuse support before treating unverified identifiers as verified identities.

Cloudflare Pages can host the interface and fixed-origin gateway, **not the SQLite API by itself**. Configure `SOLANIME_API_ORIGIN` in Pages and the exact `SOLANIME_APP_ORIGIN` / `SOLANIME_ALLOWED_ORIGINS` on Node. The gateway now relays the application session cookie. Optional trusted client-IP forwarding requires the same server-only `SOLANIME_GATEWAY_TOKEN` on both sides.

```sh
pnpm run backup
pnpm run backup:accounts
```

The account backup is private and contains sensitive hashes and profile data. Keep it separate from source packages. Stop application writers before a deliberate restore. Do not overwrite `data/private/` while upgrading code.

See [Mac and hosting instructions](docs/DEPLOY_ACCOUNTS.md) for the review deployment command, HTTPS settings, cookie checks, private-volume requirements and backup guidance. No merge or public deployment is performed automatically.

## Repository map

- `src/account/`, `src/pages/`: sessions, profile synchronization and interface.
- `server/accounts/`: private account persistence, validation and security.
- `server/providers/`: existing provider adapters and registered native sources.
- `server/ingestion/`, `scripts/`, `migrations/`: catalogue import and operations.
- `tests/`: API, state, native-resource, gateway and browser regressions.
- `docs/`: [architecture](docs/ACCOUNTS_AND_PLAYBACK.md), [deployment](docs/DEPLOY_ACCOUNTS.md), [design research](docs/NETFLIX_DESIGN_RESEARCH.md), and historical source investigations.

The site is independently implemented and is not operated or endorsed by Anikoto or Netflix. Earlier observations and screenshots are historical evidence, not current playback certification.

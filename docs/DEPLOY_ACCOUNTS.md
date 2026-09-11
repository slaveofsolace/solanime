# Mac review and deployment — Solanime 0.4

## Review in a new directory

This branch includes the previous quality and cinema changes. Do not overlay old and new ZIPs onto a running checkout. The complete source ZIP includes the catalogue database, **not anyone's accounts or passwords**.

With Homebrew installed:

```sh
brew install node@24 git-lfs
export PATH="$(brew --prefix node@24)/bin:$PATH"
npm install --global pnpm@11.19.0
```

Extract the source archive, enter its `solanime` directory, then:

```sh
pnpm install --frozen-lockfile
[ -f .env ] || cp .env.example .env
pnpm run doctor
pnpm check
pnpm build
pnpm start
```

Open `http://127.0.0.1:8787`. Use `/register`, save the private recovery code, then choose a profile. Open `/profiles` to add or edit profiles and `/account` for security. `pnpm dev` instead runs the frontend on port 5173 and the API on 8787. Local HTTP uses a non-Secure development session cookie; it is not a production configuration.

For a Git clone, first run `git lfs install && git lfs pull`. Your existing downloaded source ZIP already has the actual catalogue. `pnpm run doctor` checks that database; plain `pnpm doctor` is the package manager's unrelated diagnostic.

```sh
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Browser tests use a fictional in-memory catalogue, private in-memory accounts, original short media and controlled frames. They do not contact live providers or create accounts in your production database. Older Guard tests remain separately runnable but Guard installation is not a website requirement.

## Persistent Node deployment

Run the complete application behind a trusted HTTPS reverse proxy. Keep the catalogue and account databases on persistent local storage. Supply these environment values on the Node server (replace the origin with your actual frontend):

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
SOLANIME_APP_ORIGIN=https://your-frontend.example
SOLANIME_ACCOUNTS_DB_PATH=/persistent/private/accounts.sqlite
SOLANIME_DB_PATH=/persistent/catalogue/solanime.sqlite
SOLANIME_REGISTRATION=closed
```

The example leaves public registration closed while you review email-identity/recovery and anti-abuse requirements. Use `SOLANIME_REGISTRATION=open` to deliberately allow new registrations. Existing accounts can still sign in while registration is closed. HTTPS is mandatory in production and failure to configure its public origin stops startup instead of issuing insecure cookies.

Build/start:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm start
```

Use your host's process supervision; an SSH Terminal session is not durable process supervision. No hosting service or system credentials are assumed by these commands. Configure proxy/body limits and public rate limiting on the host. Keep private directories out of static roots and source archives.

## Optional Cloudflare Pages frontend

Pages still needs the above running Node API; it cannot serve the Node SQLite databases by uploading `dist/`.

In Pages runtime configure:
- `SOLANIME_API_ORIGIN`: the existing HTTPS Node API origin (no `/api` path).
- `SOLANIME_GATEWAY_TOKEN`: optional shared random server-only secret, identical on the Node server, for trusted client-IP rate limiting.

On Node configure `SOLANIME_APP_ORIGIN` and `SOLANIME_ALLOWED_ORIGINS` with the exact public Pages/custom frontend origins. Frontend POST origins are validated. Preview origins also need to be explicitly permitted. To avoid relying on an unknown generated preview hostname, use a configured branch alias as your review origin.

```sh
pnpm build
pnpm exec wrangler login
pnpm exec wrangler pages deploy dist --project-name solanime --branch accounts-review
```

A preview upload is separate from production promotion. Review `/api/health`, `/api/account/session`, registration, sign-in, refresh, profile switching, saved-list isolation and logout. The gateway now relays the host-prefixed application session cookie; a GET health check alone is not an authentication deployment test. Do not upload `.env`, private databases or native source registries as Pages assets.

## Backups and upgrades

```sh
pnpm run backup
pnpm run backup:accounts
```

The catalogue backup and account backup are different artifacts. Private account backups include password hashes and recovery-code hashes and must be protected accordingly. Stop application writers before a deliberate restore. Preserve `data/private/` or its configured volume across source upgrades. A fresh ZIP is not a restore of production accounts.

## Playback verification

The mode labelled Provider compatibility removes the iframe sandbox after explicit selection. That can address a provider's sandbox rejection but does not provide tracking or popup blocking. Restricted embed keeps protections but may be rejected. No disguised hidden player is used.

For built-in native controls without the provider webpage, register authorized media in `SOLANIME_NATIVE_SOURCES`; see ACCOUNTS_AND_PLAYBACK.md. The shipped registry contains **zero native streams** and this package does not assert that existing providers are all playable. Do not deploy with an assumption that an extension's request-filtering capabilities have somehow become normal webpage permissions.

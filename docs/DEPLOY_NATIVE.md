# Apply, review and deploy the native-player candidate

## Status and base

Candidate **0.6.0**, based exactly on `4fd60a177f06afd2e43a79e1521c4888b4eda545` on **`feat/studio-v05` / PR #4**. The current session had read-only GitHub actions; it did not push, merge, deploy or run remote CI. Apply the accompanying binary Git patch to the existing branch. Do not use unchanged main and do not treat previous v0.5 test results as this candidate's results.

## Mac prerequisites

With Homebrew already installed:

```sh
brew install node@24 git-lfs
export PATH="$(brew --prefix node@24)/bin:$PATH"
npm install --global pnpm@11.19.0
```

Use your existing authenticated Git setup for this private repository. Do not paste credentials into the terminal commands below or commit them.

## Review the complete ZIP

Extract into a new directory, not over a running installation:

```sh
unzip ~/Downloads/solanime-native-v0.6-candidate.zip -d ~/Desktop/solanime-native-review
cd ~/Desktop/solanime-native-review/solanime
pnpm install --frozen-lockfile
[ -f .env ] || cp .env.example .env
pnpm run doctor
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
pnpm build
pnpm start
```

Open `http://127.0.0.1:8787`. In a second terminal in the same project directory:

```sh
pnpm run verify:deployment -- http://127.0.0.1:8787
```

Expect frontend/backend `0.6.0`, `framesBlocked: true` and `passed: true`. The included catalogue has no authorized native registrations: **Unsupported source is expected** for its webpage-only entries. Test an actual permitted native resource before deployment; do not enable an iframe to make a demo appear successful.

## Apply to the existing branch and push

Use a separate clean checkout. The patch does not replace the catalogue or private account data.

```sh
git clone --branch feat/studio-v05 https://github.com/slaveofsolace/solanime.git ~/Desktop/solanime-native-git
cd ~/Desktop/solanime-native-git
git lfs install
git lfs pull
bash ~/Downloads/apply-solanime-native.sh ~/Downloads/solanime-native-v0.6.patch
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:e2e
git diff --stat
git diff --check
```

The helper refuses a dirty worktree, wrong branch, wrong base commit or advanced remote branch. It never force-pushes, changes main, deletes untracked files or commits secrets. Review the changes and test results, then:

```sh
git add -A
git diff --cached --name-only
git commit -m "Redesign Solanime and require native playback without provider frames"
git push origin HEAD:feat/studio-v05
```

The existing PR #4 will update. If the exact base check fails, stop and rebase/reconcile with the newer branch rather than forcing the patch. GitHub CI will run only after this real push. Do not merge until current Linux/macOS/browser jobs pass and the visual changes are accepted.

## Upgrade data safely

From the old running installation, back up both stores before replacing code:

```sh
pnpm run backup
pnpm run backup:accounts
```

Stop application and import writers. Preserve `.env`, the configured catalogue path, `data/private/`, backups and the operator's native-source configuration. The ZIP's catalogue is a historical checkpoint, not a replacement for newer imported records. Prefer absolute persistent database paths outside the release directory. The populated native registry is private configuration and now needs the authorization fields described in `NATIVE_PLAYBACK.md`; an invalid registry fails startup rather than silently weakening policy.

## Persistent Node hosting

Run `pnpm build` and then `pnpm start` on a Node 24 host behind HTTPS. Configure the application's actual HTTPS origin, registration policy and persistent paths. Example names only:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
SOLANIME_APP_ORIGIN=https://your-frontend.example
SOLANIME_ALLOWED_ORIGINS=https://your-frontend.example
SOLANIME_DB_PATH=/persistent/catalogue/solanime.sqlite
SOLANIME_ACCOUNTS_DB_PATH=/persistent/private/accounts.sqlite
SOLANIME_REGISTRATION=closed
SOLANIME_NATIVE_SOURCES=/persistent/private/native-sources.json
```

Do not set a non-existent registry file. Keep registration closed during review; the existing account system still uses recovery codes, not sent verification/reset emails. Configure secrets only in the backend environment and never in `VITE_*` variables.

## Cloudflare Pages frontend

Pages requires a separately running **0.6.0 Node API** for SQLite, accounts and source resolution. Configure Pages runtime `SOLANIME_API_ORIGIN` with that API's HTTPS origin and backend `SOLANIME_APP_ORIGIN`/`SOLANIME_ALLOWED_ORIGINS` for the exact frontend/preview origins. Existing optional `SOLANIME_GATEWAY_TOKEN` must match on both sides. Do not erase account-cookie gateway configuration when redeploying.

```sh
pnpm build
pnpm exec wrangler login
pnpm exec wrangler pages deploy dist --project-name solanime --branch native-review
# Use the actual standalone preview origin returned above:
pnpm run verify:deployment -- https://YOUR-ACTUAL-PREVIEW.pages.dev
```

Verify release, frame-blocking headers, catalogue search/deep links, login/profile isolation, your authorized native media/captions and no new tabs during control interaction. Review server logs and media CORS errors. Do not promote a failing preview, claim every imported episode works or upload a private account database with the static build.

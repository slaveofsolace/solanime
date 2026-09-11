# Review and deploy the cinema version from macOS

This version is based on the prior quality-pass branch. Main and production are not automatically merged or deployed. Use a new clone or the complete download; do not overwrite a running catalogue directory or an existing `.env`.

## 1. Prerequisites

With Homebrew already installed:

```sh
brew install node@24 git-lfs gh
export PATH="$(brew --prefix node@24)/bin:$PATH"
npm install --global pnpm@11.19.0
node --version
```

Use Node 24.10+; the dependency lockfile is unchanged. The export line applies to this Terminal session. Use your existing version manager instead of installing a second Node runtime when it already supplies Node 24.

## 2. Obtain the review branch

Authenticate to your private GitHub repository using your normal credentials:

```sh
gh auth login
git lfs install
gh repo clone slaveofsolace/solanime solanime-cinema -- --branch feat/solanime-cinema
cd solanime-cinema
git lfs pull
pnpm install --frozen-lockfile
[ -f .env ] || cp .env.example .env
pnpm run doctor
pnpm check
pnpm dev
```

Open `http://127.0.0.1:5173`. Stop with Control-C. The complete download already contains the database; for that path, extract into a new directory, enter its `solanime` folder and start at `pnpm install`.

## 3. Browser checks

```sh
pnpm exec playwright install chromium webkit
pnpm test:e2e
pnpm test:guard
```

The tests use an in-memory catalogue and original motion clip. No live streams are resolved by them. The Guard suite launches an isolated unpacked-extension Chromium profile; it does not install anything in your normal browser. Review any WebKit seek/completion failures rather than assuming a retry proves stability.

## 4. Run the complete application

```sh
pnpm build
pnpm start
```

Open `http://127.0.0.1:8787`. This serves both frontend and Node SQLite API. For persistent hosting, place the Node service behind HTTPS, retain `data/` on persistent storage, and supply HOST/PORT as appropriate. Keep administrative tokens secret and off the public frontend. Do not upload raw databases or `.env` into `dist/`.

## 5. Optional Cloudflare Pages frontend

A Pages upload does **not** deploy the Node SQLite API. First host the backend at an HTTPS origin. In Pages set the runtime binding `SOLANIME_API_ORIGIN` to that exact origin, with no `/api` suffix. On the Node service set `SOLANIME_ALLOWED_ORIGINS` to the exact preview and/or production frontend origins, comma separated.

After that configuration:

```sh
pnpm build
pnpm exec wrangler login
pnpm exec wrangler pages deploy dist --project-name solanime --branch cinema-review
```

Inspect the returned preview URL: health endpoint must return JSON, catalogue searches must work, and title/watch deep links must survive reload. Some providers can refuse your new origin or restricted frames. Do not remove sandboxing merely to make a source appear functional.

Merge/promote only after review. This branch includes the prior repair commit; the pull request description identifies how it relates to PR #1. Do not blindly apply both ZIP copies to the same working tree.

## 6. Install Guard in your normal browser, separately

Open Chrome/Edge extensions, enable Developer mode, select Load unpacked, choose `extensions/solanime-guard`, and reload Solanime. Keep strict mode off initially. Theme syncing and filtering apply only on supported Solanime origins. Owned custom domains require explicit additions to extension scope as documented in its README. Safari is not supported by this unpacked Chromium package.

No further `git push` is needed to obtain this release: the review branch is already pushed. To contribute your own reviewed edits, commit explicit files and push that branch. Never use `git add .` while sensitive local configuration or a changed database is unreviewed.

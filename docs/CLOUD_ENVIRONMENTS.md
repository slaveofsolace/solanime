# Production and staging separation

Historically, both Pages environments bound the same API Worker
(`solanime-api-preview`), so every `cloud-release` preview deploy read and wrote
the real account, catalogue and research databases. The preview origin was also
in the live API's `SOLANIME_ALLOWED_ORIGINS`, so it passed the live origin and
CSRF checks. The checked-in configuration separates future deployments, but the
remote staging migration is not complete.

## Initial read-only checkpoint — 2026-10-01

- Production remains on Pages deployment `453a3e2e` from source `acbc4dd`; the
  current UI candidate is not deployed. Read-only `verify:deployment` passed
  5/5 checks and `verify:private-approval` passed 8/8 checks. These are version,
  frame-policy and anonymous-gate results, not fresh account or playback tests.
- The active production Worker has both private-site and approval flags enabled,
  `RELEASE_CHANNEL=production`, and only the canonical production origin allowed.
  The production origin tightening in step 6 is already live.
- Cloudflare reports `solanime-api-staging` absent (`10007`). The staging D1
  databases and queue are absent from the inspected inventory, and the checked-in
  staging Firebase project and D1 IDs remain placeholders. The other existing
  Solanime review Worker shares production databases and cannot replace staging.
- The old `cloud-release` alias still reports `channel: production`. Its deployed
  frame-host check fails, and resolve returns HTTP 403 instead of the anonymous
  verifier's expected 401. Treat it as a stale production-backed preview, not a
  disposable test environment. No deployment or data change was made in this audit.
- The configured private Worker asset directory is absent from the inspected Mac
  checkouts. Restore or prepare and verify that package before deploying staging;
  never put its contents in the public Pages build.

## Isolated provisioning checkpoint — 2026-10-01 19:30 UTC

The owner completed the Cloudflare payment; Billing confirmed Workers Paid
active. The agent made no purchase. Before provisioning, all three existing
Solanime production D1 databases were exported successfully to private storage,
with SHA-256 manifests and Time Travel bookmarks retained. The exported SQL
sizes were 42,028 bytes (accounts), 153,422,903 bytes (catalogue) and 2,928,781
bytes (research). These backups and credentials are excluded from Git.

The three isolated staging D1 databases and `solanime-sync-staging` queue were
created and read back. All eight pre-existing D1 names/IDs were preserved; the
new IDs differ from production. Applied migrations: catalogue 13, accounts 4,
research 1. The initial staging accounts table was empty.

Firebase project `solanime-staging` was created on Spark with Email/Password
enabled, Analytics/Gemini disabled and no Hosting setup. Runtime recovery access
and fresh secrets are a separate setup step; project creation is not an
authenticated application test. Only `env.staging` configuration changes in this
checkpoint; production bindings, variables, asset pins and traffic stay intact.

The verified staging asset tree contains 12,613 files / 349,778,286 bytes at
`build/cloud-worker-assets-staging-20261001`. Its source SHA-256 is
`70010385d696b0d039ab0d0bd0a24297451192bceb4861050035595bfa8ff9a6`:
8,949 titles, 134,825 episodes, 183,770 versions and 121,118 provider mappings.
The import portion has one honestly labeled provenance row and no account or
research data. Existing validators checked hashes, lengths, references, file
limits, source integrity and private permissions. This older source lacks
mapping 384944 and episode thumbnail/duration/season columns; it is suitable for
isolated UI review, not evidence of production catalogue parity or native
playback. Production asset pins were not substituted.

Provisioning and asset preparation alone do not deploy the Worker or Pages.
Record actual deployment IDs, checks and account results separately when run.

The table below describes the environment separation. Provisioning above does
not establish a live staging deployment.

| | Production | Staging target |
|---|---|---|
| Pages environment | `production` (`https://solanime.pages.dev`) | `preview` (`https://cloud-release.solanime.pages.dev`) |
| Worker | `solanime-api-preview` (top level of `wrangler.jsonc`) | `solanime-api-staging` (`env.staging`) |
| D1 | `solanime-{catalogue,accounts,research}-preview` (unchanged IDs) | `solanime-{catalogue,accounts,research}-staging` (provisioned) |
| Queue | `solanime-sync-preview` | `solanime-sync-staging` |
| Rate-limit namespaces | `2026091201`, `2026091202` | `2026100101`, `2026100102` |
| Firebase project | `solanime-9ef23` | `solanime-staging` (Spark) |
| Secrets | existing | new values, never copied from production |
| Sync, refresh, cron | on | off |
| `RELEASE_CHANNEL` | `production` | `staging` |

The live databases keep their `-preview` names. D1 databases cannot be renamed,
and the earlier release guide already chose to keep their stable IDs on
promotion instead of copying data. **No account, catalogue or research row moves
in this migration.** The production Worker keeps its name for the same reason:
renaming it means a new Worker, re-entered secrets and moving the queue consumer,
for no isolation benefit. Treat a rename as optional, separate work.

`tests/cloud-publication-boundary.test.ts` fails if staging ever shares a Worker,
database, queue, limiter namespace, Firebase project or origin with production.

## Migration steps

Run these from an authorized Wrangler login in the reviewed account. Before any
`--env staging` command, verify every staging binding references its intended
isolated resource. Reuse existing staging resources if a newer inventory finds
them; never substitute production IDs. The migration wrappers do not provision
Firebase, generate secrets or reconstruct missing private assets. Step 6 is
conditional because its production variable changes are already live at the
checkpoint above.

1. **Back up production first.** Export each live database to private storage
   outside the repository and note the Time Travel point:
   ```sh
   wrangler d1 export solanime-accounts-preview --remote --output=<private>/accounts.sql
   wrangler d1 export solanime-catalogue-preview --remote --output=<private>/catalogue.sql
   wrangler d1 export solanime-research-preview --remote --output=<private>/research.sql
   wrangler d1 time-travel info solanime-accounts-preview
   ```
2. **Create a staging Firebase Spark project** with email/password only. Put its
   project ID in `env.staging.vars.FIREBASE_PROJECT_ID`.
3. **Create the staging resources** and replace the three `REPLACE-…` database IDs
   in `env.staging.d1_databases` with the printed IDs:
   ```sh
   wrangler d1 create solanime-catalogue-staging
   wrangler d1 create solanime-accounts-staging
   wrangler d1 create solanime-research-staging
   wrangler queues create solanime-sync-staging
   ```
4. **Set fresh staging secrets** through Wrangler's private prompt. Generate a new
   `SOLANIME_ADMIN_TOKEN` (32+ characters) and a new `AUTH_CREDENTIAL_KEY`; use the
   staging Firebase project's API key and service account. Never reuse the
   production values.
   ```sh
   wrangler secret put SOLANIME_ADMIN_TOKEN --env staging
   wrangler secret put AUTH_CREDENTIAL_KEY --env staging
   wrangler secret put FIREBASE_API_KEY --env staging
   wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON --env staging
   ```
5. **Bring up staging and move the preview site onto it.**
   First restore the reviewed private import/baseline package, or prepare and
   verify a fresh package with the [existing asset tools](../scripts/cloud-data/README.md)
   and deliberately update staging pins. Keep production asset pins unchanged.
   The staging Worker inherits the top-level asset directory unless an explicit
   staging directory is configured; a missing directory blocks deployment.
   ```sh
   pnpm cloud:staging:migrate:catalogue
   pnpm cloud:staging:migrate:accounts
   pnpm cloud:staging:migrate:research
   pnpm cloud:staging:deploy:api
   pnpm build && pnpm cloud:deploy:preview
   ```
   Check `https://cloud-release.solanime.pages.dev/api/health` reports
   `"channel":"staging"`. A production account must **not** be able to sign in
   there. Staging reads the catalogue from the pinned immutable baseline assets,
   so it shows titles without running imports.
6. **Verify production has the tightened variables.** The preview origin must be
   absent from production `SOLANIME_ALLOWED_ORIGINS` and
   `RELEASE_CHANNEL` must be `production`. Both are already verified at the
   checkpoint above; no production redeployment is needed for that completed
   step. For an older environment that still needs this migration, review and
   deploy the variable-only change while preserving data, bindings, secrets and
   private assets. Do not run ordinary deploy with the private assets absent;
   follow the retained-assets procedure in [the release guide](CLOUD_RELEASE.md).
   ```sh
   # Only when the reviewed variable change is still needed and assets are present:
   pnpm cloud:deploy:api
   ```
   Check `https://solanime.pages.dev/api/health` reports `"channel":"production"`,
   an approved owner can sign in, and `/admin` works with the production token.
7. **Point operator commands at production.** Imports, refreshes and verification
   that used to run against `cloud-release` now need
   `--origin=https://solanime.pages.dev`. `scripts/artwork/cloud-refresh.ts` only
   accepts the `cloud-release` origin and needs a follow-up change before it can
   refresh live artwork.
8. **Review preview-era test data.** Accounts created while testing on the
   preview origin (for example the "QA viewer" account in
   `evidence/screenshots/`) live in the production accounts database. Review them
   in `/admin` and remove only the ones the owner confirms are synthetic.

Old preview sessions are not migrated. Their cookies are host-only for
`cloud-release`, so after step 5 those browsers are simply signed out there.

## Rollback

- Staging: redeploy a compatible preview whose binding still targets isolated
  staging. Do not restore the legacy production-backed preview configuration.
  Preserve staging resources and test evidence until recovery is complete.
- Production: `wrangler rollback` restores the previous Worker version. No schema
  or data changed, so nothing else needs reverting. Restore from the step 1
  export or Time Travel only if an unrelated incident requires it.

## Quota note

D1 and Queue free-plan limits are account-wide, so staging shares capacity with
production. Staging keeps sync, source refresh and cron off, with a small daily
budget, so it cannot consume production's import allowance. Turn sync on in
staging only for a deliberate, bounded test.

# Production and staging separation

Until this change, both Pages environments bound the same API Worker
(`solanime-api-preview`), so every `cloud-release` preview deploy read and wrote
the real account, catalogue and research databases. The preview origin was also
in the live API's `SOLANIME_ALLOWED_ORIGINS`, so it passed the live origin and
CSRF checks.

| | Production | Staging |
|---|---|---|
| Pages environment | `production` (`https://solanime.pages.dev`) | `preview` (`https://cloud-release.solanime.pages.dev`) |
| Worker | `solanime-api-preview` (top level of `wrangler.jsonc`) | `solanime-api-staging` (`env.staging`) |
| D1 | `solanime-{catalogue,accounts,research}-preview` (unchanged IDs) | `solanime-{catalogue,accounts,research}-staging` (new, empty) |
| Queue | `solanime-sync-preview` | `solanime-sync-staging` |
| Rate-limit namespaces | `2026091201`, `2026091202` | `2026100101`, `2026100102` |
| Firebase project | `solanime-9ef23` | a separate Spark project |
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

Run these from an authorized Wrangler login in the reviewed account. Every
`--env staging` command touches only new resources. Production is touched in
step 6 only, with a redeploy of the same code plus two variable changes.

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
6. **Redeploy production with the tightened variables.** This drops the preview
   origin from `SOLANIME_ALLOWED_ORIGINS` and sets `RELEASE_CHANNEL=production`.
   Data, bindings and secrets are unchanged, and the Pages production binding is
   unchanged, so no Pages production deploy is needed.
   ```sh
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

- Staging: redeploy Pages preview from the previous commit. The staging
  resources can stay or be deleted; they hold no production data.
- Production: `wrangler rollback` restores the previous Worker version. No schema
  or data changed, so nothing else needs reverting. Restore from the step 1
  export or Time Travel only if an unrelated incident requires it.

## Quota note

D1 and Queue free-plan limits are account-wide, so staging shares capacity with
production. Staging keeps sync, source refresh and cron off, with a small daily
budget, so it cannot consume production's import allowance. Turn sync on in
staging only for a deliberate, bounded test.

# Managed accounts: Firebase Spark and private D1

The hosted account service uses Firebase Authentication's email/password REST interface. It does not run scrypt on Workers, require SMS, enable Identity Platform, attach billing, or use Firebase Hosting. The existing Node/SQLite service remains available for local development.

All paths below are relative to the repository. Commands work in Windows and macOS shells when supplied paths are quoted normally for the shell. Keep private migration and recovery files on your private project storage, never in a source ZIP, `dist`, `public`, or catalogue export.

## Deployment configuration

Wire `createCloudAccounts(ACCOUNTS.withSession('first-primary'), config).handle(request)` from `server/cloud/auth/index.ts` for `/api/account/*`. The D1 binding must point to the **private accounts** database and have `migrations/cloud/accounts/0001_accounts.sql` applied. The first-primary session keeps account authorization reads sequentially consistent when replication is enabled.

Configuration supplied by the Worker:

- `SOLANIME_APP_ORIGIN`: exact HTTPS Pages origin; no trailing slash. `SOLANIME_ALLOWED_ORIGINS` is an optional comma-separated list of additional exact HTTPS origins, never wildcard subdomains. Cookie `__Host-solanime_session` remains host-only, secure, HttpOnly, SameSite=Strict.
- `SOLANIME_REGISTRATION`: `closed` during migration and until recovery is configured. Closed registration also rejects Firebase-only identities without a matching private account, so the public Firebase key cannot bypass the app's registration policy.
- `FIREBASE_PROJECT_ID`: the project whose no-cost **Spark** plan and Email/Password provider the operator has verified.
- `FIREBASE_API_KEY`: that project's Web API key. This is Firebase public app configuration, not a password; it is nonetheless only consumed server-side here and should be restricted to the Identity Toolkit/Secure Token APIs. Browser-referrer-only restrictions are incompatible with this server bridge.
- `AUTH_CREDENTIAL_KEY`: a random 32-byte base64url secret, stored with Wrangler secrets. Do not put it into a frontend environment variable or a source file. Changing this key invalidates encrypted sessions; preserve the prior secret for rollback or deliberately revoke sessions before rotating it.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: optional server-only JSON secret. For single-use recovery-code support, use a dedicated service account in the same Firebase project with only `firebaseauth.users.update` permission. Do not give it project Owner/Editor or service-account-key administration roles. The runtime signs a five-minute assertion using the `identitytoolkit` OAuth scope and calls only Google's fixed token and account-update endpoints. Missing recovery credentials do **not** block existing-account password login, but new registration is closed and recovery is truthfully unavailable until configured.

Use `wrangler secret put NAME --config <worker-config> --env <preview-or-production>` for confidential values, entering them privately. Do not pipe a secret through a command that prints it or place it in shell history. API keys, tokens, passwords, and service credentials are never logged by the bridge.

Create an encryption key through your password manager or a local CSPRNG and retain it securely. For example, a local operator may generate it with Node's `crypto.randomBytes(32).toString('base64url')`; capture it directly in private secret handling, not a checked-in output file.

Local sessions use opaque 32-byte tokens; only their SHA-256 hashes live in D1. Firebase ID/refresh credentials are AES-256-GCM encrypted with the account and session hash bound as authenticated context. No Firebase credential is sent to the browser. Cross-origin mutation, missing account intent, and invalid CSRF tokens are rejected. Password-sensitive actions always reauthenticate.

Local logout/revocation is immediate. Firebase-side deletion, disabling, revocation, or an out-of-band password change is checked no less often than every **five minutes** of activity, and immediately during sensitive checks. A temporary Google outage returns a typed unavailable result without deleting a previously good session or profile. Session lifetime remains 12 hours, or 30 days when remembered, with a seven-day idle timeout and a maximum of ten devices.

## Migrate existing private Node accounts

Do not import the public catalogue database here. `data/private/accounts.sqlite` may be absent: in that case there are no supplied legacy accounts to migrate. Never invent migrated users or publish test identities.

1. Back up the source and private D1 target. Keep account writes disabled during migration; do not route account traffic to the new deployment yet. Prepare a **fresh, initially empty Firebase project/user inventory**. Firebase `auth:import` overwrites a matching UID, so do not rerun it blindly after users have begun changing passwords.
2. Prepare a consistent SQLite backup and separated artifacts. The source database is opened read-only; Node's backup API incorporates committed WAL state. This command does not call either cloud service:

   ```sh
   node --import tsx scripts/cloud-auth/prepare.ts --source "/absolute/path/accounts.sqlite" --out "data/private/firebase-migration-2026-09-12" --project "your-firebase-project-id"
   ```

   The new folder gets mode 0700 on POSIX and a current-user-only inheritable ACL on Windows before data is written. Existing output folders and paths outside the checkout's physical `data/private` are refused. Outputs:

   - `source-accounts.sqlite`: private rollback snapshot including original password/recovery hashes.
   - `firebase-users.json`: Firebase CLI account import containing the **original UID**, base64-encoded hash bytes, salt bytes, creation time, and email verification state.
   - `private-state.json`: D1 account/profile data, including recovery hashes, but **no password hashes, auth tokens, or sessions**.
   - `manifest.json`: schema, content hashes, counts, exact scrypt parameters and CLI arguments. It is a private manifest, not a release export.

3. Apply the hosted private D1 schema with Wrangler. Use a dedicated, scoped D1 operator token in `SOLANIME_PRIVATE_D1_API_TOKEN` for this **local migration tool only**. Specify the exact Cloudflare account, D1 UUID and expected Solanime accounts database name. The tool verifies the target name, UUID, account schema and quota metadata before writing:

   ```sh
   node --import tsx scripts/cloud-auth/import-private.ts --artifact "data/private/firebase-migration-2026-09-12/private-state.json" --account-id "cloudflare-account-id" --database-id "private-d1-uuid" --database-name "solanime-accounts-preview" --write-budget 10000
   ```

   The written-row budget is explicit, includes index-write estimates, and must leave capacity for application traffic. Import is parameterized so a large saved collection does not exceed D1's SQL-statement-size limit. A per-target private checkpoint records the next confirmed row. Re-run the **same command** to resume; completed matching rows are skipped. An interrupted response is reconciled against the existing row, never blindly overwritten. A conflicting live row stops import and is preserved. Quota exhaustion pauses work; the tool never upgrades billing. A write budget is a per-invocation reservation, not a claim that unrelated account traffic cannot consume the remaining daily quota.

4. Import users using the official Firebase CLI, with the project explicitly selected:

   ```sh
   firebase auth:import "data/private/firebase-migration-2026-09-12/firebase-users.json" --project "your-firebase-project-id" --hash-algo=STANDARD_SCRYPT --mem-cost=131072 --parallelization=1 --block-size=8 --dk-len=64
   ```

   This is **STANDARD_SCRYPT**, not Firebase's different `SCRYPT` algorithm. No password is rehashed or weakened by our preparation script. Review every Firebase import error and reconcile UID counts against the private manifest before opening traffic. Existing sessions are deliberately invalidated; each person signs in again. Profile IDs, saved-data revisions, ownership and recovery hashes are retained.

5. Verify a real migrated test account's old password, profiles, recovery code and isolation on the isolated preview. Then configure the hosted bridge and enable registration/traffic as appropriate. Retain the original private backup: Firebase exports do not include non-Firebase hashes until the imported user has first signed in and Firebase has rehashed the password.

The preparation/import scripts neither purchase services nor provision a cloud project. CLI success is not live browser acceptance; capture that separately.

## Interrupted recovery, password change, or deletion

Remote identity writes and D1 writes cannot form a distributed transaction. The bridge therefore first claims a durable account security operation and revokes local sessions. Concurrent operations cannot reuse its recovery code or retain an authenticated profile writer. On a definitive upstream rejection the account is unlocked, with its old recovery hash preserved. On a timeout or malformed response the account remains explicitly pending; it is **not** marked recovered, and its profiles are not deleted. No password or replacement recovery code is stored in the operation record.

Inspect one exact pending account (read-only by default):

```sh
node --import tsx scripts/cloud-auth/reconcile.ts --account-id "cloudflare-account-id" --database-id "private-d1-uuid" --database-name "solanime-accounts-preview" --uid "stable-account-id"
```

After at least one minute, check the exact UID in Firebase. For a pending password change/recovery, privately supply `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `SOLANIME_PRIVATE_D1_API_TOKEN` and **the intended current password** as `SOLANIME_RECONCILE_PASSWORD`. Do not put passwords in command-line arguments. Then run the same command with:

```sh
--apply --out "data/private/account-reconciliation-2026-09-12"
```

The command proves the intended password against Firebase, checks UID and email, and conditionally completes only the matching pending operation. For recovery it creates a replacement code in a newly restricted private receipt file before its hash is committed. Only use the code when the receipt says `applied: true`; deliver it privately to the account owner. Clear the temporary password environment variable after use. An unconfirmed receipt must be reconciled against the account, not assumed active.

For a pending deletion, first verify that **that Firebase UID is actually deleted**. The same explicit `--apply` command additionally requires `--confirm-remote-deleted "operation-id-from-inspection"`; it then removes only the corresponding pending private account and its owned rows. This is an operator confirmation, not an automated inference from a failed login. If the remote account still exists, do not use that flag.

## Verification

```sh
pnpm exec vitest run tests/cloud-auth.test.ts tests/cloud-auth-firebase.test.ts tests/cloud-auth-d1.test.ts tests/cloud-auth-migration.test.ts tests/cloud-auth-runtime.test.ts
```

Tests execute the migration and race-sensitive SQL in both SQLite and the actual Miniflare D1 runtime. Identity transport fixtures are confined to tests and do not certify live Firebase. All release and backup packaging must exclude `data/private/`, `.dev.vars*`, `.env*` secrets and credential-bearing captures.

The live check defaults to the exact preview origin and is read-only unless explicitly enabled. With `--execute`, it creates two disposable reserved-domain identities, tests private data and security changes, and deletes only those identities. It sends no email and keeps passwords, cookies, recovery codes and identifiers in memory. `--hold-on-failure` retains that memory for a bounded cleanup retry after an operator repairs a deployment; do not start another run while an identity's outcome is uncertain.

```sh
node --import tsx scripts/cloud-auth/live-check.ts --origin https://cloud-release.solanime.pages.dev
node --import tsx scripts/cloud-auth/live-check.ts --origin https://cloud-release.solanime.pages.dev --execute --hold-on-failure
```

Only after the operator has promoted and confirmed the intended release, canonical QA requires a separate explicit opt-in. The sole production target is the exact origin `https://solanime.pages.dev`; arbitrary hosts, redirects, trailing paths, alternate ports and duplicate CLI options are rejected before a request. `--allow-production` does not itself enable account mutations: `--execute` remains independently required.

```sh
node --import tsx scripts/cloud-auth/live-check.ts --origin https://solanime.pages.dev --allow-production --execute --hold-on-failure
```

Production promotion reuses the reviewed private Firebase/D1 targets, so the independent cleanup check below remains pinned to those same target identities. A successful preview run is not a canonical-production check.

An invalid login alone does not establish deletion. An operator with the existing preview service account's `firebaseauth.users.get` permission can run a separate **read-only aggregate** check. This script is pinned to the preview Firebase project and private D1 target, requests only email fields from Firebase (not hashes), emits no identities, and never performs deletion. It uses existing Wrangler authentication for a fixed D1 aggregate SELECT. Do not broaden the runtime recovery role just to run this optional operator check.

```sh
node --import tsx scripts/cloud-auth/qa-cleanup-check.ts --service-account "/private/path/preview-service-account.json"
```

`cleanupConfirmed: true` requires a complete bounded Firebase page and zero matching disposable QA records in both services. Otherwise use exact-account reconciliation; no automatic bulk cleanup is provided.

## Primary references

- [Firebase REST email/password, refresh, lookup and update contracts](https://firebase.google.com/docs/reference/rest/auth)
- [Firebase account imports and standard scrypt](https://firebase.google.com/docs/auth/admin/import-users)
- [Official Firebase CLI import/export formats and overwrite behavior](https://firebase.google.com/docs/cli/auth)
- [Privileged account update and its narrow permission](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/update)
- [Google service-account assertion protocol](https://developers.google.com/identity/protocols/oauth2/service-account)
- [D1 transactions and sequentially consistent sessions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Firebase no-cost plans](https://firebase.google.com/pricing), [D1 quotas](https://developers.cloudflare.com/d1/platform/pricing/)

Contracts consulted on 2026-09-12. Live deployment results belong in the release verification record, not this implementation guide.

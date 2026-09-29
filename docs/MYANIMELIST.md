# MyAnimeList integration

## Configuration

A MAL profile name is not an API application. Register a web application using
[MAL API configuration](https://myanimelist.net/apiconfig), with the exact callback
`https://solanime.pages.dev/settings/mal/callback` for production. Use a separately
registered callback/application for a local or preview origin.

Server-only environment variables:

- `MAL_CLIENT_ID`: the registered application ID.
- `MAL_CLIENT_SECRET`: confidential web application secret, when issued.
- `MAL_CREDENTIAL_KEY`: a separate random 32-byte base64url encryption key. Retain
  this securely with private account backups; losing it requires reconnecting MAL.
- `SOLANIME_APP_ORIGIN`: the exact trusted frontend origin already used by accounts.

Never use a `VITE_` prefix, paste secrets into chat, or put them in source control.
On Workers, supply secrets through the provider's protected configuration. Locally,
use the ignored `.env` file. Apply `migrations/cloud/accounts/0003_myanimelist.sql`
to the **private accounts database** before deploying its API code. The local
account database initializer applies the same schema automatically.

## User flow

1. Sign in to Solanime and select a profile.
2. Open Settings → MyAnimeList → Connect MyAnimeList.
3. Authorize on MyAnimeList; no MAL password enters Solanime.
4. On return, choose Sync list. All five list statuses are imported.
5. My List contains a separate MyAnimeList section. Status and watched-episode
   edits require an explicit **Save to MAL** action.

An import is bounded to twenty 500-record page requests per foreground operation.
The database stores the generation and next offset. Resume import continues it;
closing a tab does not discard committed data. A failed or malformed upstream
page never replaces the previous complete import with an empty list. Editing is
disabled by the server while an import is incomplete, preventing its snapshot
from overwriting a newer explicit edit.

Disconnect deletes this profile's private connection and imported cache only.
It does not delete the remote MAL list or Solanime history. It remains possible
when the operator has disabled the application configuration.

## Security and transport

Both Node/SQLite and Workers/D1 use `server/integrations/malService.ts`, behind
existing session, CSRF, rate-limit and profile-ownership checks. OAuth state is
single-use, hashed, expires after ten minutes, and is bound to the account and
profile. PKCE uses the `plain` method supported by MAL's current documentation.
Refresh/access credentials and PKCE verifiers are AES-GCM encrypted with owning
account/profile context. Client responses, catalogue exports and bundles do not
contain credentials.

Remote requests use fixed MAL origins, reject redirects, have bounded time and
response sizes, and validate shapes. An upstream pagination URL is validated but
never fetched verbatim. Profile mutations are serialized with a renewable lease.
Session ownership is rechecked before publishing upstream results.

## Verification and limits

The deterministic tests exercise OAuth state ownership/replay/expiry, encrypted
storage, list isolation, staged imports, upstream failures, explicit writes and
session revocation. These tests do **not** establish that a real account has been
connected. No registered MAL application has been supplied or live OAuth account
connection completed for this revision.

Automatic watch-to-MAL updates are deliberately not enabled: catalogue/season/
episode identifiers must first be matched to authoritative MAL anime IDs and
episode offsets. Imported MAL rows are usable and editable independently of that
matching. An imported list entry is not represented as a playable Solanime title
merely because its text resembles one.

Official references: [authorization](https://myanimelist.net/apiconfig/references/authorization)
and [API v2](https://myanimelist.net/apiconfig/references/api/v2).

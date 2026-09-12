> Historical documentation. Native-player candidate 0.6 removes provider webpage playback. Follow [NATIVE_PLAYBACK.md](NATIVE_PLAYBACK.md) and [DEPLOY_NATIVE.md](DEPLOY_NATIVE.md), not the iframe/compatibility instructions below.

# Accounts and built-in playback — 0.4

## What changed

Email/password registration and sign-in now create a real server-side account. Each account has one to five named profiles with their own watchlist, recent history, watched status, notes, appearance preferences and supported native playback progress. Guest browsing keeps its previous browser-local data. Guest data is not silently copied into an account or shared across profiles.

The profile chooser, creation/edit dialog and account-security screen extend the cinema design already in 0.3: neutral surfaces, the existing red/custom accent tokens, clear primary actions, visible keyboard focus and responsive avatar rows. No additional font files or third-party UI scripts are required.

## Account architecture

Credentials and private profile data are stored in a separate SQLite database, `data/private/accounts.sqlite`. The imported catalogue remains separate and unchanged. The private directory is ignored by Git and must never be included in a public source ZIP, deployment asset directory, catalogue export or screenshot.

Passwords use salted asynchronous Node scrypt with N=131072, r=8, p=1. At most two password operations execute concurrently to bound memory use. Server sessions use random 256-bit credentials with only their SHA-256 hashes in SQLite. Browser session cookies are HttpOnly and SameSite=Strict, with Secure and the __Host- prefix on HTTPS. Session/CSRF credentials are never stored in localStorage. The selected non-secret profile ID is stored per tab; profile data stays in memory and is synchronized with the API.

Authenticated writes require both an exact trusted Origin and a per-session CSRF token. Every profile read/write checks account ownership. The five-profile ceiling is enforced in the database as well as the API. Profile state updates use transactional revision checks: a stale tab receives a visible conflict rather than overwriting newer state. The application does not silently merge incompatible revisions. Reload a conflicting profile before editing again; unsaved changes are not preserved across that reload.

Password changes and destructive account/profile changes require the current password. Password recovery invalidates existing sessions and rotates the private recovery code. Account settings provide account-data export, recovery-code rotation, other-session revocation, password change and account deletion. There is no arbitrary third-party login or billing integration.

Profiles share one account authorization boundary. They are not separate user accounts, parental controls, individual PINs or promises of privacy from someone else who knows the account password.

## Email and recovery scope

Email is the sign-in identifier. **This release does not verify email ownership or send password-reset emails.** No delivery provider or SMTP credentials were provided. The interface states this rather than claiming that an email was sent. Registration shows a private one-time recovery code, available to copy/download before continuing; only its hash is stored. A lost password plus a lost recovery code cannot be recovered through a fictitious email flow. Save the recovery code outside the browser.

Do not position unverified email identities as verified personal identities. For a public service, add and test an authenticated mail-delivery integration, email verification, abuse controls and its operational support before broadly enabling registration. Registration may be disabled with SOLANIME_REGISTRATION=closed.

## Playback: the actual architectural choices

The previous release imposed one sandbox policy on all provider frames. A provider that checks for sandboxing can reject that frame, which explains the reported "Sandboxed our player is not allowed" message. The earlier fixture-only tests established browser sandbox behavior, not compatibility with that provider's live service.

Version 0.4 gives an explicit per-player choice:

- **Restricted embed:** keeps the iframe sandbox and denies popups/top navigation. A provider can still refuse it. This is not a complete network tracker filter.
- **Provider compatibility:** deliberately recreates the selected iframe without sandbox restrictions. It may resolve an anti-sandbox complaint, but popup and tracking protections are reduced. It does not pretend that an unsandboxed iframe is protected by a hidden overlay.
- **Native source:** an operator-registered direct MP4, HLS or DASH resource is loaded by Solanime's own player. The provider webpage, its advertising scripts and its UI are not loaded. Solanime can style and control its own media element. Source selection prefers a registered native mapping; it never substitutes unrelated footage under an anime episode.

No browser extension is required to use these paths. The older optional Guard directory is retained as legacy tooling, not injected into every visitor's browser. Extension permission APIs cannot be made available to ordinary webpage JavaScript simply by bundling the extension's files.

**The shipped native registry is empty.** No legitimate direct stream was discovered or licensed for every existing iframe mapping, and this release does not claim otherwise. It adds the functioning native integration path, not a secretly complete replacement for the upstream library. Live provider compatibility and playback from your own deployment origin still require verification.

An overlay over a hidden foreign player would not stop that player's requests, prevent its popups or grant control of its cross-origin DOM. This implementation does not spoof the provider's environment, modify its protection checks, strip origin headers, implement an open fetch proxy or manufacture a successful playback result.

## Configure native sources

Set `SOLANIME_NATIVE_SOURCES` to an operator-controlled JSON file. Entries identify an existing provider mapping, its exact language and a resource that your deployment is entitled to use. The schema is exported from `server/providers/nativeSources.ts`:

```ts
type NativeSource = {
  mappingId: number;
  language: string;
  type: 'direct' | 'hls' | 'dash';
  url: string;              // Public HTTPS resource; no user:password URL credentials.
  allowedHosts: string[];  // Explicit media hostnames, including the primary hostname.
  expiresAt?: string;
  attribution?: string;
};
```

Start from `config/native-sources.example.json` and add real authorized resources. The example is intentionally empty, not a fake working endpoint. Source hosts must permit the applicable CORS/range/playlist behavior. Restart the Node process after configuration changes. Expired or language-mismatched registrations are reported as unavailable, not silently routed to a different video.

The HLS JavaScript request hook checks registered hostnames and disables cross-origin credentials. Native browser HLS/MP4 and DASH delivery do not inherit that hook. There is **no blanket claim that every nested media request is filtered**. The media host still sees requests, may log IP addresses, and can include server-side content/advertising. This is not DRM or server-side-ad removal. A universal cross-origin AdBlock-equivalent remains outside an ordinary page's capabilities.

## Operations and boundaries

Run a single Node application process with persistent local storage. This release is not a horizontally scaled authentication cluster. Back up the private account database separately with `pnpm run backup:accounts` and restrict access to those backups. Do not replace an existing private database when upgrading source files. Account-data exports contain personal information and belong to the requesting account.

The Pages gateway now forwards only the application session cookie and account headers on its explicit account routes. It never forwards browser cookies or admin credentials to arbitrary hosts. For public deployments, set the HTTPS public frontend origin and keep API/Pages configuration aligned. A server-side shared gateway token optionally forwards the trusted Cloudflare client address for rate limiting; it must never be exposed with a VITE_ prefix.

No production deployment, mail account, custom domain, automated upstream scrape, new provider credentials or entitlement was created as part of this revision.

## Primary references

Accessed September 11, 2026. These establish browser/security mechanisms, not audit certification of this implementation.

- MDN, Same-origin policy: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy — cross-origin DOM/read boundaries.
- MDN, iframe: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe — sandbox capabilities and iframe limitations.
- OWASP, Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html — salted memory-hard password hashing and scrypt parameters.
- OWASP, Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html — session rotation, expiry, and cookie protections.
- OWASP, Forgot Password Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html — recovery-token handling, account access and abuse limits.

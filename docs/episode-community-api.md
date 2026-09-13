# Episode community API

Episode comments are public user-generated text attached to a real catalogue episode. They are separate from the private per-profile episode notes already stored in profile data.

## Routes

- `GET /api/episodes/:episodeId/comments?page=1&pageSize=20` is public. `pageSize` is capped at 50. An authenticated client may add `profile=:profileId`; the server verifies that the profile belongs to the current account and then marks only that profile's rows with `ownedByViewer: true`.
- `POST /api/episodes/:episodeId/comments` creates a comment from `{ profileId, body }`.
- `PATCH /api/episodes/:episodeId/comments/:commentId` updates one owned comment from `{ profileId, body, revision }`.
- `DELETE /api/episodes/:episodeId/comments/:commentId` deletes one owned comment from `{ profileId, revision }`.

Mutations use the existing account cookie and require the exact allowed `Origin`, `Content-Type: application/json`, `X-Solanime-Intent: account`, and the session-backed `X-CSRF-Token`. Cross-account and cross-profile identifiers return `404`. Stale edits and deletes return `409` without overwriting the current row.

The public projection contains only comment ID, episode ID, display name/avatar, plain-text body, revision, timestamps, and `ownedByViewer`. It never contains email, account ID, Firebase identity, profile ID, session material, or moderation internals. Frontends must render `body` as text and must not pass it to `dangerouslySetInnerHTML`.

## Limits and moderation state

Bodies are Unicode-normalized plain text, limited to 1,000 characters and 8,000 UTF-8 bytes. Control and bidirectional-override characters are rejected. Account-scoped mutation rate limiting allows 20 comment changes per minute in addition to the normal API/IP limit. The database caps each profile at 5,000 comments and 100 comments on one episode.

Every row has `visible | hidden` moderation state. Public reads and user edits exclude hidden rows. This release intentionally does not expose a browser moderation action; future operator tooling can hide a row without changing the public or ownership contract.

## Persistence and deployment

- Local Node uses `data/private/accounts.sqlite`; `openAccountsDatabase` applies the additive table/index/trigger creation and `pnpm backup:accounts` backs up the entire private database.
- Workers use the `ACCOUNTS` D1 binding and migration `migrations/cloud/accounts/0002_episode_comments.sql`.
- Before deploying the Worker, run `pnpm cloud:migrate:accounts`. The private migration artifact tooling preserves any existing `episode_comments` rows and does not convert private episode notes into public comments.
- `src/account/api.ts` exports `episodeComments`, `createEpisodeComment`, `updateEpisodeComment`, and `deleteEpisodeComment` for the watch-page integration. Keep private notes labelled separately.

# MyAnimeList list import

Members bring their MyAnimeList ratings into a Solanime profile **without signing
in to MyAnimeList**. Solanime never asks for a MyAnimeList password, holds no
MyAnimeList token, and never writes to MyAnimeList. The imported list feeds
[Explore](EXPLORE.md) and the read-only MyAnimeList section of My List.

## Two ways to import

1. **Public username.** Settings → MyAnimeList → enter the username → Import list.
   The server reads the member's *public* anime list from the official API
   (`GET https://api.myanimelist.net/v2/users/{name}/animelist`) using only the
   operator's client ID in the `X-MAL-CLIENT-ID` header. This is the same approach
   as the [dlt MyAnimeList source](https://dlthub.com/context/source/myanimelist).
   Private lists and unknown usernames get a clear message.
2. **Export file.** On MyAnimeList, Profile → Export → Anime List, then pick the
   downloaded `.xml` or `.xml.gz` in Settings. The browser parses it and sends only
   the list rows. This works for private lists and needs no configuration.

Each import builds a complete new copy, then switches to it, so a failed or
interrupted import never empties the previous list. Imports are serialized per
profile with a short lease. Lists are capped at 20,000 entries.

## Operator setup (optional, username import only)

Register an application at <https://myanimelist.net/apiconfig> while signed in to
MyAnimeList (app type “web”; the redirect URL is not used). Put its **Client ID**
in the server-only `MAL_CLIENT_ID` (a Worker secret in the cloud, `.env` locally).
No client secret or encryption key is needed. Without it, Settings shows only the
export-file option.

## Security and data

Both Node/SQLite and Workers/D1 use `server/integrations/malService.ts` behind the
existing session, CSRF, rate-limit and profile-ownership checks. Upstream requests
use a fixed origin, refuse redirects, time out, bound response size and validate
every row; pagination URLs are validated but never fetched verbatim. Rows are
joined to catalogue titles only through exact reviewed MAL IDs, never by name.

**Remove imported list** deletes this profile's imported rows only. Older releases
stored MyAnimeList OAuth credentials; the first new import (or removal) erases
them, and the OAuth routes no longer exist.

## Verification

`tests/myanimelist.test.ts` and `tests/myanimelist-connection.test.tsx` cover the
client-ID-only request, private/unknown members, generation replacement, failure
keeping the old list, export-file import without configuration, profile isolation,
concurrent imports, late responses after a profile switch, and the export parser.
No live username import has been run because no client ID is registered yet.

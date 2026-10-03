# Explore: personalized swipe-to-discover

Explore (`/explore`, header item next to Anime/Discover) answers “what should I
watch next?”. A person picks a 10, 20 or 30 card round, swipes through
spoiler-safe first-episode cards for different series, and finishes with
**Picked for you**: their own picks plus about ten new, varied recommendations.
Discover stays the catalogue browser; Explore is guided discovery.

## Journey

1. **Entry.** “Find your next anime”, a 10/20/30 choice (default 20) and
   **Start exploring**. Optional preferences: this round’s mood (never saved),
   genres to enjoy, genres to never show, series length, audio, catalogue scope,
   mode, and two list toggles. Genres, exclusions, length and audio are saved for
   future rounds only when the person ticks the save option. The entry screen
   states what is known about the profile: whether a MyAnimeList list is imported (by username or export file, no MAL sign-in), import age,
   how many imported entries match catalogue titles and how many do not, and how
   much Solanime history and My List exist. With no signals at all it offers up to
   three optional genres and otherwise starts a varied introductory deck that is
   labelled as such.
2. **Deck.** One artwork-led card with a dimmed preview of the next. Each card
   shows the real poster, series title, the entry episode from the actual episode
   list (“Starts at Episode 1”; an episode title is shown only when the catalogue
   has a real one), a short synopsis, up to three genres, format/year/episode
   count/listed versions and one reason line. Titles without listed episodes say
   so. No public score is shown because the catalogue does not hold MAL means yet.
3. **Decisions.**

   | Control | Gesture / key | Effect |
   | --- | --- | --- |
   | Interested | swipe right, → | Positive signal; title joins Your picks |
   | Pass | swipe left, ← | Modest negative signal; removed from this round |
   | Skip | ↓ or S | Neutral; nothing is inferred |
   | Undo | U | Reverses the latest decision and its ranking effect |
   | Already seen | button | Excluded from new discovery; optional “Liked it / Not for me” |
   | Series info | button | Opens the existing title preview without losing the deck |

   Interested is not My List, a MAL score or a watched mark. Those stay explicit
   actions elsewhere. A mostly vertical drag scrolls the page and never decides.
   Shortcuts are ignored while typing or while any dialog is open. The departing
   card is an animated clone, so the next card is usable immediately; reduced
   motion removes the animation.
4. **Results.** After five resolved cards **See recommendations now** is
   available; the round can be left and resumed at any time. Results separate
   **Your picks** (this round’s Interested titles) from **Recommended next**
   (unseen titles that were not in the round). Each result has artwork, metadata,
   one or two evidence-based reasons, Series info, a My List toggle, **Play** or
   **Resume** only when episodes with listed versions exist, and reversible
   **More like this / Less like this**. Rounds can be restarted or refiltered.
   There are no numeric match percentages.

## Ranking (`shared/explore.ts`, version `explore-rank-1`)

Content-based and explainable. All weights live in `EXPLORE_CONFIG`.

- **Personal history:** MAL scores joined to catalogue titles by exact MAL ID
  (reviewed artwork matches only; ambiguous IDs are dropped, nothing is matched
  by name), Solanime watch history, My List, and earlier Explore choices. MAL
  score 0 means unscored and is neutral; dropped/on-hold without a score is
  neutral. Generous raters are centred on their own mean once they have five
  scores. Each title counts once even when it is in MAL, history and My List.
- **Session intent:** Interested +1, Pass −0.35, Skip 0, seen-and-liked +0.8,
  seen-not-for-me −0.6, More like this +0.6, Less like this −0.5 (and hidden).
- **Features:** genres, format, length bucket, dub version listed, status.
  Preferences are shrunk toward neutral with a pseudo-count, so sparse evidence
  stays weak. Signal groups (personal, session, explicit genres/mood, public
  quality) are averaged only over the groups that exist. Public quality has a
  0.15 weight and is absent in the current catalogue.
- **Hard constraints** (never relaxed): excluded genres, chosen length, chosen
  audio, “Episodes on Solanime” scope, and in the default mode titles already
  completed/watching/on hold on MAL, dropped titles (unless re-enabled), titles in
  Solanime history, Already seen titles and the franchises of all of those.
  Plan-to-watch and My List titles stay eligible unless the toggle is off.
  **Continue or revisit** mode contains only in-progress history and MAL
  watching/on-hold titles; Play resumes from the saved history entry.
- **Franchises:** the catalogue has no sequel/prequel relations (only source
  “recommended” links), so a conservative name key groups seasons, films,
  specials and side stories. Sequel-marked titles are never offered as fresh
  entry points; one title per franchise appears in a deck or result list.
- **Diversity and exploration:** greedy maximal-marginal-relevance re-ranking,
  and about 15% wildcard slots (never the first two cards) drawn from decent
  titles outside the strongest genres. Wildcards are labelled.
- **Sessions:** the deck is presented two cards ahead. Presented cards are
  immutable; only unseen positions are re-ranked as feedback arrives. The seed
  and ranking version are stored for debugging. If fewer titles pass the filters
  than requested, the round is shortened and says so.

## API, storage and privacy

Profile-scoped routes under `/api/account/profiles/:id/explore/`:
`status` (GET), `start`, `feedback`, `undo`, `results`, `preferences`, `reset`
(POST). Both the Node/SQLite and Workers/D1 transports enforce session, CSRF,
origin, rate limit (240/min per account) and profile ownership before calling
`server/explore/service.ts`. The Pages gateway exposes exactly these routes.

State lives in the existing private `profile_data` store, so no migration or new
database is needed, account export includes it and profile/account deletion
removes it. The generic client data endpoint rejects these keys:

- `explore:session`: the current round (cards, decisions, results, compact
  derived taste). Writes are compare-and-swap on the stored revision with
  automatic retries; every action carries an idempotency key. Duplicate taps,
  retries, out-of-order responses and a second tab cannot double-count or
  overwrite a decision. Resumable for 30 days.
- `explore:taste`: saved preferences and a ledger of up to 500 Explore choices
  kept for 365 days.

The browser advances optimistically, saves in order, shows Saved / Saving… /
Not saved with Retry, and reloads the server state when another tab replaced
the round. Explore reads MAL imports, history and My List but never writes
them, never calls MAL per swipe and never contacts third-party AI or analytics.
Removing the imported MAL list or re-importing changes the committed generation, which
rebuilds MAL-derived taste on the next action; Explore choices remain until
**Reset Explore preferences**, which removes only Explore data.

Catalogue features are cached per process/isolate for ten minutes (public
catalogue data only). On Workers with the private baseline they come from the
snapshot’s checksummed postings and search indexes (three bounded reads); cards
are hydrated one or two at a time, and results in one batch of about ten.

## Previews

Not offered in this release. The catalogue has no trailer records, and the
player has no preview mode that is guaranteed not to touch Continue Watching or
progress, so a Preview control would either be fabricated or unsafe. Cards work
from artwork and metadata; Play uses the normal resolver.

## Verification (2026-10-03)

Fixtures prove mechanics only; they are not catalogue or live-provider evidence.

- `tests/explore-ranking.test.ts` (16): franchise/sequel handling, MAL score 0
  and status semantics, de-duplication, synthetic personas ranking toward their
  own genres, capped public score, rescaling, modest Pass, diversity,
  determinism, hard constraints, revisit mode, wildcard share.
- `tests/explore-service.test.ts` (19): 10/20/30 bounds, honest short decks,
  no repeats or re-ordering, idempotent and conflicting submissions, concurrent
  writers, undo, reload/resume, profile isolation, picks vs recommendations,
  all-skipped and all-passed rounds, refinements, substantial/sparse/
  stale/failed/absent MAL imports, MAL list removal, no writes to history/My List/MAL,
  reset scope, saved-preference rules, bounded catalogue reads.
- `tests/explore-catalogue.test.ts`: the committed 8,949-title snapshot yields
  5,771 franchise entry points with no sequel-marked entries. Local timings on
  this Mac: feature index 98 ms (cached afterwards), first two cards 25 ms,
  results 33 ms.
- `tests/e2e/explore.spec.ts` on desktop/mobile Chromium and desktop/iPhone
  WebKit (16 runs): header link, mouse swipe, vertical-drag rejection, touch
  swipe, keyboard, skip, undo, already seen, reload/resume, shortcuts ignored in
  dialogs, early results, axe (no serious/critical issues), honest short deck,
  and no change to history/watched/My List.

- Whole repository on this branch: 955 unit tests pass; the full browser suite
  passes on all four projects (546 passed, 18 skipped by design). Navigation
  tests now expect the fifth iPhone destination.
- Real-catalogue screenshots (desktop, iPhone portrait and landscape) were taken
  against a local server with a synthetic test profile; they are not kept in
  the repository.

### Not verified / blockers

- No live username import has run (no MAL client ID registered yet); export-file
  import and MAL personas are tested with fixtures.
- Workers/D1 + baseline path is type-checked and shares the tested service, but
  has not been exercised against a deployed preview yet.
- Most catalogue artwork is 265×370 source thumbnails; cards display them near
  native size over a blurred wash instead of enlarging them.
- No public MAL mean/popularity is stored, so the quality signal is unused.

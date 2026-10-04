import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { useAppState } from '../state';
import { markDialogTrigger } from '../components/Dialog';
import Icon from '../components/Icon';
import ExploreIcon from '../explore/icons';
import ExplorePreferences from '../explore/ExplorePreferences';
import ExploreDeck, { cardSummary } from '../explore/ExploreDeck';
import ExploreResults from '../explore/ExploreResults';
import { useExploreSession, type ExploreController } from '../explore/useExploreSession';
import {
  DEFAULT_EXPLORE_FILTERS,
  EXPLORE_CONFIG,
  EXPLORE_MOODS,
  type ExploreFilters,
  type ExploreSignalSummary,
} from '../../shared/explore';
import '../styles/explore.css';

type View = 'intro' | 'deck' | 'results';

function age(timestamp: number) {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Honest account of what Explore can use for this profile. */
function SignalLine({ signals }: { signals: ExploreSignalSummary }) {
  const mal = signals.mal;
  const imported = signals.malImportedAt ? `imported ${age(signals.malImportedAt)}` : 'not imported yet';
  const matched = `${signals.malMatched.toLocaleString()} matched to Solanime titles`;
  const unmatched = signals.malUnmatched ? `, ${signals.malUnmatched.toLocaleString()} not matched yet` : '';
  return (
    <div className="explore-signals">
      <p>
        <strong>MyAnimeList</strong>{' '}
        {mal === 'none' && <>list not imported. <Link to="/settings#connections">Import it in Settings</Link> with your username or export file to use your ratings. It’s optional.</>}
        {mal === 'unavailable' && <>couldn’t be checked right now. Explore will use your Solanime activity.</>}
        {mal === 'connected' && <>list imported {signals.malUsername ? `from ${signals.malUsername}, ` : ''}{imported}: {matched}{unmatched}.</>}
        {mal === 'stale' && <>list imported {signals.malUsername ? `from ${signals.malUsername}, ` : ''}{imported}: {matched}{unmatched}. <Link to="/settings#connections">Re-import for newer ratings</Link>.</>}
      </p>
      <p className="field-hint">
        Also using {signals.history.toLocaleString()} {signals.history === 1 ? 'title' : 'titles'} from your watch history, {signals.watchlist.toLocaleString()} on My List
        {signals.explore ? ` and ${signals.explore.toLocaleString()} earlier Explore choices` : ''}.
      </p>
    </div>
  );
}

function DataUse({ controller }: { controller: ExploreController }) {
  const [confirming, setConfirming] = useState(false);
  const retention = controller.status?.retention;
  return (
    <details className="explore-data">
      <summary>What Explore uses</summary>
      <p>Explore ranks titles from this profile’s MyAnimeList ratings and statuses (read only), your Solanime watch history and My List, your Explore choices, and the genres, format, length and listed versions in the catalogue. It never changes MyAnimeList, your history, or My List, and nothing is sent to advertisers or AI services.</p>
      <p>It keeps your current round for {retention?.sessionRetentionDays ?? 30} days and up to {retention?.ledgerMax ?? 500} past choices for {retention?.ledgerRetentionDays ?? 365} days. Explore data is included in your account export and removed with the profile.</p>
      {confirming ? (
        <div className="button-row" role="group" aria-label="Confirm reset">
          <button type="button" className="button button--primary" disabled={controller.busy}
            onClick={() => void controller.reset().then(() => setConfirming(false))}>Reset Explore preferences</button>
          <button type="button" className="text-button" onClick={() => setConfirming(false)}>Cancel</button>
          <p className="field-hint">Removes Explore choices, saved Explore preferences and the current round. Watch history, My List and MyAnimeList stay as they are.</p>
        </div>
      ) : <button type="button" className="text-button" onClick={() => setConfirming(true)}>Reset Explore preferences…</button>}
    </details>
  );
}

function ExploreForProfile({ profileId }: { profileId: string }) {
  const controller = useExploreSession(profileId);
  const { setPreview } = useAppState();
  const { status, session } = controller;
  const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState<View | null>(null);
  // The current screen is deep-linkable (?view=deck|results) and survives reloads.
  const setView = (next: View) => {
    setViewState(next);
    setParams(current => { const copy = new URLSearchParams(current); if (next === 'intro') copy.delete('view'); else copy.set('view', next); return copy; }, { replace: true });
  };
  const [size, setSize] = useState<number>(EXPLORE_CONFIG.defaultDeckSize);
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_EXPLORE_FILTERS);
  const [save, setSave] = useState(false);
  const [editing, setEditing] = useState(false);
  const [quickGenres, setQuickGenres] = useState<string[]>([]);

  // Saved preferences prefill this round; mood never carries over.
  useEffect(() => {
    if (!status) return;
    if (status.saved) setFilters(current => ({ ...current, ...status.saved }));
    if (view === null) {
      const requested = params.get('view');
      const session = status.session;
      setView(requested === 'deck' && session?.status === 'active' ? 'deck' : requested === 'results' && session?.results ? 'results'
        : session && session.status !== 'active' && session.results ? 'results' : 'intro');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (controller.loadError) return (
    <section className="explore-intro" role="alert">
      <h1>Explore isn’t available</h1>
      <p>{controller.loadError}</p>
      <button type="button" className="button button--primary" onClick={() => window.location.reload()}>Try again</button>
    </section>
  );
  if (!status || view === null) return <section className="explore-intro" role="status"><p>Opening Explore…</p></section>;

  const genres = status.genres;
  const remaining = session && session.status === 'active' ? session.budget - controller.decisions.filter(Boolean).length : 0;
  const noSignals = !status.signals.personalized && status.signals.mal !== 'connected' && status.signals.history === 0 && status.signals.watchlist === 0 && status.signals.explore === 0;
  const seriesInfo = (item: Parameters<typeof cardSummary>[0]) => setPreview(cardSummary(item));
  const startRound = async () => {
    const chosen = { ...filters, genres: [...new Set([...filters.genres, ...quickGenres])] };
    const result = await controller.start(size, chosen, save);
    if (result) setView(result.cards.length ? 'deck' : 'results');
  };
  const showResults = async () => { if (await controller.results()) setView('results'); };

  if (view === 'deck' && session) return (
    <ExploreDeck session={session} decisions={controller.decisions} sync={controller.sync} error={controller.error}
      onDecide={controller.decide} onUndo={controller.undo} onRetry={controller.retry}
      onResults={() => void showResults()} onExit={() => setView('intro')} onSeriesInfo={card => seriesInfo(card)} />
  );
  if (view === 'results' && session?.results) return (
    <>
      <ExploreResults session={session} busy={controller.busy}
        onRefine={(titleId, kind) => void controller.results({ titleId, kind })}
        onSeriesInfo={item => seriesInfo(item)}
        onAgain={() => setView('intro')}
        onFilters={() => { setView('intro'); setEditing(true); }}
        onKeepSwiping={remaining > 0 ? () => setView('deck') : null} />
      {controller.error && <p className="explore-notice explore-notice--error" role="alert">{controller.error}</p>}
      {editing && <ExplorePreferences genres={genres} filters={filters} onChange={setFilters} save={save} onSave={setSave} onClose={() => setEditing(false)} />}
    </>
  );

  const chosenCount = filters.genres.length + filters.excludeGenres.length + (filters.mood ? 1 : 0) + (filters.length !== 'any' ? 1 : 0) + (filters.audio !== 'any' ? 1 : 0) + (filters.mode !== 'new' ? 1 : 0) + (filters.availability !== 'available' ? 1 : 0);
  return (
    <section className="explore-intro" aria-labelledby="explore-title">
      <div className="explore-intro__hero">
        <p className="eyebrow"><Icon name="compass" />Explore</p>
        <h1 id="explore-title">Find your next anime</h1>
        <p className="explore-intro__lead">Swipe through a short set of first-episode cards. Explore learns what you’re in the mood for and finishes with a ranked set of titles to try.</p>
      </div>
      {session && session.status === 'active' && remaining > 0 && (
        <div className="explore-resume">
          <p>You have a round in progress: {session.budget - remaining} of {session.budget} done.</p>
          <div className="button-row">
            <button type="button" className="button button--primary" onClick={() => setView('deck')}>Resume round</button>
            {controller.decisions.filter(Boolean).length >= EXPLORE_CONFIG.earlyResultsAfter &&
              <button type="button" className="button button--outline" onClick={() => void showResults()}>See recommendations</button>}
          </div>
        </div>
      )}
      {session?.results && session.status !== 'active' && (
        <p className="explore-resume"><button type="button" className="text-button" onClick={() => setView('results')}>View your last recommendations</button></p>
      )}
      <fieldset className="explore-field explore-size">
        <legend>Cards this round</legend>
        <div className="explore-segmented">
          {EXPLORE_CONFIG.deckSizes.map(option => (
            <button key={option} type="button" aria-pressed={size === option} onClick={() => setSize(option)}>{option}</button>
          ))}
        </div>
      </fieldset>
      {noSignals && (
        <fieldset className="explore-field">
          <legend>Pick a few genres you like <span>Optional</span></legend>
          <div className="explore-chips">
            {genres.filter(genre => ['action', 'comedy', 'romance', 'fantasy', 'mystery', 'sci-fi', 'slice-of-life', 'sports', 'horror', 'drama', 'adventure', 'psychological'].includes(genre.value)).map(genre => (
              <button key={genre.value} type="button" className="explore-chip" aria-pressed={quickGenres.includes(genre.value)} disabled={!quickGenres.includes(genre.value) && quickGenres.length >= 3}
                onClick={() => setQuickGenres(current => current.includes(genre.value) ? current.filter(item => item !== genre.value) : [...current, genre.value])}>{genre.label}</button>
            ))}
          </div>
          <p className="field-hint">Without any, Explore starts with a varied introductory mix and says so.</p>
        </fieldset>
      )}
      <div className="explore-intro__actions">
        <button type="button" className="button button--primary explore-start" disabled={controller.busy} onClick={() => void startRound()}>
          {controller.busy ? 'Preparing your cards…' : session && remaining > 0 ? 'Start a new round' : 'Start exploring'}
        </button>
        <button type="button" className="button button--outline" onClick={event => { markDialogTrigger(event.currentTarget); setEditing(true); }}>
          <ExploreIcon name="sliders" />Preferences{chosenCount ? ` (${chosenCount})` : ''}
        </button>
      </div>
      {filters.mood && <p className="field-hint">Mood this round: {EXPLORE_MOODS[filters.mood].label}.</p>}
      {controller.error && <p className="explore-notice explore-notice--error" role="alert">{controller.error}</p>}
      <SignalLine signals={status.signals} />
      <DataUse controller={controller} />
      {editing && <ExplorePreferences genres={genres} filters={filters} onChange={setFilters} save={save} onSave={setSave} onClose={() => setEditing(false)} />}
    </section>
  );
}

export default function ExplorePage() {
  const { account, profile, changing } = useAccount();
  if (!account || !profile || changing) return <section className="explore-intro" role="status"><p>Opening Explore…</p></section>;
  // All Explore state belongs to one account/profile; switching profiles starts clean.
  return <ExploreForProfile key={`${account.id}:${profile.id}`} profileId={profile.id} />;
}

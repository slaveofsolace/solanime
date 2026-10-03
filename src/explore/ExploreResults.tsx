import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAppState } from '../state';
import { chooseWatchEntry, watchEntryPath } from '../lib/watchEntry';
import { markDialogTrigger } from '../components/Dialog';
import Icon from '../components/Icon';
import ExploreIcon from './icons';
import { cardSummary, metaLine } from './ExploreDeck';
import type { ExploreCard, ExploreRecommendation, ExploreSessionView } from '../../shared/explore';

type Item = ExploreCard | ExploreRecommendation;

const BASIS: Record<NonNullable<ExploreSessionView['results']>['basis'], string> = {
  personal: 'Ranked from your own history and ratings, then adjusted by this round.',
  session: 'Ranked from your choices in this round. Connect MyAnimeList or watch a few titles for longer-term taste.',
  explicit: 'Ranked from the genres and mood you chose.',
  fallback: 'Explore has no taste signals for this profile yet, so these are a varied mix. Add preferences or swipe a round to personalize them.',
};

function ResultTile({ item, onSeriesInfo, onRefine, busy }: {
  item: Item;
  onSeriesInfo: (item: Item, trigger: HTMLElement) => void;
  onRefine?: (kind: 'more' | 'less' | null) => void;
  busy: boolean;
}) {
  const { watchlist, history, preferences } = useAppState();
  const [prefs] = preferences;
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState('');
  const summary = cardSummary(item);
  const started = history.entries.some(entry => entry.titleId === item.titleId);
  // Play only where episodes with listed versions exist; the watch route revalidates every source.
  const playable = item.episodeCount > 0 && item.languages.length > 0;
  const saved = watchlist.has(item.titleId);
  const refinement = 'refinement' in item ? item.refinement : null;
  async function play() {
    setOpening(true); setProblem('');
    try {
      const detail = await api.title(item.slug);
      const entry = chooseWatchEntry(item.titleId, detail.episodes, history.entries, prefs.preferredLanguage ?? 'sub');
      navigate(entry ? watchEntryPath(item.slug, entry) : `/title/${encodeURIComponent(item.slug)}`);
    } catch (error) { setProblem(errorMessage(error)); setOpening(false); }
  }
  return (
    <li className={`explore-result${refinement === 'less' ? ' explore-result--less' : ''}`}>
      <div className="explore-result__art">
        {item.posterUrl || item.artworkUrl
          ? <img src={item.posterUrl ?? item.artworkUrl ?? ''} alt="" width={265} height={370} loading="lazy" decoding="async" />
          : <div className="explore-card__missing" aria-hidden="true">{item.name.slice(0, 1)}</div>}
      </div>
      <div className="explore-result__copy">
        {item.kind === 'wildcard' && <span className="explore-badge">Wildcard</span>}
        <h3>{item.name}</h3>
        <p className="explore-card__meta">{metaLine(item)}</p>
        {item.reasons.map(reason => <p key={reason.kind + reason.text} className="explore-result__reason">{reason.text}</p>)}
        <div className="explore-result__actions">
          {playable && <button type="button" className="button button--play" disabled={opening} onClick={() => void play()}>
            <Icon name="play" />{opening ? 'Opening…' : started ? 'Resume' : 'Play'}
          </button>}
          <button type="button" className="button button--outline" onClick={event => { markDialogTrigger(event.currentTarget); onSeriesInfo(item, event.currentTarget); }}>
            <Icon name="info" />Series info
          </button>
          <button type="button" className="button button--outline" aria-pressed={saved} onClick={() => watchlist.toggle(item.titleId, summary)}>
            <Icon name={saved ? 'check' : 'bookmark'} />{saved ? 'On My List' : 'My List'}
          </button>
        </div>
        {onRefine && (
          <div className="explore-result__refine" role="group" aria-label={`Refine recommendations using ${item.name}`}>
            <button type="button" className="explore-chip" aria-pressed={refinement === 'more'} disabled={busy}
              onClick={() => onRefine(refinement === 'more' ? null : 'more')}>More like this</button>
            <button type="button" className="explore-chip" aria-pressed={refinement === 'less'} disabled={busy}
              onClick={() => onRefine(refinement === 'less' ? null : 'less')}>Less like this</button>
          </div>
        )}
        {problem && <p className="inline-notice" role="alert">{problem}</p>}
      </div>
    </li>
  );
}

export default function ExploreResults({ session, busy, onRefine, onSeriesInfo, onAgain, onFilters, onKeepSwiping }: {
  session: ExploreSessionView;
  busy: boolean;
  onRefine: (titleId: string, kind: 'more' | 'less' | null) => void;
  onSeriesInfo: (item: Item, trigger: HTMLElement) => void;
  onAgain: () => void;
  onFilters: () => void;
  onKeepSwiping: (() => void) | null;
}) {
  const results = session.results!;
  const visible = results.recommended.filter(item => item.refinement !== 'less');
  const hidden = results.recommended.filter(item => item.refinement === 'less');
  return (
    <section className="explore-results" aria-labelledby="explore-results-title">
      <header className="explore-results__header">
        <p className="eyebrow">Explore</p>
        <h1 id="explore-results-title">Picked for you</h1>
        <p>{BASIS[results.basis]}</p>
        {results.shortfall && <p className="field-hint">Only {visible.length} {visible.length === 1 ? 'title fits' : 'titles fit'} your filters without repeating what you’ve seen or this round’s cards.</p>}
      </header>
      <section className="explore-results__group" aria-labelledby="explore-picks-title">
        <h2 id="explore-picks-title">Your picks</h2>
        {results.picks.length
          ? <ul className="explore-results__list">{results.picks.map(item => <ResultTile key={item.titleId} item={item} busy={busy} onSeriesInfo={onSeriesInfo} />)}</ul>
          : <p className="explore-empty">You didn’t mark anything Interested this round. The titles below come from {results.basis === 'fallback' ? 'a varied mix' : 'what Explore already knows about you'}.</p>}
      </section>
      <section className="explore-results__group" aria-labelledby="explore-next-title">
        <h2 id="explore-next-title">Recommended next</h2>
        {visible.length
          ? <ul className="explore-results__list">{visible.map(item => <ResultTile key={item.titleId} item={item} busy={busy} onSeriesInfo={onSeriesInfo} onRefine={kind => onRefine(item.titleId, kind)} />)}</ul>
          : <p className="explore-empty">No other titles match these filters. Try fewer exclusions or the whole catalogue.</p>}
        {hidden.length > 0 && (
          <p className="field-hint">
            Hidden: {hidden.map((item, index) => <span key={item.titleId}>{index ? ', ' : ''}{item.name} <button type="button" className="text-button" disabled={busy} onClick={() => onRefine(item.titleId, null)}>Undo</button></span>)}
          </p>
        )}
      </section>
      <div className="explore-results__next">
        {onKeepSwiping && <button type="button" className="button button--outline" onClick={onKeepSwiping}>Keep swiping</button>}
        <button type="button" className="button button--primary" onClick={onAgain}><ExploreIcon name="sparkle" />Start another round</button>
        <button type="button" className="button button--outline" onClick={onFilters}><ExploreIcon name="sliders" />Change filters</button>
      </div>
    </section>
  );
}

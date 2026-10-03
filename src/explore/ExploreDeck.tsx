import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../lib/api';
import { useAppState } from '../state';
import { chooseWatchEntry } from '../lib/watchEntry';
import { markDialogTrigger } from '../components/Dialog';
import Icon from '../components/Icon';
import ExploreIcon from './icons';
import type { TitleDetailResponse } from '../types';
import { EXPLORE_CONFIG, type ExploreAction, type ExploreCard, type ExploreDecision, type ExploreSessionView } from '../../shared/explore';
import type { SyncState } from './useExploreSession';

type Direction = 'interested' | 'pass';
type Detail = { state: 'loading' } | { state: 'ready'; value: TitleDetailResponse } | { state: 'failed' };

export function cardSummary(card: ExploreCard | { titleId: string; slug: string; name: string; artworkUrl: string | null; posterUrl: string | null; backdropUrl: string | null; synopsis: string | null; type: string | null; releaseYear: number | null; status: string | null; episodeCount: number }) {
  return {
    id: card.titleId, slug: card.slug, name: card.name, imageUrl: card.artworkUrl, posterUrl: card.posterUrl, backdropUrl: card.backdropUrl,
    synopsis: card.synopsis, type: card.type, releaseYear: card.releaseYear, status: card.status, episodeCount: card.episodeCount,
  };
}

export function metaLine(card: Pick<ExploreCard, 'type' | 'releaseYear' | 'episodeCount' | 'languages'>) {
  const languages = card.languages.filter(language => language === 'sub' || language === 'dub');
  return [
    card.type,
    card.releaseYear,
    card.episodeCount ? `${card.episodeCount} ${card.episodeCount === 1 ? 'episode' : 'episodes'}` : 'No episodes listed yet',
    languages.length === 2 ? 'Sub and dub listed' : languages[0] === 'dub' ? 'Dub listed' : languages[0] === 'sub' ? 'Sub listed' : null,
  ].filter(Boolean).join(' · ');
}

/** Spoiler-safe entry line from the real episode list: never invents an episode title. */
function entryLine(card: ExploreCard, detail: Detail | undefined, revisit: boolean, history: ReturnType<typeof useAppState>['history'], language: string) {
  if (!card.episodeCount) return 'Series info only. No episodes are listed on Solanime yet.';
  if (!detail || detail.state === 'loading') return ' ';
  if (detail.state === 'failed') return `${card.episodeCount} ${card.episodeCount === 1 ? 'episode' : 'episodes'} listed`;
  const entry = chooseWatchEntry(card.titleId, detail.value.episodes, revisit ? history.entries : [], language);
  if (!entry) return 'No playable episode is listed yet.';
  const number = entry.episode.number ?? '';
  const label = entry.episode.label && !/^episode\s*\d+$/i.test(entry.episode.label.trim()) ? `: ${entry.episode.label}` : '';
  return `${entry.label === 'Continue watching' ? 'Resume at' : 'Starts at'} Episode ${number}${label}`;
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export default function ExploreDeck({ session, decisions, sync, error, onDecide, onUndo, onRetry, onResults, onExit, onSeriesInfo }: {
  session: ExploreSessionView;
  decisions: (ExploreDecision | null)[];
  sync: SyncState;
  error: string | null;
  onDecide: (index: number, titleId: string, action: ExploreAction, liked?: boolean | null) => void;
  onUndo: () => void;
  onRetry: () => void;
  onResults: () => void;
  onExit: () => void;
  onSeriesInfo: (card: ExploreCard, trigger: HTMLElement) => void;
}) {
  const { history, preferences } = useAppState();
  const [prefs] = preferences;
  const reducedMotion = prefs.motion === 'reduced' || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const resolved = decisions.filter(Boolean).length;
  const currentIndex = (() => { for (let index = 0; index < session.budget; index++) if (!decisions[index]) return index; return session.budget; })();
  const card = session.cards[currentIndex];
  const next = session.cards.slice(currentIndex + 1).find((_, offset) => !decisions[currentIndex + 1 + offset]);
  const canUndo = decisions.some(Boolean);
  const [announcement, setAnnouncement] = useState('');
  const [askSeen, setAskSeen] = useState<ExploreCard | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const cardRef = useRef<HTMLElement>(null);
  const decided = useRef(-1);
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; t: number; axis: 'x' | 'y' | null; dx: number } | null>(null);

  // Card details for the current and next card only; images for the next two.
  useEffect(() => {
    const controller = new AbortController();
    for (const item of [card, next].filter((value): value is ExploreCard => !!value && value.episodeCount > 0)) {
      if (details[item.slug]) continue;
      setDetails(current => ({ ...current, [item.slug]: { state: 'loading' } }));
      api.title(item.slug, controller.signal)
        .then(value => { if (!controller.signal.aborted) setDetails(current => ({ ...current, [item.slug]: { state: 'ready', value } })); })
        .catch(() => { if (!controller.signal.aborted) setDetails(current => ({ ...current, [item.slug]: { state: 'failed' } })); });
    }
    for (const item of session.cards.slice(currentIndex + 1, currentIndex + 3)) {
      const source = item.posterUrl ?? item.artworkUrl;
      if (source) { const image = new Image(); image.decoding = 'async'; image.src = source; }
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.slug, next?.slug]);

  useEffect(() => { decided.current = -1; }, [currentIndex]);

  /** The departing card is a transient clone, so the next card is usable immediately (no blocking animation). */
  const flyOut = (element: HTMLElement, direction: Direction) => {
    const stage = stageRef.current;
    if (!stage || reducedMotion) return;
    const ghost = element.cloneNode(true) as HTMLElement;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.removeAttribute('aria-label');
    ghost.inert = true;
    ghost.classList.add('explore-card--ghost');
    ghost.style.transform = element.style.transform || 'none';
    stage.appendChild(ghost);
    const width = element.getBoundingClientRect().width;
    requestAnimationFrame(() => {
      ghost.style.transition = 'transform 240ms cubic-bezier(.2,.7,.2,1), opacity 240ms ease-out';
      ghost.style.transform = `translate3d(${direction === 'interested' ? width * 1.3 : -width * 1.3}px,0,0) rotate(${direction === 'interested' ? 14 : -14}deg)`;
      ghost.style.opacity = '0';
    });
    window.setTimeout(() => ghost.remove(), 320);
  };

  const decide = useCallback((action: ExploreAction, direction?: Direction) => {
    if (!card || decided.current === card.index) return;
    decided.current = card.index;
    if (direction && cardRef.current) flyOut(cardRef.current, direction);
    onDecide(card.index, card.titleId, action);
    const verb = action === 'interested' ? 'Interested in' : action === 'pass' ? 'Passed on' : action === 'skip' ? 'Skipped' : 'Marked as already seen:';
    const upcoming = session.cards.slice(currentIndex + 1).find((_, offset) => !decisions[currentIndex + 1 + offset]);
    setAnnouncement(`${verb} ${card.name}. ${upcoming ? `Next card: ${upcoming.name}.` : ''}`);
    setAskSeen(action === 'seen' ? card : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, currentIndex, decisions, onDecide, session.cards]);

  // Keyboard equivalents. Never while typing or while a dialog owns focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || typing(event.target) || document.querySelector('dialog[open]')) return;
      const map: Record<string, () => void> = {
        ArrowRight: () => decide('interested', 'interested'), ArrowLeft: () => decide('pass', 'pass'),
        ArrowDown: () => decide('skip'), s: () => decide('skip'), u: () => { if (canUndo) onUndo(); },
      };
      const run = map[event.key];
      if (!run || !card) return;
      event.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, canUndo, decide, onUndo]);

  const threshold = () => Math.min(130, (cardRef.current?.getBoundingClientRect().width ?? 360) * 0.3);
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,a,input,[data-no-swipe]')) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now(), axis: null, dx: 0 };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = gesture.current, element = cardRef.current;
    if (!state || state.id !== event.pointerId || !element) return;
    const dx = event.clientX - state.x, dy = event.clientY - state.y;
    if (!state.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // Vertical intent belongs to page scrolling; only clear horizontal intent becomes a swipe.
      state.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (state.axis === 'y') { gesture.current = null; return; }
      element.setPointerCapture(event.pointerId);
    }
    state.dx = dx;
    element.style.transition = 'none';
    element.style.transform = reducedMotion ? `translate3d(${dx * 0.25}px,0,0)` : `translate3d(${dx}px,0,0) rotate(${dx / 24}deg)`;
    element.style.setProperty('--swipe', String(Math.max(-1, Math.min(1, dx / threshold()))));
  };
  const endGesture = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const state = gesture.current, element = cardRef.current;
    gesture.current = null;
    if (!state || state.id !== event.pointerId || state.axis !== 'x' || !element) return;
    const elapsed = Math.max(1, performance.now() - state.t);
    const fast = Math.abs(state.dx) > 40 && Math.abs(state.dx) / elapsed > 0.6;
    if (!cancelled && (Math.abs(state.dx) >= threshold() || fast)) {
      decide(state.dx > 0 ? 'interested' : 'pass', state.dx > 0 ? 'interested' : 'pass');
      return;
    }
    element.style.transition = 'transform 180ms ease-out';
    element.style.transform = '';
    element.style.removeProperty('--swipe');
  };

  const pendingCard = currentIndex < session.budget && !card;
  const earlyReady = resolved >= EXPLORE_CONFIG.earlyResultsAfter;
  const detail = card ? details[card.slug] : undefined;
  return (
    <section className="explore-deck" aria-labelledby="explore-deck-title">
      <header className="explore-deck__bar">
        <button type="button" className="text-button explore-deck__exit" onClick={onExit}>
          <Icon name="left" />Exit
        </button>
        <div className="explore-progress">
          <h1 id="explore-deck-title" className="sr-only">Explore</h1>
          <p aria-live="off"><strong>{Math.min(resolved + (card ? 1 : 0), session.budget)}</strong> of {session.budget}</p>
          <div className="explore-progress__track" role="progressbar" aria-label="Cards resolved" aria-valuemin={0} aria-valuemax={session.budget} aria-valuenow={resolved}>
            <i style={{ transform: `scaleX(${session.budget ? resolved / session.budget : 0})` }} />
          </div>
        </div>
        <p className={`explore-sync explore-sync--${sync}`} role="status">
          {sync === 'saving' ? 'Saving…' : sync === 'failed' ? 'Not saved' : 'Saved'}
        </p>
      </header>
      {session.budget < session.requested && (
        <p className="explore-notice">Only {session.budget} {session.budget === 1 ? 'title matches' : 'titles match'} your filters, so this round has {session.budget} {session.budget === 1 ? 'card' : 'cards'} instead of {session.requested}.</p>
      )}
      {error && (
        <p className="explore-notice explore-notice--error" role="alert">
          {error} {sync === 'failed' && <button type="button" className="text-button" onClick={onRetry}>Retry</button>}
        </p>
      )}
      <p className="sr-only" id="explore-instructions">
        Swipe right or press the right arrow for Interested. Swipe left or press the left arrow to pass. Press the down arrow or S to skip, and U to undo.
      </p>
      <div className="explore-stage" ref={stageRef}>
        {next && (
          <div className="explore-card explore-card--next" aria-hidden="true">
            <div className="explore-card__wash" style={{ backgroundImage: next.posterUrl || next.artworkUrl ? `url("${next.posterUrl ?? next.artworkUrl}")` : undefined }} />
          </div>
        )}
        {card ? (
          <article ref={cardRef} key={card.index} className={`explore-card explore-card--${card.kind}`} aria-roledescription="discovery card"
            aria-describedby="explore-instructions" aria-label={`${card.name}, card ${currentIndex + 1} of ${session.budget}`}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => endGesture(event)} onPointerCancel={event => endGesture(event, true)}>
            <div className="explore-card__wash" style={{ backgroundImage: card.posterUrl || card.artworkUrl ? `url("${card.posterUrl ?? card.artworkUrl}")` : undefined }} />
            <span className="explore-card__stamp explore-card__stamp--yes" aria-hidden="true">Interested</span>
            <span className="explore-card__stamp explore-card__stamp--no" aria-hidden="true">Pass</span>
            <div className="explore-card__art">
              {card.posterUrl || card.artworkUrl
                ? <img src={card.posterUrl ?? card.artworkUrl ?? ''} alt="" width={265} height={370} draggable={false} decoding="async" />
                : <div className="explore-card__missing" aria-hidden="true">{card.name.slice(0, 1)}</div>}
            </div>
            <div className="explore-card__copy">
              <div className="explore-card__head">
                {card.kind === 'wildcard' && <span className="explore-badge">Wildcard</span>}
                <h2>{card.name}</h2>
                <p className="explore-card__entry">{entryLine(card, detail, session.filters.mode === 'revisit', history, prefs.preferredLanguage ?? 'sub')}</p>
                <p className="explore-card__meta">{metaLine(card)}</p>
              </div>
              {card.genres.length > 0 && <ul className="explore-card__genres" aria-label="Genres">{[...card.genres].sort((a, b) => Number((card.reasons[0]?.text ?? '').includes(b)) - Number((card.reasons[0]?.text ?? '').includes(a))).slice(0, 3).map(genre => <li key={genre}>{genre}</li>)}</ul>}
              {card.synopsis && <p className="explore-card__synopsis">{card.synopsis}</p>}
              {card.reasons[0] && <p className="explore-card__reason"><ExploreIcon name="sparkle" />{card.reasons[0].text}</p>}
              <button type="button" className="text-button explore-card__info" onClick={event => { markDialogTrigger(event.currentTarget); onSeriesInfo(card, event.currentTarget); }}>
                <Icon name="info" />Series info
              </button>
            </div>
          </article>
        ) : pendingCard ? (
          <div className="explore-card explore-card--loading" role="status"><p>Choosing your next card…</p></div>
        ) : (
          <div className="explore-card explore-card--done" role="status">
            <h2>That’s the round</h2>
            <p>You resolved {resolved} of {session.budget} cards.</p>
            <button type="button" className="button button--primary" onClick={onResults}>See what’s picked for you</button>
          </div>
        )}
      </div>
      {askSeen && (
        <div className="explore-seen" role="group" aria-label={`Did you like ${askSeen.name}?`}>
          <p>You’ve seen <strong>{askSeen.name}</strong>. Did you like it?</p>
          <div className="button-row">
            <button type="button" className="button button--outline" onClick={() => { onDecide(askSeen.index, askSeen.titleId, 'seen', true); setAskSeen(null); }}>Liked it</button>
            <button type="button" className="button button--outline" onClick={() => { onDecide(askSeen.index, askSeen.titleId, 'seen', false); setAskSeen(null); }}>Not for me</button>
            <button type="button" className="text-button" onClick={() => setAskSeen(null)}>Skip question</button>
          </div>
        </div>
      )}
      <div className="explore-controls" role="group" aria-label="Card actions">
        <button type="button" className="explore-control" disabled={!canUndo} onClick={onUndo} aria-keyshortcuts="U">
          <ExploreIcon name="undo" /><span>Undo</span>
        </button>
        <button type="button" className="explore-control explore-control--pass" disabled={!card} onClick={() => decide('pass', 'pass')} aria-keyshortcuts="ArrowLeft">
          <ExploreIcon name="pass" /><span>Pass</span>
        </button>
        <button type="button" className="explore-control explore-control--skip" disabled={!card} onClick={() => decide('skip')} aria-keyshortcuts="ArrowDown S">
          <ExploreIcon name="skip" /><span>Skip</span>
        </button>
        <button type="button" className="explore-control explore-control--yes" disabled={!card} onClick={() => decide('interested', 'interested')} aria-keyshortcuts="ArrowRight">
          <ExploreIcon name="heart" /><span>Interested</span>
        </button>
        <button type="button" className="explore-control" disabled={!card} onClick={() => decide('seen')}>
          <ExploreIcon name="eye" /><span>Already seen</span>
        </button>
      </div>
      <div className="explore-deck__footer">
        <button type="button" className="button button--outline" disabled={!earlyReady} onClick={onResults}>
          See recommendations now
        </button>
        {!earlyReady && <p className="field-hint">Available after {EXPLORE_CONFIG.earlyResultsAfter} cards.</p>}
        <p className="field-hint explore-deck__hint">Interested isn’t saving to My List, rating, or marking anything watched.</p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </section>
  );
}

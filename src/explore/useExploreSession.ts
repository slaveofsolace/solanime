import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { exploreApi, newEventId } from './api';
import type {
  ExploreAction,
  ExploreDecision,
  ExploreFilters,
  ExploreSavedPreferences,
  ExploreSessionView,
  ExploreStatus,
} from '../../shared/explore';

type Operation =
  | { kind: 'feedback'; eventId: string; index: number; titleId: string; action: ExploreAction; liked: boolean | null; at: number }
  | { kind: 'undo'; eventId: string; at: number };
export type SyncState = 'saved' | 'saving' | 'failed';

const message = (error: unknown) => error instanceof Error ? error.message : 'Explore is unavailable right now.';
const reason = (error: unknown) => error instanceof ApiError ? (error.problem.details as { reason?: string } | undefined)?.reason : undefined;
const transient = (error: unknown) => !(error instanceof ApiError) || error.problem.status >= 500 || error.problem.status === 429 || error.problem.status === 0;

/** Server decisions overlaid with not-yet-confirmed local operations, in order. */
export function effectiveDecisions(session: ExploreSessionView | null, pending: readonly Operation[]): (ExploreDecision | null)[] {
  if (!session) return [];
  const decisions = [...session.decisions];
  for (const op of pending) {
    if (op.kind === 'feedback') {
      if (op.index >= decisions.length) decisions.length = op.index + 1;
      const existing = decisions[op.index];
      if (existing && !(existing.action === 'seen' && op.action === 'seen')) continue;
      decisions[op.index] = existing ? { ...existing, liked: op.liked } : { action: op.action, liked: op.liked, eventId: op.eventId, at: op.at };
    } else {
      let latest = -1;
      decisions.forEach((decision, index) => { if (decision && (latest < 0 || decision.at >= decisions[latest]!.at)) latest = index; });
      if (latest >= 0) decisions[latest] = null;
    }
  }
  return Array.from(decisions, item => item ?? null);
}

/**
 * Explore state for one profile. Decisions advance optimistically and are saved in order;
 * every request carries an idempotency key, so retries and duplicate taps never double-count.
 */
export function useExploreSession(profileId: string) {
  const api = useMemo(() => exploreApi(profileId), [profileId]);
  const [status, setStatus] = useState<ExploreStatus | null>(null);
  const [session, setSession] = useState<ExploreSessionView | null>(null);
  const [pending, setPending] = useState<Operation[]>([]);
  const [sync, setSync] = useState<SyncState>('saved');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Operation[]>([]);
  const running = useRef(false);
  const sessionRef = useRef<ExploreSessionView | null>(null);
  const alive = useRef(new AbortController());
  sessionRef.current = session;

  useEffect(() => {
    const controller = new AbortController();
    alive.current = controller;
    setLoadError(null);
    api.status(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setStatus(result);
      setSession(result.session);
    }).catch(error => { if (!controller.signal.aborted) setLoadError(message(error)); });
    return () => controller.abort();
  }, [api]);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const signal = alive.current.signal;
    try {
      while (queue.current.length && !signal.aborted) {
        const op = queue.current[0];
        const current = sessionRef.current;
        if (!current) { queue.current = []; break; }
        setSync('saving');
        try {
          const result = op.kind === 'feedback'
            ? await api.feedback({ sessionId: current.id, eventId: op.eventId, index: op.index, titleId: op.titleId, action: op.action, liked: op.liked }, signal)
            : await api.undo({ sessionId: current.id, eventId: op.eventId }, signal);
          if (signal.aborted) return;
          queue.current = queue.current.slice(1);
          sessionRef.current = result.session;
          setSession(result.session);
          setPending([...queue.current]);
        } catch (error) {
          if (signal.aborted) return;
          if (transient(error)) { setSync('failed'); setError(`Couldn’t save your last choice. ${message(error)}`); return; }
          // The round was replaced or changed in another tab: take the server's state.
          queue.current = [];
          setPending([]);
          setError(reason(error) === 'EXPLORE_SESSION_REPLACED' || reason(error) === 'EXPLORE_CARD_MISMATCH'
            ? 'This round changed in another tab, so Explore loaded its latest state.' : message(error));
          const fresh = await api.status(signal).catch(() => null);
          if (fresh && !signal.aborted) { setStatus(fresh); sessionRef.current = fresh.session; setSession(fresh.session); }
          break;
        }
      }
      if (!signal.aborted && !queue.current.length) { setSync('saved'); setError(current => current?.startsWith('Couldn’t save') ? null : current); }
    } finally { running.current = false; }
  }, [api]);

  const enqueue = useCallback((op: Operation) => {
    queue.current = [...queue.current, op];
    setPending([...queue.current]);
    void pump();
  }, [pump]);

  const decide = useCallback((index: number, titleId: string, action: ExploreAction, liked: boolean | null = null) => {
    enqueue({ kind: 'feedback', eventId: newEventId(), index, titleId, action, liked, at: Date.now() });
  }, [enqueue]);
  const undo = useCallback(() => enqueue({ kind: 'undo', eventId: newEventId(), at: Date.now() }), [enqueue]);
  const retry = useCallback(() => { setError(null); void pump(); }, [pump]);

  const flush = useCallback(async () => {
    for (let attempt = 0; attempt < 50 && (queue.current.length || running.current); attempt++) {
      if (!running.current) await pump();
      if (queue.current.length && !running.current) throw new Error('Your latest choices are not saved yet. Retry saving first.');
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  }, [pump]);

  const run = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>) => {
    setBusy(true); setError(null);
    try { return await work(alive.current.signal); }
    catch (error) { if (!alive.current.signal.aborted) setError(message(error)); return null; }
    finally { if (!alive.current.signal.aborted) setBusy(false); }
  }, []);

  const start = useCallback((size: number, filters: ExploreFilters, savePreferences: boolean) => run(async signal => {
    await flush();
    const result = await api.start({ size, filters, savePreferences }, signal);
    queue.current = []; setPending([]);
    sessionRef.current = result.session; setSession(result.session);
    if (savePreferences) setStatus(current => current && ({ ...current, saved: { genres: filters.genres, excludeGenres: filters.excludeGenres, length: filters.length, audio: filters.audio } }));
    return result.session;
  }), [api, flush, run]);

  const results = useCallback((refine?: { titleId: string; kind: 'more' | 'less' | null }) => run(async signal => {
    await flush();
    const current = sessionRef.current;
    if (!current) return null;
    const result = await api.results({ sessionId: current.id, ...(refine ? { refine } : {}) }, signal);
    sessionRef.current = result.session; setSession(result.session);
    return result.session;
  }), [api, flush, run]);

  const reset = useCallback(() => run(async signal => {
    await api.reset(signal);
    queue.current = []; setPending([]);
    sessionRef.current = null; setSession(null);
    const fresh = await api.status(signal);
    setStatus(fresh);
    return true;
  }), [api, run]);

  const savePreferences = useCallback((saved: ExploreSavedPreferences | null) => run(async signal => {
    const result = await api.preferences(saved, signal);
    setStatus(current => current && ({ ...current, saved: result.saved }));
    return result.saved;
  }), [api, run]);

  const decisions = useMemo(() => effectiveDecisions(session, pending), [session, pending]);
  return { status, session, decisions, pending, sync, error, loadError, busy, decide, undo, retry, start, results, reset, savePreferences, clearError: () => setError(null) };
}
export type ExploreController = ReturnType<typeof useExploreSession>;

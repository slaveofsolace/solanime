import { accountRequest } from '../account/api';
import type {
  ExploreAction,
  ExploreFilters,
  ExploreSavedPreferences,
  ExploreSessionView,
  ExploreStatus,
} from '../../shared/explore';

type SessionResult = { session: ExploreSessionView | null; applied?: boolean };

function validSession(value: unknown): value is ExploreSessionView | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<ExploreSessionView>;
  return typeof session.id === 'string' && Array.isArray(session.cards) && Array.isArray(session.decisions) &&
    Number.isSafeInteger(session.budget) && Number.isSafeInteger(session.revision) && typeof session.rankingVersion === 'string';
}
function checked<T extends SessionResult>(result: T): T {
  if (!validSession(result.session)) throw new Error('The Explore response is incomplete. Reload the page and check the API version.');
  return result;
}

/** Profile-scoped Explore API. Every call carries the profile in the path; the server checks ownership. */
export function exploreApi(profileId: string) {
  const base = `profiles/${encodeURIComponent(profileId)}/explore/`;
  return {
    async status(signal?: AbortSignal) {
      const result = await accountRequest<ExploreStatus>(base + 'status', undefined, signal);
      if (!result || !validSession(result.session) || !Array.isArray(result.genres)) throw new Error('The Explore response is incomplete. Reload the page and check the API version.');
      return result;
    },
    start: (body: { size: number; filters: ExploreFilters; savePreferences: boolean }, signal?: AbortSignal) =>
      accountRequest<SessionResult>(base + 'start', body, signal).then(checked),
    feedback: (body: { sessionId: string; eventId: string; index: number; titleId: string; action: ExploreAction; liked?: boolean | null }, signal?: AbortSignal) =>
      accountRequest<SessionResult>(base + 'feedback', body, signal).then(checked),
    undo: (body: { sessionId: string; eventId: string }, signal?: AbortSignal) =>
      accountRequest<SessionResult>(base + 'undo', body, signal).then(checked),
    results: (body: { sessionId: string; refine?: { titleId: string; kind: 'more' | 'less' | null } }, signal?: AbortSignal) =>
      accountRequest<SessionResult>(base + 'results', body, signal).then(checked),
    preferences: (saved: ExploreSavedPreferences | null, signal?: AbortSignal) =>
      accountRequest<{ saved: ExploreSavedPreferences | null }>(base + 'preferences', { saved }, signal),
    reset: (signal?: AbortSignal) => accountRequest<{ reset: boolean }>(base + 'reset', {}, signal),
  };
}
export type ExploreApi = ReturnType<typeof exploreApi>;

export function newEventId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

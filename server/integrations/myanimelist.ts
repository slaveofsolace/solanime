import { AppError } from '../errors.ts';
import { MAL_STATUSES, type MalEntry, type MalStatus } from '../../shared/myanimelist.ts';
import { boundedJson } from '../cloud/auth/http.ts';
import { object } from '../accounts/validation.ts';

const API = 'https://api.myanimelist.net/v2';
export const MAL_USERNAME = /^[A-Za-z0-9_-]{2,16}$/;

/**
 * Read-only access to a member's *public* MyAnimeList list with the operator's
 * client ID (the same approach as the dlt MyAnimeList source). No member login,
 * token or password is ever requested or stored.
 */
export class MalPublicClient {
  constructor(private clientId: string, private fetcher: typeof fetch = fetch) {}
  private async send(url: string) {
    let response: Response;
    // workerd rejects redirect:'error'. Use manual and refuse redirects so the client ID never reaches another host.
    try { response = await this.fetcher(url, { headers: { 'X-MAL-CLIENT-ID': this.clientId }, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
    catch { throw new AppError(502, 'UNAVAILABLE', 'MyAnimeList could not be reached. Your imported list has not been changed.'); }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AppError(502, 'UNAVAILABLE', 'MyAnimeList returned an unexpected redirect. Your imported list has not been changed.');
    }
    if (response.status === 404) throw new AppError(404, 'NOT_FOUND', 'No MyAnimeList member has that username.');
    if (response.status === 403) throw new AppError(403, 'BLOCKED', 'That MyAnimeList list is private. Make it public on MyAnimeList, or import your list export file instead.');
    if (response.status === 401) throw new AppError(503, 'UNAVAILABLE', 'Username import is not configured correctly on this deployment. Import your list export file instead.');
    if (response.status === 429) throw new AppError(429, 'RATE_LIMITED', 'MyAnimeList is rate limiting requests. Try again later.');
    if (!response.ok) throw new AppError(502, 'UNAVAILABLE', 'MyAnimeList did not accept the request. No local list data was changed.');
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList returned an unexpected response.');
    return boundedJson(response, 4_000_000, 15000);
  }
  async list(username: string, offset = 0) {
    if (!MAL_USERNAME.test(username)) throw new AppError(400, 'BAD_REQUEST', 'Enter a MyAnimeList username (2–16 letters, numbers, - or _).');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(400, 'BAD_REQUEST', 'Invalid MyAnimeList page.');
    const url = new URL(`${API}/users/${encodeURIComponent(username)}/animelist`);
    url.search = new URLSearchParams({ fields: 'list_status,num_episodes', limit: '1000', offset: String(offset), sort: 'anime_title', nsfw: 'true' }).toString();
    const result = await this.send(url.href);
    if (!Array.isArray(result.data) || result.data.length > 1000 || !object(result.paging))
      throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList returned an incomplete list page.');
    const items: MalEntry[] = result.data.map(value => {
      if (!object(value) || !object(value.node) || !object(value.list_status))
        throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList list data changed.');
      const n = value.node, s = value.list_status;
      return validEntry({ id: n.id, title: n.title, status: s.status, watchedEpisodes: s.num_episodes_watched, totalEpisodes: n.num_episodes, score: s.score, updatedAt: s.updated_at });
    });
    let nextOffset: number | null = null;
    if (result.paging.next !== undefined) {
      let next: URL;
      try { next = new URL(String(result.paging.next)); }
      catch { throw new AppError(502, 'INVALID_RESPONSE', 'Invalid MyAnimeList pagination.'); }
      const value = Number(next.searchParams.get('offset'));
      if (next.origin !== 'https://api.myanimelist.net' || !next.pathname.endsWith('/animelist') ||
        !Number.isSafeInteger(value) || value <= offset || value > 1_000_000 || items.length === 0)
        throw new AppError(502, 'INVALID_RESPONSE', 'Invalid MyAnimeList pagination.');
      nextOffset = value; // Never fetch an upstream-supplied URL.
    }
    return { items, nextOffset };
  }
}

/** One validated list row, from either the public API or a member's own export file. */
export function validEntry(value: Record<string, unknown>): MalEntry {
  const total = Number(value.totalEpisodes);
  if (!Number.isSafeInteger(value.id) || Number(value.id) < 1 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 1000 ||
    !MAL_STATUSES.includes(value.status as MalStatus) || !Number.isSafeInteger(value.watchedEpisodes) || Number(value.watchedEpisodes) < 0 ||
    Number(value.watchedEpisodes) > 1_000_000 || !Number.isSafeInteger(value.score) || Number(value.score) < 0 || Number(value.score) > 10)
    throw new AppError(400, 'INVALID_RESPONSE', 'This MyAnimeList list contains an entry that could not be read.');
  return { id: Number(value.id), title: value.title.trim(), status: value.status as MalStatus, watchedEpisodes: Number(value.watchedEpisodes),
    totalEpisodes: Number.isSafeInteger(total) && total > 0 ? total : null, score: Number(value.score),
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt.length <= 40 ? value.updatedAt : null };
}

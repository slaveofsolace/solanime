import { AppError } from '../errors.ts';
import { MAL_STATUSES, type MalEntry, type MalStatus } from '../../shared/myanimelist.ts';
import { boundedJson } from '../cloud/auth/http.ts';
import { object } from '../accounts/validation.ts';

export type MalConfig = { clientId: string; clientSecret?: string; redirectUri: string };
export type MalTokens = { accessToken: string; refreshToken: string; expiresAt: number };
const API = 'https://api.myanimelist.net/v2';
const TOKEN = 'https://myanimelist.net/v1/oauth2/token';
export class MalClient {
  constructor(readonly config: MalConfig, private fetcher: typeof fetch = fetch, private now = Date.now) {}
  authorizationUrl(state: string, verifier: string) {
    const url = new URL('https://myanimelist.net/v1/oauth2/authorize');
    // Official MAL documentation currently supports plain PKCE only.
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri, state, code_challenge: verifier, code_challenge_method: 'plain' }).toString();
    return url.href;
  }
  private async send(url: string, init: RequestInit) {
    let response: Response;
    // workerd rejects redirect:'error'. Use manual and refuse redirects so tokens never reach another host.
    try { response = await this.fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
    catch { throw new AppError(502, 'UNAVAILABLE', 'MyAnimeList could not be reached. Your imported list has not been changed.'); }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AppError(502, 'UNAVAILABLE', 'MyAnimeList returned an unexpected redirect. Your imported list has not been changed.');
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new AppError(429, 'RATE_LIMITED', 'MyAnimeList is rate limiting requests. Try again later.',
        { retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, seconds) : 60 });
    }
    if (response.status === 401 || response.status === 403)
      throw new AppError(409, 'UNAVAILABLE', 'Reconnect MyAnimeList to renew access.', { reason: 'MAL_RECONNECT_REQUIRED' });
    if (!response.ok) throw new AppError(502, 'UNAVAILABLE', 'MyAnimeList did not accept the request. No local list data was deleted.');
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList returned an unexpected response.');
    return boundedJson(response, 2_000_000, 15000);
  }
  private async token(fields: Record<string, string>): Promise<MalTokens> {
    const body = new URLSearchParams({ client_id: this.config.clientId, ...fields,
      ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}) });
    const result = await this.send(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (typeof result.access_token !== 'string' || !result.access_token || result.access_token.length > 12000 ||
      typeof result.refresh_token !== 'string' || !result.refresh_token || result.refresh_token.length > 12000 ||
      !Number.isSafeInteger(result.expires_in) || Number(result.expires_in) <= 0 || Number(result.expires_in) > 366 * 86400)
      throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList returned incomplete credentials.');
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: this.now() + Number(result.expires_in) * 1000 };
  }
  exchange(code: string, verifier: string) {
    return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.config.redirectUri });
  }
  refresh(refreshToken: string) { return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }); }
  async identity(token: string) {
    const result = await this.send(`${API}/users/@me`, { headers: { authorization: `Bearer ${token}` } });
    if (!Number.isSafeInteger(result.id) || Number(result.id) < 1 || typeof result.name !== 'string' || result.name.length > 100)
      throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList returned an incomplete account.');
    return { id: Number(result.id), name: result.name };
  }
  async list(token: string, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new AppError(400, 'BAD_REQUEST', 'Invalid MyAnimeList page.');
    const url = new URL(`${API}/users/@me/animelist`);
    url.search = new URLSearchParams({ fields: 'list_status,num_episodes', limit: '500', offset: String(offset), sort: 'anime_title' }).toString();
    const result = await this.send(url.href, { headers: { authorization: `Bearer ${token}` } });
    if (!Array.isArray(result.data) || result.data.length > 500 || !object(result.paging))
      throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList returned an incomplete list page.');
    const items: MalEntry[] = result.data.map(value => {
      if (!object(value) || !object(value.node) || !object(value.list_status))
        throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList list data changed.');
      const n = value.node, s = value.list_status;
      if (!Number.isSafeInteger(n.id) || Number(n.id) < 1 || typeof n.title !== 'string' || n.title.length > 1000 ||
        !MAL_STATUSES.includes(s.status as MalStatus) || !Number.isSafeInteger(s.num_episodes_watched) || Number(s.num_episodes_watched) < 0 ||
        !Number.isSafeInteger(s.score) || Number(s.score) < 0 || Number(s.score) > 10)
        throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList list data changed.');
      return { id: Number(n.id), title: n.title, status: s.status as MalStatus, watchedEpisodes: Number(s.num_episodes_watched),
        totalEpisodes: Number.isSafeInteger(n.num_episodes) && Number(n.num_episodes) > 0 ? Number(n.num_episodes) : null,
        score: Number(s.score), updatedAt: typeof s.updated_at === 'string' ? s.updated_at : null };
    });
    let nextOffset: number | null = null;
    if (result.paging.next !== undefined) {
      if (typeof result.paging.next !== 'string') throw new AppError(502, 'INVALID_RESPONSE', 'Invalid MyAnimeList pagination.');
      let next: URL;
      try { next = new URL(result.paging.next); }
      catch { throw new AppError(502, 'INVALID_RESPONSE', 'Invalid MyAnimeList pagination.'); }
      const value = Number(next.searchParams.get('offset'));
      if (next.origin !== 'https://api.myanimelist.net' || next.pathname !== '/v2/users/@me/animelist' ||
        !Number.isSafeInteger(value) || value <= offset || value > 1_000_000 || items.length === 0)
        throw new AppError(502, 'INVALID_RESPONSE', 'Invalid MyAnimeList pagination.');
      nextOffset = value; // Never fetch an upstream-supplied URL.
    }
    return { items, nextOffset };
  }
  async update(token: string, id: number, status: MalStatus, watchedEpisodes: number) {
    if (!Number.isSafeInteger(id) || id < 1 || !MAL_STATUSES.includes(status) ||
      !Number.isSafeInteger(watchedEpisodes) || watchedEpisodes < 0 || watchedEpisodes > 1_000_000)
      throw new AppError(400, 'BAD_REQUEST', 'Invalid MyAnimeList update.');
    const result = await this.send(`${API}/anime/${id}/my_list_status`, { method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status, num_watched_episodes: String(watchedEpisodes) }) });
    if (result.status !== status || result.num_episodes_watched !== watchedEpisodes)
      throw new AppError(502, 'INVALID_RESPONSE', 'MyAnimeList did not confirm the requested update. Refresh the list before trying again.');
    return { status, watchedEpisodes };
  }
}

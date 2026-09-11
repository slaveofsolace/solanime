from pathlib import Path
R=Path.cwd()
def write(path,text):
 p=R/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text.strip()+'\n')
def replace(path,old,new):
 p=R/path;s=p.read_text();assert old in s, (path,old[:90]);p.write_text(s.replace(old,new))
write('src/lib/storage.ts', '''import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EpisodeComment, Preferences, TitleSummary, WatchedEpisode, WatchHistoryEntry } from '../types';
const PREFIX = 'sol-anime:';
export const defaultPreferences: Preferences = { preferredLanguage: 'sub', autoplayNext: false, rememberProgress: true, theme: 'dark' };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const fields = (value: unknown, names: string[]): value is RecordValue => record(value) && names.every((name) => text(value[name]));
const optionalText = (value: unknown): string | null => text(value) ? value : null;
function title(value: unknown): TitleSummary | null {
  if (!fields(value, ['id', 'slug', 'name'])) return null;
  return {
    id: value.id as string, slug: value.slug as string, name: value.name as string,
    imageUrl: optionalText(value.imageUrl), posterUrl: optionalText(value.posterUrl),
    synopsis: optionalText(value.synopsis), type: optionalText(value.type), status: optionalText(value.status),
    releaseYear: typeof value.releaseYear === 'number' && Number.isFinite(value.releaseYear) ? value.releaseYear : null,
    episodeCount: typeof value.episodeCount === 'number' && value.episodeCount >= 0 ? value.episodeCount : undefined,
    genres: Array.isArray(value.genres) ? value.genres.flatMap((genre) => text(genre) ? [genre] : record(genre) && text(genre.name) ? [genre.name] : []) : [],
  };
}
/** Validate existing browser records without discarding unrelated storage. */
export function decodeStored<T>(key: string, value: unknown, fallback: T): T {
  if (key === 'preferences') {
    const data = record(value) ? value : {};
    return { ...defaultPreferences,
      preferredLanguage: text(data.preferredLanguage) && /^[a-z-]{2,20}$/.test(data.preferredLanguage) ? data.preferredLanguage : 'sub',
      autoplayNext: typeof data.autoplayNext === 'boolean' ? data.autoplayNext : false,
      rememberProgress: typeof data.rememberProgress === 'boolean' ? data.rememberProgress : true,
      theme: data.theme === 'light' ? 'light' : 'dark',
    } as T;
  }
  if (key.startsWith('progress:')) return (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0) as T;
  if (!Array.isArray(value)) return fallback;
  if (key === 'watchlist-records') {
    const seen = new Set<string>();
    return value.flatMap((entry) => { const item = title(entry); if (!item || seen.has(item.id)) return []; seen.add(item.id); return [item]; }).slice(0, 1000) as T;
  }
  if (key === 'history') return value.filter((entry) => fields(entry, ['titleId', 'slug', 'title', 'episodeId', 'episodeLabel', 'language', 'watchedAt'])).map((entry) => ({ ...entry, imageUrl: optionalText(entry.imageUrl) })).slice(0, 100) as T;
  if (key === 'watched-episodes') return value.filter((entry) => fields(entry, ['episodeId', 'language', 'watchedAt'])).slice(0, 10000) as T;
  if (key === 'episode-comments') return value.filter((entry) => fields(entry, ['id', 'episodeId', 'author', 'body', 'createdAt'])).map((entry) => ({ ...entry, author: (entry.author as string).slice(0, 40), body: (entry.body as string).slice(0, 1000) })).slice(0, 500) as T;
  return fallback;
}
function readStored<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(PREFIX + key); return raw ? decodeStored(key, JSON.parse(raw), fallback) : fallback; } catch { return fallback; }
}
function writeStored<T>(key: string, value: T): void {
  try { const serialized = JSON.stringify(value); if (window.localStorage.getItem(PREFIX + key) !== serialized) window.localStorage.setItem(PREFIX + key, serialized); } catch { /* Storage may be disabled or full; the current session remains usable. */ }
}
export function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));
  useEffect(() => writeStored(key, value), [key, value]);
  useEffect(() => { const onStorage = (event: StorageEvent) => { if (event.key === PREFIX + key || event.key === null) setValue(readStored(key, fallback)); }; window.addEventListener('storage', onStorage); return () => window.removeEventListener('storage', onStorage); }, [key]);
  return [value, setValue] as const;
}
export function useWatchlist() {
  const [items, setItems] = usePersistentState<TitleSummary[]>('watchlist-records', []);
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  const toggle = useCallback((id: string, item?: TitleSummary) => { setItems((current) => current.some((entry) => entry.id === id) ? current.filter((entry) => entry.id !== id) : item ? [item, ...current].slice(0, 1000) : current); }, [setItems]);
  return useMemo(() => ({ ids, items, has, toggle }), [ids, items, has, toggle]);
}
export function useHistory() {
  const [entries, setEntries] = usePersistentState<WatchHistoryEntry[]>('history', []);
  const remember = useCallback((entry: WatchHistoryEntry) => { setEntries((current) => [entry, ...current.filter((item) => !(item.episodeId === entry.episodeId && item.language === entry.language))].slice(0, 100)); }, [setEntries]);
  const clear = useCallback(() => setEntries([]), [setEntries]);
  const remove = useCallback((episodeId: string, language: string) => { setEntries((current) => current.filter((item) => !(item.episodeId === episodeId && item.language === language))); }, [setEntries]);
  return useMemo(() => ({ entries, remember, remove, clear }), [entries, remember, remove, clear]);
}
export function useWatchedEpisodes() {
  const [entries, setEntries] = usePersistentState<WatchedEpisode[]>('watched-episodes', []);
  const isWatched = useCallback((episodeId: string, language: string) => entries.some((item) => item.episodeId === episodeId && item.language === language), [entries]);
  const toggle = useCallback((episodeId: string, language: string) => { setEntries((current) => current.some((item) => item.episodeId === episodeId && item.language === language) ? current.filter((item) => !(item.episodeId === episodeId && item.language === language)) : [{ episodeId, language, watchedAt: new Date().toISOString() }, ...current].slice(0, 10000)); }, [setEntries]);
  return useMemo(() => ({ entries, isWatched, toggle }), [entries, isWatched, toggle]);
}
export function useEpisodeComments() {
  const [entries, setEntries] = usePersistentState<EpisodeComment[]>('episode-comments', []);
  const add = useCallback((episodeId: string, author: string, body: string) => {
    const cleanBody = body.trim().slice(0, 1000); if (!cleanBody) return;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setEntries((current) => [{ id, episodeId, author: author.trim().slice(0, 40) || 'You', body: cleanBody, createdAt: new Date().toISOString() }, ...current].slice(0, 500));
  }, [setEntries]);
  const remove = useCallback((id: string) => setEntries((current) => current.filter((item) => item.id !== id)), [setEntries]);
  const forEpisode = useCallback((episodeId: string) => entries.filter((item) => item.episodeId === episodeId), [entries]);
  return useMemo(() => ({ entries, add, remove, forEpisode }), [entries, add, remove, forEpisode]);
}
export function usePreferences() { return usePersistentState<Preferences>('preferences', defaultPreferences); }
export function readProgress(episodeId: string, language: string, sourceScope: string): number { return readStored<number>(`progress:${episodeId}:${language}:${sourceScope}`, 0); }
export function writeProgress(episodeId: string, language: string, sourceScope: string, seconds: number): void { if (Number.isFinite(seconds) && seconds >= 0) writeStored(`progress:${episodeId}:${language}:${sourceScope}`, seconds); }
''')
replace('src/lib/api.ts','async function readResponse<T>(response: Response): Promise<T> {','export async function readResponse<T>(response: Response): Promise<T> {')
replace('src/lib/api.ts',"  if (isJson && body === null) {", "  if (!isJson) { throw new ApiError({ status: response.status, code: 'API_NOT_CONFIGURED', message: 'The catalogue API is not connected. This server returned a web page instead of data. Check the API deployment configuration.' }); }\n  if (body === null || typeof body !== 'object') {")
replace('src/lib/api.ts',"  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });\n  return readResponse<T>(response);",'''  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) cancel(); else options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 60_000);
  try { const response = await fetch(path, { ...options, signal: controller.signal, headers, credentials: 'same-origin' }); return await readResponse<T>(response); }
  catch (error) {
    if (options.signal?.aborted || error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError({ status: 0, code: 'TIMEOUT', message: 'The server took too long to respond. Try again.' });
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the catalogue API. Check your connection and that the API server is running.' });
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }''')
replace('src/pages/CataloguePage.tsx',"  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);", "  const [retry, setRetry] = useState(0);\n  const rawPage = Number(params.get('page') ?? 1);\n  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 1_000_000 ? rawPage : 1;")
replace('src/pages/CataloguePage.tsx',"      .then((result) => {\n        setCatalogue(result);", "      .then((result) => {\n        if (controller.signal.aborted) return;\n        if (result.pages > 0 && page > result.pages) { setParams((current) => { const next = new URLSearchParams(current); next.set('page', String(result.pages)); return next; }, { replace: true }); return; }\n        setCatalogue(result);")
replace('src/pages/CataloguePage.tsx','  }, [query]);','  }, [query, retry, setParams]);')
replace('src/pages/CataloguePage.tsx','onClick={() => setParams((current) => new URLSearchParams(current))}','onClick={() => setRetry((value) => value + 1)}')
replace('src/pages/CataloguePage.tsx','Search, filter, or sort the synchronized catalogue.','Find a title, explore a genre, or pick up a new series.')
replace('src/pages/CataloguePage.tsx','The library did not answer.','Could not load the catalogue')
replace('src/pages/CataloguePage.tsx','Nothing matched this cut.','No titles found')
replace('src/pages/CataloguePage.tsx','Showing the full synchronized catalogue','All available catalogue records')
replace('src/lib/api.ts','  catalogue(query: CatalogueQuery, signal?: AbortSignal) {','  async catalogue(query: CatalogueQuery, signal?: AbortSignal) {')
replace('src/lib/api.ts',"    return request<CatalogueResponse>(`/api/titles?${params}`, { signal });", "    const result = await request<CatalogueResponse>(`/api/titles?${params}`, { signal });\n    if (!Array.isArray(result.items) || !Number.isFinite(result.total) || !Number.isFinite(result.pages) || !result.items.every((item) => item && typeof item.id === 'string' && typeof item.slug === 'string' && typeof item.name === 'string')) { throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', message: 'The catalogue response is incomplete. Try again or check the API version.' }); }\n    return result;")
replace('src/pages/WatchPage.tsx','export default function WatchPage() {', '''export default function WatchPage() {
  const { slug = '', episodeId = '' } = useParams();
  const [params] = useSearchParams();
  return <WatchSession key={`${slug}:${episodeId}:${params.get('language') ?? ''}`} />;
}
function WatchSession() {''')
replace('src/pages/WatchPage.tsx','    setPendingMapping(provider.mappingId);\n    setProviderError(null);','    setPendingMapping(provider.mappingId);\n    setResolution(null);\n    setActiveMapping(null);\n    setProviderError(null);')
replace('src/pages/WatchPage.tsx','    if (loadingProviders || providers.length === 0 || pendingMapping) return;','    if (loadingTitle || loadingProviders || providers.length === 0 || pendingMapping) return;')
replace('src/pages/WatchPage.tsx','  }, [providers, loadingProviders, pendingMapping, activeMapping,','  }, [providers, loadingTitle, loadingProviders, pendingMapping, activeMapping,')
replace('src/pages/WatchPage.tsx','    const sequence = ++requestSequence.current;',"    const sequence = ++requestSequence.current;\n    autoAttemptKey.current = `${episode?.id ?? episodeId}:${language}:${provider.mappingId}`;\n    setParams((current) => { const next = new URLSearchParams(current); next.set('language', language); next.set('server', provider.mappingId); return next; }, { replace: replaceHistory });")
p=R/'src/pages/WatchPage.tsx';s=p.read_text();a=s.index('      if (episode && title) {\n        history.remember');b=s.index('\n    } catch (cause)',a);s=s[:a]+s[b:]
s=s.replace("  const titleName = title.name ?? title.title ?? 'Untitled record';",'''  const rememberViewing = () => {
    history.remember({ titleId: title.id, slug, title: title.name, imageUrl: title.imageUrl ?? title.posterUrl, episodeId: episode.id, episodeLabel: episodeName(episode), language, watchedAt: new Date().toISOString() });
  };
  const titleName = title.name ?? title.title ?? 'Untitled record';''')
s=s.replace('              rememberProgress={preference.rememberProgress}', '''              rememberProgress={preference.rememberProgress}
              onOpen={rememberViewing}
              onEnded={() => { if (!watched.isWatched(episode.id, language)) watched.toggle(episode.id, language); if (preference.autoplayNext && next) goToEpisode(next); }}''')
s=s.replace('SOURCE ROUTING','PLAYBACK').replace('Episode comments','Your notes').replace('Post comment','Save note').replace('Share a note about this episode','Add a note about this episode').replace('No comments yet.','No notes yet.').replace('Add the first local note for this episode.','Notes are saved only in this browser.')
s=s.replace('Only the newest selection will be loaded.','Choose another server if this connection is unavailable.').replace('The player appears only after a real mapping resolves.','Server availability depends on the provider.')
s=s.replace('              <div className="source-facts">','              <details className="source-facts"><summary>Connection details</summary>').replace('              </div>\n            );\n          })()}','              </details>\n            );\n          })()}')
s=s.replace('          {providerError && <InlineNotice tone="error"><strong>Source not loaded.</strong> {providerError}</InlineNotice>}','''          {providerError && <InlineNotice tone="error"><strong>Source not loaded.</strong> {providerError}<button type="button" className="text-button" onClick={() => { const selected = providers.find((item) => item.mappingId === serverFromUrl); if (selected) void selectProvider(selected, true); }}>Retry selected server</button></InlineNotice>}''')
p.write_text(s)
write('src/components/ErrorBoundary.tsx', '''import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { if (import.meta.env.DEV) console.error('Page render failed', error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="status-panel" role="alert"><h1>This page could not be displayed</h1><p>Your saved list has not been erased. Reload the page to try again.</p><div className="button-row"><button className="button button--primary" type="button" onClick={() => window.location.reload()}>Reload page</button><Link className="button" to="/">Back to home</Link></div></section>;
  }
}
export default function PageErrorBoundary({ children }: { children: ReactNode }) { const location = useLocation(); return <Boundary key={location.pathname}>{children}</Boundary>; }
''')

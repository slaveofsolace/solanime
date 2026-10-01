import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import { MAL_STATUSES, MAL_STATUS_LABELS, type MalEntry, type MalStatus } from '../../shared/myanimelist';
import '../styles/settings.css';

function MalRow({ entry, base, onSave }: { entry: MalEntry; base: string; onSave: (entry: MalEntry) => void }) {
  const [status, setStatus] = useState(entry.status), [count, setCount] = useState(entry.watchedEpisodes);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <li className="mal-row"><div><a href={`https://myanimelist.net/anime/${entry.id}`} target="_blank" rel="noreferrer">{entry.title}</a><small>MyAnimeList · {entry.totalEpisodes ? `${entry.totalEpisodes} episodes` : 'Episode total unknown'}</small></div>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('');
      try { const result = await accountRequest<{ item: MalEntry }>(base + 'update', { id: entry.id, status, watchedEpisodes: count }); onSave(result.item); }
      catch (e) { setError(e instanceof Error ? e.message : 'Update failed.'); }
      finally { setBusy(false); }
    }}>
      <label><span className="sr-only">{entry.title} status</span><select value={status} disabled={busy} onChange={e => setStatus(e.target.value as MalStatus)}>{MAL_STATUSES.map(value => <option key={value} value={value}>{MAL_STATUS_LABELS[value]}</option>)}</select></label>
      <label><span>Episodes watched</span><input type="number" min={0} max={entry.totalEpisodes ?? 1000000} required value={count} disabled={busy} onChange={e => setCount(e.target.valueAsNumber)} /></label>
      <button type="submit" className="button button--outline" disabled={busy || (status === entry.status && count === entry.watchedEpisodes)}>{busy ? 'Saving…' : 'Save to MAL'}</button>
    </form>{error && <p role="alert">{error}</p>}</li>;
}
export default function MyAnimeListLibrary() {
  const { profile } = useAccount();
  const [items, setItems] = useState<MalEntry[]>([]), [page, setPage] = useState(1), [hasMore, setMore] = useState(false);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const base = `profiles/${profile?.id}/mal/`;
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    void accountRequest<{ items: MalEntry[]; hasMore: boolean }>(base + `list?page=${page}`, undefined, abort.signal)
      .then(result => { if (!abort.signal.aborted) { setItems(result.items); setMore(result.hasMore); } })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'List unavailable.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [base, page, retry]);
  // The connection is managed in Settings. An empty import adds a dead-end
  // section to Library, where saved titles and actual watch history matter.
  if (page === 1 && !error && items.length === 0) return null;
  return <section id="mal-list" className="library-section" aria-labelledby="mal-list-heading">
    <header className="section-heading"><h2 id="mal-list-heading">MyAnimeList</h2><Link to="/settings#connections">Manage connection</Link></header>
    <p className="field-hint">Imported MAL records are separate from your saved Solanime titles and viewing history.</p>
    {loading ? <p role="status">Loading imported list…</p> : error ? <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Retry</button></p> : items.length ?
      <ul className="mal-list">{items.map(entry => <MalRow key={`${entry.id}:${entry.updatedAt}`} entry={entry} base={base} onSave={updated => setItems(current => current.map(item => item.id === updated.id ? updated : item))} />)}</ul>
      : <p>No MyAnimeList entries have been imported. Connect and sync in Settings.</p>}
    {(page > 1 || hasMore) && <nav className="pagination" aria-label="MyAnimeList pages"><button disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button disabled={!hasMore || loading} onClick={() => setPage(value => value + 1)}>Next</button></nav>}
  </section>;
}

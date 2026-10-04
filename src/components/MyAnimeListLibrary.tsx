import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import { MAL_STATUS_LABELS, type MalEntry } from '../../shared/myanimelist';

function MalRow({ entry }: { entry: MalEntry }) {
  return <li className="mal-row"><div><a href={`https://myanimelist.net/anime/${entry.id}`} target="_blank" rel="noreferrer">{entry.title}</a>
    <small>{MAL_STATUS_LABELS[entry.status]}{entry.score ? ` · your score ${entry.score}/10` : ''} · {entry.totalEpisodes ? `${entry.watchedEpisodes} of ${entry.totalEpisodes} episodes` : `${entry.watchedEpisodes} episodes watched`}</small></div></li>;
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
    <header className="section-heading"><h2 id="mal-list-heading">MyAnimeList</h2><Link to="/settings#connections">Update or remove</Link></header>
    {loading ? <p role="status">Loading imported list…</p> : error ? <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Retry</button></p> : items.length ?
      <ul className="mal-list">{items.map(entry => <MalRow key={entry.id} entry={entry} />)}</ul>
      : <p>No imported titles. Sync your list in Settings.</p>}
    {(page > 1 || hasMore) && <nav className="pagination" aria-label="MyAnimeList pages"><button disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button disabled={!hasMore || loading} onClick={() => setPage(value => value + 1)}>Next</button></nav>}
  </section>;
}

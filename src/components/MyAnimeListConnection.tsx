import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import type { MalConnection } from '../../shared/myanimelist';

export default function MyAnimeListConnection() {
  const { profile } = useAccount();
  const [status, setStatus] = useState<MalConnection | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const active = useRef(true);
  const base = `profiles/${profile?.id}/mal/`;
  const refresh = useCallback(async () => {
    setError('');
    try { const result = await accountRequest<MalConnection>(base + 'status'); if (active.current) setStatus(result); }
    catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Connection unavailable.'); }
  }, [base]);
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, [refresh]);
  async function action(kind: 'connect' | 'sync' | 'disconnect') {
    setBusy(true); setError(''); setProgress('');
    try {
      if (kind === 'connect') {
        const result = await accountRequest<{ url: string }>(base + kind, {});
        const url = new URL(result.url);
        if (url.origin !== 'https://myanimelist.net' || url.pathname !== '/v1/oauth2/authorize') throw new Error('Unexpected authorization destination.');
        if (active.current) window.location.assign(url.href);
        return;
      }
      if (kind === 'sync') {
        // Bounded foreground sync. Durable server checkpoints survive navigation and tab closure.
        for (let page = 0; page < 20 && active.current; page++) {
          const result = await accountRequest<{ complete: boolean; nextOffset?: number }>(base + 'sync', {});
          if (!active.current) return;
          if (result.complete) { setProgress('MyAnimeList list is up to date.'); break; }
          setProgress(`Imported through record ${result.nextOffset}. You can leave and resume later.`);
          if (page === 19) setProgress('Progress saved. Choose Resume import to continue.');
          else await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else await accountRequest(base + kind, {});
      if (active.current) await refresh();
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'The operation failed.'); }
    finally { if (active.current) setBusy(false); }
  }
  return <section id="connections" className="settings-section" aria-labelledby="mal-heading">
    <h2 id="mal-heading">MyAnimeList</h2>
    {!status && !error && <p role="status">Checking connection…</p>}
    {status && !status.configured && <p>The operator needs to register Solanime with MyAnimeList before accounts can connect. Your MAL password is never entered here.</p>}
    {status?.configured && !status.connected && <><p>Connect on MyAnimeList to import all five list statuses and authorize list updates. Solanime history stays separate.</p>
      <button className="button button--primary" disabled={busy} onClick={() => void action('connect')}>Connect MyAnimeList</button></>}
    {status?.connected && <>
      <p>Connected as <strong>{status.username}</strong> · {status.count.toLocaleString()} imported anime</p>
      {status.importedAt && <p className="field-hint">Last complete import: {new Date(status.importedAt).toLocaleString()}</p>}
      <div className="button-row"><button className="button button--primary" disabled={busy || !status.configured} onClick={() => void action('sync')}>{busy ? 'Importing…' : status.syncing ? 'Resume import' : 'Sync list'}</button>
        <Link className="button button--outline" to="/library#mal-list">View imported list</Link>
        <button className="text-button" disabled={busy} onClick={() => { if (window.confirm('Disconnect MyAnimeList and remove its imported list from this profile? Your MyAnimeList account and Solanime history will not change.')) void action('disconnect'); }}>Disconnect</button></div>
      <p className="field-hint">Updates require an explicit save in your imported list. Watching an episode does not yet update MAL automatically: episode-to-MAL identity must be verified first.</p>
    </>}
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert">{error} <button className="text-button" onClick={() => void refresh()}>Retry connection check</button></p>}
  </section>;
}

export function MalCallbackPage() {
  const auth = useAccount(), navigate = useNavigate();
  const [params] = useSearchParams();
  const [response] = useState(() => ({ code: params.get('code'), state: params.get('state'), denied: params.has('error') }));
  const [message, setMessage] = useState('Finishing the MyAnimeList connection…');
  const started = useRef(false);
  // Remove the authorization code from the visible address and subsequent referrers immediately.
  useEffect(() => { navigate('/settings/mal/callback', { replace: true }); }, [navigate]);
  useEffect(() => {
    if (!auth.ready || auth.changing || started.current) return;
    if (!auth.account || !auth.profile) { setMessage('Sign in and choose your profile in Settings, then start the MyAnimeList connection again.'); return; }
    if (response.denied || !response.code || !response.state) { setMessage('MyAnimeList was not connected. You can start again in Settings.'); return; }
    started.current = true;
    void accountRequest(`profiles/${auth.profile.id}/mal/complete`, response)
      .then(() => navigate('/settings#connections', { replace: true }))
      .catch(e => setMessage(e instanceof Error ? e.message : 'The connection could not be completed.'));
  }, [auth.ready, auth.changing, auth.account, auth.profile, navigate, response]);
  return <section className="settings-page"><h1>MyAnimeList connection</h1><p role="status">{message}</p><Link to="/settings#connections">Return to Settings</Link></section>;
}

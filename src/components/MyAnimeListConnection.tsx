import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import type { MalConnection } from '../../shared/myanimelist';

export default function MyAnimeListConnection() {
  const { account, profile, changing } = useAccount();
  const profileId = account && profile && !changing ? profile.id : null;
  // Connection state and in-flight work belong to one account/profile only.
  return <ProfileConnection key={JSON.stringify([account?.id, profileId])} profileId={profileId} />;
}

function ProfileConnection({ profileId }: { profileId: string | null }) {
  const [status, setStatus] = useState<MalConnection | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const statusRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const base = profileId ? `profiles/${profileId}/mal/` : null;
  const refresh = useCallback(async () => {
    if (!base) return;
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    const isCurrent = () => statusRequest.current === controller && !controller.signal.aborted;
    setError('');
    try {
      const result = await accountRequest<MalConnection>(base + 'status', undefined, controller.signal);
      if (isCurrent()) setStatus(result);
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : 'Connection unavailable.');
    } finally {
      if (statusRequest.current === controller) statusRequest.current = null;
    }
  }, [base]);
  useEffect(() => {
    void refresh();
    return () => {
      statusRequest.current?.abort();
      actionRequest.current?.abort();
    };
  }, [refresh]);
  async function action(kind: 'connect' | 'sync' | 'disconnect') {
    if (!base || actionRequest.current) return;
    statusRequest.current?.abort();
    const controller = new AbortController();
    actionRequest.current = controller;
    const isCurrent = () => actionRequest.current === controller && !controller.signal.aborted;
    setBusy(true); setError(''); setProgress('');
    try {
      if (kind === 'connect') {
        const result = await accountRequest<{ url: string }>(base + kind, {}, controller.signal);
        if (!isCurrent()) return;
        const url = new URL(result.url);
        if (url.origin !== 'https://myanimelist.net' || url.pathname !== '/v1/oauth2/authorize') throw new Error('Unexpected authorization destination.');
        window.location.assign(url.href);
        return;
      }
      if (kind === 'sync') {
        // Bounded foreground sync. Durable server checkpoints survive navigation and tab closure.
        for (let page = 0; page < 20 && isCurrent(); page++) {
          const result = await accountRequest<{ complete: boolean; nextOffset?: number }>(base + 'sync', {}, controller.signal);
          if (!isCurrent()) return;
          if (result.complete) { setProgress('Your list is up to date.'); break; }
          setProgress('Importing your list… You can resume later.');
          if (page === 19) setProgress('Progress saved. Choose Resume import to continue.');
          else await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else await accountRequest(base + kind, {}, controller.signal);
      if (isCurrent()) await refresh();
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : 'The operation failed.');
    } finally {
      if (isCurrent()) { actionRequest.current = null; setBusy(false); }
    }
  }
  if (!profileId) return <section id="connections" className="settings-section" aria-labelledby="mal-heading">
    <h2 id="mal-heading">MyAnimeList</h2><p>Choose a profile to connect MyAnimeList.</p>
  </section>;
  return <section id="connections" className={`settings-section${!status && !error ? ' settings-section--loading' : ''}${status && !status.configured ? ' settings-section--unavailable' : ''}`} aria-labelledby="mal-heading">
    <h2 id="mal-heading">MyAnimeList</h2>
    {!status && !error && <p role="status">Checking connection…</p>}
    {status && !status.configured && <p>MyAnimeList connections are unavailable.</p>}
    {status?.configured && !status.connected && <><p>Import and edit your MyAnimeList list. You’ll sign in on MyAnimeList.</p>
      <button className="button button--primary" disabled={busy} onClick={() => void action('connect')}>Connect MyAnimeList</button></>}
    {status?.connected && <>
      <p>Connected as <strong>{status.username}</strong> · {status.count.toLocaleString()} imported anime</p>
      {status.importedAt && <p className="field-hint">Last synced {new Date(status.importedAt).toLocaleString()}</p>}
      <div className="button-row"><button className="button button--primary" disabled={busy || !status.configured} onClick={() => void action('sync')}>{busy ? 'Importing…' : status.syncing ? 'Resume import' : 'Sync list'}</button>
        <Link className="button button--outline" to="/library#mal-list">View imported list</Link>
        <button className="text-button" disabled={busy} onClick={() => { if (window.confirm('Disconnect MyAnimeList and remove its imported list from this profile? Your MyAnimeList account and Solanime history will not change.')) void action('disconnect'); }}>Disconnect</button></div>
      <p className="field-hint">Watching on Solanime doesn’t update your MyAnimeList progress automatically.</p>
    </>}
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert">{error} <button className="text-button" disabled={busy} onClick={() => void refresh()}>Retry</button></p>}
  </section>;
}

export function MalCallbackPage() {
  const auth = useAccount(), navigate = useNavigate();
  const [params] = useSearchParams();
  const [response] = useState(() => ({ code: params.get('code'), state: params.get('state'), denied: params.has('error') }));
  const [message, setMessage] = useState('Connecting MyAnimeList…');
  const started = useRef(false);
  // Remove the authorization code from the visible address and subsequent referrers immediately.
  useEffect(() => { navigate('/settings/mal/callback', { replace: true }); }, [navigate]);
  useEffect(() => {
    if (!auth.ready || auth.changing || started.current) return;
    if (!auth.account || !auth.profile) { setMessage('Sign in and choose a profile, then connect MyAnimeList from Settings.'); return; }
    if (response.denied || !response.code || !response.state) { setMessage('MyAnimeList was not connected. You can start again in Settings.'); return; }
    started.current = true;
    void accountRequest(`profiles/${auth.profile.id}/mal/complete`, response)
      .then(() => navigate('/settings#connections', { replace: true }))
      .catch(e => setMessage(e instanceof Error ? e.message : 'The connection could not be completed.'));
  }, [auth.ready, auth.changing, auth.account, auth.profile, navigate, response]);
  return <section className="settings-page"><h1>MyAnimeList connection</h1><p role="status">{message}</p><Link to="/settings#connections">Return to Settings</Link></section>;
}

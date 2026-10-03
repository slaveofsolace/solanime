import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import { readMalExport } from '../lib/malExport';
import type { MalConnection } from '../../shared/myanimelist';

export default function MyAnimeListConnection() {
  const { account, profile, changing } = useAccount();
  const profileId = account && profile && !changing ? profile.id : null;
  // Import state and in-flight work belong to one account/profile only.
  return <ProfileConnection key={JSON.stringify([account?.id, profileId])} profileId={profileId} />;
}

/** Imports a MyAnimeList list without a MyAnimeList login: public username, or the member's own export file. */
function ProfileConnection({ profileId }: { profileId: string | null }) {
  const [status, setStatus] = useState<MalConnection | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [username, setUsername] = useState('');
  const request = useRef<AbortController | null>(null);
  const base = profileId ? `profiles/${profileId}/mal/` : null;
  const refresh = useCallback(async () => {
    if (!base) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setError('');
    try {
      const result = await accountRequest<MalConnection>(base + 'status', undefined, controller.signal);
      if (!controller.signal.aborted) { setStatus(result); if (result.username) setUsername(current => current || result.username || ''); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'MyAnimeList import is unavailable.'); }
  }, [base]);
  useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);

  async function run(work: (signal: AbortSignal) => Promise<string>) {
    if (!base || busy) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      const message = await work(controller.signal);
      if (controller.signal.aborted) return;
      setNotice(message);
      await refresh();
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'The import failed. Your previous list is unchanged.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const importUsername = () => run(async signal => {
    const result = await accountRequest<{ imported: number }>(base + 'import-username', { username: username.trim() }, signal);
    return `Imported ${result.imported.toLocaleString()} anime from ${username.trim()}’s public list.`;
  });
  const importFile = (file: File) => run(async signal => {
    const parsed = await readMalExport(file);
    const result = await accountRequest<{ imported: number }>(base + 'import-file', parsed, signal);
    return `Imported ${result.imported.toLocaleString()} anime from your export file.`;
  });
  const remove = () => run(async signal => {
    await accountRequest(base + 'remove', {}, signal);
    return 'Imported list removed. Your MyAnimeList account was not touched.';
  });

  if (!profileId) return <section id="connections" className="settings-section" aria-labelledby="mal-heading">
    <h2 id="mal-heading">MyAnimeList</h2><p>Choose a profile to import a MyAnimeList list.</p>
  </section>;
  return <section id="connections" className={`settings-section${!status && !error ? ' settings-section--loading' : ''}`} aria-labelledby="mal-heading" aria-busy={busy}>
    <h2 id="mal-heading">MyAnimeList</h2>
    <p>Bring in your ratings so Explore can suggest what to watch next. No MyAnimeList password or sign-in is needed, and nothing is ever changed on MyAnimeList.</p>
    {!status && !error && <p role="status">Checking your imported list…</p>}
    {status?.connected && <p>
      <strong>{status.count.toLocaleString()} anime imported</strong>{status.username ? <> from {status.username}</> : null}
      {status.importedAt ? <span className="field-hint"> · updated {new Date(status.importedAt).toLocaleDateString()}</span> : null}
    </p>}
    {status && <>
      {status.usernameImport && <form className="mal-import" onSubmit={event => { event.preventDefault(); void importUsername(); }}>
        <label htmlFor="mal-username">MyAnimeList username</label>
        <div className="button-row">
          <input id="mal-username" name="mal-username" autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="text"
            pattern="[A-Za-z0-9_\-]{2,16}" maxLength={16} required value={username} disabled={busy}
            onChange={event => setUsername(event.target.value)} placeholder="e.g. your_name…" />
          <button type="submit" className="button button--primary" disabled={busy}>{busy ? 'Importing…' : status.connected ? 'Update from username' : 'Import list'}</button>
        </div>
        <p className="field-hint">Works when your MyAnimeList list is public.</p>
      </form>}
      <div className="mal-import">
        <label htmlFor="mal-export">{status.usernameImport ? 'Or import your export file' : 'Import your export file'}</label>
        <input id="mal-export" type="file" accept=".xml,.gz,application/xml,text/xml,application/gzip" disabled={busy}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} />
        <p className="field-hint">On MyAnimeList, open Profile → <a href="https://myanimelist.net/panel.php?go=export" target="_blank" rel="noreferrer">Export</a>, choose Anime List, then pick the downloaded file here. Works for private lists too.</p>
      </div>
      {status.connected && <div className="button-row">
        <Link className="button button--outline" to="/library#mal-list">View imported list</Link>
        <button type="button" className="text-button" disabled={busy}
          onClick={() => { if (window.confirm('Remove the imported MyAnimeList list from this profile? Your MyAnimeList account and Solanime history will not change.')) void remove(); }}>Remove imported list</button>
      </div>}
    </>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} {!status && <button className="text-button" disabled={busy} onClick={() => void refresh()}>Retry</button>}</p>}
  </section>;
}

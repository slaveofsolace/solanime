import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { ImportStatus } from '../types';
import { InlineNotice, PageIntro } from '../components/ui';

const SESSION_KEY = 'sol-anime:admin-token';
function readToken() {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}
function storeToken(value: string) {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, value);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* This session can still be used without persistence. */
  }
}

export default function AdminPage() {
  const [token, setToken] = useState(readToken);
  const [draftToken, setDraftToken] = useState(token);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refreshController = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async (activeToken = token) => {
      if (!activeToken) return;
      refreshController.current?.abort();
      const controller = new AbortController();
      refreshController.current = controller;
      setBusy(true);
      setError(null);
      try {
        const result = await api.importStatus(activeToken, controller.signal);
        if (!controller.signal.aborted) setStatus(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setStatus(null);
          setError(errorMessage(cause));
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (token) void refresh(token);
    return () => refreshController.current?.abort();
  }, [token, refresh]);

  const act = async (action: 'pause' | 'resume' | 'retry') => {
    const runId = status?.latestRun?.id;
    if (!runId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.importAction(runId, action, token);
      setMessage(
        action === 'retry'
          ? `${result.retried ?? 0} failed tasks queued for retry.`
          : `Run ${runId} ${action === 'pause' ? 'paused' : 'resumed'}.`,
      );
      await refresh(token);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  const createBackup = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.backup(token);
      setMessage(`Database backup created at ${result.path} (schema ${result.schemaVersion}).`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!token)
    return (
      <div className="admin-page">
        <PageIntro
          code="03 / RESTRICTED"
          title="Import diagnostics."
          copy="Administrative controls require the API token configured for this server."
        />
        <form
          className="admin-login"
          onSubmit={(event) => {
            event.preventDefault();
            const next = draftToken.trim();
            if (!next) return;
            storeToken(next);
            setToken(next);
          }}
        >
          <label>
            <span>Local admin token</span>
            <input
              type="password"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="button button--primary" type="submit">
            Open diagnostics
          </button>
        </form>
      </div>
    );

  return (
    <div className="admin-page">
      <PageIntro
        code="03 / RESTRICTED"
        title="Import diagnostics."
        copy="Queue progress, provider coverage, and exact failure states from the persistent local database."
        aside={
          <>
            <strong>{status?.counts.pendingTasks ?? '—'}</strong>
            <span>pending tasks</span>
          </>
        }
      />
      <div className="admin-toolbar">
        <button
          className="button button--outline"
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
        <button
          className="button button--outline"
          type="button"
          disabled={busy}
          onClick={() => void createBackup()}
        >
          Create backup
        </button>
        <button
          className="button button--outline"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const response = await fetch('/api/exports/coverage.csv', {
                headers: { 'x-admin-token': token },
              });
              if (!response.ok || !response.headers.get('content-type')?.includes('text/csv'))
                throw new Error('The coverage export could not be downloaded.');
              const url = URL.createObjectURL(await response.blob());
              const link = document.createElement('a');
              link.href = url;
              link.download = 'coverage.csv';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          Download coverage CSV
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            refreshController.current?.abort();
            storeToken('');
            setToken('');
            setDraftToken('');
            setStatus(null);
            setBusy(false);
            setMessage(null);
            setError(null);
          }}
        >
          Lock screen
        </button>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {message && <InlineNotice>{message}</InlineNotice>}
      {status && (
        <>
          <section className="admin-metrics" aria-label="Imported record counts">
            {Object.entries(status.counts).map(([label, value]) => (
              <div key={label}>
                <strong>{value.toLocaleString()}</strong>
                <span>{label.replace(/([A-Z])/g, ' $1')}</span>
              </div>
            ))}
          </section>
          <section className="admin-run">
            <header>
              <div>
                <p className="eyebrow">LATEST CRAWL RUN</p>
                <h2>
                  Run {status.latestRun?.id ?? '—'} / {status.latestRun?.status ?? 'none'}
                </h2>
              </div>
              <div className="admin-actions">
                <button
                  type="button"
                  disabled={busy || !status.latestRun}
                  onClick={() => void act('pause')}
                >
                  Pause
                </button>
                <button
                  type="button"
                  disabled={busy || !status.latestRun}
                  onClick={() => void act('resume')}
                >
                  Resume
                </button>
                <button
                  type="button"
                  disabled={busy || !status.latestRun}
                  onClick={() => void act('retry')}
                >
                  Retry failed
                </button>
              </div>
            </header>
            {status.latestRun && (
              <dl>
                <div>
                  <dt>Discovered tasks</dt>
                  <dd>{status.latestRun.tasks_discovered.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{status.latestRun.tasks_completed.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Failed / blocked</dt>
                  <dd>{status.latestRun.tasks_failed.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{new Date(status.latestRun.updated_at).toLocaleString()}</dd>
                </div>
              </dl>
            )}
          </section>
          <section className="admin-table-section">
            <p className="eyebrow">QUEUE BY STAGE</p>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Completed</th>
                    <th>Pending</th>
                    <th>Failed</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {status.taskStages.map((stage) => (
                    <tr key={stage.taskType}>
                      <th>{stage.taskType.replaceAll('_', ' ')}</th>
                      <td>{stage.completed.toLocaleString()}</td>
                      <td>{stage.pending.toLocaleString()}</td>
                      <td>{stage.failed.toLocaleString()}</td>
                      <td>{stage.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="admin-table-section">
            <p className="eyebrow">PROVIDER INVENTORY</p>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Identity</th>
                    <th>Adapter</th>
                    <th>Mode</th>
                    <th>Mappings</th>
                    <th>Last resolution</th>
                    <th>Playback verification</th>
                  </tr>
                </thead>
                <tbody>
                  {status.providers.map((provider) => (
                    <tr key={provider.id}>
                      <th>{provider.label}</th>
                      <td>{provider.identityState}</td>
                      <td>{provider.adapterState}</td>
                      <td>{provider.playbackType}</td>
                      <td>{provider.mappingCount.toLocaleString()}</td>
                      <td>
                        {provider.lastSuccessfulResolution
                          ? new Date(provider.lastSuccessfulResolution).toLocaleString()
                          : 'Never'}
                      </td>
                      <td>
                        {provider.lastPlaybackVerification
                          ? new Date(provider.lastPlaybackVerification).toLocaleString()
                          : 'Unverified'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="admin-errors">
            <p className="eyebrow">RECENT ERRORS</p>
            {status.recentErrors.length ? (
              <ol>
                {status.recentErrors.map((item) => (
                  <li key={item.id}>
                    <strong>{item.code}</strong>
                    <span>{item.taskKey}</span>
                    <p>{item.message}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No task errors recorded.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

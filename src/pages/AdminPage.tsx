import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { ImportStatus } from '../types';
import { InlineNotice, PageIntro } from '../components/ui';
import { Link } from 'react-router-dom';
import PendingApprovals from '../components/PendingApprovals';

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [draftToken, setDraftToken] = useState('');
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const authorizationGeneration = useRef(0);

  const refresh = useCallback(
    async (activeToken = token) => {
      if (!activeToken) return;
      refreshController.current?.abort();
      const controller = new AbortController();
      const generation = authorizationGeneration.current;
      refreshController.current = controller;
      setBusy(true);
      setError(null);
      try {
        const result = await api.importStatus(activeToken, controller.signal);
        if (!controller.signal.aborted && generation === authorizationGeneration.current)
          setStatus(result);
      } catch (cause) {
        if (!controller.signal.aborted && generation === authorizationGeneration.current) {
          setStatus(null);
          setError(errorMessage(cause));
        }
      } finally {
        if (!controller.signal.aborted && generation === authorizationGeneration.current)
          setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (token) void refresh(token);
    return () => refreshController.current?.abort();
  }, [token, refresh]);

  const act = async (action: 'pause' | 'resume' | 'retry') => {
    const runId =
      status?.runtime === 'cloudflare-workers'
        ? status.snapshot?.jobs[0]?.runId
        : status?.latestRun?.id;
    if (!runId) return;
    refreshController.current?.abort();
    const controller = new AbortController();
    const generation = authorizationGeneration.current;
    refreshController.current = controller;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.importAction(runId, action, token, controller.signal);
      if (controller.signal.aborted || generation !== authorizationGeneration.current) return;
      setMessage(
        action === 'retry'
          ? `${result.retried ?? 0} failed tasks queued for retry.`
          : `Run ${runId} ${action === 'pause' ? 'paused' : 'resumed'}.`,
      );
      await refresh(token);
    } catch (cause) {
      if (!controller.signal.aborted && generation === authorizationGeneration.current) {
        setError(errorMessage(cause));
        setBusy(false);
      }
    }
  };

  const createBackup = async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    const generation = authorizationGeneration.current;
    refreshController.current = controller;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.backup(token, controller.signal);
      if (controller.signal.aborted || generation !== authorizationGeneration.current) return;
      setMessage(`Database backup ${result.file} created (schema ${result.schemaVersion}).`);
    } catch (cause) {
      if (!controller.signal.aborted && generation === authorizationGeneration.current)
        setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted && generation === authorizationGeneration.current)
        setBusy(false);
    }
  };

  const startCloudImport = async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    const generation = authorizationGeneration.current;
    refreshController.current = controller;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.startCloudImport(token, controller.signal);
      if (controller.signal.aborted || generation !== authorizationGeneration.current) return;
      setMessage(
        result.job.created
          ? `Cloud snapshot ${result.job.id} was queued.`
          : `Cloud snapshot ${result.job.id} is already pinned; dispatch requested.`,
      );
      await refresh(token);
    } catch (cause) {
      if (!controller.signal.aborted && generation === authorizationGeneration.current) {
        setError(errorMessage(cause));
        setBusy(false);
      }
    }
  };

  const downloadCoverage = async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    const generation = authorizationGeneration.current;
    refreshController.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/exports/coverage.csv', {
        headers: { 'x-admin-token': token },
        signal: controller.signal,
      });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/csv'))
        throw new Error('The coverage export could not be downloaded.');
      const blob = await response.blob();
      if (controller.signal.aborted || generation !== authorizationGeneration.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'coverage.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!controller.signal.aborted && generation === authorizationGeneration.current)
        setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted && generation === authorizationGeneration.current)
        setBusy(false);
    }
  };

  const cloud = status?.runtime === 'cloudflare-workers';
  const snapshotJobs = status?.snapshot?.jobs ?? [];
  const activeRunId = cloud ? snapshotJobs[0]?.runId : status?.latestRun?.id;
  const dispatchPaused = cloud && status?.dispatchAllowance?.status === 'quota_paused';
  const dispatchRetryAt = status?.dispatchAllowance?.retryAt;

  const formatUtc = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : `${date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`;
  };

  if (!token)
    return (
      <div className="admin-page">
        <PageIntro
          code="03 / RESTRICTED"
          title="Operator console."
          copy="Review account requests and import health. Administrative controls require the operator token configured for this server."
        />
        <form
          className="admin-login"
          onSubmit={(event) => {
            event.preventDefault();
            const next = draftToken.trim();
            if (!next) return;
            authorizationGeneration.current += 1;
            setToken(next);
            setDraftToken('');
          }}
        >
          <label>
            <span>Operator token</span>
            <input
              type="password"
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              autoComplete="off"
            />
            <small>Kept only in memory until this screen is locked or reloaded.</small>
          </label>
          <button className="button button--primary" type="submit">
            Open console
          </button>
        </form>
      </div>
    );

  return (
    <div className="admin-page">
      <PageIntro
        code="03 / RESTRICTED"
        title="Operator console."
        copy={
          cloud
            ? 'Account requests, snapshot progress, provider coverage, and Cloudflare import capacity.'
            : 'Account requests, queue progress, provider coverage, and import failures.'
        }
        aside={
          <>
            <strong>{status?.counts.pendingTasks ?? 'None'}</strong>
            <span>pending tasks</span>
          </>
        }
      />
      <div className="admin-toolbar">
        <Link className="button button--outline" to="/admin/sources">
          Source research
        </Link>
        <button
          className="button button--outline"
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
        {status && !cloud && (
          <button
            className="button button--outline"
            type="button"
            disabled={busy}
            onClick={() => void createBackup()}
          >
            Create backup
          </button>
        )}
        {cloud && snapshotJobs.length === 0 && (
          <button
            className="button button--primary"
            type="button"
            disabled={busy || status?.syncEnabled !== true || dispatchPaused}
            onClick={() => void startCloudImport()}
          >
            Start cloud import
          </button>
        )}
        <button
          className="button button--outline"
          type="button"
          disabled={busy}
          onClick={() => void downloadCoverage()}
        >
          Download coverage CSV
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            authorizationGeneration.current += 1;
            refreshController.current?.abort();
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
      <PendingApprovals token={token} />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {message && <InlineNotice>{message}</InlineNotice>}
      {cloud && (
        <InlineNotice tone={status?.syncEnabled ? 'quiet' : 'warning'}>
          Cloud synchronization is {status?.syncEnabled ? 'enabled' : 'disabled'}; source refresh is{' '}
          {status?.sourceRefreshEnabled ? 'enabled' : 'disabled'}. Cloud database backups are an
          operator CLI task: export CATALOGUE, ACCOUNTS, and RESEARCH with{' '}
          <code>wrangler d1 export &lt;binding&gt; --remote</code>.
        </InlineNotice>
      )}
      {dispatchPaused && status?.dispatchAllowance && (
        <InlineNotice tone="warning">
          Daily import dispatch is paused to preserve the hosted write allowance. New batches may
          resume {dispatchRetryAt ? `after ${formatUtc(dispatchRetryAt)}` : 'in the next UTC allowance window'}.
          The dispatcher requires at least{' '}
          {status.dispatchAllowance.minimumHeadroom.writtenRows.toLocaleString()} writable rows and{' '}
          {status.dispatchAllowance.minimumHeadroom.queueOperations.toLocaleString()} queue operations
          of headroom before it starts more work.
        </InlineNotice>
      )}
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
          {cloud && status.cloudBudget && (
            <section className="admin-run" aria-labelledby="cloud-budget-title">
              <header>
                <div>
                  <p className="eyebrow">CLOUD IMPORT ALLOWANCE</p>
                  <h2 id="cloud-budget-title">Daily write and queue budget</h2>
                </div>
                <span>{status.cloudBudget.day}</span>
              </header>
              <dl>
                <div>
                  <dt>Rows reserved</dt>
                  <dd>
                    {status.cloudBudget.writtenRowsReserved.toLocaleString()} /{' '}
                    {status.cloudBudget.limits.dailyWrittenRows.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>Queue operations</dt>
                  <dd>
                    {status.cloudBudget.queueOperationsReserved.toLocaleString()} /{' '}
                    {status.cloudBudget.limits.dailyQueueOperations.toLocaleString()}
                  </dd>
                </div>
              </dl>
              <p>{status.cloudBudget.accountScope}</p>
            </section>
          )}
          {cloud && snapshotJobs.length > 0 && (
            <section className="admin-table-section" aria-labelledby="snapshot-jobs-title">
              <p className="eyebrow" id="snapshot-jobs-title">
                PINNED SNAPSHOT IMPORT
              </p>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Snapshot / run</th>
                      <th>Status</th>
                      <th>Progress</th>
                      <th>Rows</th>
                      <th>Next attempt</th>
                      <th>Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshotJobs.map((job) => (
                      <tr key={job.id}>
                        <th>
                          {job.id} / {job.runId}
                        </th>
                        <td>{job.status}</td>
                        <td>
                          <progress
                            aria-label={`Snapshot ${job.id} imported batches`}
                            max={Math.max(1, job.totalBatches)}
                            value={Math.min(job.importedBatches, job.totalBatches)}
                          />{' '}
                          {job.importedBatches.toLocaleString()} / {job.totalBatches.toLocaleString()}
                        </td>
                        <td>{job.totalRows.toLocaleString()}</td>
                        <td>
                          {dispatchPaused && dispatchRetryAt
                            ? `Quota resumes ${formatUtc(dispatchRetryAt)}`
                            : job.availableAt
                              ? new Date(job.availableAt).toLocaleString()
                              : 'Now'}
                        </td>
                        <td>
                          {job.errorCode
                            ? `${job.errorCode}: ${job.errorMessage ?? 'No detail supplied'}`
                            : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="admin-run">
            <header>
              <div>
                <p className="eyebrow">LATEST CRAWL RUN</p>
                <h2>
                  Run {activeRunId ?? 'none'} /{' '}
                  {cloud ? snapshotJobs[0]?.status ?? 'none' : status.latestRun?.status ?? 'none'}
                </h2>
              </div>
              <div className="admin-actions">
                <button
                  type="button"
                  disabled={busy || !activeRunId}
                  onClick={() => void act('pause')}
                >
                  Pause
                </button>
                <button
                  type="button"
                  disabled={busy || !activeRunId || Boolean(dispatchPaused)}
                  onClick={() => void act('resume')}
                >
                  Resume
                </button>
                <button
                  type="button"
                  disabled={busy || !activeRunId || Boolean(dispatchPaused)}
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

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ORIGINS = ['https://cloud-release.solanime.pages.dev', 'https://solanime.pages.dev'];
const SOURCE_IDS = {
  'internet-archive': { sourceId: 'site-f1023afdb569da2f', mappingId: 121117 },
  'wikimedia-commons': { sourceId: 'site-43817f8d8c7ba5ba', mappingId: 121118 },
};
const FRAGMENT_SOURCE = 'site-3e3ad23e7b4de183';
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function allowedCloudOrigin(value) { return ORIGINS.includes(value); }
export function redactReceipt(value, secret = '') {
  if (typeof value === 'string') return secret ? value.replaceAll(secret, '[redacted]') : value;
  if (Array.isArray(value)) return value.map(item => redactReceipt(item, secret));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(?:authorization|cookie|set-cookie|token|accessToken|refreshToken|idToken|credential|password|evidence|payload|content|rawBody)$/i.test(key) ? '[redacted]' : redactReceipt(item, secret),
  ]));
}

class VerificationFailure extends Error {
  constructor(check, reason, httpStatus = null) { super(reason); this.check = check; this.reason = reason; this.httpStatus = httpStatus; }
}
const assert = (condition, check, reason) => { if (!condition) throw new VerificationFailure(check, reason); };

export async function boundedJson(response, maximum = 512_000) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel(); throw new VerificationFailure('json_response', 'non_json_response', response.status);
  }
  const length = Number(response.headers.get('content-length'));
  if (length > maximum) { await response.body?.cancel(); throw new VerificationFailure('json_response', 'response_too_large', response.status); }
  const reader = response.body?.getReader();
  if (!reader) throw new VerificationFailure('json_response', 'missing_response_body', response.status);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new VerificationFailure('json_response', 'response_too_large', response.status); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw new VerificationFailure('json_response', 'invalid_json', response.status); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new VerificationFailure('json_response', 'invalid_json_shape', response.status);
  return value;
}

export function snapshotState(status, expected) {
  const jobs = status.snapshot?.jobs;
  assert(Array.isArray(jobs) && jobs.length === 1, 'snapshot_identity', 'unrecognized_snapshot_inventory');
  const job = jobs[0];
  assert(job.runId === expected.runId && job.taskId === expected.runId && job.totalBatches === expected.totalBatches && job.importedBatches === expected.cursor && job.id === expected.snapshotId, 'snapshot_identity', 'unrecognized_snapshot_or_cursor');
  // A separately requested metadata refresh can be the newest run without
  // changing this pinned snapshot. Older deployments expose only latestRun.
  const runStatus = Object.hasOwn(job, 'runStatus') ? job.runStatus : status.latestRun?.id === expected.runId ? status.latestRun.status : null;
  assert(['queued', 'running', 'paused'].includes(runStatus), 'snapshot_identity', 'unrecognized_or_terminal_run');
  assert(['pending', 'retry'].includes(job.status) && !job.errorCode, 'snapshot_identity', 'snapshot_failed_or_currently_leased');
  return { id: job.id, runId: job.runId, taskId: job.taskId, totalBatches: job.totalBatches, importedBatches: job.importedBatches, taskStatus: job.status, availableAt: job.availableAt, errorCode: job.errorCode, runStatus };
}
const taskSignature = state => JSON.stringify([state.id, state.runId, state.taskId, state.totalBatches, state.importedBatches, state.taskStatus, state.availableAt, state.errorCode]);

/** Reversible controls only. No start/import/dispatch or quota changes are accepted here. */
export async function exerciseSnapshotControls(api, initial, expected) {
  const result = { initialGlobalEnabled: initial.enabled, restoredGlobalEnabled: false, activeRunRestored: false, cursorPreserved: false };
  let mutationAttempted = false;
  let failure;
  const assertSame = status => {
    const state = snapshotState(status, expected);
    assert(taskSignature(state) === taskSignature(initial.snapshot), 'control_cursor', 'durable_snapshot_changed');
    return state;
  };
  try {
    mutationAttempted = true;
    await api('/api/admin/sync/control', 'disable_dispatch', { method: 'POST', body: { enabled: false } });
    const disabled = await api('/api/admin/sync/status', 'disabled_control');
    assert(disabled.control?.enabled === 0, 'pause_resume', 'global_dispatch_not_disabled');
    await api(`/api/admin/import/${expected.runId}/pause`, 'pause_snapshot', { method: 'POST', body: {} });
    const paused = assertSame(await api('/api/admin/import/status', 'paused_snapshot'));
    assert(paused.runStatus === 'paused', 'pause_resume', 'run_did_not_pause');
    result.pausedRunStatus = paused.runStatus;
    await api(`/api/admin/import/${expected.runId}/resume`, 'resume_snapshot', { method: 'POST', body: {} });
    const resumed = assertSame(await api('/api/admin/import/status', 'resumed_snapshot'));
    assert(resumed.runStatus === 'queued', 'pause_resume', 'run_did_not_resume');
    result.resumedRunStatus = resumed.runStatus;
    result.activeRunRestored = true;
    result.cursorPreserved = true;
  } catch (error) { failure = error; }
  finally {
    if (mutationAttempted) {
      try {
        const current = assertSame(await api('/api/admin/import/status', 'cleanup_snapshot'));
        if (current.runStatus === 'paused') await api(`/api/admin/import/${expected.runId}/resume`, 'cleanup_resume', { method: 'POST', body: {} });
        result.activeRunRestored = ['queued', 'running', 'paused'].includes(current.runStatus);
      } catch (error) { failure ??= error; }
      // Restore the original operator switch even if an assertion or request failed.
      try {
        await api('/api/admin/sync/control', 'restore_dispatch_control', { method: 'POST', body: { enabled: initial.enabled } });
        const restored = await api('/api/admin/sync/status', 'restored_control');
        result.restoredGlobalEnabled = restored.control?.enabled === (initial.enabled ? 1 : 0);
        assert(result.restoredGlobalEnabled, 'cleanup', 'global_control_restore_failed');
      } catch (error) { failure ??= error; }
    }
  }
  if (failure) { failure.controlReceipt = result; throw failure; }
  return result;
}

export async function verifyCloudRuntime(options) {
  const receipt = { version: 1, startedAt: new Date().toISOString(), origin: allowedCloudOrigin(options.origin) ? options.origin : null, status: 'blocked', checks: {}, requests: [] };
  let requests = 0;
  try {
    assert(allowedCloudOrigin(options.origin), 'configuration', 'unreviewed_origin');
    assert(typeof options.token === 'string' && options.token.length >= 32, 'configuration', 'operator_auth_unavailable');
    assert(/^\/__private-import\/[a-f0-9]{64}\/manifest\.json$/.test(options.privateManifestPath), 'configuration', 'invalid_private_asset_pin');
    const expected = { runId: options.expectedRunId ?? 1000000001, cursor: options.expectedCursor ?? 111, totalBatches: options.expectedTotalBatches ?? 28364, snapshotId: options.privateManifestPath.split('/')[2] };
    const fetcher = options.fetchImpl ?? fetch;
    const api = async (path, check, init = {}) => {
      assert(++requests <= 80, 'request_budget', 'bounded_request_limit');
      assert(path.startsWith('/') && !path.startsWith('//') && new URL(path, options.origin).origin === options.origin, 'request_destination', 'invalid_destination');
      if (options.requestDelayMs !== 0) await delay(options.requestDelayMs ?? 150);
      const started = Date.now();
      const response = await fetcher(options.origin + path, {
        method: init.method ?? 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
        headers: { Accept: 'application/json', ...(init.authorized === false ? {} : { 'x-admin-token': options.token }), ...(init.method === 'POST' ? { Origin: options.origin, 'Content-Type': 'application/json' } : {}) },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      receipt.requests.push({ check, method: init.method ?? 'GET', status: response.status, elapsedMs: Date.now() - started });
      if (response.status !== (init.expectedStatus ?? 200)) {
        await response.body?.cancel(); throw new VerificationFailure(check, 'unexpected_http_status', response.status);
      }
      if (init.discardBody) { await response.body?.cancel(); return { status: response.status }; }
      return boundedJson(response);
    };

    const health = await api('/api/health', 'health', { authorized: false });
    assert(health.status === 'ok' && health.runtime === 'cloudflare-workers' && health.database === 'connected' && health.schemaVersion >= 11 && health.titles > 0, 'health', 'incorrect_deployed_backend');
    receipt.checks.health = { status: health.status, runtime: health.runtime, schemaVersion: health.schemaVersion, titles: health.titles, release: /^[a-z0-9._-]{1,50}$/i.test(health.release) ? health.release : '[unrecognized]' };
    await api('/api/admin/sources?pageSize=1', 'unauthorized_admin', { authorized: false, expectedStatus: 401 });
    receipt.checks.unauthorizedAdmin = { status: 401 };
    await api(options.privateManifestPath, 'private_asset_manifest', { authorized: false, expectedStatus: 404, discardBody: true });
    await api('/__private-import/', 'private_asset_prefix', { authorized: false, expectedStatus: 404, discardBody: true });
    receipt.checks.privateAssets = { manifest: 404, prefix: 404, responseBodiesRetained: false };

    const initialStatus = await api('/api/admin/import/status', 'initial_import_status');
    const initialSync = await api('/api/admin/sync/status', 'initial_sync_status');
    const initialSnapshot = snapshotState(initialStatus, expected);
    assert(['queued', 'running'].includes(initialSnapshot.runStatus), 'snapshot_identity', 'run_is_operator_paused');
    const allowance = initialStatus.dispatchAllowance;
    const quota = initialStatus.cloudBudget;
    assert(allowance?.status === 'quota_paused' && quota?.limits?.dailyWrittenRows === 75000 && quota.limits.dailyQueueOperations === 2500, 'quota_status', 'not_expected_quota_paused_state');
    const retryAt = Date.parse(allowance.retryAt);
    const nextDay = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString();
    assert(allowance.retryAt === nextDay && retryAt > Date.now() + 120_000, 'quota_status', 'quota_window_changed_or_near_rollover');
    assert([0, 1].includes(initialSync.control?.enabled), 'control_state', 'unrecognized_global_control');
    receipt.checks.snapshot = { ...initialSnapshot, dispatchStatus: allowance.status, retryAt: allowance.retryAt, writtenRowsReserved: quota.writtenRowsReserved, dailyWriteBudget: quota.limits.dailyWrittenRows, initialGlobalEnabled: initialSync.control.enabled === 1 };

    const ids = new Set(); let total = null; let pageCount = null;
    for (let page = 1; page <= 18; page++) {
      const listing = await api(`/api/admin/sources?kind=site&pageSize=100&page=${page}`, `research_page_${page}`);
      assert(listing.total === 1667 && listing.page === page && listing.pageSize === 100 && listing.pages === 17 && Array.isArray(listing.items), 'research_pagination', 'unexpected_site_inventory');
      total = listing.total; pageCount = listing.pages;
      assert(listing.items.length === (page < 17 ? 100 : page === 17 ? 67 : 0), 'research_pagination', 'pagination_gap_or_non_exhaustion');
      for (const item of listing.items) {
        assert(/^site-[a-f0-9]{16}$/.test(item.id) && item.kind === 'site' && item.collection === 'sites' && !ids.has(item.id), 'research_pagination', 'duplicate_or_noncanonical_site');
        ids.add(item.id);
      }
    }
    assert(ids.size === total, 'research_pagination', 'site_count_mismatch');
    receipt.checks.researchSites = { total, pages: pageCount, distinctSites: ids.size, exhaustionPage: 18, sortedIdentitySha256: sha256([...ids].sort().join('\n')) };
    const researchCoverage = await api('/api/admin/sources/coverage', 'research_coverage');
    assert(researchCoverage.collections?.some(row => row.collection === 'sites' && row.kind === 'site' && row.count === 1667), 'research_coverage', 'collection_count_mismatch');

    const source = await api(`/api/admin/sources/${FRAGMENT_SOURCE}`, 'fragment_source');
    assert(source.source?.id === FRAGMENT_SOURCE && source.evidence?.fragmented === true && source.evidence.fragments === 3, 'research_fragments', 'unexpected_fragment_descriptor');
    const fragments = await api(`/api/admin/sources/${FRAGMENT_SOURCE}/evidence?offset=0`, 'evidence_fragments');
    assert(Array.isArray(fragments.items) && fragments.items.length === 3 && fragments.items.every((item, index) => item.fragmentIndex === index && typeof item.content === 'string' && Buffer.byteLength(item.content) <= 24000) && fragments.nextOffset === null, 'research_fragments', 'fragment_bound_or_order_failure');
    const concatenated = fragments.items.map(item => item.content).join('');
    assert(Buffer.byteLength(concatenated) === source.evidence.byteLength && sha256(concatenated) === source.evidence.sha256, 'research_fragments', 'evidence_hash_mismatch');
    try { JSON.parse(concatenated); } catch { throw new VerificationFailure('research_fragments', 'reassembled_evidence_not_json'); }
    const exhausted = await api(`/api/admin/sources/${FRAGMENT_SOURCE}/evidence?offset=3`, 'evidence_exhaustion');
    assert(Array.isArray(exhausted.items) && exhausted.items.length === 0 && exhausted.nextOffset === null, 'research_fragments', 'fragment_exhaustion_failed');
    receipt.checks.fragments = { sourceId: FRAGMENT_SOURCE, fragments: 3, responseLimit: 4, byteLength: source.evidence.byteLength, checksumMatched: true, parsedJson: true, evidenceContentRetained: false };

    const native = [];
    for (const [providerId, identity] of Object.entries(SOURCE_IDS)) {
      const record = await api(`/api/admin/sources/${identity.sourceId}`, `native_evidence_${providerId}`);
      assert(record.source?.id === identity.sourceId && record.source.kind === 'site', 'native_evidence', 'incorrect_canonical_provider_record');
      const capability = record.capabilities?.find(item => item.capability === 'playback');
      assert(capability?.implementationState === 'implemented' && capability.runtimeVerified === 1, 'native_evidence', 'native_capability_not_verified');
      let evidence;
      try { evidence = JSON.parse(capability.evidence); } catch { throw new VerificationFailure('native_evidence', 'malformed_native_evidence'); }
      assert(evidence.providerId === providerId && evidence.mappingId === identity.mappingId && evidence.origin === options.origin && evidence.progressTo >= evidence.progressFrom + 1 && Math.abs(evidence.seekTo - evidence.seekFrom) >= 1 && evidence.duration > 0 && evidence.restoredTime <= evidence.duration && /This mapping only/.test(evidence.scope), 'native_evidence', 'mapping_specific_evidence_mismatch');
      native.push({ providerId, sourceId: identity.sourceId, mappingId: identity.mappingId, recordedOrigin: evidence.origin, observedAt: capability.updatedAt, progression: true, seeking: true, restoration: true, scope: 'Recorded evidence for this mapping only; this HTTP check does not play media.' });
    }
    receipt.checks.nativeCapabilities = native;

    const refresh = await api('/api/admin/sync/start', 'snapshot_refresh_barrier', { method: 'POST', body: {}, expectedStatus: 202 });
    assert(refresh.job?.status === 'snapshot_pending', 'refresh_barrier', 'source_refresh_did_not_wait');
    const afterRefresh = snapshotState(await api('/api/admin/import/status', 'after_refresh_barrier'), expected);
    assert(taskSignature(afterRefresh) === taskSignature(initialSnapshot), 'refresh_barrier', 'refresh_changed_snapshot');
    receipt.checks.refreshBarrier = { status: 202, result: 'snapshot_pending', cursorPreserved: true };

    if (options.exerciseControls) receipt.checks.controls = await exerciseSnapshotControls(api, { enabled: initialSync.control.enabled === 1, snapshot: initialSnapshot }, expected);
    else receipt.checks.controls = { status: 'not_requested', note: 'Pass --exercise-controls only with operator authorization for the bounded pause/resume test.' };
    const finalStatus = await api('/api/admin/import/status', 'final_import_status');
    const final = snapshotState(finalStatus, expected);
    assert(taskSignature(final) === taskSignature(initialSnapshot) && finalStatus.dispatchAllowance?.status === 'quota_paused', 'final_state', 'snapshot_or_quota_state_changed');
    receipt.checks.finalState = { runId: final.runId, taskId: final.taskId, importedBatches: final.importedBatches, totalBatches: final.totalBatches, taskStatus: final.taskStatus, runStatus: final.runStatus, dispatchStatus: finalStatus.dispatchAllowance.status, retryAt: finalStatus.dispatchAllowance.retryAt };
    receipt.status = 'passed';
  } catch (error) {
    receipt.failure = error instanceof VerificationFailure ? { check: error.check, reason: error.reason, httpStatus: error.httpStatus } : { check: 'runtime', reason: 'request_or_validation_failed', httpStatus: null };
    if (error?.controlReceipt) receipt.checks.controls = error.controlReceipt;
  }
  receipt.finishedAt = new Date().toISOString();
  receipt.requestCount = requests;
  return redactReceipt(receipt, options.token);
}

async function main() {
  const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const output = option('out');
  if (!output || !existsSync(dirname(resolve(output))) || existsSync(resolve(output))) throw new Error('Choose a fresh receipt path in an existing private artifact directory.');
  const configuration = readFileSync(resolve(import.meta.dirname, '../wrangler.jsonc'), 'utf8');
  const privateManifestPath = /"IMPORT_MANIFEST_PATH"\s*:\s*"([^"\\]+)"/.exec(configuration)?.[1];
  const receipt = await verifyCloudRuntime({ origin: option('origin'), token: process.env.SOLANIME_ADMIN_TOKEN, privateManifestPath, exerciseControls: process.argv.includes('--exercise-controls') });
  writeFileSync(resolve(output), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

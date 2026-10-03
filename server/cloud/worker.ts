import { RELEASE } from '../../shared/release.ts';
import { timingSafeEqual } from 'node:crypto';
import { AppError, asAppError } from '../errors.ts';
import { createCloudAccounts } from './auth/index.ts';
import { D1AccountsRepository } from './auth/repository.ts';
import { sendApprovalNotice } from './auth/notifications.ts';
import { createCatalogueRepository } from './data/catalogue.ts';
import { cloudExploreCatalogue } from '../explore/catalogue.ts';
import { createPrivateBaselineReader } from './data/baseline.ts';
import { createResearchRepository } from './data/research.ts';
import { applyImportBatch, validateImportBatch } from './data/import.ts';
import { getWriteBudget, QuotaExhaustedError, reserveWriteBudget } from './data/budget.ts';
import { dispatchSyncTasks, consumeSyncMessage, createSyncRepository } from './data/sync.ts';
import { createAnikotoSyncHandlers } from './data/anikoto-sync.ts';
import { createAnikotoRefreshRepository } from './data/anikoto-refresh.ts';
import { createSnapshotImportHandlers, createSnapshotImportRepository } from './data/snapshot.ts';
import { legacyResolution, type ApprovedNativeResource } from '../providers/native.ts';
import {
  hasEnabledNativeResource,
  hasEnabledOfficialYouTubeResource,
  resolveApprovedPlayback,
  NATIVE_RESEARCH_RECORDS,
} from '../providers/native-registry.ts';
import { providerSupportDiagnostic } from '../providers/support-diagnostics.ts';
import { hasSupportedMegaPlayEmbed } from '../providers/embed.ts';
import { enforcePlaybackResolution } from '../providers/playbackPolicy.ts';
import { createArtworkSyncHandlers, startCloudArtworkRefresh } from '../artwork/cloud.ts';

const apiHeaders = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY',
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...apiHeaders, ...headers } });
const number = (value: string | null, fallback: number, max = 100_000) => {
  if (value === null || value === '') return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) throw new AppError(400, 'INVALID_QUERY', 'A positive integer is required within the supported range.');
  return Number(value);
};
const bounded = (value: string | null) => {
  if (value && (value.length > 200 || /[\x00-\x1f\x7f]/.test(value))) throw new AppError(400, 'INVALID_QUERY', 'The query is too long or contains control characters.');
  return value || undefined;
};
async function body(request: Request, max = 16_384): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AppError(415, 'BAD_REQUEST', 'Use application/json.');
  const reader = request.body?.getReader(); if (!reader) return {};
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > max) { await reader.cancel(); throw new AppError(413, 'BAD_REQUEST', 'Request body is too large.'); } chunks.push(item.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new AppError(400, 'BAD_REQUEST', 'Expected a JSON object.'); }
}
function sameOrigin(request: Request, env: CloudEnv) {
  const origin = request.headers.get('origin');
  const allowed = [env.SOLANIME_APP_ORIGIN, ...env.SOLANIME_ALLOWED_ORIGINS.split(',').map(s => s.trim())];
  if (!origin || !allowed.includes(origin) || origin !== new URL(request.url).origin || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) throw new AppError(403, 'UNAUTHORIZED', 'Cross-origin mutations are not accepted.');
}
async function admin(request: Request, env: CloudEnv) {
  if (!env.SOLANIME_ADMIN_TOKEN || env.SOLANIME_ADMIN_TOKEN.length < 32) throw new AppError(503, 'ADMIN_UNCONFIGURED', 'Operator access is not configured.');
  const candidate = request.headers.get('x-admin-token') ?? '';
  const [expected, supplied] = await Promise.all([env.SOLANIME_ADMIN_TOKEN, candidate].map(value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
  if (!timingSafeEqual(new Uint8Array(expected), new Uint8Array(supplied))) throw new AppError(401, 'UNAUTHORIZED', 'A valid operator token is required.');
}
const budgetFor = (env: CloudEnv) => ({ dailyWrittenRows: number(env.SYNC_DAILY_WRITE_BUDGET, 75_000, 80_000), dailyQueueOperations: number(env.SYNC_DAILY_QUEUE_BUDGET, 2500, 8000) });
const snapshotFor = (env: CloudEnv) => createSnapshotImportRepository(env.CATALOGUE, env.IMPORT_ASSETS, budgetFor(env));
export function configuredBaseline(request: Request, env: CloudEnv) {
  if (env.CATALOGUE_BASELINE_ENABLED !== 'true') return undefined;
  return createPrivateBaselineReader(env.IMPORT_ASSETS, {
    id: env.CATALOGUE_BASELINE_ID,
    manifestSha256: env.CATALOGUE_BASELINE_MANIFEST_SHA256,
  }, { signal: request.signal });
}
const sourceTaskTypes = ['catalogue_page', 'title_detail', 'sitemap_index', 'sitemap_page', 'sitemap_title', 'title_reconcile', 'episode_servers'];
type ReviewCloudEnv = CloudEnv & { SOLANIME_READ_ONLY_REVIEW?: string };
export const isReadOnlyReview = (env: CloudEnv) => (env as ReviewCloudEnv).SOLANIME_READ_ONLY_REVIEW === 'true';
// Either private-account flag must close the catalogue and require owner
// approval. A partially applied Worker configuration must not admit applicants.
export const requiresOwnerApproval = (env: CloudEnv) =>
  env.SOLANIME_PRIVATE_SITE === 'true' || env.SOLANIME_APPROVAL_REQUIRED === 'true';
export function isReadOnlyReviewRoute(method: string, path: string) {
  return (method === 'GET' && (
    path === '/api/health' ||
    path === '/api/meta/filters' ||
    path === '/api/titles' ||
    /^\/api\/titles\/[^/]+$/.test(path) ||
    /^\/api\/episodes\/\d+\/providers$/.test(path)
  )) || (method === 'POST' && /^\/api\/providers\/\d+\/resolve$/.test(path));
}
export function dispatchAllowance(usage: Awaited<ReturnType<typeof getWriteBudget>>, now = new Date()) {
  const minimumHeadroom = { writtenRows: 1500, queueOperations: 3 };
  const paused = usage.writtenRowsReserved + minimumHeadroom.writtenRows > usage.limits.dailyWrittenRows || usage.queueOperationsReserved + minimumHeadroom.queueOperations > usage.limits.dailyQueueOperations;
  return { status: paused ? 'quota_paused' : 'available', retryAt: paused ? new QuotaExhaustedError(now).retryAt : null, minimumHeadroom };
}
async function dispatch(env: CloudEnv, requestedTypes?: readonly string[]) {
  if (env.SYNC_ENABLED !== 'true') return { dispatched: 0, status: 'disabled' };
  const budget = budgetFor(env);
  const usage = await getWriteBudget(env.CATALOGUE, budget);
  const allowance = dispatchAllowance(usage);
  if (allowance.status === 'quota_paused') return { dispatched: 0, ...allowance };
  // Finish the pinned snapshot before source refresh: historical numeric IDs must
  // settle before newly discovered rows are allocated in the high-ID range.
  const snapshotPending = requestedTypes ? null : await env.CATALOGUE.prepare("SELECT 1 FROM cloud_snapshot_jobs j JOIN crawl_tasks t ON t.id=j.task_id WHERE t.status<>'completed' LIMIT 1").first();
  // Explicitly reviewed artwork does not allocate or retarget catalogue IDs and
  // may refresh alongside the snapshot; unmatched titles are never auto-enqueued.
  const types = requestedTypes ?? (env.SOURCE_REFRESH_ENABLED === 'true' && !snapshotPending ? ['snapshot_import', 'artwork_refresh', ...sourceTaskTypes] : ['snapshot_import', 'artwork_refresh']);
  return dispatchSyncTasks(env.CATALOGUE, env.SYNC_QUEUE, budget, 1, new Date(), types);
}

export async function handleCloudRequest(request: Request, env: CloudEnv): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const p = url.searchParams;
  try {
    if (url.href.length > 4096) throw new AppError(414, 'INVALID_QUERY', 'The request URL is too long.');
    const readOnlyReview = isReadOnlyReview(env);
    if (readOnlyReview && !isReadOnlyReviewRoute(request.method, path)) return json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }, 404);
    if (!(await env.API_LIMITER.limit({ key: `api:${request.headers.get('cf-connecting-ip') ?? 'unknown'}` })).success) return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } }, 429, { 'Retry-After': '60' });
    const baseline = configuredBaseline(request, env);
    const catalogue = createCatalogueRepository(env.CATALOGUE, baseline);
    const privateSite = requiresOwnerApproval(env);
    const accounts = createCloudAccounts(env.ACCOUNTS.withSession('first-primary'), {
      origin: env.SOLANIME_APP_ORIGIN, allowedOrigins: env.SOLANIME_ALLOWED_ORIGINS.split(',').filter(Boolean),
      registration: env.SOLANIME_REGISTRATION === 'open', credentialKey: env.AUTH_CREDENTIAL_KEY,
      approvalRequired: privateSite,
      privateSite,
      notifyApproval: (kind, account) => sendApprovalNotice(kind, account, env.SOLANIME_APP_ORIGIN),
      firebase: { apiKey: env.FIREBASE_API_KEY, projectId: env.FIREBASE_PROJECT_ID, serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON },
      mal: { clientId: env.MAL_CLIENT_ID },
      episodeExists: catalogue.hasEpisode,
      explore: cloudExploreCatalogue(env.CATALOGUE, baseline, env.CATALOGUE_BASELINE_ENABLED === 'true' ? { id: env.CATALOGUE_BASELINE_ID, manifestSha256: env.CATALOGUE_BASELINE_MANIFEST_SHA256 } : undefined),
    });
    const accountResponse = await accounts.handle(request); if (accountResponse) return accountResponse;
    const research = createResearchRepository(env.RESEARCH);
    if (path.startsWith('/api/admin/') || path.startsWith('/api/exports/')) await admin(request, env);
    if (request.method === 'POST') sameOrigin(request, env);
    if (request.method === 'GET' && path === '/api/health') {
      const migration = await env.CATALOGUE.prepare('SELECT COUNT(*) AS count FROM d1_migrations').first<{ count: number }>();
      return json({ status: 'ok', release: RELEASE, runtime: 'cloudflare-workers', channel: env.RELEASE_CHANNEL, database: 'connected', schemaVersion: migration?.count ?? 0, titles: await catalogue.titleCount(), now: new Date().toISOString() });
    }
    if (request.method === 'GET' && path === '/api/admin/accounts/pending')
      return json({ items: await accounts.pendingApprovals() });
    const approval = /^\/api\/admin\/accounts\/([\w-]{1,128})\/(decision|retry-notice)$/.exec(path);
    if (request.method === 'POST' && approval) {
      const input = await body(request);
      if (approval[2] === 'retry-notice') return json(await accounts.retryNotice(approval[1]));
      if (input.decision !== 'approved' && input.decision !== 'rejected')
        throw new AppError(400, 'BAD_REQUEST', 'Choose approved or rejected.');
      return json(await accounts.decideApproval(approval[1], input.decision));
    }
    if (privateSite && !path.startsWith('/api/admin/') && !path.startsWith('/api/exports/'))
      await accounts.authorize(request);
    if (request.method === 'GET' && path === '/api/titles') return json(await catalogue.browseTitles({ q: bounded(p.get('q'))?.trim(), scope: bounded(p.get('scope')), genre: bounded(p.get('genre')), type: bounded(p.get('type')), status: bounded(p.get('status')), language: bounded(p.get('language')), page: number(p.get('page'), 1), pageSize: number(p.get('pageSize'), 24, 100), sort: bounded(p.get('sort')) ?? 'name', includeFacets: p.get('facets') !== 'false' }));
    if (request.method === 'GET' && path === '/api/meta/filters') return json(await catalogue.getFilters());
    const title = /^\/api\/titles\/([^/]+)$/.exec(path);
    if (request.method === 'GET' && title) { let slug: string; try { slug = decodeURIComponent(title[1]); } catch { throw new AppError(400, 'BAD_REQUEST', 'Invalid title encoding.'); } return json(await catalogue.getTitle(bounded(slug) ?? '')); }
    const episodes = /^\/api\/episodes\/(\d+)\/providers$/.exec(path);
    if (request.method === 'GET' && episodes) {
      const result = await catalogue.getEpisodeProviders(number(episodes[1], 0, Number.MAX_SAFE_INTEGER), bounded(p.get('language')));
      return json({ ...result, providers: await Promise.all(result.providers.map(async provider => {
        const mapping = await catalogue.getMapping(Number(provider.mappingId));
        const resource = await catalogue.getApprovedResource(mapping.mappingId);
        const native = hasEnabledNativeResource(mapping, resource);
        const officialYouTube = hasEnabledOfficialYouTubeResource(mapping, resource);
        const supportedEmbed = hasSupportedMegaPlayEmbed(mapping);
        const diagnostic = providerSupportDiagnostic({
          providerId: String((provider as { providerId?: unknown }).providerId ?? ''),
        });
        const embedObserved = !native && !officialYouTube && diagnostic.state === 'documented-embed-only';
        return {
          ...provider,
          supported: native || officialYouTube || supportedEmbed,
          kind: officialYouTube ? 'official-youtube' : native ? 'native' : supportedEmbed ? 'embed' : 'unsupported',
          playbackType: native ? 'direct' : officialYouTube || supportedEmbed || embedObserved ? 'iframe' : 'unknown',
          status: native || officialYouTube || supportedEmbed ? 'available' : 'unsupported',
          reason: native || officialYouTube || supportedEmbed ? null : diagnostic.message,
          reasonCode: native || officialYouTube || supportedEmbed ? null : diagnostic.code,
          capabilities: native || officialYouTube || supportedEmbed
            ? {
                seek: !supportedEmbed,
                volume: !supportedEmbed,
                fullscreen: true,
                progressEvents: true,
                subtitles: officialYouTube,
                qualitySelection: officialYouTube,
              }
            : {},
          requiresGuard: false,
        };
      })) });
    }
    const resolve = /^\/api\/providers\/(\d+)\/resolve$/.exec(path);
    if (request.method === 'POST' && resolve) {
      if (!(await env.RESOLVE_LIMITER.limit({ key: 'resolve:' + (request.headers.get('cf-connecting-ip') ?? 'unknown') })).success) return json({ error: { code: 'RATE_LIMITED', message: 'Wait a moment before switching sources again.' } }, 429, { 'Retry-After': '60' });
      const input = await body(request); const mapping = await catalogue.getMapping(number(resolve[1], 0, Number.MAX_SAFE_INTEGER));
      if (input.language != null && input.language !== mapping.language) throw new AppError(400, 'BAD_REQUEST', 'Language does not match this mapping.');
      const resource = await catalogue.getApprovedResource(mapping.mappingId);
      const resolved = await resolveApprovedPlayback(mapping, resource, request.signal);
      const result = enforcePlaybackResolution(mapping, legacyResolution(resolved));
      // A resolution is not playback verification. Never store temporary media URLs.
      if (!readOnlyReview && result.status === 'resolved') await env.CATALOGUE.prepare("UPDATE episode_provider_mappings SET last_successful_resolution_at=?,resolution_evidence_state='resolved' WHERE id=?").bind(new Date().toISOString(), mapping.mappingId).run();
      return json({ ...result, mappingId: String(result.mappingId) }, result.status === 'resolved' ? 200 : 422);
    }
    if (request.method === 'GET' && path === '/api/admin/sources') return json(await research.browseSources({ q: bounded(p.get('q')), category: bounded(p.get('category')), kind: bounded(p.get('kind')), status: bounded(p.get('status')), page: number(p.get('page'), 1), pageSize: number(p.get('pageSize'), 30, 100) }));
    const verification = /^\/api\/admin\/providers\/(\d+)\/verification$/.exec(path);
    if (request.method === 'POST' && verification) {
      const input = await body(request);
      const mapping = await catalogue.getMapping(number(verification[1], 0, Number.MAX_SAFE_INTEGER));
      const resource = await env.CATALOGUE.prepare('SELECT * FROM native_resources WHERE mapping_id=?').bind(mapping.mappingId).first<ApprovedNativeResource>();
      const metrics = ['progressFrom', 'progressTo', 'duration', 'seekFrom', 'seekTo', 'restoredTime'] as const;
      if (!hasEnabledNativeResource(mapping, resource) || input.language !== mapping.language || typeof input.evidenceRef !== 'string' || !/^docs\/[a-zA-Z0-9_./#-]{1,180}$/.test(input.evidenceRef) || input.evidenceRef.includes('..') || metrics.some(key => typeof input[key] !== 'number' || !Number.isFinite(input[key]) || Number(input[key]) < 0)) throw new AppError(400, 'BAD_REQUEST', 'Supply a reviewed native mapping and bounded browser-observation metrics.');
      const value = input as Record<typeof metrics[number], number>;
      if (value.duration <= 0 || value.duration > 24 * 60 * 60 || value.progressTo < value.progressFrom + 1 || value.progressTo > value.duration || value.seekFrom > value.duration || value.seekTo > value.duration || Math.abs(value.seekTo - value.seekFrom) < 1 || value.restoredTime > value.duration) throw new AppError(400, 'BAD_REQUEST', 'The reported metrics do not demonstrate progression, seeking and restoration.');
      const now = new Date().toISOString();
      await reserveWriteBudget(env.CATALOGUE, `native-verification:${mapping.mappingId}:${crypto.randomUUID()}`, 48, 0, budgetFor(env));
      const details = JSON.stringify({ origin: url.origin, mappingId: mapping.mappingId, providerId: mapping.providerId, language: mapping.language, evidenceRef: input.evidenceRef, ...Object.fromEntries(metrics.map(key => [key, input[key]])), scope: 'This mapping only; operator-observed native browser playback, not an automatic HTTP success claim.' });
      await env.CATALOGUE.batch([
        env.CATALOGUE.prepare("INSERT INTO verification_observations(id,entity_type,entity_id,stage,result,evidence_class,details_json,observed_at) VALUES((SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM verification_observations),'mapping',?,'playback_verified','native_progression_seek_restore','operator_browser_observation',?,?)").bind(String(mapping.mappingId), details, now),
        env.CATALOGUE.prepare("UPDATE episode_provider_mappings SET last_playback_verification_at=?,resolution_evidence_state='playback_verified' WHERE id=?").bind(now, mapping.mappingId),
      ]);
      const researchId = NATIVE_RESEARCH_RECORDS[mapping.providerId];
      if (researchId) {
        // Cross-database evidence is idempotent, separate from the authoritative
        // catalogue observation. A partial source import must not invent a row.
        await env.RESEARCH.prepare("INSERT INTO research_capabilities(record_id,capability,implementation_state,runtime_verified,evidence_json,updated_at) SELECT id,'playback','implemented',1,?,? FROM research_records WHERE id=? ON CONFLICT(record_id,capability) DO UPDATE SET implementation_state=excluded.implementation_state,runtime_verified=excluded.runtime_verified,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at").bind(details, now, researchId).run();
      }
      return json({ mappingId: mapping.mappingId, stage: 'playback_verified', observedAt: now });
    }
    if (request.method === 'GET' && path === '/api/admin/sources/coverage') return json(await research.coverage());
    const source = /^\/api\/admin\/sources\/([^/]+)(?:\/(review|relationships|evidence))?$/.exec(path);
    if (source) {
      let id: string;
      try { id = decodeURIComponent(source[1]); } catch { throw new AppError(400, 'BAD_REQUEST', 'Invalid source encoding.'); }
      if (!bounded(id)) throw new AppError(400, 'BAD_REQUEST', 'Invalid source ID.');
      if (request.method === 'GET' && !source[2]) return json(await research.getSource(id));
      if (request.method === 'GET' && source[2] === 'relationships') return json(await research.relationships(id, bounded(p.get('after')) ?? '', number(p.get('limit'), 100, 100)));
      if (request.method === 'GET' && source[2] === 'evidence') {
        const offset = p.get('offset');
        return json(await research.evidenceFragments(id, offset === null || offset === '0' ? 0 : number(offset, 0, 100_000)));
      }
      if (request.method === 'POST' && source[2] === 'review') { const input = await body(request); if (typeof input.action !== 'string' || (input.note != null && typeof input.note !== 'string')) throw new AppError(400, 'BAD_REQUEST', 'Invalid review.'); return json(await research.reviewSource(id, input.action, 'operator', String(input.note ?? ''))); }
    }
    if (request.method === 'GET' && path === '/api/admin/import/status') {
      const cloudBudget = await getWriteBudget(env.CATALOGUE, budgetFor(env));
      return json({ ...await catalogue.adminStatus(), runtime: 'cloudflare-workers', backupMode: 'operator-cli', cloudBudget, dispatchAllowance: dispatchAllowance(cloudBudget), snapshot: await snapshotFor(env).status(), syncEnabled: env.SYNC_ENABLED === 'true', sourceRefreshEnabled: env.SOURCE_REFRESH_ENABLED === 'true' });
    }
    if (request.method === 'POST' && path === '/api/admin/import/start') {
      await body(request);
      if (env.SYNC_ENABLED !== 'true') throw new AppError(503, 'UNAVAILABLE', 'Cloud synchronization is disabled in this release configuration.');
      const job = await snapshotFor(env).ensure({ manifestPath: env.IMPORT_MANIFEST_PATH, manifestSha256: env.IMPORT_MANIFEST_SHA256 });
      await createSyncRepository(env.CATALOGUE).setEnabled(true);
      return json({ job, dispatch: await dispatch(env) });
    }
    if (request.method === 'POST' && path === '/api/admin/import/batch') {
      const batch = validateImportBatch(await body(request, 60_000));
      return json(await applyImportBatch(env.CATALOGUE, batch.target === 'catalogue' ? env.CATALOGUE : env.RESEARCH, batch, budgetFor(env)));
    }
    if (request.method === 'POST' && path === '/api/admin/import/dispatch') {
      if (env.SYNC_ENABLED !== 'true') throw new AppError(503, 'UNAVAILABLE', 'Cloud synchronization is disabled in this release configuration.');
      return json(await dispatch(env));
    }
    if (request.method === 'GET' && path === '/api/admin/sync/status') {
      const status = await createSyncRepository(env.CATALOGUE).status(budgetFor(env));
      return json({ ...status, dispatchAllowance: dispatchAllowance(status.budget) });
    }
    if (request.method === 'POST' && path === '/api/admin/artwork/refresh') {
      const input = await body(request);
      if (env.SYNC_ENABLED !== 'true') throw new AppError(503, 'UNAVAILABLE', 'Cloud synchronization is disabled in this release configuration.');
      const job = await startCloudArtworkRefresh(env.CATALOGUE, budgetFor(env), input);
      return json({ job, dispatch: ['queued','running'].includes(job.runStatus) ? await dispatch(env, ['artwork_refresh']) : { dispatched: 0, status: job.runStatus } }, 202);
    }
    if (request.method === 'POST' && path === '/api/admin/sync/start') {
      const input = await body(request);
      if (env.SYNC_ENABLED !== 'true' || env.SOURCE_REFRESH_ENABLED !== 'true') throw new AppError(503, 'UNAVAILABLE', 'Public-source refresh is disabled in this release configuration.');
      if ((input.key != null && typeof input.key !== 'string') || (input.includeProviders != null && typeof input.includeProviders !== 'boolean')) throw new AppError(400, 'BAD_REQUEST', 'Supply an optional stable refresh key and includeProviders boolean.');
      const job = await createAnikotoRefreshRepository(env.CATALOGUE, budgetFor(env)).ensure({ key: input.key as string | undefined, includeProviders: input.includeProviders as boolean | undefined });
      return json({ job, ...(job.status === 'snapshot_pending' ? { message: 'Source refresh waits for the pinned snapshot to finish. Existing import progress is preserved.' } : { dispatch: await dispatch(env) }) }, job.status === 'snapshot_pending' ? 202 : 200);
    }
    if (request.method === 'POST' && path === '/api/admin/sync/control') {
      const input = await body(request);
      if (typeof input.enabled !== 'boolean') throw new AppError(400, 'BAD_REQUEST', 'An enabled boolean is required.');
      return json(await createSyncRepository(env.CATALOGUE).setEnabled(input.enabled));
    }
    const run = /^\/api\/admin\/import\/(\d+)\/(pause|resume|retry)$/.exec(path);
    if (request.method === 'POST' && run) {
      const id = number(run[1], 0, Number.MAX_SAFE_INTEGER); const now = new Date().toISOString();
      if (run[2] === 'retry') {
        const input = await body(request);
        if (input.includeBlocked != null && typeof input.includeBlocked !== 'boolean') throw new AppError(400, 'BAD_REQUEST', 'includeBlocked must be an explicit boolean.');
        return json({ ...await createSyncRepository(env.CATALOGUE).retryRun(id, { limit: 100, includeBlocked: input.includeBlocked === true }, budgetFor(env)), batchLimit: 100 });
      }
      const status = run[2] === 'pause' ? 'paused' : 'queued';
      const update = await env.CATALOGUE.prepare("UPDATE crawl_runs SET status=?,updated_at=? WHERE id=? AND status IN ('queued','running','paused')").bind(status, now, id).run();
      if (!update.meta.changes) throw new AppError(404, 'NOT_FOUND', 'Active import run not found.'); return json({ runId: id, status });
    }
    if (request.method === 'GET' && path === '/api/exports/catalogue.json') return json(await catalogue.exportTitlesPage(p.get('after') ? number(p.get('after'), 0, Number.MAX_SAFE_INTEGER) : 0, number(p.get('limit'), 100, 100)));
    if (request.method === 'GET' && path === '/api/exports/catalogue.csv') {
      const page = await catalogue.exportTitlesPage(p.get('after') ? number(p.get('after'), 0, Number.MAX_SAFE_INTEGER) : 0, number(p.get('limit'), 100, 100));
      const columns = ['id', 'sourceId', 'slug', 'name', 'canonicalUrl', 'format', 'releaseYear', 'status', 'artworkUrl', 'artworkOrigin', 'artworkReuseStatus'];
      const cell = (value: unknown) => { const text = String(value ?? ''); return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'; };
      return new Response([columns.join(','), ...page.items.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n'), { headers: { ...apiHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'X-Export-Schema-Version': String(page.exportSchemaVersion), 'X-Next-Cursor': String(page.nextCursor ?? '') } });
    }
    if (request.method === 'GET' && path === '/api/exports/coverage.csv') {
      const status = await catalogue.adminStatus();
      const csv = 'metric,count\n' + Object.entries(status.counts).map(([key, value]) => `${key},${Number(value)}`).join('\n');
      return new Response(csv, { headers: { ...apiHeaders, 'Content-Type': 'text/csv; charset=utf-8' } });
    }
    return json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }, 404);
  } catch (error) {
    const problem = asAppError(error);
    const retry: Record<string, string> = error instanceof QuotaExhaustedError ? { 'Retry-After': String(Math.max(1, Math.ceil((Date.parse(error.retryAt) - Date.now()) / 1000))) } : {};
    if (problem.status >= 500) console.error(JSON.stringify({ event: 'api_error', code: problem.code }));
    return json({ error: { code: problem.code, message: problem.message, ...(problem.details ? { details: problem.details } : {}) } }, problem.status, retry);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (isReadOnlyReview(env) || requiresOwnerApproval(env)) return handleCloudRequest(request, env);
    const url = new URL(request.url);
    // Public catalogue responses contain no account or operator information.
    // Cache only successful reads, briefly, in a release-specific namespace.
    const cacheable = request.method === 'GET' && url.href.length <= 1500 && /^\/api\/(?:titles(?:\/[^/]+)?|meta\/filters|episodes\/\d+\/providers)$/.test(url.pathname);
    if (!cacheable) return handleCloudRequest(request, env);
    url.searchParams.set('__solanime_release', RELEASE);
    if (env.CATALOGUE_BASELINE_ENABLED === 'true')
      url.searchParams.set('__solanime_catalogue_baseline', `${env.CATALOGUE_BASELINE_ID}:${env.CATALOGUE_BASELINE_MANIFEST_SHA256}`);
    const key = new Request(url, { method: 'GET' });
    const edgeCache = (caches as CacheStorage & { default: Cache }).default;
    const hit = await edgeCache.match(key);
    if (hit) {
      const headers = new Headers(hit.headers); headers.set('Cache-Control', 'no-store');
      return new Response(hit.body, { status: hit.status, headers });
    }
    const response = await handleCloudRequest(request, env);
    if (response.ok && !response.headers.has('set-cookie')) {
      const headers = new Headers(response.headers); headers.set('Cache-Control', 'public, max-age=60');
      ctx.waitUntil(edgeCache.put(key, new Response(response.clone().body, { status: response.status, headers })));
    }
    return response;
  },
  async scheduled(controller, env) {
    if (isReadOnlyReview(env)) return;
    // One daily refresh reuses any unfinished source run. Creating a refresh does
    // not bypass an operator pause, a source refusal, or the snapshot barrier.
    const scheduledAt = new Date(controller.scheduledTime);
    if (env.SYNC_ENABLED === 'true' && env.SOURCE_REFRESH_ENABLED === 'true' && scheduledAt.getUTCHours() === 0 && scheduledAt.getUTCMinutes() === 0) {
      try { await createAnikotoRefreshRepository(env.CATALOGUE, budgetFor(env)).ensure(); }
      catch (error) { if (!(error instanceof QuotaExhaustedError)) throw error; }
    }
    // Expired sessions still hold encrypted identity refresh credentials; remove them in bounded batches.
    try { await new D1AccountsRepository(env.ACCOUNTS).prune(controller.scheduledTime); }
    catch (error) { console.error('Account pruning failed', error instanceof Error ? error.message : error); }
    await dispatch(env);
  },
  async queue(batch, env) {
    if (isReadOnlyReview(env)) return;
    if (env.SYNC_ENABLED !== 'true') { batch.ackAll(); return; }
    const handlers = { ...(env.SOURCE_REFRESH_ENABLED === 'true' ? createAnikotoSyncHandlers(env.CATALOGUE) : {}), ...createArtworkSyncHandlers(env.CATALOGUE, { budget: budgetFor(env) }), ...createSnapshotImportHandlers(env.CATALOGUE, env.RESEARCH, env.IMPORT_ASSETS, budgetFor(env)) };
    for (const message of batch.messages) await consumeSyncMessage(message, env.CATALOGUE, handlers, budgetFor(env));
  },
} satisfies ExportedHandler<CloudEnv>;

import { RELEASE } from '../shared/release.ts';
import { createAccounts, type AccountsService } from './accounts/service.ts';
import { openAccountsDatabase } from './accounts/database.ts';
import { nativeSourceResolver } from './providers/nativeSources.ts';
import { legacyResolution, type ApprovedNativeResource } from './providers/native.ts';
import { hasEnabledNativeResource, resolveApprovedNative } from './providers/native-registry.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { backup, type DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';
import { serveStatic } from './static.ts';
import { timingSafeEqual } from 'node:crypto';
import { openDatabase, migrate, currentSchemaVersion, projectRoot } from './db.ts';
import {
  adminStatus,
  browseTitles,
  exportCatalogue,
  exportCatalogueCsv,
  exportCoverageCsv,
  getEpisodeProviders,
  getFilters,
  getMapping,
  getTitle,
} from './catalogue.ts';
import { AppError, asAppError } from './errors.ts';
import { unsupportedSource, enforceNativeResolution, enforcePlaybackResolution } from './providers/playbackPolicy.ts';
import { completeTask, retryFailedTasks, setRunPaused } from './ingestion/queue.ts';
import { requireSafeMutation } from './security.ts';
import type { ProviderResolution, StoredProviderMapping } from './providers/contract.ts';
import { providerSupportDiagnostic } from './providers/support-diagnostics.ts';

const MAX_BODY = 16 * 1024;
const DEFAULT_MAX_PENDING_RESOLUTIONS = 8;
const DEFAULT_RESOLUTION_COOLDOWN_MS = 3_000;
const MAX_COOLDOWN_ENTRIES = 256;

interface AppOptions {
  accounts?: AccountsService;
  nativeSources?: ReturnType<typeof nativeSourceResolver>;
  backupDirectory?: string;
  staticDirectory?: string;
  maxPendingResolutions?: number;
  resolutionCooldownMs?: number;
  resolveProvider?: (
    mapping: StoredProviderMapping,
    signal: AbortSignal,
  ) => Promise<ProviderResolution>;
}

interface PendingResolution {
  controller: AbortController;
  promise: Promise<ProviderResolution>;
  settled: boolean;
  waiters: number;
}

function integer(
  value: string | null,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new AppError(400, 'BAD_REQUEST', `${name} must be an integer.`);
  const number = Number(value);
  if (number < min || number > max)
    throw new AppError(400, 'BAD_REQUEST', `${name} must be between ${min} and ${max}.`);
  return number;
}

function pathIdentifier(value: string, name: string): number {
  return integer(value, name, 0, 1, Number.MAX_SAFE_INTEGER);
}

function decodedSlug(value: string): string {
  let slug: string;
  try {
    slug = decodeURIComponent(value);
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'title slug is not valid URL encoding.');
  }
  if (!slug || slug.length > 300 || /[\u0000-\u001f\u007f]/.test(slug))
    throw new AppError(400, 'BAD_REQUEST', 'title slug is invalid.');
  return slug;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new AppError(413, 'BAD_REQUEST', 'Request body is too large.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'Request body must be a JSON object.');
  }
}

function baseHeaders(contentType = 'application/json; charset=utf-8'): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { ...baseHeaders(), ...headers });
  response.end(JSON.stringify(body));
}

function requireAdmin(request: IncomingMessage): void {
  const expected = process.env.SOLANIME_ADMIN_TOKEN;
  if (!expected)
    throw new AppError(
      503,
      'ADMIN_UNCONFIGURED',
      'Administrative actions are disabled until SOLANIME_ADMIN_TOKEN is configured.',
    );
  const supplied = request.headers['x-admin-token'];
  const candidate = typeof supplied === 'string' ? supplied : '';
  const expectedBytes = Buffer.from(expected);
  const candidateBytes = Buffer.from(candidate);
  if (
    expectedBytes.length !== candidateBytes.length ||
    !timingSafeEqual(expectedBytes, candidateBytes)
  )
    throw new AppError(401, 'UNAUTHORIZED', 'A valid admin token is required.');
}

export function createApp(db: DatabaseSync, options: AppOptions = {}) {
  const accounts = options.accounts ?? createAccounts(openAccountsDatabase(':memory:'));
  const nativeSources = options.nativeSources ?? nativeSourceResolver();
  const pendingResolutions = new Map<number, PendingResolution>();
  const resolutionCooldowns = new Map<
    number,
    { expiresAt: number; resolution: ProviderResolution }
  >();
  const maxPendingResolutions = Math.max(
    1,
    options.maxPendingResolutions ?? DEFAULT_MAX_PENDING_RESOLUTIONS,
  );
  const resolutionCooldownMs = Math.max(
    0,
    options.resolutionCooldownMs ?? DEFAULT_RESOLUTION_COOLDOWN_MS,
  );
  const backupDirectory = resolve(options.backupDirectory ?? resolve('data', 'backups'));
  const executeResolution =
    options.resolveProvider ??
    (async (mapping: StoredProviderMapping, signal: AbortSignal) => {
      const approved = db.prepare('SELECT * FROM native_resources WHERE mapping_id=? AND enabled=1').get(mapping.mappingId) as ApprovedNativeResource | undefined;
      if (approved && ['internet-archive', 'wikimedia-commons'].includes(mapping.providerId)) return legacyResolution(await resolveApprovedNative(mapping, approved, signal));
      const registered = nativeSources(mapping);
      if (registered) return registered;
      return unsupportedSource(mapping);
    });

  const recordResolution = (
    mapping: StoredProviderMapping,
    resolution: ProviderResolution,
  ): ProviderResolution => {
    const timestamp = new Date().toISOString();
    const verificationStage =
      resolution.status === 'resolved'
        ? 'source_resolved'
        : resolution.status === 'blocked'
          ? 'blocked'
          : 'failed';
    db.prepare(
      `INSERT INTO verification_observations(entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at) VALUES ('mapping',?,?,?,?,?,?,?)`,
    ).run(
      String(mapping.mappingId),
      verificationStage,
      resolution.status,
      resolution.error?.code ?? null,
      'local_runtime',
      JSON.stringify({ playbackType: resolution.playbackType }),
      timestamp,
    );
    if (resolution.status === 'resolved')
      db.prepare(
        "UPDATE episode_provider_mappings SET last_successful_resolution_at=?,resolution_evidence_state='resolved',updated_at=? WHERE id=?",
      ).run(timestamp, timestamp, mapping.mappingId);
    return resolution;
  };

  const awaitPendingResolution = (
    entry: PendingResolution,
    signal: AbortSignal,
  ): Promise<ProviderResolution> => {
    entry.waiters++;
    return new Promise<ProviderResolution>((resolvePromise, rejectPromise) => {
      let finished = false;
      const finish = (callback: () => void) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () =>
        finish(() => rejectPromise(new DOMException('Resolution cancelled', 'AbortError')));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      entry.promise.then(
        (resolution) => finish(() => resolvePromise(resolution)),
        (error) => finish(() => rejectPromise(error)),
      );
    }).finally(() => {
      entry.waiters--;
      if (!entry.settled && entry.waiters === 0) entry.controller.abort();
    });
  };

  const resolveMapping = (
    mapping: StoredProviderMapping,
    signal: AbortSignal,
  ): Promise<ProviderResolution> => {
    const cached = resolutionCooldowns.get(mapping.mappingId);
    if (
      cached &&
      cached.expiresAt > Date.now() &&
      (!cached.resolution.expiresAt || Date.parse(cached.resolution.expiresAt) > Date.now())
    )
      return Promise.resolve(cached.resolution);
    if (cached) resolutionCooldowns.delete(mapping.mappingId);

    let entry = pendingResolutions.get(mapping.mappingId);
    if (entry?.controller.signal.aborted) {
      pendingResolutions.delete(mapping.mappingId);
      entry = undefined;
    }
    if (!entry) {
      if (pendingResolutions.size >= maxPendingResolutions) {
        throw new AppError(
          429,
          'UNAVAILABLE',
          'The provider resolution queue is busy. Try again shortly.',
          { retryAfterSeconds: Math.max(1, Math.ceil(resolutionCooldownMs / 1_000)) },
        );
      }
      const controller = new AbortController();
      entry = {
        controller,
        promise: Promise.resolve(null as unknown as ProviderResolution),
        settled: false,
        waiters: 0,
      };
      const current = entry;
      current.promise = Promise.resolve()
        .then(() => executeResolution(mapping, controller.signal))
        .then((resolution) => {
          if (controller.signal.aborted)
            throw new DOMException('Resolution cancelled', 'AbortError');
          const recorded = recordResolution(mapping, enforcePlaybackResolution(mapping, resolution));
          if (resolutionCooldownMs > 0) {
            resolutionCooldowns.set(mapping.mappingId, {
              expiresAt: Date.now() + resolutionCooldownMs,
              resolution: recorded,
            });
            while (resolutionCooldowns.size > MAX_COOLDOWN_ENTRIES) {
              const oldest = resolutionCooldowns.keys().next().value as number | undefined;
              if (oldest === undefined) break;
              resolutionCooldowns.delete(oldest);
            }
          }
          return recorded;
        })
        .finally(() => {
          current.settled = true;
          if (pendingResolutions.get(mapping.mappingId) === current)
            pendingResolutions.delete(mapping.mappingId);
        });
      current.promise.catch(() => undefined);
      pendingResolutions.set(mapping.mappingId, current);
    }
    return awaitPendingResolution(entry, signal);
  };

  const server = createServer(async (request, response) => {
    const abort = new AbortController();
    request.on('aborted', () => abort.abort());
    response.on('close', () => {
      if (!response.writableEnded) abort.abort();
    });
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? 'GET';
      if (await accounts.handleCommunity(request, response, url, (episodeId) =>
        Boolean(db.prepare('SELECT 1 FROM episodes WHERE id=?').get(episodeId)))) return;
      if (await accounts.handle(request, response, url)) return;
      if (method === 'GET' && url.pathname === '/api/health')
        return json(response, 200, {
          status: 'ok',
          release: RELEASE,
          schemaVersion: currentSchemaVersion(db),
          database: 'connected',
          now: new Date().toISOString(),
        });
      if (method === 'GET' && url.pathname === '/api/titles') {
        const q = url.searchParams.get('q')?.trim();
        if (q && q.length > 200) throw new AppError(400, 'BAD_REQUEST', 'q is too long.');
        return json(
          response,
          200,
          browseTitles(db, {
            q,
            scope: url.searchParams.get('scope') || undefined,
            genre: url.searchParams.get('genre') || undefined,
            type: url.searchParams.get('type') || undefined,
            status: url.searchParams.get('status') || undefined,
            language: url.searchParams.get('language') || undefined,
            page: integer(url.searchParams.get('page'), 'page', 1, 1, 1_000_000),
            pageSize: integer(url.searchParams.get('pageSize'), 'pageSize', 24, 1, 100),
            sort: url.searchParams.get('sort') || 'name',
            includeFacets: url.searchParams.get('facets') !== 'false',
          }),
        );
      }
      const titleMatch = /^\/api\/titles\/([^/]+)$/.exec(url.pathname);
      if (method === 'GET' && titleMatch)
        return json(response, 200, getTitle(db, decodedSlug(titleMatch[1])));
      const episodeMatch = /^\/api\/episodes\/(\d+)\/providers$/.exec(url.pathname);
      if (method === 'GET' && episodeMatch) {
        const result = getEpisodeProviders(
          db,
          pathIdentifier(episodeMatch[1], 'episode ID'),
          url.searchParams.get('language') || undefined,
        );
        return json(response, 200, {
          ...result,
          providers: result.providers.map((provider) => {
            const mapping = getMapping(db, Number((provider as Record<string, unknown>).mappingId));
            const registered = nativeSources(mapping);
            const resource = db.prepare('SELECT * FROM native_resources WHERE mapping_id=?').get(mapping.mappingId) as ApprovedNativeResource | undefined;
            const approved = hasEnabledNativeResource(mapping, resource);
            const source = registered ? enforceNativeResolution(mapping, registered) : null;
            const diagnostic = providerSupportDiagnostic(mapping);
            const embedObserved =
              !approved && !source && diagnostic.state === 'documented-embed-only';
            return {
              ...provider,
              supported: !!approved || source?.status === 'resolved',
              kind: approved || source?.status === 'resolved' ? 'native' : 'unsupported',
              playbackType: approved ? 'direct' : source?.playbackType ?? (embedObserved ? 'iframe' : 'unknown'),
              status: approved ? 'available' : source
                ? source.status === 'resolved'
                  ? 'available'
                  : 'unavailable'
                : 'unsupported',
              reason:
                source?.error?.message ??
                (source || approved ? null : diagnostic.message),
              reasonCode: source?.error?.code ?? (source || approved ? null : diagnostic.code),
              capabilities:
                approved || source?.status === 'resolved'
                  ? {
                      seek: true,
                      volume: true,
                      fullscreen: true,
                      progressEvents: true,
                      subtitles: !!source?.captions?.length,
                    }
                  : {},
            };
          }),
        });
      }
      const resolveMatch = /^\/api\/providers\/(\d+)\/resolve$/.exec(url.pathname);
      if (method === 'POST' && resolveMatch) {
        requireSafeMutation(request.headers, { requireJson: true });
        const body = await readJson(request);
        const mapping = getMapping(db, pathIdentifier(resolveMatch[1], 'mapping ID'));
        if (
          body.language != null &&
          (typeof body.language !== 'string' || body.language.toLowerCase() !== mapping.language)
        )
          throw new AppError(400, 'BAD_REQUEST', 'Requested language does not match this mapping.');
        const resolution = await resolveMapping(mapping, abort.signal);
        return json(response, resolution.status === 'resolved' ? 200 : 422, {
          ...resolution,
          mappingId: String(resolution.mappingId),
        });
      }
      if (method === 'GET' && url.pathname === '/api/meta/filters')
        return json(response, 200, getFilters(db));
      if (method === 'GET' && url.pathname === '/api/admin/import/status') {
        requireAdmin(request);
        return json(response, 200, adminStatus(db));
      }
      const runAction = /^\/api\/admin\/import\/(\d+)\/(pause|resume|retry)$/.exec(url.pathname);
      if (method === 'POST' && runAction) {
        requireSafeMutation(request.headers, { requireJson: false });
        requireAdmin(request);
        const runId = pathIdentifier(runAction[1], 'run ID');
        const action = runAction[2];
        if (action === 'retry')
          return json(response, 200, { runId, retried: retryFailedTasks(db, runId) });
        if (!setRunPaused(db, runId, action === 'pause'))
          throw new AppError(404, 'NOT_FOUND', 'Active import run was not found.');
        return json(response, 200, { runId, status: action === 'pause' ? 'paused' : 'queued' });
      }
      if (method === 'GET' && url.pathname.startsWith('/api/exports/')) requireAdmin(request);
      if (method === 'GET' && url.pathname === '/api/exports/catalogue.json')
        return json(response, 200, exportCatalogue(db));
      if (method === 'GET' && url.pathname === '/api/exports/catalogue.csv') {
        response.writeHead(200, baseHeaders('text/csv; charset=utf-8'));
        return response.end(exportCatalogueCsv(db));
      }
      if (method === 'GET' && url.pathname === '/api/exports/coverage.csv') {
        response.writeHead(200, baseHeaders('text/csv; charset=utf-8'));
        return response.end(exportCoverageCsv(db));
      }
      if (method === 'POST' && url.pathname === '/api/admin/backup') {
        requireSafeMutation(request.headers, { requireJson: false });
        requireAdmin(request);
        mkdirSync(backupDirectory, { recursive: true });
        const path = resolve(
          backupDirectory,
          `solanime-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
        );
        await backup(db, path);
        return json(response, 201, { path, schemaVersion: currentSchemaVersion(db) });
      }
      if (
        options.staticDirectory &&
        !url.pathname.startsWith('/api/') &&
        url.pathname !== '/api' &&
        (await serveStatic(request, response, url, options.staticDirectory))
      )
        return;
      json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route was not found.' } });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const appError = asAppError(error);
      if (appError.status >= 500 && process.env.NODE_ENV !== 'test')
        console.error(error instanceof Error ? error.message : 'Unknown server error');
      if (!response.headersSent)
        json(
          response,
          appError.status,
          {
            error: {
              code: appError.code,
              message: appError.message,
              ...(appError.details ? { details: appError.details } : {}),
            },
          },
          appError.status === 429
            ? { 'Retry-After': String(appError.details?.retryAfterSeconds ?? 1) }
            : {},
        );
    }
  });
  server.once('close', () => accounts.close());
  return server;
}

export function startServer() {
  const staticDirectory = process.argv.includes('--serve-static')
    ? resolve(projectRoot, 'dist')
    : undefined;
  if (staticDirectory && !existsSync(resolve(staticDirectory, 'index.html')))
    throw new Error('The production build is missing. Run pnpm build before pnpm start.');
  const db = openDatabase();
  migrate(db);
  const port = integer(process.env.PORT ?? null, 'PORT', 8787, 1, 65535);
  const host = process.env.HOST || '127.0.0.1';
  const accounts = createAccounts(openAccountsDatabase());
  const server = createApp(db, { staticDirectory, accounts });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.on('error', (error) => {
    console.error(`Unable to start SolAnime: ${error.message}`);
    db.close();
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(
      `SolAnime ${staticDirectory ? 'application' : 'API'} listening on http://${host}:${port}`,
    ),
  );
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
    deadline.unref();
    server.close(() => {
      clearTimeout(deadline);
      db.close();
    });
    server.closeIdleConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { server, db };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
  startServer();

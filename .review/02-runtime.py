from pathlib import Path
R=Path.cwd()
def w(path,text):
 p=R/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text.strip()+'\n')
def r(path,old,new):
 p=R/path;s=p.read_text();assert old in s,(path,old[:70]);p.write_text(s.replace(old,new))
w('.env.example','''# Copy to .env. Shell environment variables take precedence.
HOST=127.0.0.1
PORT=8787
SOLANIME_DB_PATH=data/solanime.sqlite
# Optional. Leave blank to disable administrative operations.
# Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SOLANIME_ADMIN_TOKEN=
# Exact public frontend origins, comma-separated, only when using the Pages gateway.
SOLANIME_ALLOWED_ORIGINS=
SOLANIME_SOURCE_DELAY_MS=1200
SOLANIME_SOURCE_TIMEOUT_MS=20000
SOLANIME_SOURCE_MAX_RETRIES=4
SOLANIME_MAX_RETRY_AFTER_MS=86400000''')
p=R/'.gitignore';s=p.read_text()+'\n# Local machine and Cloudflare configuration\n.DS_Store\n.wrangler/\n.dev.vars\n.dev.vars.*\n!.dev.vars.example\n';p.write_text('\n'.join(dict.fromkeys(s.splitlines()))+'\n')
r('server/db.ts',"import { mkdirSync, readFileSync, readdirSync } from 'node:fs';","import { mkdirSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';\nimport { fileURLToPath } from 'node:url';")
r('server/db.ts','export type SqliteDatabase = DatabaseSync;',"export type SqliteDatabase = DatabaseSync;\nexport const projectRoot = fileURLToPath(new URL('../', import.meta.url));")
r('server/db.ts',"export function openDatabase(path = process.env.SOLANIME_DB_PATH ?? resolve('data', 'solanime.sqlite')): SqliteDatabase {\n  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });",'''export function openDatabase(path = process.env.SOLANIME_DB_PATH || resolve(projectRoot, 'data', 'solanime.sqlite')): SqliteDatabase {
  if (path !== ':memory:') {
    path = resolve(projectRoot, path);
    if (existsSync(path) && statSync(path).size < 1024 && readFileSync(path, 'utf8').startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error('The database is a Git LFS pointer, not a SQLite file. Run git lfs install && git lfs pull, or use the complete download package. Your existing file was not modified.');
    mkdirSync(dirname(path), { recursive: true });
  }''')
r('server/db.ts',"migrationsDir = resolve('migrations')","migrationsDir = resolve(projectRoot, 'migrations')")
w('migrations/006_catalogue_indexes.sql','''-- Stable sorting and filters used by catalogue requests.
CREATE INDEX IF NOT EXISTS idx_titles_updated_id ON titles(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_titles_lower_format ON titles(LOWER(format));
CREATE INDEX IF NOT EXISTS idx_titles_lower_status ON titles(LOWER(status));
CREATE INDEX IF NOT EXISTS idx_versions_language_episode ON episode_versions(language, episode_id);''')
r('server/catalogue.ts','page: number; pageSize: number; sort: string }','page: number; pageSize: number; sort: string; includeFacets?: boolean }')
r('server/catalogue.ts',"updated: 't.updated_at DESC'","updated: 't.updated_at DESC, t.id DESC'")
r('server/catalogue.ts',"'t.release_year ASC, t.name COLLATE NOCASE'","'t.release_year IS NULL, t.release_year ASC, t.name COLLATE NOCASE'")
r('server/catalogue.ts','ORDER BY ${order[params.sort] ?? order.name} LIMIT','ORDER BY ${order[params.sort] ?? order.name}, t.id ASC LIMIT')
r('server/catalogue.ts','t.status,t.artwork_url AS artworkUrl','t.status,t.updated_at AS updatedAt,t.artwork_url AS artworkUrl')
r('server/catalogue.ts','facets: getFilters(db) };',"...(params.includeFacets !== false ? { facets: getFilters(db) } : {}) };")
r('server/catalogue.ts','export function getFilters(db: SqliteDatabase) {', '''const filterCache = new WeakMap<SqliteDatabase, { version: number; changes: number; expiresAt: number; value: ReturnType<typeof readFilters> }>();
export function getFilters(db: SqliteDatabase) {
  const version = Number((db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version);
  const changes = Number((db.prepare('SELECT total_changes() AS count').get() as { count: number }).count);
  const cached = filterCache.get(db);
  if (cached && cached.version === version && cached.changes === changes && cached.expiresAt > Date.now()) return cached.value;
  const value = readFilters(db); filterCache.set(db, { version, changes, expiresAt: Date.now() + 30_000, value }); return value;
}
function readFilters(db: SqliteDatabase) {''')
r('server/catalogue.ts',"SELECT language AS value,UPPER(language) AS label,COUNT(DISTINCT episode_id) AS count FROM episode_versions GROUP BY language ORDER BY language","SELECT v.language AS value,UPPER(v.language) AS label,COUNT(DISTINCT e.title_id) AS count FROM episode_versions v JOIN episodes e ON e.id=v.episode_id GROUP BY v.language ORDER BY v.language")
r('server/catalogue.ts','const id = title.id as number;','const id = Number(title.id);')
p=R/'server/catalogue.ts';s=p.read_text();a=s.index('  const versionsQuery = db.prepare(');b=s.index('\n}',a);s=s[:a]+'''  const versions = db.prepare(`SELECT CAST(v.id AS TEXT) AS id,CAST(v.episode_id AS TEXT) AS episodeId,
    v.language,v.version_label AS label,v.availability_state AS availability,COUNT(m.id) AS providerCount
    FROM episode_versions v JOIN episodes e ON e.id=v.episode_id
    LEFT JOIN episode_provider_mappings m ON m.version_id=v.id
    WHERE e.title_id=? GROUP BY v.id ORDER BY v.language,v.id`).all(id) as Array<Record<string, unknown>>;
  const byEpisode = new Map<string, Array<Record<string, unknown>>>();
  for (const { episodeId, ...version } of versions) { const key = String(episodeId); const entries = byEpisode.get(key) ?? []; entries.push(version); byEpisode.set(key, entries); }
  return { title: Object.assign(title, { episodeCount: episodes.length }) as Record<string, unknown>, aliases, genres, related, episodes: episodes.map((episode) => ({ ...episode, versions: byEpisode.get(String(episode.id)) ?? [] })) };
''' +s[b:]
s=s.replace('const quote = (value: unknown) => `"${String(value ?? \'\').replaceAll(\'"\', \'""\')}"`;', '''const quote = (value: unknown) => {
    const text = String(value ?? '');
    const safe = /^[\\s]*[=+@-]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };''');p.write_text(s)
r('src/lib/api.ts','    const params = new URLSearchParams();',"    const params = new URLSearchParams({ facets: 'false' });")
r('server/app.ts',"import { mkdirSync } from 'node:fs';","import { mkdirSync, existsSync } from 'node:fs';\nimport { serveStatic } from './static.ts';")
r('server/app.ts',"import { openDatabase, migrate, currentSchemaVersion } from './db.ts';","import { openDatabase, migrate, currentSchemaVersion, projectRoot } from './db.ts';")
r('server/app.ts','  backupDirectory?: string;','  backupDirectory?: string;\n  staticDirectory?: string;')
r('server/app.ts',"sort: url.searchParams.get('sort') || 'name'","sort: url.searchParams.get('sort') || 'name', includeFacets: url.searchParams.get('facets') !== 'false'")
r('server/app.ts','    let entry = pendingResolutions.get(mapping.mappingId);','''    let entry = pendingResolutions.get(mapping.mappingId);
    if (entry?.controller.signal.aborted) { pendingResolutions.delete(mapping.mappingId); entry = undefined; }''')
r('server/app.ts','          const recorded = recordResolution(mapping, resolution);',"          if (controller.signal.aborted) throw new DOMException('Resolution cancelled', 'AbortError');\n          const recorded = recordResolution(mapping, resolution);")
r('server/app.ts',"      if (method === 'GET' && url.pathname === '/api/exports/catalogue.json')","      if (method === 'GET' && url.pathname.startsWith('/api/exports/')) requireAdmin(request);\n      if (method === 'GET' && url.pathname === '/api/exports/catalogue.json')")
r('server/app.ts',"      json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route was not found.' } });","      if (options.staticDirectory && !url.pathname.startsWith('/api/') && url.pathname !== '/api' && await serveStatic(request, response, url, options.staticDirectory)) return;\n      json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route was not found.' } });")
p=R/'server/app.ts';s=p.read_text();a=s.index('export function startServer()');b=s.index('\nif (process.argv[1]',a);s=s[:a]+'''export function startServer() {
  const staticDirectory = process.argv.includes('--serve-static') ? resolve(projectRoot, 'dist') : undefined;
  if (staticDirectory && !existsSync(resolve(staticDirectory, 'index.html'))) throw new Error('The production build is missing. Run pnpm build before pnpm start.');
  const db = openDatabase(); migrate(db);
  const port = integer(process.env.PORT ?? null, 'PORT', 8787, 1, 65535); const host = process.env.HOST || '127.0.0.1';
  const server = createApp(db, { staticDirectory });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000;
  server.on('error', (error) => { console.error(`Unable to start SolAnime: ${error.message}`); db.close(); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`SolAnime ${staticDirectory ? 'application' : 'API'} listening on http://${host}:${port}`));
  let closing = false;
  const shutdown = () => { if (closing) return; closing = true; const deadline = setTimeout(() => server.closeAllConnections(), 10_000); deadline.unref(); server.close(() => { clearTimeout(deadline); db.close(); }); server.closeIdleConnections(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown); return { server, db };
}
''' +s[b:];p.write_text(s)
r('server/security.ts',"const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);\n",'')
r('server/security.ts','    const loopbackProxy = LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) && LOOPBACK_HOSTS.has(requestHostname);',"    const configured = (process.env.SOLANIME_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean);\n    const allowedOrigin = configured.includes(parsed.origin);")
r('server/security.ts','(!exactOrigin && !loopbackProxy)','(!exactOrigin && !allowedOrigin)')
r('server/security.ts',"if (!['http:', 'https:'].includes(parsed.protocol) ||","if (origin !== parsed.origin || !['http:', 'https:'].includes(parsed.protocol) ||")
w('server/static.ts',r'''import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:; media-src 'self' https: blob:; worker-src 'self' blob:; frame-src 'self' https://megaplay.buzz; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
};
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const inside = (root: string, file: string) => { const path = relative(root, file); return path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep); };
/** Serve only the build directory. Missing assets and API routes never become HTML data responses. */
export async function serveStatic(request: IncomingMessage, response: ServerResponse, url: URL, directory: string): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  let pathname: string; try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
  if (pathname.includes('\\') || /[\x00-\x1f]/.test(pathname) || pathname.split('/').some((part) => part.startsWith('.') || part.startsWith('_'))) return false;
  const root = await realpath(directory); let file = resolve(root, `.${pathname}`); if (!inside(root, file)) return false;
  const appRoute = /^\/(?:catalogue|search|library|admin|title\/[^/]+|watch\/[^/]+\/[^/]+)?\/?$/.test(pathname);
  if (appRoute) file = resolve(root, 'index.html');
  try {
    file = await realpath(file); if (!inside(root, file)) return false;
    const info = await stat(file); if (!info.isFile() || !mime[extname(file)]) return false;
    const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`;
    const headers = { ...securityHeaders, 'Content-Type': mime[extname(file)], ETag: etag, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return true; }
    response.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (request.method === 'HEAD') response.end();
    else { const stream = createReadStream(file); stream.on('error', () => response.destroy()); response.once('close', () => stream.destroy()); stream.pipe(response); }
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return false; throw error; }
}''')
w('vite.config.ts', '''import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }; const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid API port.');
  const target = `http://127.0.0.1:${port}`; const proxy = { '/api': { target, changeOrigin: false } };
  const headers = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': "frame-src 'self' https://megaplay.buzz; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" };
  return { plugins: [react()], server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy, headers }, preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy, headers } };
});''')
w('scripts/doctor.ts', '''import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase, projectRoot } from '../server/db.ts';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 10) throw new Error('Node.js 24.10 or newer is required. Use the Node 24 LTS release.');
const path = resolve(projectRoot, process.env.SOLANIME_DB_PATH || 'data/solanime.sqlite');
if (!existsSync(path)) throw new Error(`Database not found at ${path}. Run git lfs pull, or extract the complete source package. No empty replacement was created.`);
if (statSync(path).size === 0) throw new Error('The database is empty. Restore a verified backup before starting.');
const db = openDatabase(path);
try {
  const integrity = db.prepare('PRAGMA quick_check').get() as { quick_check: string };
  if (integrity.quick_check !== 'ok') throw new Error(`Database integrity check failed: ${integrity.quick_check}`);
  const counts = db.prepare('SELECT (SELECT COUNT(*) FROM titles) AS titles, (SELECT COUNT(*) FROM episodes) AS episodes, (SELECT COUNT(*) FROM episode_provider_mappings) AS mappings').get();
  console.log(JSON.stringify({ node: process.versions.node, database: path, integrity: integrity.quick_check, counts, build: existsSync(resolve(projectRoot, 'dist/index.html')) ? 'present' : 'Run pnpm build before pnpm start', admin: process.env.SOLANIME_ADMIN_TOKEN ? 'configured' : 'disabled' }, null, 2));
} finally { db.close(); }''')
p=R/'scripts/start-full-import.ts';s=p.read_text().replace('existsSync, mkdirSync, openSync, readFileSync, writeFileSync','existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync');s=s.replace("    if (error instanceof Error && error.message.startsWith('A full import worker already appears active')) throw error;","    if (error instanceof Error && (error.message.startsWith('A full import worker already appears active') || (error as NodeJS.ErrnoException).code === 'EPERM')) throw error;")
a=s.index('const pnpm = ');s=s[:a]+r'''const resumeRunId = process.argv.slice(2).find((argument) => /^\d+$/.test(argument)) ?? null;
const args = ['--env-file-if-exists=.env', '--import', 'tsx', 'scripts/import-anikoto.ts', '--mode=full'];
if (resumeRunId) args.push(`--run-id=${resumeRunId}`);
const stdout = openSync(stdoutPath, 'a'); const stderr = openSync(stderrPath, 'a'); const workerId = randomUUID();
try {
  const child = spawn(process.execPath, args, { cwd: resolve('.'), detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr], env: { ...process.env, SOLANIME_WORKER_ID: workerId } });
  await new Promise<void>((resolvePromise, rejectPromise) => { child.once('spawn', resolvePromise); child.once('error', rejectPromise); });
  if (!child.pid) throw new Error('Failed to start full import worker.');
  const state = { pid: child.pid, workerId, startedAt: new Date().toISOString(), command: [process.execPath, ...args].join(' '), stdoutPath, stderrPath };
  writeFileSync(pidPath, `${JSON.stringify(state, null, 2)}\n`); child.unref(); console.log(JSON.stringify(state, null, 2));
} finally { closeSync(stdout); closeSync(stderr); }
''';p.write_text(s)

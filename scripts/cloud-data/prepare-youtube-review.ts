import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type RecordValue = Record<string, unknown>;
interface ReviewResource { databaseName: string; databaseId: string; }
interface YouTubeReviewBaseResources {
  version: 1;
  kind: 'solanime-youtube-review-resources';
  workerName: 'solanime-api-youtube-review';
  pagesProject: string;
  pagesBranch: 'youtube-official-review';
  expectedBaseline: { sourceSha256: string; mappings: number };
  rateLimits: { API_LIMITER: string; RESOLVE_LIMITER: string };
}
export type YouTubeReviewResources = YouTubeReviewBaseResources & (
  { storageMode: 'isolated'; d1: { CATALOGUE: ReviewResource; ACCOUNTS: ReviewResource; RESEARCH: ReviewResource } }
  | { storageMode: 'shared-preview-read-only'; d1?: never }
);
export interface PrepareYouTubeReviewOptions { baselinePlan: string; resources: string; pagesConfig?: string; output: string; }

const portable = (path: string) => resolve(path).replaceAll('\\', '/');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const workersFreeAssetFileLimit = 20_000;
const staticAssetFileByteLimit = 25 * 1024 * 1024;

function scanStaticAssets(path: string): { files: number; maxFileBytes: number } {
  let files = 0, maxFileBytes = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = scanStaticAssets(target);
      files += nested.files;
      maxFileBytes = Math.max(maxFileBytes, nested.maxFileBytes);
    } else if (entry.isFile()) {
      files += 1;
      maxFileBytes = Math.max(maxFileBytes, statSync(target).size);
    }
  }
  return { files, maxFileBytes };
}

export function assertWorkersFreeStaticAssetLimits(staticAssets: { files: number; maxFileBytes: number }): void {
  if (staticAssets.files > workersFreeAssetFileLimit) throw new Error(`Review Worker has ${staticAssets.files} static asset files, above the Workers Free limit of ${workersFreeAssetFileLimit}; no paid plan is assumed.`);
  if (staticAssets.maxFileBytes > staticAssetFileByteLimit) throw new Error(`Review Worker has a static asset above the ${staticAssetFileByteLimit}-byte per-file limit.`);
}

function validateResources(value: unknown): YouTubeReviewResources {
  if (!object(value) || value.version !== 1 || value.kind !== 'solanime-youtube-review-resources' || value.workerName !== 'solanime-api-youtube-review' || value.pagesBranch !== 'youtube-official-review' || typeof value.pagesProject !== 'string' || !/^[a-z0-9][a-z0-9-]{1,57}[a-z0-9]$/.test(value.pagesProject) || !object(value.expectedBaseline) || typeof value.expectedBaseline.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedBaseline.sourceSha256) || !Number.isSafeInteger(value.expectedBaseline.mappings) || Number(value.expectedBaseline.mappings) < 1 || !object(value.rateLimits) || !['isolated', 'shared-preview-read-only'].includes(String(value.storageMode))) throw new Error('Invalid YouTube review resource manifest.');
  if (value.storageMode === 'isolated') {
    if (!object(value.d1)) throw new Error('Isolated review mode requires three explicit D1 resources.');
    for (const binding of ['CATALOGUE', 'ACCOUNTS', 'RESEARCH'] as const) {
      const item = value.d1[binding];
      if (!object(item) || typeof item.databaseName !== 'string' || !/review/.test(item.databaseName) || typeof item.databaseId !== 'string' || !uuid(item.databaseId)) throw new Error(`Invalid isolated ${binding} D1 resource.`);
    }
  } else if (value.d1 !== undefined) {
    throw new Error('Shared read-only review mode inherits preview D1 bindings; do not repeat their IDs in the resource manifest.');
  }
  for (const binding of ['API_LIMITER', 'RESOLVE_LIMITER'] as const)
    if (typeof value.rateLimits[binding] !== 'string' || !/^\d{1,10}$/.test(value.rateLimits[binding])) throw new Error(`Invalid ${binding} namespace.`);
  return value as unknown as YouTubeReviewResources;
}

/** Generate a fail-closed review service from explicit isolated or shared-read-only resources. */
export function prepareYouTubeReview(options: PrepareYouTubeReviewOptions) {
  const output = resolve(options.output);
  if (existsSync(output)) throw new Error('Review output already exists; choose a fresh task-owned directory.');
  const staging = `${output}.staging-${process.pid}-${randomUUID()}`;
  const baselinePlanPath = resolve(options.baselinePlan);
  const baselinePlan = JSON.parse(readFileSync(baselinePlanPath, 'utf8')) as RecordValue;
  if (baselinePlan.kind !== 'solanime-baseline-preview-plan' || !object(baselinePlan.preview) || typeof baselinePlan.preview.config !== 'string') throw new Error('Invalid completed-baseline preview plan.');
  const baseWorkerPath = resolve(baselinePlan.preview.config);
  const baseWorker = JSON.parse(readFileSync(baseWorkerPath, 'utf8')) as RecordValue;
  const basePagesPath = resolve(options.pagesConfig ?? 'cloud/pages/wrangler.jsonc');
  const basePages = JSON.parse(readFileSync(basePagesPath, 'utf8')) as RecordValue;
  const resources = validateResources(JSON.parse(readFileSync(resolve(options.resources), 'utf8')));
  if (resources.workerName === baseWorker.name) throw new Error('Review Worker must not reuse the existing API service name.');
  if (resources.pagesProject !== basePages.name) throw new Error('Review Pages project must match the reviewed project; isolation is provided by its non-production branch binding.');
  if (typeof basePages.account_id !== 'string' || !/^[a-f0-9]{32}$/i.test(basePages.account_id)) throw new Error('Base Pages config must declare the reviewed Cloudflare account_id.');
  if (!object(baselinePlan.source) || baselinePlan.source.sha256 !== resources.expectedBaseline.sourceSha256 || !object(baselinePlan.baseline) || baselinePlan.baseline.counts == null || !object(baselinePlan.baseline.counts) || baselinePlan.baseline.counts.mappings !== resources.expectedBaseline.mappings) throw new Error('Review baseline does not match the explicitly approved source hash and mapping count.');

  const existingD1 = Array.isArray(baseWorker.d1_databases) ? baseWorker.d1_databases.filter(object) : [];
  const existingIds = new Set(existingD1.map(item => String(item.database_id)));
  const requiredBindings = ['CATALOGUE', 'ACCOUNTS', 'RESEARCH'] as const;
  const sharedD1 = requiredBindings.map(binding => existingD1.find(item => item.binding === binding));
  if (sharedD1.some(item => !item || typeof item.database_name !== 'string' || !/(^|-)preview($|-)/.test(String(item.database_name)) || typeof item.database_id !== 'string' || !uuid(String(item.database_id))) || new Set(sharedD1.map(item => item?.database_id)).size !== requiredBindings.length) throw new Error('Completed-baseline config does not provide three distinct preview D1 bindings.');
  if (resources.storageMode === 'isolated') {
    const reviewIds = Object.values(resources.d1).map(item => item.databaseId);
    if (new Set(reviewIds).size !== reviewIds.length || reviewIds.some(id => existingIds.has(id))) throw new Error('Review D1 databases must be distinct from one another and every existing API database.');
  }
  const existingRateLimits = Array.isArray(baseWorker.ratelimits) ? baseWorker.ratelimits.filter(object) : [];
  const existingNamespaces = new Set(existingRateLimits.map(item => String(item.namespace_id)));
  if (resources.rateLimits.API_LIMITER === resources.rateLimits.RESOLVE_LIMITER || Object.values(resources.rateLimits).some(id => existingNamespaces.has(id))) throw new Error('Review rate-limit namespaces must be isolated from the existing API service.');
  if (!object(baseWorker.assets) || typeof baseWorker.assets.directory !== 'string' || !existsSync(baseWorker.assets.directory) || !statSync(baseWorker.assets.directory).isDirectory()) throw new Error('Completed-baseline Worker assets are unavailable.');
  const staticAssets = scanStaticAssets(baseWorker.assets.directory);
  assertWorkersFreeStaticAssetLimits(staticAssets);
  if (typeof baseWorker.main !== 'string' || !existsSync(baseWorker.main)) throw new Error('Review Worker entry point is unavailable.');
  const workerSource = readFileSync(baseWorker.main, 'utf8');
  if (!workerSource.includes('hasEnabledOfficialYouTubeResource') || !workerSource.includes('resolveApprovedPlayback')) throw new Error('Worker entry point is not official-YouTube-capable.');

  const reviewOrigin = `https://${resources.pagesBranch}.${resources.pagesProject}.pages.dev`;
  const worker = structuredClone(baseWorker);
  worker.name = resources.workerName;
  worker.workers_dev = false;
  worker.preview_urls = false;
  worker.vars = { ...(object(baseWorker.vars) ? baseWorker.vars : {}), SOLANIME_APP_ORIGIN: reviewOrigin, SOLANIME_ALLOWED_ORIGINS: reviewOrigin, SOLANIME_REGISTRATION: 'closed', SOLANIME_READ_ONLY_REVIEW: 'true', SYNC_ENABLED: 'false', SOURCE_REFRESH_ENABLED: 'false', RELEASE_CHANNEL: 'preview' };
  worker.d1_databases = resources.storageMode === 'isolated'
    ? requiredBindings.map(binding => ({ binding, database_name: resources.d1[binding].databaseName, database_id: resources.d1[binding].databaseId, migrations_dir: portable(resolve(dirname(baseWorker.main as string), '../../migrations/cloud', binding.toLowerCase())) }))
    : structuredClone(existingD1);
  worker.ratelimits = (['API_LIMITER', 'RESOLVE_LIMITER'] as const).map(binding => ({ name: binding, namespace_id: resources.rateLimits[binding], simple: binding === 'API_LIMITER' ? { limit: 180, period: 60 } : { limit: 30, period: 60 } }));
  // The fail-closed review surface cannot reach account, admin, import, or sync
  // handlers, so it must not inherit their production-only secret requirements.
  delete worker.secrets;
  delete worker.queues;
  delete worker.triggers;

  const pages = structuredClone(basePages);
  pages.$schema = portable(resolve(dirname(basePagesPath), '../../node_modules/wrangler/config-schema.json'));
  pages.pages_build_output_dir = portable(resolve(dirname(basePagesPath), '../../dist'));
  const baseEnvironments = object(basePages.env) ? basePages.env : {};
  const basePreview = object(baseEnvironments.preview) ? baseEnvironments.preview : {};
  pages.env = {
    ...baseEnvironments,
    preview: { ...basePreview, vars: { ...(object(basePreview.vars) ? basePreview.vars : {}), SOLANIME_REVIEW_MODE: 'youtube-official' }, services: [{ binding: 'SOLANIME_API', service: resources.workerName, environment: 'production' }] },
  };

  mkdirSync(join(staging, 'pages'), { recursive: true });
  const workerConfig = join(output, 'wrangler.youtube-review.json');
  const pagesConfig = join(output, 'pages', 'wrangler.jsonc');
  writeFileSync(join(staging, 'wrangler.youtube-review.json'), `${JSON.stringify(worker, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  writeFileSync(join(staging, 'pages', 'wrangler.jsonc'), `${JSON.stringify(pages, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const plan = {
    version: 1, kind: 'solanime-official-youtube-review-deployment',
    worker: { name: resources.workerName, config: workerConfig, sourceSha256: hash(workerSource), readOnlyReview: true, publicRoutes: false, previewUrls: false, staticAssets: { ...staticAssets, freePlanFileLimit: workersFreeAssetFileLimit, fileHeadroom: workersFreeAssetFileLimit - staticAssets.files, perFileByteLimit: staticAssetFileByteLimit, paidPlanAssumed: false } },
    pages: { project: resources.pagesProject, branch: resources.pagesBranch, config: pagesConfig, reviewMode: 'youtube-official', service: resources.workerName },
    storage: { mode: resources.storageMode, bindings: (worker.d1_databases as RecordValue[]).map(item => ({ binding: item.binding, databaseName: item.database_name, databaseId: item.database_id })) },
    isolation: { workerService: true, d1Databases: resources.storageMode === 'isolated', d1ApplicationWrites: false, rateLimitNamespaces: true, pagesPreviewBinding: true, backgroundTriggers: false, backgroundQueues: false, registrationOpen: false },
    residualSharing: ['Cloudflare account', 'Pages project', 'completed immutable Worker asset package', 'Pages env.preview binding (applies to every preview deployment made with the generated config)', ...(resources.storageMode === 'shared-preview-read-only' ? ['existing preview D1 databases (read-only application access)'] : [])],
    prerequisites: resources.storageMode === 'isolated'
      ? ['Provision and migrate the three manifest-named review D1 databases.', 'Do not seed resolver state; the approved official mapping is served from the immutable baseline.', 'Do not configure account, admin, import, or sync secrets on the fail-closed review service.', 'Deploy the review Worker before the Pages preview because Service binding targets must already exist.']
      : ['Do not migrate, seed, import, or otherwise mutate the shared preview D1 databases.', 'The approved official mapping must be present in the pinned immutable baseline.', 'Deploy the review Worker before the Pages preview because Service binding targets must already exist.'],
    commands: {
      workerDryRun: ['pnpm', 'exec', 'wrangler', 'deploy', '--config', workerConfig, '--dry-run', '--outdir', join(output, 'worker-dry-run')],
      workerDeployAfterReview: ['pnpm', 'exec', 'wrangler', 'deploy', '--config', workerConfig, '--strict', '--keep-vars'],
      pagesDeployAfterWorkerReview: ['pnpm', 'exec', 'wrangler', '--cwd', join(output, 'pages'), 'pages', 'deploy', portable(resolve(dirname(basePagesPath), '../../dist')), '--project-name', resources.pagesProject, '--branch', resources.pagesBranch],
      forbidden: ['deploying the checked-in wrangler.jsonc', 'binding Pages preview to solanime-api-preview', ...(resources.storageMode === 'shared-preview-read-only' ? ['migrating, seeding, importing, or writing shared preview D1'] : ['using any existing D1 database ID']), 'deploying the Pages main or cloud-release branch'],
    },
  };
  writeFileSync(join(staging, 'review-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  renameSync(staging, output);
  return { ...plan, planPath: join(output, 'review-plan.json') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const baselinePlan = option('baseline-plan'), resources = option('resources'), output = option('out');
  if (!baselinePlan || !resources || !output) throw new Error('Use --baseline-plan=<completed preview-plan.json> --resources=<explicit review resources.json> --out=<fresh task-owned directory>.');
  console.log(JSON.stringify(prepareYouTubeReview({ baselinePlan, resources, output, pagesConfig: option('pages-config') }), null, 2));
}

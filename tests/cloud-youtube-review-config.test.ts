import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertWorkersFreeStaticAssetLimits, prepareYouTubeReview, type YouTubeReviewResources } from '../scripts/cloud-data/prepare-youtube-review.ts';

const parent = resolve(process.env.SOLANIME_TEST_TMP || '../solanime-cloud-artifacts/tmp'); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'youtube-review-config-'));
const put = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); return path; };
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const previewIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const baselineHash = 'd'.repeat(64);

function fixture(storageMode: 'isolated' | 'shared-preview-read-only' = 'isolated') {
  const folder = join(root, crypto.randomUUID()), assets = join(folder, 'assets'); mkdirSync(assets, { recursive: true });
  const main = put(join(folder, 'worker.ts'), 'const hasEnabledOfficialYouTubeResource=true; const resolveApprovedPlayback=true; export default {};');
  const baseWorker = put(join(folder, 'wrangler.preview.json'), { name: 'solanime-api-preview', main, workers_dev: false, preview_urls: true, assets: { directory: assets, binding: 'IMPORT_ASSETS', run_worker_first: true }, vars: { RELEASE_CHANNEL: 'preview' }, secrets: { required: ['SOLANIME_ADMIN_TOKEN', 'FIREBASE_API_KEY', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'AUTH_CREDENTIAL_KEY'] }, d1_databases: [
    { binding: 'CATALOGUE', database_name: 'catalogue-preview', database_id: previewIds[0] },
    { binding: 'ACCOUNTS', database_name: 'accounts-preview', database_id: previewIds[1] },
    { binding: 'RESEARCH', database_name: 'research-preview', database_id: previewIds[2] },
  ], ratelimits: [{ name: 'API_LIMITER', namespace_id: '1', simple: { limit: 180, period: 60 } }, { name: 'RESOLVE_LIMITER', namespace_id: '2', simple: { limit: 30, period: 60 } }], queues: { producers: [], consumers: [] }, triggers: { crons: ['* * * * *'] } });
  const baselinePlan = put(join(folder, 'preview-plan.json'), { kind: 'solanime-baseline-preview-plan', source: { sha256: baselineHash }, baseline: { counts: { mappings: 423_237 } }, preview: { config: baseWorker } });
  const pagesConfig = put(join(folder, 'cloud', 'pages', 'wrangler.jsonc'), { name: 'solanime', account_id: 'dddddddddddddddddddddddddddddddd', pages_build_output_dir: '../../dist', env: { preview: { services: [{ binding: 'SOLANIME_API', service: 'solanime-api-preview', environment: 'production' }] }, production: { services: [{ binding: 'SOLANIME_API', service: 'solanime-api-preview', environment: 'production' }] } } });
  const base = { version: 1 as const, kind: 'solanime-youtube-review-resources' as const, workerName: 'solanime-api-youtube-review' as const, pagesProject: 'solanime', pagesBranch: 'youtube-official-review' as const, expectedBaseline: { sourceSha256: baselineHash, mappings: 423_237 }, rateLimits: { API_LIMITER: '2026091303', RESOLVE_LIMITER: '2026091304' } };
  const resources: YouTubeReviewResources = storageMode === 'isolated'
    ? { ...base, storageMode, d1: { CATALOGUE: { databaseName: 'solanime-catalogue-youtube-review', databaseId: ids[0] }, ACCOUNTS: { databaseName: 'solanime-accounts-youtube-review', databaseId: ids[1] }, RESEARCH: { databaseName: 'solanime-research-youtube-review', databaseId: ids[2] } } }
    : { ...base, storageMode };
  const resourcePath = put(join(folder, 'resources.json'), resources);
  return { baselinePlan, pagesConfig, resourcePath, resources };
}

afterAll(() => { const exact = resolve(root); if (!exact.startsWith(`${parent}\\`) && !exact.startsWith(`${parent}/`)) throw new Error('Refuse unsafe fixture cleanup.'); rmSync(exact, { recursive: true, force: true }); });

describe('official YouTube review configuration', () => {
  it('never assumes Workers Paid static-asset limits', () => {
    expect(() => assertWorkersFreeStaticAssetLimits({ files: 20_001, maxFileBytes: 1 })).toThrow('Workers Free');
    expect(() => assertWorkersFreeStaticAssetLimits({ files: 1, maxFileBytes: 25 * 1024 * 1024 + 1 })).toThrow('per-file');
    expect(() => assertWorkersFreeStaticAssetLimits({ files: 20_000, maxFileBytes: 25 * 1024 * 1024 })).not.toThrow();
  });

  it('targets a separate private Worker, isolated state, and the Pages preview environment only', () => {
    const value = fixture(), output = join(root, crypto.randomUUID(), 'out');
    const plan = prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources: value.resourcePath, pagesConfig: value.pagesConfig, output });
    const worker = JSON.parse(readFileSync(plan.worker.config, 'utf8'));
    expect(worker).toMatchObject({ name: 'solanime-api-youtube-review', workers_dev: false, preview_urls: false, vars: { SOLANIME_REGISTRATION: 'closed', SOLANIME_READ_ONLY_REVIEW: 'true', SYNC_ENABLED: 'false', SOURCE_REFRESH_ENABLED: 'false' } });
    expect(worker.d1_databases.map((item: { database_id: string }) => item.database_id)).toEqual(ids);
    expect(worker).not.toHaveProperty('secrets'); expect(worker).not.toHaveProperty('queues'); expect(worker).not.toHaveProperty('triggers');
    expect(plan.worker.staticAssets).toMatchObject({ files: 0, freePlanFileLimit: 20_000, fileHeadroom: 20_000, perFileByteLimit: 25 * 1024 * 1024, paidPlanAssumed: false });
    const pages = JSON.parse(readFileSync(plan.pages.config, 'utf8'));
    expect(pages.account_id).toBe('dddddddddddddddddddddddddddddddd');
    expect(pages.env.preview).toMatchObject({ vars: { SOLANIME_REVIEW_MODE: 'youtube-official' }, services: [{ binding: 'SOLANIME_API', service: 'solanime-api-youtube-review', environment: 'production' }] });
    expect(pages.env.production.services[0].service).toBe('solanime-api-preview');
    expect(pages.env.production.vars?.SOLANIME_REVIEW_MODE).toBeUndefined();
    expect(plan.commands.pagesDeployAfterWorkerReview).toContain('youtube-official-review');
    expect(plan.residualSharing.join(' ')).not.toContain('D1 databases');
  });

  it('inherits existing preview D1 bindings only in the generated private config and records residual read-only sharing', () => {
    const value = fixture('shared-preview-read-only'), output = join(root, crypto.randomUUID(), 'out');
    const manifest = JSON.parse(readFileSync(value.resourcePath, 'utf8'));
    expect(manifest).not.toHaveProperty('d1');
    const plan = prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources: value.resourcePath, pagesConfig: value.pagesConfig, output });
    const worker = JSON.parse(readFileSync(plan.worker.config, 'utf8'));
    expect(worker.d1_databases.map((item: { database_id: string }) => item.database_id)).toEqual(previewIds);
    expect(worker.vars.SOLANIME_READ_ONLY_REVIEW).toBe('true');
    expect(worker).not.toHaveProperty('secrets'); expect(worker).not.toHaveProperty('queues'); expect(worker).not.toHaveProperty('triggers');
    expect(plan.storage.mode).toBe('shared-preview-read-only');
    expect(plan.isolation).toMatchObject({ workerService: true, d1Databases: false, d1ApplicationWrites: false, rateLimitNamespaces: true });
    expect(plan.residualSharing).toContain('existing preview D1 databases (read-only application access)');
    expect(plan.prerequisites.join(' ')).toContain('Do not migrate, seed, import, or otherwise mutate');
    expect(plan.worker.staticAssets.paidPlanAssumed).toBe(false);
  });

  it('rejects reuse of an existing D1 database or rate-limit namespace', () => {
    const value = fixture(), reused = JSON.parse(readFileSync(value.resourcePath, 'utf8')) as YouTubeReviewResources;
    if (reused.storageMode !== 'isolated') throw new Error('Expected isolated fixture.');
    reused.d1.CATALOGUE.databaseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const resources = put(join(root, crypto.randomUUID(), 'resources.json'), reused);
    expect(() => prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources, pagesConfig: value.pagesConfig, output: join(root, crypto.randomUUID(), 'out') })).toThrow('distinct');
    const rateReuse = { ...value.resources, d1: structuredClone(value.resources.d1), rateLimits: { ...value.resources.rateLimits, API_LIMITER: '1' } };
    const rates = put(join(root, crypto.randomUUID(), 'resources.json'), rateReuse);
    expect(() => prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources: rates, pagesConfig: value.pagesConfig, output: join(root, crypto.randomUUID(), 'out') })).toThrow('rate-limit');
  });

  it('rejects a stale baseline and any repeated D1 IDs in shared read-only mode', () => {
    const value = fixture('shared-preview-read-only');
    const stale = { ...value.resources, expectedBaseline: { ...value.resources.expectedBaseline, mappings: 423_236 } };
    expect(() => prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources: put(join(root, crypto.randomUUID(), 'stale.json'), stale), pagesConfig: value.pagesConfig, output: join(root, crypto.randomUUID(), 'out') })).toThrow('baseline');
    const repeated = { ...value.resources, d1: { CATALOGUE: { databaseName: 'should-not-be-here', databaseId: ids[0] } } };
    expect(() => prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources: put(join(root, crypto.randomUUID(), 'repeated.json'), repeated), pagesConfig: value.pagesConfig, output: join(root, crypto.randomUUID(), 'out') })).toThrow('do not repeat');
  });

  it('rejects a base Pages config without an explicit reviewed account', () => {
    const value = fixture();
    const pages = JSON.parse(readFileSync(value.pagesConfig, 'utf8'));
    delete pages.account_id;
    writeFileSync(value.pagesConfig, JSON.stringify(pages));
    expect(() => prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources: value.resourcePath, pagesConfig: value.pagesConfig, output: join(root, crypto.randomUUID(), 'out') })).toThrow('account_id');
  });
});

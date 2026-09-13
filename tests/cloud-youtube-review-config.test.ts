import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertWorkersFreeStaticAssetLimits, prepareYouTubeReview, type YouTubeReviewResources } from '../scripts/cloud-data/prepare-youtube-review.ts';

const parent = resolve(process.env.SOLANIME_TEST_TMP || '../solanime-cloud-artifacts/tmp'); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'youtube-review-config-'));
const put = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); return path; };
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

function fixture() {
  const folder = join(root, crypto.randomUUID()), assets = join(folder, 'assets'); mkdirSync(assets, { recursive: true });
  const main = put(join(folder, 'worker.ts'), 'const hasEnabledOfficialYouTubeResource=true; const resolveApprovedPlayback=true; export default {};');
  const baseWorker = put(join(folder, 'wrangler.preview.json'), { name: 'solanime-api-preview', main, workers_dev: false, preview_urls: true, assets: { directory: assets, binding: 'IMPORT_ASSETS', run_worker_first: true }, vars: { RELEASE_CHANNEL: 'preview' }, d1_databases: [
    { binding: 'CATALOGUE', database_name: 'catalogue-preview', database_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { binding: 'ACCOUNTS', database_name: 'accounts-preview', database_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { binding: 'RESEARCH', database_name: 'research-preview', database_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
  ], ratelimits: [{ name: 'API_LIMITER', namespace_id: '1', simple: { limit: 180, period: 60 } }, { name: 'RESOLVE_LIMITER', namespace_id: '2', simple: { limit: 30, period: 60 } }], queues: { producers: [], consumers: [] }, triggers: { crons: ['* * * * *'] } });
  const baselinePlan = put(join(folder, 'preview-plan.json'), { kind: 'solanime-baseline-preview-plan', preview: { config: baseWorker } });
  const pagesConfig = put(join(folder, 'cloud', 'pages', 'wrangler.jsonc'), { name: 'solanime', pages_build_output_dir: '../../dist', env: { preview: { services: [{ binding: 'SOLANIME_API', service: 'solanime-api-preview', environment: 'production' }] }, production: { services: [{ binding: 'SOLANIME_API', service: 'solanime-api-preview', environment: 'production' }] } } });
  const resources: YouTubeReviewResources = { version: 1, kind: 'solanime-isolated-youtube-review-resources', workerName: 'solanime-api-youtube-review', pagesProject: 'solanime', pagesBranch: 'youtube-official-review', d1: { CATALOGUE: { databaseName: 'solanime-catalogue-youtube-review', databaseId: ids[0] }, ACCOUNTS: { databaseName: 'solanime-accounts-youtube-review', databaseId: ids[1] }, RESEARCH: { databaseName: 'solanime-research-youtube-review', databaseId: ids[2] } }, rateLimits: { API_LIMITER: '2026091303', RESOLVE_LIMITER: '2026091304' } };
  const resourcePath = put(join(folder, 'resources.json'), resources);
  return { baselinePlan, pagesConfig, resourcePath, resources };
}

afterAll(() => { const exact = resolve(root); if (!exact.startsWith(`${parent}\\`) && !exact.startsWith(`${parent}/`)) throw new Error('Refuse unsafe fixture cleanup.'); rmSync(exact, { recursive: true, force: true }); });

describe('official YouTube isolated review configuration', () => {
  it('never assumes Workers Paid static-asset limits', () => {
    expect(() => assertWorkersFreeStaticAssetLimits({ files: 20_001, maxFileBytes: 1 })).toThrow('Workers Free');
    expect(() => assertWorkersFreeStaticAssetLimits({ files: 1, maxFileBytes: 25 * 1024 * 1024 + 1 })).toThrow('per-file');
    expect(() => assertWorkersFreeStaticAssetLimits({ files: 20_000, maxFileBytes: 25 * 1024 * 1024 })).not.toThrow();
  });

  it('targets a separate private Worker, isolated state, and the Pages preview environment only', () => {
    const value = fixture(), output = join(root, crypto.randomUUID(), 'out');
    const plan = prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources: value.resourcePath, pagesConfig: value.pagesConfig, output });
    const worker = JSON.parse(readFileSync(plan.worker.config, 'utf8'));
    expect(worker).toMatchObject({ name: 'solanime-api-youtube-review', workers_dev: false, preview_urls: false, vars: { SOLANIME_REGISTRATION: 'closed', SYNC_ENABLED: 'false', SOURCE_REFRESH_ENABLED: 'false' } });
    expect(worker.d1_databases.map((item: { database_id: string }) => item.database_id)).toEqual(ids);
    expect(worker).not.toHaveProperty('queues'); expect(worker).not.toHaveProperty('triggers');
    expect(plan.worker.staticAssets).toMatchObject({ files: 0, freePlanFileLimit: 20_000, fileHeadroom: 20_000, perFileByteLimit: 25 * 1024 * 1024, paidPlanAssumed: false });
    const pages = JSON.parse(readFileSync(plan.pages.config, 'utf8'));
    expect(pages.env.preview).toMatchObject({ vars: { SOLANIME_REVIEW_MODE: 'youtube-official' }, services: [{ binding: 'SOLANIME_API', service: 'solanime-api-youtube-review', environment: 'production' }] });
    expect(pages.env.production.services[0].service).toBe('solanime-api-preview');
    expect(pages.env.production.vars?.SOLANIME_REVIEW_MODE).toBeUndefined();
    expect(plan.commands.pagesDeployAfterWorkerReview).toContain('youtube-official-review');
    expect(plan.residualSharing).not.toContain('D1 databases');
  });

  it('rejects reuse of an existing D1 database or rate-limit namespace', () => {
    const value = fixture(), reused = JSON.parse(readFileSync(value.resourcePath, 'utf8')) as YouTubeReviewResources;
    reused.d1.CATALOGUE.databaseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const resources = put(join(root, crypto.randomUUID(), 'resources.json'), reused);
    expect(() => prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources, pagesConfig: value.pagesConfig, output: join(root, crypto.randomUUID(), 'out') })).toThrow('distinct');
    const rateReuse = { ...value.resources, d1: structuredClone(value.resources.d1), rateLimits: { ...value.resources.rateLimits, API_LIMITER: '1' } };
    const rates = put(join(root, crypto.randomUUID(), 'resources.json'), rateReuse);
    expect(() => prepareYouTubeReview({ baselinePlan: value.baselinePlan, resources: rates, pagesConfig: value.pagesConfig, output: join(root, crypto.randomUUID(), 'out') })).toThrow('rate-limit');
  });
});

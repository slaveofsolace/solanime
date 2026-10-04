import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Pages publishes this JavaScript gateway directly; its runtime contract is tested below.
import gateway from '../public/_worker.js';

describe('private snapshot publication boundary', () => {
  it('binds Pages production to the live API service and Pages preview to the isolated staging service', () => {
    const pages = JSON.parse(readFileSync('cloud/pages/wrangler.jsonc', 'utf8'));
    const worker = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(pages.name).toBe('solanime');
    expect(pages.env.production.services).toEqual([
      { binding: 'SOLANIME_API', service: worker.name, environment: 'production' },
    ]);
    expect(pages.env.preview.services).toEqual([
      { binding: 'SOLANIME_API', service: worker.env.staging.name, environment: 'production' },
    ]);
    for (const environment of ['preview', 'production']) expect(pages.env[environment].d1_databases).toBeUndefined();
    // Pages environments do not inherit non-inheritable service bindings.
    expect(pages.account_id).toBeUndefined();
  });
  it('keeps staging on its own Worker, databases, queue, limiter namespaces and origin', () => {
    const worker = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const staging = worker.env.staging;
    expect(staging.name).not.toBe(worker.name);
    const ids = (config: { d1_databases: { binding: string; database_id: string; database_name: string }[] }) => config.d1_databases;
    expect(ids(staging).map(item => item.binding)).toEqual(ids(worker).map(item => item.binding));
    for (const database of ids(staging)) {
      expect(ids(worker).map(item => item.database_id)).not.toContain(database.database_id);
      expect(ids(worker).map(item => item.database_name)).not.toContain(database.database_name);
    }
    expect(staging.queues.producers[0].queue).not.toBe(worker.queues.producers[0].queue);
    expect(staging.queues.consumers[0].queue).toBe(staging.queues.producers[0].queue);
    const namespaces = worker.ratelimits.map((item: { namespace_id: string }) => item.namespace_id);
    for (const limiter of staging.ratelimits) expect(namespaces).not.toContain(limiter.namespace_id);
    expect(staging.vars.FIREBASE_PROJECT_ID).not.toBe(worker.vars.FIREBASE_PROJECT_ID);
    expect(staging.vars.RELEASE_CHANNEL).toBe('staging');
    expect(worker.vars.RELEASE_CHANNEL).toBe('production');
    // A preview origin must never pass CSRF/origin checks on the live API.
    expect(worker.vars.SOLANIME_ALLOWED_ORIGINS.split(',')).not.toContain(staging.vars.SOLANIME_APP_ORIGIN);
    expect(staging.vars.SOLANIME_ALLOWED_ORIGINS.split(',')).not.toContain(worker.vars.SOLANIME_APP_ORIGIN);
    expect(staging.secrets.required).toEqual(worker.secrets.required);
  });
  it('routes exact API and private asset paths through the rejecting Pages gateway', () => {
    const routes = JSON.parse(readFileSync('public/_routes.json', 'utf8'));
    expect(routes.include).toEqual(expect.arrayContaining(['/api', '/api/*', '/__private-import/*', '/__private-baseline/*']));
    expect(routes.exclude).toEqual([]);
  });
  it('never invokes static assets for a private import path', async () => {
    let fetched = false;
    const response = await gateway.fetch(new Request('https://solanime.example/__private-import/test/manifest.json'), { ASSETS: { fetch: async () => { fetched = true; return new Response('private'); } } });
    expect(response.status).toBe(404);
    expect(fetched).toBe(false);
  });
  it('never invokes static assets for a private catalogue baseline path', async () => {
    let fetched = false;
    const response = await gateway.fetch(new Request('https://solanime.example/__private-baseline/test/manifest.json'), { ASSETS: { fetch: async () => { fetched = true; return new Response('private'); } } });
    expect(response.status).toBe(404);
    expect(fetched).toBe(false);
  });
  it('requires private Worker assets to run through Worker-first routing with no public Worker URL', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.assets.binding).toBe('IMPORT_ASSETS');
    expect(config.assets.directory).toMatch(/^\.\/build\/cloud-worker-assets(?:-[a-z0-9-]+)?$/);
    expect(config.assets.run_worker_first).toBe(true);
    expect(config.assets.html_handling).toBe('none');
    expect(config.assets.not_found_handling).toBe('none');
    // An environment-specific asset directory must retain the private routing
    // contract instead of accidentally publishing its catalogue snapshots.
    const stagingAssets = config.env.staging.assets ?? config.assets;
    expect(stagingAssets.binding).toBe('IMPORT_ASSETS');
    expect(stagingAssets.directory).toMatch(/^\.\/build\/cloud-worker-assets(?:-[a-z0-9-]+)?$/);
    expect(stagingAssets.run_worker_first).toBe(true);
    expect(stagingAssets.html_handling).toBe('none');
    expect(stagingAssets.not_found_handling).toBe('none');
    expect(config.queues.consumers[0].max_batch_size).toBe(1);
    expect(config.vars.CATALOGUE_BASELINE_ENABLED).toBe('true');
    expect(config.vars.CATALOGUE_BASELINE_ID).toMatch(/^[a-f0-9]{64}$/);
    expect(config.vars.CATALOGUE_BASELINE_MANIFEST_SHA256).toMatch(/^[a-f0-9]{64}$/);
  });
});

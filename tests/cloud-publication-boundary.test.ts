import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Pages publishes this JavaScript gateway directly; its runtime contract is tested below.
import gateway from '../public/_worker.js';

describe('private snapshot publication boundary', () => {
  it('binds both Pages environments to the existing private API service explicitly', () => {
    const pages = JSON.parse(readFileSync('cloud/pages/wrangler.jsonc', 'utf8'));
    const worker = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(pages.name).toBe('solanime');
    for (const environment of ['preview', 'production']) {
      expect(pages.env[environment].services).toEqual([
        { binding: 'SOLANIME_API', service: worker.name, environment: 'production' },
      ]);
      expect(pages.env[environment].d1_databases).toBeUndefined();
    }
    // Pages environments do not inherit non-inheritable service bindings.
    // Sharing the reviewed service also avoids creating duplicate free-plan DBs.
    expect(pages.account_id).toBeUndefined();
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
    expect(config.queues.consumers[0].max_batch_size).toBe(1);
    expect(config.vars.CATALOGUE_BASELINE_ENABLED).toBe('true');
    expect(config.vars.CATALOGUE_BASELINE_ID).toMatch(/^[a-f0-9]{64}$/);
    expect(config.vars.CATALOGUE_BASELINE_MANIFEST_SHA256).toMatch(/^[a-f0-9]{64}$/);
  });
});

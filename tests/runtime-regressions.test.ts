import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { openDatabase, migrate } from '../server/db';
import { requireSafeMutation } from '../server/security';
const disposers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  vi.unstubAllEnvs();
});
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'solanime-regression-'));
  disposers.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function runtime() {
  const root = temp();
  const dist = join(root, 'dist');
  mkdirSync(dist);
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><title>Sol Anime</title><div id="root"></div>',
  );
  writeFileSync(join(dist, 'assets', 'app-test.js'), 'console.log("asset")');
  writeFileSync(join(dist, '.env'), 'SECRET=private');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'private.js'), 'private');
  // Directory junctions preserve the realpath-escape assertion without requiring
  // Windows developer mode or administrator privileges for a file symlink.
  symlinkSync(outside, join(dist, 'leak'), process.platform === 'win32' ? 'junction' : 'dir');
  const db = openDatabase(':memory:');
  migrate(db);
  const server = createApp(db, { staticDirectory: dist });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  disposers.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
describe('production runtime', () => {
  it('serves deep links, HEAD, and conditional requests', async () => {
    const origin = await runtime();
    const response = await fetch(`${origin}/watch/title/1?language=sub`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Sol Anime');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const asset = await fetch(`${origin}/assets/app-test.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(
      (
        await fetch(`${origin}/assets/app-test.js`, {
          headers: { 'if-none-match': asset.headers.get('etag')! },
        })
      ).status,
    ).toBe(304);
    const head = await fetch(`${origin}/catalogue`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
  it('does not serve API failures, missing assets, dotfiles or escaping symlinks as HTML', async () => {
    const origin = await runtime();
    for (const path of [
      '/api/not-real',
      '/assets/missing.js',
      '/.env',
      '/leak/private.js',
      '/%5c..%5c.env',
      '/_worker.js',
    ]) {
      const response = await fetch(origin + path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
    }
  });
  it('detects LFS pointers without overwriting them', () => {
    const path = join(temp(), 'data.sqlite');
    const pointer =
      'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 1234\n';
    writeFileSync(path, pointer);
    expect(() => openDatabase(path)).toThrow(/lfs/i);
    expect(readFileSync(path, 'utf8')).toBe(pointer);
  });
});
describe('mutation origins', () => {
  it('does not trust another localhost port', () => {
    expect(() =>
      requireSafeMutation(
        {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:9999',
          'content-type': 'application/json',
        },
        { requireJson: true },
      ),
    ).toThrow();
  });
  it('allows an exact origin or configured gateway', () => {
    expect(() =>
      requireSafeMutation(
        {
          host: '127.0.0.1:5173',
          origin: 'http://127.0.0.1:5173',
          'content-type': 'application/json',
        },
        { requireJson: true },
      ),
    ).not.toThrow();
    vi.stubEnv('SOLANIME_ALLOWED_ORIGINS', 'https://solanime.pages.dev');
    expect(() =>
      requireSafeMutation(
        {
          host: 'api.example.com',
          origin: 'https://solanime.pages.dev',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        { requireJson: true },
      ),
    ).not.toThrow();
  });
});

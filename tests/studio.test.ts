import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeStored, defaultPreferences } from '../src/lib/storage';
import { validateData } from '../server/accounts/validation';
import { motionReduced } from '../src/lib/motion';
import { RELEASE } from '../shared/release';
// @ts-expect-error Production deployment command uses standard JS and Web APIs.
import { inspectDeployment } from '../scripts/verify-deployment.mjs';
afterEach(() => vi.unstubAllGlobals());
describe('legacy preference migration (no longer controls playback access)', () => {
  it.each([undefined, null, {}, { theme: 'light', accent: '#00AA88' }])(
    'preserves old preference shape without enabling provider embeds: %j',
    (value) => {
      expect(decodeStored('preferences', value, defaultPreferences)).toMatchObject({
        embedMode: 'compatible',
        motion: 'system',
      });
    },
  );
  it('retains unrelated settings while accepting legacy profile records', () => {
    const value = { embedMode: 'restricted', motion: 'reduced', theme: 'light', accent: '#00AA88' };
    const server = validateData('preferences', value);
    expect(decodeStored('preferences', server, defaultPreferences)).toMatchObject(value);
  });
  it('normalizes unknown legacy records', () => {
    expect(validateData('preferences', { embedMode: 'legacy', motion: [] })).toMatchObject({
      embedMode: 'compatible',
      motion: 'system',
    });
  });
});
describe('motion and release diagnostics', () => {
  it.each([
    [false, 'system', false],
    [true, 'system', true],
    [false, 'reduced', true],
    [true, 'reduced', true],
  ])('respects device %s and application %s', (os, mode, expected) => {
    vi.stubGlobal('document', { documentElement: { dataset: { motion: mode } } });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: os }) });
    expect(motionReduced()).toBe(expected);
  });
  it('versions are synchronized in the package, shared API constant and served document', () => {
    expect(JSON.parse(readFileSync('package.json', 'utf8')).version).toBe(RELEASE);
    expect(readFileSync('index.html', 'utf8')).toContain(
      `name="solanime-release" content="${RELEASE}"`,
    );
  });
  const response =
    (
      backend = RELEASE,
      frontend = RELEASE,
      csp = "default-src 'self'; frame-src 'none'; frame-ancestors 'none'",
    ) =>
    async (url: string) =>
      url.includes('/api/')
        ? Response.json({ status: 'ok', release: backend })
        : new Response(`<meta name="solanime-release" content="${frontend}">`, {
            headers: { 'content-security-policy': csp },
          });
  it('accepts the correct deployed frontend and API', async () =>
    expect((await inspectDeployment('https://app.example', response())).passed).toBe(true));
  it('rejects a stale frontend or wrong API release', async () => {
    expect((await inspectDeployment('https://app.example', response('0.4.0'))).passed).toBe(false);
    expect(
      (await inspectDeployment('https://app.example', response(RELEASE, '0.4.0'))).passed,
    ).toBe(false);
  });
  it('reports inherited document sandbox headers', async () =>
    expect(
      (
        await inspectDeployment(
          'https://app.example',
          response(RELEASE, RELEASE, "default-src 'self'; sandbox allow-scripts;"),
        )
      ).checks.noParentSandboxPolicy,
    ).toBe(false));
  it('does not pass an HTML fallback off as a running API', async () =>
    expect(
      (
        await inspectDeployment(
          'https://app.example',
          async () => new Response('<html>Fallback</html>'),
        )
      ).passed,
    ).toBe(false));
});

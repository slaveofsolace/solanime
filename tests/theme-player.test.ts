import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, contrast, normalizeAccent, themeTokens } from '../src/lib/theme';
import { decodeStored } from '../src/lib/storage';
import { PLAYER_SANDBOX, PLAYER_PERMISSIONS, playbackUrl } from '../src/lib/playerPolicy';
import { formatTime } from '../src/components/MediaControls';
import {
  buildRules,
  isProjectUrl,
  isProviderUrl,
  playerCss,
  validateHosts,
  settings,
} from '../extensions/solanime-guard/policy.js';
import { readFileSync } from 'node:fs';
describe('cinema accent tokens', () => {
  it.each([undefined, null, {}, '#fff', 'red', '#12ABCD;display:none', '#ZZZZZZ'])(
    'rejects unsafe stored accent: %j',
    (value) => expect(normalizeAccent(value)).toBe('#E50914'),
  );
  it('migrates preferences while preserving unrelated choices', () =>
    expect(
      decodeStored(
        'preferences',
        { accent: '#abcdef', theme: 'light', preferredLanguage: 'dub' },
        {},
      ),
    ).toMatchObject({ accent: '#ABCDEF', theme: 'light', preferredLanguage: 'dub' }));
  it.each(['dark', 'light'] as const)(
    'preserves fills with readable %s text across sampled colors',
    (mode) => {
      const colors = [...ACCENT_PRESETS.map((p) => p.value), '#FFFFFF', '#000000', '#141414'];
      for (let i = 0; i < 256; i++)
        colors.push('#' + ((i * 65793 * 71) % 16777216).toString(16).padStart(6, '0'));
      const surfaces =
        mode === 'dark' ? ['#141414', '#181818', '#2B2B2B'] : ['#FFFFFF', '#F5F5F5', '#E7E7E7'];
      for (const color of colors) {
        const t = themeTokens(color, mode);
        expect(t.accent).toBe(color.toUpperCase());
        expect(contrast(t.accent, t.foreground)).toBeGreaterThanOrEqual(4.5);
        for (const surface of surfaces)
          expect(contrast(t.ink, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.playerInk, '#2B2B2B')).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
describe('player boundary', () => {
  it('keeps only playback permissions in the iframe', () => {
    expect(PLAYER_SANDBOX.split(' ').sort()).toEqual(['allow-same-origin', 'allow-scripts']);
    for (const item of [
      'allow-popups',
      'allow-top-navigation',
      'allow-downloads',
      'allow-forms',
      'allow-popups-to-escape-sandbox',
    ])
      expect(PLAYER_SANDBOX).not.toContain(item);
    expect(PLAYER_PERMISSIONS).toContain("camera 'none'");
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'http://megaplay.buzz/stream/x',
    'https://megaplay.buzz.evil.test/stream/x',
    'https://user:pass@megaplay.buzz/stream/x',
    'https://megaplay.buzz:8443/stream/x',
    '/local-player',
    'https://megaplay.buzz/not-stream/x',
  ])('does not embed untrusted address %s', (url) =>
    expect(playbackUrl(url, 'iframe', 'http://127.0.0.1:5173')).toBeNull(),
  );
  it('accepts exact provider embeds and same-origin test media', () => {
    expect(
      playbackUrl('https://megaplay.buzz/stream/s-2/id', 'iframe', 'http://127.0.0.1:5173'),
    ).toBeTruthy();
    expect(playbackUrl('/test.mp4', 'direct', 'http://127.0.0.1:5173')).toBe(
      'http://127.0.0.1:5173/test.mp4',
    );
    expect(playbackUrl('http://other.test/test.mp4', 'direct', 'http://127.0.0.1:5173')).toBeNull();
  });
  it.each([
    [NaN, '0:00'],
    [-2, '0:00'],
    [59.8, '0:59'],
    [60, '1:00'],
    [3661, '1:01:01'],
  ])('formats time %s', (value, result) => expect(formatTime(Number(value))).toBe(result));
});
describe('Guard permissions and scoped policy', () => {
  it.each([
    'https://solanime.pages.dev/',
    'https://review.solanime.pages.dev/watch/title/1',
    'http://127.0.0.1:18787/',
    'http://127.0.0.1:5173/',
  ])('recognizes owned project URL %s', (url) => expect(isProjectUrl(url)).toBe(true));
  it.each([
    'https://evil.test/?solanime.pages.dev',
    'https://solanime.pages.dev.evil.test',
    'http://127.0.0.1:9999',
    'http://localhost:5173',
    'https://another.pages.dev',
    'https://user:pass@solanime.pages.dev',
    'https://solanime.pages.dev:8443',
  ])('leaves unrelated origin untouched %s', (url) => expect(isProjectUrl(url)).toBe(false));
  it('requires the verified provider path', () => {
    expect(isProviderUrl('https://megaplay.buzz/stream/x')).toBe(true);
    expect(isProviderUrl('https://megaplay.buzz/account')).toBe(false);
  });
  it('never creates global rules and disables cleanly', () => {
    expect(buildRules([], settings({}))).toEqual([]);
    expect(buildRules([5], settings({ enabled: false }))).toEqual([]);
    const rules = buildRules([5, 5, -1], settings({}));
    expect(rules).toHaveLength(3);
    for (const rule of rules) {
      expect(rule.condition.tabIds).toEqual([5]);
      expect(rule.condition.initiatorDomains).toEqual(['megaplay.buzz']);
      expect(rule.action.type).toBe('block');
    }
  });
  it('makes strict mode opt-in with bounded domain exceptions', () => {
    const rules = buildRules([5], settings({ strict: true, mediaHosts: ['cdn.example.com'] }));
    expect(rules).toHaveLength(4);
    expect(rules[3].condition.excludedRequestDomains).toEqual(['megaplay.buzz', 'cdn.example.com']);
    expect(rules[0].condition.requestDomains).toContain('google-analytics.com');
  });
  it.each([
    ['*'],
    ['http://cdn.test'],
    ['127.0.0.1'],
    ['cdn.test/path'],
    ['a'.repeat(255) + '.com'],
  ])('rejects unsafe exception %j', (value) => expect(() => validateHosts(value)).toThrow());
  it('injects only validated colors and no hidden advertisements/controls heuristic', () => {
    const css = playerCss({ accent: 'red;}body{display:none;', ink: '#00FF00' });
    expect(css).toContain('#E50914');
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('red;}');
    expect(css).toContain('#00FF00');
  });
  it('does not request broad content or cookie permissions', () => {
    const manifest = JSON.parse(readFileSync('extensions/solanime-guard/manifest.json', 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.host_permissions).not.toContain('<all_urls>');
    expect(manifest).not.toHaveProperty('externally_connectable');
  });
});

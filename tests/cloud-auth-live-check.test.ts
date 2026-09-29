import { describe, expect, it } from 'vitest';
import { LIVE_CHECK_PREVIEW_ORIGIN, LIVE_CHECK_PRODUCTION_ORIGIN, parseLiveCheckOptions } from '../scripts/cloud-auth/live-check-options';

describe('bounded live authentication QA arguments', () => {
  it('defaults to a read-only preview and preserves explicit preview execution', () => {
    expect(parseLiveCheckOptions([])).toEqual({ origin: LIVE_CHECK_PREVIEW_ORIGIN, execute: false, holdOnFailure: false, allowProduction: false });
    expect(parseLiveCheckOptions(['--origin', LIVE_CHECK_PREVIEW_ORIGIN, '--execute', '--hold-on-failure']))
      .toEqual({ origin: LIVE_CHECK_PREVIEW_ORIGIN, execute: true, holdOnFailure: true, allowProduction: false });
  });
  it('requires the canonical origin and an independent production opt-in, even for a read-only request', () => {
    expect(() => parseLiveCheckOptions(['--origin', LIVE_CHECK_PRODUCTION_ORIGIN])).toThrow('--allow-production');
    expect(() => parseLiveCheckOptions(['--origin', LIVE_CHECK_PRODUCTION_ORIGIN, '--execute'])).toThrow('--allow-production');
    expect(parseLiveCheckOptions(['--origin', LIVE_CHECK_PRODUCTION_ORIGIN, '--allow-production']))
      .toEqual({ origin: LIVE_CHECK_PRODUCTION_ORIGIN, execute: false, holdOnFailure: false, allowProduction: true });
    expect(parseLiveCheckOptions(['--execute', '--allow-production', '--hold-on-failure', '--origin', LIVE_CHECK_PRODUCTION_ORIGIN]))
      .toEqual({ origin: LIVE_CHECK_PRODUCTION_ORIGIN, execute: true, holdOnFailure: true, allowProduction: true });
  });
  it.each([
    'https://solanime.pages.dev/', 'https://solanime.pages.dev:443', 'http://solanime.pages.dev',
    'https://SOLANIME.pages.dev', 'https://solanime.pages.dev.evil.test', 'https://unrelated.pages.dev',
    'https://solanime.pages.dev/path', 'https://solanime.pages.dev?origin=preview', 'https://solanime.pages.dev#preview',
    'https://cloud-release.solanime.pages.dev/', 'https://127.0.0.1', ' https://solanime.pages.dev',
  ])('rejects alternate origin spelling without following or normalizing it: %s', origin => {
    expect(() => parseLiveCheckOptions(['--origin', origin, '--execute', '--allow-production'])).toThrow('exact Solanime');
  });
  it('rejects a misleading production flag on the default or explicit preview', () => {
    expect(() => parseLiveCheckOptions(['--allow-production'])).toThrow('only with the exact canonical');
    expect(() => parseLiveCheckOptions(['--origin', LIVE_CHECK_PREVIEW_ORIGIN, '--allow-production'])).toThrow('only with the exact canonical');
  });
  it.each([
    ['--origin'], ['--origin', '--execute'], ['--origin', ''], ['--unknown'],
    ['--origin=https://solanime.pages.dev', '--allow-production'],
    ['--origin', LIVE_CHECK_PREVIEW_ORIGIN, '--origin', LIVE_CHECK_PRODUCTION_ORIGIN, '--allow-production'],
    ['--execute', '--execute'], ['--allow-production', '--allow-production'], ['--hold-on-failure', '--hold-on-failure'],
  ])('fails closed on incomplete, duplicate or unknown arguments: %j', (...args) => {
    expect(() => parseLiveCheckOptions(args)).toThrow();
  });
});

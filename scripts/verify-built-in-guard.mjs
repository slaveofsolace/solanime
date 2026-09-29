import { chromium } from '@playwright/test';
// Historical 0.8.3 sandbox diagnostic, not the current release gate.
// For 0.8.4+, use verify-provider-playback.mjs --protection=browser.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = new Map(
  process.argv.slice(2).map((entry) => {
    const [key, ...rest] = entry.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : 'true'];
  }),
);

const origin = String(args.get('origin') ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const outputPath = resolve(String(args.get('output') ?? `test-results/built-in-guard-${Date.now()}.json`));
const timeoutMs = Math.max(10_000, Math.min(90_000, Number(args.get('timeout-ms') ?? 30_000)));
const watchUrl =
  args.get('watch-url') ??
  `${origin}/watch/bungaku-shoujo-kyou-no-oyatsu-hatsukoi-a9cps/88309?language=sub&server=254486`;

mkdirSync(dirname(outputPath), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const result = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  origin,
  watchUrl,
  guardActive: null,
  iframePresent: false,
  sandboxPresent: null,
  sandbox: null,
  guardMode: null,
  providerFrameUrl: null,
  label: null,
  progressFrom: null,
  progressTo: null,
  playbackProgress: false,
  containmentConfigured: false,
  popupCount: 0,
  parentStable: false,
  providerRejectedSandbox: false,
  passed: false,
  reason: null,
};
page.on('popup', popup => { result.popupCount++; void popup.close(); });

try {
  await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  result.guardActive = await page.locator('html').getAttribute('data-solanime-guard');
  const frame = page.locator('iframe[title="MegaPlay provider player"]');
  await frame.waitFor({ state: 'attached', timeout: timeoutMs });
  result.iframePresent = true;
  result.sandboxPresent = await frame.evaluate((node) => node.hasAttribute('sandbox'));
  result.sandbox = await frame.getAttribute('sandbox');
  result.providerFrameUrl = await frame.getAttribute('src');
  result.guardMode = await page.locator('.provider-player').getAttribute('data-guard-mode');
  result.label = await page.locator('.provider-player__label').innerText({ timeout: timeoutMs });
  if (
    result.guardActive !== null ||
    result.guardMode !== 'built-in' ||
    !result.providerFrameUrl?.startsWith('https://megaplay.buzz/stream/s-2/') ||
    result.sandboxPresent !== true ||
    result.sandbox !== 'allow-scripts allow-same-origin allow-presentation'
  ) {
    throw new Error('Built-in Guard did not create the expected provider iframe.');
  }
  // Configuration is not proof of either media progress or active attack blocking.
  // The latter is covered by the adversarial provider-player browser test.
  result.containmentConfigured = true;
  await page.getByText(/Provider playback · MegaPlay/).waitFor({ state: 'visible', timeout: timeoutMs });
  const player = page.locator('.provider-player[data-playback-position]');
  await player.waitFor({ state: 'visible', timeout: timeoutMs });
  result.progressFrom = Number(await player.getAttribute('data-playback-position'));
  await page.waitForFunction(
    (from) => {
      const node = document.querySelector('.provider-player[data-playback-position]');
      const current = Number(node?.getAttribute('data-playback-position'));
      return Number.isFinite(current) && current > Number(from) + 0.1;
    },
    result.progressFrom,
    { timeout: timeoutMs },
  );
  result.progressTo = Number(await player.getAttribute('data-playback-position'));
  result.playbackProgress =
    Number.isFinite(result.progressFrom) &&
    Number.isFinite(result.progressTo) &&
    result.progressTo > result.progressFrom + 0.1;
  if (!result.playbackProgress) throw new Error('Provider time did not advance in built-in guard mode.');
  result.parentStable = page.url() === watchUrl;
  result.passed = result.parentStable && result.popupCount === 0;
  if (!result.passed) result.reason = 'Unexpected popup or parent navigation.';
} catch (error) {
  result.reason = error instanceof Error ? error.message : String(error);
} finally {
  result.parentStable = page.url() === watchUrl;
  const provider = page.frames().find(frame => frame.url().startsWith('https://megaplay.buzz/stream/s-2/'));
  if (provider) {
    const text = await provider.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
    result.providerRejectedSandbox = /sandbox.{0,100}(not allowed|remove)|remove.{0,50}sandbox/i.test(text);
    if (result.providerRejectedSandbox) {
      result.passed = false;
      result.reason = 'Provider explicitly rejects the built-in browser sandbox; time reports alone do not verify usable playback.';
    }
  }
  if (args.has('screenshot')) await page.screenshot({ path: resolve(args.get('screenshot')), fullPage: true }).catch(() => {});
  await browser.close();
}

writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...result, outputPath }, null, 2));
if (!result.passed) process.exitCode = 1;

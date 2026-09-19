import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';
const directory = resolve('extensions/solanime-guard');
let context;
test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
  });
});
test.afterEach(async () => {
  await context?.close();
});
test('unpacked Guard scopes DNR rules, styles a foreign frame, syncs accents and disables cleanly', async ({}, info) => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const fixture =
    '<!doctype html><html lang="en" data-accent="#24BFA5" data-theme="dark" style="--player-accent:#24BFA5"><head><title>Guard test</title></head><body><h1>Solanime fixture</h1><iframe src="https://megaplay.buzz/stream/fixture" title="Controlled provider"></iframe></body></html>';
  await page.route('http://127.0.0.1:18787/__guard', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  await page.route('https://megaplay.buzz/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Provider fixture</title><style>.jw-progress{height:10px;background:blue}</style></head><body><div class="jwplayer"><div class="jw-slider-horizontal"><div class="jw-progress"></div></div><button class="jw-icon">Play</button><button id="popup" onclick="window.open(\'https://popads.net/guard-popup\')">Popup</button></div></body></html>',
    }),
  );
  await page.goto('http://127.0.0.1:18787/__guard');
  await expect(page.locator('html')).toHaveAttribute('data-solanime-guard', 'active');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('.jw-progress')).toHaveCSS('background-color', 'rgb(36, 191, 165)');
  const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  expect(rules).toHaveLength(3);
  const tabId = rules[0].condition.tabIds[0];
  const match = await worker.evaluate(
    async ({ tabId }) =>
      chrome.declarativeNetRequest.testMatchOutcome({
        url: 'https://google-analytics.com/collect',
        initiator: 'https://megaplay.buzz',
        type: 'xmlhttprequest',
        tabId,
      }),
    { tabId },
  );
  expect(match.matchedRules.length).toBeGreaterThan(0);
  const unrelated = await worker.evaluate(
    async ({ tabId }) =>
      chrome.declarativeNetRequest.testMatchOutcome({
        url: 'https://google-analytics.com/collect',
        initiator: 'https://unrelated.example',
        type: 'xmlhttprequest',
        tabId,
      }),
    { tabId },
  );
  expect(unrelated.matchedRules).toEqual([]);
  const navigation = await worker.evaluate(async () =>
    chrome.declarativeNetRequest.testMatchOutcome({
      url: 'https://popads.net/guard-popup',
      initiator: 'https://megaplay.buzz',
      type: 'main_frame',
      tabId: 999999,
    }),
  );
  expect(navigation.matchedRules.some((rule) => rule.ruleId === 3)).toBe(true);
  // Observe a genuine failed network request, not just rule syntax or a synthetic counter.
  const failure = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().startsWith('https://google-analytics.com/collect'),
  });
  const provider = page.frames().find((frame) => frame.url().includes('megaplay.buzz'));
  await provider.evaluate(() =>
    fetch('https://google-analytics.com/collect?solanime-test=1').catch(() => null),
  );
  const failed = await failure;
  expect(failed.failure().errorText).toContain('ERR_BLOCKED_BY_CLIENT');
  const pagesBeforePopup = context.pages().length;
  await frame.locator('#popup').click();
  await expect.poll(() => context.pages().length).toBe(pagesBeforePopup);
  expect(context.pages().some((candidate) => candidate.url().includes('popads.net'))).toBe(false);
  await page.evaluate(() => {
    document.documentElement.dataset.accent = '#A78BFA';
    document.documentElement.style.setProperty('--player-accent', '#A78BFA');
  });
  await expect(frame.locator('.jw-progress')).toHaveCSS('background-color', 'rgb(167, 139, 250)');
  await page.screenshot({ path: info.outputPath('guard-accent-sync.png') });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.locator('#enabled')).toBeChecked();
  await popup.locator('#enabled').uncheck();
  await popup.getByRole('button', { name: 'Save settings' }).click();
  await expect(popup.locator('#status')).toHaveText('Settings saved');
  await expect
    .poll(() => worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()))
    .toEqual([]);
  await expect(frame.locator('.jw-progress')).toHaveCSS('background-color', 'rgb(0, 0, 255)');
  await popup.locator('#enabled').check();
  await popup.locator('#strict').check();
  await popup.locator('#hosts').fill('cdn.example.com');
  await popup.getByRole('button', { name: 'Save settings' }).click();
  await expect
    .poll(() =>
      worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length),
    )
    .toBe(4);
  const strict = await worker.evaluate(
    async ({ tabId }) =>
      chrome.declarativeNetRequest.testMatchOutcome({
        url: 'https://unknown.example/track',
        initiator: 'https://megaplay.buzz',
        type: 'xmlhttprequest',
        tabId,
      }),
    { tabId },
  );
  expect(strict.matchedRules.some((rule) => rule.ruleId === 4)).toBe(true);
  for (const type of ['stylesheet', 'font', 'object']) {
    const result = await worker.evaluate(
      async ({ tabId, type }) =>
        chrome.declarativeNetRequest.testMatchOutcome({
          url: 'https://unknown.example/resource',
          initiator: 'https://megaplay.buzz',
          type,
          tabId,
        }),
      { tabId, type },
    );
    expect(result.matchedRules.some((rule) => rule.ruleId === 4)).toBe(true);
  }
  await page.goto('http://127.0.0.1:18787/__guard-outside');
  await page.close();
  await expect
    .poll(() => worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()))
    .toEqual([expect.objectContaining({ id: 3 })]);
});

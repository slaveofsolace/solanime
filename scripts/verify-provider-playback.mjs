import { chromium } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = new Map(
  process.argv.slice(2).map((entry) => {
    const [key, ...rest] = entry.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : 'true'];
  }),
);

const origin = String(args.get('origin') ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const databasePath = resolve(String(args.get('database') ?? process.env.SOLANIME_DB_PATH ?? 'data/solanime.sqlite'));
const limit = Math.max(1, Math.min(500, Number(args.get('limit') ?? 6)));
const seed = Math.trunc(Number(args.get('seed') ?? 20260919));
const requestedProviders = String(args.get('providers') ?? 'hd-1,hd-2,vidstream-2')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => ['hd-1', 'hd-2', 'vidstream-2'].includes(value));
const timeoutMs = Math.max(10_000, Math.min(120_000, Number(args.get('timeout-ms') ?? 35_000)));
const headed = args.get('headed') === 'true';
const outputPath = resolve(String(args.get('output') ?? join('test-results', `provider-playback-${Date.now()}.json`)));
const outputRoot = dirname(outputPath);
const extensionPath = resolve('extensions/solanime-guard');
const profilePath = join(outputRoot, `guard-profile-${process.pid}`);

if (!existsSync(databasePath)) throw new Error(`Catalogue database not found: ${databasePath}`);
if (!existsSync(extensionPath)) throw new Error(`Solanime Guard not found: ${extensionPath}`);
mkdirSync(outputRoot, { recursive: true });
mkdirSync(profilePath, { recursive: true });

function sampleMappings() {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const providers = requestedProviders.length ? requestedProviders : ['hd-1', 'hd-2', 'vidstream-2'];
    const perProvider = Math.ceil(limit / providers.length);
    const rows = providers.flatMap((providerId, providerIndex) =>
      database.prepare(`
        SELECT m.id AS mappingId,m.provider_id AS providerId,v.language,
               e.id AS episodeId,t.slug,t.name AS title,m.canonical_embed_url AS embedUrl
        FROM episode_provider_mappings m
        JOIN episode_versions v ON v.id=m.version_id
        JOIN episodes e ON e.id=v.episode_id
        JOIN titles t ON t.id=e.title_id
        WHERE m.provider_id=? AND COALESCE(m.canonical_embed_url,'')<>''
        ORDER BY ABS(((m.id * 1103515245) + ?) % 2147483647),m.id
        LIMIT ?`).all(providerId, seed + providerIndex * 7919, perProvider),
    );
    const interleaved = [];
    for (let offset = 0; offset < perProvider; offset += 1) {
      for (const providerId of providers) {
        const matches = rows.filter((row) => row.providerId === providerId);
        if (matches[offset]) interleaved.push(matches[offset]);
      }
    }
    return interleaved.slice(0, limit);
  } finally {
    database.close();
  }
}

async function attemptPlayback(page, mapping) {
  const watchUrl = `${origin}/watch/${encodeURIComponent(mapping.slug)}/${mapping.episodeId}?language=${encodeURIComponent(mapping.language)}&server=${mapping.mappingId}`;
  const unexpectedPages = [];
  const context = page.context();
  const recordPage = (candidate) => {
    if (candidate !== page) unexpectedPages.push(candidate.url());
  };
  context.on('page', recordPage);
  const result = {
    ...mapping,
    watchUrl,
    startedAt: new Date().toISOString(),
    guardActive: false,
    frameLoaded: false,
    playbackProgress: false,
    progressFrom: null,
    progressTo: null,
    duration: null,
    parentStayedOnWatchRoute: false,
    unexpectedPages: [],
    status: 'failed',
    reason: null,
    providerFrameUrl: null,
    providerTitle: null,
    providerText: null,
  };

  try {
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.locator('html').waitFor({ state: 'attached', timeout: timeoutMs });
    result.guardActive = await page.locator('html').getAttribute('data-solanime-guard') === 'active';
    if (!result.guardActive) throw new Error('Solanime Guard handshake was not active.');

    const providerFrame = page.locator('iframe[title="MegaPlay provider player"]');
    await providerFrame.waitFor({ state: 'visible', timeout: timeoutMs });
    const source = await providerFrame.getAttribute('src');
    result.providerFrameUrl = source;
    result.frameLoaded = Boolean(source && source.startsWith('https://megaplay.buzz/stream/s-2/'));
    if (!result.frameLoaded) throw new Error('Validated provider iframe did not load.');

    const frame = page.frameLocator('iframe[title="MegaPlay provider player"]');
    const playSelectors = [
      'button[aria-label*="play" i]',
      '.jw-icon-display',
      '.jw-icon-playback',
      'video',
    ];
    for (const selector of playSelectors) {
      try {
        const control = frame.locator(selector).first();
        if (await control.isVisible({ timeout: 2_000 })) {
          await control.click({ timeout: 3_000 });
          break;
        }
      } catch {
        // Provider controls vary. Progress events remain the acceptance signal.
      }
    }

    await page.getByText('Provider playback · MegaPlay', { exact: true }).waitFor({
      state: 'visible',
      timeout: timeoutMs,
    });
    const player = page.locator('.provider-player[data-playback-position]');
    await player.waitFor({ state: 'visible', timeout: timeoutMs });
    result.progressFrom = Number(await player.getAttribute('data-playback-position'));
    result.duration = Number(await player.getAttribute('data-playback-duration'));
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
    result.playbackProgress = Number.isFinite(result.progressFrom)
      && Number.isFinite(result.progressTo)
      && result.progressTo > result.progressFrom + 0.1;
    if (!result.playbackProgress) throw new Error('Provider time did not advance.');
    result.parentStayedOnWatchRoute = new URL(page.url()).pathname === new URL(watchUrl).pathname;
    await page.waitForTimeout(1_000);
    result.unexpectedPages = unexpectedPages.filter(Boolean);
    result.status = result.parentStayedOnWatchRoute && result.unexpectedPages.length === 0 ? 'passed' : 'failed';
    if (result.status !== 'passed') result.reason = 'Unexpected top-level navigation survived containment.';
  } catch (error) {
    result.reason = error instanceof Error ? error.message : String(error);
    result.parentStayedOnWatchRoute = page.url().startsWith(`${origin}/watch/`);
    result.unexpectedPages = unexpectedPages.filter(Boolean);
    const providerDocument = page.frames().find((frame) => frame.url().startsWith('https://megaplay.buzz/'));
    if (providerDocument) {
      result.providerFrameUrl = providerDocument.url();
      result.providerTitle = await providerDocument.title().catch(() => null);
      result.providerText = await providerDocument.locator('body').innerText({ timeout: 2_000 })
        .then((value) => value.replace(/\s+/g, ' ').trim().slice(0, 500))
        .catch(() => null);
    }
  } finally {
    context.off('page', recordPage);
    for (const candidate of context.pages()) {
      if (candidate !== page) await candidate.close().catch(() => undefined);
    }
  }
  return result;
}

const samples = sampleMappings();
const context = await chromium.launchPersistentContext(profilePath, {
  channel: 'chromium',
  headless: !headed,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const results = [];
try {
  await (context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker', { timeout: timeoutMs }));
  const page = context.pages()[0] ?? await context.newPage();
  for (const sample of samples) results.push(await attemptPlayback(page, sample));
} finally {
  await context.close();
  rmSync(profilePath, { recursive: true, force: true });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  origin,
  databasePath,
  seed,
  requested: limit,
  attempted: results.length,
  passed: results.filter((result) => result.status === 'passed').length,
  failed: results.filter((result) => result.status !== 'passed').length,
  definition: 'Passed requires Guard handshake, validated iframe, two increasing provider time values, stable watch route, and no surviving unexpected page.',
  results,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...report, results: undefined, outputPath }, null, 2));
if (report.failed > 0) process.exitCode = 1;

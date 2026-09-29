import { chromium, devices, webkit } from '@playwright/test';
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
const requestedMappingIds = String(args.get('mapping-ids') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    if (!/^\d+$/.test(value)) throw new Error('mapping-ids must be a comma-separated list of numeric mapping IDs.');
    return Number(value);
  });
const requestedLanguage = args.has('language')
  ? String(args.get('language')).trim().toLowerCase()
  : null;
if (requestedLanguage && !['sub', 'dub', 'hsub'].includes(requestedLanguage)) {
  throw new Error('language must be sub, dub, or hsub.');
}
const timeoutMs = Math.max(10_000, Math.min(120_000, Number(args.get('timeout-ms') ?? 35_000)));
const concurrency = Math.max(1, Math.min(4, Number(args.get('concurrency') ?? 1)));
const ratePerMinute = Math.max(1, Math.min(30, Number(args.get('rate-per-minute') ?? 24)));
const headed = args.get('headed') === 'true';
const protection = args.get('protection') ?? 'extension';
if (!['extension', 'browser'].includes(protection)) throw new Error('protection must be extension or browser.');
const device = args.get('device') ?? 'desktop';
if (!['desktop', 'android', 'iphone'].includes(device)) throw new Error('device must be desktop, android, or iphone.');
if (device !== 'desktop' && protection === 'extension') throw new Error('Phone emulation must use browser-only protection.');
const interactionTest = args.get('interaction-test') === 'true';
const sandboxProbe = args.get('sandbox-probe') ?? 'none';
const sandboxProbeTokens = {
  none: null,
  strict: 'allow-scripts allow-same-origin allow-presentation',
  forms: 'allow-scripts allow-same-origin allow-forms allow-presentation',
  'forms-popups': 'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups',
};
if (!Object.hasOwn(sandboxProbeTokens, sandboxProbe)) {
  throw new Error('sandbox-probe must be none, strict, forms, or forms-popups.');
}
if (sandboxProbe !== 'none' && protection !== 'browser') {
  throw new Error('Sandbox probes require browser-only protection.');
}
const allowFallback = args.get('allow-fallback') === 'true';
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
    if (requestedMappingIds.length) {
      const placeholders = requestedMappingIds.map(() => '?').join(',');
      return database.prepare(`
        SELECT m.id AS mappingId,m.provider_id AS providerId,v.language,
               e.id AS episodeId,t.slug,t.name AS title,
               m.provider_resource_id AS providerResourceId,
               m.canonical_embed_url AS embedUrl
        FROM episode_provider_mappings m
        JOIN episode_versions v ON v.id=m.version_id
        JOIN episodes e ON e.id=v.episode_id
        JOIN titles t ON t.id=e.title_id
        WHERE m.id IN (${placeholders})
        ORDER BY m.id`).all(...requestedMappingIds);
    }
    const providers = requestedProviders.length ? requestedProviders : ['hd-1', 'hd-2', 'vidstream-2'];
    const perProvider = Math.ceil(limit / providers.length);
    const rows = providers.flatMap((providerId, providerIndex) =>
      database.prepare(`
        SELECT m.id AS mappingId,m.provider_id AS providerId,v.language,
               e.id AS episodeId,t.slug,t.name AS title,
               m.provider_resource_id AS providerResourceId,
               m.canonical_embed_url AS embedUrl
        FROM episode_provider_mappings m
        JOIN episode_versions v ON v.id=m.version_id
        JOIN episodes e ON e.id=v.episode_id
        JOIN titles t ON t.id=e.title_id
        WHERE m.provider_id=?
          AND (COALESCE(m.canonical_embed_url,'')<>'' OR COALESCE(m.provider_resource_id,'')<>'')
          ${requestedLanguage ? 'AND v.language=?' : ''}
        ORDER BY ABS(((m.id * 1103515245) + ?) % 2147483647),m.id
        LIMIT ?`).all(
          providerId,
          ...(requestedLanguage ? [requestedLanguage] : []),
          seed + providerIndex * 7919,
          perProvider,
        ),
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

function sourceMatchesMapping(source, mapping) {
  if (!source) return false;
  if (mapping.embedUrl) return source === mapping.embedUrl;
  let url;
  try {
    url = new URL(source);
  } catch {
    return false;
  }
  const match = /^\/stream\/s-2\/([0-9]{1,20})\/(sub|dub|hsub)\/?$/.exec(url.pathname);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'megaplay.buzz' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !match ||
    match[2] !== mapping.language
  )
    return false;
  if (mapping.providerId === 'hd-1') return url.search === '?s=tcdn';
  if (mapping.providerId === 'hd-2') return url.search === '?s=bcdn';
  return url.search === '';
}

function sourceMatchesReviewedRoute(source, language) {
  if (!source) return false;
  let url;
  try {
    url = new URL(source);
  } catch {
    return false;
  }
  const match = /^\/stream\/s-2\/([0-9]{1,20})\/(sub|dub|hsub)\/?$/.exec(url.pathname);
  return url.protocol === 'https:'
    && url.hostname === 'megaplay.buzz'
    && !url.username
    && !url.password
    && !url.port
    && !url.hash
    && Boolean(match)
    && match[2] === language
    && ['', '?s=tcdn', '?s=bcdn'].includes(url.search);
}

async function attemptPlayback(page, mapping) {
  const watchUrl = `${origin}/watch/${encodeURIComponent(mapping.slug)}/${mapping.episodeId}?language=${encodeURIComponent(mapping.language)}&server=${mapping.mappingId}`;
  const unexpectedPages = [];
  const ownedPages = [];
  let popupEvents = 0;
  const context = page.context();
  const recordPage = (candidate) => {
    if (candidate === page) return;
    void candidate.opener().then((opener) => {
      if (opener === page) {
        popupEvents += 1;
        ownedPages.push(candidate);
        unexpectedPages.push(candidate.url());
      }
    });
  };
  context.on('page', recordPage);
  const result = {
    ...mapping,
    watchUrl,
    startedAt: new Date().toISOString(),
    guardActive: false,
    protection,
    sandboxProbe,
    frameLoaded: false,
    selectedSourceMatched: false,
    playbackProgress: false,
    visibleVideo: false,
    providerRejected: false,
    decodedFramesFrom: null,
    decodedFramesTo: null,
    progressFrom: null,
    progressTo: null,
    duration: null,
    parentStayedOnWatchRoute: false,
    unexpectedPages: [],
    popupEvents: 0,
    interactionAttempted: false,
    postClickProgress: false,
    status: 'failed',
    reason: null,
    providerFrameUrl: null,
    providerTitle: null,
    providerText: null,
  };

  try {
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (protection === 'extension') await page.locator('html[data-solanime-guard="active"]').waitFor({ state: 'attached', timeout: timeoutMs });
    result.guardActive = await page.locator('html').getAttribute('data-solanime-guard') === 'active';
    if (protection === 'extension' && !result.guardActive) throw new Error('Solanime Guard handshake was not active.');
    if (protection === 'browser' && result.guardActive) throw new Error('Browser-only test unexpectedly has an active extension.');

    const providerFrame = page.locator('iframe[title="MegaPlay provider player"]');
    await providerFrame.waitFor({ state: 'visible', timeout: timeoutMs });
    const source = await providerFrame.getAttribute('src');
    result.providerFrameUrl = source;
    result.selectedSourceMatched = sourceMatchesMapping(source, mapping);
    result.frameLoaded = Boolean(
      source?.startsWith('https://megaplay.buzz/stream/s-2/') &&
      (result.selectedSourceMatched || (allowFallback && sourceMatchesReviewedRoute(source, mapping.language))),
    );
    if (!result.frameLoaded) throw new Error('The loaded provider iframe did not match the selected mapping provider, route, and language.');

    // Diagnostic only: reload the exact selected iframe with a browser sandbox.
    // The shipping player is not changed by this probe.
    if (sandboxProbeTokens[sandboxProbe]) {
      await providerFrame.evaluate((node, tokens) => {
        node.setAttribute('sandbox', tokens);
        node.src = 'about:blank';
      }, sandboxProbeTokens[sandboxProbe]);
      await providerFrame.evaluate((node, originalSource) => {
        node.src = originalSource;
      }, source);
      result.appliedSandbox = await providerFrame.getAttribute('sandbox');
    }

    const document = await (await providerFrame.elementHandle()).contentFrame();
    if (!document) throw new Error('Provider frame document was not available.');
    const video = document.locator('video').first();
    await video.waitFor({ state: 'visible', timeout: timeoutMs });
    const videoState = () => video.evaluate((node) => ({
      frames: node.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
      width: node.videoWidth, height: node.videoHeight,
      time: node.currentTime, ready: node.readyState,
    }));
    const before = await videoState();
    result.decodedFramesFrom = before.frames;

    await page.getByText(/Provider playback · MegaPlay/).waitFor({
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
        return Number.isFinite(current) && current > Number(from) + 2;
      },
      result.progressFrom,
      { timeout: timeoutMs },
    );
    result.progressTo = Number(await player.getAttribute('data-playback-position'));
    result.playbackProgress = Number.isFinite(result.progressFrom)
      && Number.isFinite(result.progressTo)
      && result.progressTo > result.progressFrom + 2;
    if (!result.playbackProgress) throw new Error('Provider time did not advance.');
    const after = await videoState();
    result.decodedFramesTo = after.frames;
    result.providerText = await document.locator('body').innerText({ timeout: 2_000 })
      .then((value) => value.replace(/\s+/g, ' ').trim().slice(0, 1500));
    result.providerRejected = /sandbox.{0,100}(?:not allowed|remove|disabled)|remove.{0,40}sandbox/i.test(result.providerText);
    result.visibleVideo = after.width > 0 && after.height > 0 && after.ready >= 2 && after.frames > before.frames;
    if (interactionTest && result.visibleVideo && !result.providerRejected) {
      const box = await providerFrame.boundingBox();
      if (!box) throw new Error('The provider player was not visible for a real click.');
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const clickedFrom = after.time;
      result.interactionAttempted = true;
      await page.mouse.click(center.x, center.y);
      // A genuine video click often pauses playback. Click the same visible
      // control again only in that state, then require decoded playback to resume.
      if (await video.evaluate((node) => node.paused)) await page.mouse.click(center.x, center.y);
      await page.waitForFunction(
        (from) => {
          const player = document.querySelector('.provider-player[data-playback-position]');
          const position = Number(player?.getAttribute('data-playback-position'));
          return Number.isFinite(position) && position > from + 1;
        },
        clickedFrom,
        { timeout: timeoutMs },
      );
      result.postClickProgress = true;
    }
    await page.screenshot({ path: join(outputRoot, `mapping-${mapping.mappingId}.png`) });
    if (result.providerRejected) throw new Error('Provider displays a sandbox refusal; audio/time reports are not successful playback.');
    if (!result.visibleVideo) throw new Error('No advancing decoded video frames were verified.');
    result.parentStayedOnWatchRoute = new URL(page.url()).pathname === new URL(watchUrl).pathname;
    await page.waitForTimeout(1_000);
    result.unexpectedPages = unexpectedPages.filter(Boolean);
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
      result.providerRejected = /sandbox.{0,100}(?:not allowed|remove|disabled)|remove.{0,40}sandbox/i.test(result.providerText ?? '');
      if (result.providerRejected) result.reason = 'Provider displays a sandbox refusal; visible playback was not verified.';
    }
  } finally {
    context.off('page', recordPage);
    await page.waitForTimeout(250).catch(() => undefined);
    result.unexpectedPages = ownedPages
      .filter((candidate) => !candidate.isClosed())
      .map((candidate) => candidate.url())
      .filter(Boolean);
    result.popupEvents = popupEvents;
    if (!result.reason && result.frameLoaded && result.playbackProgress && result.visibleVideo && !result.providerRejected && result.parentStayedOnWatchRoute && result.unexpectedPages.length === 0 && result.popupEvents === 0 && (!interactionTest || result.postClickProgress)) {
      result.status = 'passed';
      result.reason = null;
    } else if (result.popupEvents > 0) {
      result.reason = 'An unexpected top-level popup was created during playback.';
    }
    for (const candidate of ownedPages) await candidate.close().catch(() => undefined);
  }
  return result;
}

const samples = sampleMappings();
const descriptor = device === 'android' ? devices['Pixel 7'] : device === 'iphone' ? devices['iPhone 13'] : null;
const { defaultBrowserType: _defaultBrowserType, ...emulation } = descriptor ?? {};
const browserType = device === 'iphone' ? webkit : chromium;
const context = await browserType.launchPersistentContext(profilePath, {
  ...(device !== 'iphone' ? { channel: 'chromium' } : {}),
  ...emulation,
  headless: !headed,
  args: [
    ...(protection === 'extension' ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : []),
    ...(device !== 'iphone' ? ['--autoplay-policy=no-user-gesture-required'] : []),
  ],
});

const results = [];
try {
  if (protection === 'extension') await (context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker', { timeout: timeoutMs }));
  for (const page of context.pages()) await page.close().catch(() => undefined);
  for (let offset = 0; offset < samples.length; offset += concurrency) {
    const batchStarted = Date.now();
    const batch = samples.slice(offset, offset + concurrency);
    const pages = await Promise.all(batch.map(() => context.newPage()));
    const completed = await Promise.all(batch.map((sample, index) => attemptPlayback(pages[index], sample)));
    results.push(...completed);
    await Promise.all(pages.map((page) => page.close().catch(() => undefined)));
    console.log(JSON.stringify({
      progress: results.length,
      requested: samples.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: results.filter((result) => result.status !== 'passed').length,
    }));
    const minimumBatchMs = 60_000 * batch.length / ratePerMinute;
    const remaining = minimumBatchMs - (Date.now() - batchStarted);
    if (remaining > 0 && offset + batch.length < samples.length) await new Promise((resolveDelay) => setTimeout(resolveDelay, remaining));
  }
} finally {
  await context.close();
  rmSync(profilePath, { recursive: true, force: true });
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  origin,
  databasePath,
  seed,
  requestedLanguage,
  allowFallback,
  protection,
  sandboxProbe,
  device,
  interactionTest,
  concurrency,
  ratePerMinute,
  requested: limit,
  attempted: results.length,
  passed: results.filter((result) => result.status === 'passed').length,
  failed: results.filter((result) => result.status !== 'passed').length,
  definition: allowFallback
    ? 'Passed requires Guard handshake, selected or explicitly allowed same-language fallback, more than two seconds of progress, visible advancing decoded video frames, no provider sandbox refusal, stable watch route, and no surviving unexpected page. Screenshots require human review.'
    : 'Passed requires Guard handshake, exact selected provider/route/language, more than two seconds of progress, visible advancing decoded video frames, no provider sandbox refusal, stable watch route, and no surviving unexpected page. Screenshots require human review.',
  results,
};
if (protection === 'browser') report.definition = report.definition.replace('Guard handshake', 'absence of a Guard handshake (browser-only mode)') + ' No observed popup is not a guarantee of redirect blocking.';
if (interactionTest) report.definition += ' A real click inside the provider frame must be followed by advancing playback and no newly created popup window.';
if (sandboxProbe !== 'none') report.definition += ' Sandbox probe is diagnostic only and does not change the shipping player; a forms-popups result cannot satisfy the no-popup requirement.';
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...report, results: undefined, outputPath }, null, 2));
if (report.failed > 0) process.exitCode = 1;

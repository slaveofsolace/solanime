'use strict';

const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const watchUrl = process.env.SOLANIME_WATCH_URL || 'https://solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384944';
const expectedUrl = new URL(watchUrl);
const expectedMapping = expectedUrl.searchParams.get('server');
if (expectedUrl.origin !== 'https://solanime.pages.dev' || !expectedUrl.pathname.startsWith('/watch/') || !expectedMapping) {
  throw new Error('SOLANIME_WATCH_URL must be an exact Solanime watch route with a server mapping');
}
const artifactRoot = path.resolve(process.env.SOLANIME_ARTIFACTS_DIR ?? path.join(__dirname, '..', 'build', 'desktop-preview'));
const artifact = path.join(artifactRoot, 'desktop-real-playback-smoke.png');

async function main() {
  const packagedExecutable = process.env.SOLANIME_PREVIEW_EXE;
  const preview = await electron.launch({
    executablePath: packagedExecutable || require('electron'),
    args: packagedExecutable ? [] : [__dirname],
    timeout: 30_000
  });
  try {
    fs.mkdirSync(artifactRoot, { recursive: true });
    const page = await preview.firstWindow();
    let createdWindows = 0;
    preview.context().on('page', () => { createdWindows += 1; });
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const frame = page.locator('iframe[title="MegaPlay provider player"]');
    await frame.waitFor({ state: 'visible', timeout: 30_000 });
    const iframeUrl = await frame.getAttribute('src');
    const provider = await (await frame.elementHandle()).contentFrame();
    if (!provider) throw new Error('Provider frame inaccessible');
    const video = provider.locator('video').first();
    await video.waitFor({ state: 'visible', timeout: 30_000 });
    const sample = () => video.evaluate(element => ({
      time: element.currentTime,
      frames: element.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
      width: element.videoWidth,
      height: element.videoHeight,
      ready: element.readyState
    }));
    const before = await sample();
    await page.waitForTimeout(4_000);
    const playing = await sample();
    await provider.evaluate(() => {
      const probe = document.createElement('button');
      probe.id = 'solanime-native-popup-probe';
      probe.textContent = 'Popup policy probe';
      probe.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647';
      probe.addEventListener('click', () => {
        window.__solanimePopupAttempted = true;
        window.__solanimePopupResult = window.open('https://example.com/solanime-popup-probe', '_blank') === null
          ? 'denied' : 'opened';
      });
      document.body.append(probe);
    });
    await provider.locator('#solanime-native-popup-probe').click();
    const popupProbe = await provider.evaluate(() => ({
      attempted: window.__solanimePopupAttempted === true,
      result: window.__solanimePopupResult
    }));
    await provider.locator('#solanime-native-popup-probe').evaluate(element => element.remove());
    const box = await frame.boundingBox();
    if (!box) throw new Error('Player not visible');
    let playInteraction = 'already-playing';
    if (await video.evaluate(element => element.paused)) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      playInteraction = 'clicked-provider';
    }
    await page.waitForTimeout(2_500);
    const after = await sample();
    await page.screenshot({ path: artifact });
    const finalUrl = new URL(page.url());
    const selectedMapping = await page.locator('select[aria-label="Playback source"]').inputValue();
    const selectedProvider = await page.locator('select[aria-label="Playback source"] option:checked').textContent();
    const parentStable = finalUrl.origin === expectedUrl.origin && finalUrl.pathname === expectedUrl.pathname;
    const mappingStable = finalUrl.searchParams.get('server') === expectedMapping && selectedMapping === expectedMapping;
    const advanced = playing.time > before.time + 1 && after.time >= before.time + 5
      && after.frames > before.frames && after.width > 0 && after.height > 0 && after.ready >= 2;
    const outcome = { requestedUrl: watchUrl, finalUrl: page.url(), expectedMapping, selectedMapping,
      selectedProvider: selectedProvider?.trim(), iframeUrl, before, playing, after, playInteraction,
      popupProbe, createdWindows, parentStable, mappingStable, advanced, artifact };
    console.log(JSON.stringify(outcome));
    if (!advanced || !popupProbe.attempted || popupProbe.result !== 'denied' ||
        createdWindows !== 0 || !parentStable || !mappingStable) process.exitCode = 1;
  } finally {
    await preview.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

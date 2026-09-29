'use strict';

const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const watchUrl = 'https://solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384944';
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
    await page.waitForTimeout(3_500);
    const playing = await sample();
    const box = await frame.boundingBox();
    if (!box) throw new Error('Player not visible');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (await video.evaluate(element => element.paused)) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.waitForTimeout(2_000);
    const after = await sample();
    await page.screenshot({ path: artifact });
    const parentStable = page.url().startsWith(watchUrl.split('?')[0]);
    const advanced = playing.time > before.time + 1 && after.time > playing.time + 1
      && after.frames > before.frames && after.width > 0 && after.height > 0 && after.ready >= 2;
    const outcome = { iframeUrl, before, playing, after, createdWindows, parentStable, advanced, artifact };
    console.log(JSON.stringify(outcome));
    if (!advanced || createdWindows !== 0 || !parentStable) process.exitCode = 1;
  } finally {
    await preview.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

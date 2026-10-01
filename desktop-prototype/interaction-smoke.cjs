'use strict';

const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const watchUrl = 'https://solanime.pages.dev/watch/unlimited-psychic-squad-h8xyy/124554?language=sub&server=384944';
const packagedExecutable = process.env.SOLANIME_PREVIEW_EXE;
if (!packagedExecutable) throw new Error('SOLANIME_PREVIEW_EXE must name the packaged Mac app executable');
const artifactRoot = path.resolve(process.env.SOLANIME_ARTIFACTS_DIR ?? path.join(__dirname, '..', 'build', 'desktop-preview', 'interaction'));

async function launch() {
  const app = await electron.launch({ executablePath: packagedExecutable, timeout: 30_000 });
  const page = await app.firstWindow();
  let createdWindows = 0;
  app.context().on('page', () => { createdWindows += 1; });
  return { app, page, windows: () => createdWindows };
}

async function player(page) {
  const iframe = page.locator('iframe[title="MegaPlay provider player"]');
  await iframe.waitFor({ state: 'visible', timeout: 30_000 });
  const frame = page.frameLocator('iframe[title="MegaPlay provider player"]');
  const video = frame.locator('video').first();
  await video.waitFor({ state: 'visible', timeout: 30_000 });
  return { frame, video };
}

async function sample(video) {
  return video.evaluate(element => ({
    time: element.currentTime,
    duration: element.duration,
    paused: element.paused,
    frames: element.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
    width: element.videoWidth,
    height: element.videoHeight
  }));
}

async function main() {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const results = { packagedExecutable, watchUrl, stages: [] };
  let session = await launch();
  try {
    await session.page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    let { frame, video } = await player(session.page);
    await session.page.waitForTimeout(2_000);
    let before = await sample(video);
    if (before.paused) {
      await video.hover();
      await frame.locator('.jw-icon-playback[role="button"]').click();
      await session.page.waitForTimeout(1_000);
    }
    const playing = await sample(video);
    if (playing.paused) throw new Error('Provider Play control did not start playback');
    await video.hover();
    await frame.locator('.jw-icon-playback[role="button"]').click();
    const paused = await sample(video);
    if (!paused.paused) throw new Error('Provider Pause control did not pause playback');
    await frame.locator('.jw-icon-playback[role="button"]').click();
    await session.page.waitForTimeout(1_500);
    const resumed = await sample(video);
    if (resumed.paused || resumed.time <= paused.time || resumed.frames <= paused.frames) {
      throw new Error('Provider Play control did not resume visible playback');
    }
    results.stages.push({ action: 'play-pause-resume', before, playing, paused, resumed });

    const seekBefore = await sample(video);
    const slider = frame.locator('[role="slider"][aria-label="Seek"]');
    await slider.focus();
    await slider.press('ArrowRight');
    await session.page.waitForTimeout(1_500);
    const seekAfter = await sample(video);
    if (seekAfter.time <= seekBefore.time + 4 || seekAfter.frames <= seekBefore.frames) {
      throw new Error('Provider seek did not advance time and frames');
    }
    results.stages.push({ action: 'seek-right', seekBefore, seekAfter });

    await video.hover();
    await frame.locator('.jw-icon-fullscreen:not(.jw-fullscreen-ima)[role="button"]').click();
    await session.page.waitForTimeout(700);
    const fullscreenEntered = await frame.locator('body').evaluate(() => Boolean(document.fullscreenElement));
    if (!fullscreenEntered) throw new Error('Provider fullscreen control did not enter fullscreen');
    await frame.locator('.jw-icon-fullscreen:not(.jw-fullscreen-ima)[role="button"]').click();
    await session.page.waitForTimeout(700);
    const fullscreenExited = await frame.locator('body').evaluate(() => !document.fullscreenElement);
    if (!fullscreenExited) throw new Error('Provider fullscreen control did not exit fullscreen');
    results.stages.push({ action: 'fullscreen-enter-exit', fullscreenEntered, fullscreenExited });

    await session.page.locator('select[aria-label="Playback source"]').selectOption('384943');
    await session.page.waitForURL(url => url.searchParams.get('server') === '384943', { timeout: 20_000 });
    ({ frame, video } = await player(session.page));
    await session.page.waitForTimeout(3_000);
    before = await sample(video);
    await session.page.waitForTimeout(5_500);
    const switched = await sample(video);
    const selectedSource = await session.page.locator('select[aria-label="Playback source"]').inputValue();
    const switchUrl = session.page.url();
    results.stages.push({ action: 'source-switch', selectedSource, switchUrl, before, switched });
    if (selectedSource !== '384943' || switched.time < before.time + 5 || switched.frames <= before.frames) {
      await session.page.screenshot({ path: path.join(artifactRoot, 'source-switch-failure.png') });
      throw new Error('Source switch did not retain mapping 384943 with advancing video');
    }

    const originalEpisode = new URL(session.page.url()).pathname;
    await session.page.locator('button[aria-label="Next episode"]').click();
    await session.page.waitForURL(url => url.pathname !== originalEpisode && url.hostname === 'solanime.pages.dev', { timeout: 20_000 });
    const nextEpisode = session.page.url();
    ({ frame, video } = await player(session.page));
    await session.page.waitForTimeout(3_000);
    const nextBefore = await sample(video);
    await session.page.waitForTimeout(5_500);
    const nextSample = await sample(video);
    if (nextSample.time < nextBefore.time + 5 || nextSample.frames <= nextBefore.frames) {
      results.stages.push({ action: 'episode-next', nextEpisode, nextBefore, nextSample });
      throw new Error('Next episode did not show advancing video');
    }
    await session.page.locator('button[aria-label="Previous episode"]').click();
    await session.page.waitForURL(url => url.pathname === originalEpisode, { timeout: 20_000 });
    results.stages.push({ action: 'episode-next-return', nextEpisode, nextBefore, nextSample, returnedUrl: session.page.url() });

    const preRestartWindows = session.windows();
    if (preRestartWindows !== 0) throw new Error(`Unexpected windows before restart: ${preRestartWindows}`);
    await session.app.close();
    session = await launch();
    await session.page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    let restarted;
    try {
      ({ video } = await player(session.page));
      await session.page.waitForTimeout(3_000);
      before = await sample(video);
      await session.page.waitForTimeout(5_500);
      restarted = await sample(video);
    } catch (error) {
      const restartFailure = {
        action: 'restart-failure', url: session.page.url(),
        selectedSource: await session.page.locator('select[aria-label="Playback source"]').inputValue().catch(() => null),
        iframeUrl: await session.page.locator('iframe[title="MegaPlay provider player"]').getAttribute('src').catch(() => null),
        alerts: await session.page.locator('[role="alert"]').allTextContents(),
        error: String(error)
      };
      results.stages.push(restartFailure);
      await session.page.screenshot({ path: path.join(artifactRoot, 'restart-failure.png') });
      throw error;
    }
    const restartUrl = session.page.url();
    if (restarted.time < before.time + 5 || restarted.frames <= before.frames ||
        new URL(restartUrl).searchParams.get('server') !== '384944' || session.windows() !== 0) {
      throw new Error('Restart did not retain protected mapping with advancing video and zero windows');
    }
    await session.page.screenshot({ path: path.join(artifactRoot, 'after-restart.png') });
    results.stages.push({ action: 'restart', before, restarted, restartUrl, createdWindows: session.windows() });
    results.pass = true;
  } finally {
    await session.app.close();
    const resultPath = path.join(artifactRoot, 'interaction-smoke.json');
    fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ resultPath, ...results }));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const packagedExecutable = process.env.SOLANIME_PREVIEW_EXE;
  const preview = await electron.launch({
    executablePath: packagedExecutable || require('electron'),
    args: packagedExecutable ? [] : [__dirname],
    timeout: 30_000
  });
  try {
    const page = await preview.firstWindow();
    await page.waitForURL(url => url.hostname === 'solanime.pages.dev', { timeout: 30_000 });
    const initialUrl = page.url();
    let createdWindows = 0;
    preview.context().on('page', () => { createdWindows += 1; });

    await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'solanime-popup-guard-smoke';
      button.textContent = 'Guard smoke';
      button.style.cssText = 'position:fixed;z-index:2147483647;top:10px;left:10px';
      button.addEventListener('click', () => window.open('https://wuytg.com/test', '_blank'));
      document.body.append(button);
    });
    await page.locator('#solanime-popup-guard-smoke').click();
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const link = document.createElement('a');
      link.id = 'solanime-navigation-guard-smoke';
      link.href = 'https://example.com/solanime-navigation-probe';
      link.textContent = 'Navigation policy probe';
      link.style.cssText = 'position:fixed;z-index:2147483647;top:60px;left:10px';
      document.body.append(link);
    });
    await page.locator('#solanime-navigation-guard-smoke').click({ noWaitAfter: true });
    await page.waitForTimeout(800);

    if (createdWindows !== 0) throw new Error(`Unexpected windows: ${createdWindows}`);
    if (new URL(page.url()).hostname !== 'solanime.pages.dev') {
      throw new Error(`Parent navigated unexpectedly: ${page.url()}`);
    }

    const artifactRoot = path.resolve(process.env.SOLANIME_ARTIFACTS_DIR ?? path.join(__dirname, '..', 'build', 'desktop-preview'));
    fs.mkdirSync(artifactRoot, { recursive: true });
    const artifact = path.join(artifactRoot, 'desktop-preview-smoke.png');
    await page.screenshot({ path: artifact });
    console.log(JSON.stringify({ packaged: Boolean(packagedExecutable), initialUrl, finalUrl: page.url(), createdWindows, artifact }));
  } finally {
    await preview.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const value = (name, fallback) => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const outputArgument = value('output');
if (!outputArgument) throw new Error('Supply --output=<task-owned export directory>.');
const output = path.resolve(outputArgument);
const origin = new URL(value('origin', 'http://127.0.0.1:5188'));
if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password) throw new Error('The renderer accepts only a local, credential-free preview origin.');
const web = path.resolve('public/branding');
const ffmpeg = value('ffmpeg', 'ffmpeg');
const browserDirectory = value('browser-dir');
if (browserDirectory) process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(browserDirectory);
// Keep this export duration aligned with src/branding/timeline.ts.
const INTRO_MS = 3400;
const { chromium } = await import('@playwright/test');
await mkdir(output, { recursive: true });
await mkdir(web, { recursive: true });
const report = { schemaVersion: 1, renderer: 'The application BrandArtwork and sampleBrandFrame timeline', framesPerSecond: 25, introMilliseconds: INTRO_MS, loopMilliseconds: 4800, outputs: [], sourceInputs: [] };
for (const file of ['src/branding/geometry.ts', 'src/branding/timeline.ts', 'src/branding/BrandArtwork.tsx', 'src/branding/dom.ts', 'src/branding/SolanimeBrand.tsx', 'public/branding/solanime-approved-master.png', 'public/branding/sun-cloudscape-source.png', 'public/branding/ribbon-foreground-source.png']) {
  const bytes = await readFile(file);
  report.sourceInputs.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 960, height: 850 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = (settings) => {
  const target = new URL('/branding.html', origin);
  for (const [key, val] of Object.entries({ export: '1', state: 'static', theme: 'dark', ...settings })) target.searchParams.set(key, String(val));
  return target.href;
};
const ready = async () => {
  await page.locator('[data-asset="loaded"]').waitFor();
  await page.locator('[data-brand-art]').waitFor();
};
const record = async (file) => {
  const bytes = await readFile(file);
  report.outputs.push({ file: path.basename(file), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
};
const encode = async (args) => { await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 2 * 1024 * 1024, windowsHide: true }); };
try {
  // High-quality web derivatives. Signed, lossless source PNGs remain available.
  for (const [source, target] of [['sun-cloudscape-source.png', 'solanime-sun.webp'], ['ribbon-foreground-source.png', 'solanime-ribbon.webp']]) {
    const file = path.join(web, target);
    await encode(['-i', path.join(web, source), '-c:v', 'libwebp', '-quality', '94', '-compression_level', '6', file]); await record(file);
  }
  // Render the original letter pixels into a tightly bounded web sprite; never substitute a font.
  await page.setViewportSize({ width: 1254, height: 170 });
  const original = await readFile(path.join(web, 'solanime-approved-master.png'));
  await page.setContent(`<html><head><style>*{margin:0}body{background:transparent}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="1254" height="170" viewBox="0 698 1254 170"><image href="data:image/png;base64,${original.toString('base64')}" width="1254" height="1254"/></svg></body></html>`);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const wordSprite = path.join(output, 'solanime-wordmark-sprite.png');
  await page.screenshot({ path: wordSprite, omitBackground: true });
  await encode(['-i', wordSprite, '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', path.join(web, 'solanime-wordmark-sprite.webp')]);
  await record(path.join(web, 'solanime-wordmark-sprite.webp'));
  for (const theme of ['dark', 'light']) {
    for (const [variant, width, height] of [['full', 960, 850], ['compact', 660, 132], ['emblem', 256, 256]]) {
      await page.setViewportSize({ width, height });
      await page.goto(url({ variant, theme, time: INTRO_MS }), { waitUntil: 'networkidle' });
      await ready();
      const png = path.join(output, `solanime-${variant}-${theme}.png`);
      await page.screenshot({ path: png, omitBackground: true });
      const asset = path.join(web, `solanime-${variant}-${theme}.webp`);
      await encode(['-i', png, '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', asset]);
      await record(png); await record(asset);
      if (variant === 'full' && theme === 'dark') {
        let svg = await page.locator('[data-brand-art]').evaluate(element => element.outerHTML);
        for (const file of ['solanime-wordmark-sprite.webp', 'solanime-sun.webp', 'solanime-ribbon.webp']) {
          const bytes = await readFile(path.join(web, file));
          svg = svg.replace(`href="/branding/${file}"`, `href="data:image/webp;base64,${bytes.toString('base64')}"`);
        }
        svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="850" ');
        const masterSvg = path.join(output, 'solanime-master.svg');
        await writeFile(masterSvg, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`); await record(masterSvg);
      }
    }
  }
  for (const size of [32, 192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.goto(url({ variant: 'emblem', theme: 'dark', time: INTRO_MS }), { waitUntil: 'networkidle' });
    await ready();
    const icon = path.join(web, `solanime-icon-${size}.png`);
    await page.screenshot({ path: icon, omitBackground: true }); await record(icon);
  }
  await page.setViewportSize({ width: 960, height: 850 });
  for (const [state, duration] of [['intro', INTRO_MS + 240], ['loading', 4800]]) {
    const frames = path.join(output, `frames-${state}`);
    await mkdir(frames, { recursive: true });
    await page.goto(url({ state, time: 0, opaque: 1 }), { waitUntil: 'networkidle' }); await ready();
    for (let frame = 0; frame < duration / 40; frame++) {
      const time = state === 'intro' ? Math.min(INTRO_MS, frame * 40) : frame * 40;
      await page.evaluate(time => document.dispatchEvent(new CustomEvent('solanime-brand-sample', { detail: { time } })), time);
      await page.locator(`[data-sampled-ms="${time}"]`).waitFor();
      await page.screenshot({ path: path.join(frames, `${String(frame).padStart(4, '0')}.png`) });
    }
    const input = path.join(frames, '%04d.png');
    const gif = path.join(output, `solanime-${state === 'intro' ? 'splash' : 'loading-loop'}.gif`);
    const webm = path.join(output, `solanime-${state === 'intro' ? 'splash' : 'loading-loop'}.webm`);
    await encode(['-framerate', '25', '-i', input, '-filter_complex', '[0:v]scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a', '-loop', '0', gif]);
    await encode(['-framerate', '25', '-i', input, '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-pix_fmt', 'yuv420p', '-an', webm]);
    await record(gif); await record(webm);
    console.log(JSON.stringify({ state, renderedFrames: duration / 40, gifBytes: (await stat(gif)).size }));
  }
  if (errors.length) throw new Error(`Renderer page errors: ${errors.join('; ')}`);
  await writeFile(path.join(output, 'exports-manifest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, files: report.outputs.length, pageErrors: errors.length }));
} finally { await context.close(); await browser.close(); }

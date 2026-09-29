'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { packager } = require('@electron/packager');

const artifactRoot = path.resolve(
  process.env.SOLANIME_ARTIFACTS_DIR ?? path.join(__dirname, '..', 'build', 'desktop-preview')
);
fs.mkdirSync(artifactRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(artifactRoot, 'solanime-preview-'));

packager({
  dir: __dirname,
  name: 'Solanime Preview',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '44.4.5',
  download: { cacheRoot: path.join(artifactRoot, 'electron-cache') },
  out: output,
  asar: true,
  prune: false,
  overwrite: false,
  ignore: [
    /(^|[/\\])node_modules([/\\]|$)/,
    /(^|[/\\])policy\.test\.cjs$/,
    /(^|[/\\])smoke\.cjs$/,
    /(^|[/\\])real-playback-smoke\.cjs$/,
    /(^|[/\\])package-win\.cjs$/,
    /(^|[/\\])README\.md$/
  ]
}).then(paths => {
  for (const packagedPath of paths) console.log(packagedPath);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import path from 'node:path';
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const destination = process.argv.find(value => value.startsWith('--output='))?.slice(9);
if (!destination) throw new Error('Supply --output=<empty task-owned directory>.');
const output = path.resolve(destination);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('The demo output directory must be empty; existing work is not removed.');
await build({
  configFile: false,
  root: process.cwd(),
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: output,
    emptyOutDir: false,
    rollupOptions: { input: path.resolve('branding.html') },
  },
});
await mkdir(path.join(output, 'branding'));
const files = (await readdir('public/branding')).filter(file => /^solanime-(?:full|compact|emblem)-(?:dark|light)\.webp$|^solanime-(?:sun|ribbon|wordmark-sprite)\.webp$|^solanime-icon-(?:32|192|512)\.png$/.test(file));
for (const file of files) await copyFile(path.join('public/branding', file), path.join(output, 'branding', file));
console.log(JSON.stringify({ output, publicBrandAssets: files.length, entry: 'branding.html' }));

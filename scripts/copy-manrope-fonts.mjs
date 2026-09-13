import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceRoot = new URL('../node_modules/@fontsource/manrope/files/', import.meta.url);
const destinationRoot = new URL('../public/fonts/', import.meta.url);
const weights = [200, 300, 400, 500, 600, 700, 800];

await mkdir(fileURLToPath(destinationRoot), { recursive: true });

for (const weight of weights) {
  const filename = `manrope-latin-${weight}-normal.woff2`;
  await copyFile(new URL(filename, sourceRoot), new URL(filename, destinationRoot));
}

await copyFile(
  new URL('../node_modules/@fontsource/manrope/LICENSE', import.meta.url),
  new URL('manrope-OFL.txt', destinationRoot),
);

console.log(`Copied ${weights.length} static Manrope faces and their OFL license.`);

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const argument = process.argv.find(value => value.startsWith('--references='));
if (!argument) throw new Error('Supply --references=<directory> containing approved-01.png through approved-06.png.');
const source = path.resolve(argument.slice('--references='.length));
const output = path.resolve('public/branding');
const sources = path.resolve('src/branding/references');
await mkdir(output, { recursive: true });
await mkdir(sources, { recursive: true });
const entries = [];
for (let index = 1; index <= 6; index++) {
  const name = `approved-${String(index).padStart(2, '0')}.png`;
  const bytes = await readFile(path.join(source, name));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${name} is not a PNG.`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const target = index === 1 ? path.join(output, 'solanime-approved-master.png') : path.join(sources, name);
  await copyFile(path.join(source, name), target);
  entries.push({ file: path.relative(process.cwd(), target).replaceAll('\\', '/'), reference: index, bytes: bytes.length, sha256 });
}
await writeFile(path.join(sources, 'manifest.json'), JSON.stringify({ schemaVersion: 1, identity: 'Solanime ribbon, play triangle, sun and cloudscape', origin: 'Six project-owner supplied approved visual references', treatment: 'Reference 1 is the unchanged pixel master. References 2–6 are lighting direction, not animation slides.', entries }, null, 2) + '\n');
console.log(JSON.stringify({ imported: entries.length, master: entries[0].sha256 }));

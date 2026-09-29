import path from 'node:path';
import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!argument('exports') || !argument('output')) throw new Error('Supply --exports=<render directory> and --output=<new ZIP path>.');
const root = process.cwd();
const exported = path.resolve(argument('exports'));
const output = path.resolve(argument('output'));
if (path.extname(output).toLowerCase() !== '.zip') throw new Error('The package destination must end in .zip.');
const entries = [];
const add = async (file, name) => {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Only regular owned files may be packaged: ${name}`);
  entries.push({ name, data: await readFile(file) });
};
const collect = async (relative) => {
  const location = path.resolve(root, relative);
  const info = await lstat(location);
  if (info.isSymbolicLink()) throw new Error('Source links are not followed into the package.');
  if (!info.isDirectory()) return add(location, `source/${relative.replaceAll('\\', '/')}`);
  for (const file of (await readdir(location)).sort()) await collect(path.join(relative, file));
};
for (const file of ['branding.html', 'public/branding', 'src/branding', 'scripts/branding', 'tests/branding-timeline.test.ts', 'tests/branding-components.test.tsx', 'tests/branding-browser', 'docs/BRANDING.md']) await collect(file);
const exportFiles = ['exports-manifest.json', 'solanime-master.svg', 'solanime-splash.gif', 'solanime-loading-loop.gif', 'solanime-splash.webm', 'solanime-loading-loop.webm'];
for (const variant of ['full', 'compact', 'emblem']) for (const theme of ['dark', 'light']) exportFiles.push(`solanime-${variant}-${theme}.png`);
for (const file of exportFiles) await add(path.join(exported, file), `exports/${file}`);
const manifest = {
  schemaVersion: 1,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  scope: 'Solanime brand source, approved references, derived static assets and timeline previews',
  files: entries.map(entry => ({ file: entry.name, bytes: entry.data.length, sha256: createHash('sha256').update(entry.data).digest('hex') })),
  exclusions: ['Catalogue and episode data', 'Account data and secrets', 'Browser state and recordings', 'Dependency directories', 'Intermediate frame sequences'],
};
entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });

// A small deterministic ZIP writer avoids adding an archive dependency to the app.
const table = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
const crc32 = data => {
  let crc = 0xffffffff;
  for (const value of data) crc = (crc >>> 8) ^ table[(crc ^ value) & 255];
  return (crc ^ 0xffffffff) >>> 0;
};
const body = [];
const central = [];
let offset = 0;
for (const entry of entries) {
  if (entry.name.startsWith('/') || entry.name.split('/').includes('..')) throw new Error('Invalid archive entry path.');
  const name = Buffer.from(entry.name);
  const data = deflateRawSync(entry.data, { level: 9 });
  const crc = crc32(entry.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
  body.push(local, name, data);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14);
  directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(entry.data.length, 24);
  directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
  central.push(directory, name);
  offset += local.length + name.length + data.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...body, directory, end]);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, archive, { flag: 'wx' });
console.log(JSON.stringify({ output, entries: entries.length, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), sourceCommit: manifest.sourceCommit }));

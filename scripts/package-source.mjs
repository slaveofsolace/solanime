import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_FILES = new Set([
  '.editorconfig',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc.json',
  'index.html',
  'branding.html',
  'package.json',
  'playwright.config.ts',
  'playwright.guard.config.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'README.md',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'worker-configuration.d.ts',
  'wrangler.jsonc',
]);
const SOURCE_ROOTS = ['.github/', 'cloud/', 'config/', 'docs/', 'migrations/', 'public/', 'scripts/', 'server/', 'shared/', 'src/', 'tests/'];
const ALWAYS_EXCLUDED = [
  'data/',
  'evidence/',
  'extensions/',
  'build/',
  'dist/',
  'node_modules/',
  'playwright-report/',
  'test-results/',
  '.cache/',
  '.git/',
  '.wrangler/',
];
const HISTORICAL_GUARD_TESTS = new Set(['tests/theme-player.test.ts']);

function normalize(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isSecretOrRuntimePath(path) {
  const parts = path.toLowerCase().split('/');
  const name = parts.at(-1) ?? '';
  if (parts.includes('private')) return true;
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) return true;
  if (name === '.dev.vars' || (name.startsWith('.dev.vars.') && name !== '.dev.vars.example')) return true;
  return /\.(?:pem|key|p12|pfx|sqlite(?:-shm|-wal)?|db)$/i.test(name);
}

export function shouldIncludeSourcePath(input, { includeResearch = false } = {}) {
  const path = normalize(input);
  if (!path || path.includes('/../') || path.startsWith('../')) return false;
  if (ALWAYS_EXCLUDED.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))) return false;
  if (isSecretOrRuntimePath(path)) return false;
  if (path.startsWith('tests/guard/') || HISTORICAL_GUARD_TESTS.has(path)) return false;
  if (path.startsWith('data-dump/')) return includeResearch;
  return ROOT_FILES.has(path) || SOURCE_ROOTS.some((prefix) => path.startsWith(prefix));
}

export function listSourcePaths({ includeResearch = false, root = projectRoot } = {}) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return output
    .split('\0')
    .filter(Boolean)
    .map(normalize)
    .filter((path) => shouldIncludeSourcePath(path, { includeResearch }))
    .sort((a, b) => a.localeCompare(b));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime() {
  // A fixed legal DOS timestamp keeps identical trees byte-for-byte reproducible.
  return { date: (1 << 5) | 1, time: 0 }; // 1980-01-01 00:00
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const compressed = deflateRawSync(entry.content, { level: 9 });
    const checksum = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

export function buildSourceArchive({ out, includeResearch = false, root = projectRoot } = {}) {
  if (!out) throw new Error('Usage: node scripts/package-source.mjs --out=<archive.zip> [--include-research]');
  const paths = listSourcePaths({ includeResearch, root });
  const entries = paths.map((path) => {
    const absolute = resolve(root, ...path.split('/'));
    const relativePath = normalize(relative(root, absolute));
    if (relativePath !== path || relativePath.startsWith('../')) throw new Error(`Unsafe archive path: ${path}`);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Archive input must be a regular file: ${path}`);
    return { path, content: readFileSync(absolute) };
  });
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const gitBranch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  const note = `# Solanime source archive\n\nThis is a source-only working-tree snapshot from branch \`${gitBranch}\` at base commit \`${gitHead}\`. It is not a catalogue backup or a claim that every test from the private engineering checkout is present.\n\nExcluded on purpose: \`data/**\` (including Git LFS catalogue pointers and databases), account/private state, runtime configuration and secrets, browser/build output, captures under \`evidence/**\`, and the historical \`extensions/solanime-guard/**\` component. Its dependent \`tests/guard/**\` and \`tests/theme-player.test.ts\` are omitted with it; they remain preserved in repository history and the private engineering checkout.\n\n${includeResearch ? 'Reviewed `data-dump/**` research material is included because `--include-research` was selected.' : 'Research payloads are excluded. Create a separate archive with `--include-research` when the reviewed public research package is required.'}\n\nUse separately generated, hashed catalogue/research backups for data restoration. A Git LFS pointer is only an object reference, not the database bytes.\n`;
  entries.push({ path: 'SOURCE_ARCHIVE.md', content: Buffer.from(note) });
  const manifest = {
    schemaVersion: 1,
    kind: 'source-only',
    baseCommit: gitHead,
    branch: gitBranch,
    includeResearch,
    files: entries.map(({ path, content }) => ({
      path,
      bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    })),
  };
  entries.push({
    path: 'SOURCE_ARCHIVE_MANIFEST.json',
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  });
  const output = resolve(root, out);
  writeFileSync(output, zip(entries));
  return { output, files: entries.length, bytes: lstatSync(output).size, manifest };
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const result = buildSourceArchive({
    out: option('out'),
    includeResearch: process.argv.includes('--include-research'),
  });
  process.stdout.write(`${JSON.stringify({ output: result.output, files: result.files, bytes: result.bytes }, null, 2)}\n`);
}

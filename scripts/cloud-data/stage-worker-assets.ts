import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASELINE_MAX_FILES, validateBaselineManifest } from '../../server/cloud/data/baseline-schema.ts';
import { validateSnapshotManifest } from '../../server/cloud/data/snapshot-schema.ts';

interface StagedFile { absolute: string; relative: string; }
export interface ReleasePins {
  importManifestPath: string;
  importManifestSha256: string;
  baselineId: string;
  baselineManifestSha256: string;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function inventory(root: string, allowedPrefix: string): StagedFile[] {
  const requested = resolve(root);
  if (!existsSync(requested) || !statSync(requested).isDirectory()) throw new Error(`Private ${allowedPrefix} asset root does not exist: ${requested}`);
  // The existing private-import root is intentionally a compatibility junction.
  // Resolve that root once, then reject every nested link in the payload tree.
  const source = realpathSync(requested);
  const files: StagedFile[] = [];
  const visit = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error('Private asset trees must not contain symbolic links.');
      if (item.isDirectory()) { visit(absolute); continue; }
      if (!item.isFile()) throw new Error('Private asset trees may contain only files and directories.');
      const path = relative(source, absolute).replaceAll('\\', '/');
      if (!path.startsWith(`${allowedPrefix}/`) || path.includes('/../') || path.startsWith('../')) throw new Error('A private asset escaped its reserved namespace.');
      files.push({ absolute, relative: path });
    }
  };
  visit(source);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

/**
 * Assemble the ignored Worker upload directory from independently verified
 * import and catalogue-baseline packages. The output must be fresh so an old
 * namespace can never be silently mixed into a release.
 */
export function stageWorkerAssets(importRoot: string, baselineRoot: string, outputRoot: string, pins: ReleasePins, reservedFiles = 1_000) {
  const output = resolve(outputRoot);
  if (existsSync(output)) throw new Error('Worker asset output already exists; choose a fresh staging directory.');
  if (!Number.isSafeInteger(reservedFiles) || reservedFiles < 0 || reservedFiles >= BASELINE_MAX_FILES) throw new Error('Invalid Worker asset reserve.');
  const importFiles = inventory(importRoot, '__private-import');
  const baselineFiles = inventory(baselineRoot, '__private-baseline');
  const importManifests = importFiles.filter(file => /^__private-import\/[a-f0-9]{64}\/manifest\.json$/.test(file.relative));
  const baselineManifests = baselineFiles.filter(file => /^__private-baseline\/[a-f0-9]{64}\/manifest\.json$/.test(file.relative));
  if (importManifests.length !== 1 || baselineManifests.length !== 1) throw new Error('Expected one pinned manifest in each private asset package.');
  const importBody = readFileSync(importManifests[0].absolute, 'utf8');
  const baselineBody = readFileSync(baselineManifests[0].absolute, 'utf8');
  const importManifest = validateSnapshotManifest(JSON.parse(importBody));
  const baselineManifest = validateBaselineManifest(JSON.parse(baselineBody));
  if (pins.importManifestPath !== `/${importManifests[0].relative}` || hash(importBody) !== pins.importManifestSha256 || pins.baselineId !== baselineManifest.id || hash(baselineBody) !== pins.baselineManifestSha256) throw new Error('Private asset packages do not match the configured release pins.');
  if (importManifests[0].relative !== importManifest.bundles[0]?.path.replace(/^\//, '').replace(/\/bundles\/[^/]+$/, '/manifest.json')) throw new Error('Import manifest namespace does not match its bundle references.');
  if (baselineManifests[0].relative !== `__private-baseline/${baselineManifest.id}/manifest.json`) throw new Error('Baseline manifest namespace does not match its identity.');
  if (importFiles.length !== importManifest.bundles.length + 1 || baselineFiles.length !== baselineManifest.files) throw new Error('Private asset file counts do not reconcile with their manifests.');
  const importByPath = new Map(importFiles.map(file => [`/${file.relative}`, file]));
  for (const ref of importManifest.bundles) {
    const file = importByPath.get(ref.path); if (!file) throw new Error('A pinned private import bundle is missing.');
    const bytes = readFileSync(file.absolute);
    if (bytes.byteLength !== ref.bytes || hash(bytes) !== ref.sha256) throw new Error('A pinned private import bundle failed verification.');
  }
  const baselineByPath = new Map(baselineFiles.map(file => [`/${file.relative}`, file]));
  const referenced = new Set<string>();
  for (const ref of Object.values(baselineManifest.referenceShards)) {
    const file = baselineByPath.get(ref.path); if (!file) throw new Error('A baseline reference shard is missing.');
    const bytes = readFileSync(file.absolute);
    if (bytes.byteLength !== ref.bytes || hash(bytes) !== ref.sha256) throw new Error('A baseline reference shard failed verification.');
    referenced.add(ref.path);
    const values = JSON.parse(bytes.toString('utf8')) as Record<string, { path?: unknown; bytes?: unknown; sha256?: unknown }>;
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('A baseline reference shard is malformed.');
    for (const [path, entry] of Object.entries(values)) {
      if (!entry || entry.path !== path || !Number.isSafeInteger(entry.bytes) || typeof entry.sha256 !== 'string') throw new Error('A baseline payload reference is malformed.');
      const payload = baselineByPath.get(path); if (!payload) throw new Error('A referenced baseline payload is missing.');
      const payloadBytes = readFileSync(payload.absolute);
      if (payloadBytes.byteLength !== entry.bytes || hash(payloadBytes) !== entry.sha256) throw new Error('A baseline payload failed verification.');
      referenced.add(path);
    }
  }
  referenced.add(`/${baselineManifests[0].relative}`);
  if (referenced.size !== baselineFiles.length || baselineFiles.some(file => !referenced.has(`/${file.relative}`))) throw new Error('The baseline package contains unreferenced or unverified files.');
  const combined = [...importFiles, ...baselineFiles];
  if (new Set(combined.map(file => file.relative)).size !== combined.length) throw new Error('Private asset packages contain a path collision.');
  if (combined.length !== baselineManifest.aggregateFiles || combined.length + reservedFiles > BASELINE_MAX_FILES) throw new Error('Combined Worker assets exceed their prepared or reserved file allowance.');
  mkdirSync(output, { recursive: true });
  const outputPrefix = output.endsWith(sep) ? output : output + sep;
  for (const file of combined) {
    const target = resolve(output, file.relative);
    if (!target.startsWith(outputPrefix)) throw new Error('Refusing a staged asset outside the Worker output.');
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.absolute, target, constants.COPYFILE_EXCL);
  }
  return {
    output,
    files: combined.length,
    reservedFiles,
    import: { id: importManifest.id, manifestSha256: pins.importManifestSha256, files: importFiles.length },
    baseline: { id: baselineManifest.id, manifestSha256: pins.baselineManifestSha256, files: baselineFiles.length, counts: baselineManifest.counts },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const imports = option('import-assets'), baseline = option('baseline-assets'), output = option('out');
  if (!imports || !baseline || !output) throw new Error('Use --import-assets=<private import root> --baseline-assets=<private baseline root> --out=<fresh Worker asset directory>.');
  const config = JSON.parse(readFileSync(resolve(option('config') ?? 'wrangler.jsonc'), 'utf8')) as { vars?: Record<string, unknown> };
  const pins: ReleasePins = {
    importManifestPath: String(config.vars?.IMPORT_MANIFEST_PATH ?? ''),
    importManifestSha256: String(config.vars?.IMPORT_MANIFEST_SHA256 ?? ''),
    baselineId: String(config.vars?.CATALOGUE_BASELINE_ID ?? ''),
    baselineManifestSha256: String(config.vars?.CATALOGUE_BASELINE_MANIFEST_SHA256 ?? ''),
  };
  const reserve = option('reserve');
  console.log(JSON.stringify(stageWorkerAssets(imports, baseline, output, pins, reserve === undefined ? 1_000 : Number(reserve)), null, 2));
}

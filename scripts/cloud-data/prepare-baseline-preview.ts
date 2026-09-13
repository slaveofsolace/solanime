import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateBaselineManifest, type BaselineManifest } from '../../server/cloud/data/baseline-schema.ts';
import { stageWorkerAssets, type ReleasePins } from './stage-worker-assets.ts';

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function fileSha256(path: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
const portable = (path: string) => resolve(path).replaceAll('\\', '/');

interface WranglerConfiguration {
  $schema?: string;
  name?: string;
  main?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  assets?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  d1_databases?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface PrepareBaselinePreviewOptions {
  sourceDatabase: string;
  baselineAssets: string;
  importAssets: string;
  output: string;
  config?: string;
  expectedSourceSha256?: string;
  expectedMappings?: number;
  previewAlias?: string;
  reservedFiles?: number;
}

function singleBaselineManifest(root: string) {
  const namespace = join(resolve(root), '__private-baseline');
  if (!existsSync(namespace) || !statSync(namespace).isDirectory()) throw new Error('Private baseline namespace does not exist.');
  const ids = readdirSync(namespace, { withFileTypes: true }).filter(item => item.isDirectory() && /^[a-f0-9]{64}$/.test(item.name));
  if (ids.length !== 1) throw new Error('Expected exactly one private baseline identity.');
  const path = join(namespace, ids[0].name, 'manifest.json');
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error('Private baseline manifest does not exist.');
  const body = readFileSync(path, 'utf8');
  return { path, body, manifest: validateBaselineManifest(JSON.parse(body)) };
}

function releasePins(config: WranglerConfiguration, manifest: BaselineManifest, manifestBody: string): ReleasePins {
  const vars = config.vars ?? {};
  return {
    importManifestPath: String(vars.IMPORT_MANIFEST_PATH ?? ''),
    importManifestSha256: String(vars.IMPORT_MANIFEST_SHA256 ?? ''),
    baselineId: manifest.id,
    baselineManifestSha256: sha256(manifestBody),
  };
}

/**
 * Build a fresh, locally verified preview package. This function never opens
 * SQLite, calls Wrangler, or contacts D1; the immutable database is identified
 * only by a streaming SHA-256 and the already verified baseline manifest.
 */
export async function prepareBaselinePreview(options: PrepareBaselinePreviewOptions) {
  const root = resolve(options.output);
  if (existsSync(root)) throw new Error('Preview output already exists; choose a fresh task-owned directory.');
  const stagingRoot = `${root}.staging-${process.pid}-${randomUUID()}`;
  const sourceDatabase = resolve(options.sourceDatabase);
  if (!existsSync(sourceDatabase) || !statSync(sourceDatabase).isFile()) throw new Error('Source database does not exist.');
  if (existsSync(`${sourceDatabase}-wal`) && statSync(`${sourceDatabase}-wal`).size > 0) throw new Error('Source database has a nonempty WAL; use an immutable checkpoint.');
  const sourceBytes = statSync(sourceDatabase).size;
  const sourceDatabaseSha256 = await fileSha256(sourceDatabase);
  if (options.expectedSourceSha256 && sourceDatabaseSha256 !== options.expectedSourceSha256) throw new Error('Source database does not match the expected SHA-256.');

  const baseline = singleBaselineManifest(options.baselineAssets);
  if (baseline.manifest.id !== sourceDatabaseSha256 || baseline.manifest.sourceDatabaseSha256 !== sourceDatabaseSha256) throw new Error('Baseline package was not prepared from the selected source database.');
  if (options.expectedMappings !== undefined && baseline.manifest.counts.mappings !== options.expectedMappings) throw new Error('Baseline mapping count does not match the expected completed snapshot.');

  const configPath = resolve(options.config ?? 'wrangler.jsonc');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as WranglerConfiguration;
  if (!config.name || !/(^|-)preview($|-)/.test(config.name)) throw new Error('Preview packaging requires an explicitly preview-named Worker.');
  if (!config.main) throw new Error('Wrangler configuration is missing its Worker entry point.');
  if (String(config.vars?.RELEASE_CHANNEL ?? '') !== 'preview') throw new Error('Wrangler configuration is not pinned to the preview release channel.');
  const previewAlias = options.previewAlias ?? 'catalogue-final-20260913';
  if (!/^[a-z][a-z0-9-]*$/.test(previewAlias) || `${previewAlias}-${config.name}`.length > 63) throw new Error('Invalid Worker preview alias.');

  const workerAssets = join(root, 'worker-assets');
  const stagedWorkerAssets = join(stagingRoot, 'worker-assets');
  const pins = releasePins(config, baseline.manifest, baseline.body);
  const staged = stageWorkerAssets(options.importAssets, options.baselineAssets, stagedWorkerAssets, pins, options.reservedFiles ?? 1_000);
  if (await fileSha256(sourceDatabase) !== sourceDatabaseSha256 || (existsSync(`${sourceDatabase}-wal`) && statSync(`${sourceDatabase}-wal`).size > 0)) throw new Error(`Source database changed while preparing the preview plan; discard the unpublished staging directory ${stagingRoot}.`);

  const projectRoot = dirname(configPath);
  const previewConfig: WranglerConfiguration = structuredClone(config);
  previewConfig.$schema = portable(join(projectRoot, 'node_modules', 'wrangler', 'config-schema.json'));
  previewConfig.main = portable(resolve(projectRoot, String(config.main)));
  previewConfig.preview_urls = true;
  previewConfig.assets = { ...(config.assets ?? {}), directory: portable(workerAssets) };
  previewConfig.vars = {
    ...(config.vars ?? {}),
    CATALOGUE_BASELINE_ENABLED: 'true',
    CATALOGUE_BASELINE_ID: pins.baselineId,
    CATALOGUE_BASELINE_MANIFEST_SHA256: pins.baselineManifestSha256,
    RELEASE_CHANNEL: 'preview',
    SOLANIME_REGISTRATION: 'closed',
    SOURCE_REFRESH_ENABLED: 'false',
    SYNC_ENABLED: 'false',
  };
  previewConfig.d1_databases = config.d1_databases?.map(binding => ({
    ...binding,
    ...(typeof binding.migrations_dir === 'string' ? { migrations_dir: portable(resolve(projectRoot, binding.migrations_dir)) } : {}),
  }));

  mkdirSync(stagingRoot, { recursive: true });
  const generatedConfig = join(root, 'wrangler.preview.json');
  writeFileSync(join(stagingRoot, 'wrangler.preview.json'), `${JSON.stringify(previewConfig, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const dryRunOutput = join(root, 'wrangler-dry-run');
  const common = ['pnpm', 'exec', 'wrangler', 'versions', 'upload', '--config', generatedConfig, '--preview-alias', previewAlias, '--strict', '--keep-vars'];
  const plan = {
    version: 1,
    kind: 'solanime-baseline-preview-plan',
    source: { path: sourceDatabase, bytes: sourceBytes, sha256: sourceDatabaseSha256 },
    baseline: {
      package: resolve(options.baselineAssets),
      manifestPath: baseline.path,
      manifestSha256: pins.baselineManifestSha256,
      counts: baseline.manifest.counts,
      files: baseline.manifest.files,
      bytes: baseline.manifest.bytes,
    },
    workerAssets: { path: workerAssets, files: staged.files, reservedFiles: staged.reservedFiles },
    preview: { worker: config.name, alias: previewAlias, config: generatedConfig, registrationOpen: false, syncEnabled: false, sourceRefreshEnabled: false },
    d1WritesByPreparation: 0,
    commands: {
      verifyOnly: [...common, '--dry-run', '--outdir', dryRunOutput],
      uploadPreviewVersionAfterReview: common,
      forbiddenForThisPlan: ['wrangler deploy', 'wrangler versions deploy', 'wrangler d1 execute', 'wrangler d1 migrations apply'],
    },
  };
  const planPath = join(root, 'preview-plan.json');
  writeFileSync(join(stagingRoot, 'preview-plan.json'), `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  renameSync(stagingRoot, root);
  return { ...plan, planPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const sourceDatabase = option('source-db'), baselineAssets = option('baseline-assets'), importAssets = option('import-assets'), output = option('out');
  if (!sourceDatabase || !baselineAssets || !importAssets || !output) throw new Error('Use --source-db=<immutable SQLite> --baseline-assets=<private baseline root> --import-assets=<private import root> --out=<fresh task-owned directory>.');
  const result = await prepareBaselinePreview({
    sourceDatabase,
    baselineAssets,
    importAssets,
    output,
    config: option('config'),
    expectedSourceSha256: option('expected-source-sha256'),
    expectedMappings: option('expected-mappings') === undefined ? undefined : Number(option('expected-mappings')),
    previewAlias: option('preview-alias'),
    reservedFiles: option('reserve') === undefined ? undefined : Number(option('reserve')),
  });
  console.log(JSON.stringify(result, null, 2));
}

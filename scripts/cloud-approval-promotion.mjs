import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPrivateApproval } from './verify-private-approval.mjs';

// This path reuses the deployed immutable asset set. Ordinary `wrangler deploy`
// would need the absent private asset directory and must not be used here.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'build/cloud-approval-promotion');
const planPath = join(output, 'plan.json');
const config = JSON.parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
const gateFlags = ['SOLANIME_PRIVATE_SITE', 'SOLANIME_APPROVAL_REQUIRED'];
const promotedVars = [...gateFlags, 'SOLANIME_ALLOWED_ORIGINS', 'RELEASE_CHANNEL'];
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function wrangler(args) {
  try {
    return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw Error('Wrangler read/deployment command failed; inspect its private local log.');
  }
}
function expectedBindings() {
  return new Set([
    ...Object.keys(config.vars), ...config.secrets.required,
    ...config.d1_databases.map(item => item.binding),
    ...config.queues.producers.map(item => item.binding),
    ...config.ratelimits.map(item => item.name), config.assets.binding,
  ]);
}
function activeVersion() {
  const deployments = JSON.parse(wrangler(['deployments', 'list', '--name', config.name, '--json']));
  const current = deployments.at(-1);
  if (!current || current.versions?.length !== 1 || current.versions[0].percentage !== 100)
    throw Error('Expected one Worker version serving 100% of traffic.');
  return current.versions[0].version_id;
}
function latestVersion() {
  const versions = JSON.parse(wrangler(['versions', 'list', '--name', config.name, '--json']));
  const latest = versions.at(-1)?.id;
  if (!latest) throw Error('Could not identify the latest uploaded Worker version.');
  return latest;
}
function version(id) {
  return JSON.parse(wrangler(['versions', 'view', id, '--name', config.name, '--json']));
}
function validateCurrent(id, remote) {
  if (remote.id !== id) throw Error('Worker version identity changed.');
  const bindings = new Map(remote.resources.bindings.map(item => [item.name, item]));
  const expected = expectedBindings();
  if (!same([...bindings.keys()].sort(), [...expected].sort()))
    throw Error('Current Worker bindings differ from the reviewed configuration.');
  if (bindings.get(config.assets.binding)?.type !== 'assets')
    throw Error('The existing private asset binding is absent.');
  for (const item of config.d1_databases)
    if (bindings.get(item.binding)?.type !== 'd1' || bindings.get(item.binding)?.database_id !== item.database_id)
      throw Error('A D1 binding differs from the reviewed configuration.');
  for (const name of gateFlags)
    if (bindings.get(name)?.type !== 'plain_text' || bindings.get(name)?.text !== 'true')
      throw Error('A deployed approval flag is not enabled.');
  for (const [name, value] of Object.entries(config.vars)) {
    if (promotedVars.includes(name)) continue;
    if (bindings.get(name)?.type !== 'plain_text' || bindings.get(name)?.text !== value)
      throw Error('A deployed plain-text binding differs from the reviewed configuration.');
  }
  for (const name of config.secrets.required)
    if (bindings.get(name)?.type !== 'secret_text') throw Error('A required secret binding is absent.');
  const assets = remote.resources.script_runtime.assets;
  if (!assets || assets.html_handling !== config.assets.html_handling ||
      assets.not_found_handling !== config.assets.not_found_handling ||
      assets.raw_run_worker_first !== config.assets.run_worker_first || assets.serve_directly !== false)
    throw Error('Existing private asset routing differs from the reviewed configuration.');
  if (remote.resources.script_runtime.compatibility_date !== config.compatibility_date ||
      !same(remote.resources.script_runtime.compatibility_flags, config.compatibility_flags))
    throw Error('Worker compatibility settings changed.');
  return bindings;
}
function readToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const path = join(homedir(), '.wrangler/config/default.toml');
  if (!existsSync(path)) throw Error('No existing Wrangler login or CLOUDFLARE_API_TOKEN is available.');
  const match = /^oauth_token\s*=\s*"([^"]+)"/m.exec(readFileSync(path, 'utf8'));
  if (!match) throw Error('Existing Wrangler login has no usable OAuth token.');
  return match[1];
}
function bundle() {
  const temporaryConfig = structuredClone(config);
  temporaryConfig.main = resolve(root, config.main);
  delete temporaryConfig.assets;
  for (const db of temporaryConfig.d1_databases) db.migrations_dir = resolve(root, db.migrations_dir);
  mkdirSync(output, { recursive: true });
  const configPath = join(output, 'wrangler.jsonc');
  writeFileSync(configPath, JSON.stringify(temporaryConfig, null, 2));
  const bundleDir = join(output, 'bundle');
  wrangler(['deploy', '--dry-run', '--config', configPath, '--outdir', bundleDir]);
  const bundlePath = join(bundleDir, 'worker.js');
  const bytes = readFileSync(bundlePath);
  const code = bytes.toString('utf8');
  if (!gateFlags.every(flag => code.includes(flag)) || !code.includes('requiresOwnerApproval'))
    throw Error('The bundled Worker does not contain the reviewed fail-closed approval gate.');
  return { bundlePath, bundleSha256: digest(bytes), bytes: bytes.byteLength };
}
async function assetCanary() {
  // In the existing Worker, /api/health calls catalogue.titleCount(), which
  // verifies the pinned private baseline manifest through IMPORT_ASSETS.
  const response = await fetch(config.vars.SOLANIME_APP_ORIGIN + '/api/health', {
    headers: { 'cache-control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  const health = response.headers.get('content-type')?.includes('application/json')
    ? await response.json() : null;
  if (response.status !== 200 || health?.status !== 'ok' ||
      health?.runtime !== 'cloudflare-workers' || health?.database !== 'connected' ||
      !Number.isSafeInteger(health?.titles) || health.titles < 1 ||
      !Number.isSafeInteger(health?.schemaVersion) || health.schemaVersion < 1)
    throw Error('The existing Worker baseline asset canary is unhealthy.');
  const stable = { status: response.status, release: health.release, runtime: health.runtime,
    database: health.database, schemaVersion: health.schemaVersion, titles: health.titles };
  return { status: response.status, sha256: digest(JSON.stringify(stable)), stable };
}
async function buildPlan() {
  if (!gateFlags.every(name => config.vars[name] === 'true'))
    throw Error('The checked Worker configuration does not enable both approval flags.');
  const previousVersion = activeVersion();
  if (latestVersion() !== previousVersion)
    throw Error('The latest uploaded Worker version is not the active reviewed version.');
  const bindings = validateCurrent(previousVersion, version(previousVersion));
  const canary = await assetCanary();
  const built = bundle();
  const metadata = {
    main_module: 'worker.js', keep_assets: true,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    bindings: [
      ...[...bindings.keys()].filter(name => !promotedVars.includes(name)).sort()
        .map(name => ({ name, type: 'inherit', version_id: 'latest' })),
      ...promotedVars.map(name => ({ name, type: 'plain_text', text: config.vars[name] })),
    ],
    annotations: { 'workers/message': 'Promote verified release while retaining existing private assets' },
  };
  const plan = { previousVersion, built, metadata, expectedBindingNames: [...expectedBindings()].sort(),
    assetRouting: version(previousVersion).resources.script_runtime.assets, canary };
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return plan;
}
async function readPlan() {
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const rebuilt = bundle();
  if (rebuilt.bundleSha256 !== plan.built.bundleSha256 || rebuilt.bytes !== plan.built.bytes)
    throw Error('The Worker source or bundle changed after the plan was reviewed. Recreate and review the plan.');
  if (activeVersion() !== plan.previousVersion)
    throw Error('The active Worker version changed after the plan was reviewed.');
  if (!plan.uploadedVersion && latestVersion() !== plan.previousVersion)
    throw Error('The latest uploaded Worker version changed after the plan was reviewed.');
  validateCurrent(plan.previousVersion, version(plan.previousVersion));
  if ((await assetCanary()).sha256 !== plan.canary.sha256)
    throw Error('The private baseline asset canary changed after the plan was reviewed.');
  return plan;
}
async function apiUpload(plan) {
  const form = new FormData();
  form.set('metadata', JSON.stringify(plan.metadata));
  form.set('worker.js', new Blob([readFileSync(plan.built.bundlePath)], { type: 'application/javascript+module' }), 'worker.js');
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers/scripts/${config.name}/versions?bindings_inherit=strict`;
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${readToken()}` }, body: form,
    signal: AbortSignal.timeout(120_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true || !body.result?.id) {
    const sample = (body?.errors ?? []).slice(0, 2).map(item => ({
      code: item.code,
      message: String(item.message ?? '').replace(/[A-Fa-f0-9]{32,}/g, '[redacted]')
        .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
        .replace(/[\w.+-]+@[\w.-]+/g, '[redacted]'),
    }));
    throw Error(`Asset-preserving version upload failed (HTTP ${response.status}; ${JSON.stringify(sample)}).`);
  }
  return body.result.id;
}
function validateUploaded(plan, uploadedVersion) {
  const remote = version(uploadedVersion);
  const bindings = new Map(remote.resources.bindings.map(item => [item.name, item]));
  const previous = new Map(version(plan.previousVersion).resources.bindings.map(item => [item.name, item]));
  if (!same([...bindings.keys()].sort(), plan.expectedBindingNames) ||
      promotedVars.some(name => bindings.get(name)?.type !== 'plain_text' || bindings.get(name)?.text !== config.vars[name]) ||
      bindings.get(config.assets.binding)?.type !== 'assets' ||
      !same(remote.resources.script_runtime.assets, plan.assetRouting) ||
      [...previous].some(([name, old]) => !promotedVars.includes(name) && !same(bindings.get(name), old)))
    throw Error('Uploaded version does not retain exact bindings and private asset routing. It was not deployed.');
}
async function main() {
  const mode = process.argv[2] ?? 'plan';
  if (mode === 'plan') {
    const plan = await buildPlan();
    console.log(JSON.stringify({ mode, previousVersion: plan.previousVersion, bundleSha256: plan.built.bundleSha256,
      bundleBytes: plan.built.bytes, inheritedBindings: plan.metadata.bindings.length - promotedVars.length,
      updatedPlainTextBindings: promotedVars, keepAssets: plan.metadata.keep_assets,
      assetCanary: { status: plan.canary.status, sha256: plan.canary.sha256 }, planPath }, null, 2));
    return;
  }
  if (!['upload', 'deploy'].includes(mode) || !process.argv.includes('--apply'))
    throw Error('Use plan for read-only review; upload/deploy require an explicit mode and --apply.');
  const plan = await readPlan();
  const expected = `--expect-current=${plan.previousVersion}`;
  if (!process.argv.includes(expected) || !process.argv.includes(`--expect-bundle=${plan.built.bundleSha256}`))
    throw Error('Current version and bundle digest must match the reviewed plan.');
  if (mode === 'upload') {
    if (latestVersion() !== plan.previousVersion)
      throw Error('The inherit source changed before upload.');
    const uploadedVersion = await apiUpload(plan);
    validateUploaded(plan, uploadedVersion);
    plan.uploadedVersion = uploadedVersion;
    writeFileSync(planPath, JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ mode, uploadedVersion, retainedAssets: true, bindingsVerified: true }));
    return;
  }
  if (!plan.uploadedVersion) throw Error('No validated uploaded version is recorded.');
  validateUploaded(plan, plan.uploadedVersion);
  wrangler(['versions', 'deploy', `${plan.uploadedVersion}@100%`, '--name', config.name,
    '--message', 'Promote verified Solanime release with private assets', '--yes']);
  let result = { passed: false }, canary = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      [result, canary] = await Promise.all([
        inspectPrivateApproval(config.vars.SOLANIME_APP_ORIGIN), assetCanary(),
      ]);
      if (result.passed && canary.sha256 === plan.canary.sha256) break;
    } catch { result = { passed: false }; }
  }
  if (!result.passed || canary?.sha256 !== plan.canary.sha256) {
    wrangler(['versions', 'deploy', `${plan.previousVersion}@100%`, '--name', config.name,
      '--message', 'Rollback failed approval or private asset verification', '--yes']);
    throw Error('Live approval or private baseline asset verification failed; previous Worker version was redeployed.');
  }
  console.log(JSON.stringify({ mode, deployedVersion: plan.uploadedVersion,
    previousVersion: plan.previousVersion, privateApprovalVerified: result.passed,
    privateAssetCanarySha256: canary.sha256, checks: result.checks }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

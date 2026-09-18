import { closeSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

type WorkerState = {
  sourceId: string;
  state: 'queued' | 'running' | 'complete' | 'failed';
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logPath: string;
};

const root = resolve(import.meta.dirname, '..');

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name.toUpperCase().replaceAll('-', '_')}_REQUIRED`);
  return resolve(value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

const detached = process.argv.includes('--detach');
if (detached) {
  const args = process.argv.slice(2).filter((value) => value !== '--detach');
  const child = spawn(process.execPath, ['--import', 'tsx', import.meta.filename, ...args], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  process.stdout.write(`${JSON.stringify({ detached: true, pid: child.pid })}\n`);
  process.exit(0);
}

const catalogue = required('catalogue');
const output = required('out');
const statusPath = required('status');
const logDirectory = resolve(option('log-dir') ?? resolve(dirname(statusPath), 'refresh-logs'));
const workerConcurrency = Math.max(1, Math.min(8, Number(option('worker-concurrency') ?? 4)));
const perWorkerRps = Math.max(0.25, Math.min(3, Number(option('per-worker-rps') ?? 1.5)));
const sources = (option('sources') ?? [
  'beyblade-french',
  'beyblade-portuguese-brazil',
  'beyblade-spanish',
  'remow-its-anime',
  'tms-anime-official',
  'beyblade-english',
  'beyblade-german',
  'beyblade-dutch',
  'beyblade-italian',
  'anione-philippines',
  'pokemon-horizons-asia-telugu',
].join(',')).split(',').map((value) => value.trim()).filter(Boolean);

mkdirSync(logDirectory, { recursive: true });
const workers: WorkerState[] = sources.map((sourceId) => ({
  sourceId,
  state: 'queued',
  pid: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  logPath: resolve(logDirectory, `${sourceId}.log`),
}));
const startedAt = new Date().toISOString();

function persist(): void {
  writeJson(statusPath, {
    version: 1,
    orchestratorPid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    finishedAt: workers.every((worker) => ['complete', 'failed'].includes(worker.state))
      ? new Date().toISOString()
      : null,
    workerConcurrency,
    perWorkerRps,
    sources,
    counts: {
      queued: workers.filter((worker) => worker.state === 'queued').length,
      running: workers.filter((worker) => worker.state === 'running').length,
      complete: workers.filter((worker) => worker.state === 'complete').length,
      failed: workers.filter((worker) => worker.state === 'failed').length,
    },
    workers,
  });
}

async function run(worker: WorkerState): Promise<void> {
  const descriptor = openSync(worker.logPath, 'a');
  worker.state = 'running';
  worker.startedAt = new Date().toISOString();
  persist();
  const script = resolve(root, 'scripts', 'discover-official-youtube.ts');
  const child = spawn(process.execPath, [
    '--import', 'tsx', script,
    `--catalogue=${catalogue}`,
    `--config=${resolve(root, 'config', 'official-youtube-discovery.json')}`,
    `--out=${output}`,
    '--phase=probe',
    `--source=${worker.sourceId}`,
    '--shard-count=500',
    '--worker-range=0-499',
    '--global-concurrency=4',
    '--per-host-concurrency=2',
    `--requests-per-second=${perWorkerRps}`,
    '--burst=2',
    '--probe-budget=5000',
    '--observation-region=US',
  ], { cwd: root, windowsHide: true, stdio: ['ignore', descriptor, descriptor] });
  worker.pid = child.pid ?? null;
  persist();
  const exitCode = await new Promise<number>((resolveExit) => {
    child.once('exit', (code) => resolveExit(code ?? 1));
    child.once('error', () => resolveExit(1));
  });
  closeSync(descriptor);
  worker.exitCode = exitCode;
  worker.finishedAt = new Date().toISOString();
  worker.state = exitCode === 0 ? 'complete' : 'failed';
  persist();
}

async function main(): Promise<void> {
  persist();
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(workerConcurrency, workers.length) }, async () => {
    while (cursor < workers.length) {
      const worker = workers[cursor++];
      await run(worker);
    }
  });
  await Promise.all(lanes);
  persist();
  if (workers.some((worker) => worker.state === 'failed')) process.exitCode = 1;
}

main().catch((error) => {
  writeFileSync(resolve(logDirectory, 'orchestrator-error.log'), `${String(error)}\n`, 'utf8');
  process.exitCode = 1;
});

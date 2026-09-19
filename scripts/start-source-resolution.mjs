import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

const action = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'start';
const root = resolve('.');
const cataloguePath = resolve(option('db') ?? process.env.SOLANIME_DB_PATH ?? 'data/solanime.sqlite');
const statePath = resolve(option('state-db') ?? `${cataloguePath}.source-resolution.sqlite`);
const runtimeDirectory = resolve(option('runtime-dir') ?? dirname(statePath));
const pidPath = resolve(runtimeDirectory, 'source-resolution.pid.json');
const stdoutPath = resolve(runtimeDirectory, 'source-resolution.stdout.log');
const stderrPath = resolve(runtimeDirectory, 'source-resolution.stderr.log');
mkdirSync(runtimeDirectory, { recursive: true });

function recordedProcess() {
  if (!existsSync(pidPath)) return null;
  try { return JSON.parse(readFileSync(pidPath, 'utf8')); } catch { return null; }
}

function isAlive(record) {
  if (!record?.pid || !Number.isInteger(Number(record.pid))) return false;
  try { process.kill(Number(record.pid), 0); return true; } catch { return false; }
}

function runControl(controlAction) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/resolve-episode-sources.ts', `--action=${controlAction}`, `--db=${cataloguePath}`, `--state-db=${statePath}`], {
    cwd: root,
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || `Resolution control exited ${result.status}.`);
  return result.stdout.trim();
}

if (action === 'status') {
  console.log(JSON.stringify({ process: recordedProcess(), alive: isAlive(recordedProcess()), status: JSON.parse(runControl('status')) }, null, 2));
} else if (action === 'pause') {
  console.log(runControl('pause'));
} else if (action === 'resume') {
  runControl('resume');
  const record = recordedProcess();
  if (isAlive(record)) console.log(JSON.stringify({ ...record, alive: true, resumed: true }, null, 2));
  else process.argv[2] = 'start';
}

if (action === 'start' || (action === 'resume' && !isAlive(recordedProcess()))) {
  const record = recordedProcess();
  if (isAlive(record)) throw new Error(`Source resolver already runs under PID ${record.pid}.`);
  runControl('init');
  const forwarded = process.argv.slice(3).filter(value => !value.startsWith('--runtime-dir='));
  const args = ['--import', 'tsx', 'scripts/resolve-episode-sources.ts', '--action=run', `--db=${cataloguePath}`, `--state-db=${statePath}`, ...forwarded.filter(value => !value.startsWith('--db=') && !value.startsWith('--state-db='))];
  const stdout = openSync(stdoutPath, 'a');
  const stderr = openSync(stderrPath, 'a');
  try {
    const child = spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr] });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    if (!child.pid) throw new Error('Failed to start the source-resolution process.');
    const next = { pid: child.pid, startedAt: new Date().toISOString(), executable: process.execPath, args, cataloguePath, statePath, stdoutPath, stderrPath };
    writeFileSync(pidPath, `${JSON.stringify(next, null, 2)}\n`);
    child.unref();
    console.log(JSON.stringify(next, null, 2));
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
} else if (!['status', 'pause', 'resume'].includes(action)) {
  throw new Error('Use start, status, pause, or resume.');
}

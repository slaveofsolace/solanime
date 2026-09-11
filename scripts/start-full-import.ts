import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { migrate, openDatabase } from '../server/db.ts';
import { releaseWorkerLease } from '../server/ingestion/queue.ts';

const logDirectory = resolve('data', 'logs');
mkdirSync(logDirectory, { recursive: true });
const stdoutPath = resolve(logDirectory, 'full-import.stdout.log');
const stderrPath = resolve(logDirectory, 'full-import.stderr.log');
const pidPath = resolve(logDirectory, 'full-import.pid.json');
let staleWorkerId: string | null = null;
if (existsSync(pidPath)) {
  try {
    const recorded = JSON.parse(readFileSync(pidPath, 'utf8')) as {
      pid?: unknown;
      workerId?: unknown;
    };
    const pid = Number(recorded.pid);
    if (typeof recorded.workerId === 'string') staleWorkerId = recorded.workerId;
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, 0);
      throw new Error(
        `A full import worker already appears active with PID ${pid}. Pause or stop that exact worker before starting another.`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('A full import worker already appears active') ||
        (error as NodeJS.ErrnoException).code === 'EPERM')
    )
      throw error;
    // A stale or malformed PID record is replaced only after a new worker starts.
  }
}
if (staleWorkerId) {
  const db = openDatabase();
  try {
    migrate(db);
    releaseWorkerLease(db, staleWorkerId);
  } finally {
    db.close();
  }
}
const resumeRunId = process.argv.slice(2).find((argument) => /^\d+$/.test(argument)) ?? null;
const args = [
  '--env-file-if-exists=.env',
  '--import',
  'tsx',
  'scripts/import-anikoto.ts',
  '--mode=full',
];
if (resumeRunId) args.push(`--run-id=${resumeRunId}`);
const stdout = openSync(stdoutPath, 'a');
const stderr = openSync(stderrPath, 'a');
const workerId = randomUUID();
try {
  const child = spawn(process.execPath, args, {
    cwd: resolve('.'),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr],
    env: { ...process.env, SOLANIME_WORKER_ID: workerId },
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    child.once('spawn', resolvePromise);
    child.once('error', rejectPromise);
  });
  if (!child.pid) throw new Error('Failed to start full import worker.');
  const state = {
    pid: child.pid,
    workerId,
    startedAt: new Date().toISOString(),
    command: [process.execPath, ...args].join(' '),
    stdoutPath,
    stderrPath,
  };
  writeFileSync(pidPath, `${JSON.stringify(state, null, 2)}\n`);
  child.unref();
  console.log(JSON.stringify(state, null, 2));
} finally {
  closeSync(stdout);
  closeSync(stderr);
}

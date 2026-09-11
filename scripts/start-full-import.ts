import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
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
    const recorded = JSON.parse(readFileSync(pidPath, 'utf8')) as { pid?: unknown; workerId?: unknown };
    const pid = Number(recorded.pid);
    if (typeof recorded.workerId === 'string') staleWorkerId = recorded.workerId;
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, 0);
      throw new Error(`A full import worker already appears active with PID ${pid}. Pause or stop that exact worker before starting another.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('A full import worker already appears active')) throw error;
    // A stale or malformed PID record is replaced only after a new worker starts.
  }
}
if (staleWorkerId) {
  const db = openDatabase();
  try { migrate(db); releaseWorkerLease(db, staleWorkerId); }
  finally { db.close(); }
}
const pnpm = process.env.SOLANIME_PNPM_PATH ?? 'pnpm';
const resumeRunId = process.argv.slice(2).find((argument) => /^\d+$/.test(argument)) ?? null;
const importArguments = resumeRunId ? `import:anikoto --mode=full --run-id=${resumeRunId}` : 'import:anikoto --mode=full';
const stdout = openSync(stdoutPath, 'a');
const stderr = openSync(stderrPath, 'a');
const workerId = randomUUID();
const child = spawn('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', `${pnpm} ${importArguments}`], {
  cwd: resolve('.'),
  detached: true,
  windowsHide: true,
  stdio: ['ignore', stdout, stderr],
  env: { ...process.env, SOLANIME_WORKER_ID: workerId },
});
if (!child.pid) throw new Error('Failed to start full import worker.');
const state = { pid: child.pid, workerId, startedAt: new Date().toISOString(), command: `pnpm ${importArguments}`, stdoutPath, stderrPath };
writeFileSync(pidPath, `${JSON.stringify(state, null, 2)}\n`);
child.unref();
console.log(JSON.stringify(state, null, 2));

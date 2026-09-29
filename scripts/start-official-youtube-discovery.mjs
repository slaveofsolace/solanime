import { closeSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const outRaw = option('out');
if (!outRaw) throw new Error('OUTPUT_PATH_REQUIRED');
const out = resolve(outRaw);
const log = resolve(option('log') ?? resolve(out, 'discovery.log'));
const pidFile = resolve(option('pid-file') ?? resolve(out, 'process.json'));
mkdirSync(dirname(log), { recursive: true });
mkdirSync(dirname(pidFile), { recursive: true });
const forwarded = process.argv.slice(2).filter((value) => !value.startsWith('--log=') && !value.startsWith('--pid-file='));
const script = resolve(import.meta.dirname, 'discover-official-youtube.ts');
const childArgs = ['--env-file-if-exists=.env', '--import', 'tsx', script, ...forwarded];
const descriptor = openSync(log, 'a');
const child = spawn(process.execPath, childArgs, {
  cwd: resolve(import.meta.dirname, '..'),
  detached: true,
  windowsHide: true,
  stdio: ['ignore', descriptor, descriptor],
});
closeSync(descriptor);
if (!child.pid) throw new Error('DETACHED_LAUNCH_FAILED');
const record = {
  version: 1,
  pid: child.pid,
  startedAt: new Date().toISOString(),
  executable: process.execPath,
  args: childArgs,
  cwd: resolve(import.meta.dirname, '..'),
  log,
  output: out,
};
const temp = `${pidFile}.${process.pid}.tmp`;
writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
renameSync(temp, pidFile);
child.unref();
process.stdout.write(`${JSON.stringify(record)}\n`);

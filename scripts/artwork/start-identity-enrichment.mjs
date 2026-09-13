import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const option = (name) => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
};
const out = option('out');
const log = option('log');
const pidFile = option('pid-file');
if (!out || !log || !pidFile || !process.argv.includes('--execute') || !process.argv.includes('--identity-only') || option('title-ids') !== 'all-anikoto') throw new Error('Use explicit --title-ids=all-anikoto --execute --identity-only plus new --out, --log and --pid-file paths.');
for (const path of [resolve(out), resolve(log), resolve(pidFile)]) if (existsSync(path)) throw new Error(`Historical identity evidence already exists: ${path}`);
mkdirSync(dirname(resolve(log)), { recursive: true });
mkdirSync(dirname(resolve(pidFile)), { recursive: true });
const forwarded = process.argv.slice(2).filter((value) => !value.startsWith('--log=') && !value.startsWith('--pid-file='));
const script = resolve(import.meta.dirname, 'enrich.ts');
const childArgs = ['--import', 'tsx', script, ...forwarded];
const descriptor = openSync(resolve(log), 'wx');
const child = spawn(process.execPath, childArgs, {
  cwd: resolve(import.meta.dirname, '..', '..'),
  detached: true,
  windowsHide: true,
  stdio: ['ignore', descriptor, descriptor],
});
closeSync(descriptor);
if (!child.pid) throw new Error('DETACHED_IDENTITY_LAUNCH_FAILED');
const record = { version: 1, pid: child.pid, startedAt: new Date().toISOString(), executable: process.execPath, args: childArgs, cwd: resolve(import.meta.dirname, '..', '..'), log: resolve(log), receipt: resolve(out) };
writeFileSync(resolve(pidFile), `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
child.unref();
process.stdout.write(`${JSON.stringify(record)}\n`);

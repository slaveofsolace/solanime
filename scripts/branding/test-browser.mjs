import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = path.resolve(argument('output') ?? 'test-results/branding');
const temporary = path.join(output, 'temporary');
await mkdir(temporary, { recursive: true });
const env = { ...process.env, BRANDING_TEST_OUTPUT: output, TEMP: temporary, TMP: temporary, TMPDIR: temporary };
if (argument('browser-dir')) env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(argument('browser-dir'));
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'scripts/branding/playwright.config.ts'], { stdio: 'inherit', env, windowsHide: true });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });

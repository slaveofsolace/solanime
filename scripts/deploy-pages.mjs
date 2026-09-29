import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Pages does not accept account_id or an alternate --config file. Run from its
// own config directory and select the already configured Worker account via env.
const root = fileURLToPath(new URL('../', import.meta.url));
const configuration = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'));
const branch = process.argv.find(value => value.startsWith('--branch='))?.slice(9) ?? 'cloud-release';
const directory = resolve(root, process.argv.find(value => value.startsWith('--directory='))?.slice(12) ?? 'dist');
const release = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const html = readFileSync(resolve(directory, 'index.html'), 'utf8');
if (!html.includes(`name="solanime-release" content="${release}"`)) throw new Error('Build release does not match the reviewed source release.');
if (!['cloud-release', 'main'].includes(branch)) throw new Error('Choose cloud-release preview or the explicitly reviewed main production branch.');
if (branch === 'main' && !process.argv.includes('--promote-verified-release')) throw new Error('Production requires --promote-verified-release after the documented release gate.');
if (!/^[a-f0-9]{32}$/.test(configuration.account_id)) throw new Error('The reviewed Cloudflare account is missing from Worker configuration.');
const child = spawn(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'pages', 'deploy', directory, '--project-name', 'solanime', '--branch', branch], {
  cwd: resolve(root, 'cloud/pages'),
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: configuration.account_id },
  stdio: 'inherit',
  windowsHide: true,
});
child.once('error', () => { console.error('The Pages deployment process could not start.'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });

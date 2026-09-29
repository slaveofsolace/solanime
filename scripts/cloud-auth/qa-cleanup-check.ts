import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { boundedJson } from '../../server/cloud/auth/http.ts';
import { object } from '../../server/accounts/validation.ts';

/** Read-only reconciliation evidence for reserved-domain disposable preview QA.
 * This never deletes identities and never emits emails, IDs, keys or tokens.
 * Firebase's partial-response selector requests only email fields, not hashes.
 */
const project = 'solanime-9ef23';
const database = 'solanime-accounts-preview';
const args = process.argv.slice(2);
const index = args.indexOf('--service-account');
const servicePath = index < 0 ? undefined : args[index + 1];
const root = fileURLToPath(new URL('../../', import.meta.url));
const qaEmail = /^qa-[0-9]+-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}@solanime\.example$/;
let stage = 'configuration';

async function jsonFetch(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel(); throw Error('Read-only identity inspection was not confirmed.');
  }
  return boundedJson(response, 512 * 1024, 20_000);
}

async function main() {
  if (!servicePath) throw Error('Supply the existing preview service-account path; no credentials belong on the command line.');
  const raw = await readFile(servicePath, 'utf8');
  if (raw.length > 32_768) throw Error('Unexpected service-account file size.');
  const account: unknown = JSON.parse(raw);
  if (!object(account) || account.project_id !== project || account.type !== 'service_account' ||
    typeof account.client_email !== 'string' || !account.client_email.endsWith('@' + project + '.iam.gserviceaccount.com') ||
    typeof account.private_key !== 'string') throw Error('The exact preview identity project was not confirmed.');
  const issued = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 300 });
  const assertion = unsigned + '.' + createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
  stage = 'oauth';
  const token = await jsonFetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
  if (typeof token.access_token !== 'string' || token.token_type !== 'Bearer') throw Error('Identity inspection authorization was not confirmed.');
  const query = new URLSearchParams({ maxResults: '1000', fields: 'users(email),nextPageToken' });
  stage = 'firebase-list';
  const listing = await jsonFetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?${query}`, {
    headers: { authorization: 'Bearer ' + token.access_token, accept: 'application/json' },
  });
  if (listing.users !== undefined && (!Array.isArray(listing.users) || !listing.users.every(object))) throw Error('Identity inspection schema changed.');
  const users = (listing.users ?? []) as Record<string, unknown>[];
  const firebaseQaCount = users.filter(user => typeof user.email === 'string' && qaEmail.test(user.email)).length;
  const firebaseComplete = !listing.nextPageToken;

  // Existing Wrangler credentials stay within Wrangler. Capture only this fixed
  // aggregate SELECT; never echo its stdout/stderr if the command fails.
  const sql = `SELECT COUNT(*) AS qaAccounts, COALESCE(SUM(auth_state='active'),0) AS qaActive,
    COALESCE(SUM(auth_state<>'active'),0) AS qaPending FROM accounts
    WHERE email GLOB 'qa-[0-9]*-*-*-*-*-*@solanime.example'`;
  stage = 'd1-aggregate';
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
    'd1', 'execute', database, '--remote', '--config', fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)), '--json', '--command', sql],
  { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 45_000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const result: unknown = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1 || !object(result[0]) || result[0].success !== true ||
    !Array.isArray(result[0].results) || result[0].results.length !== 1 || !object(result[0].results[0])) throw Error('Private D1 aggregate was not confirmed.');
  const row = result[0].results[0];
  if (!['qaAccounts', 'qaActive', 'qaPending'].every(key => Number.isSafeInteger(row[key]) && Number(row[key]) >= 0)) throw Error('Invalid private D1 aggregate.');
  const clean = firebaseComplete && firebaseQaCount === 0 && row.qaAccounts === 0;
  console.log(JSON.stringify({ mutations: 0, firebaseQaCount, firebaseComplete, d1: row, cleanupConfirmed: clean }));
  if (!clean) process.exitCode = 1;
}

main().catch(() => {
  console.error(JSON.stringify({ mutations: 0, cleanupConfirmed: false, stage, error: 'Read-only preview inspection could not be completed; no private details were emitted.' }));
  process.exitCode = 1;
});

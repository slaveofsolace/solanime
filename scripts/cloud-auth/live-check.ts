import { randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseLiveCheckOptions } from './live-check-options';

/** Explicit opt-in acceptance, preview-only unless canonical QA is also enabled.
 * No emails are sent. Test passwords, cookies and recovery codes remain in memory;
 * output contains only public stage names/statuses, never identities or credentials.
 */
const options = parseLiveCheckOptions(process.argv.slice(2));
const { origin } = options;

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Z_]{1,64}$/.test(value) ? value : 'UNSPECIFIED';
class CheckFailure extends Error {}
let checks = 0;
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new CheckFailure(label);
  checks++;
}
function client() {
  let cookie = '', csrf = '';
  return {
    async call(path: string, value?: unknown, extra: Record<string, string> = {}) {
      let response: Response;
      try {
        response = await fetch(origin + '/api/account/' + path, {
          method: value === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
          headers: { accept: 'application/json', ...(cookie ? { cookie } : {}), ...(value === undefined ? {} : {
            origin, 'content-type': 'application/json', 'x-solanime-intent': 'account', 'x-csrf-token': csrf, 'sec-fetch-site': 'same-origin',
          }), ...extra }, ...(value === undefined ? {} : { body: JSON.stringify(value) }),
        });
      } catch { throw new CheckFailure('Hosted request failed or timed out; no private network details are emitted.'); }
      if (response.status >= 300 && response.status < 400) throw new CheckFailure('Hosted origin unexpectedly redirected; destination was not followed.');
      if (!response.headers.get('content-type')?.includes('application/json')) throw new CheckFailure('Hosted origin did not return JSON.');
      const body: unknown = await response.json();
      if (!object(body)) throw new CheckFailure('Hosted origin returned an invalid response shape.');
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      if (typeof body.csrfToken === 'string') csrf = body.csrfToken;
      const error = object(body.error) ? body.error : {};
      const details = object(error.details) ? error.details : {};
      return { response, body, code: safeCode(error.code), reason: safeCode(details.reason) };
    },
  };
}
type Client = ReturnType<typeof client>;
type OwnedIdentity = { email: string; uid?: string; passwords: string[]; alive: boolean; client: Client };
const identities: OwnedIdentity[] = [];
const password = () => 'Solanime ephemeral QA ' + randomBytes(24).toString('base64url');
function newIdentity(): OwnedIdentity {
  const value = { email: `qa-${Date.now()}-${randomUUID()}@solanime.example`, passwords: [password()], alive: false, client: client() };
  identities.push(value); return value;
}
function expected(result: Awaited<ReturnType<Client['call']>>, status: number, stage: string) {
  check(result.response.status === status, `${stage}: HTTP ${result.response.status} (${result.code}/${result.reason}).`);
}
function accountId(body: ObjectValue) { return object(body.account) && typeof body.account.id === 'string' ? body.account.id : undefined; }
function profileId(body: ObjectValue) {
  const first = Array.isArray(body.profiles) ? body.profiles[0] : undefined;
  if (!object(first) || typeof first.id !== 'string') throw new CheckFailure('Expected an account-owned default profile.');
  return first.id;
}
function stage(name: string) { console.info(JSON.stringify({ stage: name, status: 'passed' })); }
async function register(value: OwnedIdentity) {
  const result = await value.client.call('register', { email: value.email, password: value.passwords[0] });
  // A 5xx registration outcome may be ambiguous. Always attempt bounded cleanup.
  value.alive = result.response.status === 201 || result.response.status >= 500;
  expected(result, 201, 'register'); value.uid = accountId(result.body);
  check(value.uid, 'Registration did not return a stable account identity.');
  check(typeof result.body.recoveryCode === 'string', 'Registration did not supply its single-use recovery code.');
  const cookie = result.response.headers.get('set-cookie') ?? '';
  check(cookie.startsWith('__Host-solanime_session=') && cookie.includes('HttpOnly') && cookie.includes('Secure') && !/;\s*Domain=/i.test(cookie), 'Session cookie security contract failed.');
  return { profile: profileId(result.body), recovery: result.body.recoveryCode };
}
async function cleanup(value: OwnedIdentity) {
  if (!value.alive) return true;
  for (const candidate of [...value.passwords].reverse()) {
    try {
      const session = client();
      const login = await session.call('login', { email: value.email, password: candidate });
      if (login.response.status !== 200) continue;
      const uid = accountId(login.body);
      if (!uid || (value.uid && uid !== value.uid)) continue;
      const removed = await session.call('delete', { currentPassword: candidate });
      if (removed.response.status === 200) { value.alive = false; return true; }
    } catch { /* Continue only over the three locally generated test passwords. */ }
  }
  return false;
}

let failed = false;
try {
  const readiness = await client().call('session');
  expected(readiness, 200, 'managed-auth readiness');
  if (!options.execute) {
    console.info(JSON.stringify({ mode: 'read-only', status: 'ready', registrationOpen: readiness.body.registrationOpen === true,
      mutations: 0, next: 'Add --execute to create, test and delete reserved-domain disposable identities.' }));
  } else {
    check(readiness.body.registrationOpen === true, 'Hosted registration is closed; no live accounts were created.');
    const probe = await client().call('login', { email: `qa-probe-${randomUUID()}@solanime.example`, password: password() });
    expected(probe, 401, 'identity transport readiness');
    const owner = newIdentity();
    const first = await register(owner);
    const defaultProfile = first.profile;
    stage('register-secure-session');
    expected(await owner.client.call(`profiles/${defaultProfile}/data`, { key: 'preferences', value: { autoplayNext: true }, revision: 0 }), 200, 'profile write');
    const device = client();
    const login = await device.call('login', { email: owner.email, password: owner.passwords[0] });
    expected(login, 200, 'login'); check(accountId(login.body) === owner.uid, 'Login changed the stable account identity.');
    const persisted = await device.call(`profiles/${defaultProfile}/data`);
    expected(persisted, 200, 'profile read');
    check(object(persisted.body.values) && object(persisted.body.values.preferences) && persisted.body.values.preferences.autoplayNext === true, 'Profile preferences did not persist across sessions.');
    expected(await device.call(`profiles/${defaultProfile}/data`, { key: 'preferences', value: { autoplayNext: false }, revision: 0 }), 409, 'revision conflict');
    expected(await device.call(`profiles/${defaultProfile}/data`, { key: 'preferences', value: { autoplayNext: false }, revision: 1 }, { 'x-csrf-token': 'test-invalid-csrf' }), 403, 'CSRF rejection');
    stage('login-persistence-revision-csrf');
    const profiles = await Promise.all(Array.from({ length: 6 }, (_, index) => owner.client.call('profiles', { name: `Temporary QA ${index}`, avatar: 'ruby' })));
    check(profiles.filter(result => result.response.status === 201).length === 4 && profiles.filter(result => result.response.status === 409).length === 2, 'Concurrent profile limit did not retain exactly five profiles.');
    stage('concurrent-five-profile-limit');
    const stranger = newIdentity();
    await register(stranger);
    expected(await stranger.client.call(`profiles/${defaultProfile}/data`), 404, 'account isolation read');
    expected(await stranger.client.call(`profiles/${defaultProfile}/data`, { key: 'preferences', value: { autoplayNext: false }, revision: 1 }), 404, 'account isolation write');
    expected(await stranger.client.call('delete', { currentPassword: stranger.passwords[0] }), 200, 'isolated account delete'); stranger.alive = false;
    stage('account-isolation-delete');
    const recoveredPassword = password(); owner.passwords.push(recoveredPassword);
    const recovery = await client().call('recover', { email: owner.email, password: recoveredPassword, recoveryCode: first.recovery });
    expected(recovery, 200, 'single-use recovery');
    check(typeof recovery.body.recoveryCode === 'string' && recovery.body.recoveryCode !== first.recovery, 'Recovery code did not rotate.');
    check((await owner.client.call('session')).body.account === null && (await device.call('session')).body.account === null, 'Recovery did not revoke old sessions.');
    expected(await client().call('recover', { email: owner.email, password: recoveredPassword, recoveryCode: first.recovery }), 400, 'used recovery code rejection');
    const recovered = client();
    const recoveredLogin = await recovered.call('login', { email: owner.email, password: recoveredPassword });
    expected(recoveredLogin, 200, 'recovered password login');
    check(accountId(recoveredLogin.body) === owner.uid, 'Recovery changed the stable account identity.');
    expected(await recovered.call(`profiles/${defaultProfile}/data`), 200, 'profile preserved through recovery');
    stage('recovery-code-rotation-revocation');
    const finalPassword = password(); owner.passwords.push(finalPassword);
    expected(await recovered.call('password', { currentPassword: recoveredPassword, password: finalPassword }), 200, 'change password');
    expected(await client().call('login', { email: owner.email, password: recoveredPassword }), 401, 'old password rejection');
    expected(await recovered.call('delete', { currentPassword: finalPassword }), 200, 'account delete'); owner.alive = false;
    check((await recovered.call('session')).body.account === null, 'Deleted account retained its session.');
    expected(await client().call('login', { email: owner.email, password: finalPassword }), 401, 'deleted account rejection');
    stage('password-change-delete');
  }
} catch (error) {
  failed = true;
  console.error(JSON.stringify({ status: 'failed', message: error instanceof CheckFailure ? error.message : 'The live check encountered an unexpected local error; private details are not emitted.' }));
} finally {
  let complete = (await Promise.all(identities.map(cleanup))).every(Boolean);
  if (!complete && options.holdOnFailure && process.stdin.isTTY) {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try {
      // A failed deployment can be repaired while this exact identity remains in
      // memory. Retrying cleanup never creates or enumerates another account.
      while (!complete) {
        const action = (await input.question('Private QA state is held in memory. Enter cleanup after the fix, or exit for operator review: ')).trim();
        if (action === 'exit') break;
        if (action === 'cleanup') complete = (await Promise.all(identities.map(cleanup))).every(Boolean);
      }
    } finally { input.close(); }
  }
  console.info(JSON.stringify({ status: !failed && complete ? 'passed' : 'failed', checks, disposableIdentities: identities.length,
    deletedIdentities: identities.filter(value => !value.alive).length, cleanupComplete: complete,
    ...(complete ? {} : { action: 'Operator review required for the disposable qa-* identities under solanime.example; no credentials were retained.' }) }));
  if (failed || !complete) process.exitCode = 1;
}

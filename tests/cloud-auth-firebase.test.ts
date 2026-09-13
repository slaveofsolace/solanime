import { describe, expect, it } from 'vitest';
import { FirebaseRestIdentity } from '../server/cloud/auth/firebase';
import { encodeBytes } from '../server/cloud/auth/crypto';
import { generatedTestApiKey, generatedTestPassphrase, generatedTestToken, testPkcs8Pem } from './helpers/auth-material';

const projectId = 'solanime-test-project';
const apiKey = generatedTestApiKey();
const now = 1800000000000;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function token(uid: string, overrides: Record<string, unknown> = {}) {
  const part = (value: unknown) => encodeBytes(new TextEncoder().encode(JSON.stringify(value)));
  // Test-only response from the injected HTTPS transport; never accepted from an application request.
  return `${part({ alg: 'RS256' })}.${part({ sub: uid, aud: projectId, iss: `https://securetoken.google.com/${projectId}`,
    exp: now / 1000 + 3600, auth_time: now / 1000, ...overrides })}.testSignature`;
}
describe('Firebase fixed-origin REST contract', () => {
  it('signs in with a server-side JSON request and consumes verified TLS-origin session fields', async () => {
    const passphrase = generatedTestPassphrase('Firebase sign-in');
    const refreshCredential = generatedTestToken('Firebase refresh');
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return json({ localId: 'account', idToken: token('account'), refreshToken: refreshCredential, expiresIn: '3600' });
    };
    const firebase = new FirebaseRestIdentity({ apiKey, projectId }, transport, () => now);
    const value = await firebase.signIn('user@example.test', passphrase);
    expect(requests[0].url).toBe(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`);
    expect(requests[0].init?.redirect).toBe('manual');
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ email: 'user@example.test', password: passphrase, returnSecureToken: true });
    expect(value).toMatchObject({ uid: 'account', refreshToken: refreshCredential, authenticatedAt: now, expiresAt: now + 3600000 });
    expect(firebase.recoveryAvailable).toBe(false);
  });
  it('rejects wrong project, unexpected identities and malformed tokens', async () => {
    for (const badToken of [token('different'), token('account', { aud: 'wrong-project' }), token('account', { exp: 0 }), 'not-a-jwt']) {
      const firebase = new FirebaseRestIdentity({ apiKey, projectId }, async () => json({ localId: 'account', idToken: badToken, refreshToken: 'refresh', expiresIn: '3600' }), () => now);
      await expect(firebase.signIn('user@example.test', 'password')).rejects.toMatchObject({ status: 502, outcomeUncertain: true });
    }
  });
  it('rotates refresh credentials through the securetoken endpoint without changing authentication time', async () => {
    let sent = '';
    const oldCredential = generatedTestToken('old refresh');
    const rotatedCredential = generatedTestToken('rotated refresh');
    const firebase = new FirebaseRestIdentity({ apiKey, projectId }, async (url, init) => {
      sent = String(url);
      expect(new URLSearchParams(String(init?.body)).get('grant_type')).toBe('refresh_token');
      expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe(oldCredential);
      return json({ user_id: 'account', id_token: token('account'), refresh_token: rotatedCredential, expires_in: '3600' });
    }, () => now);
    const refreshed = await firebase.refresh({ uid: 'account', idToken: token('account'), refreshToken: oldCredential, expiresAt: now, authenticatedAt: now });
    expect(sent).toBe(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`);
    expect(refreshed.refreshToken).toBe(rotatedCredential);
  });
  it('redacts credential failures and handles challenges without bypass attempts', async () => {
    for (const [message, status, reason] of [
      ['INVALID_LOGIN_CREDENTIALS', 401, 'AUTH_CREDENTIAL_REJECTED'],
      ['MISSING_RECAPTCHA_TOKEN', 403, 'AUTH_CHALLENGE_REQUIRED'],
      ['OPERATION_NOT_ALLOWED', 503, 'AUTH_UPSTREAM_CONFIGURATION'],
      ['TOO_MANY_ATTEMPTS_TRY_LATER', 429, 'AUTH_UPSTREAM_RATE_LIMIT'],
    ] as const) {
      const firebase = new FirebaseRestIdentity({ apiKey, projectId }, async () => json({ error: { message, credential: 'DO_NOT_ECHO' } }, 400), () => now);
      await expect(firebase.signIn('user@example.test', 'private')).rejects.toMatchObject({ status, details: { reason } });
      try { await firebase.signIn('user@example.test', 'private'); } catch (error) { expect(String(error)).not.toContain('DO_NOT_ECHO'); }
    }
  });
  it('bounds malformed/oversized responses and treats network write outcomes as uncertain', async () => {
    const responses = [new Response('<html>not JSON</html>', { headers: { 'content-type': 'text/html' } }), json({ huge: 'x'.repeat(132000) })];
    for (const response of responses) {
      const firebase = new FirebaseRestIdentity({ apiKey, projectId }, async () => response, () => now);
      await expect(firebase.signUp('user@example.test', 'private')).rejects.toMatchObject({ status: 502, outcomeUncertain: true });
    }
    const failed = new FirebaseRestIdentity({ apiKey, projectId }, async () => { throw Error('secret-bearing internal network detail'); }, () => now);
    await expect(failed.signUp('user@example.test', 'private')).rejects.toMatchObject({ status: 503, outcomeUncertain: true });
  });
  it('uses the Worker-supported manual redirect mode and never follows secret-bearing authentication redirects', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      let calls = 0;
      const firebase = new FirebaseRestIdentity({ apiKey, projectId }, async (input, init) => {
        calls++;
        expect(String(input).startsWith('https://identitytoolkit.googleapis.com/')).toBe(true);
        expect(init?.redirect).toBe('manual');
        return new Response(null, { status, headers: { location: 'https://unexpected.example.test/?private=must-not-escape' } });
      }, () => now);
      await expect(firebase.signUp('user@example.test', 'private password')).rejects.toMatchObject({
        status: 502, outcomeUncertain: true, details: { reason: 'AUTH_UPSTREAM_REDIRECT' },
      });
      expect(calls).toBe(1);
    }
  });
  it('uses only the narrow recovery OAuth scope, fixed Google token host and target UID', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const exported = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    const pem = testPkcs8Pem(btoa(String.fromCharCode(...exported)));
    const accessCredential = generatedTestToken('recovery access');
    const changedPassword = generatedTestPassphrase('Firebase recovery');
    const serviceAccountJson = JSON.stringify({ type: 'service_account', project_id: projectId,
      client_email: `test-recovery@${projectId}.iam.gserviceaccount.com`, private_key: pem, token_uri: 'https://oauth2.googleapis.com/token' });
    const urls: string[] = [];
    const firebase = new FirebaseRestIdentity({ apiKey, projectId, serviceAccountJson }, async (input, init) => {
      const url = String(input); urls.push(url);
      expect(init?.redirect).toBe('manual');
      if (url === 'https://oauth2.googleapis.com/token') {
        const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
        const claims = JSON.parse(atob(assertion.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
        expect(claims.scope).toBe('https://www.googleapis.com/auth/identitytoolkit');
        expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
        expect(claims.exp - claims.iat).toBe(300);
        return json({ token_type: 'Bearer', access_token: accessCredential });
      }
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${accessCredential}`);
      expect(JSON.parse(String(init?.body))).toEqual({ localId: 'account', password: changedPassword, validSince: String(now / 1000), returnSecureToken: false });
      return json({ localId: 'account' });
    }, () => now);
    expect(firebase.recoveryAvailable).toBe(true);
    await firebase.resetPassword('account', changedPassword);
    expect(urls).toEqual(['https://oauth2.googleapis.com/token', `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`]);
    expect(() => new FirebaseRestIdentity({ apiKey, projectId, serviceAccountJson: serviceAccountJson.replace('https://oauth2.googleapis.com/token', 'http://127.0.0.1/admin') })).toThrow();
    for (const malformedPem of [pem.replace('PRIVATE KEY', 'PUBLIC KEY'), pem.replace('END PRIVATE', 'END RSA PRIVATE'), `unexpected-prefix${pem}`, `${pem}unexpected-suffix`, pem.replace(btoa(String.fromCharCode(...exported)), '').replaceAll('\n', '')]) {
      expect(() => new FirebaseRestIdentity({ apiKey, projectId,
        serviceAccountJson: JSON.stringify({ ...JSON.parse(serviceAccountJson), private_key: malformedPem }) })).toThrow();
    }
  });
});

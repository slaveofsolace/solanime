import { AppError } from '../../errors.ts';
import { emailAddress, object } from '../../accounts/validation.ts';
import { boundedJson } from './http.ts';
import { decodeBytes, encodeBytes } from './crypto.ts';
import type { IdentityCredentials, IdentityUser, ManagedIdentity } from './types.ts';

export type FirebaseAuthOptions = { apiKey: string; projectId: string; serviceAccountJson?: string };
export class FirebaseAuthError extends AppError {
  constructor(status: number, message: string, reason: string, readonly outcomeUncertain = false,
    details: Record<string, unknown> = {}) {
    super(status, status === 401 || status === 403 ? 'UNAUTHORIZED' : status === 409 || status === 400 ? 'BAD_REQUEST' : 'UNAVAILABLE',
      message, { reason, ...details });
  }
}
type Action = 'signUp' | 'signInWithPassword' | 'lookup' | 'update' | 'delete';
type ServiceAccount = { client_email: string; private_key: string; private_key_id?: string };
const encoder = new TextEncoder();
// PKCS#8 envelope labels are public format syntax, not embedded key material.
const pkcs8Label = 'PRIVATE KEY';
const pkcs8Begin = `-----BEGIN ${pkcs8Label}-----`;
const pkcs8End = `-----END ${pkcs8Label}-----`;
const pkcs8Envelope = new RegExp(`^${pkcs8Begin}[\\s\\S]+${pkcs8End}\\s*$`);
const pkcs8Delimiters = new RegExp(`${pkcs8Begin}|${pkcs8End}|\\s`, 'g');
const uid = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[\s\u0000-\u001f]/.test(value);
const positiveSeconds = (value: unknown) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 86400) throw new Error();
  return number;
};
function serviceAccount(value: string | undefined, projectId: string): ServiceAccount | undefined {
  if (!value) return;
  try {
    if (value.length > 32768) throw new Error();
    const parsed: unknown = JSON.parse(value);
    if (!object(parsed) || parsed.type !== 'service_account' || parsed.project_id !== projectId ||
      typeof parsed.client_email !== 'string' || !/^[\w.-]+@[\w.-]+\.iam\.gserviceaccount\.com$/.test(parsed.client_email) ||
      typeof parsed.private_key !== 'string' || !pkcs8Envelope.test(parsed.private_key) ||
      (parsed.token_uri !== undefined && parsed.token_uri !== 'https://oauth2.googleapis.com/token') ||
      (parsed.private_key_id !== undefined && (typeof parsed.private_key_id !== 'string' || !/^[\da-f]{1,128}$/i.test(parsed.private_key_id)))) throw new Error();
    return { client_email: parsed.client_email, private_key: parsed.private_key,
      ...(typeof parsed.private_key_id === 'string' ? { private_key_id: parsed.private_key_id } : {}) };
  } catch {
    throw new FirebaseAuthError(503, 'Managed account recovery is not configured correctly.', 'AUTH_RECOVERY_NOT_CONFIGURED');
  }
}

/**
 * Fixed Google endpoints only. No client-supplied JWT, endpoint, token, or redirect is accepted.
 * ID-token claims below are parsed ONLY from a direct, successful Firebase HTTPS response;
 * this is deliberately not an API for verifying arbitrary browser-supplied JWTs.
 */
export class FirebaseRestIdentity implements ManagedIdentity {
  readonly recoveryAvailable: boolean;
  private readonly admin?: ServiceAccount;
  private readonly request: typeof fetch;
  constructor(readonly config: FirebaseAuthOptions,
    request: typeof fetch = fetch, private readonly now: () => number = Date.now) {
    // Native workerd fetch cannot be called with this class as its receiver.
    // Wrap both default and explicitly supplied transports at the boundary.
    this.request = (input, init) => request(input, init);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(config.apiKey) || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId))
      throw new FirebaseAuthError(503, 'Managed email/password sign-in is not configured.', 'AUTH_NOT_CONFIGURED');
    this.admin = serviceAccount(config.serviceAccountJson, config.projectId);
    this.recoveryAvailable = !!this.admin;
  }
  private failure(response: Response, body: Record<string, unknown>): never {
    const error = object(body.error) ? body.error : {};
    const code = typeof error.message === 'string' ? error.message.split(' : ')[0] : '';
    if (['EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'USER_DISABLED', 'USER_NOT_FOUND',
      'INVALID_ID_TOKEN', 'TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN'].includes(code))
      throw new FirebaseAuthError(401, 'Email or password is incorrect, or the session has expired.', 'AUTH_CREDENTIAL_REJECTED');
    if (code === 'EMAIL_EXISTS')
      throw new FirebaseAuthError(409, 'An account could not be created with these details. Try signing in instead.', 'AUTH_EMAIL_EXISTS');
    if (code.startsWith('WEAK_PASSWORD') || code === 'INVALID_EMAIL' || code === 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS')
      throw new FirebaseAuthError(400, 'These account details do not meet the sign-in requirements.', 'AUTH_INPUT_REJECTED');
    if (response.status === 429 || code === 'TOO_MANY_ATTEMPTS_TRY_LATER' || code === 'QUOTA_EXCEEDED') {
      const supplied = Number(response.headers.get('retry-after'));
      throw new FirebaseAuthError(429, 'Too many sign-in attempts. Try again later.', 'AUTH_UPSTREAM_RATE_LIMIT', false,
        { retryAfterSeconds: Number.isFinite(supplied) && supplied > 0 ? Math.min(Math.ceil(supplied), 86400) : 60 });
    }
    if (/RECAPTCHA|CAPTCHA|MFA/.test(code))
      throw new FirebaseAuthError(403, 'The identity provider requires an additional verification step that this interface does not support.', 'AUTH_CHALLENGE_REQUIRED');
    if (response.status >= 500)
      throw new FirebaseAuthError(503, 'The identity provider did not confirm the operation. Try again later.', 'AUTH_UPSTREAM_UNAVAILABLE', true);
    throw new FirebaseAuthError(503, 'Managed sign-in is unavailable. The operator must check its project configuration.', 'AUTH_UPSTREAM_CONFIGURATION');
  }
  private async call(url: string, body: string, contentType: string, authorization?: string) {
    // Callers are private methods whose URL literals/validated project IDs are fixed below.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      // workerd supports manual/follow, not Node's redirect:error mode. Never
      // forward passwords, refresh credentials or assertions to a redirect target.
      const response = await this.request(url, { method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': contentType, Accept: 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new FirebaseAuthError(502, 'The identity provider returned an unexpected redirect.', 'AUTH_UPSTREAM_REDIRECT', true);
      }
      let parsed: Record<string, unknown>;
      try {
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error();
        parsed = await boundedJson(response, 128 * 1024, 10000);
      } catch {
        throw new FirebaseAuthError(502, 'The identity provider returned an invalid response.', 'AUTH_UPSTREAM_INVALID_RESPONSE', true);
      }
      if (!response.ok) this.failure(response, parsed);
      return parsed;
    } catch (error) {
      if (error instanceof FirebaseAuthError) throw error;
      throw new FirebaseAuthError(503, 'The identity provider did not confirm the operation. Try again later.', 'AUTH_UPSTREAM_UNAVAILABLE', true);
    } finally { clearTimeout(timer); }
  }
  private rest(action: Action, body: Record<string, unknown>) {
    return this.call(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${this.config.apiKey}`,
      JSON.stringify(body), 'application/json');
  }
  private credentials(body: Record<string, unknown>, expectedUid?: string): IdentityCredentials {
    try {
      const id = body.localId ?? body.user_id;
      const token = body.idToken ?? body.id_token;
      const refresh = body.refreshToken ?? body.refresh_token;
      if (!uid(id) || (expectedUid !== undefined && id !== expectedUid) || typeof token !== 'string' || token.length > 12000 ||
        typeof refresh !== 'string' || !refresh || refresh.length > 4096) throw new Error();
      const jwt = token.split('.');
      if (jwt.length !== 3) throw new Error();
      const claims: unknown = JSON.parse(new TextDecoder().decode(decodeBytes(jwt[1])));
      const now = this.now();
      if (!object(claims) || claims.aud !== this.config.projectId || claims.iss !== `https://securetoken.google.com/${this.config.projectId}` ||
        claims.sub !== id || !Number.isSafeInteger(claims.auth_time) || !Number.isSafeInteger(claims.exp) ||
        Number(claims.auth_time) < 0 || Number(claims.auth_time) * 1000 > now + 60000 || Number(claims.exp) * 1000 <= now) throw new Error();
      return { uid: id, idToken: token, refreshToken: refresh, authenticatedAt: Number(claims.auth_time) * 1000,
        expiresAt: Math.min(now + positiveSeconds(body.expiresIn ?? body.expires_in) * 1000, Number(claims.exp) * 1000) };
    } catch { throw new FirebaseAuthError(502, 'The identity provider returned an invalid session.', 'AUTH_UPSTREAM_INVALID_RESPONSE', true); }
  }
  async signUp(email: string, password: string) {
    return this.credentials(await this.rest('signUp', { email, password, returnSecureToken: true }));
  }
  async signIn(email: string, password: string) {
    return this.credentials(await this.rest('signInWithPassword', { email, password, returnSecureToken: true }));
  }
  async refresh(credentials: IdentityCredentials) {
    const result = await this.call(`https://securetoken.googleapis.com/v1/token?key=${this.config.apiKey}`,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken }).toString(), 'application/x-www-form-urlencoded');
    const next = this.credentials(result, credentials.uid);
    if (next.authenticatedAt !== credentials.authenticatedAt)
      throw new FirebaseAuthError(401, 'The session identity changed. Sign in again.', 'AUTH_CREDENTIAL_REJECTED');
    return next;
  }
  async lookup(credentials: IdentityCredentials): Promise<IdentityUser> {
    const result = await this.rest('lookup', { idToken: credentials.idToken });
    try {
      if (!Array.isArray(result.users) || result.users.length !== 1) throw new Error();
      const user: unknown = result.users[0];
      if (!object(user) || user.localId !== credentials.uid || typeof user.email !== 'string' ||
        (user.emailVerified !== undefined && typeof user.emailVerified !== 'boolean')) throw new Error();
      const validSince = Number(user.validSince ?? 0) * 1000;
      const passwordUpdatedAt = Number(user.passwordUpdatedAt ?? 0);
      const createdAt = Number(user.createdAt ?? this.now());
      if (![validSince, passwordUpdatedAt, createdAt].every((x) => Number.isFinite(x) && x >= 0)) throw new Error();
      return { uid: credentials.uid, email: emailAddress(user.email), emailVerified: user.emailVerified === true,
        disabled: user.disabled === true, validSince, passwordUpdatedAt, createdAt: Math.floor(createdAt) };
    } catch { throw new FirebaseAuthError(502, 'The identity provider returned invalid account information.', 'AUTH_UPSTREAM_INVALID_RESPONSE', true); }
  }
  async changePassword(credentials: IdentityCredentials, password: string) {
    return this.credentials(await this.rest('update', { idToken: credentials.idToken, password, returnSecureToken: true }), credentials.uid);
  }
  async deleteUser(credentials: IdentityCredentials) {
    await this.rest('delete', { idToken: credentials.idToken });
  }
  /** Recovery codes remain Solanime-local. Only a validated, single-use claim reaches this privileged call. */
  async resetPassword(userId: string, password: string) {
    if (!this.admin) throw new FirebaseAuthError(503, 'Recovery-code sign-in is not configured. Contact the operator.', 'AUTH_RECOVERY_NOT_CONFIGURED');
    if (!uid(userId)) throw new FirebaseAuthError(400, 'Invalid account identity.', 'AUTH_INPUT_REJECTED');
    const accessToken = await this.adminToken(this.admin);
    const result = await this.call(`https://identitytoolkit.googleapis.com/v1/projects/${this.config.projectId}/accounts:update`,
      JSON.stringify({ localId: userId, password, validSince: String(Math.floor(this.now() / 1000)), returnSecureToken: false }),
      'application/json', `Bearer ${accessToken}`);
    if (result.localId !== userId)
      throw new FirebaseAuthError(502, 'The identity provider did not confirm the recovered account.', 'AUTH_UPSTREAM_INVALID_RESPONSE', true);
  }
  private async adminToken(account: ServiceAccount) {
    try {
      const header = encodeBytes(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(account.private_key_id ? { kid: account.private_key_id } : {}) })));
      const iat = Math.floor(this.now() / 1000);
      const payload = encodeBytes(encoder.encode(JSON.stringify({ iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 300 })));
      const pem = account.private_key.replace(pkcs8Delimiters, '');
      const bytes = Uint8Array.from(atob(pem), (x) => x.charCodeAt(0));
      const key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${header}.${payload}`));
      const result = await this.call('https://oauth2.googleapis.com/token', new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${payload}.${encodeBytes(new Uint8Array(signature))}`,
      }).toString(), 'application/x-www-form-urlencoded');
      if (typeof result.access_token !== 'string' || !result.access_token || result.access_token.length > 4096 || result.token_type !== 'Bearer') throw new Error();
      return result.access_token;
    } catch (error) {
      // No account write was attempted yet; it is safe for a caller to release the operation claim.
      if (error instanceof FirebaseAuthError)
        throw new FirebaseAuthError(error.status, 'Managed account recovery could not authenticate. The operator must check its configuration.', 'AUTH_RECOVERY_NOT_CONFIGURED');
      throw new FirebaseAuthError(503, 'Managed account recovery could not authenticate. The operator must check its configuration.', 'AUTH_RECOVERY_NOT_CONFIGURED');
    }
  }
}

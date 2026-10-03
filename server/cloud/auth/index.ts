import { AppError } from '../../errors.ts';
import { malService, type MalServiceConfig } from '../../integrations/malService.ts';
import { exploreService } from '../../explore/service.ts';
import type { ExploreCatalogue } from '../../explore/catalogue.ts';
import { COMMUNITY_PAGE_SIZE_MAX, communityCommentBody, communityPositiveInteger, communityRevision, communityUuid } from '../../community.ts';
import { emailAddress, profileInput, validateData } from '../../accounts/validation.ts';
import { FirebaseAuthError, FirebaseRestIdentity, type FirebaseAuthOptions } from './firebase.ts';
import { digest, equalToken, openCredentials, randomToken, sealCredentials, validCredentialKey } from './crypto.ts';
import { accountError, accountReply, boundedJson, cookieValue, requireMutation, validateManagedPassword } from './http.ts';
import { D1AccountsRepository } from './repository.ts';
import type { AccountDatabase, CloudAccount, CloudSession, IdentityCredentials, IdentityUser, ManagedIdentity } from './types.ts';

export type CloudAccountConfig = {
  origin: string;
  allowedOrigins?: string[];
  secure?: boolean;
  registration?: boolean;
  approvalRequired?: boolean;
  privateSite?: boolean;
  notifyApproval?: (kind: 'request' | 'approved', account: Pick<CloudAccount, 'id' | 'email'>) => Promise<boolean>;
  firebase?: FirebaseAuthOptions;
  credentialKey?: string;
  mal?: MalServiceConfig;
  now?: () => number;
  /** Tests may inject an identity implementation. No request or environment flag enables a mock. */
  identity?: ManagedIdentity;
  /** Cross-database existence proof supplied by the catalogue repository. */
  episodeExists?: (episodeId: number) => Promise<boolean>;
  /** Read-only catalogue facts for Explore, supplied by the Worker. */
  explore?: ExploreCatalogue;
};
const DAY = 86400000;
const REMOTE_CHECK_INTERVAL = 5 * 60000;
const publicAccount = (a: CloudAccount) => ({ id: a.id, email: a.email, emailVerified: !!a.email_verified, createdAt: a.created_at });
const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  return value;
};
function validUser(user: IdentityUser, credentials: IdentityCredentials, email?: string) {
  if (user.uid !== credentials.uid || (email !== undefined && user.email !== email) || user.disabled ||
    user.validSince > credentials.authenticatedAt || Math.floor(user.passwordUpdatedAt / 1000) * 1000 > credentials.authenticatedAt)
    throw new AppError(401, 'UNAUTHORIZED', 'Your account credentials changed. Sign in again.', { reason: 'AUTH_CREDENTIAL_REJECTED' });
}

/** Construct per request (bindings are injected by the Worker, never obtained through REST). */
export function createCloudAccounts(db: AccountDatabase, config: CloudAccountConfig) {
  const repository = new D1AccountsRepository(db);
  const now = config.now ?? Date.now;
  const secure = config.secure !== false;
  const name = secure ? '__Host-solanime_session' : 'solanime_session';
  const cookie = (value: string, age?: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${age !== undefined ? `; Max-Age=${age}` : ''}`;

  function configuration() {
    try {
      const origins = [config.origin, ...(config.allowedOrigins ?? [])];
      for (const value of origins) {
        const parsed = new URL(value);
        if (value !== parsed.origin || (secure ? parsed.protocol !== 'https:' : !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) throw new Error();
      }
      if (!validCredentialKey(config.credentialKey)) throw new Error();
      const identity = config.identity ?? (config.firebase ? new FirebaseRestIdentity(config.firebase, fetch, now) : undefined);
      if (!identity) throw new Error();
      return { identity, key: config.credentialKey, origins };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'UNAVAILABLE', 'Email/password accounts are not configured on this deployment yet.', { reason: 'AUTH_NOT_CONFIGURED' });
    }
  }
  async function handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const commentRoute = /^\/api\/episodes\/(\d+)\/comments(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
    if (!url.pathname.startsWith('/api/account/') && !commentRoute) return null;
    try {
      const { identity, key, origins } = configuration();
      const path = url.pathname, method = request.method;
      const registration = config.registration !== false && identity.recoveryAvailable;
      const sessionResponse = async (session?: CloudSession) => ({
        account: session ? publicAccount(required(await repository.account(session.account_id))) : null,
        profiles: session ? await repository.profiles(session.account_id) : [],
        csrfToken: session?.csrf ?? null,
        registrationOpen: registration,
        approvalRequired: config.approvalRequired === true,
        recoveryMethod: identity.recoveryAvailable ? 'recovery-code' : 'unavailable',
        maxProfiles: 5,
        privateSite: config.privateSite === true,
      });
      const readSession = async (verifyRemote = false): Promise<CloudSession | undefined> => {
        const raw = cookieValue(request, name);
        if (!/^[\w-]{43}$/.test(raw)) return;
        const s = await repository.session(await digest(raw), now());
        if (!s) return;
        if (verifyRemote || now() - s.checked_at >= REMOTE_CHECK_INTERVAL) {
          try {
            let credentials = await openCredentials(s.credential_cipher, key, `${s.account_id}:${s.token_hash}`);
            if (credentials.expiresAt <= now() + 60000) credentials = await identity.refresh(credentials);
            const a = required(await repository.account(s.account_id));
            const user = await identity.lookup(credentials);
            validUser(user, credentials, a.email);
            if (user.uid !== a.firebase_uid) throw new AppError(401, 'UNAUTHORIZED', 'The session identity changed. Sign in again.');
            await repository.updateIdentity(a.id, user.emailVerified);
            await repository.touchSession(s, now(), await sealCredentials(credentials, key, `${s.account_id}:${s.token_hash}`));
            // A logout, password change, or another tab may have revoked this session while Google replied.
            return (await repository.session(s.token_hash, now())) ?? undefined;
          } catch (error) {
            if (error instanceof AppError && error.status === 401) { await repository.deleteSession(s.token_hash); return; }
            throw error; // An upstream outage is not a logout and must not erase good account data.
          }
        }
        if (now() - s.last_seen > 60000) await repository.touchSession(s, now());
        return s;
      };
      const freshSession = async (a: CloudAccount, credentials: IdentityCredentials, remember: boolean, replacedHash?: string) => {
        const raw = randomToken(), hash = await digest(raw);
        const s: CloudSession = { token_hash: hash, account_id: a.id, csrf: randomToken(), created_at: now(), last_seen: now(),
          expires_at: now() + (remember ? 30 * DAY : 12 * 3600000),
          device: (request.headers.get('user-agent') ?? 'Unknown browser').slice(0, 160), auth_revision: a.auth_revision,
          credential_cipher: await sealCredentials(credentials, key, `${a.id}:${hash}`), checked_at: now() };
        await repository.insertSession(s, replacedHash);
        return { s, header: { 'Set-Cookie': cookie(raw, remember ? 30 * 86400 : undefined) } };
      };
      const passwordProof = async (a: CloudAccount, password: unknown) => {
        if (typeof password !== 'string' || !password || new TextEncoder().encode(password).length > 1024)
          throw new AppError(401, 'UNAUTHORIZED', 'The current password is incorrect.', { reason: 'PASSWORD_PROOF_FAILED' });
        let credentials: IdentityCredentials;
        try { credentials = await identity.signIn(a.email, password); }
        catch (error) {
          if (error instanceof AppError && error.status === 401) throw new AppError(401, 'UNAUTHORIZED', 'The current password is incorrect.', { reason: 'PASSWORD_PROOF_FAILED' });
          throw error;
        }
        if (credentials.uid !== a.firebase_uid) throw new AppError(401, 'UNAUTHORIZED', 'The current password is incorrect.', { reason: 'PASSWORD_PROOF_FAILED' });
        validUser(await identity.lookup(credentials), credentials, a.email);
        return credentials;
      };
      const remoteOperation = async <T>(a: CloudAccount, operationId: string, action: () => Promise<T>): Promise<T> => {
        try { return await action(); }
        catch (error) {
          if (error instanceof FirebaseAuthError && !error.outcomeUncertain) {
            await completeOperation(() => repository.finishOperation(a.id, operationId), operationId);
          } else {
            try { await repository.markOperationUncertain(a.id, operationId); } catch { /* The original durable pending claim is already authoritative. */ }
            throw new AppError(503, 'UNAVAILABLE', 'The identity provider did not confirm this security change. The operator must reconcile the pending operation before you sign in again. Your profiles are preserved.',
              { reason: 'AUTH_OPERATION_PENDING', operationId });
          }
          throw error;
        }
      };
      const completeOperation = async (complete: () => Promise<void>, operationId: string) => {
        try { await complete(); }
        catch {
          throw new AppError(503, 'UNAVAILABLE', 'The private account update was not confirmed. The operator must reconcile the pending security operation before you sign in again.',
            { reason: 'AUTH_OPERATION_PENDING', operationId });
        }
      };

      const anonymousPaths = ['/api/account/register', '/api/account/login', '/api/account/recover'];
      // An expired existing cookie must not prevent the user signing in or recovering the account.
      const s = anonymousPaths.includes(path) ? undefined : await readSession();
      if (commentRoute && config.privateSite && !s) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
      if (method === 'GET' && path === '/api/account/session') return accountReply(200, await sessionResponse(s));
      if (method !== 'GET') await requireMutation(request, origins, anonymousPaths.includes(path) ? undefined : s?.csrf);
      // Cloudflare sets this header at its edge; forwarded application headers are never trusted here.
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      const rate = (bucket: string, maximum: number, windowMs: number) =>
        digest(bucket).then((hash) => repository.rate(hash, maximum, windowMs, now()));
      if (method !== 'GET') await rate('ip:' + ip, 150, 60000);

      if (commentRoute) {
        const episodeId = Number(commentRoute[1]);
        if (!Number.isSafeInteger(episodeId) || episodeId < 1 || !config.episodeExists || !(await config.episodeExists(episodeId)))
          throw new AppError(404, 'NOT_FOUND', 'Episode was not found.');
        const requestedProfile = url.searchParams.get('profile');
        let viewerProfileId: string | undefined;
        if (requestedProfile !== null) {
          const auth = required(s);
          viewerProfileId = communityUuid(requestedProfile, 'profile');
          await repository.ownedProfile(viewerProfileId, auth.account_id);
        }
        if (method === 'GET' && !commentRoute[2]) {
          const page = communityPositiveInteger(url.searchParams.get('page'), 1, 100_000);
          const pageSize = communityPositiveInteger(url.searchParams.get('pageSize'), 20, COMMUNITY_PAGE_SIZE_MAX);
          return accountReply(200, await repository.comments(episodeId, page, pageSize, viewerProfileId));
        }
        if (!['POST', 'PATCH', 'DELETE'].includes(method) || (method === 'POST' && commentRoute[2]) || (method !== 'POST' && !commentRoute[2]))
          throw new AppError(404, 'NOT_FOUND', 'Community route not found.');
        const auth = required(s);
        const input = await boundedJson(request, 16_384);
        const profileId = communityUuid(input.profileId, 'profile');
        await repository.ownedProfile(profileId, auth.account_id);
        await rate('community:' + auth.account_id, 20, 60000);
        if (method === 'POST')
          return accountReply(201, { comment: await repository.createComment(auth, episodeId, profileId, communityCommentBody(input.body), now()) });
        const commentId = communityUuid(commentRoute[2], 'comment');
        const revision = communityRevision(input.revision);
        if (method === 'PATCH')
          return accountReply(200, { comment: await repository.updateComment(auth, episodeId, commentId, profileId, communityCommentBody(input.body), revision, now()) });
        await repository.deleteComment(auth, episodeId, commentId, profileId, revision, now());
        return accountReply(200, { deleted: true, id: commentId });
      }

      if (method === 'POST' && (path === '/api/account/register' || path === '/api/account/login')) {
        const body = await boundedJson(request), email = emailAddress(body.email);
        await rate('sign:' + email + ':' + ip, 12, 15 * 60000);
        const registering = path.endsWith('/register');
        if (registering) {
          if (config.registration === false) throw new AppError(403, 'BLOCKED', 'New registration is currently closed.');
          if (!identity.recoveryAvailable) throw new AppError(503, 'UNAVAILABLE', 'Registration is awaiting secure recovery configuration.', { reason: 'AUTH_RECOVERY_NOT_CONFIGURED' });
          await rate('register:' + ip, config.approvalRequired ? 3 : 40, 3600000);
        }
        const password = registering ? validateManagedPassword(body.password) : body.password;
        if (typeof password !== 'string' || !password || new TextEncoder().encode(password).length > 1024)
          throw new AppError(401, 'UNAUTHORIZED', 'Email or password is incorrect.');
        let credentials: IdentityCredentials;
        try { credentials = registering ? await identity.signUp(email, password) : await identity.signIn(email, password); }
        catch (error) {
          if (error instanceof AppError && error.status === 401) throw new AppError(401, 'UNAUTHORIZED', 'Email or password is incorrect.');
          throw error;
        }
        const user = await identity.lookup(credentials);
        validUser(user, credentials, email);
        if (!registering && !registration && !(await repository.accountByUid(credentials.uid)))
          throw new AppError(403, 'BLOCKED', 'This account has not been provisioned for this deployment. Contact the operator.', { reason: 'ACCOUNT_NOT_PROVISIONED' });
        const recoveryCode = identity.recoveryAvailable ? randomToken() : undefined;
        // Idempotent completion after an interrupted signup. Never merge different Firebase UIDs by email.
        // A sign-in that completes an interrupted signup must still wait for approval.
        const result = await repository.ensureAccount(user, recoveryCode ? await digest(recoveryCode) : null, now(),
          config.approvalRequired === true);
        await repository.updateIdentity(result.account.id, user.emailVerified);
        if (result.account.approval_state !== 'approved') {
          if (result.created && result.account.approval_state === 'pending') {
            let sent = false;
            try { sent = await config.notifyApproval?.('request', result.account) === true; } catch { /* Retry from operator queue. */ }
            await repository.noticeState(result.account.id, 'owner', sent ? 'sent' : 'failed');
          }
          if (result.account.approval_state === 'rejected')
            throw new AppError(403, 'BLOCKED', 'This account request was declined.', { reason: 'ACCOUNT_REJECTED' });
          if (result.created) return accountReply(202, {
            account: null, profiles: [], csrfToken: null, registrationOpen: registration,
            recoveryMethod: identity.recoveryAvailable ? 'recovery-code' : 'unavailable', maxProfiles: 5,
            privateSite: config.privateSite === true,
            approvalRequired: config.approvalRequired === true,
            pendingApproval: true, ...(recoveryCode ? { recoveryCode } : {}),
          });
          throw new AppError(403, 'BLOCKED', 'Your account is awaiting approval. Please try signing in after you receive a confirmation.',
            { reason: 'ACCOUNT_PENDING_APPROVAL' });
        }
        const oldRaw = cookieValue(request, name);
        const fresh = await freshSession(result.account, credentials, body.remember === true,
          /^[\w-]{43}$/.test(oldRaw) ? await digest(oldRaw) : undefined);
        return accountReply(registering ? 201 : 200, { ...await sessionResponse(fresh.s),
          ...(result.created && recoveryCode ? { recoveryCode } : {}) }, fresh.header);
      }

      if (method === 'POST' && path === '/api/account/recover') {
        if (!identity.recoveryAvailable) throw new AppError(503, 'UNAVAILABLE', 'Recovery-code sign-in is not configured. Contact the operator.', { reason: 'AUTH_RECOVERY_NOT_CONFIGURED' });
        const body = await boundedJson(request), email = emailAddress(body.email);
        await rate('recovery:' + email + ':' + ip, 5, 15 * 60000);
        const a = await repository.accountByEmail(email);
        const supplied = typeof body.recoveryCode === 'string' && /^[\w-]{43}$/.test(body.recoveryCode) ? body.recoveryCode : '';
        const matches = await equalToken(await digest(supplied), a?.recovery_hash ?? '0'.repeat(64));
        if (!a || !supplied || !matches) throw new AppError(400, 'BAD_REQUEST', 'Email or recovery code is incorrect.');
        const password = validateManagedPassword(body.password), recoveryCode = randomToken();
        const operationId = await repository.startOperation(a, 'recovering', now());
        await remoteOperation(a, operationId, () => identity.resetPassword(a.firebase_uid, password));
        const recoveryHash = await digest(recoveryCode);
        await completeOperation(() => repository.finishOperation(a.id, operationId, recoveryHash), operationId);
        return accountReply(200, { recoveryCode, message: 'Password changed. Save your replacement recovery code and sign in.' }, { 'Set-Cookie': cookie('', 0) });
      }

      const auth = required(s), a = required(await repository.account(auth.account_id));
      const malRoute = /^\/api\/account\/profiles\/([\w-]{36})\/mal\/(status|list|connect|complete|sync|update|disconnect)$/.exec(path);
      if (malRoute) {
        const profile = malRoute[1], action = malRoute[2];
        await repository.ownedProfile(profile, a.id);
        if (method !== (['status', 'list'].includes(action) ? 'GET' : 'POST')) throw new AppError(405, 'BAD_REQUEST', 'Unsupported method.');
        if (method === 'POST') await rate('mal:' + a.id, 30, 60000);
        const result = await malService(db, config.mal ?? {}, fetch, now)(profile, a.id, action,
          method === 'GET' ? { page: url.searchParams.get('page') ?? 1 } : await boundedJson(request), async () => {
            required(await repository.session(auth.token_hash, now()));
            await repository.ownedProfile(profile, a.id);
          });
        return accountReply(200, result);
      }
      const exploreRoute = /^\/api\/account\/profiles\/([\w-]{36})\/explore\/(status|start|feedback|undo|results|preferences|reset)$/.exec(path);
      if (exploreRoute) {
        const profile = exploreRoute[1], action = exploreRoute[2];
        await repository.ownedProfile(profile, a.id);
        if (method !== (action === 'status' ? 'GET' : 'POST')) throw new AppError(405, 'BAD_REQUEST', 'Unsupported method.');
        if (method === 'POST') await rate('explore:' + a.id, 240, 60000);
        const result = await exploreService(db, config.explore, { now })(profile, action,
          method === 'GET' ? {} : await boundedJson(request), async () => {
            required(await repository.session(auth.token_hash, now()));
            await repository.ownedProfile(profile, a.id);
          });
        return accountReply(200, result);
      }
      if (method === 'POST' && path === '/api/account/logout') {
        await repository.deleteSession(auth.token_hash);
        return accountReply(200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
      }
      if (method === 'GET' && path === '/api/account/sessions') return accountReply(200, {
        items: (await repository.sessions(a.id, now())).map((x) => ({ id: x.token_hash, current: x.token_hash === auth.token_hash,
          createdAt: x.created_at, lastSeen: x.last_seen, expiresAt: x.expires_at, device: x.device })),
      });
      if (method === 'POST' && path === '/api/account/revoke-other-sessions') {
        required(await readSession(true));
        await repository.revokeSessions(a.id, auth.token_hash);
        return accountReply(200, { ok: true });
      }
      if (method === 'GET' && path === '/api/account/export') {
        const profiles = await repository.profiles(a.id);
        const exported = [];
        for (const profile of profiles) exported.push({ ...profile, data: await repository.dataFor(profile.id, a.id),
          communityComments: await repository.commentsForProfile(profile.id, a.id) });
        return accountReply(200, { account: publicAccount(a), profiles: exported, exportedAt: new Date(now()).toISOString() },
          { 'Content-Disposition': 'attachment; filename="solanime-account.json"' });
      }
      if (method === 'POST' && ['/api/account/password', '/api/account/recovery-code', '/api/account/delete'].includes(path)) {
        await rate('sensitive:' + a.id, 8, 15 * 60000);
        const body = await boundedJson(request);
        const password = path.endsWith('/password') ? validateManagedPassword(body.password) : undefined;
        const proof = await passwordProof(a, body.currentPassword);
        required(await repository.session(auth.token_hash, now()));
        if (path.endsWith('/recovery-code')) {
          if (!identity.recoveryAvailable) throw new AppError(503, 'UNAVAILABLE', 'Recovery-code sign-in is not configured. Contact the operator.', { reason: 'AUTH_RECOVERY_NOT_CONFIGURED' });
          const recoveryCode = randomToken();
          await repository.rotateRecovery(auth, await digest(recoveryCode), now());
          return accountReply(200, { recoveryCode });
        }
        if (path.endsWith('/delete')) {
          const operationId = await repository.startOperation(a, 'deleting', now(), auth);
          await remoteOperation(a, operationId, () => identity.deleteUser(proof));
          await completeOperation(() => repository.deleteAccount(a.id, operationId), operationId);
          return accountReply(200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
        }
        const operationId = await repository.startOperation(a, 'password-changing', now(), auth);
        const credentials = await remoteOperation(a, operationId, () => identity.changePassword(proof, required(password)));
        await completeOperation(() => repository.finishOperation(a.id, operationId), operationId);
        const fresh = await freshSession(required(await repository.account(a.id)), credentials, false);
        return accountReply(200, await sessionResponse(fresh.s), fresh.header);
      }
      if (method === 'POST' && path === '/api/account/profiles') {
        const profile = await repository.createProfile(auth, profileInput(await boundedJson(request)), now());
        return accountReply(201, { profile, profiles: await repository.profiles(a.id) });
      }
      const pm = /^\/api\/account\/profiles\/([\w-]{36})(?:\/(data|delete))?$/.exec(path);
      if (pm) {
        const id = pm[1];
        await repository.ownedProfile(id, a.id);
        if (method === 'GET' && pm[2] === 'data') return accountReply(200, await repository.dataFor(id, a.id));
        if (method === 'POST' && pm[2] === 'data') {
          const body = await boundedJson(request);
          if (typeof body.key !== 'string' || body.key.length > 250 || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
            throw new AppError(400, 'BAD_REQUEST', 'Invalid data revision.');
          const value = JSON.stringify(validateData(body.key, body.value));
          const revision = await repository.putData(auth, id, body.key, value, Number(body.revision), now());
          return accountReply(200, { revision });
        }
        if (method === 'POST' && pm[2] === 'delete') {
          await rate('sensitive:' + a.id, 8, 15 * 60000);
          const body = await boundedJson(request);
          await passwordProof(a, body.currentPassword);
          await repository.deleteProfile(auth, id, now());
          return accountReply(200, { profiles: await repository.profiles(a.id) });
        }
        if (method === 'POST' && !pm[2]) {
          await repository.updateProfile(auth, id, profileInput(await boundedJson(request)), now());
          return accountReply(200, { profiles: await repository.profiles(a.id) });
        }
      }
      throw new AppError(404, 'NOT_FOUND', 'Account route not found.');
    } catch (error) { return accountError(error); }
  }
  const pendingApprovals = () => repository.pendingApprovals();
  const authorize = async (request: Request) => {
    const raw = cookieValue(request, name);
    if (!/^[\w-]{43}$/.test(raw) || !(await repository.session(await digest(raw), now())))
      throw new AppError(401, 'UNAUTHORIZED', 'Sign in with an approved account to continue.');
  };
  const decideApproval = async (id: string, decision: 'approved' | 'rejected') => {
    if (!/^[\w-]{1,128}$/.test(id)) throw new AppError(400, 'BAD_REQUEST', 'Invalid account identifier.');
    const account = await repository.decideApproval(id, decision, now());
    if (decision === 'approved') {
      let sent = false;
      try { sent = await config.notifyApproval?.('approved', account) === true; } catch { /* Durable failed state remains retryable. */ }
      await repository.noticeState(id, 'applicant', sent ? 'sent' : 'failed');
    }
    return { id, decision, applicantNotice: decision === 'approved'
      ? (await repository.account(id))?.applicant_notice_state : 'not_required' };
  };
  const retryNotice = async (id: string) => {
    if (!/^[\w-]{1,128}$/.test(id)) throw new AppError(400, 'BAD_REQUEST', 'Invalid account identifier.');
    const account = required(await repository.account(id));
    const kind = account.approval_state === 'pending' ? 'request'
      : account.approval_state === 'approved' ? 'approved' : null;
    if (!kind) throw new AppError(409, 'BAD_REQUEST', 'Rejected requests have no outgoing notice.');
    const field = kind === 'request' ? account.owner_notice_state : account.applicant_notice_state;
    if (field === 'sent') return { id, notice: 'sent' };
    let sent = false;
    try { sent = await config.notifyApproval?.(kind, account) === true; } catch { /* Retry remains possible. */ }
    await repository.noticeState(id, kind === 'request' ? 'owner' : 'applicant', sent ? 'sent' : 'failed');
    return { id, notice: sent ? 'sent' : 'failed' };
  };
  return { handle, repository, name, authorize, pendingApprovals, decideApproval, retryNotice,
    prune: () => repository.prune(now()) };
}

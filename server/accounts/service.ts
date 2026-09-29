import { isIP } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.ts';
import { malService } from '../integrations/malService.ts';
import { sqliteAccountAdapter } from '../integrations/sqliteAdapter.ts';
import { sendApprovalNotice } from '../cloud/auth/notifications.ts';
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  token,
  digest,
  equalToken,
} from './passwords.ts';
import { emailAddress, profileInput, validateData } from './validation.ts';
import { readBody, reply, cookieValue } from './http.ts';
import {
  COMMUNITY_PAGE_SIZE_MAX,
  communityCommentBody,
  communityPositiveInteger,
  communityRevision,
  communityUuid,
  publicComment,
} from '../community.ts';

type Account = {
  id: string;
  email: string;
  password_hash: string;
  recovery_hash: string;
  email_verified: number;
  created_at: number;
  approval_state: 'pending' | 'approved' | 'rejected';
  approval_requested_at: number | null;
  owner_notice_state: 'not_required' | 'pending' | 'sent' | 'failed';
  applicant_notice_state: 'not_required' | 'pending' | 'sent' | 'failed';
};
type Session = {
  token_hash: string;
  account_id: string;
  csrf: string;
  created_at: number;
  last_seen: number;
  expires_at: number;
  device: string;
};
export type AccountConfig = {
  origin?: string;
  secure?: boolean;
  now?: () => number;
  registration?: boolean;
  approvalRequired?: boolean;
  privateSite?: boolean;
  notifyApproval?: (kind: 'request' | 'approved', account: Pick<Account, 'id' | 'email'>) => Promise<boolean>;
};
const DAY = 86400000;
export function createAccounts(db: DatabaseSync, config: AccountConfig = {}) {
  const now = config.now ?? Date.now;
  const origin = config.origin || process.env.SOLANIME_APP_ORIGIN;
  const secure =
    config.secure ??
    (origin ? new URL(origin).protocol === 'https:' : process.env.NODE_ENV === 'production');
  const name = secure ? '__Host-solanime_session' : 'solanime_session';
  if (process.env.NODE_ENV === 'production' && (!origin || !secure))
    throw new Error('Production accounts require an HTTPS SOLANIME_APP_ORIGIN.');
  const registration = config.registration ?? process.env.SOLANIME_REGISTRATION !== 'closed';
  const approvalRequired = config.approvalRequired ?? process.env.SOLANIME_APPROVAL_REQUIRED === 'true';
  const privateSite = config.privateSite ?? process.env.SOLANIME_PRIVATE_SITE === 'true';
  const notifyApproval = config.notifyApproval ?? ((kind: 'request' | 'approved', account: Pick<Account, 'id' | 'email'>) =>
    sendApprovalNotice(kind, account, origin ?? 'http://127.0.0.1:5173'));
  const publicAccount = (a: Account) => ({
    id: a.id,
    email: a.email,
    emailVerified: !!a.email_verified,
    createdAt: a.created_at,
  });
  const profiles = (id: string) =>
    db
      .prepare('SELECT id,name,avatar FROM profiles WHERE account_id=? ORDER BY created_at,id')
      .all(id);
  const sessionCookie = (value: string, age?: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${age !== undefined ? `; Max-Age=${age}` : ''}${age === 0 ? '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : ''}`;
  function prune() {
    db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen<?').run(
      now(),
      now() - 7 * DAY,
    );
    db.prepare('DELETE FROM account_rate_limits WHERE expires_at<=?').run(now());
  }
  function atomic<T>(run: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function rate(key: string, max: number, windowMs: number) {
    const hash = digest(key);
    const row = db
      .prepare('SELECT count,expires_at FROM account_rate_limits WHERE key=?')
      .get(hash) as { count: number; expires_at: number } | undefined;
    if (row && row.expires_at > now() && row.count >= max)
      throw new AppError(429, 'UNAVAILABLE', 'Too many attempts. Try again later.', {
        retryAfterSeconds: Math.ceil((row.expires_at - now()) / 1000),
      });
    if (
      !row &&
      Number(
        (db.prepare('SELECT count(*) AS n FROM account_rate_limits').get() as { n: number }).n,
      ) > 10000
    )
      throw new AppError(503, 'UNAVAILABLE', 'Sign-in is busy. Try again shortly.');
    db.prepare(
      'INSERT INTO account_rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END',
    ).run(hash, now() + windowMs, now(), now());
  }
  function readSession(request: IncomingMessage): Session | undefined {
    const raw = cookieValue(request, name);
    if (!/^[\w-]{43}$/.test(raw)) return;
    const row = db.prepare(`SELECT s.* FROM sessions s JOIN accounts a ON a.id=s.account_id
      WHERE s.token_hash=? AND a.approval_state='approved'`).get(digest(raw)) as
      | Session
      | undefined;
    if (!row || row.expires_at <= now() || row.last_seen < now() - 7 * DAY) return;
    if (now() - row.last_seen > 60000)
      db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now(), row.token_hash);
    return row;
  }
  function requireSession(request: IncomingMessage) {
    const value = readSession(request);
    if (!value) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
    return value;
  }
  function account(id: string) {
    const value = db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as Account | undefined;
    if (!value) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
    return value;
  }
  function responseSession(s: Session | undefined) {
    return {
      account: s ? publicAccount(account(s.account_id)) : null,
      profiles: s ? profiles(s.account_id) : [],
      csrfToken: s?.csrf ?? null,
      registrationOpen: registration,
      approvalRequired,
      recoveryMethod: 'recovery-code',
      maxProfiles: 5,
      privateSite,
    };
  }
  function newSession(
    a: Account,
    request: IncomingMessage,
    response: ServerResponse,
    remember: boolean,
  ) {
    if (a.approval_state !== 'approved') throw new AppError(403, 'BLOCKED', 'Account approval is required.');
    const raw = token();
    const s: Session = {
      token_hash: digest(raw),
      account_id: a.id,
      csrf: token(),
      created_at: now(),
      last_seen: now(),
      expires_at: now() + (remember ? 30 * DAY : 12 * 3600000),
      device: String(request.headers['user-agent'] ?? 'Unknown browser').slice(0, 160),
    };
    db.prepare(
      'INSERT INTO sessions(token_hash,account_id,csrf,created_at,last_seen,expires_at,device) VALUES(?,?,?,?,?,?,?)',
    ).run(s.token_hash, s.account_id, s.csrf, s.created_at, s.last_seen, s.expires_at, s.device);
    db.prepare(
      'DELETE FROM sessions WHERE account_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id=? ORDER BY created_at DESC LIMIT 10)',
    ).run(a.id, a.id);
    response.setHeader('Set-Cookie', sessionCookie(raw, remember ? 30 * 86400 : undefined));
    return s;
  }
  function mutation(request: IncomingMessage, s?: Session) {
    const supplied = request.headers.origin;
    if (typeof supplied !== 'string' || request.headers['x-solanime-intent'] !== 'account')
      throw new AppError(
        403,
        'UNAUTHORIZED',
        'This action requires the Solanime account interface.',
      );
    let parsed: URL;
    try {
      parsed = new URL(supplied);
    } catch {
      throw new AppError(403, 'UNAUTHORIZED', 'Invalid request origin.');
    }
    const exact = origin
      ? supplied === origin
      : ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) &&
        parsed.host === request.headers.host;
    const extra = (process.env.SOLANIME_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (
      parsed.origin !== supplied ||
      (!exact && !extra.includes(supplied)) ||
      (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')
    )
      throw new AppError(403, 'UNAUTHORIZED', 'Cross-origin account changes are blocked.');
    if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] ?? '')))
      throw new AppError(415, 'BAD_REQUEST', 'Account changes require JSON.');
    if (s && !equalToken(request.headers['x-csrf-token'], s.csrf))
      throw new AppError(403, 'UNAUTHORIZED', 'Your session changed. Reload before trying again.');
  }
  function ownedProfile(profileId: string, accountId: string) {
    const p = db
      .prepare('SELECT id,name,avatar FROM profiles WHERE id=? AND account_id=?')
      .get(profileId, accountId);
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
    return p;
  }
  function dataFor(profileId: string) {
    const values: Record<string, unknown> = {},
      revisions: Record<string, number> = {};
    for (const row of db
      .prepare('SELECT key,value,revision FROM profile_data WHERE profile_id=?')
      .all(profileId) as { key: string; value: string; revision: number }[]) {
      values[row.key] = JSON.parse(row.value);
      revisions[row.key] = row.revision;
    }
    return { values, revisions };
  }
  async function passwordProof(a: Account, value: unknown) {
    if (!(await verifyPassword(value, a.password_hash)))
      throw new AppError(401, 'UNAUTHORIZED', 'The current password is incorrect.', { reason: 'PASSWORD_PROOF_FAILED' });
    if (account(a.id).password_hash !== a.password_hash)
      throw new AppError(409, 'UNAUTHORIZED', 'The account changed. Sign in again.');
  }
  async function handleCommunity(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    episodeExists: (episodeId: number) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    const route = /^\/api\/episodes\/(\d+)\/comments(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
    if (!route) return false;
    prune();
    const method = req.method ?? 'GET';
    const episodeId = Number(route[1]);
    if (!Number.isSafeInteger(episodeId) || episodeId < 1 || !(await episodeExists(episodeId)))
      throw new AppError(404, 'NOT_FOUND', 'Episode was not found.');
    const session = readSession(req);
    if (privateSite && !session) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
    const requestedProfile = url.searchParams.get('profile');
    let viewerProfileId: string | undefined;
    if (requestedProfile !== null) {
      if (!session) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
      viewerProfileId = communityUuid(requestedProfile, 'profile');
      ownedProfile(viewerProfileId, session.account_id);
    }
    if (method === 'GET' && !route[2]) {
      const page = communityPositiveInteger(url.searchParams.get('page'), 1, 100_000);
      const pageSize = communityPositiveInteger(url.searchParams.get('pageSize'), 20, COMMUNITY_PAGE_SIZE_MAX);
      const total = Number((db.prepare("SELECT COUNT(*) AS total FROM episode_comments WHERE episode_id=? AND moderation_state='visible'")
        .get(episodeId) as { total: number }).total);
      const rows = db.prepare(`SELECT c.id,c.episode_id,p.name AS author_name,p.avatar AS author_avatar,
        c.body,c.revision,c.created_at,c.updated_at,CASE WHEN c.profile_id=? THEN 1 ELSE 0 END AS viewer_owned
        FROM episode_comments c JOIN profiles p ON p.id=c.profile_id
        WHERE c.episode_id=? AND c.moderation_state='visible'
        ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`)
        .all(viewerProfileId ?? '', episodeId, pageSize, (page - 1) * pageSize) as Parameters<typeof publicComment>[0][];
      reply(res, 200, { items: rows.map(publicComment), total, page, pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)) });
      return true;
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(method) || (method === 'POST' && route[2]) || (method !== 'POST' && !route[2]))
      throw new AppError(404, 'NOT_FOUND', 'Community route not found.');
    mutation(req, session);
    const auth = requireSession(req);
    const input = await readBody(req);
    // Re-read after the asynchronous body so a concurrently revoked session cannot mutate.
    if (!readSession(req)) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
    const profileId = communityUuid(input.profileId, 'profile');
    ownedProfile(profileId, auth.account_id);
    rate('community:' + auth.account_id, 20, 60000);
    if (method === 'POST') {
      const id = randomUUID(), body = communityCommentBody(input.body), timestamp = now();
      try {
        db.prepare(`INSERT INTO episode_comments(id,episode_id,profile_id,body,revision,created_at,updated_at)
          VALUES(?,?,?,?,1,?,?)`).run(id, episodeId, profileId, body, timestamp, timestamp);
      } catch (error) {
        if (error instanceof Error && error.message.includes('COMMENT_LIMIT'))
          throw new AppError(409, 'BAD_REQUEST', 'This profile has reached its community comment limit. Remove an older comment before posting again.');
        throw error;
      }
      const row = db.prepare(`SELECT c.id,c.episode_id,p.name AS author_name,p.avatar AS author_avatar,
        c.body,c.revision,c.created_at,c.updated_at,1 AS viewer_owned FROM episode_comments c
        JOIN profiles p ON p.id=c.profile_id WHERE c.id=? AND c.episode_id=?`).get(id, episodeId) as Parameters<typeof publicComment>[0];
      reply(res, 201, { comment: publicComment(row) });
      return true;
    }
    const id = communityUuid(route[2], 'comment');
    const revision = communityRevision(input.revision);
    const existing = db.prepare(`SELECT revision FROM episode_comments WHERE id=? AND episode_id=? AND profile_id=?
      ${method === 'PATCH' ? "AND moderation_state='visible'" : ''}`)
      .get(id, episodeId, profileId) as { revision: number } | undefined;
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Comment not found.');
    if (existing.revision !== revision)
      throw new AppError(409, 'BAD_REQUEST', 'This comment changed in another tab. Reload comments before trying again.');
    if (method === 'DELETE') {
      const result = db.prepare('DELETE FROM episode_comments WHERE id=? AND episode_id=? AND profile_id=? AND revision=?')
        .run(id, episodeId, profileId, revision);
      if (result.changes !== 1)
        throw new AppError(409, 'BAD_REQUEST', 'This comment changed in another tab. Reload comments before trying again.');
      reply(res, 200, { deleted: true, id });
      return true;
    }
    const body = communityCommentBody(input.body), timestamp = now();
    const result = db.prepare(`UPDATE episode_comments SET body=?,revision=revision+1,updated_at=?
      WHERE id=? AND episode_id=? AND profile_id=? AND revision=? AND moderation_state='visible'`)
      .run(body, timestamp, id, episodeId, profileId, revision);
    if (result.changes !== 1)
      throw new AppError(409, 'BAD_REQUEST', 'This comment changed in another tab. Reload comments before trying again.');
    const row = db.prepare(`SELECT c.id,c.episode_id,p.name AS author_name,p.avatar AS author_avatar,
      c.body,c.revision,c.created_at,c.updated_at,1 AS viewer_owned FROM episode_comments c
      JOIN profiles p ON p.id=c.profile_id WHERE c.id=? AND c.episode_id=?`).get(id, episodeId) as Parameters<typeof publicComment>[0];
    reply(res, 200, { comment: publicComment(row) });
    return true;
  }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/account/')) return false;
    prune();
    const method = req.method ?? 'GET',
      path = url.pathname;
    const s = readSession(req);
    if (method === 'GET' && path === '/api/account/session') {
      reply(res, 200, responseSession(s));
      return true;
    }
    if (method !== 'GET')
      mutation(
        req,
        ['/api/account/register', '/api/account/login', '/api/account/recover'].includes(path)
          ? undefined
          : s,
      );
    const gatewayToken = process.env.SOLANIME_GATEWAY_TOKEN;
    const forwarded = req.headers['x-solanime-client-ip'];
    const ip =
      gatewayToken &&
      equalToken(req.headers['x-solanime-gateway'], gatewayToken) &&
      typeof forwarded === 'string' &&
      isIP(forwarded)
        ? forwarded
        : (req.socket.remoteAddress ?? 'unknown');
    if (method !== 'GET') rate('ip:' + ip, 150, 60000);
    if (method === 'POST' && (path === '/api/account/register' || path === '/api/account/login')) {
      const body = await readBody(req),
        email = emailAddress(body.email);
      rate('sign:' + email + ':' + ip, 12, 15 * 60000);
      const existing = db.prepare('SELECT * FROM accounts WHERE email=?').get(email) as
        | Account
        | undefined;
      if (path.endsWith('/register')) {
        if (!registration)
          throw new AppError(403, 'BLOCKED', 'New registration is currently closed.');
        rate('register:' + ip, approvalRequired ? 3 : 40, 3600000);
        const password = validatePassword(body.password),
          hash = await hashPassword(password);
        if (existing || db.prepare('SELECT id FROM accounts WHERE email=?').get(email))
          throw new AppError(
            409,
            'BAD_REQUEST',
            'An account could not be created with these details. Try signing in instead.',
          );
        const recoveryCode = token();
        const id = randomUUID();
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(
            `INSERT INTO accounts(id,email,password_hash,recovery_hash,created_at,
              approval_state,approval_requested_at,owner_notice_state) VALUES(?,?,?,?,?,?,?,?)`,
          ).run(id, email, hash, digest(recoveryCode), now(),
            approvalRequired ? 'pending' : 'approved', approvalRequired ? now() : null,
            approvalRequired ? 'pending' : 'not_required');
          db.prepare(
            'INSERT INTO profiles(id,account_id,name,avatar,created_at) VALUES(?,?,?,?,?)',
          ).run(randomUUID(), id, 'You', 'ruby', now());
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        if (approvalRequired) {
          let sent = false;
          try { sent = await notifyApproval('request', { id, email }); } catch { /* Operator may retry. */ }
          db.prepare('UPDATE accounts SET owner_notice_state=? WHERE id=?')
            .run(sent ? 'sent' : 'failed', id);
          reply(res, 202, { ...responseSession(undefined), pendingApproval: true, recoveryCode });
          return true;
        }
        const fresh = newSession(account(id), req, res, body.remember === true);
        reply(res, 201, { ...responseSession(fresh), recoveryCode });
        return true;
      }
      if (!(await verifyPassword(body.password, existing?.password_hash)) || !existing)
        throw new AppError(401, 'UNAUTHORIZED', 'Email or password is incorrect.');
      if (account(existing.id).password_hash !== existing.password_hash)
        throw new AppError(401, 'UNAUTHORIZED', 'Email or password is incorrect.');
      if (existing.approval_state !== 'approved')
        throw new AppError(403, 'BLOCKED', existing.approval_state === 'pending'
          ? 'Your account is awaiting approval.' : 'This account request was declined.',
          { reason: existing.approval_state === 'pending' ? 'ACCOUNT_PENDING_APPROVAL' : 'ACCOUNT_REJECTED' });
      // Never upgrade a pre-existing session: issue a new random identifier.
      if (s) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash);
      const fresh = newSession(existing, req, res, body.remember === true);
      reply(res, 200, responseSession(fresh));
      return true;
    }
    if (method === 'POST' && path === '/api/account/recover') {
      const body = await readBody(req),
        email = emailAddress(body.email);
      rate('recovery:' + email + ':' + ip, 5, 15 * 60000);
      const a = db.prepare('SELECT * FROM accounts WHERE email=?').get(email) as
        | Account
        | undefined;
      const valid =
        typeof body.recoveryCode === 'string' &&
        /^[\w-]{43}$/.test(body.recoveryCode) &&
        equalToken(digest(body.recoveryCode), a?.recovery_hash ?? '0'.repeat(64));
      if (!a || !valid)
        throw new AppError(400, 'BAD_REQUEST', 'Email or recovery code is incorrect.');
      const original = a.recovery_hash,
        hash = await hashPassword(validatePassword(body.password)),
        recoveryCode = token();
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db
          .prepare(
            'UPDATE accounts SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?',
          )
          .run(hash, digest(recoveryCode), a.id, original);
        if (result.changes !== 1)
          throw new AppError(409, 'BAD_REQUEST', 'This recovery code has already been used.');
        db.prepare('DELETE FROM sessions WHERE account_id=?').run(a.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      reply(res, 200, {
        recoveryCode,
        message: 'Password changed. Save your replacement recovery code and sign in.',
      });
      return true;
    }
    const auth = requireSession(req),
      a = account(auth.account_id);
    const malRoute = /^\/api\/account\/profiles\/([\w-]{36})\/mal\/(status|list|connect|complete|sync|update|disconnect)$/.exec(path);
    if (malRoute) {
      const profile = malRoute[1], action = malRoute[2];
      ownedProfile(profile, a.id);
      if (method !== (['status', 'list'].includes(action) ? 'GET' : 'POST')) throw new AppError(405, 'BAD_REQUEST', 'Unsupported method.');
      if (method === 'POST') rate('mal:' + a.id, 30, 60000);
      const service = malService(sqliteAccountAdapter(db), { clientId: process.env.MAL_CLIENT_ID,
        clientSecret: process.env.MAL_CLIENT_SECRET, redirectUri: origin ? `${origin}/settings/mal/callback` : undefined,
        credentialKey: process.env.MAL_CREDENTIAL_KEY }, fetch, now);
      const result = await service(profile, a.id, action, method === 'GET' ? { page: url.searchParams.get('page') ?? 1 } : await readBody(req), async () => {
        const current = requireSession(req);
        if (current.account_id !== a.id) throw new AppError(401, 'UNAUTHORIZED', 'Your session changed.');
        ownedProfile(profile, a.id);
      });
      reply(res, 200, result);
      return true;
    }
    if (method === 'POST' && path === '/api/account/logout') {
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.token_hash);
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      reply(res, 200, { ok: true });
      return true;
    }
    if (method === 'GET' && path === '/api/account/sessions') {
      reply(res, 200, {
        items: (
          db
            .prepare(
              'SELECT token_hash,created_at,last_seen,expires_at,device FROM sessions WHERE account_id=? ORDER BY created_at DESC',
            )
            .all(a.id) as Session[]
        ).map((x) => ({
          id: x.token_hash,
          current: x.token_hash === auth.token_hash,
          createdAt: x.created_at,
          lastSeen: x.last_seen,
          expiresAt: x.expires_at,
          device: x.device,
        })),
      });
      return true;
    }
    if (method === 'POST' && path === '/api/account/revoke-other-sessions') {
      db.prepare('DELETE FROM sessions WHERE account_id=? AND token_hash<>?').run(
        a.id,
        auth.token_hash,
      );
      reply(res, 200, { ok: true });
      return true;
    }
    if (
      method === 'POST' &&
      ['/api/account/password', '/api/account/recovery-code', '/api/account/delete'].includes(path)
    ) {
      rate('sensitive:' + a.id, 8, 15 * 60000);
      const body = await readBody(req);
      await passwordProof(a, body.currentPassword);
      requireSession(req);
      if (path.endsWith('/delete')) {
        db.prepare('DELETE FROM accounts WHERE id=?').run(a.id);
        res.setHeader('Set-Cookie', sessionCookie('', 0));
        reply(res, 200, { ok: true });
        return true;
      }
      if (path.endsWith('/recovery-code')) {
        const recoveryCode = token();
        db.prepare('UPDATE accounts SET recovery_hash=? WHERE id=?').run(
          digest(recoveryCode),
          a.id,
        );
        reply(res, 200, { recoveryCode });
        return true;
      }
      const hash = await hashPassword(validatePassword(body.password));
      const changed = db
        .prepare('UPDATE accounts SET password_hash=? WHERE id=? AND password_hash=?')
        .run(hash, a.id, a.password_hash);
      if (changed.changes !== 1)
        throw new AppError(
          409,
          'UNAUTHORIZED',
          'The account changed. Sign in again before changing its password.',
        );
      db.prepare('DELETE FROM sessions WHERE account_id=?').run(a.id);
      const fresh = newSession(account(a.id), req, res, false);
      reply(res, 200, responseSession(fresh));
      return true;
    }
    if (method === 'GET' && path === '/api/account/export') {
      reply(
        res,
        200,
        {
          account: publicAccount(a),
          profiles: profiles(a.id).map((p) => ({ ...p, data: dataFor(String(p.id)),
            communityComments: db.prepare(`SELECT id,CAST(episode_id AS TEXT) AS episodeId,body,revision,
              moderation_state AS moderationState,created_at AS createdAt,updated_at AS updatedAt
              FROM episode_comments WHERE profile_id=? ORDER BY created_at,id`).all(String(p.id)) })),
          exportedAt: new Date(now()).toISOString(),
        },
        { 'Content-Disposition': 'attachment; filename="solanime-account.json"' },
      );
      return true;
    }
    if (method === 'POST' && path === '/api/account/profiles') {
      const input = profileInput(await readBody(req));
      const id = randomUUID();
      if (profiles(a.id).length >= 5)
        throw new AppError(409, 'BAD_REQUEST', 'Each account can have up to five profiles.');
      try {
        db.prepare(
          'INSERT INTO profiles(id,account_id,name,avatar,created_at) VALUES(?,?,?,?,?)',
        ).run(id, a.id, input.name, input.avatar, now());
      } catch (error) {
        if (error instanceof Error && error.message.includes('PROFILE_LIMIT'))
          throw new AppError(409, 'BAD_REQUEST', 'Each account can have up to five profiles.');
        throw error;
      }
      reply(res, 201, { profile: { id, ...input }, profiles: profiles(a.id) });
      return true;
    }
    const pm = /^\/api\/account\/profiles\/([\w-]{36})(?:\/(data|delete))?$/.exec(path);
    if (pm) {
      const id = pm[1];
      ownedProfile(id, a.id);
      if (method === 'GET' && pm[2] === 'data') {
        reply(res, 200, dataFor(id));
        return true;
      }
      if (method === 'POST' && pm[2] === 'delete') {
        const body = await readBody(req);
        await passwordProof(a, body.currentPassword);
        atomic(() => {
          requireSession(req);
          ownedProfile(id, a.id);
          if (profiles(a.id).length <= 1)
            throw new AppError(409, 'BAD_REQUEST', 'Keep at least one profile.');
          db.prepare('DELETE FROM profiles WHERE id=? AND account_id=?').run(id, a.id);
        });
        reply(res, 200, { profiles: profiles(a.id) });
        return true;
      }
      if (method === 'POST' && pm[2] === 'data') {
        const body = await readBody(req);
        if (
          typeof body.key !== 'string' ||
          body.key.length > 250 ||
          !Number.isSafeInteger(body.revision) ||
          Number(body.revision) < 0
        )
          throw new AppError(400, 'BAD_REQUEST', 'Invalid data revision.');
        const key = body.key,
          value = JSON.stringify(validateData(key, body.value));
        const next = atomic(() => {
          ownedProfile(id, a.id);
          const existing = db
            .prepare(
              'SELECT revision,length(CAST(value AS BLOB)) AS bytes FROM profile_data WHERE profile_id=? AND key=?',
            )
            .get(id, key) as { revision: number; bytes: number } | undefined;
          if ((existing?.revision ?? 0) !== body.revision)
            throw new AppError(
              409,
              'BAD_REQUEST',
              'This profile changed in another tab. Reload it before saving again.',
            );
          const quota = db
            .prepare(
              'SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM profile_data WHERE profile_id=?',
            )
            .get(id) as { count: number; bytes: number };
          if (
            (!existing && quota.count >= 2005) ||
            quota.bytes - (existing?.bytes ?? 0) + Buffer.byteLength(value) > 2 * 1024 * 1024
          )
            throw new AppError(
              413,
              'BAD_REQUEST',
              'This profile has reached its saved-data limit. Remove old saved items before trying again.',
            );
          const revision = Number(body.revision) + 1;
          db.prepare(
            'INSERT INTO profile_data(profile_id,key,value,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,key) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated_at=excluded.updated_at',
          ).run(id, key, value, revision, now());
          return revision;
        });
        reply(res, 200, { revision: next });
        return true;
      }
      if (method === 'POST' && !pm[2]) {
        const input = profileInput(await readBody(req));
        db.prepare('UPDATE profiles SET name=?,avatar=? WHERE id=? AND account_id=?').run(
          input.name,
          input.avatar,
          id,
          a.id,
        );
        reply(res, 200, { profiles: profiles(a.id) });
        return true;
      }
    }
    throw new AppError(404, 'NOT_FOUND', 'Account route not found.');
  }
  const pendingApprovals = () => db.prepare(`SELECT id,email,created_at,approval_requested_at,
    approval_state,owner_notice_state,applicant_notice_state FROM accounts
    WHERE approval_state='pending' OR (approval_state='approved' AND applicant_notice_state='failed')
    ORDER BY CASE WHEN approval_state='pending' THEN 0 ELSE 1 END,approval_requested_at,id LIMIT 50`).all();
  const decideApproval = async (id: string, decision: 'approved' | 'rejected') => {
    if (!/^[\w-]{1,128}$/.test(id)) throw new AppError(400, 'BAD_REQUEST', 'Invalid account identifier.');
    const changed = db.prepare(`UPDATE accounts SET approval_state=?,approval_decided_at=?,
      applicant_notice_state=CASE WHEN ?='approved' THEN 'pending' ELSE 'not_required' END
      WHERE id=? AND approval_state='pending' RETURNING id,email`).get(decision, now(), decision, id) as Pick<Account, 'id' | 'email'> | undefined;
    if (!changed) throw new AppError(409, 'BAD_REQUEST', 'This request is no longer pending. Refresh the queue.');
    db.prepare('DELETE FROM sessions WHERE account_id=?').run(id);
    if (decision === 'approved') {
      let sent = false;
      try { sent = await notifyApproval('approved', changed); } catch { /* Operator may retry. */ }
      db.prepare('UPDATE accounts SET applicant_notice_state=? WHERE id=?').run(sent ? 'sent' : 'failed', id);
    }
    return { id, decision, applicantNotice: decision === 'approved'
      ? (account(id).applicant_notice_state) : 'not_required' };
  };
  const retryNotice = async (id: string) => {
    if (!/^[\w-]{1,128}$/.test(id)) throw new AppError(400, 'BAD_REQUEST', 'Invalid account identifier.');
    const a = account(id);
    if (a.approval_state === 'rejected') throw new AppError(409, 'BAD_REQUEST', 'Rejected requests have no outgoing notice.');
    const kind = a.approval_state === 'pending' ? 'request' : 'approved';
    const column = kind === 'request' ? 'owner_notice_state' : 'applicant_notice_state';
    if (a[column] === 'sent') return { id, notice: 'sent' };
    let sent = false;
    try { sent = await notifyApproval(kind, a); } catch { /* Operator may retry. */ }
    db.prepare(`UPDATE accounts SET ${column}=? WHERE id=?`).run(sent ? 'sent' : 'failed', id);
    return { id, notice: sent ? 'sent' : 'failed' };
  };
  return { handle, handleCommunity, db, readSession, ownedProfile, name,
    pendingApprovals, decideApproval, retryNotice, close: () => db.close() };
}
export type AccountsService = ReturnType<typeof createAccounts>;

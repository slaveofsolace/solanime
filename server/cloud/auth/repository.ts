import { AppError } from '../../errors.ts';
import { publicComment } from '../../community.ts';
import type { AccountDatabase, CloudAccount, CloudEpisodeComment, CloudProfile, CloudSession, IdentityUser } from './types.ts';

const DAY = 86400000;
const sessionGuard = `EXISTS(SELECT 1 FROM sessions guard_session JOIN accounts guard_account
  ON guard_account.id=guard_session.account_id
  WHERE guard_session.token_hash=? AND guard_session.account_id=?
  AND guard_session.auth_revision=guard_account.auth_revision AND guard_account.auth_state='active'
  AND guard_account.approval_state='approved'
  AND guard_session.expires_at>? AND guard_session.last_seen>=?)`;
const guardValues = (s: CloudSession, now: number) => [s.token_hash, s.account_id, now, now - 7 * DAY];
const unauthenticated = () => new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
const conflict = () => new AppError(409, 'BAD_REQUEST', 'This profile changed in another tab. Reload it before saving again.');
const commentConflict = () => new AppError(409, 'BAD_REQUEST', 'This comment changed in another tab. Reload comments before trying again.');

/** Every state-changing invariant is enforced by one SQL statement or an atomic D1 batch. */
export class D1AccountsRepository {
  constructor(readonly db: AccountDatabase) {}

  account(id: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first<CloudAccount>();
  }
  accountByEmail(email: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE email=?').bind(email).first<CloudAccount>();
  }
  accountByUid(uid: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE firebase_uid=?').bind(uid).first<CloudAccount>();
  }
  async profiles(accountId: string) {
    return (await this.db.prepare('SELECT id,name,avatar FROM profiles WHERE account_id=? ORDER BY created_at,id')
      .bind(accountId).all<CloudProfile>()).results;
  }
  async ownedProfile(id: string, accountId: string) {
    const value = await this.db.prepare('SELECT id,name,avatar FROM profiles WHERE id=? AND account_id=?')
      .bind(id, accountId).first<CloudProfile>();
    if (!value) throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
    return value;
  }
  async ensureAccount(user: IdentityUser, recoveryHash: string | null, now: number, approvalRequired = false) {
    try {
      const results = await this.db.batch([
        this.db.prepare(`INSERT INTO accounts(id,firebase_uid,email,recovery_hash,email_verified,created_at,
          approval_state,approval_requested_at,owner_notice_state)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(firebase_uid) DO NOTHING`)
          .bind(user.uid, user.uid, user.email, recoveryHash, user.emailVerified ? 1 : 0, user.createdAt || now,
            approvalRequired ? 'pending' : 'approved', approvalRequired ? now : null,
            approvalRequired ? 'pending' : 'not_required'),
        this.db.prepare(`INSERT INTO profiles(id,account_id,name,avatar,created_at)
          SELECT ?,id,'You','ruby',? FROM accounts WHERE firebase_uid=?
          AND NOT EXISTS(SELECT 1 FROM profiles WHERE account_id=accounts.id)`)
          .bind(crypto.randomUUID(), now, user.uid),
      ]);
      const account = await this.accountByUid(user.uid);
      if (!account || account.email.toLowerCase() !== user.email.toLowerCase())
        throw new AppError(409, 'UNAUTHORIZED', 'Account identity changed. Contact the operator before continuing.', { reason: 'IDENTITY_MISMATCH' });
      if (account.auth_state !== 'active')
        throw new AppError(409, 'UNAVAILABLE', 'An account security change is awaiting reconciliation.', { reason: 'AUTH_OPERATION_PENDING' });
      return { account, created: results[0].meta.changes === 1 };
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint'))
        throw new AppError(409, 'UNAUTHORIZED', 'Account identity changed. Contact the operator before continuing.', { reason: 'IDENTITY_MISMATCH' });
      throw error;
    }
  }
  async updateIdentity(id: string, emailVerified: boolean) {
    await this.db.prepare('UPDATE accounts SET email_verified=? WHERE id=? AND email_verified<>?')
      .bind(emailVerified ? 1 : 0, id, emailVerified ? 1 : 0).run();
  }
  async pendingApprovals(limit = 50) {
    return (await this.db.prepare(`SELECT id,email,created_at,approval_requested_at,approval_state,
      owner_notice_state,applicant_notice_state FROM accounts
      WHERE approval_state='pending' OR (approval_state='approved' AND applicant_notice_state='failed')
      ORDER BY CASE WHEN approval_state='pending' THEN 0 ELSE 1 END,approval_requested_at,id LIMIT ?`)
      .bind(Math.min(50, Math.max(1, limit))).all<Pick<CloudAccount,
        'id' | 'email' | 'created_at' | 'approval_requested_at' | 'approval_state' |
        'owner_notice_state' | 'applicant_notice_state'>>()).results;
  }
  async decideApproval(id: string, decision: 'approved' | 'rejected', now: number) {
    const row = await this.db.prepare(`UPDATE accounts SET approval_state=?,approval_decided_at=?,
      applicant_notice_state=CASE WHEN ?='approved' THEN 'pending' ELSE 'not_required' END,
      auth_revision=auth_revision+1 WHERE id=? AND approval_state='pending' RETURNING *`)
      .bind(decision, now, decision, id).first<CloudAccount>();
    if (!row) throw new AppError(409, 'BAD_REQUEST', 'This request is no longer pending. Refresh the queue.');
    await this.db.prepare('DELETE FROM sessions WHERE account_id=?').bind(id).run();
    return row;
  }
  async noticeState(id: string, kind: 'owner' | 'applicant', state: 'sent' | 'failed') {
    const column = kind === 'owner' ? 'owner_notice_state' : 'applicant_notice_state';
    await this.db.prepare(`UPDATE accounts SET ${column}=? WHERE id=? AND ${column} IN ('pending','failed')`)
      .bind(state, id).run();
  }
  session(hash: string, now: number) {
    return this.db.prepare(`SELECT s.* FROM sessions s JOIN accounts a ON a.id=s.account_id
      WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen>=?
      AND a.auth_state='active' AND a.approval_state='approved' AND a.auth_revision=s.auth_revision`)
      .bind(hash, now, now - 7 * DAY).first<CloudSession>();
  }
  async insertSession(s: CloudSession, replacedHash?: string) {
    const statements = [this.db.prepare(`INSERT INTO sessions
      (token_hash,account_id,csrf,created_at,last_seen,expires_at,device,auth_revision,credential_cipher,checked_at)
      SELECT ?,id,?,?,?,?,?,?,?,? FROM accounts WHERE id=? AND auth_revision=? AND auth_state='active'
      AND approval_state='approved'`)
      .bind(s.token_hash, s.csrf, s.created_at, s.last_seen, s.expires_at, s.device, s.auth_revision,
        s.credential_cipher, s.checked_at, s.account_id, s.auth_revision)];
    if (replacedHash) statements.push(this.db.prepare(`DELETE FROM sessions WHERE token_hash=?
      AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?)`).bind(replacedHash, s.token_hash));
    statements.push(this.db.prepare(`DELETE FROM sessions WHERE account_id=? AND token_hash NOT IN
      (SELECT token_hash FROM sessions WHERE account_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10)`)
      .bind(s.account_id, s.account_id));
    const results = await this.db.batch(statements);
    if (results[0].meta.changes !== 1) throw unauthenticated();
  }
  async touchSession(s: CloudSession, now: number, cipher?: string) {
    const result = cipher === undefined
      ? await this.db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=? AND last_seen<?')
        .bind(now, s.token_hash, now - 60000).run()
      : await this.db.prepare(`UPDATE sessions SET last_seen=?,credential_cipher=?,checked_at=?
        WHERE token_hash=? AND credential_cipher=? AND checked_at<=?`)
        .bind(now, cipher, now, s.token_hash, s.credential_cipher, now).run();
    return result.meta.changes;
  }
  async deleteSession(hash: string) {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();
  }
  async revokeSessions(accountId: string, exceptHash?: string) {
    await this.db.prepare('DELETE FROM sessions WHERE account_id=? AND token_hash<>?')
      .bind(accountId, exceptHash ?? '').run();
  }
  async sessions(accountId: string, now: number) {
    return (await this.db.prepare(`SELECT token_hash,created_at,last_seen,expires_at,device FROM sessions
      WHERE account_id=? AND expires_at>? AND last_seen>=? ORDER BY created_at DESC`)
      .bind(accountId, now, now - 7 * DAY).all<Pick<CloudSession, 'token_hash' | 'created_at' | 'last_seen' | 'expires_at' | 'device'>>()).results;
  }
  /** Bounded pruning, suitable for scheduled maintenance; no unbounded table deletion per request. */
  async prune(now: number) {
    await this.db.batch([
      this.db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? LIMIT 100)').bind(now),
      this.db.prepare('DELETE FROM account_rate_limits WHERE key IN (SELECT key FROM account_rate_limits WHERE expires_at<=? LIMIT 100)').bind(now),
    ]);
  }
  async rate(hash: string, max: number, windowMs: number, now: number) {
    const attempt = () => this.db.prepare(`INSERT INTO account_rate_limits(key,count,expires_at)
      SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM account_rate_limits WHERE key=?)
      OR (SELECT count(*) FROM account_rate_limits)<10000
      ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
        expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
      RETURNING count,expires_at`)
      .bind(hash, now + windowMs, hash, now, now).first<{ count: number; expires_at: number }>();
    let row = await attempt();
    if (!row) {
      // A new key can hit the durable cap after old, distinct attempts expire.
      // Reclaim only bounded expired rate buckets, never accounts or sessions.
      // Selection/deletion is one SQL statement; active buckets cannot be removed
      // by a concurrent cleanup. Retry the original atomic cap/limit check once.
      await this.db.prepare(`DELETE FROM account_rate_limits WHERE key IN
        (SELECT key FROM account_rate_limits WHERE expires_at<=? ORDER BY expires_at,key LIMIT 100)`)
        .bind(now).run();
      row = await attempt();
    }
    if (!row) throw new AppError(503, 'UNAVAILABLE', 'Sign-in is busy. Try again shortly.', { reason: 'AUTH_RATE_STORAGE_FULL' });
    if (row.count > max)
      throw new AppError(429, 'UNAVAILABLE', 'Too many attempts. Try again later.',
        { retryAfterSeconds: Math.max(1, Math.ceil((row.expires_at - now) / 1000)) });
  }
  async createProfile(s: CloudSession, input: { name: string; avatar: string }, now: number) {
    const id = crypto.randomUUID();
    try {
      const result = await this.db.prepare(`INSERT INTO profiles(id,account_id,name,avatar,created_at)
        SELECT ?,?,?,?,? WHERE ${sessionGuard}`)
        .bind(id, s.account_id, input.name, input.avatar, now, ...guardValues(s, now)).run();
      if (result.meta.changes !== 1) throw unauthenticated();
      return { id, ...input };
    } catch (error) {
      if (error instanceof Error && error.message.includes('PROFILE_LIMIT'))
        throw new AppError(409, 'BAD_REQUEST', 'Each account can have up to five profiles.');
      throw error;
    }
  }
  async updateProfile(s: CloudSession, id: string, input: { name: string; avatar: string }, now: number) {
    const result = await this.db.prepare(`UPDATE profiles SET name=?,avatar=? WHERE id=? AND account_id=? AND ${sessionGuard}`)
      .bind(input.name, input.avatar, id, s.account_id, ...guardValues(s, now)).run();
    if (result.meta.changes !== 1) { await this.ownedProfile(id, s.account_id); throw unauthenticated(); }
  }
  async deleteProfile(s: CloudSession, id: string, now: number) {
    // D1 meta.changes includes cascaded profile_data deletions. RETURNING proves
    // the exact parent row was deleted without mistaking its children for a conflict.
    const result = await this.db.prepare(`DELETE FROM profiles WHERE id=? AND account_id=?
      AND (SELECT count(*) FROM profiles WHERE account_id=?)>1 AND ${sessionGuard} RETURNING id`)
      .bind(id, s.account_id, s.account_id, ...guardValues(s, now)).first<{ id: string }>();
    if (result?.id !== id) {
      if (!(await this.session(s.token_hash, now))) throw unauthenticated();
      await this.ownedProfile(id, s.account_id);
      throw new AppError(409, 'BAD_REQUEST', 'Keep at least one profile.');
    }
  }
  async dataFor(id: string, accountId: string) {
    await this.ownedProfile(id, accountId);
    const values: Record<string, unknown> = {}, revisions: Record<string, number> = {};
    const rows = (await this.db.prepare(`SELECT d.key,d.value,d.revision FROM profile_data d
      JOIN profiles p ON p.id=d.profile_id WHERE d.profile_id=? AND p.account_id=?`)
      .bind(id, accountId).all<{ key: string; value: string; revision: number }>()).results;
    for (const row of rows) { values[row.key] = JSON.parse(row.value); revisions[row.key] = row.revision; }
    return { values, revisions };
  }
  async putData(s: CloudSession, id: string, key: string, value: string, revision: number, now: number) {
    try {
      const result = await this.db.prepare(`INSERT INTO profile_data(profile_id,key,value,revision,updated_at)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM profiles WHERE id=? AND account_id=?)
          AND ${sessionGuard}
          AND (?=0 OR EXISTS(SELECT 1 FROM profile_data WHERE profile_id=? AND key=? AND revision=?))
        ON CONFLICT(profile_id,key) DO UPDATE SET value=excluded.value,revision=profile_data.revision+1,updated_at=excluded.updated_at
          WHERE profile_data.revision=?`)
        .bind(id, key, value, revision + 1, now, id, s.account_id, ...guardValues(s, now), revision, id, key, revision, revision).run();
      if (result.meta.changes !== 1) {
        if (!(await this.session(s.token_hash, now))) throw unauthenticated();
        await this.ownedProfile(id, s.account_id);
        throw conflict();
      }
      return revision + 1;
    } catch (error) {
      if (error instanceof Error && error.message.includes('PROFILE_DATA_LIMIT'))
        throw new AppError(413, 'BAD_REQUEST', 'This profile has reached its saved-data limit. Remove old saved items before trying again.');
      throw error;
    }
  }
  async comments(episodeId: number, page: number, pageSize: number, viewerProfileId?: string) {
    const offset = (page - 1) * pageSize;
    const viewer = viewerProfileId ?? '';
    const [count, rows] = await Promise.all([
      this.db.prepare("SELECT COUNT(*) AS total FROM episode_comments WHERE episode_id=? AND moderation_state='visible'")
        .bind(episodeId).first<{ total: number }>(),
      this.db.prepare(`SELECT c.id,c.episode_id,p.name AS author_name,p.avatar AS author_avatar,
        c.body,c.revision,c.created_at,c.updated_at,CASE WHEN c.profile_id=? THEN 1 ELSE 0 END AS viewer_owned
        FROM episode_comments c JOIN profiles p ON p.id=c.profile_id
        WHERE c.episode_id=? AND c.moderation_state='visible'
        ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`)
        .bind(viewer, episodeId, pageSize, offset).all<CloudEpisodeComment>(),
    ]);
    const total = Number(count?.total ?? 0);
    return { items: rows.results.map(publicComment), total, page, pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async comment(id: string, episodeId: number, viewerProfileId?: string) {
    const row = await this.db.prepare(`SELECT c.id,c.episode_id,p.name AS author_name,p.avatar AS author_avatar,
      c.body,c.revision,c.created_at,c.updated_at,CASE WHEN c.profile_id=? THEN 1 ELSE 0 END AS viewer_owned
      FROM episode_comments c JOIN profiles p ON p.id=c.profile_id
      WHERE c.id=? AND c.episode_id=? AND c.moderation_state='visible'`)
      .bind(viewerProfileId ?? '', id, episodeId).first<CloudEpisodeComment>();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Comment not found.');
    return publicComment(row);
  }
  async commentsForProfile(profileId: string, accountId: string) {
    await this.ownedProfile(profileId, accountId);
    return (await this.db.prepare(`SELECT id,CAST(episode_id AS TEXT) AS episodeId,body,revision,
      moderation_state AS moderationState,created_at AS createdAt,updated_at AS updatedAt
      FROM episode_comments WHERE profile_id=? ORDER BY created_at,id`)
      .bind(profileId).all()).results;
  }
  async createComment(s: CloudSession, episodeId: number, profileId: string, body: string, now: number) {
    const id = crypto.randomUUID();
    try {
      const row = await this.db.prepare(`INSERT INTO episode_comments
        (id,episode_id,profile_id,body,revision,created_at,updated_at)
        SELECT ?,?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM profiles WHERE id=? AND account_id=?)
        AND ${sessionGuard} RETURNING id`)
        .bind(id, episodeId, profileId, body, now, now, profileId, s.account_id, ...guardValues(s, now))
        .first<{ id: string }>();
      if (row?.id !== id) {
        if (!(await this.session(s.token_hash, now))) throw unauthenticated();
        await this.ownedProfile(profileId, s.account_id);
        throw unauthenticated();
      }
      return this.comment(id, episodeId, profileId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('COMMENT_LIMIT'))
        throw new AppError(409, 'BAD_REQUEST', 'This profile has reached its community comment limit. Remove an older comment before posting again.');
      throw error;
    }
  }
  async updateComment(s: CloudSession, episodeId: number, id: string, profileId: string, body: string, revision: number, now: number) {
    const changed = await this.db.prepare(`UPDATE episode_comments SET body=?,revision=revision+1,updated_at=?
      WHERE id=? AND episode_id=? AND profile_id=? AND revision=? AND moderation_state='visible'
      AND EXISTS(SELECT 1 FROM profiles WHERE id=? AND account_id=?) AND ${sessionGuard} RETURNING id`)
      .bind(body, now, id, episodeId, profileId, revision, profileId, s.account_id, ...guardValues(s, now))
      .first<{ id: string }>();
    if (changed?.id !== id) {
      if (!(await this.session(s.token_hash, now))) throw unauthenticated();
      await this.ownedProfile(profileId, s.account_id);
      const existing = await this.db.prepare(`SELECT revision FROM episode_comments
        WHERE id=? AND episode_id=? AND profile_id=? AND moderation_state='visible'`)
        .bind(id, episodeId, profileId).first<{ revision: number }>();
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Comment not found.');
      throw commentConflict();
    }
    return this.comment(id, episodeId, profileId);
  }
  async deleteComment(s: CloudSession, episodeId: number, id: string, profileId: string, revision: number, now: number) {
    const removed = await this.db.prepare(`DELETE FROM episode_comments
      WHERE id=? AND episode_id=? AND profile_id=? AND revision=?
      AND EXISTS(SELECT 1 FROM profiles WHERE id=? AND account_id=?) AND ${sessionGuard} RETURNING id`)
      .bind(id, episodeId, profileId, revision, profileId, s.account_id, ...guardValues(s, now))
      .first<{ id: string }>();
    if (removed?.id !== id) {
      if (!(await this.session(s.token_hash, now))) throw unauthenticated();
      await this.ownedProfile(profileId, s.account_id);
      const existing = await this.db.prepare('SELECT revision FROM episode_comments WHERE id=? AND episode_id=? AND profile_id=?')
        .bind(id, episodeId, profileId).first<{ revision: number }>();
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Comment not found.');
      throw commentConflict();
    }
  }
  async rotateRecovery(s: CloudSession, hash: string, now: number) {
    const result = await this.db.prepare(`UPDATE accounts SET recovery_hash=? WHERE id=? AND ${sessionGuard}`)
      .bind(hash, s.account_id, ...guardValues(s, now)).run();
    if (result.meta.changes !== 1) throw unauthenticated();
  }
  /** An upstream security mutation has durable ownership before any remote write is attempted. */
  async startOperation(a: CloudAccount, state: 'recovering' | 'password-changing' | 'deleting', now: number, s?: CloudSession) {
    const id = crypto.randomUUID();
    const check = s ? ` AND ${sessionGuard}` : ' AND recovery_hash=?';
    const result = await this.db.batch([
      this.db.prepare(`UPDATE accounts SET auth_state=?,operation_id=?,operation_started_at=?,operation_error=NULL,auth_revision=auth_revision+1
        WHERE id=? AND auth_revision=? AND auth_state='active'${check}`)
        .bind(state, id, now, a.id, a.auth_revision, ...(s ? guardValues(s, now) : [a.recovery_hash])),
      this.db.prepare(`DELETE FROM sessions WHERE account_id=?
        AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND operation_id=?)`).bind(a.id, a.id, id),
    ]);
    if (result[0].meta.changes !== 1)
      throw new AppError(409, 'UNAUTHORIZED', 'The account changed. Reload before trying again.', { reason: 'AUTH_OPERATION_CONFLICT' });
    return id;
  }
  async finishOperation(accountId: string, operationId: string, recoveryHash?: string) {
    const result = await this.db.prepare(`UPDATE accounts SET auth_state='active',recovery_hash=COALESCE(?,recovery_hash),
      operation_id=NULL,operation_started_at=NULL,operation_error=NULL WHERE id=? AND operation_id=?`)
      .bind(recoveryHash ?? null, accountId, operationId).run();
    if (result.meta.changes !== 1) throw new AppError(409, 'UNAVAILABLE', 'The account security operation needs reconciliation.', { reason: 'AUTH_OPERATION_PENDING' });
  }
  async markOperationUncertain(accountId: string, operationId: string) {
    await this.db.prepare('UPDATE accounts SET operation_error=? WHERE id=? AND operation_id=?')
      .bind('UPSTREAM_OUTCOME_UNCERTAIN', accountId, operationId).run();
  }
  async deleteAccount(accountId: string, operationId: string) {
    const result = await this.db.prepare('DELETE FROM accounts WHERE id=? AND operation_id=? AND auth_state=\'deleting\' RETURNING id')
      .bind(accountId, operationId).first<{ id: string }>();
    if (result?.id !== accountId) throw new AppError(409, 'UNAVAILABLE', 'Account deletion needs reconciliation.', { reason: 'AUTH_OPERATION_PENDING' });
  }
}

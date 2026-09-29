import { AppError } from '../errors.ts';
import type { AccountDatabase } from '../cloud/auth/types.ts';
import { decodeBytes, digest, encodeBytes, randomToken, validCredentialKey } from '../cloud/auth/crypto.ts';
import { MalClient, type MalConfig, type MalTokens } from './myanimelist.ts';
import type { MalEntry, MalStatus } from '../../shared/myanimelist.ts';

type Connection = { profile_id: string; username: string | null; credential_cipher: string | null;
  committed_generation: string | null; imported_at: number | null; sync_generation: string | null; sync_offset: number };
export type MalServiceConfig = Partial<MalConfig> & { credentialKey?: string };
const encoder = new TextEncoder();
async function vault(secret: string, context: string, value: unknown, decrypt = false) {
  const key = await crypto.subtle.importKey('raw', decodeBytes(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const aad = encoder.encode('solanime-mal:v1:' + context);
  if (!decrypt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, encoder.encode(JSON.stringify(value)));
    return `${encodeBytes(iv)}.${encodeBytes(new Uint8Array(bytes))}`;
  }
  try {
    const [iv, cipher] = String(value).split('.');
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBytes(iv), additionalData: aad }, key, decodeBytes(cipher));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new AppError(409, 'UNAVAILABLE', 'Reconnect MyAnimeList. Its saved connection could not be restored.'); }
}

/** Both transports authorize profile ownership and CSRF before calling this service. */
export function malService(db: AccountDatabase, config: MalServiceConfig, fetcher = fetch, now = Date.now) {
  const configured = !!config.clientId && !!config.redirectUri && validCredentialKey(config.credentialKey);
  const client = () => {
    if (!configured) throw new AppError(503, 'UNAVAILABLE', 'MyAnimeList connection awaits the operator’s registered API application.');
    return new MalClient(config as MalConfig, fetcher, now);
  };
  const read = (profile: string) => db.prepare('SELECT * FROM mal_connections WHERE profile_id=?').bind(profile).first<Connection>();
  return async (profile: string, account: string, action: string, input: Record<string, unknown>, assertActive: () => Promise<void>) => {
    const connection = await read(profile);
    if (action === 'status') {
      const count = connection?.committed_generation ? await db.prepare('SELECT count(*) AS count FROM mal_list_items WHERE profile_id=? AND generation=?')
        .bind(profile, connection.committed_generation).first<{ count: number }>() : null;
      return { configured, connected: !!connection?.credential_cipher, username: connection?.username,
        importedAt: connection?.imported_at, syncing: !!connection?.sync_generation, count: count?.count ?? 0 };
    }
    if (action === 'list') {
      const page = input.page == null ? 1 : Number(input.page);
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AppError(400, 'BAD_REQUEST', 'Invalid list page.');
      if (!connection?.committed_generation) return { items: [], page, hasMore: false };
      const rows = await db.prepare('SELECT value FROM mal_list_items WHERE profile_id=? AND generation=? ORDER BY mal_id LIMIT 101 OFFSET ?')
        .bind(profile, connection.committed_generation, (page - 1) * 100).all<{ value: string }>();
      return { items: rows.results.slice(0, 100).map(row => JSON.parse(row.value) as MalEntry), page, hasMore: rows.results.length > 100 };
    }
    // Disconnect must remain possible after an operator disables the integration.
    const upstream = action === 'disconnect' ? null : client();
    await assertActive();
    await db.prepare('INSERT OR IGNORE INTO mal_connections(profile_id) VALUES(?)').bind(profile).run();
    const lease = randomToken();
    const acquired = await db.prepare('UPDATE mal_connections SET lease_token=?,lease_until=? WHERE profile_id=? AND lease_until<=?')
      .bind(lease, now() + 90000, profile, now()).run();
    if (acquired.meta.changes !== 1) throw new AppError(409, 'BAD_REQUEST', 'A MyAnimeList operation is already running. Try again shortly.');
    const context = `${account}:${profile}`;
    const assertLease = async () => {
      await assertActive();
      const renewed = await db.prepare('UPDATE mal_connections SET lease_until=? WHERE profile_id=? AND lease_token=? AND lease_until>?')
        .bind(now() + 90000, profile, lease, now()).run();
      if (renewed.meta.changes !== 1) throw new AppError(409, 'BAD_REQUEST', 'The MyAnimeList operation timed out. Retry to resume safely.');
    };
    try {
      if (action === 'connect') {
        const state = randomToken(), verifier = randomToken() + randomToken();
        await db.prepare('DELETE FROM mal_oauth_states WHERE expires_at<? OR profile_id=?').bind(now(), profile).run();
        await db.prepare('INSERT INTO mal_oauth_states(state_hash,profile_id,account_id,verifier_cipher,expires_at) VALUES(?,?,?,?,?)')
          .bind(await digest(state), profile, account, await vault(config.credentialKey!, context, verifier), now() + 600000).run();
        return { url: upstream!.authorizationUrl(state, verifier) };
      }
      if (action === 'complete') {
        if (typeof input.state !== 'string' || !/^[\w-]{43}$/.test(input.state) || typeof input.code !== 'string' || !input.code || input.code.length > 8000)
          throw new AppError(400, 'BAD_REQUEST', 'MyAnimeList authorization response is incomplete. Start the connection again.');
        const state = await db.prepare('DELETE FROM mal_oauth_states WHERE state_hash=? AND profile_id=? AND account_id=? AND expires_at>? RETURNING verifier_cipher')
          .bind(await digest(input.state), profile, account, now()).first<{ verifier_cipher: string }>();
        if (!state) throw new AppError(400, 'BAD_REQUEST', 'MyAnimeList authorization expired or belongs to another profile. Start again.');
        const verifier = await vault(config.credentialKey!, context, state.verifier_cipher, true);
        const tokens = await upstream!.exchange(input.code, verifier);
        const identity = await upstream!.identity(tokens.accessToken);
        await assertLease();
        await db.batch([
          db.prepare('UPDATE mal_connections SET username=?,credential_cipher=?,committed_generation=NULL,imported_at=NULL,sync_generation=NULL,sync_offset=0 WHERE profile_id=? AND lease_token=?')
            .bind(identity.name, await vault(config.credentialKey!, context, tokens), profile, lease),
          db.prepare('DELETE FROM mal_list_items WHERE profile_id=?').bind(profile),
        ]);
        return { connected: true, username: identity.name };
      }
      if (action === 'disconnect') {
        await assertLease();
        await db.batch([
          db.prepare('DELETE FROM mal_oauth_states WHERE profile_id=?').bind(profile),
          db.prepare('DELETE FROM mal_list_items WHERE profile_id=?').bind(profile),
          db.prepare('DELETE FROM mal_connections WHERE profile_id=?').bind(profile),
        ]);
        return { disconnected: true };
      }
      const current = await read(profile);
      if (!current?.credential_cipher) throw new AppError(409, 'BAD_REQUEST', 'Connect MyAnimeList first.');
      let tokens = await vault(config.credentialKey!, context, current.credential_cipher, true) as MalTokens;
      if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || !Number.isFinite(tokens.expiresAt))
        throw new AppError(409, 'UNAVAILABLE', 'Reconnect MyAnimeList. Its saved credentials are incomplete.');
      if (tokens.expiresAt <= now() + 60000) {
        tokens = await upstream!.refresh(tokens.refreshToken);
        await assertLease();
        await db.prepare('UPDATE mal_connections SET credential_cipher=? WHERE profile_id=? AND lease_token=?')
          .bind(await vault(config.credentialKey!, context, tokens), profile, lease).run();
      }
      if (action === 'sync') {
        const generation = current.sync_generation ?? randomToken();
        const offset = current.sync_generation ? current.sync_offset : 0;
        const result = await upstream!.list(tokens.accessToken, offset);
        await assertLease();
        // Save the generation before its first batch. A partial write retries the
        // same page idempotently instead of creating abandoned generations.
        await db.prepare('UPDATE mal_connections SET sync_generation=?,sync_offset=? WHERE profile_id=? AND lease_token=?')
          .bind(generation, offset, profile, lease).run();
        const statements = result.items.map(item => db.prepare('INSERT INTO mal_list_items(profile_id,generation,mal_id,value) VALUES(?,?,?,?) ON CONFLICT(profile_id,generation,mal_id) DO UPDATE SET value=excluded.value')
          .bind(profile, generation, item.id, JSON.stringify(item)));
        // D1 batches are bounded; checkpoint advances only after every chunk succeeds.
        for (let start = 0; start < statements.length; start += 50) {
          await assertLease();
          await db.batch(statements.slice(start, start + 50));
        }
        await assertLease();
        if (result.nextOffset !== null) {
          await db.prepare('UPDATE mal_connections SET sync_generation=?,sync_offset=? WHERE profile_id=? AND lease_token=?')
            .bind(generation, result.nextOffset, profile, lease).run();
          return { complete: false, nextOffset: result.nextOffset, imported: result.items.length };
        }
        await db.batch([
          db.prepare('UPDATE mal_connections SET committed_generation=?,imported_at=?,sync_generation=NULL,sync_offset=0 WHERE profile_id=? AND lease_token=?')
            .bind(generation, now(), profile, lease),
          db.prepare('DELETE FROM mal_list_items WHERE profile_id=? AND generation<>?').bind(profile, generation),
        ]);
        return { complete: true, imported: result.items.length };
      }
      if (action === 'update') {
        if (current.sync_generation) throw new AppError(409, 'BAD_REQUEST', 'Finish or resume the current import before editing MyAnimeList entries.');
        // User edits an explicitly imported MAL id; never infer MAL identity from a title string.
        if (!Number.isSafeInteger(input.id)) throw new AppError(400, 'BAD_REQUEST', 'Invalid anime identifier.');
        const row = await db.prepare('SELECT value FROM mal_list_items WHERE profile_id=? AND generation=? AND mal_id=?')
          .bind(profile, current.committed_generation, input.id).first<{ value: string }>();
        if (!row) throw new AppError(404, 'NOT_FOUND', 'Import this MyAnimeList entry before updating it.');
        const result = await upstream!.update(tokens.accessToken, Number(input.id), input.status as MalStatus, Number(input.watchedEpisodes));
        await assertLease();
        const item = { ...JSON.parse(row.value), ...result, updatedAt: new Date(now()).toISOString() };
        await db.prepare('UPDATE mal_list_items SET value=? WHERE profile_id=? AND generation=? AND mal_id=?')
          .bind(JSON.stringify(item), profile, current.committed_generation, input.id).run();
        return { item };
      }
      throw new AppError(404, 'NOT_FOUND', 'MyAnimeList action not found.');
    } finally {
      await db.prepare('UPDATE mal_connections SET lease_token=NULL,lease_until=0 WHERE profile_id=? AND lease_token=?').bind(profile, lease).run();
    }
  };
}

import { AppError } from '../errors.ts';
import type { AccountDatabase } from '../cloud/auth/types.ts';
import { randomToken } from '../cloud/auth/crypto.ts';
import { MalPublicClient, MAL_USERNAME, validEntry } from './myanimelist.ts';
import type { MalEntry } from '../../shared/myanimelist.ts';

type Connection = { profile_id: string; username: string | null; committed_generation: string | null; imported_at: number | null };
export type MalServiceConfig = { clientId?: string };
const MAX_ENTRIES = 20_000;
const MAX_PAGES = 20;

/**
 * Profile-scoped MyAnimeList list import without a MyAnimeList login: either a public
 * list read by username (operator client ID, read only) or the member's own export
 * file. Nothing is ever written to MyAnimeList and no MyAnimeList credential is stored.
 * Both transports authorize session, CSRF and profile ownership before calling this.
 */
export function malService(db: AccountDatabase, config: MalServiceConfig, fetcher = fetch, now = Date.now) {
  const usernameImport = !!config.clientId;
  const read = (profile: string) => db.prepare('SELECT profile_id,username,committed_generation,imported_at FROM mal_connections WHERE profile_id=?').bind(profile).first<Connection>();
  return async (profile: string, _account: string, action: string, input: Record<string, unknown>, assertActive: () => Promise<void>) => {
    const connection = await read(profile);
    if (action === 'status') {
      const count = connection?.committed_generation ? await db.prepare('SELECT count(*) AS count FROM mal_list_items WHERE profile_id=? AND generation=?')
        .bind(profile, connection.committed_generation).first<{ count: number }>() : null;
      return { configured: true, usernameImport, connected: !!connection?.committed_generation, username: connection?.username ?? null,
        importedAt: connection?.imported_at ?? null, count: count?.count ?? 0 };
    }
    if (action === 'list') {
      const page = input.page == null ? 1 : Number(input.page);
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new AppError(400, 'BAD_REQUEST', 'Invalid list page.');
      if (!connection?.committed_generation) return { items: [], page, hasMore: false };
      const rows = await db.prepare('SELECT value FROM mal_list_items WHERE profile_id=? AND generation=? ORDER BY mal_id LIMIT 101 OFFSET ?')
        .bind(profile, connection.committed_generation, (page - 1) * 100).all<{ value: string }>();
      return { items: rows.results.slice(0, 100).map(row => JSON.parse(row.value) as MalEntry), page, hasMore: rows.results.length > 100 };
    }
    await assertActive();
    await db.prepare('INSERT OR IGNORE INTO mal_connections(profile_id) VALUES(?)').bind(profile).run();
    const lease = randomToken();
    const acquired = await db.prepare('UPDATE mal_connections SET lease_token=?,lease_until=? WHERE profile_id=? AND lease_until<=?')
      .bind(lease, now() + 120000, profile, now()).run();
    if (acquired.meta.changes !== 1) throw new AppError(409, 'BAD_REQUEST', 'A MyAnimeList import is already running. Try again shortly.');
    const assertLease = async () => {
      await assertActive();
      const renewed = await db.prepare('UPDATE mal_connections SET lease_until=? WHERE profile_id=? AND lease_token=? AND lease_until>?')
        .bind(now() + 120000, profile, lease, now()).run();
      if (renewed.meta.changes !== 1) throw new AppError(409, 'BAD_REQUEST', 'The MyAnimeList import timed out. Try again.');
    };
    /** Writes a complete new generation, then switches to it. A failed import never empties the previous list. */
    const commit = async (items: MalEntry[], username: string | null) => {
      const unique = [...new Map(items.map(item => [item.id, item])).values()];
      const generation = randomToken();
      const statements = unique.map(item => db.prepare('INSERT INTO mal_list_items(profile_id,generation,mal_id,value) VALUES(?,?,?,?)')
        .bind(profile, generation, item.id, JSON.stringify(item)));
      try {
        for (let start = 0; start < statements.length; start += 50) {
          await assertLease();
          await db.batch(statements.slice(start, start + 50));
        }
        await assertLease();
        // Old OAuth credentials from earlier releases are discarded on the first new import.
        await db.batch([
          db.prepare('UPDATE mal_connections SET username=?,credential_cipher=NULL,committed_generation=?,imported_at=?,sync_generation=NULL,sync_offset=0 WHERE profile_id=? AND lease_token=?')
            .bind(username, generation, now(), profile, lease),
          db.prepare('DELETE FROM mal_list_items WHERE profile_id=? AND generation<>?').bind(profile, generation),
        ]);
      } catch (error) {
        await db.prepare('DELETE FROM mal_list_items WHERE profile_id=? AND generation=?').bind(profile, generation).run().catch(() => {});
        throw error;
      }
      return { imported: unique.length, username };
    };
    try {
      if (action === 'import-username') {
        if (!usernameImport) throw new AppError(503, 'UNAVAILABLE', 'Username import isn’t set up on this deployment. Import your MyAnimeList export file instead.');
        const username = typeof input.username === 'string' ? input.username.trim() : '';
        if (!MAL_USERNAME.test(username)) throw new AppError(400, 'BAD_REQUEST', 'Enter a MyAnimeList username (2–16 letters, numbers, - or _).');
        const client = new MalPublicClient(config.clientId!, fetcher);
        const items: MalEntry[] = [];
        let offset: number | null = 0;
        for (let page = 0; offset !== null; page++) {
          if (page >= MAX_PAGES) throw new AppError(413, 'BAD_REQUEST', 'This list is larger than Solanime can import at once.');
          const result = await client.list(username, offset);
          items.push(...result.items);
          offset = result.nextOffset;
          await assertLease();
        }
        return await commit(items, username);
      }
      if (action === 'import-file') {
        if (!Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES)
          throw new AppError(400, 'BAD_REQUEST', `Import a MyAnimeList export with up to ${MAX_ENTRIES.toLocaleString()} anime.`);
        const items = input.entries.map(entry => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new AppError(400, 'BAD_REQUEST', 'This export file could not be read.');
          return validEntry(entry as Record<string, unknown>);
        });
        const username = typeof input.username === 'string' && MAL_USERNAME.test(input.username) ? input.username : null;
        return await commit(items, username);
      }
      if (action === 'remove') {
        await assertLease();
        await db.batch([
          db.prepare('DELETE FROM mal_oauth_states WHERE profile_id=?').bind(profile),
          db.prepare('DELETE FROM mal_list_items WHERE profile_id=?').bind(profile),
          db.prepare('DELETE FROM mal_connections WHERE profile_id=?').bind(profile),
        ]);
        return { removed: true };
      }
      throw new AppError(404, 'NOT_FOUND', 'MyAnimeList action not found.');
    } finally {
      await db.prepare('UPDATE mal_connections SET lease_token=NULL,lease_until=0 WHERE profile_id=? AND lease_token=?').bind(profile, lease).run();
    }
  };
}

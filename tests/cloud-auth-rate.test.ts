import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { D1AccountsRepository } from '../server/cloud/auth/repository';

// Capacity fixtures exist only in an isolated D1 runtime, with no identities or network access.
let runtime: Miniflare;
let db: D1Database;
let repository: D1AccountsRepository;
const now = 1800000000000;

beforeAll(async () => {
  const directory = fileURLToPath(new URL('../.cache/cloud-auth-rate/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true,
    script: 'export default { fetch() { return new Response("test-only rate capacity") } }',
    compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], d1Databases: { ACCOUNTS: 'test-rate-private-accounts' },
  }), resourceTmpPath: mkdtempSync(directory + 'runtime-') });
  db = await runtime.getD1Database('ACCOUNTS');
  const migration = readFileSync(new URL('../migrations/cloud/accounts/0001_accounts.sql', import.meta.url), 'utf8');
  await db.batch(migration.split(/;\s*\n(?=(?:CREATE|INSERT))/).filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  repository = new D1AccountsRepository(db);
}, 30000);
afterEach(async () => { await db.prepare('DELETE FROM account_rate_limits').run(); });
afterAll(async () => { await runtime?.dispose(); });

async function fill(expired: number) {
  await db.prepare(`WITH RECURSIVE sequence(value) AS
    (SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value<10000)
    INSERT INTO account_rate_limits(key,count,expires_at)
    SELECT 'bucket-'||value,4,CASE WHEN value<=? THEN ? ELSE ? END FROM sequence`)
    .bind(expired, now - 1, now + 60000).run();
}
async function counts() {
  return db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN expires_at<=? THEN 1 ELSE 0 END) AS expired,
    SUM(CASE WHEN expires_at>? AND key LIKE 'bucket-%' AND count=4 THEN 1 ELSE 0 END) AS unchangedActive
    FROM account_rate_limits`).bind(now, now).first<{ total: number; expired: number; unchangedActive: number }>();
}

describe('bounded expired account-rate reclamation in actual D1', () => {
  it('reclaims at most 100 expired buckets on a cap miss and preserves every active bucket', async () => {
    await fill(112);
    await expect(repository.rate('new-key', 2, 60000, now)).resolves.toBeUndefined();
    expect(await counts()).toEqual({ total: 9901, expired: 12, unchangedActive: 9888 });
    expect(await db.prepare("SELECT count,expires_at FROM account_rate_limits WHERE key='new-key'").first())
      .toEqual({ count: 1, expires_at: now + 60000 });
  });

  it('makes room by dropping the soonest-expiring buckets when every bucket is still active', async () => {
    await fill(0);
    await db.prepare("UPDATE account_rate_limits SET expires_at=? WHERE key='bucket-9999'").bind(now + 1000).run();
    // A flood of live buckets must not lock every visitor out of sign-in.
    await expect(repository.rate('new-key', 2, 60000, now)).resolves.toBeUndefined();
    expect(await counts()).toEqual({ total: 9901, expired: 0, unchangedActive: 9900 });
    expect(await db.prepare("SELECT 1 FROM account_rate_limits WHERE key='bucket-9999'").first()).toBeNull();
    await expect(repository.rate('bucket-500', 5, 60000, now)).resolves.toBeUndefined();
    await expect(repository.rate('bucket-500', 5, 60000, now)).rejects.toMatchObject({ status: 429, details: { retryAfterSeconds: 60 } });
    expect((await counts())?.total).toBe(9901);
  });

  it('never grows past the cap when concurrent new keys compete for one expired slot', async () => {
    await fill(1);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => repository.rate(`candidate-${index}`, 2, 60000, now)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(6);
    expect((await counts())?.total).toBeLessThanOrEqual(10000);
  });

  it('keeps the per-key attempt limit atomic while a full table is reclaimed concurrently', async () => {
    await fill(1);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => repository.rate('shared-candidate', 2, 60000, now)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter(result => result.status === 'rejected').every(result => result.reason.status === 429)).toBe(true);
    expect(await counts()).toEqual({ total: 10000, expired: 0, unchangedActive: 9999 });
    expect((await db.prepare("SELECT count FROM account_rate_limits WHERE key='shared-candidate'").first())?.count).toBe(6);
  });
});

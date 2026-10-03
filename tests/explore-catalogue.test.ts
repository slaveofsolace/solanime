import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sqliteExploreCatalogue } from '../server/explore/catalogue';
import { exploreService } from '../server/explore/service';
import { DEFAULT_EXPLORE_FILTERS, eligibleTitles, franchiseKey, isSequelLike } from '../shared/explore';
import { accountsFixture } from './explore-fixtures';

const path = fileURLToPath(new URL('../data/solanime.sqlite', import.meta.url));
/** CI checks out Git LFS pointers, not the database: only run against a real SQLite file. */
function isSqlite(file: string) {
  if (!existsSync(file)) return false;
  const header = Buffer.alloc(16), fd = openSync(file, 'r');
  try { readSync(fd, header, 0, 16, 0); } finally { closeSync(fd); }
  return header.toString('latin1') === 'SQLite format 3\u0000';
}

/** Uses the committed catalogue snapshot read-only. It is local catalogue evidence, not a live deployment check. */
describe.runIf(isSqlite(path))('Explore on the committed catalogue snapshot', () => {
  it('builds features, entry points and a first deck within budget', async () => {
    const db = new DatabaseSync(`file:${path}?immutable=1`, { readOnly: true } as never);
    const catalogue = sqliteExploreCatalogue(db as never);
    const began = performance.now();
    const index = await catalogue.features();
    const featureMs = performance.now() - began;
    expect(index.items.length).toBeGreaterThan(5000);
    expect(index.genreLabels.size).toBeGreaterThan(20);
    const none = { malStatus: new Map(), history: new Set<string>(), inProgress: new Set<string>(), watchlist: new Set<string>(), seen: new Set<string>(), recentlyResolved: new Set<string>(), rejected: new Set<string>() };
    const { eligible, counts } = eligibleTitles(index.items, DEFAULT_EXPLORE_FILTERS, null, none);
    expect(eligible.some(isSequelLike)).toBe(false);
    expect(new Set(eligible.map(item => franchiseKey(item.name))).size).toBe(eligible.length);

    const accounts = accountsFixture();
    const service = exploreService(accounts.db, catalogue);
    const first = performance.now();
    const started = await service('p', 'start', { size: 20, filters: { genres: ['mystery', 'psychological'] } }, async () => {}) as { session: { id: string; cards: Array<{ titleId: string; name: string; artworkUrl: string | null }> } };
    const firstCardMs = performance.now() - first;
    expect(started.session.cards).toHaveLength(2);
    const resultsAt = performance.now();
    const results = await service('p', 'results', { sessionId: started.session.id }, async () => {}) as { session: { results: { recommended: unknown[] } } };
    const resultsMs = performance.now() - resultsAt;
    expect(results.session.results.recommended.length).toBe(10);
    console.info(JSON.stringify({ catalogueTitles: index.items.length, ...counts, featureMs: Math.round(featureMs), firstCardMs: Math.round(firstCardMs), resultsMs: Math.round(resultsMs) }));
    accounts.raw.close(); db.close();
  }, 60_000);
});

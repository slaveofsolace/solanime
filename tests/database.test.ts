import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../server/db.ts';
import { importSnapshot, markMissingEpisodeInventoryStale, markMissingProviderMappingsStale, markMissingTitlesStale } from '../server/ingestion/snapshot.ts';
import { createRun } from '../server/ingestion/queue.ts';
import { adminStatus, browseTitles, getFilters, getTitle } from '../server/catalogue.ts';

const observedAt = '2026-09-10T00:00:00.000Z';
const input = {
  schemaVersion: 1,
  source: 'anikoto',
  observedAt,
  titles: [{
    sourceId: 't-1', slug: 'fixture-title', canonicalUrl: 'https://anikototv.to/watch/fixture-title', name: 'Fixture Title', description: 'Keep this verified description.', genres: ['Action'], episodes: [{
      sourceId: 'e-1', number: '1', slug: 'ep-1', canonicalUrl: 'https://anikototv.to/watch/fixture-title/ep-1', versions: [{ sourceId: 'e-1:sub', language: 'sub', providers: [{ sourceMappingId: 'map-1', providerId: 'hd-1', providerResourceId: 'YWJjZA==' }] }],
    }],
  }],
} as const;

describe('persistent catalogue import', () => {
  it('upserts idempotently and powers browse/detail queries', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, input);
      importSnapshot(db, input);
      expect(adminStatus(db).counts).toMatchObject({ titles: 1, episodes: 1, versions: 1, mappings: 1 });
      expect(browseTitles(db, { page: 1, pageSize: 10, sort: 'name', q: 'Fixture' }).total).toBe(1);
      expect(getTitle(db, 'fixture-title').episodes).toHaveLength(1);
    } finally { db.close(); }
  });

  it('does not delete good episode data when a later snapshot is sparse', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, input);
      importSnapshot(db, { ...input, observedAt: '2026-09-11T00:00:00.000Z', titles: [{ ...input.titles[0], description: null, episodes: [] }] });
      expect(adminStatus(db).counts).toMatchObject({ titles: 1, episodes: 1, versions: 1, mappings: 1 });
      expect(getTitle(db, 'fixture-title').title.description).toBe('Keep this verified description.');
    } finally { db.close(); }
  });

  it('collapses case-only source format variants in browse facets', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, { ...input, titles: [{ ...input.titles[0], format: 'Movie' }] });
      importSnapshot(db, { ...input, titles: [{ ...input.titles[0], sourceId: 't-2', slug: 'fixture-title-2', canonicalUrl: 'https://anikototv.to/watch/fixture-title-2', format: 'MOVIE' }] });
      expect(getFilters(db).types).toContainEqual({ value: 'movie', label: 'Movie', count: 2 });
    } finally { db.close(); }
  });

  it('marks absent episode and provider relationships stale only after a complete observation', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, input);
      const nextObservedAt = '2026-09-11T00:00:00.000Z';
      importSnapshot(db, { ...input, observedAt: nextObservedAt, titles: [{ ...input.titles[0], episodes: [{ ...input.titles[0].episodes[0], versions: [{ ...input.titles[0].episodes[0].versions[0], providers: [] }] }] }] });
      expect(markMissingProviderMappingsStale(db, 't-1', 'e-1', nextObservedAt)).toBe(1);
      expect((db.prepare('SELECT availability_state FROM episode_provider_mappings').get() as { availability_state: string }).availability_state).toBe('stale');
      importSnapshot(db, { ...input, observedAt: '2026-09-12T00:00:00.000Z', titles: [{ ...input.titles[0], episodes: [] }] });
      expect(markMissingEpisodeInventoryStale(db, 't-1', '2026-09-12T00:00:00.000Z')).toEqual({ episodes: 1, versions: 1, mappings: 1 });
    } finally { db.close(); }
  });

  it('rejects an unsupported snapshot schema before mutating stored rows', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      expect(() => importSnapshot(db, { ...input, schemaVersion: 99 })).toThrow(/schemaVersion/i);
      expect((adminStatus(db).counts as { titles: number }).titles).toBe(0);
    } finally { db.close(); }
  });

  it('soft-stales a title absent from a later complete discovery run', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, input);
      const runId = createRun(db, 'incremental');
      db.prepare("UPDATE crawl_runs SET started_at='2026-09-11T00:00:00.000Z' WHERE id=?").run(runId);
      expect(markMissingTitlesStale(db, runId)).toBe(1);
      expect((db.prepare('SELECT availability_state FROM titles').get() as { availability_state: string }).availability_state).toBe('stale');
    } finally { db.close(); }
  });

  it('updates a canonical route by stable source identifier without duplicating the title', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, input);
      importSnapshot(db, { ...input, observedAt: '2026-09-11T00:00:00.000Z', titles: [{ ...input.titles[0], slug: 'api-renamed-route', canonicalUrl: 'https://anikototv.to/watch/api-renamed-route' }] });
      expect((adminStatus(db).counts as { titles: number }).titles).toBe(1);
      expect((getTitle(db, 'api-renamed-route').title as { sourceId: string }).sourceId).toBe('t-1');
    } finally { db.close(); }
  });

  it('updates provider evidence without falsely refreshing ancestor metadata', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, input);
      importSnapshot(db, { ...input, observedAt: '2026-09-11T00:00:00.000Z' }, undefined, false, false);
      expect((db.prepare('SELECT last_seen_at FROM titles').get() as { last_seen_at: string }).last_seen_at).toBe(observedAt);
      expect((db.prepare('SELECT last_seen_at FROM episode_provider_mappings').get() as { last_seen_at: string }).last_seen_at).toBe('2026-09-11T00:00:00.000Z');
    } finally { db.close(); }
  });

  it('links related records once their target title enters the catalogue', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, { ...input, titles: [{ ...input.titles[0], related: [{ sourceId: 't-2', relationshipType: 'recommended', label: 'Related title' }] }] });
      importSnapshot(db, { ...input, titles: [{ ...input.titles[0], sourceId: 't-2', slug: 'related-title', canonicalUrl: 'https://anikototv.to/watch/related-title', name: 'Related Title' }] });
      expect((db.prepare('SELECT related_title_id AS relatedTitleId FROM related_titles').get() as { relatedTitleId: number | null }).relatedTitleId).not.toBeNull();
      expect(getTitle(db, 'fixture-title').related).toContainEqual(expect.objectContaining({ sourceId: 't-2', slug: 'related-title', name: 'Related Title' }));
    } finally { db.close(); }
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import type { CatalogueSnapshot, SnapshotTitle } from '../server/types.ts';

const observedAt = '2026-09-12T12:00:00.000Z';
let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
});

afterEach(() => db.close());

function title(sourceId: string, slug: string, related: SnapshotTitle['related'] = []): SnapshotTitle {
  return {
    sourceId,
    slug,
    canonicalUrl: `https://anikototv.to/watch/${slug}`,
    name: `Anikoto ${sourceId}`,
    related,
    episodes: [],
  };
}

function snapshot(...titles: SnapshotTitle[]): CatalogueSnapshot {
  return { schemaVersion: 1, source: 'anikoto', observedAt, titles };
}

function otherTitle(sourceId: string, slug: string): number {
  return Number(db.prepare(`
    INSERT INTO titles(source,source_id,slug,canonical_url,name,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES ('other-test-source',?,?,?,?,?,?,?,?)
  `).run(sourceId, slug, `https://example.test/title/${slug}`, `Other ${sourceId}`, observedAt, observedAt, observedAt, observedAt).lastInsertRowid);
}

function titleId(source: string, sourceId: string): number {
  return Number((db.prepare('SELECT id FROM titles WHERE source=? AND source_id=?').get(source, sourceId) as { id: number }).id);
}

function relation(ownerId: number, sourceId: string) {
  return db.prepare('SELECT * FROM related_titles WHERE title_id=? AND related_source_id=?').get(ownerId, sourceId) as { related_title_id: number | null } | undefined;
}

function otherRows() {
  return {
    titles: db.prepare("SELECT * FROM titles WHERE source='other-test-source' ORDER BY id").all(),
    relations: db.prepare("SELECT r.* FROM related_titles r JOIN titles t ON t.id=r.title_id WHERE t.source='other-test-source' ORDER BY r.title_id,r.relationship_type,r.related_source_id").all(),
  };
}

describe('snapshot related-title source isolation', () => {
  it('resolves pending inbound links only for the importing source, including repeated imports', () => {
    const otherOwner = otherTitle('7', 'shared-owner');
    const otherTarget = otherTitle('42', 'shared-target');
    db.prepare(`
      INSERT INTO related_titles(title_id,related_title_id,related_source_id,relationship_type,label,first_seen_at,last_seen_at)
      VALUES (?,NULL,'42','sequel','Pending other-source relationship',?,?),
             (?,?,'42','recommended','Existing other-source relationship',?,?)
    `).run(otherOwner, observedAt, observedAt, otherOwner, otherTarget, observedAt, observedAt);
    const before = otherRows();

    importSnapshot(db, snapshot(title('7', 'shared-owner', [{ sourceId: '42', relationshipType: 'sequel' }])));
    const ownerId = titleId('anikoto', '7');
    expect(relation(ownerId, '42')?.related_title_id).toBeNull();

    const target = snapshot(title('42', 'shared-target'));
    importSnapshot(db, target);
    importSnapshot(db, target);

    expect(relation(ownerId, '42')?.related_title_id).toBe(titleId('anikoto', '42'));
    expect(otherRows()).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('does not resolve an outbound relationship to an existing different-source title with the same ID and slug', () => {
    otherTitle('42', 'shared-target');
    const before = otherRows();

    const owner = snapshot(title('7', 'shared-owner', [{ sourceId: '42', relationshipType: 'sequel' }]));
    importSnapshot(db, owner);
    importSnapshot(db, owner);

    expect(relation(titleId('anikoto', '7'), '42')?.related_title_id).toBeNull();
    expect(otherRows()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS count FROM titles WHERE source='anikoto' AND source_id='42'").get()).toMatchObject({ count: 0 });
  });

  it('selects the same-source outbound target even when a colliding source was inserted first', () => {
    const otherOwner = otherTitle('7', 'shared-owner');
    const otherTarget = otherTitle('42', 'shared-target');
    const before = otherRows();

    importSnapshot(db, snapshot(
      title('42', 'shared-target'),
      title('7', 'shared-owner', [{ sourceId: '42', relationshipType: 'sequel' }]),
    ));
    const ownerId = titleId('anikoto', '7');
    const targetId = titleId('anikoto', '42');
    expect(ownerId).not.toBe(otherOwner);
    expect(targetId).not.toBe(otherTarget);
    expect(relation(ownerId, '42')?.related_title_id).toBe(targetId);
    expect(otherRows()).toEqual(before);

    importSnapshot(db, snapshot(title('7', 'shared-owner', [{ sourceId: '42', relationshipType: 'sequel', label: 'Refreshed label' }])));
    expect(relation(ownerId, '42')).toMatchObject({ related_title_id: targetId, label: 'Refreshed label' });
    expect(otherRows()).toEqual(before);
  });
});

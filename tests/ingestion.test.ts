import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../server/db.ts';
import {
  classifyEpisodeList,
  classifyServerList,
  parseCataloguePage,
  parseEpisodeList,
  parseServerList,
} from '../server/ingestion/anikoto.ts';

describe('Anikoto public response parsers', () => {
  it('extracts a title card and observed pagination without sidebar guessing', () => {
    const parsed = parseCataloguePage(`
      <div class="ani items"><div class="item">
        <div class="ani poster tip" data-tip="42"><a href="https://anikototv.to/watch/test-title/ep-1"><img src="https://cdn.example/poster.jpg" alt="Test Title"><div class="meta"><div class="right">TV</div></div></a></div>
        <div class="info"><a class="name d-title" href="/watch/test-title/ep-1" data-jp="Tesuto">Test Title</a><div class="genre"><a href="/genre/action">Action</a></div></div>
      </div></div><a href="/filter?page=7">7</a>`);
    expect(parsed.lastPage).toBe(7);
    expect(parsed.titles).toMatchObject([
      { sourceId: '42', slug: 'test-title', name: 'Test Title', format: 'TV', genres: ['Action'] },
    ]);
  });

  it('preserves irregular episode numbering and separate language versions', () => {
    const title = parseCataloguePage(
      '<div class="ani items"><div class="item"><div class="ani poster tip" data-tip="42"><a href="/watch/test-title/ep-1"><img alt="Test Title"></a></div><a class="name d-title" href="/watch/test-title/ep-1">Test Title</a></div></div>',
    ).titles[0];
    const result = parseEpisodeList(
      '<a data-id="ep-x" data-num="12.5" data-slug="12-5" data-sub="1" data-dub="1" data-ids="opaque"></a>',
      title,
    );
    expect(result[0].episode).toMatchObject({
      sourceId: 'ep-x',
      number: '12.5',
      numberSort: 12.5,
      slug: 'ep-12-5',
    });
    expect(result[0].episode.versions.map((version) => version.language)).toEqual(['sub', 'dub']);
  });

  it('retains duplicate upstream route slugs as distinct episode records', () => {
    const title = parseCataloguePage(
      '<div class="ani items"><div class="item"><div class="ani poster tip" data-tip="42"><a href="/watch/test-title/ep-1"><img alt="Test Title"></a></div><a class="name d-title" href="/watch/test-title/ep-1">Test Title</a></div></div>',
    ).titles[0];
    const result = parseEpisodeList(
      '<a data-id="e1" data-num="0" data-slug="special" data-sub="1"></a><a data-id="e2" data-num="0" data-slug="special" data-sub="1"></a>',
      title,
    );
    expect(result.map((entry) => entry.episode.slug)).toEqual(['ep-special', 'ep-special-e2']);
  });

  it('distinguishes a genuine empty inventory from delayed loading markup', () => {
    expect(
      classifyEpisodeList(
        '<div class="head"><div class="filter"></div></div><div class="body"><div class="episodes name"></div></div>',
      ),
    ).toBe('empty');
    expect(classifyEpisodeList('<div class="episodes"></div>')).toBe('unknown');
    expect(classifyEpisodeList('<div class="episode-skeleton">Loading episodes…</div>')).toBe(
      'delayed',
    );
    expect(classifyEpisodeList('<a data-id="e1" data-num="1"></a>')).toBe('episodes');
  });

  it('keeps same-backend buttons as distinct provider mappings', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const groups = parseServerList(
        db,
        '<div class="type" data-type="sub"><ul><li data-link-id="YWJjZA==">HD-1</li><li data-link-id="ZWZnaA==">HD-2</li></ul></div>',
        '2026-09-10T00:00:00.000Z',
      );
      expect(groups.get('sub')?.map((mapping) => mapping.providerId)).toEqual(['hd-1', 'hd-2']);
      expect(groups.get('sub')?.[0].sourceMappingId).not.toBe(
        groups.get('sub')?.[1].sourceMappingId,
      );
      const merged = parseServerList(
        db,
        '<div class="type" data-type="sub"><i data-link-id="a">HD-1</i></div><div class="type" data-type="sub"><i data-link-id="b">HD-2</i></div>',
        '2026-09-10T00:00:00.000Z',
      );
      expect(merged.get('sub')).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('distinguishes mapped, delayed, empty, and changed server-list structures', () => {
    expect(
      classifyServerList(
        '<div class="type" data-type="sub"><button data-link-id="abc">HD-1</button></div>',
      ),
    ).toBe('mappings');
    expect(classifyServerList('<div class="server-skeleton">Loading servers…</div>')).toBe(
      'delayed',
    );
    expect(
      classifyServerList(
        "<p>You're watching Episode 95. If current servers doesn't work, please try other servers beside.</p>",
      ),
    ).toBe('empty');
    expect(classifyServerList('<div>Unexpected response</div>')).toBe('unknown');
    expect(classifyServerList('<button data-link-id="abc">HD-1</button>')).toBe('unknown');
  });
});

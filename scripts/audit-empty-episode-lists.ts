import { load } from 'cheerio';
import { migrate, openDatabase } from '../server/db.ts';
import { AnikotoSourceClient } from '../server/ingestion/source.ts';

const db = openDatabase();
const client = new AnikotoSourceClient();
try {
  migrate(db);
  const titles = db
    .prepare(
      `SELECT source_id AS sourceId,slug,name FROM titles t
    WHERE NOT EXISTS (SELECT 1 FROM episodes e WHERE e.title_id=t.id) ORDER BY name`,
    )
    .all() as Array<{ sourceId: string; slug: string; name: string }>;
  const results: Array<Record<string, unknown>> = [];
  for (const title of titles) {
    try {
      const payload = await client.json<{ status?: unknown; result?: unknown }>(
        `/ajax/episode/list/${encodeURIComponent(title.sourceId)}?vrf=`,
      );
      const html = typeof payload.result === 'string' ? payload.result : '';
      const $ = load(html);
      const text = $.root().text().replace(/\s+/g, ' ').trim().slice(0, 160);
      const episodeAnchors = $('a[data-id][data-num]').length;
      const delayedMarker = /loading|spinner|skeleton|please wait/i.test(`${html} ${text}`);
      if (
        payload.status === 200 &&
        typeof payload.result === 'string' &&
        episodeAnchors === 0 &&
        !delayedMarker
      )
        db.prepare(
          `INSERT INTO verification_observations(entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at)
        VALUES ('title',?,'observed','empty_episode_inventory','SOURCE_EMPTY_EPISODE_LIST','public_response',?,?)`,
        ).run(
          title.sourceId,
          JSON.stringify({
            envelopeStatus: payload.status,
            htmlBytes: Buffer.byteLength(html),
            episodeAnchors,
            delayedMarker,
          }),
          new Date().toISOString(),
        );
      results.push({
        ...title,
        envelopeStatus: payload.status ?? null,
        resultType: typeof payload.result,
        htmlBytes: Buffer.byteLength(html),
        episodeAnchors,
        delayedMarker,
        textPreview: text,
      });
    } catch (error) {
      results.push({
        ...title,
        error: error instanceof Error ? error.message : 'Unknown request error',
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        titlesWithoutImportedEpisodes: titles.length,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

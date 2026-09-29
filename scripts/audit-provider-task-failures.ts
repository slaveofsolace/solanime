import { load } from 'cheerio';
import { migrate, openDatabase } from '../server/db.ts';
import { AnikotoSourceClient } from '../server/ingestion/source.ts';
import { classifyServerList } from '../server/ingestion/anikoto.ts';

const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='));
const limit = Math.max(1, Math.min(25, Number(limitArgument?.split('=', 2)[1]) || 5));
const db = openDatabase();
const client = new AnikotoSourceClient();

try {
  migrate(db);
  const run = db.prepare('SELECT id,status FROM crawl_runs ORDER BY id DESC LIMIT 1').get() as
    | { id: number; status: string }
    | undefined;
  if (!run) throw new Error('No crawl run exists.');
  if (run.status !== 'paused')
    throw new Error(
      'Pause the crawl run before replaying failed provider tasks so the shared source-host pace remains bounded.',
    );
  const rows = db
    .prepare(
      `SELECT task_key AS taskKey,payload_json AS payloadJson,attempt_count AS attemptCount,last_error_code AS errorCode,last_error_message AS errorMessage
    FROM crawl_tasks WHERE run_id=? AND task_type='episode_servers' AND status='failed' ORDER BY updated_at,id LIMIT ?`,
    )
    .all(run.id, limit) as Array<Record<string, unknown>>;
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const payload = JSON.parse(String(row.payloadJson)) as {
      titleSourceId?: unknown;
      episodeSourceId?: unknown;
      serversRef?: unknown;
    };
    const titleSourceId = String(payload.titleSourceId ?? '');
    const episodeSourceId = String(payload.episodeSourceId ?? '');
    const serversRef = String(payload.serversRef ?? '');
    const episode = db
      .prepare(
        `SELECT t.slug AS titleSlug,t.name AS titleName,e.number_text AS episodeNumber,e.availability_state AS episodeAvailability
      FROM episodes e JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=? AND e.source_id=?`,
      )
      .get(titleSourceId, episodeSourceId) as Record<string, unknown> | undefined;
    try {
      const { body } = await client.text(
        `/ajax/server/list?servers=${encodeURIComponent(serversRef)}`,
        'json',
      );
      const envelope = JSON.parse(body) as { status?: unknown; result?: unknown };
      const html = typeof envelope.result === 'string' ? envelope.result : '';
      const $ = load(html);
      const buttons = $('[data-link-id]').length;
      const normalized = $.root().text().replace(/\s+/g, ' ').trim().slice(0, 160);
      const state = classifyServerList(html);
      const classification = state === 'mappings' ? 'mapped' : state;
      results.push({
        taskKey: row.taskKey,
        attemptCount: row.attemptCount,
        previousErrorCode: row.errorCode,
        ...episode,
        envelopeStatus: envelope.status ?? null,
        htmlBytes: Buffer.byteLength(html),
        buttons,
        classification,
        textSample: normalized || null,
      });
    } catch (error) {
      results.push({
        taskKey: row.taskKey,
        attemptCount: row.attemptCount,
        previousErrorCode: row.errorCode,
        ...episode,
        classification: 'request_failed',
        error: error instanceof Error ? error.message : 'Unknown request failure.',
      });
    }
  }
  console.log(
    JSON.stringify(
      { runId: run.id, checked: results.length, limit, opaqueReferencesIncluded: false, results },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

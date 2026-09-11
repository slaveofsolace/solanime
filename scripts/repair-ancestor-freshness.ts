import { migrate, openDatabase } from '../server/db.ts';

const db = openDatabase();
try {
  migrate(db);
  const completed = db.prepare(`SELECT task_type AS taskType,payload_json AS payloadJson,completed_at AS completedAt
    FROM crawl_tasks WHERE status='completed' AND task_type IN ('title_detail','sitemap_title') AND completed_at IS NOT NULL
    ORDER BY completed_at`).all() as Array<{ taskType: string; payloadJson: string; completedAt: string }>;
  const observations = new Map<number, string>();
  for (const task of completed) {
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(task.payloadJson) as Record<string, unknown>; } catch { continue; }
    const row = task.taskType === 'title_detail' && typeof payload.sourceId === 'string'
      ? db.prepare("SELECT id FROM titles WHERE source='anikoto' AND source_id=?").get(payload.sourceId)
      : task.taskType === 'sitemap_title' && typeof payload.canonicalUrl === 'string'
        ? db.prepare("SELECT id FROM titles WHERE source='anikoto' AND canonical_url=?").get(payload.canonicalUrl)
        : undefined;
    if (row) observations.set(Number((row as { id: number }).id), task.completedAt);
  }
  let titles = 0; let episodes = 0; let versions = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [titleId, observedAt] of observations) {
      titles += Number(db.prepare('UPDATE titles SET last_seen_at=?,last_successful_import_at=?,updated_at=? WHERE id=?').run(observedAt, observedAt, observedAt, titleId).changes);
      episodes += Number(db.prepare('UPDATE episodes SET last_seen_at=?,last_successful_import_at=?,updated_at=? WHERE title_id=?').run(observedAt, observedAt, observedAt, titleId).changes);
      versions += Number(db.prepare('UPDATE episode_versions SET last_seen_at=?,last_successful_import_at=? WHERE episode_id IN (SELECT id FROM episodes WHERE title_id=?)').run(observedAt, observedAt, titleId).changes);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  console.log(JSON.stringify({ repairedFromCompletedTitleObservations: observations.size, rowsUpdated: { titles, episodes, versions }, note: 'Provider mapping timestamps are unchanged.' }, null, 2));
} finally { db.close(); }

import { migrate, openDatabase } from '../server/db.ts';
import { enqueueTask } from '../server/ingestion/queue.ts';

const runId = Number(process.argv[2]);
if (!Number.isInteger(runId) || runId < 1)
  throw new Error('Usage: pnpm tsx scripts/enqueue-sitemap-discovery.ts <run-id>');
const db = openDatabase();
try {
  migrate(db);
  const run = db
    .prepare("SELECT id,status FROM crawl_runs WHERE id=? AND mode IN ('full','incremental')")
    .get(runId) as { id: number; status: string } | undefined;
  if (!run) throw new Error(`Full/incremental run ${runId} does not exist.`);
  enqueueTask(db, runId, 'sitemap:index', 'sitemap_index', { includeProviders: true });
  console.log(JSON.stringify({ runId, taskKey: 'sitemap:index', runStatus: run.status }, null, 2));
} finally {
  db.close();
}

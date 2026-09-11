import { migrate, openDatabase } from '../server/db.ts';
import { retryFailedTasks, setRunPaused } from '../server/ingestion/queue.ts';

const runId = Number(process.argv[2]);
const action = process.argv[3];
if (!Number.isInteger(runId) || !['pause', 'resume', 'retry'].includes(action ?? '')) throw new Error('Usage: pnpm tsx scripts/control-import.ts <run-id> <pause|resume|retry>');
const db = openDatabase();
try {
  migrate(db);
  const changed = action === 'retry' ? retryFailedTasks(db, runId) : setRunPaused(db, runId, action === 'pause');
  console.log(JSON.stringify({ runId, action, changed }, null, 2));
} finally { db.close(); }

import { auditPlaybackCoverage } from '../server/providers/playbackCoverage.ts';
import { migrate, openDatabase } from '../server/db.ts';

const strict = process.argv.includes('--strict');
const db = openDatabase();

try {
  migrate(db);
  const audit = auditPlaybackCoverage(db);
  console.log(JSON.stringify(audit, null, 2));
  if (strict && audit.verdict !== 'pass') process.exitCode = 1;
} finally {
  db.close();
}

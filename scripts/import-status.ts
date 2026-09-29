import { adminStatus } from '../server/catalogue.ts';
import { migrate, openDatabase } from '../server/db.ts';
import { parseImportStatusDatabasePath } from './import-status-args.ts';

const databasePath = parseImportStatusDatabasePath(process.argv.slice(2));
const db = openDatabase(databasePath);
try {
  migrate(db);
  console.log(JSON.stringify(adminStatus(db), null, 2));
} finally {
  db.close();
}

import { adminStatus } from '../server/catalogue.ts';
import { migrate, openDatabase } from '../server/db.ts';

const db = openDatabase();
try { migrate(db); console.log(JSON.stringify(adminStatus(db), null, 2)); }
finally { db.close(); }

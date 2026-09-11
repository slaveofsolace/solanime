import { currentSchemaVersion, migrate, openDatabase } from '../server/db.ts';

const db = openDatabase();
try {
  migrate(db);
  console.log(
    JSON.stringify(
      {
        database: process.env.SOLANIME_DB_PATH ?? 'data/solanime.sqlite',
        schemaVersion: currentSchemaVersion(db),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

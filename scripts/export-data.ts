import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adminStatus,
  exportCatalogue,
  exportCatalogueCsv,
  exportCoverageCsv,
} from '../server/catalogue.ts';
import { currentSchemaVersion, migrate, openDatabase } from '../server/db.ts';

const outputDirectory = resolve(process.argv[2] ?? 'data/exports');
mkdirSync(outputDirectory, { recursive: true });
const db = openDatabase();
try {
  migrate(db);
  const cataloguePath = resolve(outputDirectory, 'catalogue.json');
  const coveragePath = resolve(outputDirectory, 'coverage.csv');
  const catalogueCsvPath = resolve(outputDirectory, 'catalogue.csv');
  const manifestPath = resolve(outputDirectory, 'manifest.json');
  let catalogueJson = '';
  let coverageCsv = '';
  let catalogueCsv = '';
  let manifestJson = '';
  db.exec('BEGIN');
  try {
    const exportedAt = new Date().toISOString();
    const schemaVersion = currentSchemaVersion(db);
    catalogueJson = `${JSON.stringify(exportCatalogue(db), null, 2)}\n`;
    coverageCsv = exportCoverageCsv(db);
    catalogueCsv = exportCatalogueCsv(db);
    manifestJson = `${JSON.stringify({ schemaVersion, exportedAt, files: ['catalogue.json', 'catalogue.csv', 'coverage.csv'], status: adminStatus(db) }, null, 2)}\n`;
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const writeAtomic = (path: string, contents: string) => {
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(temporary, contents);
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
  };
  writeAtomic(cataloguePath, catalogueJson);
  writeAtomic(coveragePath, coverageCsv);
  writeAtomic(catalogueCsvPath, catalogueCsv);
  writeAtomic(manifestPath, manifestJson);
  console.log(
    JSON.stringify(
      { outputDirectory, cataloguePath, catalogueCsvPath, coveragePath, manifestPath },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

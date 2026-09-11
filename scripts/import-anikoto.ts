import { migrate, openDatabase } from '../server/db.ts';
import { captureCoverage, runAnikotoWorker, type ImportOptions } from '../server/ingestion/anikoto.ts';
import { adminStatus } from '../server/catalogue.ts';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function integer(name: string): number | undefined {
  const raw = option(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}

const modeRaw = option('mode') ?? 'slice';
if (!['slice', 'full', 'incremental'].includes(modeRaw)) throw new Error('--mode must be slice, full, or incremental.');
const options: ImportOptions = {
  mode: modeRaw as ImportOptions['mode'],
  runId: integer('run-id'),
  pageLimit: integer('page-limit'),
  titleLimit: integer('title-limit'),
  taskBudget: integer('task-budget'),
  maxTasksThisProcess: integer('max-tasks'),
  includeProviders: !process.argv.includes('--skip-providers'),
};

const db = openDatabase();
try {
  migrate(db);
  const result = await runAnikotoWorker(db, options);
  captureCoverage(db, result.runId);
  console.log(JSON.stringify({ ...result, status: adminStatus(db) }, null, 2));
} finally { db.close(); }

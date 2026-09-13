import { migrate, openDatabase } from '../server/db.ts';
import { syncTvMaze } from '../server/ingestion/tvmaze.ts';

const HELP = `Import non-animation TV metadata and episode inventories from TVmaze.

Usage:
  pnpm import:tvmaze -- [options]

Options:
  --db=<path>                  SQLite database to update
  --start-page=<number>        TVmaze show-index page (defaults to saved checkpoint)
  --page-limit=<number>        Pages to import in this run (default: 1)
  --request-interval-ms=<ms>   Minimum delay between requests (default: 550)
  --retries=<number>           Bounded retry count (default: 3)
  --help, -h                   Print this help without opening the database
`;

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function integer(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer.`);
  return value;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  const db = openDatabase(option('db'));
  try {
    migrate(db);
    const result = await syncTvMaze(db, {
      startPage: option('start-page') === undefined ? undefined : integer('start-page', 0),
      pageLimit: integer('page-limit', 1),
      requestIntervalMs: integer('request-interval-ms', 550),
      retries: integer('retries', 3),
      onPage: (progress) => console.log(JSON.stringify({ event: 'page_imported', ...progress })),
    });
    console.log(JSON.stringify({ event: 'complete', ...result }, null, 2));
  } finally {
    db.close();
  }
}

await main();

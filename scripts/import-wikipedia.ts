import { migrate, openDatabase } from '../server/db.ts';
import { syncWikipedia, type WikipediaMedia } from '../server/ingestion/wikipedia.ts';

const HELP = `Import a bounded Movie or TV metadata slice from public English Wikipedia category data.

This importer stores no episodes, playback providers, embeds, or playback media URLs. Page images remain
file-license-unverified metadata references; their poster/backdrop role is only an aspect-ratio candidate.

Usage:
  pnpm import:wikipedia -- [options]

Options:
  --db=<path>                  SQLite database to update
  --media=movie|tv             Category lane (default: movie)
  --year=<year>                Release/debut category year (default: current UTC year)
  --batch-limit=<number>       Continuation batches in this run (default: 1)
  --page-size=<number>         Complete article members per batch, 1-20 (default: 20)
  --request-interval-ms=<ms>   Minimum delay between requests (default: 1000)
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
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`--${name} must be a non-negative integer.`);
  return value;
}

function media(): WikipediaMedia {
  const value = option('media') ?? 'movie';
  if (value !== 'movie' && value !== 'tv') throw new Error('--media must be movie or tv.');
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
    const result = await syncWikipedia(db, {
      media: media(),
      year: integer('year', new Date().getUTCFullYear()),
      batchLimit: integer('batch-limit', 1),
      pageSize: integer('page-size', 20),
      requestIntervalMs: integer('request-interval-ms', 1_000),
      retries: integer('retries', 3),
      onBatch: (progress) => console.log(JSON.stringify({ event: 'batch_imported', ...progress })),
    });
    console.log(JSON.stringify({ event: 'complete', ...result }, null, 2));
  } finally {
    db.close();
  }
}

await main();

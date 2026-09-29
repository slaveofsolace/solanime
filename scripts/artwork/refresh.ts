import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { enqueueLocalArtwork, localArtworkStatus, runLocalArtworkStep } from '../../server/artwork/local.ts';

const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.split('='); return [key, value.join('=') || 'true']; }));
if (!args.get('--db')) throw new Error('Use --db=<explicit migrated SQLite path>. The default is read-only status.');
const execute = args.get('--execute') === 'true'; const path = resolve(args.get('--db')!);
const requests = Number(args.get('--max-requests')); const seconds = Number(args.get('--max-seconds') ?? 60);
if (execute && (!Number.isSafeInteger(requests) || requests < 1 || requests > 10_000 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600)) throw new Error('Execution requires an explicit --max-requests=1..10000 and --max-seconds=1..3600.');
const db = new DatabaseSync(path, { readOnly: !execute, enableForeignKeyConstraints: true });
try {
  if (!execute) console.log(JSON.stringify({ mode: 'read-only', database: path, ...localArtworkStatus(db) }, null, 2));
  else {
    if (args.get('--enqueue') === 'true') {
      let cursor = 0;
      do { const page = enqueueLocalArtwork(db, cursor, 100, args.get('--refresh-completed') === 'true'); console.log(JSON.stringify({ stage: 'enqueue', ...page })); if (page.nextCursor === null) break; cursor = page.nextCursor; } while (true);
    }
    const deadline = Date.now() + seconds * 1000; let used = 0; let steps = 0;
    while (used < requests && Date.now() < deadline && steps < requests * 4) {
      const result = await runLocalArtworkStep(db); used += result.requests; steps++;
      console.log(JSON.stringify(result));
      if (result.status === 'blocked' || result.status === 'failed') break;
      if (result.status === 'idle') { const pending = db.prepare("SELECT MIN(available_at) AS next FROM artwork_jobs WHERE status IN ('pending','retry')").get(); if (!pending?.next || Date.parse(String(pending.next)) >= deadline) break; }
      await delay(Math.min(2300, Math.max(0, deadline - Date.now())));
    }
    console.log(JSON.stringify({ stage: 'checkpoint', database: path, usedRequestAllowance: used, maxRequests: requests, ...localArtworkStatus(db) }, null, 2));
  }
} finally { db.close(); }

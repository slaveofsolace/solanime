import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../server/db.ts';
import { applyArtworkBundle, validateArtworkBundle } from '../../server/artwork/bundle.ts';

const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.split('='); return [key, value.join('=') || 'true']; }));
if (!args.get('--db') || !args.get('--input')) throw new Error('Use --db=<explicit SQLite path> --input=<reviewed evidence JSON> [--apply]. The default is a read-only dry run.');
const path = resolve(args.get('--db')!); const input = resolve(args.get('--input')!);
const bytes = readFileSync(input); if (bytes.length > 1_000_000) throw new Error('Review bundle exceeds one megabyte; split it into bounded batches.');
const bundle = validateArtworkBundle(JSON.parse(bytes.toString('utf8')));
if (args.get('--apply') !== 'true') {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const identities = bundle.records.map(({ review }) => { const row = db.prepare('SELECT source,source_id,release_year,format FROM titles WHERE id=?').get(review.titleId); return { titleId: review.titleId, mediaId: review.mediaId, matchesStoredSource: row?.source === review.titleSource && row?.source_id === review.titleSourceId && row?.release_year === review.releaseYear && String(row?.format).toLowerCase() === review.format.toLowerCase() }; });
    console.log(JSON.stringify({ mode: 'dry-run', database: path, reviewedMatches: bundle.records.length, resources: bundle.records.reduce((sum, entry) => sum + entry.resources.length, 0), identities, sourceIdentifiersChanged: 0, upstreamRequests: 0, writes: 0 }, null, 2));
    if (identities.some(item => !item.matchesStoredSource)) process.exitCode = 2;
  } finally { db.close(); }
} else {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try { db.exec('PRAGMA busy_timeout=5000'); migrate(db); console.log(JSON.stringify({ mode: 'applied', database: path, ...applyArtworkBundle(db, bundle) }, null, 2)); }
  finally { db.close(); }
}

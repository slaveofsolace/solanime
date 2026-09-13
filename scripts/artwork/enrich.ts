import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { migrate, projectRoot } from '../../server/db.ts';
import { applyArtworkBundle } from '../../server/artwork/bundle.ts';
import { enrichmentStatus, migrateArtworkEnrichment, runArtworkEnrichmentStep, seedArtworkEnrichment, visibleArtworkTitleIds } from '../../server/artwork/enrichment.ts';

const args = new Map(process.argv.slice(2).map(arg => { const [key,...rest] = arg.split('='); return [key,rest.join('=') || 'true']; }));
const execute = args.get('--execute') === 'true'; const create = args.get('--create-copy') === 'true'; const seed = args.get('--seed') === 'true' || create;
if (!args.get('--db') || !args.get('--queue')) throw new Error('Use explicit --db=<task-owned catalogue copy> --queue=<separate operator queue>. The default is read-only status.');
const databasePath = resolve(args.get('--db')!); const queuePath = resolve(args.get('--queue')!); const markerPath = `${databasePath}.artwork-task-copy.json`;
const canonicalPath = realpathSync(resolve(projectRoot,'data','solanime.sqlite')).toLowerCase();
if (databasePath.toLowerCase() === queuePath.toLowerCase() || [databasePath,queuePath].some(path => existsSync(path) && realpathSync(path).toLowerCase() === canonicalPath)) throw new Error('Artwork enrichment only writes a separate task-owned catalogue and queue; canonical data is protected.');
const out = args.get('--out') ? resolve(args.get('--out')!) : null;
if (out && existsSync(out)) throw new Error('The requested receipt already exists. Choose a new receipt path; historical evidence is retained.');
const counts = (db: DatabaseSync) => Object.fromEntries(['titles','episodes','episode_versions','episode_provider_mappings'].map(table => [table,Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count)]));
if (create) {
  if (!args.get('--source-db') || existsSync(databasePath) || existsSync(markerPath) || existsSync(queuePath)) throw new Error('Creating a copy requires --source-db and new, absent catalogue/queue/marker paths. Nothing was overwritten.');
  const sourcePath = realpathSync(resolve(args.get('--source-db')!));
  if (sourcePath.toLowerCase() === databasePath.toLowerCase()) throw new Error('Source and task-owned catalogue must differ.');
  mkdirSync(dirname(databasePath),{recursive:true}); mkdirSync(dirname(queuePath),{recursive:true});
  const source = new DatabaseSync(sourcePath,{readOnly:true,enableForeignKeyConstraints:true});
  try {
    const sourceCounts = counts(source); const sourceSchema = source.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version;
    await backup(source,databasePath);
    const copied = new DatabaseSync(databasePath,{enableForeignKeyConstraints:true});
    try {
      if (JSON.stringify(counts(copied)) !== JSON.stringify(sourceCounts)) throw new Error('The online backup failed its structural-count comparison.');
      migrate(copied);
      if (args.get('--reviewed-bundle')) applyArtworkBundle(copied,JSON.parse(readFileSync(resolve(args.get('--reviewed-bundle')!),'utf8')));
      if (copied.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || copied.prepare('PRAGMA foreign_key_check').all().length) throw new Error('The task copy failed SQLite integrity validation.');
    } finally { copied.close(); }
    writeFileSync(markerPath,JSON.stringify({version:1,createdAt:new Date().toISOString(),sourcePath,sourceSchema,sourceCounts,databasePath,queuePath,copySha256:createHash('sha256').update(readFileSync(databasePath)).digest('hex'),copyMethod:'node:sqlite online backup; canonical database opened read-only',privateAccountsCopied:false},null,2)+'\n',{flag:'wx'});
  } finally { source.close(); }
}
if ((execute || seed) && !existsSync(markerPath)) throw new Error('Execution requires a task-copy marker created with --create-copy. Never point the artwork worker at canonical data.');
if (existsSync(markerPath)) {
  const marker = JSON.parse(readFileSync(markerPath,'utf8'));
  if (marker.version !== 1 || marker.databasePath !== databasePath || marker.queuePath !== queuePath) throw new Error('The task-copy marker does not match these exact database and queue paths.');
}
const requests = Number(args.get('--max-requests')); const dailyLimit = Number(args.get('--daily-request-limit')); const seconds = Number(args.get('--max-seconds'));
if (execute && (!Number.isSafeInteger(requests) || requests < 1 || requests > 10_000 || !Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10_000 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600 || !args.get('--title-ids'))) throw new Error('Execution requires explicit --title-ids=visible|<ids>, --max-requests=1..10000, --daily-request-limit=1..10000 and --max-seconds=1..3600. No implicit full import exists.');
const db = new DatabaseSync(databasePath,{readOnly: !execute && !seed,enableForeignKeyConstraints:true});
const queue = new DatabaseSync(queuePath,{readOnly: !execute && !seed,enableForeignKeyConstraints:true});
try {
  if (execute || seed) migrateArtworkEnrichment(queue);
  let seeded;
  if (seed) seeded = seedArtworkEnrichment(db,queue);
  const selected = args.get('--title-ids') === 'visible' ? visibleArtworkTitleIds(db) : (args.get('--title-ids') ?? '').split(',').filter(Boolean).map(Number);
  let used = 0; let steps = 0; let halt = execute ? 'deadline-or-request-budget' : 'read-only';
  if (execute) {
    const deadline = Date.now() + seconds * 1000;
    while (used < requests && Date.now() < deadline && steps < requests * 5) {
      const result = await runArtworkEnrichmentStep(db,queue,{titleIds:selected,dailyRequestLimit:dailyLimit,identityOnly:args.get('--identity-only') === 'true'});
      used += result.requests; steps++; console.log(JSON.stringify(result));
      if (result.status === 'blocked' || result.reason === 'QUOTA_EXHAUSTED') { halt = result.reason ?? 'source-policy-blocked'; break; }
      if (result.status === 'idle') {
        const row = queue.prepare("SELECT MIN(available_at) AS next FROM artwork_enrichment_tasks WHERE title_id IN (SELECT value FROM json_each(?)) AND status IN ('pending','retry') AND (?=0 OR stage='identity')").get(JSON.stringify(selected),args.get('--identity-only') === 'true' ? 1 : 0);
        if (!row?.next || Date.parse(String(row.next)) >= deadline) { halt = row?.next ? 'durable-retry-pending' : 'selected-titles-settled'; break; }
      }
      await delay(Math.min(2300,Math.max(0,deadline-Date.now())));
    }
  }
  const receipt = { observedAt:new Date().toISOString(),mode:execute ? 'bounded-task-copy-enrichment' : seed ? 'task-copy-queue-seeded' : 'read-only',databasePath,queuePath,seeded,selectedTitleIds:selected,requestsIssued:used,steps,halt,...enrichmentStatus(db,queue),
    measuredTitles:db.prepare(`SELECT t.id,t.name,m.media_id AS anilistId,m.mal_id AS malId,a.role,a.width,a.height,a.reuse_status AS reuseStatus,a.last_successful_verification_at AS verifiedAt FROM artwork_matches m JOIN titles t ON t.id=m.title_id LEFT JOIN title_artwork a ON a.match_id=m.id ORDER BY t.id,a.role`).all(),
    canonicalDataChanged:false,cloudWrites:0,privateAccountsAccessed:false,imagePayloadsRetained:false };
  if (out) { mkdirSync(dirname(out),{recursive:true}); writeFileSync(out,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'}); }
  console.log(JSON.stringify(receipt,null,2));
} finally { db.close(); queue.close(); }

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BatchManifest } from './prepare.ts';

const option = (name: string, fallback = '') => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const manifestPath = resolve(option('manifest'));
if (!option('manifest') || !option('origin')) throw new Error('Usage: node --import tsx scripts/cloud-data/upload.ts --manifest=<manifest.json> --origin=<preview origin> [--target=catalogue|research] [--max-batches=0]');
const origin = new URL(option('origin'));
if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !((origin.protocol === 'https:' && /\.(pages|workers)\.dev$/.test(origin.hostname)) || (origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname)))) throw new Error('Use an explicit Cloudflare preview origin or localhost. Paths, credentials and arbitrary upstream hosts are not supported.');
const token = process.env.SOLANIME_ADMIN_TOKEN;
if (!token) throw new Error('Set SOLANIME_ADMIN_TOKEN in the process environment. It is never stored in the manifest, logs or upload database.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BatchManifest;
if (manifest.version !== 1 || !Array.isArray(manifest.batches)) throw new Error('Unsupported manifest.');
const target = option('target');
if (target && !['catalogue', 'research'].includes(target)) throw new Error('Target must be catalogue or research.');
const maxBatches = Number(option('max-batches', '0'));
if (!Number.isSafeInteger(maxBatches) || maxBatches < 0) throw new Error('max-batches must be zero (full manifest) or a positive explicit execution budget.');
const delayMs = Number(option('request-delay-ms', '450'));
if (!Number.isSafeInteger(delayMs) || delayMs < 350 || delayMs > 60_000) throw new Error('Request delay must be between 350 and 60,000 milliseconds.');
const progress = new DatabaseSync(join(dirname(manifestPath), 'upload.sqlite'));
progress.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS delivered(origin TEXT NOT NULL,batch_id TEXT NOT NULL,sha256 TEXT NOT NULL,delivered_at TEXT NOT NULL,PRIMARY KEY(origin,batch_id)); CREATE TABLE IF NOT EXISTS failures(origin TEXT NOT NULL,batch_id TEXT NOT NULL,http_status INTEGER,code TEXT NOT NULL,attempted_at TEXT NOT NULL);');
let sent = 0; let skipped = 0; let paused: string | null = null;
try {
  for (const entry of manifest.batches) {
    if (target && target !== entry.target) continue;
    if (maxBatches && sent >= maxBatches) { paused = 'execution_budget'; break; }
    if (!/^batches\/[a-zA-Z0-9_-]+\.json$/.test(entry.file)) throw new Error('Manifest batch path is outside the generated batches directory.');
    const existing = progress.prepare('SELECT sha256 FROM delivered WHERE origin=? AND batch_id=?').get(origin.origin, entry.id);
    if (existing) { if (existing.sha256 !== entry.sha256) throw new Error('A delivered batch checksum changed. Rebuild a new snapshot; do not overwrite this checkpoint.'); skipped++; continue; }
    const body = readFileSync(join(dirname(manifestPath), entry.file), 'utf8');
    if (createHash('sha256').update(body).digest('hex') !== entry.sha256) throw new Error('Local batch checksum mismatch. Nothing was sent.');
    let response: Response;
    try {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      response = await fetch(new URL('/api/admin/import/batch', origin), { method: 'POST', headers: { 'x-admin-token': token, 'content-type': 'application/json', origin: origin.origin, 'x-solanime-intent': 'operator-import' }, body, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    }
    catch { paused = 'network_error'; progress.prepare('INSERT INTO failures VALUES(?,?,?,?,?)').run(origin.origin, entry.id, null, paused, new Date().toISOString()); break; }
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = result && typeof result === 'object' && 'error' in result && result.error && typeof result.error === 'object' && 'code' in result.error ? String(result.error.code).slice(0, 80) : `HTTP_${response.status}`;
      progress.prepare('INSERT INTO failures VALUES(?,?,?,?,?)').run(origin.origin, entry.id, response.status, code, new Date().toISOString());
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : retryAfter ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000) : null;
      paused = `${code}${seconds != null && Number.isFinite(seconds) ? `; retry after ${Math.max(1, seconds)} seconds` : ''}`; break;
    }
    if (!result || typeof result !== 'object' || !('id' in result) || result.id !== entry.id || !('status' in result) || !['imported', 'already_imported'].includes(String(result.status))) { paused = 'invalid_receipt'; break; }
    progress.prepare('INSERT INTO delivered VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(origin.origin, entry.id, entry.sha256, new Date().toISOString());
    sent++;
    if (sent % 100 === 0) console.log(JSON.stringify({ sent, skipped, lastBatch: entry.id, target: entry.target }));
  }
  const delivered = Number(progress.prepare('SELECT COUNT(*) AS count FROM delivered WHERE origin=?').get(origin.origin)?.count);
  console.log(JSON.stringify({ origin: origin.origin, sent, skipped, delivered, manifestBatches: manifest.totalBatches, pendingBatches: manifest.totalBatches - delivered, paused, checkpoint: join(dirname(manifestPath), 'upload.sqlite'), resume: `node --import tsx scripts/cloud-data/upload.ts --manifest=${manifestPath} --origin=${origin.origin}${target ? ` --target=${target}` : ''}` }, null, 2));
  if (paused && paused !== 'execution_budget') process.exitCode = 2;
} finally { progress.close(); }

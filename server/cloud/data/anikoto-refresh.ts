import { load } from 'cheerio';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { AppError } from '../../errors.ts';
import type { SnapshotTitle } from '../../types.ts';
import { parseCataloguePage, parseTitlePage, parseEpisodeList, classifyEpisodeList } from '../../ingestion/anikoto.ts';
import { validateSnapshot } from '../../ingestion/validate.ts';
import type { CatalogueDatabase } from './catalogue.ts';
import { reserveWriteBudget, DEFAULT_SYNC_BUDGET, type SyncBudget } from './budget.ts';
import { SyncSourceError, type SyncHandlers, type SyncPlan, type SyncTask } from './sync.ts';

const ORIGIN = 'https://anikototv.to';
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
const stamp = () => new Date().toISOString();
const encodedSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
type ReadSource = { read(path: string, accept: string): Promise<string>; now(): number };
type Fanout = { key: string; type: string; payload: Record<string, unknown> };
type EpisodeWork = ReturnType<typeof parseEpisodeList>[number];
function route(value: unknown): string | null {
  try { const url = new URL(text(value), ORIGIN); if (url.origin !== ORIGIN || url.username || url.password || !/^\/watch\/[^/]+(?:\/ep-[^/]+)?\/?$/.test(url.pathname)) return null; return `${ORIGIN}/watch/${url.pathname.split('/')[2]}`; } catch { return null; }
}
function fanout(db: CatalogueDatabase, task: Pick<SyncTask, 'runId'>, entries: Fanout[], observedAt: string) {
  if (entries.length > 40 || encodedSize(entries) > 100_000 || entries.some(entry => !entry.key || entry.key.length > 200 || !/^[a-z_]+$/.test(entry.type))) throw new AppError(422, 'UPSTREAM_CHANGED', 'Discovery fanout exceeded its bounded task contract.');
  return db.prepare("INSERT INTO crawl_tasks(id,run_id,task_key,task_type,payload_json,status,max_attempts,available_at,created_at,updated_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000) FROM crawl_tasks)+CAST(key AS INTEGER)+1,?,json_extract(value,'$.key'),json_extract(value,'$.type'),json_extract(value,'$.payload'),'pending',5,?,?,? FROM json_each(?) WHERE true ON CONFLICT(run_id,task_key) DO NOTHING").bind(task.runId, observedAt, observedAt, observedAt, JSON.stringify(entries));
}
function titleStatements(db: CatalogueDatabase, title: SnapshotTitle, observedAt: string): D1PreparedStatement[] {
  const sourceId = title.sourceId;
  const aliases = (title.aliases ?? []).map(alias => ({ name: alias.name, language: alias.language ?? null, type: alias.type ?? 'alternate' }));
  const genres = (title.genres ?? []).map(name => ({ name, slug: slugify(name) }));
  const related = title.related ?? [];
  if (aliases.length > 100 || genres.length > 100 || related.length > 100 || encodedSize(title) > 48_000) throw new AppError(422, 'UPSTREAM_CHANGED', 'Title metadata exceeded its bounded schema.');
  return [
    db.prepare("INSERT INTO titles(id,source,source_id,slug,canonical_url,name,description,format,release_year,status,artwork_url,artwork_origin,artwork_reuse_status,availability_state,first_seen_at,last_seen_at,last_successful_import_at,created_at,updated_at) VALUES((SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM titles),'anikoto',?,?,?,?,?,?,?,?,?,?,?,'available',?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET slug=excluded.slug,canonical_url=excluded.canonical_url,name=excluded.name,description=COALESCE(NULLIF(excluded.description,''),titles.description),format=COALESCE(excluded.format,titles.format),release_year=COALESCE(excluded.release_year,titles.release_year),status=COALESCE(excluded.status,titles.status),artwork_url=COALESCE(excluded.artwork_url,titles.artwork_url),artwork_origin=COALESCE(excluded.artwork_origin,titles.artwork_origin),last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,updated_at=excluded.updated_at,availability_state='available' WHERE julianday(excluded.updated_at)>=julianday(titles.updated_at)").bind(sourceId, title.slug, title.canonicalUrl, title.name, title.description ?? null, title.format ?? null, title.releaseYear ?? null, title.status ?? null, title.artworkUrl ?? null, title.artworkOrigin ?? null, title.artworkReuseStatus ?? 'reference-only', observedAt, observedAt, observedAt, observedAt, observedAt),
    db.prepare("INSERT INTO title_aliases(id,title_id,alias,language,alias_type) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000) FROM title_aliases)+CAST(j.key AS INTEGER)+1,t.id,json_extract(j.value,'$.name'),json_extract(j.value,'$.language'),json_extract(j.value,'$.type') FROM json_each(?) j JOIN titles t ON t.source='anikoto' AND t.source_id=? WHERE NOT EXISTS(SELECT 1 FROM title_aliases a WHERE a.title_id=t.id AND a.alias=json_extract(j.value,'$.name') AND a.language IS json_extract(j.value,'$.language')) ON CONFLICT DO NOTHING").bind(JSON.stringify(aliases), sourceId),
    db.prepare("INSERT INTO genres(id,slug,name) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000) FROM genres)+CAST(key AS INTEGER)+1,json_extract(value,'$.slug'),json_extract(value,'$.name') FROM json_each(?) WHERE true ON CONFLICT DO NOTHING").bind(JSON.stringify(genres)),
    db.prepare("INSERT INTO title_genres(title_id,genre_id) SELECT t.id,g.id FROM json_each(?) j JOIN genres g ON g.slug=json_extract(j.value,'$.slug') JOIN titles t ON t.source='anikoto' AND t.source_id=? WHERE true ON CONFLICT DO NOTHING").bind(JSON.stringify(genres), sourceId),
    db.prepare("INSERT INTO related_titles(title_id,related_title_id,related_source_id,relationship_type,label,source_url,first_seen_at,last_seen_at) SELECT t.id,(SELECT id FROM titles WHERE source='anikoto' AND source_id=json_extract(j.value,'$.sourceId')),json_extract(j.value,'$.sourceId'),json_extract(j.value,'$.relationshipType'),json_extract(j.value,'$.label'),json_extract(j.value,'$.sourceUrl'),?,? FROM json_each(?) j JOIN titles t ON t.source='anikoto' AND t.source_id=? WHERE true ON CONFLICT(title_id,relationship_type,related_source_id) DO UPDATE SET related_title_id=COALESCE(excluded.related_title_id,related_titles.related_title_id),label=COALESCE(excluded.label,related_titles.label),source_url=COALESCE(excluded.source_url,related_titles.source_url),last_seen_at=excluded.last_seen_at WHERE julianday(excluded.last_seen_at)>=julianday(related_titles.last_seen_at)").bind(observedAt, observedAt, JSON.stringify(related), sourceId),
  ];
}
function saveParts(db: CatalogueDatabase, taskId: number, parts: unknown[], observedAt: string) {
  if (parts.some(part => encodedSize(part) > 48_000) || encodedSize(parts) > 1_800_000) throw new AppError(422, 'UPSTREAM_CHANGED', 'The acquisition exceeds the bounded durable payload size; prior records were preserved.');
  return db.prepare('INSERT INTO cloud_sync_payloads(task_id,part,payload_json,observed_at) SELECT ?,CAST(key AS INTEGER),value,? FROM json_each(?) WHERE true ON CONFLICT(task_id,part) DO UPDATE SET payload_json=excluded.payload_json,observed_at=excluded.observed_at').bind(taskId, observedAt, JSON.stringify(parts));
}
async function part(db: CatalogueDatabase, taskId: number, index: number): Promise<unknown> {
  const stored = await db.prepare('SELECT payload_json FROM cloud_sync_payloads WHERE task_id=? AND part=?').bind(taskId, index).first<{ payload_json: string }>();
  if (!stored) throw new AppError(422, 'UPSTREAM_CHANGED', 'The durable acquisition fragment is missing; no record was removed.');
  try { return JSON.parse(stored.payload_json) as unknown; } catch { throw new AppError(422, 'UPSTREAM_CHANGED', 'The durable acquisition fragment is malformed.'); }
}
function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []; let current: T[] = []; let bytes = 2;
  for (const value of values) { const length = encodedSize(value) + 1; if (current.length && (current.length >= size || bytes + length > 48_000)) { result.push(current); current = []; bytes = 2; } current.push(value); bytes += length; }
  if (current.length) result.push(current); return result;
}

export function createAnikotoRefreshRepository(db: CatalogueDatabase, budget: SyncBudget = DEFAULT_SYNC_BUDGET) {
  async function ensure(options: { key?: string; includeProviders?: boolean } = {}) {
    const key = options.key ?? stamp().slice(0, 10);
    if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(key) || (options.includeProviders !== undefined && typeof options.includeProviders !== 'boolean')) throw new AppError(400, 'BAD_REQUEST', 'A refresh key must be a short stable operator identifier and includeProviders must be boolean.');
    const snapshot = await db.prepare("SELECT 1 FROM cloud_snapshot_jobs j JOIN crawl_tasks t ON t.id=j.task_id WHERE t.status<>'completed' LIMIT 1").first();
    if (snapshot) return { status: 'snapshot_pending' as const };
    const source = `anikoto-cloud:${key}`;
    const existing = await db.prepare("SELECT id,status FROM crawl_runs WHERE source=? OR (source LIKE 'anikoto-cloud:%' AND status IN ('queued','running','paused')) ORDER BY id DESC LIMIT 1").bind(source).first<{ id: number; status: string }>();
    if (existing) return { status: 'existing' as const, runId: existing.id, runStatus: existing.status };
    const observedAt = stamp(); await reserveWriteBudget(db, `refresh-create:${key}`, 120, 0, budget);
    const seeds = [{ key: 'catalogue:1', type: 'catalogue_page', payload: { page: 1, includeProviders: options.includeProviders !== false } }, { key: 'sitemap:index', type: 'sitemap_index', payload: { includeProviders: options.includeProviders !== false } }];
    const inserted = await db.batch([
      db.prepare("INSERT INTO crawl_runs(id,source,mode,status,tasks_discovered,started_at,created_at,updated_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM crawl_runs),?,'incremental','queued',2,?,?,? WHERE NOT EXISTS(SELECT 1 FROM crawl_runs WHERE source=? OR (source LIKE 'anikoto-cloud:%' AND status IN ('queued','running','paused')))").bind(source, observedAt, observedAt, observedAt, source),
      db.prepare("INSERT INTO crawl_tasks(id,run_id,task_key,task_type,payload_json,status,max_attempts,available_at,created_at,updated_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000) FROM crawl_tasks)+CAST(j.key AS INTEGER)+1,r.id,json_extract(j.value,'$.key'),json_extract(j.value,'$.type'),json_extract(j.value,'$.payload'),'pending',5,?,?,? FROM json_each(?) j JOIN crawl_runs r ON r.source=? WHERE true ON CONFLICT(run_id,task_key) DO NOTHING").bind(observedAt, observedAt, observedAt, JSON.stringify(seeds), source),
    ]);
    const run = await db.prepare("SELECT id,status FROM crawl_runs WHERE source=? OR (source LIKE 'anikoto-cloud:%' AND status IN ('queued','running','paused')) ORDER BY id DESC LIMIT 1").bind(source).first<{ id: number; status: string }>();
    return { status: inserted[0].meta.changes ? 'created' as const : 'existing' as const, runId: run?.id, runStatus: run?.status };
  }
  return { ensure };
}

/** Pure source parsers are reused; every mutation/fanout commits under the consumer's D1 lease. */
export function createAnikotoRefreshHandlers(db: CatalogueDatabase, source: ReadSource): SyncHandlers {
  async function catalogue(task: SyncTask): Promise<SyncPlan> {
    const page = Number(task.payload.page); if (!Number.isSafeInteger(page) || page < 1) throw new AppError(422, 'UPSTREAM_CHANGED', 'Catalogue page identifier is invalid.');
    if (task.checkpoint.phase !== 'cards') {
      const html = await source.read(`/filter?page=${page}`, 'text/html');
      const parsed = parseCataloguePage(html); const rawCount = load(html)('div.ani.items > div.item').length;
      if (parsed.titles.length !== rawCount || parsed.titles.length > 30 || page > parsed.lastPage || (page < parsed.lastPage && parsed.titles.length !== 30)) throw new AppError(422, 'UPSTREAM_CHANGED', 'Catalogue card count or pagination changed; discovery was not treated as exhaustion.');
      const observedAt = new Date(source.now()).toISOString();
      const titles = validateSnapshot({ schemaVersion: 1, source: 'anikoto', observedAt, titles: parsed.titles }).titles;
      const pieces = chunks(titles, 3);
      return { statements: [saveParts(db, task.id, pieces, observedAt)], estimatedWrittenRows: pieces.length * 4 + 8, complete: false, checkpoint: { phase: 'cards', nextPart: 0, parts: pieces.length, lastPage: parsed.lastPage, observedAt } };
    }
    const index = Number(task.checkpoint.nextPart); const titles = await part(db, task.id, index) as SnapshotTitle[]; const observedAt = String(task.checkpoint.observedAt);
    const checked = validateSnapshot({ schemaVersion: 1, source: 'anikoto', observedAt, titles }).titles;
    const statements = checked.flatMap(title => titleStatements(db, title, observedAt));
    const entries: Fanout[] = checked.map(title => ({ key: `title:${title.sourceId}`, type: 'title_detail', payload: { sourceId: title.sourceId, includeProviders: task.payload.includeProviders !== false } }));
    const complete = index + 1 >= Number(task.checkpoint.parts);
    if (complete && page < Number(task.checkpoint.lastPage)) entries.push({ key: `catalogue:${page + 1}`, type: 'catalogue_page', payload: { page: page + 1, includeProviders: task.payload.includeProviders !== false } });
    statements.push(fanout(db, task, entries, observedAt));
    if (complete) statements.push(db.prepare('DELETE FROM cloud_sync_payloads WHERE task_id=?').bind(task.id));
    return { statements, estimatedWrittenRows: checked.reduce((sum, title) => sum + 80 + (title.aliases?.length ?? 0) * 6 + (title.genres?.length ?? 0) * 10 + (title.related?.length ?? 0) * 8, 0) + (complete ? Number(task.checkpoint.parts) * 4 : 0), complete, checkpoint: { ...task.checkpoint, nextPart: index + 1, cardsImported: (Number(task.checkpoint.cardsImported) || 0) + checked.length } };
  }
  async function titleDetail(task: SyncTask): Promise<SyncPlan> {
    if (task.checkpoint.phase !== 'inventory') {
      let fallback: SnapshotTitle | null = null;
      if (task.taskType === 'title_detail') fallback = await db.prepare("SELECT source_id AS sourceId,slug,canonical_url AS canonicalUrl,name,description,format,release_year AS releaseYear,status,artwork_url AS artworkUrl,artwork_origin AS artworkOrigin FROM titles WHERE source='anikoto' AND source_id=?").bind(text(task.payload.sourceId)).first<SnapshotTitle>();
      const canonical = route(fallback?.canonicalUrl ?? task.payload.canonicalUrl);
      if (!canonical) throw new AppError(422, 'UPSTREAM_CHANGED', 'The title task has no verified public watch route.');
      const html = await source.read(new URL(canonical).pathname, 'text/html'); const $ = load(html); const main = $('#watch-main');
      const sourceId = text(main.attr('data-id')); const name = text(main.find('h1.title').first().text());
      if (main.length !== 1 || !sourceId || !name || (fallback && sourceId !== fallback.sourceId)) throw new AppError(422, 'UPSTREAM_CHANGED', 'The title page did not expose the expected public identity.');
      if (!fallback) fallback = await db.prepare("SELECT source_id AS sourceId,slug,canonical_url AS canonicalUrl,name,description,format,release_year AS releaseYear,status FROM titles WHERE source='anikoto' AND source_id=?").bind(sourceId).first<SnapshotTitle>();
      const title = parseTitlePage(html, { ...(fallback ?? {}), sourceId, slug: decodeURIComponent(new URL(canonical).pathname.split('/')[2]), canonicalUrl: canonical, name, episodes: [] });
      const raw = await source.read(`/ajax/episode/list/${encodeURIComponent(sourceId)}?vrf=`, 'application/json');
      let envelope: { status?: unknown; result?: unknown }; try { envelope = JSON.parse(raw); } catch { throw new AppError(422, 'UPSTREAM_CHANGED', 'Episode response was not JSON.'); }
      if (envelope.status !== 200 || typeof envelope.result !== 'string') throw new AppError(422, 'UPSTREAM_CHANGED', 'Episode response shape changed.');
      const state = classifyEpisodeList(envelope.result);
      if (state === 'delayed') throw new SyncSourceError('Episode inventory is still loading; prior records were preserved.', 'UNAVAILABLE', true, 60);
      if (state === 'unknown') throw new AppError(422, 'UPSTREAM_CHANGED', 'Episode inventory had no verified populated or empty structure.');
      const work = parseEpisodeList(envelope.result, title);
      if (work.length !== load(envelope.result)('a[data-id][data-num]').length || work.some(entry => entry.serversRef && entry.serversRef.length > 12_000)) throw new AppError(422, 'UPSTREAM_CHANGED', 'Episode parser did not retain every observed record.');
      const observedAt = new Date(source.now()).toISOString();
      validateSnapshot({ schemaVersion: 1, source: 'anikoto', observedAt, titles: [{ ...title, episodes: work.map(entry => entry.episode) }] });
      const pieces = chunks(work, 8);
      return { statements: [...titleStatements(db, title, observedAt), saveParts(db, task.id, pieces.length ? pieces : [[]], observedAt)], estimatedWrittenRows: 160 + (title.aliases?.length ?? 0) * 6 + (title.genres?.length ?? 0) * 10 + (title.related?.length ?? 0) * 8 + Math.max(1, pieces.length) * 4, complete: false, checkpoint: { phase: 'inventory', nextPart: 0, parts: Math.max(1, pieces.length), sourceId, observedAt, episodeCount: work.length } };
    }
    const index = Number(task.checkpoint.nextPart); const sourceId = text(task.checkpoint.sourceId); const observedAt = text(task.checkpoint.observedAt);
    const work = await part(db, task.id, index) as EpisodeWork[];
    if (!Array.isArray(work) || work.length > 8) throw new AppError(422, 'UPSTREAM_CHANGED', 'The episode fragment is malformed.');
    const serialized = JSON.stringify(work);
    const statements = [
      db.prepare("INSERT INTO episodes(id,title_id,source_id,number_text,number_sort,label,slug,canonical_url,episode_type,availability_state,first_seen_at,last_seen_at,last_successful_import_at,created_at,updated_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000) FROM episodes)+CAST(j.key AS INTEGER)+1,t.id,json_extract(j.value,'$.episode.sourceId'),json_extract(j.value,'$.episode.number'),json_extract(j.value,'$.episode.numberSort'),json_extract(j.value,'$.episode.label'),json_extract(j.value,'$.episode.slug'),json_extract(j.value,'$.episode.canonicalUrl'),COALESCE(json_extract(j.value,'$.episode.episodeType'),'regular'),'observed',?,?,?,?,? FROM json_each(?) j JOIN titles t ON t.source='anikoto' AND t.source_id=? WHERE true ON CONFLICT(title_id,source_id) DO UPDATE SET number_text=excluded.number_text,number_sort=excluded.number_sort,label=COALESCE(excluded.label,episodes.label),slug=excluded.slug,canonical_url=excluded.canonical_url,last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,updated_at=excluded.updated_at,availability_state='observed' WHERE julianday(excluded.updated_at)>=julianday(episodes.updated_at)").bind(observedAt, observedAt, observedAt, observedAt, observedAt, serialized, sourceId),
      db.prepare("INSERT INTO episode_versions(id,episode_id,source_id,language,version_label,audio_language,subtitle_language,availability_state,first_seen_at,last_seen_at,last_successful_import_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000) FROM episode_versions)+ROW_NUMBER() OVER(),e.id,json_extract(v.value,'$.sourceId'),json_extract(v.value,'$.language'),json_extract(v.value,'$.label'),json_extract(v.value,'$.audioLanguage'),json_extract(v.value,'$.subtitleLanguage'),json_extract(v.value,'$.availability'),?,?,? FROM json_each(?) j JOIN json_each(j.value,'$.episode.versions') v JOIN episodes e ON e.source_id=json_extract(j.value,'$.episode.sourceId') JOIN titles t ON t.id=e.title_id AND t.source='anikoto' AND t.source_id=? WHERE true ON CONFLICT(episode_id,source_id,language) DO UPDATE SET last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,availability_state=excluded.availability_state WHERE episode_versions.last_successful_import_at IS NULL OR julianday(excluded.last_successful_import_at)>=julianday(episode_versions.last_successful_import_at)").bind(observedAt, observedAt, observedAt, serialized, sourceId),
    ];
    const missingRefs = work.filter(entry => !entry.serversRef).map(entry => entry.episode.sourceId);
    let affectedMappings = 0;
    if (missingRefs.length) {
      affectedMappings = Number((await db.prepare("SELECT COUNT(*) AS count FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id JOIN episodes e ON e.id=v.episode_id JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=? AND e.source_id IN (SELECT value FROM json_each(?)) AND m.mapping_origin='native' AND m.resolution_evidence_state<>'playback_verified'").bind(sourceId, JSON.stringify(missingRefs)).first<{ count: number }>())?.count ?? 0);
      statements.push(db.prepare("UPDATE episode_provider_mappings SET availability_state='unknown',unavailable_reason='The latest episode inventory exposes no server reference; prior mapping retained.',updated_at=? WHERE mapping_origin='native' AND resolution_evidence_state<>'playback_verified' AND julianday(updated_at)<=julianday(?) AND version_id IN (SELECT v.id FROM episode_versions v JOIN episodes e ON e.id=v.episode_id JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=? AND e.source_id IN (SELECT value FROM json_each(?)))").bind(observedAt, observedAt, sourceId, JSON.stringify(missingRefs)));
    }
    const entries: Fanout[] = task.payload.includeProviders === false ? [] : work.filter(entry => entry.serversRef).map(entry => ({ key: `servers:${sourceId}:${entry.episode.sourceId}`, type: 'episode_servers', payload: { titleSourceId: sourceId, episodeSourceId: entry.episode.sourceId, serversRef: entry.serversRef } }));
    const complete = index + 1 >= Number(task.checkpoint.parts);
    if (complete) entries.push({ key: `title-reconcile:${sourceId}`, type: 'title_reconcile', payload: { sourceId, observedAt, episodeCount: task.checkpoint.episodeCount } });
    statements.push(fanout(db, task, entries, observedAt));
    if (complete) statements.push(db.prepare('DELETE FROM cloud_sync_payloads WHERE task_id=?').bind(task.id));
    return { statements, estimatedWrittenRows: work.length * 64 + affectedMappings * 8 + 40 + (complete ? Number(task.checkpoint.parts) * 4 : 0), complete, checkpoint: { ...task.checkpoint, nextPart: index + 1 } };
  }
  async function reconcile(task: SyncTask): Promise<SyncPlan> {
    const sourceId = text(task.payload.sourceId); const observedAt = text(task.payload.observedAt); if (!sourceId || !Number.isFinite(Date.parse(observedAt))) throw new AppError(422, 'UPSTREAM_CHANGED', 'Title reconciliation identity is malformed.');
    const kind = text(task.checkpoint.kind) || 'episodes'; const after = Number(task.checkpoint.after ?? 0);
    if (!['episodes', 'versions', 'mappings'].includes(kind) || !Number.isSafeInteger(after) || after < 0) throw new AppError(422, 'UPSTREAM_CHANGED', 'Reconciliation checkpoint is malformed.');
    const select = kind === 'episodes' ? "SELECT e.id FROM episodes e JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=? AND e.id>? AND julianday(e.last_seen_at)<julianday(?) AND julianday(e.updated_at)<=julianday(?) AND NOT EXISTS(SELECT 1 FROM episode_versions v JOIN episode_provider_mappings m ON m.version_id=v.id JOIN native_resources n ON n.mapping_id=m.id WHERE v.episode_id=e.id) ORDER BY e.id LIMIT 35" : kind === 'versions' ? "SELECT v.id FROM episode_versions v JOIN episodes e ON e.id=v.episode_id JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=? AND v.id>? AND julianday(v.last_seen_at)<julianday(?) AND (v.last_successful_import_at IS NULL OR julianday(v.last_successful_import_at)<=julianday(?)) AND NOT EXISTS(SELECT 1 FROM episode_provider_mappings m JOIN native_resources n ON n.mapping_id=m.id WHERE m.version_id=v.id) ORDER BY v.id LIMIT 35" : "SELECT m.id FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id JOIN episodes e ON e.id=v.episode_id JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=? AND m.id>? AND (v.availability_state='stale' OR e.availability_state='stale') AND m.mapping_origin='native' AND julianday(m.last_seen_at)<julianday(?) AND julianday(m.updated_at)<=julianday(?) ORDER BY m.id LIMIT 35";
    const rows = (await db.prepare(select).bind(sourceId, after, observedAt, observedAt).all<{ id: number }>()).results;
    const statements: D1PreparedStatement[] = []; const table = kind === 'episodes' ? 'episodes' : kind === 'versions' ? 'episode_versions' : 'episode_provider_mappings';
    if (rows.length) statements.push(db.prepare(`UPDATE ${table} SET availability_state='stale'${kind === 'versions' ? '' : ',updated_at=?'} WHERE id IN (${rows.map(() => '?').join(',')})`).bind(...(kind === 'versions' ? [] : [observedAt]), ...rows.map(row => row.id)));
    const complete = kind === 'mappings' && rows.length < 35;
    if (complete) statements.push(db.prepare("INSERT INTO verification_observations(id,entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at) VALUES((SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM verification_observations),'title',?,'observed',?,'SOURCE_EPISODE_LIST','public_response',?,?)").bind(sourceId, Number(task.payload.episodeCount) === 0 ? 'empty_episode_inventory' : 'episode_inventory_imported', JSON.stringify({ episodeCount: Number(task.payload.episodeCount), playbackVerified: false }), observedAt));
    return { statements, estimatedWrittenRows: rows.length * 12 + 16, complete, checkpoint: rows.length === 35 ? { kind, after: rows.at(-1)!.id } : { kind: kind === 'episodes' ? 'versions' : 'mappings', after: 0 } };
  }
  async function sitemap(task: SyncTask): Promise<SyncPlan> {
    if (task.checkpoint.phase !== 'fanout') {
      const url = task.taskType === 'sitemap_index' ? `${ORIGIN}/sitemap.xml` : text(task.payload.url);
      const parsedUrl = new URL(url); if (parsedUrl.origin !== ORIGIN || !/^\/sitemap(?:\.xml|\/[a-zA-Z0-9/_-]+\.xml)$/.test(parsedUrl.pathname)) throw new AppError(422, 'UPSTREAM_CHANGED', 'Sitemap route is not allowlisted.');
      const xml = await source.read(parsedUrl.pathname, 'application/xml'); const $ = load(xml, { xmlMode: true });
      const index = $('sitemapindex').length === 1; if (!index && $('urlset').length !== 1) throw new AppError(422, 'UPSTREAM_CHANGED', 'The sitemap XML root changed.');
      const locations = $(index ? 'sitemap loc' : 'url loc').map((_offset, element) => text($(element).text())).get();
      if (!locations.length) throw new AppError(422, 'UPSTREAM_CHANGED', 'The sitemap contained no expected URL records.');
      const entries: Fanout[] = [];
      for (const location of [...new Set(locations)]) {
        if (index) { let child: URL; try { child = new URL(location); } catch { continue; } if (child.origin !== ORIGIN || !/^\/sitemap\/[a-zA-Z0-9/_-]+\.xml$/.test(child.pathname)) continue; const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(child.toString()))), value => value.toString(16).padStart(2, '0')).join(''); entries.push({ key: `sitemap-page:${hash.slice(0, 24)}`, type: 'sitemap_page', payload: { url: child.toString(), includeProviders: task.payload.includeProviders !== false } }); }
        else { const canonicalUrl = route(location); if (canonicalUrl) entries.push({ key: `sitemap-title:${new URL(canonicalUrl).pathname.split('/')[2]}`, type: 'sitemap_title', payload: { canonicalUrl, includeProviders: task.payload.includeProviders !== false } }); }
      }
      const observedAt = new Date(source.now()).toISOString(); const pieces = chunks(entries, 20);
      if (index && !pieces.length) throw new AppError(422, 'UPSTREAM_CHANGED', 'The sitemap index exposed no allowlisted child maps.');
      if (!pieces.length) return { statements: [], estimatedWrittenRows: 0, complete: true, checkpoint: { locationsObserved: locations.length, watchRoutes: 0 } };
      return { statements: [saveParts(db, task.id, pieces, observedAt)], estimatedWrittenRows: pieces.length * 4 + 8, complete: false, checkpoint: { phase: 'fanout', nextPart: 0, parts: pieces.length, observedAt, locationsObserved: locations.length } };
    }
    const index = Number(task.checkpoint.nextPart); const entries = await part(db, task.id, index) as Fanout[];
    const complete = index + 1 >= Number(task.checkpoint.parts);
    return { statements: [fanout(db, task, entries, String(task.checkpoint.observedAt)), ...(complete ? [db.prepare('DELETE FROM cloud_sync_payloads WHERE task_id=?').bind(task.id)] : [])], estimatedWrittenRows: entries.length * 16 + 16 + (complete ? Number(task.checkpoint.parts) * 4 : 0), complete, checkpoint: { ...task.checkpoint, nextPart: index + 1 } };
  }
  return { catalogue_page: catalogue, title_detail: titleDetail, sitemap_title: titleDetail, sitemap_index: sitemap, sitemap_page: sitemap, title_reconcile: reconcile };
}

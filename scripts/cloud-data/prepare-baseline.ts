import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { BASELINE_EPISODE_PAGE_SIZE, BASELINE_MAX_BUCKET_SIZE, BASELINE_MAX_FILES, BASELINE_MAX_FILE_BYTES, BASELINE_MAX_INDEX_BYTES, baselineHashBucket, baselineNumericBucket, baselinePath, validateBaselineManifest, type BaselineBrowseRow, type BaselineEpisode, type BaselineEpisodePage, type BaselineFileRef, type BaselineManifest, type BaselineMapping, type BaselinePostings, type BaselineRow, type BaselineTitle } from '../../server/cloud/data/baseline-schema.ts';
import type { ApprovedNativeResource } from '../../server/providers/native.ts';

type SqlRow = Record<string, string | number | null>;
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
async function fileHash(path: string) { const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest('hex'); }
const text = (value: unknown): string | null => value == null ? null : String(value);
const dictionary = <T>(): Record<string,T> => Object.create(null) as Record<string,T>;
const group = <T>(rows: T[], key: (row: T) => string) => { const map = new Map<string, T[]>(); for (const row of rows) { const id = key(row); const items = map.get(id) ?? []; items.push(row); map.set(id, items); } return map; };
function stableUrl(value: unknown) { if (!value) return null; try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href : null; } catch { return null; } }
function stableEvidenceUrl(value: unknown) { if (!value) return null; try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.href.length <= 2048 ? url.href : null; } catch { return null; } }
function stableResource(value: unknown) { if (value == null) return null; const item = String(value); if (item.length > 4096 || /[\r\n]/.test(item)) return null; return /^https?:/i.test(item) ? stableUrl(item) : item; }
const capabilities = (value: unknown) => { let parsed: Record<string, unknown> = {}; try { parsed = JSON.parse(String(value)); } catch { /* No unknown capabilities are enabled. */ } return Object.fromEntries(['embed','seek','volume','fullscreen','subtitles','qualitySelection','progressEvents'].map(key => [key, parsed?.[key] === true])); };
function countFiles(path: string): number { return readdirSync(path, { withFileTypes: true }).reduce((sum, item) => { if (item.isSymbolicLink()) throw new Error('Asset directories must not contain symbolic links.'); return sum + (item.isDirectory() ? countFiles(join(path, item.name)) : 1); }, 0); }

export interface PrepareBaselineOptions { existingAssetFiles?: number; existingAssetsPath?: string; reservedAssetFiles?: number; createdAt?: string; }
/** Read-only preparation; publishes a manifest only after every identity, count and bound passes. */
export async function prepareBaseline(sourcePath: string, outputPath: string, options: PrepareBaselineOptions = {}) {
  sourcePath = resolve(sourcePath); outputPath = resolve(outputPath);
  if (existsSync(outputPath)) throw new Error('Baseline output already exists; choose a fresh directory.');
  if (!existsSync(sourcePath)) throw new Error('Source database does not exist.');
  if (existsSync(`${sourcePath}-wal`) && statSync(`${sourcePath}-wal`).size > 0) throw new Error('Use a checkpointed database backup; a nonempty WAL cannot be represented by the database file hash.');
  const existing = options.existingAssetsPath ? countFiles(resolve(options.existingAssetsPath)) : options.existingAssetFiles ?? 0;
  const reserve = options.reservedAssetFiles ?? 1000;
  if (![existing, reserve].every(value => Number.isSafeInteger(value) && value >= 0) || existing + reserve >= BASELINE_MAX_FILES) throw new Error('Invalid aggregate asset allowance.');
  const sourceHash = await fileHash(sourcePath);
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  const files = new Map<string, string>();
  const refs: Record<string, BaselineFileRef> = {};
  const add = (relative: string, data: unknown, maximum = BASELINE_MAX_FILE_BYTES) => {
    const path = baselinePath(sourceHash, relative); const body = JSON.stringify(data); const bytes = Buffer.byteLength(body);
    if (bytes > maximum) throw new Error(`Baseline payload ${relative} exceeds its ${maximum}-byte runtime bound.`);
    if (files.has(path)) throw new Error('Duplicate baseline asset path.');
    files.set(path, body); const ref = { path, sha256: hash(body), bytes }; refs[path] = ref; return ref;
  };
  try {
    db.exec('BEGIN');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source database failed integrity verification.');
    const all = (sql: string) => db.prepare(sql).all() as SqlRow[];
    const titleRows = all('SELECT id,source,source_id,slug,canonical_url,name,description,format,release_year,status,artwork_url,artwork_origin,artwork_reuse_status,availability_state,first_seen_at,last_seen_at,last_successful_import_at,updated_at FROM titles ORDER BY id');
    const episodeRows = all('SELECT id,title_id,source_id,number_text,number_sort,label,slug,episode_type,availability_state FROM episodes ORDER BY number_sort IS NULL,number_sort,number_text,id');
    const versionRows = all('SELECT id,episode_id,source_id,language,version_label,availability_state FROM episode_versions ORDER BY CASE language WHEN \'sub\' THEN 0 WHEN \'dub\' THEN 1 ELSE 2 END,id');
    const mappingRows = all('SELECT m.id,m.version_id,m.provider_id,m.source_mapping_id,m.provider_resource_id,m.canonical_embed_url,m.mapping_origin,m.availability_state,m.unavailable_reason,m.first_seen_at,m.last_seen_at,m.last_successful_import_at,m.last_successful_resolution_at,m.last_playback_verification_at,p.label,p.playback_type,p.capabilities_json FROM episode_provider_mappings m JOIN providers p ON p.id=m.provider_id ORDER BY p.label,m.id');
    const resourceRows = new Map(all('SELECT mapping_id,provider_id,resource_id,language,edition,license,rights_evidence_url,identity_evidence_url,approved_at,enabled,content_sha1 FROM native_resources ORDER BY mapping_id').map(row => [String(row.mapping_id), row]));
    const aliases = group(all('SELECT title_id,alias,language,alias_type FROM title_aliases ORDER BY alias'), row => String(row.title_id));
    const genres = group(all('SELECT tg.title_id,g.slug,g.name FROM title_genres tg JOIN genres g ON g.id=tg.genre_id ORDER BY g.name'), row => String(row.title_id));
    const related = group(all('SELECT rt.title_id,rt.related_source_id AS sourceId,rt.relationship_type AS relationshipType,rt.label,rt.source_url AS sourceUrl,CAST(t.id AS TEXT) AS id,t.slug,t.name,t.format AS type,t.release_year AS releaseYear,t.status,t.artwork_url AS imageUrl,t.availability_state AS availability FROM related_titles rt LEFT JOIN titles t ON t.id=rt.related_title_id ORDER BY rt.relationship_type,COALESCE(t.name,rt.label,rt.related_source_id)'), row => String(row.title_id));
    const providerAliases = group(all('SELECT provider_id,alias FROM provider_aliases ORDER BY alias'), row => String(row.provider_id));
    const byTitle = group(episodeRows, row => String(row.title_id)); const byEpisode = group(versionRows, row => String(row.episode_id)); const byVersion = group(mappingRows, row => String(row.version_id));
    const titles: Record<string, BaselineTitle> = {}; const episodes: Record<string, BaselineEpisode> = {}; const mappings: Record<string, BaselineMapping> = {}; const browse: Record<string, BaselineBrowseRow> = {}; const slugBuckets: Record<string, Record<string,string>> = {};
    const versionLookup = new Map(versionRows.map(row => [String(row.id), row]));
    for (const row of mappingRows) {
      const version = versionLookup.get(String(row.version_id)); if (!version) throw new Error('Mapping references an absent version.');
      const resource = stableResource(row.provider_resource_id); const embed = stableUrl(row.canonical_embed_url);
      const approval = resourceRows.get(String(row.id));
      const rightsEvidenceUrl = approval ? stableEvidenceUrl(approval.rights_evidence_url) : null;
      const identityEvidenceUrl = approval ? stableEvidenceUrl(approval.identity_evidence_url) : null;
      const approvedResource: ApprovedNativeResource | null = approval && resource && rightsEvidenceUrl && identityEvidenceUrl
        ? { mapping_id: Number(approval.mapping_id), provider_id: String(approval.provider_id), resource_id: resource, language: String(approval.language), edition: String(approval.edition), license: String(approval.license), rights_evidence_url: rightsEvidenceUrl, identity_evidence_url: identityEvidenceUrl, approved_at: String(approval.approved_at), enabled: Number(approval.enabled), content_sha1: text(approval.content_sha1) }
        : null;
      const resourceOmittedReason = approval && !approvedResource
        ? 'UNSTABLE_OR_UNSAFE_APPROVAL_REFERENCE'
        : (row.provider_resource_id && !resource) || (row.canonical_embed_url && !embed)
          ? 'UNSTABLE_OR_UNSAFE_RESOURCE_REFERENCE'
          : null;
      mappings[String(row.id)] = { mapping: { mappingId: Number(row.id), providerId: String(row.provider_id), label: String(row.label), edition: approvedResource?.edition ?? null, language: String(version.language), providerResourceId: resource, canonicalEmbedUrl: embed, availability: String(row.availability_state) as BaselineMapping['mapping']['availability'], unavailableReason: text(row.unavailable_reason) }, resource: approvedResource, provenance: { sourceMappingId: text(row.source_mapping_id), mappingOrigin: text(row.mapping_origin), firstSeen: text(row.first_seen_at), lastSeen: text(row.last_seen_at), lastSuccessfulImport: text(row.last_successful_import_at), resourceOmittedReason } };
    }
    const observedEmpty = new Set(all("SELECT entity_id FROM verification_observations WHERE entity_type='title' AND result='empty_episode_inventory'").map(row => String(row.entity_id)));
    const pendingInventory = new Set(all("SELECT json_extract(payload_json,'$.sourceId') AS sourceId FROM crawl_tasks WHERE task_type='title_detail' AND status<>'completed'").map(row => String(row.sourceId)));
    for (const row of titleRows) {
      const id = String(row.id); baselineNumericBucket(id); const slug = String(row.slug);
      if (!slug || slug.length > 500) throw new Error('Invalid title slug.');
      const slugBucket = baselineHashBucket(slug, 256); const slugMap = slugBuckets[slugBucket] ??= dictionary<string>();
      if (Object.hasOwn(slugMap, slug)) throw new Error('Duplicate title slug.'); slugMap[slug] = id;
      const titleEpisodes = byTitle.get(id) ?? []; const collectionState = observedEmpty.has(String(row.source_id)) ? 'complete' : titleEpisodes.length ? pendingInventory.has(String(row.source_id)) ? 'partial' : 'complete' : 'pending';
      const title: BaselineRow = { id, source: row.source, sourceId: row.source_id, slug, canonicalUrl: stableUrl(row.canonical_url), name: row.name, description: row.description, synopsis: row.description, format: row.format, type: row.format, releaseYear: row.release_year, status: row.status, artworkUrl: stableUrl(row.artwork_url), imageUrl: stableUrl(row.artwork_url), artworkOrigin: stableUrl(row.artwork_origin), artworkReuseStatus: row.artwork_reuse_status, availability: row.availability_state, firstSeen: row.first_seen_at, lastSeen: row.last_seen_at, lastSuccessfulImport: row.last_successful_import_at, updatedAt: row.updated_at, episodeCount: titleEpisodes.length, collectionState };
      const apiAliases = (aliases.get(id) ?? []).map(a => ({ name: a.alias, language: a.language || null, type: a.alias_type })); const apiGenres = (genres.get(id) ?? []).map(g => ({ slug: g.slug, name: g.name }));
      const apiEpisodes: BaselineRow[] = []; const languageSet = new Set<string>();
      for (const [index, episode] of titleEpisodes.entries()) {
        const apiEpisode: BaselineRow = { id: String(episode.id), sourceId: episode.source_id, number: episode.number_text, label: episode.label, slug: episode.slug, type: episode.episode_type, availability: episode.availability_state };
        const variants = (byEpisode.get(String(episode.id)) ?? []).map(version => {
          languageSet.add(String(version.language)); const rows = byVersion.get(String(version.id)) ?? [];
          const apiVersion = { id: String(version.id), sourceId: version.source_id, language: version.language, label: version.version_label, availability: version.availability_state, providerCount: rows.length };
          const providers = rows.map(mapping => ({ mappingId: String(mapping.id), providerId: String(mapping.provider_id), label: mapping.label, edition: resourceRows.get(String(mapping.id))?.edition ?? null, playbackType: mapping.playback_type, status: mapping.availability_state, capabilities: capabilities(mapping.capabilities_json), lastSuccessfulResolution: mapping.last_successful_resolution_at, lastPlaybackVerification: mapping.last_playback_verification_at, reason: mapping.unavailable_reason, aliases: (providerAliases.get(String(mapping.provider_id)) ?? []).map(a => String(a.alias)) }));
          return { version: apiVersion, providers };
        });
        apiEpisodes.push({ ...apiEpisode, versions: variants.map(v => v.version) });
        episodes[String(episode.id)] = { titleId: id, page: Math.floor(index / BASELINE_EPISODE_PAGE_SIZE), episode: { ...apiEpisode, titleSlug: slug, titleName: row.name }, versions: variants };
      }
      const episodePages: string[] = [];
      for (let index = 0; index < apiEpisodes.length; index += BASELINE_EPISODE_PAGE_SIZE) { const page = index / BASELINE_EPISODE_PAGE_SIZE; const data: BaselineEpisodePage = { titleId: id, page, pageSize: 100, total: apiEpisodes.length, episodes: apiEpisodes.slice(index, index + BASELINE_EPISODE_PAGE_SIZE) }; episodePages.push(add(`episode-pages/${id}/${String(page).padStart(6,'0')}.json`, data).path); }
      titles[id] = { collectionState, title, aliases: apiAliases, genres: apiGenres, related: (related.get(id) ?? []).map(({ title_id: _parent, ...item }) => ({ ...item, sourceUrl: stableUrl(item.sourceUrl), imageUrl: stableUrl(item.imageUrl) })), episodePages };
      const summary = text(row.description)?.slice(0,300) ?? null;
      browse[id] = { id, source: String(row.source), slug, name: String(row.name), aliases: apiAliases.map(a => String(a.name)), genres: apiGenres.map(g => String(g.slug)), type: text(row.format)?.toLowerCase() ?? null, status: text(row.status)?.toLowerCase() ?? null, languages: [...languageSet].sort(), episodeCount: apiEpisodes.length, releaseYear: row.release_year == null ? null : Number(row.release_year), updatedAt: text(row.updated_at), card: {source:row.source,sourceId:row.source_id,canonicalUrl:stableUrl(row.canonical_url),synopsis:summary,type:row.format,status:row.status,artworkUrl:stableUrl(row.artwork_url),availability:row.availability_state} };
    }
    const counts: Record<string, number> = { titles: titleRows.length, episodes: episodeRows.length, versions: versionRows.length, mappings: mappingRows.length };
    if (Object.keys(episodes).length !== counts.episodes || Object.keys(mappings).length !== counts.mappings || Object.values(episodes).reduce((sum,item) => sum + item.versions.length,0) !== counts.versions) throw new Error('Baseline row identities do not reconcile with source counts.');
    for (const [name, actual] of Object.entries({titles: counts.titles, episodes: counts.episodes, episode_versions: counts.versions, episode_provider_mappings: counts.mappings})) if (Number(db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count) !== actual) throw new Error(`Baseline count mismatch for ${name}.`);
    const bucketSpans: BaselineManifest['bucketSpans'] = { titles: 64, browse: 64, episodes: 64, mappings: 64 };
    for (const [kind, records] of Object.entries({titles,browse,episodes,mappings})) {
      // Start at the largest reader-supported span and halve only when the
      // encoded payload would exceed the checked per-file byte ceiling. The
      // earlier fixed 64-row start needlessly consumed thousands of asset
      // entries for large, compact mapping inventories.
      let span = BASELINE_MAX_BUCKET_SIZE; let buckets: Record<string, Record<string,unknown>>;
      while (true) { buckets = {}; for (const [id,item] of Object.entries(records)) (buckets[baselineNumericBucket(id,span)] ??= {})[id] = item; if (Object.values(buckets).every(data => Buffer.byteLength(JSON.stringify(data)) <= BASELINE_MAX_FILE_BYTES)) break; span /= 2; if (span < 1) throw new Error(`An individual ${kind} record exceeds the runtime payload bound.`); }
      bucketSpans[kind as keyof typeof bucketSpans] = span;
      for (const [bucket,data] of Object.entries(buckets)) add(`${kind}/${bucket}.json`,data);
    }
    for (const [bucket,data] of Object.entries(slugBuckets)) add(`slugs/${bucket}.json`,data);
    const list = Object.values(browse); const postings: BaselinePostings = { genres:dictionary<string[]>(),languages:dictionary<string[]>(),types:dictionary<string[]>(),statuses:dictionary<string[]>(),sources:dictionary<string[]>(),orders:{name:[],newest:[],oldest:[],updated:[],episodes:[]},episodeCounts:Object.fromEntries(Object.values(browse).map(row=>[row.id,row.episodeCount])) };
    for (const row of list) for (const [kind, values] of [['genres',row.genres],['languages',row.languages],['types',row.type ? [row.type] : []],['statuses',row.status ? [row.status] : []],['sources',[row.source]]] as const) for (const value of values) {
      const group = postings[kind];
      if (!group) throw new Error(`Missing baseline posting group: ${kind}`);
      (group[value] ??= []).push(row.id);
    }
    const nameOrder = (a: BaselineBrowseRow,b: BaselineBrowseRow) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : Number(a.id)-Number(b.id);
    const comparators: Record<keyof BaselinePostings['orders'], (a: BaselineBrowseRow,b: BaselineBrowseRow)=>number> = { name: nameOrder, newest: (a,b)=>(b.releaseYear ?? -Infinity)-(a.releaseYear ?? -Infinity) || nameOrder(a,b), oldest:(a,b)=>(a.releaseYear ?? Infinity)-(b.releaseYear ?? Infinity) || nameOrder(a,b), updated:(a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)) || Number(b.id)-Number(a.id), episodes:(a,b)=>b.episodeCount-a.episodeCount || nameOrder(a,b) };
    for (const kind of Object.keys(comparators) as Array<keyof typeof comparators>) postings.orders[kind] = [...list].sort(comparators[kind]).map(row=>row.id);
    const postingsRef = add('indexes/postings.json',postings,BASELINE_MAX_INDEX_BYTES);
    const searchRef = add('indexes/search.json',list.map(row=>[row.id,[row.name,...row.aliases].join('\n').toLowerCase()]),BASELINE_MAX_INDEX_BYTES);
    const referenceShards: Record<string, BaselineFileRef> = {}; const shardData: Record<string,Record<string,BaselineFileRef>> = {};
    for (const [path,ref] of Object.entries(refs)) (shardData[baselineHashBucket(path)] ??= {})[path] = ref;
    for (const [bucket,data] of Object.entries(shardData)) referenceShards[bucket] = add(`references/${bucket}.json`,data);
    const labelMap = new Map(all('SELECT slug,name FROM genres').map(row=>[String(row.slug),String(row.name)]));
    const facets = { genres:Object.entries(postings.genres).map(([value,ids])=>({value,label:labelMap.get(value) ?? value,count:ids.length})), types:Object.entries(postings.types).map(([value,ids])=>({value,label:String(titleRows.find(row=>String(row.format).toLowerCase()===value)?.format ?? value),count:ids.length})), statuses:Object.entries(postings.statuses).map(([value,ids])=>({value,label:String(titleRows.find(row=>String(row.status).toLowerCase()===value)?.status ?? value),count:ids.length})), languages:Object.entries(postings.languages).map(([value,ids])=>({value,label:value.toUpperCase(),count:ids.length})) };
    const schema = Number(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version ?? 0);
    db.exec('COMMIT');
    if (await fileHash(sourcePath) !== sourceHash || (existsSync(`${sourcePath}-wal`) && statSync(`${sourcePath}-wal`).size > 0)) throw new Error('Source changed during baseline preparation; no output was published.');
    const manifest: BaselineManifest = { version:1,kind:'solanime-private-catalogue-baseline',id:sourceHash,createdAt:options.createdAt ?? new Date().toISOString(),sourceDatabaseSha256:sourceHash,sourceSchemaVersion:schema,counts,bucketSpans,episodePageSize:100,maxFileBytes:BASELINE_MAX_FILE_BYTES,files:files.size+1,aggregateFiles:files.size+1+existing,bytes:[...files.values()].reduce((sum,body)=>sum+Buffer.byteLength(body),0),referenceShards,fastRefs:Object.fromEntries(Object.entries(refs).filter(([path])=>path.includes('/browse/'))),postings:postingsRef,search:searchRef,facets,exclusions:['accounts','authentication credentials','crawl tasks','research dump','temporary playback resolutions','mutable native enablement overrides'] };
    if (manifest.aggregateFiles + reserve > BASELINE_MAX_FILES) throw new Error('Baseline plus preserved assets exceeds the reserved free asset allowance.');
    validateBaselineManifest(manifest);
    const body = JSON.stringify(manifest); if (Buffer.byteLength(body)>BASELINE_MAX_FILE_BYTES) throw new Error('Baseline root manifest exceeds its runtime bound.');
    mkdirSync(outputPath,{recursive:true});
    for(const [path,value] of files) { const target=join(outputPath,path.slice(1)); mkdirSync(dirname(target),{recursive:true}); writeFileSync(target,value,{encoding:'utf8',flag:'wx',mode:0o600}); }
    const manifestPath=join(outputPath,'__private-baseline',sourceHash,'manifest.json'); writeFileSync(manifestPath,body,{encoding:'utf8',flag:'wx',mode:0o600});
    return {manifest,manifestPath,manifestSha256:hash(body)};
  } finally { db.close(); }
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const option=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
  const source=option('source-db'),output=option('out'); if(!source||!output)throw new Error('Use --source-db=<checkpointed SQLite> --out=<fresh private asset directory> --existing-assets=<preserved private assets directory>.');
  const result=await prepareBaseline(source,output,{existingAssetsPath:option('existing-assets')}); console.log(JSON.stringify({manifestPath:result.manifestPath,manifestSha256:result.manifestSha256,counts:result.manifest.counts,files:result.manifest.files,aggregateFiles:result.manifest.aggregateFiles,bytes:result.manifest.bytes,bucketSpans:result.manifest.bucketSpans},null,2));
}

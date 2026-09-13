import type { D1Database } from '@cloudflare/workers-types';
import type { BrowseParams } from '../../catalogue.ts';
import type { StoredProviderMapping } from '../../providers/contract.ts';
import type { ApprovedNativeResource } from '../../providers/native.ts';
import { AppError } from '../../errors.ts';
import { decorateCloudArtwork } from '../../artwork/catalogue.ts';
import type { createPrivateBaselineReader } from './baseline.ts';
import { isCatalogueScope, sourcesForCatalogueScope } from '../../../shared/catalogue-scope.ts';

type Row = Record<string, unknown>;
export type CatalogueDatabase = Pick<D1Database, 'prepare' | 'batch'>;
const json = (value: unknown, fallback: unknown = {}): unknown => {
  try { return JSON.parse(String(value)); } catch { return fallback; }
};
const rows = async (db: CatalogueDatabase, sql: string, ...values: unknown[]) =>
  (await db.prepare(sql).bind(...values).all<Row>()).results;

/** Request-scoped repository: no cross-request mutable cache or SQLite filesystem dependency. */
export function createCatalogueRepository(db: CatalogueDatabase, baseline?: ReturnType<typeof createPrivateBaselineReader>) {
  const titleSelect = 'SELECT CAST(t.id AS TEXT) AS id,t.source,t.source_id AS sourceId,t.slug,t.canonical_url AS canonicalUrl,t.name,t.description,t.description AS synopsis,t.format,t.format AS type,t.release_year AS releaseYear,t.status,t.updated_at AS updatedAt,t.artwork_url AS artworkUrl,t.artwork_url AS imageUrl,t.availability_state AS availability,(SELECT COUNT(*) FROM episodes e WHERE e.title_id=t.id) AS episodeCount';
  const canonicalIdentity = (row: Row) => {
    const source = typeof row.source === 'string' ? row.source.trim().toLowerCase() : '';
    const sourceId = typeof row.sourceId === 'string' || typeof row.sourceId === 'number' ? String(row.sourceId).trim() : '';
    return source && sourceId ? `${source}\u0000${sourceId}` : null;
  };
  const normalizedId = (row: Row) => {
    const value = String(row.id ?? '').trim();
    return /^[0-9]+$/.test(value) ? value.replace(/^0+(?=\d)/, '') : value;
  };
  const identityTie = (left: Row, right: Row) => (canonicalIdentity(left) ?? `id\u0000${normalizedId(left)}`).localeCompare(canonicalIdentity(right) ?? `id\u0000${normalizedId(right)}`);
  const nameCompare = (left: Row, right: Row) => {
    const a = String(left.name ?? '').toLowerCase(), b = String(right.name ?? '').toLowerCase();
    return a < b ? -1 : a > b ? 1 : Number(left.id) - Number(right.id) || identityTie(left, right);
  };
  const compareBrowseRows = (sort: string) => (left: Row, right: Row) => {
    const aYear = left.releaseYear === null || left.releaseYear === undefined ? null : Number(left.releaseYear);
    const bYear = right.releaseYear === null || right.releaseYear === undefined ? null : Number(right.releaseYear);
    if (sort === 'newest' || sort === 'year_desc') return (bYear ?? -Infinity) - (aYear ?? -Infinity) || nameCompare(left, right);
    if (sort === 'oldest' || sort === 'year_asc') return (aYear ?? Infinity) - (bYear ?? Infinity) || nameCompare(left, right);
    if (sort === 'updated') return String(right.updatedAt).localeCompare(String(left.updatedAt)) || Number(right.id) - Number(left.id) || identityTie(left, right);
    if (sort === 'episodes') return Number(right.episodeCount) - Number(left.episodeCount) || nameCompare(left, right);
    return nameCompare(left, right);
  };
  const mergeFacets = (left: Record<string, unknown[]> | undefined, right: Record<string, unknown[]> | undefined) => {
    if (!left && !right) return undefined;
    const result: Record<string, Row[]> = {};
    for (const kind of ['genres', 'types', 'statuses', 'languages']) {
      const combined = new Map<string, Row>();
      for (const row of [...((left?.[kind] ?? []) as Row[]), ...((right?.[kind] ?? []) as Row[])]) {
        const key = String(row.value ?? '');
        const previous = combined.get(key);
        combined.set(key, { ...previous, ...row, count: Number(previous?.count ?? 0) + Number(row.count ?? 0) });
      }
      result[kind] = [...combined.values()].sort((a, b) => String(a.label ?? a.value).localeCompare(String(b.label ?? b.value)));
    }
    return result;
  };
  const sourceClause = (sources: readonly string[], excludedSources: readonly string[] = []) => sources.length
    ? `LOWER(t.source) IN (${sources.map(() => '?').join(',')})`
    : excludedSources.length ? `LOWER(t.source) NOT IN (${excludedSources.map(() => '?').join(',')})` : '1=1';
  const sameIdentity = (left: Row, right: Row) => {
    const a = canonicalIdentity(left), b = canonicalIdentity(right);
    return a && b ? a === b : Boolean(normalizedId(left) && normalizedId(left) === normalizedId(right));
  };
  const baselineCard = (value: Awaited<ReturnType<NonNullable<typeof baseline>['browseRow']>>) => {
    if (!value) return null;
    const { card, aliases: _aliases, genres: _genres, languages: _languages, ...summary } = value;
    return { ...summary, ...card, imageUrl: card.artworkUrl, description: card.synopsis, format: card.type } as Row;
  };

  async function getD1Filters(sources: readonly string[], excludedSources: readonly string[] = []) {
    const clause = sourceClause(sources, excludedSources), values = (sources.length ? sources : excludedSources).map(source => source.toLowerCase());
    const result = await db.batch<Row>([
      db.prepare(`SELECT g.slug AS value,g.name AS label,COUNT(*) AS count FROM genres g JOIN title_genres tg ON tg.genre_id=g.id JOIN titles t ON t.id=tg.title_id WHERE ${clause} GROUP BY g.id ORDER BY g.name`).bind(...values),
      db.prepare(`SELECT LOWER(t.format) AS value,MIN(t.format) AS label,COUNT(*) AS count FROM titles t WHERE ${clause} AND t.format IS NOT NULL AND t.format<>'' GROUP BY t.format COLLATE NOCASE ORDER BY t.format COLLATE NOCASE`).bind(...values),
      db.prepare(`SELECT LOWER(t.status) AS value,MIN(t.status) AS label,COUNT(*) AS count FROM titles t WHERE ${clause} AND t.status IS NOT NULL AND t.status<>'' GROUP BY t.status COLLATE NOCASE ORDER BY t.status COLLATE NOCASE`).bind(...values),
      db.prepare(`SELECT v.language AS value,UPPER(v.language) AS label,COUNT(DISTINCT e.title_id) AS count FROM episode_versions v JOIN episodes e ON e.id=v.episode_id JOIN titles t ON t.id=e.title_id WHERE ${clause} GROUP BY v.language ORDER BY v.language`).bind(...values),
    ]);
    const labels: Record<string, string> = { movie: 'Movie', music: 'Music', ona: 'ONA', ova: 'OVA', special: 'Special', tv: 'TV', tv_short: 'TV Short', 'tv special': 'TV Special' };
    return { genres: result[0].results, types: result[1].results.map(row => ({ ...row, label: labels[String(row.value)] ?? row.label })), statuses: result[2].results, languages: result[3].results };
  }

  async function hasEpisode(episodeId: number) {
    if (!Number.isSafeInteger(episodeId) || episodeId < 1) return false;
    if (baseline && await baseline.episode(episodeId)) return true;
    return Boolean(await db.prepare('SELECT 1 FROM episodes WHERE id=?').bind(episodeId).first());
  }

  async function browseD1Titles(params: BrowseParams, sources: readonly string[], offset = (params.page - 1) * params.pageSize, limit = params.pageSize, includeFacets = params.includeFacets !== false, excludedSources: readonly string[] = []) {
    const where = [sourceClause(sources, excludedSources)];
    const values: unknown[] = [...(sources.length ? sources : excludedSources).map(source => source.toLowerCase())];
    if (params.q) {
      where.push('(INSTR(LOWER(t.name),LOWER(?))>0 OR EXISTS (SELECT 1 FROM title_aliases a WHERE a.title_id=t.id AND INSTR(LOWER(a.alias),LOWER(?))>0))');
      values.push(params.q, params.q);
    }
    if (params.genre) { where.push('EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND g.slug=?)'); values.push(params.genre); }
    if (params.type) { where.push('LOWER(t.format)=LOWER(?)'); values.push(params.type); }
    if (params.status) { where.push('LOWER(t.status)=LOWER(?)'); values.push(params.status); }
    if (params.language) { where.push('EXISTS (SELECT 1 FROM episodes e JOIN episode_versions v ON v.episode_id=e.id WHERE e.title_id=t.id AND v.language=?)'); values.push(params.language.toLowerCase()); }
    const orders: Record<string, string> = {
      name: 't.name COLLATE NOCASE', title: 't.name COLLATE NOCASE',
      newest: 't.release_year DESC,t.name COLLATE NOCASE', year_desc: 't.release_year DESC,t.name COLLATE NOCASE',
      oldest: 't.release_year IS NULL,t.release_year,t.name COLLATE NOCASE', year_asc: 't.release_year IS NULL,t.release_year,t.name COLLATE NOCASE',
      updated: 't.updated_at DESC,t.id DESC', episodes: 'episodeCount DESC,t.name COLLATE NOCASE',
    };
    const from = `FROM titles t WHERE ${where.join(' AND ')}`;
    const result = await db.batch<Row>([
      db.prepare(`SELECT COUNT(*) AS count ${from}`).bind(...values),
      db.prepare(`${titleSelect} ${from} ORDER BY ${orders[params.sort] ?? orders.name},t.id ASC LIMIT ? OFFSET ?`).bind(...values, limit, offset),
    ]);
    const total = Number(result[0].results[0].count);
    return {
      items: result[1].results, total,
      facets: includeFacets ? await getD1Filters(sources, excludedSources) : undefined,
    };
  }

  const overlayBaselineCard = (frozen: Row, actual: Row) => {
    const preferred = Object.fromEntries(Object.entries(actual).filter(([, value]) => value !== null && value !== undefined && value !== ''));
    return {
      ...frozen, ...preferred,
      id: frozen.id, source: frozen.source, sourceId: frozen.sourceId,
      episodeCount: Math.max(Number(frozen.episodeCount ?? 0), Number(actual.episodeCount ?? 0)),
    };
  };
  async function getFilters() {
    if (!baseline) return getD1Filters([]);
    const frozen = await baseline.browseIds({ page: 1, pageSize: 1, sort: 'name', includeFacets: true }, { offset: 0, limit: 1 });
    return mergeFacets(frozen.facets, await getD1Filters([], frozen.sourceNames)) ?? { genres: [], types: [], statuses: [], languages: [] };
  }
  async function titleCount() {
    if (!baseline) return Number((await db.prepare('SELECT COUNT(*) AS titles FROM titles').first<{ titles: number }>())?.titles ?? 0);
    const frozen = await baseline.browseIds({ page: 1, pageSize: 1, sort: 'name', includeFacets: false }, { offset: 0, limit: 1 });
    const clause = sourceClause([], frozen.sourceNames);
    const external = await db.prepare(`SELECT COUNT(*) AS titles FROM titles t WHERE ${clause}`).bind(...frozen.sourceNames.map(source => source.toLowerCase())).first<{ titles: number }>();
    return frozen.total + Number(external?.titles ?? 0);
  }

  async function hydrateBaselineRows(ids: readonly string[], episodeCounts: Record<string, number>, sourceNames: readonly string[]) {
    const clause = sourceClause(sourceNames);
    const stored = ids.length ? await rows(db, `${titleSelect} FROM titles t WHERE t.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND ${clause}`, JSON.stringify(ids), ...sourceNames.map(source => source.toLowerCase())) : [];
    const byId = new Map(stored.map(row => [normalizedId(row), row]));
    const hydrated: Row[] = [];
    for (const id of ids) {
      const frozen = baselineCard(await baseline!.browseRow(id));
      if (!frozen) throw new AppError(503, 'UNAVAILABLE', 'A catalogue card is missing from its verified snapshot.');
      frozen.episodeCount = Math.max(Number(frozen.episodeCount ?? 0), Number(episodeCounts[id] ?? 0));
      const actual = byId.get(normalizedId(frozen));
      hydrated.push(actual && sameIdentity(frozen, actual) ? overlayBaselineCard(frozen, actual) : frozen);
    }
    return hydrated;
  }

  async function browseUnionTitles(params: BrowseParams) {
    const offset = (params.page - 1) * params.pageSize;
    const end = offset + params.pageSize;
    const frozen = await baseline!.browseIds(params, { offset: 0, limit: end });
    const external = await browseD1Titles(params, [], 0, end, params.includeFacets !== false, frozen.sourceNames);
    const baselineRows = await hydrateBaselineRows(frozen.ids, frozen.episodeCounts, frozen.sourceNames);
    const items = [...baselineRows, ...external.items].sort(compareBrowseRows(params.sort)).slice(offset, end);
    const total = frozen.total + external.total;
    return {
      items: await decorateCloudArtwork(db, items), total, page: params.page, pageSize: params.pageSize,
      pages: Math.ceil(total / params.pageSize),
      ...(params.includeFacets !== false ? { facets: mergeFacets(frozen.facets, external.facets) } : {}),
    };
  }

  async function browseTitles(params: BrowseParams) {
    if (!Number.isSafeInteger(params.page) || params.page < 1 || params.page > 100_000 || !Number.isSafeInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 100)
      throw new AppError(400, 'INVALID_QUERY', 'Choose a valid page and a page size between 1 and 100.');
    if (params.q && params.q.length > 200) throw new AppError(400, 'INVALID_QUERY', 'Search is limited to 200 characters.');
    const scope = params.scope;
    if (scope && !isCatalogueScope(scope))
      throw new AppError(400, 'INVALID_QUERY', 'Catalogue scope must be all, anime, tv, or movies.');
    // Anime remains snapshot-authoritative. Global discovery is the stable
    // identity union of that snapshot and every D1 source, including sources
    // added after this Worker release.
    const useBaselineBrowse = baseline && scope === 'anime';
    if (useBaselineBrowse) {
      const page = await baseline.browseIds(params);
      const stored = page.ids.length ? await rows(db, `${titleSelect} FROM titles t WHERE t.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`, JSON.stringify(page.ids)) : [];
      const byId = new Map(stored.map(row => [String(row.id),row]));
      const items: Row[] = [];
      for (const id of page.ids) {
        const actual = byId.get(id);
        if (actual) { items.push({...actual,episodeCount:Math.max(Number(actual.episodeCount),page.episodeCounts[id])}); continue; }
        const fallback = await baseline.browseRow(id);
        if (!fallback) throw new AppError(503,'UNAVAILABLE','A catalogue card is missing from its verified snapshot.');
        const {card,aliases:_aliases,genres:_genres,languages:_languages,...summary} = fallback;
        items.push({...summary,...card,imageUrl:card.artworkUrl,description:card.synopsis,format:card.type});
      }
      return {items:await decorateCloudArtwork(db,items),total:page.total,page:page.page,pageSize:page.pageSize,pages:page.pages,...(params.includeFacets !== false ? {facets:page.facets}:{})};
    }
    if (baseline && (!scope || scope === 'all')) return browseUnionTitles(params);
    if (baseline && scope === 'tv') {
      const end = params.page * params.pageSize;
      const frozen = await baseline.browseIds(params, { offset: 0, limit: end });
      const stored = frozen.ids.length ? await rows(db, `${titleSelect} FROM titles t WHERE t.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`, JSON.stringify(frozen.ids)) : [];
      const byId = new Map(stored.map(row => [String(row.id), row]));
      const snapshotRows: Row[] = [];
      for (const id of frozen.ids) {
        const actual = byId.get(id);
        if (actual) { snapshotRows.push({ ...actual, episodeCount: Math.max(Number(actual.episodeCount), frozen.episodeCounts[id]) }); continue; }
        const fallback = await baseline.browseRow(id);
        if (!fallback) throw new AppError(503, 'UNAVAILABLE', 'A catalogue card is missing from its verified snapshot.');
        const { card, aliases: _aliases, genres: _genres, languages: _languages, ...summary } = fallback;
        snapshotRows.push({ ...summary, ...card, imageUrl: card.artworkUrl, description: card.synopsis, format: card.type });
      }
      const overlay = await browseD1Titles(params, ['wikipedia-tv'], 0, end);
      const combined = [...snapshotRows, ...overlay.items].sort(compareBrowseRows(params.sort));
      const offset = (params.page - 1) * params.pageSize;
      const total = frozen.total + overlay.total;
      return {
        items: await decorateCloudArtwork(db, combined.slice(offset, offset + params.pageSize)), total, page: params.page,
        pageSize: params.pageSize, pages: Math.ceil(total / params.pageSize),
        ...(params.includeFacets !== false ? { facets: mergeFacets(frozen.facets, overlay.facets) } : {}),
      };
    }
    const sources = scope && isCatalogueScope(scope) ? sourcesForCatalogueScope(scope) : [];
    const result = await browseD1Titles(params, sources);
    return { items: await decorateCloudArtwork(db, result.items), total: result.total, page: params.page, pageSize: params.pageSize, pages: Math.ceil(result.total / params.pageSize), ...(params.includeFacets !== false ? { facets: result.facets } : {}) };
  }

  async function getTitleD1(slug: string) {
    const title = await db.prepare('SELECT CAST(id AS TEXT) AS id,source,source_id AS sourceId,slug,canonical_url AS canonicalUrl,name,description,description AS synopsis,format,format AS type,release_year AS releaseYear,status,artwork_url AS artworkUrl,artwork_url AS imageUrl,artwork_origin AS artworkOrigin,artwork_reuse_status AS artworkReuseStatus,availability_state AS availability,first_seen_at AS firstSeen,last_seen_at AS lastSeen,last_successful_import_at AS lastSuccessfulImport FROM titles WHERE slug=?').bind(slug).first<Row>();
    if (!title) throw new AppError(404, 'NOT_FOUND', 'Title was not found.');
    const id = Number(title.id);
    const result = await db.batch<Row>([
      db.prepare("SELECT alias AS name,NULLIF(language,'') AS language,alias_type AS type FROM title_aliases WHERE title_id=? ORDER BY alias").bind(id),
      db.prepare('SELECT g.slug,g.name FROM genres g JOIN title_genres tg ON tg.genre_id=g.id WHERE tg.title_id=? ORDER BY g.name').bind(id),
      db.prepare('SELECT rt.related_source_id AS sourceId,rt.relationship_type AS relationshipType,rt.label,rt.source_url AS sourceUrl,CAST(t.id AS TEXT) AS id,t.slug,t.name,t.format AS type,t.release_year AS releaseYear,t.status,t.artwork_url AS imageUrl,t.availability_state AS availability FROM related_titles rt LEFT JOIN titles t ON t.id=rt.related_title_id WHERE rt.title_id=? ORDER BY rt.relationship_type,COALESCE(t.name,rt.label,rt.related_source_id)').bind(id),
      db.prepare('SELECT CAST(id AS TEXT) AS id,source_id AS sourceId,number_text AS number,label,slug,episode_type AS type,availability_state AS availability FROM episodes WHERE title_id=? ORDER BY number_sort IS NULL,number_sort,number_text,id').bind(id),
      db.prepare('SELECT CAST(v.id AS TEXT) AS id,CAST(v.episode_id AS TEXT) AS episodeId,v.language,v.version_label AS label,v.availability_state AS availability,COUNT(m.id) AS providerCount FROM episode_versions v JOIN episodes e ON e.id=v.episode_id LEFT JOIN episode_provider_mappings m ON m.version_id=v.id WHERE e.title_id=? GROUP BY v.id ORDER BY v.language,v.id').bind(id),
    ]);
    const byEpisode = new Map<string, Row[]>();
    for (const { episodeId, ...version } of result[4].results) {
      const key = String(episodeId);
      const versions = byEpisode.get(key) ?? [];
      versions.push(version); byEpisode.set(key, versions);
    }
    const episodes = result[3].results.map(episode => ({ ...episode, versions: byEpisode.get(String(episode.id)) ?? [] }));
    const verifiedEmpty = episodes.length === 0 && !!await db.prepare("SELECT 1 FROM verification_observations WHERE entity_type='title' AND entity_id=? AND result='empty_episode_inventory' LIMIT 1").bind(String(title.sourceId)).first();
    // During a snapshot, some title shells arrive before their episode rows.
    // An absent list is only genuinely empty when a source observation says so.
    const activeImport = await db.prepare("SELECT 1 FROM cloud_snapshot_jobs j JOIN crawl_tasks t ON t.id=j.task_id WHERE t.status<>'completed' LIMIT 1").first();
    const collectionState = verifiedEmpty ? 'complete' : episodes.length ? activeImport ? 'partial' : 'complete' : 'pending';
    return { collectionState, title: { ...(await decorateCloudArtwork(db, [title]))[0], episodeCount: episodes.length, collectionState }, aliases: result[0].results, genres: result[1].results, related: await decorateCloudArtwork(db, result[2].results), episodes };
  }

  async function getEpisodeProvidersD1(episodeId: number, language?: string) {
    const episode = await db.prepare('SELECT CAST(e.id AS TEXT) AS id,e.source_id AS sourceId,e.number_text AS number,e.label,e.slug,t.slug AS titleSlug,t.name AS titleName FROM episodes e JOIN titles t ON t.id=e.title_id WHERE e.id=?').bind(episodeId).first<Row>();
    if (!episode) throw new AppError(404, 'NOT_FOUND', 'Episode was not found.');
    const version = await db.prepare(`SELECT CAST(id AS TEXT) AS id,source_id AS sourceId,language,version_label AS label,availability_state AS availability FROM episode_versions WHERE episode_id=? ${language ? 'AND language=?' : ''} ORDER BY CASE language WHEN 'sub' THEN 0 WHEN 'dub' THEN 1 ELSE 2 END,id LIMIT 1`).bind(episodeId, ...(language ? [language.toLowerCase()] : [])).first<Row>();
    if (!version) throw new AppError(404, 'NOT_FOUND', 'Episode version was not found.');
    const result = await db.batch<Row>([
      db.prepare('SELECT CAST(m.id AS TEXT) AS mappingId,p.id AS providerId,p.label,p.playback_type AS playbackType,m.availability_state AS status,p.capabilities_json AS capabilities,m.last_successful_resolution_at AS lastSuccessfulResolution,m.last_playback_verification_at AS lastPlaybackVerification,m.unavailable_reason AS reason FROM episode_provider_mappings m JOIN providers p ON p.id=m.provider_id WHERE m.version_id=? ORDER BY p.label,m.id').bind(Number(version.id)),
      db.prepare('SELECT a.provider_id AS providerId,a.alias FROM provider_aliases a WHERE EXISTS (SELECT 1 FROM episode_provider_mappings m WHERE m.provider_id=a.provider_id AND m.version_id=?) ORDER BY a.alias').bind(Number(version.id)),
    ]);
    const normalizedVersion = { ...version, id: String(version.id), language: String(version.language), providerCount: result[0].results.length };
    return { episode: { ...episode, versions: [normalizedVersion] }, version: normalizedVersion, providers: result[0].results.map(row => ({ ...row, mappingId: String(row.mappingId), providerId: String(row.providerId), capabilities: json(row.capabilities), aliases: result[1].results.filter(alias => alias.providerId === row.providerId).map(alias => String(alias.alias)) })) };
  }

  async function getMappingD1(mappingId: number): Promise<StoredProviderMapping> {
    const mapping = await db.prepare('SELECT m.id AS mappingId,m.provider_id AS providerId,p.label,v.language,m.provider_resource_id AS providerResourceId,m.canonical_embed_url AS canonicalEmbedUrl,m.availability_state AS availability,m.unavailable_reason AS unavailableReason FROM episode_provider_mappings m JOIN providers p ON p.id=m.provider_id JOIN episode_versions v ON v.id=m.version_id WHERE m.id=?').bind(mappingId).first<StoredProviderMapping>();
    if (!mapping) throw new AppError(404, 'NOT_FOUND', 'Provider mapping was not found.');
    return mapping;
  }

  async function getApprovedResource(mappingId: number): Promise<ApprovedNativeResource | null> {
    const actual = await db.prepare('SELECT * FROM native_resources WHERE mapping_id=?').bind(mappingId).first<ApprovedNativeResource>();
    if (actual) return actual;
    if (baseline) return (await baseline.mapping(mappingId))?.resource ?? null;
    return null;
  }

  function mergeFields(original: Row, overlay: Row): Row {
    return {...original,...Object.fromEntries(Object.entries(overlay).filter(([,value])=>value !== null && value !== undefined && value !== ''))};
  }
  function mergeRows(original: Row[], overlay: Row[], key: (row: Row)=>string): Row[] {
    const combined=new Map(original.map(row=>[key(row),row]));
    for(const row of overlay) combined.set(key(row),mergeFields(combined.get(key(row)) ?? {},row));
    return [...combined.values()];
  }
  function records(value: unknown): Row[] { return Array.isArray(value) ? value.filter((row):row is Row=>!!row && typeof row==='object' && !Array.isArray(row)) : []; }
  async function absent<T>(operation:()=>Promise<T>):Promise<T|null> { try{return await operation();}catch(error){if(error instanceof AppError && error.status===404)return null;throw error;} }
  async function getTitle(slug: string) {
    if(!baseline)return getTitleD1(slug);
    const frozen=await baseline.titleBySlug(slug);const actual=await absent(()=>getTitleD1(slug));
    if(!frozen){if(actual)return actual;throw new AppError(404,'NOT_FOUND','Title was not found.');}
    if(actual && (String((actual.title as Row).id)!==String(frozen.title.id) || String((actual.title as Row).sourceId)!==String(frozen.title.sourceId)))throw new AppError(409,'IMPORT_IDENTITY_CONFLICT','The title identity differs from its catalogue snapshot.');
    const originalEpisodes:Row[]=[];
    for(let index=0;index<frozen.episodePages.length;index++){
      const page=await baseline.episodePage(String(frozen.title.id),index);
      if(!page || page.total!==Number(frozen.title.episodeCount) || page.page!==index)throw new AppError(503,'UNAVAILABLE','The catalogue episode inventory failed snapshot verification.');
      originalEpisodes.push(...page.episodes);
    }
    if(originalEpisodes.length!==Number(frozen.title.episodeCount) || new Set(originalEpisodes.map(row=>String(row.id))).size!==originalEpisodes.length)throw new AppError(503,'UNAVAILABLE','The catalogue episode inventory is incomplete.');
    const episodeMap=new Map(originalEpisodes.map(row=>[String(row.id),row]));
    for(const overlay of records(actual?.episodes)) {
      const original=episodeMap.get(String(overlay.id)) ?? {};
      const variants=mergeRows(records(original.versions),records(overlay.versions),row=>String(row.id)).map(version=>{
        const prior=records(original.versions).find(row=>String(row.id)===String(version.id));
        return {...version,providerCount:Math.max(Number(prior?.providerCount ?? 0),Number(version.providerCount ?? 0))};
      });
      episodeMap.set(String(overlay.id),{...mergeFields(original,overlay),versions:variants});
    }
    // Snapshot pages are already ordered by the source's numeric number_sort.
    // Map replacement preserves that order, while genuinely new D1 episodes
    // append in their own numeric query order. Re-sorting display labels such as
    // "S1 E10" lexicographically would incorrectly place them before "S1 E2".
    const episodes=[...episodeMap.values()];
    const collectionState=frozen.collectionState;
    const title={...mergeFields(frozen.title,actual?.title ?? {}),episodeCount:episodes.length,collectionState};
    const aliases=mergeRows(frozen.aliases,actual?.aliases ?? [],row=>JSON.stringify([row.name,row.language ?? null,row.type ?? null]));
    const genres=mergeRows(frozen.genres,actual?.genres ?? [],row=>String(row.slug));
    const related=mergeRows(frozen.related,actual?.related ?? [],row=>JSON.stringify([row.sourceId,row.relationshipType]));
    return {collectionState,title:(await decorateCloudArtwork(db,[title]))[0],aliases,genres,related:await decorateCloudArtwork(db,related),episodes};
  }
  async function getEpisodeProviders(episodeId: number, language?: string) {
    if(!baseline)return getEpisodeProvidersD1(episodeId,language);
    if(!Number.isSafeInteger(episodeId) || episodeId<1)throw new AppError(400,'INVALID_QUERY','Invalid episode identifier.');
    const frozen=await baseline.episode(episodeId);
    if(!frozen)return getEpisodeProvidersD1(episodeId,language);
    const actual=await absent(()=>getEpisodeProvidersD1(episodeId,language));
    if(actual && String((actual.episode as Row).sourceId)!==String(frozen.episode.sourceId))throw new AppError(409,'IMPORT_IDENTITY_CONFLICT','The episode identity differs from its catalogue snapshot.');
    const choices=frozen.versions.filter(item=>!language || item.version.language===language.toLowerCase()).sort((a,b)=>{
      const rank=(value:unknown)=>value==='sub'?0:value==='dub'?1:2;
      return rank(a.version.language)-rank(b.version.language) || Number(a.version.id)-Number(b.version.id);
    });
    let selected=choices[0];
    const variantRank=(value:unknown)=>value==='sub'?0:value==='dub'?1:2;
    if(actual && (!selected || variantRank(actual.version.language)<variantRank(selected.version.language) || (variantRank(actual.version.language)===variantRank(selected.version.language) && Number(actual.version.id)<Number(selected.version.id))))return actual;
    if(!selected){if(actual)return actual;throw new AppError(404,'NOT_FOUND','Episode version was not found.');}
    // A partial D1 version inventory must not make its DUB replace a known default SUB.
    const candidate=actual && String(actual.version.id)===String(selected.version.id) ? actual : await absent(()=>getEpisodeProvidersD1(episodeId,String(selected.version.language)));
    const overlay=candidate && String(candidate.version.id)===String(selected.version.id) ? candidate : null;
    if(overlay && (String(overlay.version.language)!==String(selected.version.language) || String((overlay.version as Row).sourceId)!==String(selected.version.sourceId)))throw new AppError(409,'IMPORT_IDENTITY_CONFLICT','The episode version identity differs from its catalogue snapshot.');
    const combined=new Map(selected.providers.map(row=>[String(row.mappingId),row]));
    for(const row of overlay?.providers ?? [])combined.set(String(row.mappingId),{...combined.get(String(row.mappingId)),...row});
    const providers=[...combined.values()].sort((a,b)=>String(a.label).localeCompare(String(b.label)) || Number(a.mappingId)-Number(b.mappingId));
    const version={...mergeFields(selected.version,overlay?.version ?? {}),id:String(selected.version.id),language:String(selected.version.language),providerCount:providers.length};
    return {episode:{...mergeFields(frozen.episode,overlay?.episode ?? {}),versions:[version]},version,providers};
  }
  async function getMapping(mappingId: number):Promise<StoredProviderMapping> {
    const actual=await absent(()=>getMappingD1(mappingId));if(actual)return actual;
    if(baseline){const frozen=await baseline.mapping(mappingId);if(frozen)return frozen.mapping;}
    throw new AppError(404,'NOT_FOUND','Provider mapping was not found.');
  }

  async function adminStatus() {
    const result = await db.batch<Row>([
      db.prepare("SELECT r.*,(SELECT COUNT(*) FROM crawl_tasks t WHERE t.run_id=r.id AND t.status IN ('failed','blocked')) AS tasks_failed FROM crawl_runs r ORDER BY r.id DESC LIMIT 1"),
      db.prepare('SELECT * FROM coverage_snapshots ORDER BY id DESC LIMIT 1'),
      db.prepare("SELECT (SELECT COUNT(*) FROM titles) AS titles,(SELECT COUNT(*) FROM episodes) AS episodes,(SELECT COUNT(*) FROM episode_versions) AS versions,(SELECT COUNT(*) FROM episode_provider_mappings) AS mappings,(SELECT COUNT(*) FROM crawl_tasks WHERE status IN ('pending','running','retry')) AS pendingTasks"),
      db.prepare('SELECT id,run_id AS runId,task_key AS taskKey,last_error_code AS code,last_error_message AS message,updated_at AS updatedAt FROM crawl_tasks WHERE last_error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 20'),
      db.prepare('SELECT p.id,p.label,p.adapter_state AS adapterState,p.identity_state AS identityState,p.playback_type AS playbackType,COUNT(m.id) AS mappingCount,MAX(m.last_successful_resolution_at) AS lastSuccessfulResolution,MAX(m.last_playback_verification_at) AS lastPlaybackVerification FROM providers p LEFT JOIN episode_provider_mappings m ON m.provider_id=p.id GROUP BY p.id ORDER BY p.label'),
    ]);
    const latestRun = result[0].results[0] ?? null;
    const taskStages = latestRun ? await rows(db, "SELECT task_type AS taskType,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN status IN ('pending','retry','running') THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status IN ('failed','blocked') THEN 1 ELSE 0 END) AS failed,COUNT(*) AS total FROM crawl_tasks WHERE run_id=? GROUP BY task_type ORDER BY task_type", latestRun.id) : [];
    return { latestRun, coverage: result[1].results[0] ?? null, counts: result[2].results[0], recentErrors: result[3].results, providers: result[4].results, taskStages };
  }

  async function exportTitlesPage(afterId = 0, limit = 100) {
    if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'INVALID_QUERY', 'Invalid export cursor.');
    const items = await rows(db, 'SELECT id,source_id AS sourceId,slug,canonical_url AS canonicalUrl,name,description,format,release_year AS releaseYear,status,artwork_url AS artworkUrl,artwork_origin AS artworkOrigin,artwork_reuse_status AS artworkReuseStatus,availability_state AS availability FROM titles WHERE id>? ORDER BY id LIMIT ?', afterId, limit + 1);
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return { exportSchemaVersion: 2, items, nextCursor: hasMore ? items.at(-1)?.id : null, note: 'Catalogue fields only; authentication, resolver resources and temporary playback references are excluded.' };
  }

  return { browseTitles, getFilters, getTitle, getEpisodeProviders, getMapping, getApprovedResource, hasEpisode, titleCount, adminStatus, exportTitlesPage };
}

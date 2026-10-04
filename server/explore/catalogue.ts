import type { SqliteDatabase } from '../db.ts';
import type { CatalogueDatabase } from '../cloud/data/catalogue.ts';
import type { createPrivateBaselineReader } from '../cloud/data/baseline.ts';
import { decorateCloudArtwork, decorateLocalArtwork } from '../artwork/catalogue.ts';
import { genreKey, type ExploreCardData, type ExploreTitleFeature } from '../../shared/explore.ts';

/**
 * Read-only catalogue facts for Explore. Only public catalogue metadata passes through
 * here, so the feature index may be cached per process/isolate. No account data is cached.
 */
export interface ExploreCatalogue {
  features(): Promise<ExploreFeatureIndex>;
  cards(ids: readonly string[]): Promise<Map<string, ExploreCardData>>;
}
export interface ExploreFeatureIndex {
  /** Changes whenever the underlying catalogue snapshot changes. */
  key: string;
  items: ExploreTitleFeature[];
  byId: Map<string, ExploreTitleFeature>;
  /** Catalogue title ID by exact MAL ID, from reviewed matches only. */
  byMalId: Map<number, string>;
  genreLabels: Map<string, string>;
}

type Row = Record<string, unknown>;
const FEATURE_TTL_MS = 10 * 60_000;
const SYNOPSIS_MAX = 360;
// The same identity guard as reviewed artwork: a match whose title row changed is ignored.
const MAL_MATCHES = `SELECT CAST(m.title_id AS TEXT) AS titleId,m.mal_id AS malId FROM artwork_matches m
  JOIN titles t ON t.id=m.title_id AND t.source=m.title_source AND t.source_id=m.title_source_id AND t.release_year=m.release_year AND LOWER(t.format)=LOWER(m.format)
  WHERE m.review_status='approved' AND m.mal_id IS NOT NULL`;

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const lower = (value: unknown) => text(value)?.toLowerCase() ?? null;
function shortSynopsis(value: unknown): string | null {
  const body = text(value)?.replace(/\s+/g, ' ');
  if (!body) return null;
  if (body.length <= SYNOPSIS_MAX) return body;
  const cut = body.slice(0, SYNOPSIS_MAX);
  return cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim() + '…';
}

export function indexFeatures(key: string, items: ExploreTitleFeature[], malPairs: Array<{ titleId: string; malId: number }>, genreLabels: Map<string, string>): ExploreFeatureIndex {
  const byId = new Map(items.map(item => [item.id, item]));
  const byMalId = new Map<number, string>();
  const ambiguous = new Set<number>();
  for (const pair of malPairs) {
    const feature = byId.get(pair.titleId);
    if (!feature || !Number.isSafeInteger(pair.malId) || pair.malId < 1) continue;
    // Two catalogue rows claiming one MAL ID is ambiguous: neither is used.
    if (byMalId.has(pair.malId) && byMalId.get(pair.malId) !== pair.titleId) { ambiguous.add(pair.malId); continue; }
    byMalId.set(pair.malId, pair.titleId);
  }
  for (const malId of ambiguous) byMalId.delete(malId);
  for (const [malId, titleId] of byMalId) {
    const feature = byId.get(titleId);
    if (feature) feature.malId = malId;
  }
  return { key, items, byId, byMalId, genreLabels };
}

function cardFrom(row: Row, genres: string[], languages: string[]): ExploreCardData {
  return {
    titleId: String(row.id), slug: String(row.slug), name: String(row.name),
    artworkUrl: text(row.imageUrl), posterUrl: text(row.posterUrl), backdropUrl: text(row.backdropUrl),
    synopsis: shortSynopsis(row.synopsis), type: text(row.type), status: text(row.status),
    releaseYear: Number.isSafeInteger(row.releaseYear) ? Number(row.releaseYear) : null,
    episodeCount: Number(row.episodeCount) || 0, genres: genres.slice(0, 4), languages: [...new Set(languages)].sort(),
    publicMean: null,
  };
}

/** Local Node/SQLite catalogue. */
export function sqliteExploreCatalogue(db: SqliteDatabase): ExploreCatalogue {
  let cached: { at: number; index: ExploreFeatureIndex } | null = null;
  const all = (sql: string, ...values: (string | number)[]) => db.prepare(sql).all(...values) as Row[];
  return {
    async features() {
      if (cached && Date.now() - cached.at < FEATURE_TTL_MS) return cached.index;
      const titles = all(`SELECT CAST(t.id AS TEXT) AS id,t.name,LOWER(t.format) AS type,LOWER(t.status) AS status,
        (SELECT COUNT(*) FROM episodes e WHERE e.title_id=t.id) AS episodeCount FROM titles t WHERE LOWER(t.source)='anikoto'`);
      const genres = new Map<string, string[]>();
      for (const row of all('SELECT CAST(tg.title_id AS TEXT) AS id,g.slug FROM title_genres tg JOIN genres g ON g.id=tg.genre_id')) {
        const list = genres.get(String(row.id)) ?? []; list.push(genreKey(String(row.slug))); genres.set(String(row.id), list);
      }
      const languages = new Map<string, string[]>();
      for (const row of all('SELECT DISTINCT CAST(e.title_id AS TEXT) AS id,LOWER(v.language) AS language FROM episode_versions v JOIN episodes e ON e.id=v.episode_id')) {
        const list = languages.get(String(row.id)) ?? []; list.push(String(row.language)); languages.set(String(row.id), list);
      }
      let mal: Array<{ titleId: string; malId: number }> = [];
      try { mal = all(MAL_MATCHES).map(row => ({ titleId: String(row.titleId), malId: Number(row.malId) })); }
      catch { /* Artwork review tables are optional locally; no MAL joins without them. */ }
      const labels = new Map(all('SELECT slug,name FROM genres').map(row => [genreKey(String(row.slug)), String(row.name)]));
      const items = titles.map(row => ({
        id: String(row.id), name: String(row.name), genres: genres.get(String(row.id)) ?? [], type: lower(row.type), status: lower(row.status),
        episodeCount: Number(row.episodeCount) || 0, languages: languages.get(String(row.id)) ?? [], malId: null,
      }));
      const index = indexFeatures(`sqlite:${items.length}:${Date.now()}`, items, mal, labels);
      cached = { at: Date.now(), index };
      return index;
    },
    async cards(ids) {
      const wanted = [...new Set(ids)].filter(id => /^[1-9]\d*$/.test(id)).slice(0, 60);
      if (!wanted.length) return new Map();
      const rows = all(`SELECT CAST(t.id AS TEXT) AS id,t.slug,t.name,t.description AS synopsis,t.format AS type,t.status,t.release_year AS releaseYear,
        t.artwork_url AS imageUrl,(SELECT COUNT(*) FROM episodes e WHERE e.title_id=t.id) AS episodeCount
        FROM titles t WHERE t.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`, JSON.stringify(wanted));
      const decorated = decorateLocalArtwork(db, rows);
      const genreRows = all(`SELECT CAST(tg.title_id AS TEXT) AS id,g.name FROM title_genres tg JOIN genres g ON g.id=tg.genre_id
        WHERE tg.title_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ORDER BY g.name`, JSON.stringify(wanted));
      const languageRows = all(`SELECT DISTINCT CAST(e.title_id AS TEXT) AS id,LOWER(v.language) AS language FROM episode_versions v JOIN episodes e ON e.id=v.episode_id
        WHERE e.title_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`, JSON.stringify(wanted));
      const result = new Map<string, ExploreCardData>();
      for (const row of decorated) result.set(String(row.id), cardFrom(row,
        genreRows.filter(item => item.id === row.id).map(item => String(item.name)),
        languageRows.filter(item => item.id === row.id).map(item => String(item.language))));
      return result;
    },
  };
}

/* ───────────────────────────── Cloud ───────────────────────────── */

const cloudCache = new Map<string, { at: number; index: ExploreFeatureIndex }>();
type Baseline = ReturnType<typeof createPrivateBaselineReader>;
type BaselineMeta = { id: string; manifestSha256: string };

/**
 * Workers/D1 catalogue. With the private baseline enabled, anime features come from the
 * verified snapshot's postings and search indexes (two bounded reads), never from the
 * public browse API. Without it, D1 is read directly.
 */
export function cloudExploreCatalogue(db: CatalogueDatabase, baseline?: Baseline, pin?: BaselineMeta): ExploreCatalogue {
  const malPairs = async () => {
    try { return (await db.prepare(MAL_MATCHES).all<Row>()).results.map(row => ({ titleId: String(row.titleId), malId: Number(row.malId) })); }
    catch { return []; }
  };
  async function baselineFeatures(reader: Baseline, meta: BaselineMeta) {
    const manifest = await reader.manifest();
    // The reader verifies checksums of these two files against the pinned manifest.
    const record = await reader.postingsIndex();
    const names = await reader.searchIndex();
    const anime = new Set(record.sources ? record.sources.anikoto ?? [] : Object.keys(record.episodeCounts));
    const items = new Map<string, ExploreTitleFeature>();
    for (const [id, joined] of names) {
      if (!anime.has(id)) continue;
      items.set(id, { id, name: joined.split('\n')[0], genres: [], type: null, status: null, episodeCount: Number(record.episodeCounts[id]) || 0, languages: [], malId: null });
    }
    for (const [genre, ids] of Object.entries(record.genres)) for (const id of ids) items.get(id)?.genres.push(genreKey(genre));
    for (const [language, ids] of Object.entries(record.languages)) for (const id of ids) items.get(id)?.languages.push(language.toLowerCase());
    for (const [type, ids] of Object.entries(record.types)) for (const id of ids) { const item = items.get(id); if (item) item.type = type.toLowerCase(); }
    for (const [status, ids] of Object.entries(record.statuses)) for (const id of ids) { const item = items.get(id); if (item) item.status = status.toLowerCase(); }
    const labels = new Map(manifest.facets.genres.map(row => [genreKey(String(row.value)), String(row.label ?? row.value)]));
    return indexFeatures(`baseline:${meta.id}:${meta.manifestSha256}`, [...items.values()], await malPairs(), labels);
  }
  async function d1Features() {
    const [titles, genres, languages, labels] = await db.batch<Row>([
      db.prepare(`SELECT CAST(t.id AS TEXT) AS id,t.name,LOWER(t.format) AS type,LOWER(t.status) AS status,
        (SELECT COUNT(*) FROM episodes e WHERE e.title_id=t.id) AS episodeCount FROM titles t WHERE LOWER(t.source)='anikoto'`),
      db.prepare('SELECT CAST(tg.title_id AS TEXT) AS id,g.slug FROM title_genres tg JOIN genres g ON g.id=tg.genre_id'),
      db.prepare('SELECT DISTINCT CAST(e.title_id AS TEXT) AS id,LOWER(v.language) AS language FROM episode_versions v JOIN episodes e ON e.id=v.episode_id'),
      db.prepare('SELECT slug,name FROM genres'),
    ]);
    const byTitle = (rows: Row[], field: string) => {
      const map = new Map<string, string[]>();
      for (const row of rows) { const list = map.get(String(row.id)) ?? []; list.push(field === 'slug' ? genreKey(String(row.slug)) : String(row[field])); map.set(String(row.id), list); }
      return map;
    };
    const genreMap = byTitle(genres.results, 'slug'), languageMap = byTitle(languages.results, 'language');
    const items = titles.results.map(row => ({ id: String(row.id), name: String(row.name), genres: genreMap.get(String(row.id)) ?? [],
      type: lower(row.type), status: lower(row.status), episodeCount: Number(row.episodeCount) || 0, languages: languageMap.get(String(row.id)) ?? [], malId: null }));
    return indexFeatures(`d1:${items.length}`, items, await malPairs(), new Map(labels.results.map(row => [genreKey(String(row.slug)), String(row.name)])));
  }
  return {
    async features() {
      const cacheKey = baseline && pin ? `baseline:${pin.id}:${pin.manifestSha256}` : 'd1';
      const hit = cloudCache.get(cacheKey);
      if (hit && Date.now() - hit.at < FEATURE_TTL_MS) return hit.index;
      const index = baseline && pin ? await baselineFeatures(baseline, pin) : await d1Features();
      cloudCache.set(cacheKey, { at: Date.now(), index });
      return index;
    },
    async cards(ids) {
      const wanted = [...new Set(ids)].filter(id => /^[1-9]\d*$/.test(id)).slice(0, 40);
      const result = new Map<string, ExploreCardData>();
      if (!wanted.length) return result;
      const rows: Row[] = [];
      const genreNames = new Map<string, string[]>(), languageNames = new Map<string, string[]>();
      if (baseline) {
        const labels = new Map((await baseline.manifest()).facets.genres.map(row => [String(row.value), String(row.label ?? row.value)]));
        for (const id of wanted) {
          const row = await baseline.browseRow(id);
          if (!row) continue;
          const card = row.card as Row;
          rows.push({ id: row.id, slug: row.slug, name: row.name, synopsis: card.synopsis, type: card.type ?? row.type, status: card.status ?? row.status,
            releaseYear: row.releaseYear, imageUrl: card.artworkUrl, episodeCount: row.episodeCount });
          genreNames.set(row.id, row.genres.map(slug => labels.get(slug) ?? slug));
          languageNames.set(row.id, row.languages.map(language => language.toLowerCase()));
        }
      } else {
        const [titles, genres, languages] = await db.batch<Row>([
          db.prepare(`SELECT CAST(t.id AS TEXT) AS id,t.slug,t.name,t.description AS synopsis,t.format AS type,t.status,t.release_year AS releaseYear,
            t.artwork_url AS imageUrl,(SELECT COUNT(*) FROM episodes e WHERE e.title_id=t.id) AS episodeCount FROM titles t WHERE t.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`).bind(JSON.stringify(wanted)),
          db.prepare(`SELECT CAST(tg.title_id AS TEXT) AS id,g.name FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ORDER BY g.name`).bind(JSON.stringify(wanted)),
          db.prepare(`SELECT DISTINCT CAST(e.title_id AS TEXT) AS id,LOWER(v.language) AS language FROM episode_versions v JOIN episodes e ON e.id=v.episode_id WHERE e.title_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`).bind(JSON.stringify(wanted)),
        ]);
        rows.push(...titles.results);
        for (const row of genres.results) genreNames.set(String(row.id), [...(genreNames.get(String(row.id)) ?? []), String(row.name)]);
        for (const row of languages.results) languageNames.set(String(row.id), [...(languageNames.get(String(row.id)) ?? []), String(row.language)]);
      }
      for (const row of await decorateCloudArtwork(db, rows))
        result.set(String(row.id), cardFrom(row, genreNames.get(String(row.id)) ?? [], languageNames.get(String(row.id)) ?? []));
      return result;
    },
  };
}

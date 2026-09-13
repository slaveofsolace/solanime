import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  IMPORT_TABLES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  estimateImportWrites,
  upsertSql,
  type ImportBatch,
  type ImportRow,
} from '../../server/cloud/data/import-schema.ts';
import { validateImportBatch } from '../../server/cloud/data/import.ts';
import type { BatchManifest, BatchManifestEntry } from './prepare.ts';

const WIKIPEDIA_SOURCES = ['wikipedia-movie', 'wikipedia-tv'] as const;
const OUTPUT_TABLES = ['cloud_snapshot_sources', 'genres', 'titles', 'title_aliases', 'title_genres'] as const;
const RESERVED_CLOUD_ID_START = 1_000_000_000;

type WikipediaSource = (typeof WIKIPEDIA_SOURCES)[number];
type NumericTable = 'titles' | 'genres' | 'title_aliases';

export interface WikipediaDeltaOptions {
  sourceDatabase: string;
  fullManifest: string;
  output: string;
  writtenRowBudget: number;
  titleIdStart: number;
  genreIdStart: number;
  aliasIdStart: number;
}

interface ExistingCatalogue {
  ids: Record<NumericTable, Map<number, ImportRow>>;
  titlesByIdentity: Map<string, ImportRow>;
  titlesBySlug: Map<string, ImportRow>;
  genresBySlug: Map<string, ImportRow>;
  genresByName: Map<string, ImportRow>;
  aliasesByIdentity: Map<string, ImportRow>;
  manifestSha256: string;
  sourceCatalogueSha256: string;
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fileSha256 = async (path: string) => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
};
const scalar = (value: unknown): string | number | null =>
  value === null || typeof value === 'string' || typeof value === 'number'
    ? value
    : (() => { throw new Error('SQLite returned a non-scalar import value.'); })();
const importRow = (row: Record<string, unknown>): ImportRow =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, scalar(value)]));
const titleIdentity = (row: ImportRow) => `${row.source}\0${row.source_id}`;
const titleSlugIdentity = (row: ImportRow) => `${row.source}\0${row.slug}`;
const aliasIdentity = (row: ImportRow) =>
  `${row.title_id}\0${row.alias}\0${row.language ?? null}`;

function requireInteger(name: string, value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
}

function checkedBatchPath(manifestPath: string, entry: BatchManifestEntry) {
  if (!/^batches\/[a-zA-Z0-9_-]+\.json$/.test(entry.file))
    throw new Error('Pinned manifest contains an invalid batch path.');
  const root = resolve(dirname(manifestPath));
  const path = resolve(root, entry.file);
  if (!path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`))
    throw new Error('Pinned manifest batch escaped its directory.');
  return path;
}

function addStable(
  byId: Map<number, ImportRow>,
  byIdentity: Map<string, ImportRow>,
  row: ImportRow,
  identity: string,
  table: string,
) {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Pinned ${table} has an invalid ID.`);
  const priorId = byId.get(id);
  if (priorId && JSON.stringify(priorId) !== JSON.stringify(row)) {
    const priorIdentity = table === 'titles' ? titleIdentity(priorId) : table === 'title_aliases' ? aliasIdentity(priorId) : String(priorId.slug);
    if (priorIdentity !== identity) throw new Error(`Pinned ${table} reuses numeric ID ${id}.`);
  }
  const priorIdentity = byIdentity.get(identity);
  if (priorIdentity && Number(priorIdentity.id) !== id)
    throw new Error(`Pinned ${table} identity is assigned to more than one numeric ID.`);
  byId.set(id, row);
  byIdentity.set(identity, row);
}

function readPinnedCatalogue(fullManifestPath: string): ExistingCatalogue {
  const manifestPath = resolve(fullManifestPath);
  const rawManifest = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(rawManifest) as BatchManifest;
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.batches) ||
    manifest.totalBatches !== manifest.batches.length ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceCatalogueSha256 ?? '')
  ) throw new Error('The pinned full manifest is incomplete or unverified.');

  const ids: ExistingCatalogue['ids'] = {
    titles: new Map(),
    genres: new Map(),
    title_aliases: new Map(),
  };
  const titlesByIdentity = new Map<string, ImportRow>();
  const titlesBySlug = new Map<string, ImportRow>();
  const genresBySlug = new Map<string, ImportRow>();
  const genresByName = new Map<string, ImportRow>();
  const aliasesByIdentity = new Map<string, ImportRow>();
  const relevant = new Set(['titles', 'genres', 'title_aliases']);

  for (const entry of manifest.batches) {
    if (entry.target !== 'catalogue' || !relevant.has(entry.table)) continue;
    const path = checkedBatchPath(manifestPath, entry);
    const body = readFileSync(path, 'utf8');
    if (sha256(body) !== entry.sha256) throw new Error(`Pinned batch checksum mismatch: ${entry.file}`);
    const batch = validateImportBatch(JSON.parse(body));
    if (
      batch.id !== entry.id ||
      batch.table !== entry.table ||
      batch.target !== entry.target ||
      batch.rows.length !== entry.rows ||
      sha256(JSON.stringify(batch.rows)) !== batch.contentHash
    ) throw new Error(`Pinned batch metadata mismatch: ${entry.file}`);
    for (const row of batch.rows) {
      if (entry.table === 'titles') {
        const priorById = ids.titles.get(Number(row.id));
        if (priorById && titleIdentity(priorById) === titleIdentity(row) && titleSlugIdentity(priorById) !== titleSlugIdentity(row))
          titlesBySlug.delete(titleSlugIdentity(priorById));
        addStable(ids.titles, titlesByIdentity, row, titleIdentity(row), 'titles');
        const slug = titleSlugIdentity(row);
        const prior = titlesBySlug.get(slug);
        if (prior && titleIdentity(prior) !== titleIdentity(row))
          throw new Error('Pinned titles contain a source/slug collision.');
        titlesBySlug.set(slug, row);
      } else if (entry.table === 'genres') {
        const priorById = ids.genres.get(Number(row.id));
        if (priorById && String(priorById.slug) === String(row.slug) && String(priorById.name) !== String(row.name))
          genresByName.delete(String(priorById.name));
        addStable(ids.genres, genresBySlug, row, String(row.slug), 'genres');
        const name = String(row.name);
        const prior = genresByName.get(name);
        if (prior && String(prior.slug) !== String(row.slug))
          throw new Error('Pinned genres contain a name collision.');
        genresByName.set(name, row);
      } else {
        addStable(ids.title_aliases, aliasesByIdentity, row, aliasIdentity(row), 'title_aliases');
      }
    }
  }
  return {
    ids,
    titlesByIdentity,
    titlesBySlug,
    genresBySlug,
    genresByName,
    aliasesByIdentity,
    manifestSha256: sha256(rawManifest),
    sourceCatalogueSha256: manifest.sourceCatalogueSha256,
  };
}

function verifyTables(database: DatabaseSync) {
  for (const table of ['titles', 'genres', 'title_aliases', 'title_genres', 'episodes', 'related_titles']) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      throw new Error(`Reviewed database is missing required table ${table}.`);
  }
  for (const table of ['titles', 'genres', 'title_aliases', 'title_genres']) {
    const present = new Set(
      (database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(column => column.name),
    );
    for (const column of IMPORT_TABLES[table].columns)
      if (!present.has(column)) throw new Error(`Reviewed database ${table} is missing column ${column}.`);
  }
}

function allocateRange(
  table: NumericTable,
  start: number,
  count: number,
  existing: Map<number, ImportRow>,
) {
  requireInteger(`${table} ID start`, start, 1, RESERVED_CLOUD_ID_START - 1);
  if (!count) return [];
  const end = start + count - 1;
  if (!Number.isSafeInteger(end) || end >= RESERVED_CLOUD_ID_START)
    throw new Error(`${table} allocation enters the reserved cloud-generated ID range.`);
  for (let id = start; id <= end; id++)
    if (existing.has(id)) throw new Error(`${table} allocation collides with pinned numeric ID ${id}.`);
  return Array.from({ length: count }, (_value, index) => start + index);
}

function valueSql(value: unknown) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function tableRows(database: DatabaseSync, table: string, sql: string, ...values: unknown[]) {
  const spec = IMPORT_TABLES[table];
  return (database.prepare(sql).all(...values.map(scalar)) as Array<Record<string, unknown>>)
    .map(importRow)
    .map(row => Object.fromEntries(spec.columns.filter(column => column in row).map(column => [column, row[column]])));
}

function batchRows(
  table: string,
  rows: ImportRow[],
  snapshotId: string,
  sequenceStart: number,
) {
  const spec = IMPORT_TABLES[table];
  const prepared: Array<{ batch: ImportBatch; body: string; estimatedWrites: number }> = [];
  let index = 0;
  while (index < rows.length) {
    let end = Math.min(index + MAX_IMPORT_ROWS, rows.length);
    let accepted: { batch: ImportBatch; body: string } | null = null;
    while (end > index) {
      const selected = rows.slice(index, end);
      const contentHash = sha256(JSON.stringify(selected));
      const candidate = validateImportBatch({
        version: 1,
        id: `${snapshotId}:${table}:${String(sequenceStart + prepared.length).padStart(5, '0')}:${contentHash.slice(0, 16)}`,
        snapshotId,
        target: 'catalogue',
        table,
        contentHash,
        rows: selected,
      });
      const body = JSON.stringify(candidate);
      if (Buffer.byteLength(body, 'utf8') <= MAX_IMPORT_BYTES) {
        accepted = { batch: candidate, body };
        break;
      }
      end--;
    }
    if (!accepted) throw new Error(`One ${table} row exceeds the protected import byte limit.`);
    prepared.push({
      ...accepted,
      estimatedWrites: estimateImportWrites(spec, accepted.batch.rows.length),
    });
    index = end;
  }
  return prepared;
}

/** Prepare a metadata-only Wikipedia delta. The reviewed SQLite database is opened read-only. */
export async function prepareWikipediaDelta(options: WikipediaDeltaOptions) {
  const sourcePath = resolve(options.sourceDatabase);
  const fullManifestPath = resolve(options.fullManifest);
  const outputPath = resolve(options.output);
  requireInteger('written-row budget', options.writtenRowBudget, 1, 70_000);
  if (!existsSync(sourcePath)) throw new Error('Choose an existing reviewed SQLite database.');
  if (existsSync(`${sourcePath}-wal`)) throw new Error('Choose a closed, WAL-free reviewed SQLite checkpoint.');
  if (!existsSync(fullManifestPath)) throw new Error('Choose an existing complete pinned manifest.');
  if (existsSync(outputPath)) throw new Error('Choose a new output directory; prior artifacts are preserved.');
  if (outputPath === sourcePath || outputPath === dirname(sourcePath))
    throw new Error('Output must be a separate new directory.');

  const sourceHash = await fileSha256(sourcePath);
  const pinned = readPinnedCatalogue(fullManifestPath);
  const immutableSource = pathToFileURL(sourcePath);
  immutableSource.searchParams.set('immutable', '1');
  const database = new DatabaseSync(immutableSource, { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok')
      throw new Error('Reviewed Wikipedia database failed integrity verification.');
    if (database.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Reviewed Wikipedia database failed foreign-key verification.');
    verifyTables(database);

    const sourceTitles = tableRows(
      database,
      'titles',
      `SELECT ${IMPORT_TABLES.titles.columns.map(column => `"${column}"`).join(',')} FROM titles WHERE source IN (?,?) ORDER BY source,source_id`,
      ...WIKIPEDIA_SOURCES,
    );
    if (!sourceTitles.length) throw new Error('Reviewed database contains no Wikipedia Movie or TV titles.');
    for (const row of sourceTitles) {
      if (!WIKIPEDIA_SOURCES.includes(row.source as WikipediaSource) || !/^Q[1-9]\d*$/.test(String(row.source_id)))
        throw new Error('Wikipedia titles must use the exact approved source namespaces and stable Wikidata Q-IDs.');
      const canonical = new URL(String(row.canonical_url));
      if (canonical.protocol !== 'https:' || canonical.hostname !== 'en.wikipedia.org' || !canonical.pathname.startsWith('/wiki/') || canonical.username || canonical.password || canonical.search || canonical.hash)
        throw new Error('Wikipedia title canonical URLs must remain on English Wikipedia HTTPS.');
      if (row.artwork_url) {
        const artwork = new URL(String(row.artwork_url));
        if (artwork.protocol !== 'https:' || artwork.hostname !== 'upload.wikimedia.org' || artwork.username || artwork.password)
          throw new Error('Wikipedia artwork references must remain on the Wikimedia upload host.');
      }
    }
    const localTitleIds = sourceTitles.map(row => Number(row.id));
    if (localTitleIds.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(localTitleIds).size !== localTitleIds.length)
      throw new Error('Reviewed Wikipedia titles have invalid or duplicate local IDs.');
    const idsJson = JSON.stringify(localTitleIds);
    const attachedEpisodes = Number(database.prepare('SELECT COUNT(*) AS count FROM episodes WHERE title_id IN (SELECT value FROM json_each(?))').get(idsJson)?.count);
    const attachedRelations = Number(database.prepare('SELECT COUNT(*) AS count FROM related_titles WHERE title_id IN (SELECT value FROM json_each(?)) OR related_title_id IN (SELECT value FROM json_each(?))').get(idsJson, idsJson)?.count);
    if (attachedEpisodes || attachedRelations)
      throw new Error('Wikipedia metadata rows unexpectedly have episode or relationship children; review them instead of publishing a partial graph.');

    const titleRemap = new Map<number, number>();
    const newTitles = sourceTitles.filter(row => !pinned.titlesByIdentity.has(titleIdentity(row)));
    const titleIds = allocateRange('titles', options.titleIdStart, newTitles.length, pinned.ids.titles);
    let titleCursor = 0;
    const titles: ImportRow[] = sourceTitles.map(row => {
      const existing = pinned.titlesByIdentity.get(titleIdentity(row));
      const slugOwner = pinned.titlesBySlug.get(titleSlugIdentity(row));
      if (slugOwner && titleIdentity(slugOwner) !== titleIdentity(row))
        throw new Error(`Wikipedia title slug collides with pinned identity: ${row.slug}.`);
      const id = existing ? Number(existing.id) : titleIds[titleCursor++];
      titleRemap.set(Number(row.id), id);
      return { ...row, id } as ImportRow;
    });

    const sourceGenreRows = tableRows(
      database,
      'genres',
      `SELECT ${IMPORT_TABLES.genres.columns.map(column => `g."${column}"`).join(',')} FROM genres g WHERE g.id IN (SELECT tg.genre_id FROM title_genres tg WHERE tg.title_id IN (SELECT value FROM json_each(?))) ORDER BY g.slug`,
      idsJson,
    );
    const newGenres = sourceGenreRows.filter(row => !pinned.genresBySlug.has(String(row.slug)));
    const genreIds = allocateRange('genres', options.genreIdStart, newGenres.length, pinned.ids.genres);
    const genreRemap = new Map<number, number>();
    let genreCursor = 0;
    const genres: ImportRow[] = sourceGenreRows.map(row => {
      const existing = pinned.genresBySlug.get(String(row.slug));
      const nameOwner = pinned.genresByName.get(String(row.name));
      if (nameOwner && String(nameOwner.slug) !== String(row.slug))
        throw new Error(`Wikipedia genre name collides with pinned slug: ${row.name}.`);
      const id = existing ? Number(existing.id) : genreIds[genreCursor++];
      genreRemap.set(Number(row.id), id);
      return { ...row, id } as ImportRow;
    });

    const sourceAliases = tableRows(
      database,
      'title_aliases',
      `SELECT ${IMPORT_TABLES.title_aliases.columns.map(column => `"${column}"`).join(',')} FROM title_aliases WHERE title_id IN (SELECT value FROM json_each(?)) ORDER BY title_id,alias,language,id`,
      idsJson,
    );
    const aliasCandidates: ImportRow[] = sourceAliases
      .map((row): ImportRow => ({ ...row, title_id: titleRemap.get(Number(row.title_id))! }))
      .sort((left, right) =>
        Number(left.title_id) - Number(right.title_id) ||
        String(left.alias).localeCompare(String(right.alias)) ||
        String(left.language ?? '').localeCompare(String(right.language ?? '')),
      );
    const seenAliases = new Map<string, ImportRow>();
    for (const row of aliasCandidates) {
      const identity = aliasIdentity(row);
      const prior = seenAliases.get(identity);
      if (prior && prior.alias_type !== row.alias_type)
        throw new Error('Reviewed Wikipedia aliases contain conflicting duplicate identities.');
      seenAliases.set(identity, row);
    }
    const distinctAliases = [...seenAliases.values()];
    const newAliases = distinctAliases.filter(row => !pinned.aliasesByIdentity.has(aliasIdentity(row)));
    const aliasIds = allocateRange('title_aliases', options.aliasIdStart, newAliases.length, pinned.ids.title_aliases);
    let aliasCursor = 0;
    const aliases: ImportRow[] = distinctAliases.map(row => {
      const existing = pinned.aliasesByIdentity.get(aliasIdentity(row));
      return { ...row, id: existing ? Number(existing.id) : aliasIds[aliasCursor++] } as ImportRow;
    });

    const sourceTitleGenres = tableRows(
      database,
      'title_genres',
      'SELECT title_id,genre_id FROM title_genres WHERE title_id IN (SELECT value FROM json_each(?)) ORDER BY title_id,genre_id',
      idsJson,
    );
    const titleGenres = sourceTitleGenres.map(row => {
      const titleId = titleRemap.get(Number(row.title_id));
      const genreId = genreRemap.get(Number(row.genre_id));
      if (!titleId || !genreId) throw new Error('Reviewed Wikipedia title/genre relationship has a missing selected parent.');
      return { title_id: titleId, genre_id: genreId };
    }).sort((left, right) => left.title_id - right.title_id || left.genre_id - right.genre_id);

    const perSource = Object.fromEntries(WIKIPEDIA_SOURCES.map(source => {
      const selected = titles.filter(row => row.source === source);
      return [source, {
        titles: selected.length,
        aliases: aliases.filter(row => selected.some(title => title.id === row.title_id)).length,
        titleGenres: titleGenres.filter(row => selected.some(title => title.id === row.title_id)).length,
      }];
    })) as Record<WikipediaSource, { titles: number; aliases: number; titleGenres: number }>;
    const selectedContentHash = sha256(JSON.stringify({ titles, genres, aliases, titleGenres }));
    const importedAt = String(titles.map(row => row.updated_at).filter(Boolean).sort().at(-1) ?? '1970-01-01T00:00:00.000Z');
    const snapshotSources: ImportRow[] = WIKIPEDIA_SOURCES.filter(source => perSource[source].titles).map(source => ({
      id: `${source}-${selectedContentHash.slice(0, 24)}`,
      source,
      content_hash: selectedContentHash,
      counts_json: JSON.stringify(perSource[source]),
      observation_date: null,
      imported_at: importedAt,
    }));

    const snapshotId = `wikipedia-${selectedContentHash.slice(0, 20)}-${pinned.manifestSha256.slice(0, 12)}`;
    const rowsByTable: Record<(typeof OUTPUT_TABLES)[number], ImportRow[]> = {
      cloud_snapshot_sources: snapshotSources,
      genres,
      titles,
      title_aliases: aliases,
      title_genres: titleGenres,
    };
    const batches: Array<{ batch: ImportBatch; body: string; estimatedWrites: number; file: string; sqlFile: string }> = [];
    let sequence = 0;
    for (const table of OUTPUT_TABLES) {
      const prepared = batchRows(table, rowsByTable[table], snapshotId, sequence);
      for (const item of prepared) {
        const prefix = `${String(sequence++).padStart(7, '0')}-catalogue-${table}`;
        batches.push({ ...item, file: `batches/${prefix}.json`, sqlFile: `batches/${prefix}.sql` });
      }
    }
    const totalEstimatedWrites = batches.reduce((total, batch) => total + batch.estimatedWrites, 0);
    if (totalEstimatedWrites > options.writtenRowBudget)
      throw new Error(`Wikipedia delta requires ${totalEstimatedWrites} conservative writes above explicit budget ${options.writtenRowBudget}; no files were written.`);
    if (await fileSha256(sourcePath) !== sourceHash)
      throw new Error('Reviewed Wikipedia database changed during delta preparation; no files were written.');

    const range = (start: number, count: number) => ({ start, count, end: count ? start + count - 1 : null });
    const manifest = {
      version: 1 as const,
      sourceCatalogue: basename(sourcePath),
      sourceCatalogueSha256: sourceHash,
      sourceResearch: '',
      catalogueCounts: Object.fromEntries(OUTPUT_TABLES.map(table => [table, rowsByTable[table].length])),
      researchCounts: {},
      totalBatches: batches.length,
      totalEstimatedWrites,
      writtenRowBudget: options.writtenRowBudget,
      allowedSources: WIKIPEDIA_SOURCES,
      sourceCounts: perSource,
      requiredCloudSchemaVersion: 12,
      identityAudit: {
        strategy: 'pinned-manifest-reuse-plus-caller-vacant-ranges',
        pinnedManifestSha256: pinned.manifestSha256,
        pinnedSourceCatalogueSha256: pinned.sourceCatalogueSha256,
        allocatedRanges: {
          titles: range(options.titleIdStart, newTitles.length),
          genres: range(options.genreIdStart, newGenres.length),
          title_aliases: range(options.aliasIdStart, newAliases.length),
        },
        reusedPinnedIdentities: {
          titles: titles.length - newTitles.length,
          genres: genres.length - newGenres.length,
          title_aliases: aliases.length - newAliases.length,
        },
        collisions: 0,
        reservedCloudIdStart: RESERVED_CLOUD_ID_START,
      },
      batches: batches.map(({ batch, body, estimatedWrites, file, sqlFile }) => ({
        file,
        sqlFile,
        id: batch.id,
        target: batch.target,
        table: batch.table,
        rows: batch.rows.length,
        estimatedWrites,
        sha256: sha256(body),
      })),
      note: 'Additive English Wikipedia Movie/TV metadata only. Contains no episodes, versions, providers, mappings, native resources, media bytes, credentials, or playback claims. Apply only through the protected quota-accounted importer after confirming the declared ranges remain vacant in the hosted D1 database.',
    };

    mkdirSync(join(outputPath, 'batches'), { recursive: true });
    for (const item of batches) {
      const sql = item.batch.rows.map(row => {
        const columns = Object.keys(row);
        return `${upsertSql(item.batch.table, columns, columns.map(column => valueSql(row[column])).join(','))};`;
      }).join('\n') + '\n';
      writeFileSync(join(outputPath, item.file), item.body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      writeFileSync(join(outputPath, item.sqlFile), sql, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    writeFileSync(join(outputPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { manifest, output: outputPath, sourceHash, selectedContentHash };
  } finally {
    database.close();
  }
}

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const required = ['source-db', 'full-manifest', 'out', 'written-row-budget', 'title-id-start', 'genre-id-start', 'alias-id-start'];
  if (required.some(name => option(name) === undefined))
    throw new Error('Use --source-db=<reviewed SQLite> --full-manifest=<complete manifest> --out=<new private directory> --written-row-budget=<1-70000> --title-id-start=<vacant> --genre-id-start=<vacant> --alias-id-start=<vacant>. This command only prepares metadata; it never uploads.');
  const result = await prepareWikipediaDelta({
    sourceDatabase: option('source-db')!,
    fullManifest: option('full-manifest')!,
    output: option('out')!,
    writtenRowBudget: Number(option('written-row-budget')),
    titleIdStart: Number(option('title-id-start')),
    genreIdStart: Number(option('genre-id-start')),
    aliasIdStart: Number(option('alias-id-start')),
  });
  console.log(JSON.stringify({
    output: result.output,
    catalogueCounts: result.manifest.catalogueCounts,
    sourceCounts: result.manifest.sourceCounts,
    batches: result.manifest.totalBatches,
    conservativeWrites: result.manifest.totalEstimatedWrites,
    budget: result.manifest.writtenRowBudget,
    identityAudit: result.manifest.identityAudit,
    upstreamRequests: 0,
    upload: `node --import tsx scripts/cloud-data/upload.ts --manifest=${join(result.output, 'manifest.json')} --origin=<verified-preview-origin>`,
  }, null, 2));
}

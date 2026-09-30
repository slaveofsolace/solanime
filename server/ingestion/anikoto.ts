import { createHash, randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import type { SqliteDatabase } from '../db.ts';
import { AppError } from '../errors.ts';
import type {
  CatalogueSnapshot,
  SnapshotEpisode,
  SnapshotProviderMapping,
  SnapshotTitle,
} from '../types.ts';
import {
  acquireWorkerLease,
  blockTask,
  claimTask,
  completeTask,
  createRun,
  enqueueTask,
  failTask,
  heartbeatWorkerLease,
  recoverInterruptedTasks,
  releaseWorkerLease,
  setRunPaused,
  terminalFailTask,
  type CrawlTask,
} from './queue.ts';
import {
  importSnapshot,
  markMissingEpisodeInventoryStale,
  markMissingProviderMappingsStale,
  markMissingTitlesStale,
  markProviderMappingsUnknownForMissingReference,
} from './snapshot.ts';
import { AnikotoSourceClient, SourceRequestError } from './source.ts';

const SOURCE_BASE = 'https://anikototv.to';
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

export interface ImportOptions {
  mode: 'slice' | 'full' | 'incremental';
  runId?: number;
  pageLimit?: number;
  titleLimit?: number;
  taskBudget?: number;
  maxTasksThisProcess?: number;
  includeProviders?: boolean;
  /** One database owner; only independent episode-server tasks may overlap. */
  concurrency?: number;
  exitWhenPaused?: boolean;
}

interface EpisodeWork {
  episode: SnapshotEpisode;
  serversRef: string | null;
}

function publicTitleUrl(href: string): { canonicalUrl: string; slug: string } | null {
  try {
    const url = new URL(href, SOURCE_BASE);
    if (
      url.protocol !== 'https:' ||
      !['anikototv.to', 'www.anikototv.to'].includes(url.hostname.toLowerCase())
    )
      return null;
    const match = /^\/watch\/([^/]+)(?:\/ep-[^/]+)?\/?$/.exec(url.pathname);
    if (!match) return null;
    return { slug: decodeURIComponent(match[1]), canonicalUrl: `${SOURCE_BASE}/watch/${match[1]}` };
  } catch {
    return null;
  }
}

function artwork(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, SOURCE_BASE);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function parseCataloguePage(html: string): { titles: SnapshotTitle[]; lastPage: number } {
  const $ = load(html);
  const bySourceId = new Map<string, SnapshotTitle>();
  $('div.ani.items > div.item').each((_index, item) => {
    const card = $(item);
    const poster = card.find('.ani.poster.tip').first();
    const sourceId = clean(poster.attr('data-tip'));
    const nameLink = card.find('a.name.d-title[href*="/watch/"]').first();
    const route = publicTitleUrl(
      nameLink.attr('href') ?? poster.find('a[href*="/watch/"]').first().attr('href') ?? '',
    );
    const name = clean(nameLink.text()) || clean(poster.find('img').attr('alt'));
    if (!sourceId || !route || !name) return;
    const alias = clean(nameLink.attr('data-jp'));
    const genres = card
      .find('.genre a[href*="/genre/"]')
      .map((_i, link) => clean($(link).text()))
      .get()
      .filter(Boolean);
    const format = clean(poster.find('.meta .right').text()) || null;
    bySourceId.set(sourceId, {
      sourceId,
      slug: route.slug,
      canonicalUrl: route.canonicalUrl,
      name,
      format,
      artworkUrl: artwork(poster.find('img').attr('src')),
      artworkOrigin: poster.find('img').attr('src') ? 'anikototv.to catalogue HTML' : null,
      artworkReuseStatus: 'reference-only',
      availability: 'observed',
      aliases:
        alias && alias.localeCompare(name, undefined, { sensitivity: 'accent' }) !== 0
          ? [{ name: alias, type: 'source-japanese-label' }]
          : [],
      genres,
      episodes: [],
    });
  });
  const pageNumbers = $('a[href*="page="]')
    .map((_index, link) => {
      try {
        return Number(new URL($(link).attr('href') ?? '', SOURCE_BASE).searchParams.get('page'));
      } catch {
        return 0;
      }
    })
    .get()
    .filter((page) => Number.isInteger(page) && page > 0);
  const lastPage = Math.max(1, ...pageNumbers);
  if (!bySourceId.size)
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      'Catalogue page contained no recognizable title cards.',
    );
  return { titles: [...bySourceId.values()], lastPage };
}

function metadataValue($: ReturnType<typeof load>, label: string): string | null {
  const target = $(`#watch-main .bmeta .meta > div`)
    .filter((_index, item) =>
      clean($(item).clone().children().remove().end().text())
        .toLowerCase()
        .startsWith(`${label.toLowerCase()}:`),
    )
    .first();
  return target.length ? clean(target.find('span').first().text()) || null : null;
}

function yearFromText(value: string | null): number | null {
  const matches = value?.match(/(?:19|20|21)\d{2}/g);
  return matches?.length ? Number(matches[0]) : null;
}

export function parseTitlePage(html: string, fallback: SnapshotTitle): SnapshotTitle {
  const $ = load(html);
  const main = $('#watch-main').first();
  const sourceId = clean(main.attr('data-id')) || fallback.sourceId;
  const route = publicTitleUrl(main.attr('data-url') ?? fallback.canonicalUrl) ?? {
    slug: fallback.slug,
    canonicalUrl: fallback.canonicalUrl,
  };
  const heading = main.find('h1.title').first();
  const name = clean(heading.text()) || fallback.name;
  const alias = clean(heading.attr('data-jp'));
  const genres = main
    .find('.bmeta a[href*="/genre/"]')
    .map((_index, link) => clean($(link).text()))
    .get()
    .filter(Boolean);
  const aired = metadataValue($, 'Aired');
  const recommended: NonNullable<SnapshotTitle['related']> = [];
  $('section.w-side-section')
    .filter(
      (_index, section) =>
        clean($(section).find('.title').first().text()).toLowerCase() === 'recommended',
    )
    .find('a.item[href*="/watch/"]')
    .each((_index, item) => {
      const link = $(item);
      const route = publicTitleUrl(link.attr('href') ?? '');
      const relatedSourceId = clean(link.find('[data-tip]').first().attr('data-tip'));
      const label = clean(link.find('.name').first().text());
      if (route && relatedSourceId)
        recommended.push({
          sourceId: relatedSourceId,
          relationshipType: 'recommended',
          label: label || null,
          sourceUrl: route.canonicalUrl,
        });
    });
  return {
    ...fallback,
    sourceId,
    slug: route.slug,
    canonicalUrl: route.canonicalUrl,
    name,
    description: clean(main.find('.synopsis').first().text()) || fallback.description || null,
    format: metadataValue($, 'Type') ?? fallback.format ?? null,
    releaseYear:
      yearFromText(metadataValue($, 'Premiered') ?? aired) ?? fallback.releaseYear ?? null,
    status: metadataValue($, 'Status') ?? fallback.status ?? null,
    artworkUrl: artwork(main.find('img').first().attr('src')) ?? fallback.artworkUrl ?? null,
    artworkOrigin: main.find('img').first().attr('src')
      ? 'anikototv.to title HTML'
      : (fallback.artworkOrigin ?? null),
    artworkReuseStatus: 'reference-only',
    availability: 'available',
    aliases: [
      ...(fallback.aliases ?? []),
      ...(alias && alias !== name ? [{ name: alias, type: 'source-japanese-label' }] : []),
    ].filter(
      (entry, index, all) => all.findIndex((candidate) => candidate.name === entry.name) === index,
    ),
    genres: genres.length ? genres : fallback.genres,
    related: recommended.length ? recommended : fallback.related,
  };
}

export function parseEpisodeList(html: string, title: SnapshotTitle): EpisodeWork[] {
  const $ = load(html);
  const episodes: EpisodeWork[] = [];
  const usedSlugs = new Set<string>();
  $('a[data-id][data-num]').each((_index, item) => {
    const anchor = $(item);
    const sourceId = clean(anchor.attr('data-id'));
    const number = clean(anchor.attr('data-num'));
    const sourceSlug = clean(anchor.attr('data-slug')) || number;
    if (!sourceId || !number || !sourceSlug) return;
    const versions: SnapshotEpisode['versions'] = [
      ...(anchor.attr('data-sub') === '1'
        ? [
            {
              sourceId: `${sourceId}:sub`,
              language: 'sub',
              label: 'Subtitled',
              subtitleLanguage: 'en',
              availability: 'observed' as const,
              providers: [],
            },
          ]
        : []),
      ...(anchor.attr('data-dub') === '1'
        ? [
            {
              sourceId: `${sourceId}:dub`,
              language: 'dub',
              label: 'Dubbed',
              audioLanguage: 'en',
              availability: 'observed' as const,
              providers: [],
            },
          ]
        : []),
    ];
    if (!versions.length)
      versions.push({
        sourceId: `${sourceId}:unknown`,
        language: 'unknown',
        label: 'Version not reported',
        availability: 'unknown',
        providers: [],
      });
    const numeric = Number(number);
    const baseSlug = `ep-${sourceSlug}`;
    const slug = usedSlugs.has(baseSlug) ? `${baseSlug}-${sourceId}` : baseSlug;
    usedSlugs.add(slug);
    // The source exposes a real episode name next to its canonical data-num.
    // Keep the number as the identity and fall back only when no name exists.
    const sourceName = clean(anchor.find('.d-title').first().text());
    const qualityMarker = /^(?:(?:UHD|FHD|HD|SD)(?:[-\s]*(?:480|720|1080|2160)p)?|[48]K)$/i.test(sourceName);
    const wholeReleaseMarker = /^full$/i.test(sourceName);
    const mismatchedNumber = /^episode\s+\d+(?:\.\d+)?$/i.test(sourceName) &&
      sourceName.replace(/^episode\s+/i, '') !== number;
    const label = qualityMarker || wholeReleaseMarker || mismatchedNumber
      ? `Episode ${number}`
      : sourceName || `Episode ${number}`;
    episodes.push({
      episode: {
        sourceId,
        number,
        numberSort: Number.isFinite(numeric) ? numeric : null,
        label,
        slug,
        canonicalUrl: `${title.canonicalUrl}/ep-${encodeURIComponent(sourceSlug)}`,
        availability: 'observed',
        versions,
      },
      serversRef: clean(anchor.attr('data-ids')) || null,
    });
  });
  return episodes;
}

export function classifyEpisodeList(html: string): 'episodes' | 'empty' | 'delayed' | 'unknown' {
  const $ = load(html);
  if ($('a[data-id][data-num]').length) return 'episodes';
  const evidence = `${html} ${$.root().text()}`;
  if (/loading|spinner|skeleton|please\s+wait/i.test(evidence)) return 'delayed';
  if (
    $('.head .filter').length > 0 &&
    $('.body .episodes').length === 1 &&
    $('[data-id],a').length === 0
  )
    return 'empty';
  return 'unknown';
}

export function classifyServerList(html: string): 'mappings' | 'empty' | 'delayed' | 'unknown' {
  const $ = load(html);
  const rawButtons = $('[data-link-id]').length;
  const groupedButtons = $('.type[data-type] [data-link-id]').length;
  if (rawButtons > 0 && rawButtons === groupedButtons) return 'mappings';
  const evidence = `${html} ${$.root().text()}`;
  if (/loading|spinner|skeleton|please\s+wait/i.test(evidence)) return 'delayed';
  if (/you(?:'|’)?re\s+watching\s+episode/i.test(evidence)) return 'empty';
  return 'unknown';
}

function providerIdForLabel(label: string): string {
  const known: Record<string, string> = {
    'vidstream-2': 'vidstream-2',
    'hd-1': 'hd-1',
    'hd-2': 'hd-2',
    'vidplay-1': 'vidplay-1',
    kiwi: 'kiwi',
    megaplay: 'megaplay',
  };
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 56) || 'unnamed';
  return known[slug] ?? `observed-${slug}`;
}

function ensureProvider(
  db: SqliteDatabase,
  providerId: string,
  label: string,
  observedAt: string,
): void {
  db.prepare(
    `INSERT INTO providers(id,label,identity_state,playback_type,adapter_state,capabilities_json,observed_limitation,evidence_class,first_seen_at,last_seen_at,updated_at)
    VALUES (?,?,'confirmed','unknown','unavailable','{}','Visible label observed; backend and supported integration not yet established.','public_response',?,?,?)
    ON CONFLICT(id) DO UPDATE SET label=excluded.label,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
  ).run(providerId, label, observedAt, observedAt, observedAt);
  db.prepare(
    "INSERT INTO provider_aliases(provider_id,alias,alias_type) VALUES (?,?,'visible_label') ON CONFLICT(provider_id,alias) DO NOTHING",
  ).run(providerId, label);
}

export function parseServerList(
  db: SqliteDatabase,
  html: string,
  observedAt: string,
): Map<string, SnapshotProviderMapping[]> {
  const $ = load(html);
  const grouped = new Map<string, SnapshotProviderMapping[]>();
  $('.type[data-type]').each((_index, group) => {
    const language = clean($(group).attr('data-type')).toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(language)) return;
    const mappings = grouped.get(language) ?? [];
    $(group)
      .find('[data-link-id]')
      .each((_i, item) => {
        const label = clean($(item).text());
        const resource = clean($(item).attr('data-link-id'));
        if (!label || !resource) return;
        const providerId = providerIdForLabel(label);
        ensureProvider(db, providerId, label, observedAt);
        const digest = createHash('sha256')
          .update(`${language}\0${label}\0${resource}`)
          .digest('hex');
        mappings.push({
          providerId,
          sourceMappingId: digest,
          providerResourceId: resource,
          availability: 'observed',
          mappingOrigin: 'native',
          publicExportAllowed: false,
        });
      });
    grouped.set(language, mappings);
  });
  return grouped;
}

function snapshot(
  observedAt: string,
  titles: SnapshotTitle[],
  denominator?: CatalogueSnapshot['denominator'],
): CatalogueSnapshot {
  return { schemaVersion: 1, source: 'anikoto', observedAt, denominator, titles };
}

function titleShellFromDb(db: SqliteDatabase, sourceId: string): SnapshotTitle {
  const row = db
    .prepare(
      "SELECT source_id AS sourceId,slug,canonical_url AS canonicalUrl,name,description,format,release_year AS releaseYear,status,artwork_url AS artworkUrl,artwork_origin AS artworkOrigin,artwork_reuse_status AS artworkReuseStatus,availability_state AS availability FROM titles WHERE source='anikoto' AND source_id=?",
    )
    .get(sourceId) as SnapshotTitle | undefined;
  if (!row)
    throw new AppError(404, 'NOT_FOUND', 'Queued title no longer exists in the local database.');
  return { ...row, episodes: [] };
}

function updateCheckpoint(db: SqliteDatabase, runId: number, patch: Record<string, unknown>): void {
  const row = db.prepare('SELECT checkpoint_json FROM crawl_runs WHERE id=?').get(runId) as
    | { checkpoint_json: string }
    | undefined;
  let current: Record<string, unknown> = {};
  try {
    current = row ? JSON.parse(row.checkpoint_json) : {};
  } catch {
    current = {};
  }
  db.prepare('UPDATE crawl_runs SET checkpoint_json=?,updated_at=? WHERE id=?').run(
    JSON.stringify({ ...current, ...patch }),
    new Date().toISOString(),
    runId,
  );
}

function payloadString(task: CrawlTask, name: string): string {
  const value = task.payload[name];
  if (typeof value !== 'string' || !value)
    throw new AppError(422, 'UPSTREAM_CHANGED', `Task ${task.taskKey} has invalid ${name}.`);
  return value;
}

async function importTitleDetail(
  db: SqliteDatabase,
  client: AnikotoSourceClient,
  task: CrawlTask,
  fallback: SnapshotTitle,
  titleHtml: string,
  observedAt: string,
): Promise<void> {
  const sourceId = fallback.sourceId;
  const title = parseTitlePage(titleHtml, fallback);
  if (title.sourceId !== sourceId)
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      `Title source identifier changed from ${sourceId} to ${title.sourceId}.`,
    );
  const episodePayload = await client.json<{ status?: unknown; result?: unknown }>(
    `/ajax/episode/list/${encodeURIComponent(sourceId)}?vrf=`,
  );
  if (episodePayload.status !== 200 || typeof episodePayload.result !== 'string')
    throw new AppError(422, 'UPSTREAM_CHANGED', 'Episode-list response shape changed.');
  const episodeListState = classifyEpisodeList(episodePayload.result);
  if (episodeListState === 'delayed')
    throw new AppError(
      503,
      'UNAVAILABLE',
      'Episode list returned a loading placeholder; existing episode rows were preserved for retry.',
    );
  if (episodeListState === 'unknown')
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      'Episode list contained neither episode records nor the observed empty-inventory structure.',
    );
  const episodeWork = parseEpisodeList(episodePayload.result, title);
  title.episodes = episodeWork.map((entry) => entry.episode);
  importSnapshot(db, snapshot(observedAt, [title]), task.runId, false);
  const staleInventory = markMissingEpisodeInventoryStale(db, sourceId, observedAt);
  if (episodeListState === 'empty')
    db.prepare(
      `INSERT INTO verification_observations(entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at)
    VALUES ('title',?,'observed','empty_episode_inventory','SOURCE_EMPTY_EPISODE_LIST','public_response',?,?)`,
    ).run(
      sourceId,
      JSON.stringify({
        envelopeStatus: episodePayload.status,
        htmlBytes: Buffer.byteLength(episodePayload.result),
        episodeAnchors: 0,
        delayedMarker: false,
      }),
      observedAt,
    );
  if (task.payload.includeProviders !== false) {
    for (const entry of episodeWork) {
      if (entry.serversRef)
        enqueueTask(
          db,
          task.runId,
          `servers:${sourceId}:${entry.episode.sourceId}`,
          'episode_servers',
          {
            titleSourceId: sourceId,
            episodeSourceId: entry.episode.sourceId,
            serversRef: entry.serversRef,
          },
        );
      else {
        const mappings = markProviderMappingsUnknownForMissingReference(
          db,
          sourceId,
          entry.episode.sourceId,
        );
        if (mappings)
          db.prepare(
            `INSERT INTO verification_observations(entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at)
          VALUES ('episode',?,'observed','provider_reference_absent','SOURCE_SERVER_REFERENCE_ABSENT','public_response',?,?)`,
          ).run(
            entry.episode.sourceId,
            JSON.stringify({ retainedMappingsMarkedUnknown: mappings }),
            observedAt,
          );
      }
    }
  }
  updateCheckpoint(db, task.runId, {
    lastTitleImported: sourceId,
    lastTitleStaleEpisodesMarked: staleInventory.episodes,
    lastTitleStaleVersionsMarked: staleInventory.versions,
    lastTitleStaleMappingsMarked: staleInventory.mappings,
  });
}

async function processTask(
  db: SqliteDatabase,
  client: AnikotoSourceClient,
  task: CrawlTask,
): Promise<void> {
  const observedAt = new Date().toISOString();
  if (task.taskType === 'catalogue_page') {
    const page = Number(task.payload.page);
    if (!Number.isInteger(page) || page < 1)
      throw new AppError(422, 'UPSTREAM_CHANGED', 'Catalogue task page is invalid.');
    const { body } = await client.text(`/filter?page=${page}`, 'html');
    const parsed = parseCataloguePage(body);
    const mode = String(task.payload.mode ?? 'slice');
    const pageLimit = Math.max(
      1,
      Math.min(parsed.lastPage, Number(task.payload.pageLimit) || parsed.lastPage),
    );
    const expectedPageLimit = Math.max(1, Number(task.payload.pageLimit) || pageLimit);
    if (mode !== 'slice' && page < expectedPageLimit && parsed.titles.length !== 30)
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        `Catalogue page ${page} exposed ${parsed.titles.length} title cards; 30 were expected before the final page.`,
      );
    if (
      mode !== 'slice' &&
      page === expectedPageLimit &&
      (parsed.titles.length < 1 || parsed.titles.length > 30)
    )
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        `Final catalogue page ${page} exposed an invalid card count.`,
      );
    if (page === 1 && mode !== 'slice') {
      for (let current = 2; current <= pageLimit; current++)
        enqueueTask(db, task.runId, `catalogue:${current}`, 'catalogue_page', {
          page: current,
          mode,
          pageLimit,
          includeProviders: task.payload.includeProviders !== false,
        });
      if (pageLimit === parsed.lastPage)
        enqueueTask(db, task.runId, 'sitemap:index', 'sitemap_index', {
          includeProviders: task.payload.includeProviders !== false,
        });
      if (pageLimit === parsed.lastPage)
        enqueueTask(db, task.runId, 'catalogue:reconcile', 'catalogue_reconcile', {
          expectedPages: pageLimit,
        });
      updateCheckpoint(db, task.runId, {
        catalogueLastPageObserved: parsed.lastPage,
        cataloguePageLimit: pageLimit,
      });
    }
    const titleLimit =
      mode === 'slice' ? Math.max(1, Number(task.payload.titleLimit) || 3) : parsed.titles.length;
    const titles = parsed.titles.slice(0, titleLimit);
    importSnapshot(
      db,
      snapshot(observedAt, titles, {
        titles: parsed.lastPage === 1 ? titles.length : undefined,
        scope: `Anikoto /filter pages 1-${pageLimit}; live last page observed ${parsed.lastPage}`,
      }),
      task.runId,
      false,
    );
    for (const title of titles)
      enqueueTask(db, task.runId, `title:${title.sourceId}`, 'title_detail', {
        sourceId: title.sourceId,
        includeProviders: task.payload.includeProviders !== false,
      });
    updateCheckpoint(db, task.runId, { lastCataloguePageImported: page });
    if (page === expectedPageLimit) {
      updateCheckpoint(db, task.runId, {
        lastCataloguePageItemCount: parsed.titles.length,
        visibleFilterRecordDenominator: (page - 1) * 30 + parsed.titles.length,
        denominatorBasis: '297 full pages observed at 30 cards plus final-page card count',
      });
    }
    return;
  }
  if (task.taskType === 'catalogue_reconcile') {
    const expectedPages = Number(task.payload.expectedPages);
    if (!Number.isInteger(expectedPages) || expectedPages < 1)
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Catalogue reconciliation task has an invalid page count.',
      );
    const catalogue = db
      .prepare(
        `SELECT COUNT(*) AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN status IN ('failed','blocked') THEN 1 ELSE 0 END) AS failed
      FROM crawl_tasks WHERE run_id=? AND task_type='catalogue_page'`,
      )
      .get(task.runId) as { total: number; completed: number | null; failed: number | null };
    const sitemap = db
      .prepare(
        `SELECT COUNT(*) AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN status IN ('failed','blocked') THEN 1 ELSE 0 END) AS failed
      FROM crawl_tasks WHERE run_id=? AND task_type IN ('sitemap_index','sitemap_page','sitemap_title')`,
      )
      .get(task.runId) as { total: number; completed: number | null; failed: number | null };
    if (
      catalogue.total !== expectedPages ||
      Number(catalogue.completed) !== expectedPages ||
      Number(catalogue.failed) !== 0
    )
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Catalogue reconciliation refused an incomplete or failed page set.',
      );
    if (
      sitemap.total === 0 ||
      Number(sitemap.completed) !== sitemap.total ||
      Number(sitemap.failed) !== 0
    )
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Catalogue reconciliation refused an incomplete or failed sitemap set.',
      );
    const filterRecords = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM crawl_tasks WHERE run_id=? AND task_type='title_detail'",
          )
          .get(task.runId) as { count: number }
      ).count,
    );
    updateCheckpoint(db, task.runId, {
      visibleFilterRecordDenominator: filterRecords,
      denominatorBasis:
        'distinct title identifiers from the complete validated /filter page task set',
      staleTitlesMarked: markMissingTitlesStale(db, task.runId),
      discoveryReconciledAt: observedAt,
    });
    return;
  }
  if (task.taskType === 'title_detail') {
    const sourceId = payloadString(task, 'sourceId');
    const fallback = titleShellFromDb(db, sourceId);
    const { body: titleHtml } = await client.text(fallback.canonicalUrl, 'html');
    await importTitleDetail(db, client, task, fallback, titleHtml, observedAt);
    return;
  }
  if (task.taskType === 'sitemap_index') {
    const { body } = await client.text('/sitemap.xml', 'html');
    const $ = load(body, { xmlMode: true });
    if ($('sitemapindex').length !== 1)
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Public sitemap index did not contain the expected sitemapindex root.',
      );
    const locations = $('sitemap loc')
      .map((_index, item) => clean($(item).text()))
      .get();
    if (!locations.length)
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Public sitemap index contained no sitemap locations.',
      );
    let queued = 0;
    for (const location of locations) {
      let url: URL;
      try {
        url = new URL(location);
      } catch {
        continue;
      }
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'anikototv.to' ||
        !url.pathname.endsWith('.xml')
      )
        continue;
      const key = createHash('sha256').update(url.toString()).digest('hex').slice(0, 24);
      enqueueTask(db, task.runId, `sitemap-page:${key}`, 'sitemap_page', {
        url: url.toString(),
        includeProviders: task.payload.includeProviders !== false,
      });
      queued++;
    }
    if (!queued)
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Public sitemap index contained no allowlisted child maps.',
      );
    updateCheckpoint(db, task.runId, { sitemapChildrenDiscovered: queued });
    return;
  }
  if (task.taskType === 'sitemap_page') {
    const sitemapUrl = payloadString(task, 'url');
    const { body } = await client.text(sitemapUrl, 'html');
    const $ = load(body, { xmlMode: true });
    if ($('urlset').length !== 1)
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Public sitemap page did not contain the expected urlset root.',
      );
    const rawLocations = $('url loc')
      .map((_index, item) => clean($(item).text()))
      .get();
    if (!rawLocations.length)
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Public sitemap page contained no URL locations.',
      );
    const run = db
      .prepare('SELECT started_at AS startedAt FROM crawl_runs WHERE id=?')
      .get(task.runId) as { startedAt: string | null } | undefined;
    let discovered = 0;
    for (const location of rawLocations) {
      const route = publicTitleUrl(location);
      if (!route) continue;
      const existing = db
        .prepare(
          "SELECT last_seen_at AS lastSeen FROM titles WHERE source='anikoto' AND canonical_url=?",
        )
        .get(route.canonicalUrl) as { lastSeen: string } | undefined;
      if (existing && (!run?.startedAt || existing.lastSeen >= run.startedAt)) continue;
      enqueueTask(db, task.runId, `sitemap-title:${route.slug}`, 'sitemap_title', {
        canonicalUrl: route.canonicalUrl,
        includeProviders: task.payload.includeProviders !== false,
      });
      discovered++;
    }
    updateCheckpoint(db, task.runId, {
      lastSitemapPageImported: sitemapUrl,
      lastSitemapOnlyRoutesQueued: discovered,
    });
    return;
  }
  if (task.taskType === 'sitemap_title') {
    const canonicalUrl = payloadString(task, 'canonicalUrl');
    const route = publicTitleUrl(canonicalUrl);
    if (!route) throw new AppError(422, 'UPSTREAM_CHANGED', 'Sitemap title route is invalid.');
    const { body: titleHtml } = await client.text(route.canonicalUrl, 'html');
    const $ = load(titleHtml);
    const main = $('#watch-main').first();
    const sourceId = clean(main.attr('data-id'));
    const name = clean(main.find('h1.title').first().text());
    if (!sourceId || !name)
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Sitemap title page did not expose a public title identifier and name.',
      );
    const existing = db
      .prepare(
        "SELECT source_id AS sourceId,slug,canonical_url AS canonicalUrl,name,description,format,release_year AS releaseYear,status,artwork_url AS artworkUrl,artwork_origin AS artworkOrigin,artwork_reuse_status AS artworkReuseStatus,availability_state AS availability FROM titles WHERE source='anikoto' AND source_id=?",
      )
      .get(sourceId) as SnapshotTitle | undefined;
    const fallback: SnapshotTitle = existing ?? {
      sourceId,
      slug: route.slug,
      canonicalUrl: route.canonicalUrl,
      name,
      availability: 'observed',
      aliases: [],
      genres: [],
      related: [],
      episodes: [],
    };
    await importTitleDetail(
      db,
      client,
      task,
      { ...fallback, slug: route.slug, canonicalUrl: route.canonicalUrl },
      titleHtml,
      observedAt,
    );
    updateCheckpoint(db, task.runId, { lastSitemapTitleImported: sourceId });
    return;
  }
  if (task.taskType === 'episode_servers') {
    const titleSourceId = payloadString(task, 'titleSourceId');
    const episodeSourceId = payloadString(task, 'episodeSourceId');
    const serversRef = payloadString(task, 'serversRef');
    const payload = await client.json<{ status?: unknown; result?: unknown }>(
      `/ajax/server/list?servers=${encodeURIComponent(serversRef)}`,
    );
    if (payload.status !== 200 || typeof payload.result !== 'string')
      throw new AppError(422, 'UPSTREAM_CHANGED', 'Server-list response shape changed.');
    const serverListState = classifyServerList(payload.result);
    if (serverListState === 'delayed')
      throw new AppError(
        503,
        'UNAVAILABLE',
        'Server list returned a loading placeholder; existing mappings were preserved for retry.',
      );
    if (serverListState === 'unknown')
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        'Server list contained neither provider mappings nor the observed empty-inventory structure.',
      );
    const groups = parseServerList(db, payload.result, observedAt);
    const $serverList = load(payload.result);
    const rawMappingCount = $serverList('[data-link-id]').length;
    const parsedMappingCount = [...groups.values()].reduce(
      (sum, mappings) => sum + mappings.length,
      0,
    );
    if (
      serverListState === 'mappings' &&
      (rawMappingCount === 0 || parsedMappingCount !== rawMappingCount)
    )
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        `Server-list parser retained ${parsedMappingCount} of ${rawMappingCount} observed mapping buttons.`,
      );
    const title = titleShellFromDb(db, titleSourceId);
    const episodeRow = db
      .prepare(
        "SELECT source_id AS sourceId,number_text AS number,number_sort AS numberSort,label,slug,canonical_url AS canonicalUrl,episode_type AS episodeType,availability_state AS availability FROM episodes WHERE title_id=(SELECT id FROM titles WHERE source='anikoto' AND source_id=?) AND source_id=?",
      )
      .get(titleSourceId, episodeSourceId) as SnapshotEpisode | undefined;
    if (!episodeRow)
      throw new AppError(
        404,
        'NOT_FOUND',
        'Queued episode no longer exists in the local database.',
      );
    const versionRows = db
      .prepare(
        "SELECT source_id AS sourceId,language,version_label AS label,audio_language AS audioLanguage,subtitle_language AS subtitleLanguage,availability_state AS availability FROM episode_versions WHERE episode_id=(SELECT id FROM episodes WHERE title_id=(SELECT id FROM titles WHERE source='anikoto' AND source_id=?) AND source_id=?)",
      )
      .all(titleSourceId, episodeSourceId) as unknown as SnapshotEpisode['versions'];
    const versionsByLanguage = new Map(versionRows.map((version) => [version.language, version]));
    for (const language of groups.keys())
      if (!versionsByLanguage.has(language))
        versionsByLanguage.set(language, {
          sourceId: `${episodeSourceId}:${language}`,
          language,
          label: language.toUpperCase(),
          availability: 'observed',
          providers: [],
        });
    episodeRow.versions = [...versionsByLanguage.values()].map((version) => ({
      ...version,
      providers: groups.get(version.language) ?? [],
    }));
    title.episodes = [episodeRow];
    importSnapshot(db, snapshot(observedAt, [title]), task.runId, false, false);
    const staleMappings = markMissingProviderMappingsStale(
      db,
      titleSourceId,
      episodeSourceId,
      observedAt,
    );
    if (serverListState === 'empty')
      db.prepare(
        `INSERT INTO verification_observations(entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at)
      VALUES ('episode',?,'observed','empty_provider_inventory','SOURCE_EMPTY_PROVIDER_LIST','public_response',?,?)`,
      ).run(
        episodeSourceId,
        JSON.stringify({
          envelopeStatus: payload.status,
          htmlBytes: Buffer.byteLength(payload.result),
          providerButtons: 0,
          delayedMarker: false,
        }),
        observedAt,
      );
    updateCheckpoint(db, task.runId, {
      lastEpisodeProvidersImported: episodeSourceId,
      lastEpisodeStaleMappingsMarked: staleMappings,
    });
    return;
  }
  throw new AppError(422, 'UPSTREAM_CHANGED', `Unknown crawl task type ${task.taskType}.`);
}

export function createAnikotoRun(db: SqliteDatabase, options: ImportOptions): number {
  const runId = createRun(db, options.mode, options.taskBudget);
  enqueueTask(db, runId, 'catalogue:1', 'catalogue_page', {
    page: 1,
    mode: options.mode,
    pageLimit: options.pageLimit,
    titleLimit: options.titleLimit,
    includeProviders: options.includeProviders !== false,
  });
  return runId;
}

export async function runAnikotoWorker(
  db: SqliteDatabase,
  options: ImportOptions,
): Promise<{ runId: number; processed: number; recovered: number }> {
  const runId = options.runId ?? createAnikotoRun(db, options);
  const workerId = process.env.SOLANIME_WORKER_ID ?? randomUUID();
  if (!acquireWorkerLease(db, runId, workerId))
    throw new AppError(
      409,
      'UNAVAILABLE',
      'Another importer owns a fresh database worker lease for this crawl run.',
    );
  try {
    const existingRun = db
      .prepare('SELECT mode,checkpoint_json AS checkpoint FROM crawl_runs WHERE id=?')
      .get(runId) as { mode: string; checkpoint: string } | undefined;
    if (existingRun && ['full', 'incremental'].includes(existingRun.mode)) {
      let checkpoint: Record<string, unknown> = {};
      try {
        checkpoint = JSON.parse(existingRun.checkpoint) as Record<string, unknown>;
      } catch {
        checkpoint = {};
      }
      const expectedPages = Number(
        checkpoint.cataloguePageLimit ?? checkpoint.catalogueLastPageObserved,
      );
      if (Number.isInteger(expectedPages) && expectedPages > 0)
        enqueueTask(db, runId, 'catalogue:reconcile', 'catalogue_reconcile', { expectedPages });
    }
    const recovered = recoverInterruptedTasks(db, runId, workerId);
    const client = new AnikotoSourceClient();
    try {
      const savedDelay = JSON.parse(existingRun?.checkpoint || '{}').sourceBackoffDelayMs;
      if (Number.isInteger(savedDelay) && savedDelay >= 50 && savedDelay <= 60_000)
        client.delayMs = Math.max(client.delayMs, savedDelay);
    } catch { /* Legacy checkpoints have no saved host backoff. */ }
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10)
      throw new AppError(422, 'BAD_REQUEST', 'Source concurrency must be between 1 and 10.');
    let processed = 0;
    const maxTasks =
      options.maxTasksThisProcess && options.maxTasksThisProcess > 0
        ? options.maxTasksThisProcess
        : Number.POSITIVE_INFINITY;
    while (processed < maxTasks) {
      if (!heartbeatWorkerLease(db, runId, workerId))
        throw new AppError(409, 'UNAVAILABLE', 'The importer lost its database worker lease.');
      const task = claimTask(db, runId, workerId);
      if (!task) {
        const run = db.prepare('SELECT status,checkpoint_json FROM crawl_runs WHERE id=?').get(runId) as
          | { status: string; checkpoint_json: string }
          | undefined;
        if (!run || ['completed', 'failed', 'cancelled'].includes(run.status)) break;
        if (run.status === 'paused') {
          if (options.exitWhenPaused) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
        const pending = db
          .prepare(
            "SELECT MIN(available_at) AS availableAt,COUNT(*) AS count FROM crawl_tasks WHERE run_id=? AND status IN ('pending','retry','running')",
          )
          .get(runId) as { availableAt: string | null; count: number };
        if (!pending.count) break;
        let hostDeadline = 0;
        try { hostDeadline = Date.parse(JSON.parse(run.checkpoint_json || '{}').sourceRetryAfterAt ?? '') || 0; }
        catch { /* Legacy malformed checkpoints do not invent a source cooldown. */ }
        const nextDelay = pending.availableAt
          ? Math.max(new Date(pending.availableAt).getTime(), hostDeadline) - Date.now()
          : 1_000;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(250, Math.min(30_000, nextDelay))),
        );
        continue;
      }
      const batch = [task];
      // Discovery mutates episode inventories: keep it serialized. Parallelism is
      // enabled only after all discovery/reconciliation prerequisites have settled.
      const discoveryPending =
        concurrency > 1 && task.taskType === 'episode_servers'
          ? db.prepare("SELECT 1 FROM crawl_tasks WHERE run_id=? AND task_type<>'episode_servers' AND status IN ('pending','retry','running') LIMIT 1").get(runId)
          : true;
      if (!discoveryPending) {
        while (batch.length < concurrency && processed + batch.length < maxTasks) {
          const next = claimTask(db, runId, workerId);
          if (!next) break;
          batch.push(next);
        }
      }
      const outcomes = await Promise.allSettled(batch.map(async task => {
        try {
          await processTask(db, client, task);
          completeTask(db, task);
        } catch (error) {
          if (error instanceof SourceRequestError && error.code === 'BLOCKED') {
            blockTask(db, task, error.code, error.message, error.httpStatus);
            setRunPaused(db, task.runId, true);
          } else if (error instanceof SourceRequestError && !error.retryable) {
            terminalFailTask(db, task, error.code, error.message, error.httpStatus);
          } else if (error instanceof SourceRequestError) {
            if (error.retryAfterMs) {
              const checkpoint = db.prepare('SELECT checkpoint_json FROM crawl_runs WHERE id=?').get(runId) as { checkpoint_json: string };
              let previous = 0;
              try { previous = Date.parse(JSON.parse(checkpoint.checkpoint_json || '{}').sourceRetryAfterAt ?? '') || 0; } catch { /* Keep other checkpoint fields through updateCheckpoint. */ }
              updateCheckpoint(db, runId, {
                sourceRetryAfterAt: new Date(Math.max(previous, Date.now() + error.retryAfterMs)).toISOString(),
                sourceBackoffDelayMs: client.delayMs,
              });
            }
            failTask(db, task, error.code, error.message, error.httpStatus, error.retryAfterMs);
          } else {
            const appError = error instanceof AppError ? error : new AppError(
              500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown ingestion error.',
            );
            failTask(db, task, appError.code, appError.message);
            if (appError.code === 'UPSTREAM_CHANGED') setRunPaused(db, task.runId, true);
          }
        }
      }));
      // Drain every in-flight task before releasing the lease/closing SQLite.
      const unexpected = outcomes.find(outcome => outcome.status === 'rejected');
      if (unexpected?.status === 'rejected') throw unexpected.reason;
      const beforeProcessed = processed;
      processed += batch.length;
      if (Math.floor(beforeProcessed / 25) !== Math.floor(processed / 25)) {
        captureCoverage(db, runId);
        console.log(JSON.stringify({ runId, processed, delayMs: client.delayMs, concurrency }));
      }
    }
    return { runId, processed, recovered };
  } finally {
    releaseWorkerLease(db, workerId, runId);
  }
}

export function captureCoverage(
  db: SqliteDatabase,
  runId: number,
  denominatorScope?: string,
): void {
  const counts = db
    .prepare(
      `SELECT
    (SELECT COUNT(*) FROM titles) AS titles,
    (SELECT COUNT(*) FROM episodes) AS episodes,
    (SELECT COUNT(*) FROM episode_versions) AS versions,
    (SELECT COUNT(*) FROM episode_provider_mappings) AS mappings,
    (SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status='failed') AS failures,
    (SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status='blocked') AS blocked,
    (SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('pending','running','retry')) AS pending`,
    )
    .get(runId, runId, runId) as Record<string, number>;
  const run = db.prepare('SELECT checkpoint_json FROM crawl_runs WHERE id=?').get(runId) as
    | { checkpoint_json?: string }
    | undefined;
  let checkpoint: Record<string, unknown> = {};
  try {
    checkpoint = run?.checkpoint_json ? JSON.parse(run.checkpoint_json) : {};
  } catch {
    checkpoint = {};
  }
  const catalogueComplete =
    checkpoint.lastCataloguePageImported === checkpoint.catalogueLastPageObserved;
  const sitemapPages = db
    .prepare(
      `SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status IN ('failed','blocked') THEN 1 ELSE 0 END) AS failed
    FROM crawl_tasks WHERE run_id=? AND task_type='sitemap_page'`,
    )
    .get(runId) as { total: number; completed: number | null; failed: number | null };
  const sitemapTitleTasks = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM crawl_tasks WHERE run_id=? AND task_type='sitemap_title'",
        )
        .get(runId) as { count: number }
    ).count,
  );
  const filterTaskCount = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM crawl_tasks WHERE run_id=? AND task_type='title_detail'",
        )
        .get(runId) as { count: number }
    ).count,
  );
  const filterDenominator = Number(checkpoint.visibleFilterRecordDenominator ?? filterTaskCount);
  const discoveredTitles =
    catalogueComplete && filterDenominator
      ? Math.max(counts.titles, filterDenominator + sitemapTitleTasks)
      : counts.titles;
  const sitemapComplete =
    sitemapPages.total > 0 &&
    Number(sitemapPages.completed) === sitemapPages.total &&
    Number(sitemapPages.failed) === 0;
  const scope =
    denominatorScope ??
    (catalogueComplete && sitemapComplete
      ? `Complete public discovery union: ${discoveredTitles.toLocaleString('en-US')} distinct watch routes from ${filterDenominator.toLocaleString('en-US')} /filter records plus ${sitemapTitleTasks.toLocaleString('en-US')} sitemap-only routes across ${sitemapPages.total} child maps; current snapshot denominator, not a private database claim`
      : catalogueComplete
        ? `Complete live /filter pagination discovery (${filterDenominator.toLocaleString('en-US')} records) with sitemap reconciliation in progress; current snapshot denominator, not a private database claim`
        : 'Distinct public records discovered by completed crawl tasks');
  db.prepare(
    `INSERT INTO coverage_snapshots(run_id,discovered_titles,imported_titles,discovered_episodes,imported_episodes,imported_versions,discovered_mappings,imported_mappings,duplicates,failures,blocked,pending,denominator_scope,captured_at)
    VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?)`,
  ).run(
    runId,
    discoveredTitles,
    counts.titles,
    counts.episodes,
    counts.episodes,
    counts.versions,
    counts.mappings,
    counts.mappings,
    counts.failures,
    counts.blocked,
    counts.pending,
    scope,
    new Date().toISOString(),
  );
}

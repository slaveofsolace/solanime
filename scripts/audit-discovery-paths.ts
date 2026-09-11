import { AnikotoSourceClient, SourceRequestError } from '../server/ingestion/source.ts';
import { parseCataloguePage } from '../server/ingestion/anikoto.ts';
import { load } from 'cheerio';
import { migrate, openDatabase } from '../server/db.ts';

const client = new AnikotoSourceClient();
const results: Array<Record<string, unknown>> = [];
const sitemapChildren: string[] = [];
const sitemapWatchRoutes = new Set<string>();

function watchRoute(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'anikototv.to') return null;
    const match = /^\/watch\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
    return match ? `https://anikototv.to/watch/${match[1]}` : null;
  } catch {
    return null;
  }
}

for (const path of ['/robots.txt', '/sitemap.xml']) {
  try {
    const { body, response } = await client.text(path, 'html');
    const isSitemap = /<urlset|<sitemapindex/i.test(body);
    const $ = load(body, { xmlMode: true });
    const locations = $('loc')
      .map((_index, item) => $(item).text().trim())
      .get();
    if (path === '/sitemap.xml')
      sitemapChildren.push(
        ...$('sitemap loc')
          .map((_index, item) => $(item).text().trim())
          .get(),
      );
    results.push({
      path,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bytes: Buffer.byteLength(body),
      sitemapIndexes: $('sitemap').length,
      urlEntries: $('url').length,
      locations: locations.length,
      watchLocations: locations.filter((location) =>
        /^https:\/\/anikototv\.to\/watch\//.test(location),
      ).length,
      usableForTitleDiscovery: isSitemap,
    });
  } catch (error) {
    results.push({
      path,
      status: error instanceof SourceRequestError ? (error.httpStatus ?? null) : null,
      errorCode: error instanceof SourceRequestError ? error.code : 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      usableForTitleDiscovery: false,
    });
  }
}

let sitemapFailures = 0;
if (process.argv.includes('--expand-sitemaps')) {
  for (const [index, location] of sitemapChildren.entries()) {
    try {
      const { body } = await client.text(location, 'html');
      const $ = load(body, { xmlMode: true });
      for (const value of $('url loc')
        .map((_itemIndex, item) => $(item).text().trim())
        .get()) {
        const route = watchRoute(value);
        if (route) sitemapWatchRoutes.add(route);
      }
    } catch {
      sitemapFailures++;
    }
    if ((index + 1) % 25 === 0)
      console.log(
        JSON.stringify({
          sitemapProgress: index + 1,
          sitemapChildren: sitemapChildren.length,
          watchRoutes: sitemapWatchRoutes.size,
          failures: sitemapFailures,
        }),
      );
  }
}

try {
  const { body, response } = await client.text('/filter?page=1', 'html');
  const parsed = parseCataloguePage(body);
  results.push({
    path: '/filter?page=1',
    status: response.status,
    titleCards: parsed.titles.length,
    lastPage: parsed.lastPage,
    usableForTitleDiscovery: parsed.titles.length > 0,
  });
} catch (error) {
  results.push({
    path: '/filter?page=1',
    status: error instanceof SourceRequestError ? (error.httpStatus ?? null) : null,
    errorCode: error instanceof SourceRequestError ? error.code : 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'Unknown error',
    usableForTitleDiscovery: false,
  });
}

let reconciliation: Record<string, unknown> | null = null;
if (process.argv.includes('--expand-sitemaps')) {
  const db = openDatabase();
  try {
    migrate(db);
    const databaseRoutes = new Set(
      (
        db
          .prepare("SELECT canonical_url AS canonicalUrl FROM titles WHERE source='anikoto'")
          .all() as Array<{ canonicalUrl: string }>
      )
        .map((row) => watchRoute(row.canonicalUrl))
        .filter((route): route is string => Boolean(route)),
    );
    const sitemapOnly = [...sitemapWatchRoutes].filter((route) => !databaseRoutes.has(route));
    const filterOnly = [...databaseRoutes].filter((route) => !sitemapWatchRoutes.has(route));
    reconciliation = {
      sitemapChildren: sitemapChildren.length,
      sitemapFailures,
      distinctSitemapWatchRoutes: sitemapWatchRoutes.size,
      distinctDatabaseWatchRoutes: databaseRoutes.size,
      sitemapOnly: sitemapOnly.length,
      filterOnly: filterOnly.length,
      sitemapOnlySamples: sitemapOnly.slice(0, 20),
      filterOnlySamples: filterOnly.slice(0, 20),
    };
  } finally {
    db.close();
  }
}

console.log(
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      results,
      reconciliation,
      selectedDiscoveryPath: '/filter pagination reconciled against public sitemap routes',
      note: 'Failures are reported as observed; no access block is bypassed.',
    },
    null,
    2,
  ),
);

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [reportArgument, outputArgument] = process.argv.slice(2);
if (!reportArgument) {
  console.error('Usage: node scripts/summarize-provider-playback.mjs <report.json> [summary.json]');
  process.exit(2);
}

const reportPath = resolve(reportArgument);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const database = new DatabaseSync(report.databasePath, { readOnly: true });
const formatStatement = database.prepare(`
  SELECT COALESCE(NULLIF(TRIM(t.format), ''), 'Unknown') AS format
  FROM episodes e
  JOIN titles t ON t.id = e.title_id
  WHERE e.id = ?
`);

function aggregate(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = String(keyOf(item) ?? 'unknown');
    const row = groups.get(key) ?? { attempted: 0, passed: 0, failed: 0 };
    row.attempted += 1;
    row[item.status === 'passed' ? 'passed' : 'failed'] += 1;
    groups.set(key, row);
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => [key, {
    ...row,
    passRatePercent: Number((row.passed * 100 / row.attempted).toFixed(2)),
  }]));
}

function normalizeContentType(value) {
  const normalized = String(value ?? 'Unknown').trim().toLowerCase();
  return ({ movie: 'Movie', tv: 'TV', ova: 'OVA', ona: 'ONA', special: 'Special' })[normalized] ?? value ?? 'Unknown';
}

function failureClass(result) {
  const reason = String(result.reason ?? 'unknown');
  if (reason.includes("Provider playback · MegaPlay")) return 'provider-readiness-timeout';
  if (reason.includes('waitForFunction')) return 'progress-timeout';
  if (reason.includes('Unexpected top-level navigation')) return 'containment-failure';
  if (reason.includes('iframe')) return 'iframe-validation-failure';
  return reason.split('\n')[0].slice(0, 160) || 'unknown';
}

const results = report.results.map((result) => ({
  ...result,
  contentType: normalizeContentType(formatStatement.get(result.episodeId)?.format),
}));
const failed = results.filter((result) => result.status !== 'passed');
const summary = {
  schemaVersion: 1,
  sourceReport: reportPath,
  generatedAt: new Date().toISOString(),
  origin: report.origin,
  seed: report.seed,
  attempted: results.length,
  passed: results.filter((result) => result.status === 'passed').length,
  failed: failed.length,
  passRatePercent: Number((results.filter((result) => result.status === 'passed').length * 100 / results.length).toFixed(2)),
  byProvider: aggregate(results, (result) => result.providerId),
  byLanguage: aggregate(results, (result) => result.language),
  byContentType: aggregate(results, (result) => result.contentType),
  failuresByClass: aggregate(failed, failureClass),
  containment: {
    guardActive: results.filter((result) => result.guardActive).length,
    validatedFrameLoaded: results.filter((result) => result.frameLoaded).length,
    parentRouteStable: results.filter((result) => result.parentStayedOnWatchRoute).length,
    zeroSurvivingUnexpectedPages: results.filter((result) => result.unexpectedPages?.length === 0).length,
  },
  failedMappings: failed.map(({ mappingId, providerId, language, episodeId, slug, title, contentType, reason }) => ({
    mappingId, providerId, language, episodeId, slug, title, contentType, failureClass: failureClass({ reason }), reason,
  })),
};

database.close();
const rendered = `${JSON.stringify(summary, null, 2)}\n`;
if (outputArgument) writeFileSync(resolve(outputArgument), rendered);
process.stdout.write(rendered);

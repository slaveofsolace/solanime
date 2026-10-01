/**
 * Repair one Anikoto title's generated episode labels from its current public
 * episode inventory. Dry run by default; --execute writes only exact source
 * episode IDs and numbers whose stored labels are still generic.
 */
import { execFileSync } from 'node:child_process';
import { load } from 'cheerio';
import { parseEpisodeList } from '../server/ingestion/anikoto.ts';

type StoredEpisode = { sourceId: string; number: string; label: string | null };
const argumentsByName = new Map(process.argv.slice(2).map(argument => {
  const [name, ...value] = argument.replace(/^--/, '').split('=');
  return [name, value.join('=')];
}));
const sourceId = argumentsByName.get('source-id') ?? '';
const slug = argumentsByName.get('slug') ?? '';
const execute = argumentsByName.has('execute');
if (!/^\d{1,10}$/.test(sourceId) || !/^[a-z0-9-]{1,160}$/.test(slug) ||
  [...argumentsByName.keys()].some(key => !['source-id', 'slug', 'execute'].includes(key))) {
  throw new Error('Usage: node --import tsx scripts/repair-episode-labels.ts --source-id=686 --slug=verified-title-slug [--execute]');
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function d1(sql: string): { results: Record<string, unknown>[]; meta: { changes: number } } {
  const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'CATALOGUE', '--remote', `--command=${sql}`, '--json'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const result = JSON.parse(output) as Array<{ results: Record<string, unknown>[]; success: boolean; meta: { changes: number } }>;
  if (result.length !== 1 || !result[0].success) throw new Error('Remote catalogue query failed.');
  return result[0];
}

const pageUrl = `https://anikototv.to/watch/${slug}`;
const page = await fetch(pageUrl, { signal: AbortSignal.timeout(20_000) });
if (!page.ok) throw new Error(`Source title page returned ${page.status}.`);
const $ = load(await page.text());
if ($('#watch-main').attr('data-id') !== sourceId) throw new Error('Source title ID does not match the requested slug.');
const sourceResponse = await fetch(`https://anikototv.to/ajax/episode/list/${sourceId}?vrf=`, {
  headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: pageUrl }, signal: AbortSignal.timeout(20_000),
});
if (!sourceResponse.ok) throw new Error(`Source episode list returned ${sourceResponse.status}.`);
const envelope = await sourceResponse.json() as { status?: unknown; result?: unknown };
if (envelope.status !== 200 || typeof envelope.result !== 'string') throw new Error('Source episode list did not contain a complete response.');
const title = { sourceId, slug, canonicalUrl: pageUrl, name: $('h1.title').first().text().trim(), episodes: [] };
const sourceEpisodes = parseEpisodeList(envelope.result, title).map(({ episode }) => ({
  sourceId: episode.sourceId, number: episode.number, label: episode.label ?? `Episode ${episode.number}`,
}));
const rawCount = load(envelope.result)('a[data-id][data-num]').length;
if (sourceEpisodes.length !== rawCount || !rawCount || rawCount > 50 ||
  new Set(sourceEpisodes.map(episode => episode.sourceId)).size !== rawCount) {
  throw new Error('Source inventory is empty, too large for a narrow repair, or has duplicate/incomplete episode IDs.');
}
const remote = d1(`SELECT e.source_id AS sourceId,e.number_text AS number,e.label FROM episodes e JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=${quote(sourceId)} AND t.slug=${quote(slug)} ORDER BY e.id`);
const stored = remote.results as StoredEpisode[];
const byId = new Map(stored.map(episode => [episode.sourceId, episode]));
if (stored.length !== rawCount || byId.size !== rawCount || sourceEpisodes.some(episode => byId.get(episode.sourceId)?.number !== episode.number)) {
  throw new Error(`Exact inventory mismatch: source=${rawCount}, remote=${stored.length}; no rows changed.`);
}
const named = sourceEpisodes.filter(episode => episode.label !== `Episode ${episode.number}`);
const eligible = named.filter(episode => byId.get(episode.sourceId)?.label === `Episode ${episode.number}`);
console.log(JSON.stringify({ sourceId, slug, sourceEpisodes: rawCount, verifiedStoredEpisodes: stored.length,
  namedSourceEpisodes: named.length, genericStoredEpisodes: stored.filter(episode => episode.label === `Episode ${episode.number}`).length,
  eligibleChanges: eligible.length, mode: execute ? 'execute' : 'dry-run',
  examples: eligible.slice(0, 3).map(episode => ({ number: episode.number, sourceId: episode.sourceId, title: episode.label })) }, null, 2));
if (!execute || !eligible.length) process.exit(0);

const clauses = eligible.map(episode => `WHEN ${quote(episode.sourceId)} THEN ${quote(episode.label)}`).join(' ');
const keys = eligible.map(episode => `(${quote(episode.sourceId)},${quote(episode.number)})`).join(',');
const sql = `UPDATE episodes SET label=CASE source_id ${clauses} ELSE label END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE title_id=(SELECT id FROM titles WHERE source='anikoto' AND source_id=${quote(sourceId)} AND slug=${quote(slug)}) AND (source_id,number_text) IN (VALUES ${keys}) AND label='Episode '||number_text`;
const applied = d1(sql);
const after = d1(`SELECT e.source_id AS sourceId,e.number_text AS number,e.label FROM episodes e JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=${quote(sourceId)} AND t.slug=${quote(slug)} ORDER BY e.id`).results as StoredEpisode[];
if (applied.meta.changes !== eligible.length || eligible.some(episode => after.find(row => row.sourceId === episode.sourceId && row.number === episode.number)?.label !== episode.label)) {
  throw new Error(`Repair verification failed: expected ${eligible.length}, changed ${applied.meta.changes}. Inspect remote rows before retry.`);
}
console.log(JSON.stringify({ sourceId, appliedChanges: applied.meta.changes, verifiedNamedEpisodes: after.filter(episode => episode.label !== `Episode ${episode.number}`).length }));

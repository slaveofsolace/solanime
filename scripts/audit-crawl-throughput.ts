/** Read-only source-shape and queue audit. No media resolution or database writes. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { load } from 'cheerio';
import { AnikotoSourceClient } from '../server/ingestion/source.ts';

const base = 'E:/CodexProjects/solanime-cloud-artifacts/mapping-resume-20260913';
const output = `${base}/throughput-audit`;
mkdirSync(output, { recursive: true });
const db = new DatabaseSync(`${base}/catalogue.sqlite`, { readOnly: true });
const count = (sql: string) => db.prepare(sql).get();
const queue = {
  remaining: count("SELECT count(*) n FROM crawl_tasks WHERE run_id=2 AND status IN ('pending','retry','running')"),
  uniquePendingReferences: count("SELECT count(*) tasks,count(DISTINCT json_extract(payload_json,'$.serversRef')) refs FROM crawl_tasks WHERE run_id=2 AND task_type='episode_servers' AND status IN ('pending','retry','running')"),
  sharedAcrossEpisodes: count("SELECT count(*) groups FROM (SELECT json_extract(payload_json,'$.serversRef') ref FROM crawl_tasks WHERE run_id=2 AND task_type='episode_servers' GROUP BY ref HAVING count(DISTINCT json_extract(payload_json,'$.episodeSourceId'))>1)"),
};
const title = db.prepare("SELECT canonical_url FROM titles WHERE source='anikoto' AND canonical_url IS NOT NULL LIMIT 1").get() as { canonical_url: string };
db.close();
const client = new AnikotoSourceClient();
const observations: object[] = [];
async function inspect(url: string) {
  const start = performance.now();
  const { body, response } = await client.text(url, 'html');
  const name = createHash('sha256').update(url).digest('hex').slice(0, 12);
  writeFileSync(`${output}/${name}.txt`, body, { flag: 'wx' });
  observations.push({ url, status: response.status, ms: performance.now() - start, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'), file: `${name}.txt`, cacheControl: response.headers.get('cache-control') });
  return body;
}
try {
  const robots = await inspect('/robots.txt');
  const page = await inspect(title.canonical_url);
  const $ = load(page);
  const scripts = $('script[src]').toArray().map(el => $(el).attr('src')!).map(src => new URL(src, title.canonical_url).toString());
  const links = $('a[href]').toArray().map(el => ({ text: $(el).text().trim(), href: $(el).attr('href') })).filter(x => /terms|privacy|api|download|sitemap/i.test(x.text));
  const report = { at: new Date().toISOString(), disposition: 'REFERENCE ONLY', boundary: 'Public behavior inspection; no source bundle copied into application, no media requests, no inferred redistribution rights.', queue, robots, scripts, policyLinks: links, observations };
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.log(JSON.stringify({ queue, observations, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}

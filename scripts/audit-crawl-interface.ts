/** Reference-only public client request inventory; never executes upstream JavaScript. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AnikotoSourceClient } from '../server/ingestion/source.ts';
const root = 'E:/CodexProjects/solanime-cloud-artifacts/mapping-resume-20260913/throughput-audit';
const report = JSON.parse(readFileSync(`${root}/report.json`, 'utf8')) as { scripts: string[] };
const client = new AnikotoSourceClient();
const results = [];
for (const url of report.scripts.filter(url => /\/anikoto\/js\/(main|mapper|watch-mana)/.test(url))) {
  const { body, response } = await client.text(url, 'html');
  const sha = createHash('sha256').update(body).digest('hex');
  writeFileSync(`${root}/${sha}.js.txt`, body, { flag: 'wx' });
  const routes = [...new Set(body.match(/\/(?:ajax|api)\/[a-zA-Z0-9_/-]+/g) ?? [])];
  const matches = [...body.matchAll(/server\/list|episode\/list|servers:/g)].slice(0, 12).map(m => body.slice(Math.max(0, m.index! - 110), m.index! + 200));
  results.push({ url, status: response.status, bytes: Buffer.byteLength(body), sha, routes, requestExcerpts: matches });
}
writeFileSync(`${root}/interfaces.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

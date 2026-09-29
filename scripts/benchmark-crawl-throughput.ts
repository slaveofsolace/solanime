/** Operator-only benchmark: consumes real retained tasks, never resets or copies a queue. */
import { readFileSync, writeFileSync } from 'node:fs';
import { openDatabase } from '../server/db.ts';
import { runAnikotoWorker } from '../server/ingestion/anikoto.ts';
const base = 'E:/CodexProjects/solanime-cloud-artifacts/mapping-resume-20260913';
const control = JSON.parse(readFileSync(`${base}/supervisor-control.json`, 'utf8'));
if (!control.paused || !control.maintenance) throw new Error('Explicit maintenance handoff required.');
const db = openDatabase(`${base}/catalogue.sqlite`);
const single = process.argv.includes('--sustain');
const phases = single ? [{ delay: 250, concurrency: 2, tasks: 1000 }] : [
  { delay: 1200, concurrency: 1, tasks: 30 },
  { delay: 500, concurrency: 2, tasks: 60 },
  { delay: 250, concurrency: 2, tasks: 120 },
];
const originalFetch = globalThis.fetch;
let network: { status: number; ms: number }[] = [];
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const start = performance.now();
  const response = await originalFetch(...args);
  network.push({ status: response.status, ms: performance.now() - start });
  return response;
};
function counts() {
  return {
    mappings: Number(db.prepare('SELECT count(*) n FROM episode_provider_mappings').get()!.n),
    completed: Number(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE run_id=2 AND status='completed'").get()!.n),
    pending: Number(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE run_id=2 AND status IN ('pending','retry','running')").get()!.n),
    errors: Number(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE run_id=2 AND status IN ('retry','failed','blocked')").get()!.n),
  };
}
const results: object[] = [];
try {
  const run = db.prepare('SELECT worker_id FROM crawl_runs WHERE id=2').get();
  if (run?.worker_id) throw new Error('A collector still owns the lease; benchmark refused.');
  for (const phase of phases) {
    if (counts().errors) throw new Error('Pending errors require review; no rate increase.');
    process.env.SOLANIME_SOURCE_DELAY_MS = String(phase.delay);
    db.prepare("UPDATE crawl_runs SET status='running' WHERE id=2 AND status='paused'").run();
    network = []; const before = counts(); const at = new Date().toISOString(); const start = performance.now();
    const result = await runAnikotoWorker(db, { mode: 'full', runId: 2, concurrency: phase.concurrency, maxTasksThisProcess: phase.tasks, exitWhenPaused: true });
    const seconds = (performance.now() - start) / 1000; const after = counts();
    const latencies = network.map(v => v.ms).sort((a,b) => a-b);
    const report = { at, phase, result, seconds, before, after, tasksPerSecond: (after.completed-before.completed)/seconds, hoursRemainingAtThisRate: after.pending*seconds/(after.completed-before.completed)/3600, network: { requests: network.length, statuses: network.reduce((acc,v) => ({...acc,[v.status]:(acc[v.status]??0)+1}),{} as Record<number,number>), medianMs: latencies[Math.floor(latencies.length/2)], p95Ms: latencies[Math.floor(latencies.length*.95)] } };
    results.push(report); console.log(JSON.stringify(report));
    writeFileSync(`${base}/throughput-audit/${single ? 'sustained' : 'benchmark'}.json`, JSON.stringify(results,null,2));
    if (after.errors || network.some(v => v.status !== 200) || after.completed-before.completed !== phase.tasks) throw new Error('Non-clean phase; automatic rate increase stopped.');
  }
  const integrity = { quickCheck: db.prepare('PRAGMA quick_check').get(), foreignKeys: db.prepare('PRAGMA foreign_key_check').all() };
  writeFileSync(`${base}/throughput-audit/${single ? 'sustained' : 'benchmark'}-integrity.json`, JSON.stringify(integrity,null,2));
  console.log(JSON.stringify({ integrity }));
} finally {
  db.prepare("UPDATE crawl_runs SET status='paused' WHERE id=2 AND status='running'").run();
  globalThis.fetch = originalFetch; db.close();
}

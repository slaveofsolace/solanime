/** Explicit operator benchmark; processes existing tasks and stops escalation on any error. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { openDatabase } from '../server/db.ts';
import { runAnikotoWorker } from '../server/ingestion/anikoto.ts';
const base = 'E:/CodexProjects/solanime-cloud-artifacts/mapping-resume-20260913';
const output = `${base}/throughput-audit/parallel-v2`;
const sustain = process.argv.includes('--sustain');
const indexCheck = process.argv.includes('--index-check');
const single = sustain || indexCheck;
const outputName = sustain ? 'sustained' : indexCheck ? 'index-check' : 'benchmark';
const path = `${output}/${outputName}.json`;
if (existsSync(path)) throw new Error('Evidence already exists; do not overwrite it.');
const control = JSON.parse(readFileSync(`${base}/supervisor-control.json`, 'utf8'));
if (!control.paused || !control.maintenance) throw new Error('Explicit maintenance handoff required.');
const db = openDatabase(`${base}/catalogue.sqlite`);
type Phase = { delay: number; concurrency: number; tasks: number };
type Result = { phase: Phase; clean: boolean; tasksPerSecond: number; p95Ms: number; [key: string]: unknown };
const ladder: Phase[] = [
  { delay: 250, concurrency: 4, tasks: 100 },
  { delay: 125, concurrency: 4, tasks: 150 },
  { delay: 125, concurrency: 8, tasks: 150 },
  { delay: 75, concurrency: 8, tasks: 200 },
  { delay: 50, concurrency: 10, tasks: 250 },
];
const selected: Phase | null = single ? JSON.parse(readFileSync(`${output}/selected.json`, 'utf8')).phase : null;
const phases = selected ? [{ ...selected, tasks: indexCheck ? 200 : 2000 }] : ladder;
function counts() {
  return {
    mappings: Number(db.prepare('SELECT count(*) n FROM episode_provider_mappings').get()!.n),
    completed: Number(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE run_id=2 AND status='completed'").get()!.n),
    pending: Number(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE run_id=2 AND status IN ('pending','retry','running')").get()!.n),
    errors: Number(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE run_id=2 AND status IN ('retry','failed','blocked')").get()!.n),
  };
}
let network: { status: number; ms: number }[] = [];
let active = 0; let peak = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const start = performance.now(); active++; peak = Math.max(peak, active);
  try {
    const response = await originalFetch(...args);
    network.push({ status: response.status, ms: performance.now() - start });
    // A benchmark must not wait through/retry an overload and then call the rate clean.
    if (response.status !== 200) db.prepare("UPDATE crawl_runs SET status='paused' WHERE id=2").run();
    return response;
  } catch (error) {
    network.push({ status: 0, ms: performance.now() - start });
    db.prepare("UPDATE crawl_runs SET status='paused' WHERE id=2").run(); throw error;
  } finally { active--; }
};
const results: Result[] = [];
try {
  if (db.prepare('SELECT worker_id FROM crawl_runs WHERE id=2').get()?.worker_id) throw new Error('Another collector owns the lease.');
  for (const phase of phases) {
    if (counts().errors) throw new Error('Existing errors must be reviewed before benchmarking.');
    process.env.SOLANIME_SOURCE_DELAY_MS = String(phase.delay);
    db.prepare("UPDATE crawl_runs SET status='running' WHERE id=2 AND status='paused'").run();
    network = []; active = 0; peak = 0;
    const before = counts(); const at = new Date().toISOString(); const start = performance.now();
    const cpuBefore = process.cpuUsage();
    const worker = await runAnikotoWorker(db, { mode: 'full', runId: 2, concurrency: phase.concurrency, maxTasksThisProcess: phase.tasks, exitWhenPaused: true });
    const cpu = process.cpuUsage(cpuBefore);
    const seconds = (performance.now() - start)/1000; const after = counts();
    const completed = after.completed-before.completed;
    const latencies = network.map(v => v.ms).sort((a,b) => a-b);
    const clean = after.errors===0 && completed===phase.tasks && network.length===phase.tasks && network.every(v => v.status===200);
    const rate = completed/seconds;
    const report: Result = { at, phase, clean, worker, seconds, before, after, tasksPerSecond: rate, hoursRemainingAtThisRate: after.pending/rate/3600,
      medianMs: latencies[Math.floor(latencies.length/2)], p95Ms: latencies[Math.floor(latencies.length*.95)], peakFetches: peak,
      cpuSeconds: (cpu.user+cpu.system)/1e6, requestStatuses: network.reduce((acc,v) => ({...acc,[v.status]:(acc[v.status]??0)+1}),{} as Record<number,number>) };
    results.push(report); writeFileSync(path, JSON.stringify(results,null,2)); console.log(JSON.stringify(report));
    if (!clean) throw new Error('Non-clean stage: no additional rate escalation.');
    if (!single && results.length>1 && report.p95Ms > Math.max(1000, results[0].p95Ms*3)) {
      console.log('Latency ceiling reached; stop rate escalation.'); break;
    }
  }
  if (!single) {
    const best = results.filter(v => v.clean && v.p95Ms<=Math.max(1000,results[0].p95Ms*3)).sort((a,b)=>b.tasksPerSecond-a.tasksPerSecond)[0];
    if (!best) throw new Error('No clean measured setting to select.');
    writeFileSync(`${output}/selected.json`,JSON.stringify(best,null,2));
  }
  const integrity = { quickCheck: db.prepare('PRAGMA quick_check').get(), foreignKeys: db.prepare('PRAGMA foreign_key_check').all() };
  writeFileSync(`${output}/${outputName}-integrity.json`,JSON.stringify(integrity,null,2));
  console.log(JSON.stringify({ integrity }));
} finally {
  db.prepare("UPDATE crawl_runs SET status='paused' WHERE id=2 AND status='running'").run();
  globalThis.fetch = originalFetch; db.close();
}

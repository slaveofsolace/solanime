/** Read-only query-plan/timing check; no upstream traffic. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
const base='E:/CodexProjects/solanime-cloud-artifacts/mapping-resume-20260913';
const db=new DatabaseSync(`${base}/catalogue.sqlite`,{readOnly:true});
const source=readFileSync(new URL('../server/ingestion/queue.ts',import.meta.url),'utf8');
const start=source.indexOf('`SELECT id,run_id,task_key');
const end=source.indexOf('`',start+1);
const sql=source.slice(start+1,end);
if(start<0||!sql.endsWith('LIMIT 1'))throw new Error('Expected queue selection shape missing.');
const statement=db.prepare(sql);const timings=[];
for(let i=0;i<25;i++){const start=performance.now();statement.get(2,new Date().toISOString());timings.push(performance.now()-start);}
const report={at:new Date().toISOString(),plan:db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(2,new Date().toISOString()),meanMs:timings.reduce((a,b)=>a+b,0)/timings.length,indexes:db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='crawl_tasks'").all()};
const label=process.argv[2]??'before';
if(!/^[a-z-]+$/.test(label))throw new Error('Invalid label.');
writeFileSync(`${base}/throughput-audit/parallel-v2/queue-${label}.json`,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(report,null,2));db.close();

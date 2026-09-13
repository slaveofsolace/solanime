/** Apply existing local migrations only to the explicitly paused task-owned DB. */
import { readFileSync, writeFileSync } from 'node:fs';
import { migrate, openDatabase, currentSchemaVersion } from '../server/db.ts';
const base='E:/CodexProjects/solanime-cloud-artifacts/mapping-resume-20260913';
const control=JSON.parse(readFileSync(`${base}/supervisor-control.json`,'utf8'));
if(!control.paused||!control.maintenance)throw new Error('Maintenance handoff required.');
const db=openDatabase(`${base}/catalogue.sqlite`);
try {
  const run=db.prepare('SELECT worker_id,status FROM crawl_runs WHERE id=2').get();
  if(run?.worker_id||run?.status!=='paused')throw new Error('Database is not idle and paused.');
  const before=currentSchemaVersion(db);const start=performance.now();migrate(db);
  const receipt={at:new Date().toISOString(),before,after:currentSchemaVersion(db),ms:performance.now()-start,integrity:db.prepare('PRAGMA quick_check').get(),foreignKeys:db.prepare('PRAGMA foreign_key_check').all()};
  writeFileSync(`${base}/throughput-audit/parallel-v2/index-migration.json`,JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
} finally {db.close();}

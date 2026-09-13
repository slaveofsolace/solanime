import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { IMPORT_TABLES, MAX_IMPORT_ROWS, MAX_IMPORT_BYTES, estimateImportWrites, type ImportBatch, type ImportRow } from '../../server/cloud/data/import-schema.ts';
import { validateImportBatch } from '../../server/cloud/data/import.ts';

const args=new Map(process.argv.slice(2).map(arg=>{const[key,...value]=arg.split('=');return[key,value.join('=')];}));
if(!args.get('--db')||!args.get('--out')||!args.get('--written-row-budget'))throw new Error('Use --db=<reviewed SQLite copy> --out=<new directory> --written-row-budget=<explicit allowance>. This only prepares evidence; it never uploads.');
const source=resolve(args.get('--db')!);const output=resolve(args.get('--out')!);const limit=Number(args.get('--written-row-budget'));
const selectedTitleIds=args.get('--title-ids')?.split(',').map(Number);
if(selectedTitleIds&&(!selectedTitleIds.length||selectedTitleIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(selectedTitleIds).size!==selectedTitleIds.length))throw new Error('The optional --title-ids filter must contain distinct positive catalogue IDs.');
if(existsSync(output))throw new Error('Choose a new output directory; prior delta/checkpoint artifacts are preserved.');
if(!Number.isSafeInteger(limit)||limit<1||limit>70_000)throw new Error('Choose a conservative delta allowance from1 to70000 writes.');
const db=new DatabaseSync(source,{readOnly:true});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
try{
  const batches:ImportBatch[]=[];const entries:Array<{file:string;id:string;target:'catalogue';table:string;rows:number;estimatedWrites:number;sha256:string}>=[];const counts:Record<string,number>={};
  for(const table of ['artwork_matches','title_artwork']){
    const spec=IMPORT_TABLES[table];
    const filter=selectedTitleIds?table==='artwork_matches'?' WHERE title_id IN (SELECT value FROM json_each(?))':' WHERE match_id IN (SELECT id FROM artwork_matches WHERE title_id IN (SELECT value FROM json_each(?)))':'';
    const rows=db.prepare(`SELECT ${spec.columns.map(column=>`"${column}"`).join(',')} FROM "${table}"${filter} ORDER BY ${spec.primaryKey.join(',')}`).all(...(selectedTitleIds?[JSON.stringify(selectedTitleIds)]:[])) as ImportRow[];counts[table]=rows.length;
    for(let index=0;index<rows.length;){
      let end=Math.min(rows.length,index+MAX_IMPORT_ROWS);let selected:ImportRow[];let batch:ImportBatch;let body:string;
      for(;;){
        selected=rows.slice(index,end);const contentHash=hash(JSON.stringify(selected));
        const candidate={version:1,id:`artwork:${table}:${contentHash}`,snapshotId:'reviewed-artwork-v1',target:'catalogue',table,rows:selected,contentHash};
        body=JSON.stringify(candidate);
        if(Buffer.byteLength(body)<=MAX_IMPORT_BYTES){
          batch=validateImportBatch(candidate);
          // The uploader hashes the actual UTF-8 file bytes. Validation can normalize
          // object-key order, so never use the earlier candidate serialization here.
          body=JSON.stringify(batch);
          if(Buffer.byteLength(body)<=MAX_IMPORT_BYTES)break;
        }
        if(end-index===1)throw new Error('One artwork evidence record exceeds the protected import byte limit; no output was published.');
        end--;
      }
      entries.push({file:`batches/${String(entries.length).padStart(7,'0')}-${table}.json`,id:batch.id,target:'catalogue',table,rows:selected.length,estimatedWrites:estimateImportWrites(spec,selected.length),sha256:hash(body)});batches.push(batch);
      index=end;
    }
  }
  const totalEstimatedWrites=entries.reduce((sum,entry)=>sum+entry.estimatedWrites,0);if(totalEstimatedWrites>limit)throw new Error(`Delta estimates${totalEstimatedWrites} writes, above the explicit allowance${limit}; no files were written.`);
  const requiredTitleOwners=db.prepare(`SELECT title_id AS titleId,title_source AS source,title_source_id AS sourceId,media_id AS metadataId FROM artwork_matches${selectedTitleIds?' WHERE title_id IN (SELECT value FROM json_each(?))':''} ORDER BY title_id`).all(...(selectedTitleIds?[JSON.stringify(selectedTitleIds)]:[]));
  const manifest={version:1,totalBatches:entries.length,totalEstimatedWrites,catalogueCounts:counts,requiredCloudSchemaVersion:12,requiredTitleOwners,batches:entries,note:'Additive reviewed artwork only. Existing title parents must already exist with these exact source IDs. Apply only through the protected quota-accounted import API; never reset the full snapshot or increase its allowance. Unknown artwork rights remain reference-only.'};
  mkdirSync(join(output,'batches'),{recursive:true});for(let index=0;index<batches.length;index++)writeFileSync(join(output,entries[index].file),JSON.stringify(batches[index]),{flag:'wx'});
  writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,counts,batches:batches.length,totalEstimatedWrites,requiredCloudSchemaVersion:12,upstreamRequests:0},null,2));
}finally{db.close();}

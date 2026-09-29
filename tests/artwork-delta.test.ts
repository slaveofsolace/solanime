import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrate, projectRoot } from '../server/db.ts';
import { approveLocalArtwork } from '../server/artwork/local.ts';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '../server/cloud/data/import-schema.ts';
import { validateImportBatch } from '../server/cloud/data/import.ts';

const date='2026-09-13T00:00:00.000Z';
const sha=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
function fixture(count:number,longEvidence=false){
  const folder=mkdtempSync(join(tmpdir(),'solanime-artwork-delta-'));const path=join(folder,'fixture.sqlite');const db=new DatabaseSync(path);
  try{
    migrate(db);
    for(let id=1;id<=count;id++){
      const title=longEvidence?'Épisode 測定 '.repeat(60):'Épisode 測定';const alias=longEvidence?'Alternate 測定 '.repeat(50):'Alternate 測定';
      db.prepare('INSERT INTO titles(id,source,source_id,slug,canonical_url,name,format,release_year,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'anikoto',String(id),`test-${id}`,`https://anikototv.to/watch/test-${id}`,title,'TV',2026,date,date,date,date);
      approveLocalArtwork(db,{titleId:id,titleSource:'anikoto',titleSourceId:String(id),mediaId:id,malId:id,releaseYear:2026,format:'TV',reviewedAt:date,evidence:{sourceUrl:`https://anikototv.to/watch/test-${id}`,metadataUrl:`https://anilist.co/anime/${id}`,sourceName:title,metadataName:title,sourceAlias:alias,metadataAlias:alias,sourcePosterSha256:'a'.repeat(64),metadataPosterSha256:'b'.repeat(64),posterComparison:'same-key-art-manually-reviewed',premiereDate:'2026-01-01',notes:longEvidence?'Fixture only. '.repeat(130):'Fixture only; no real catalogue or asset.'}});
    }
  }finally{db.close();}
  return{folder,path};
}
function generate(path:string,output:string,extra:string[]=[]){
  const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../scripts/artwork/delta.ts',import.meta.url)),`--db=${path}`,`--out=${output}`,'--written-row-budget=2000',...extra],{cwd:projectRoot,encoding:'utf8',windowsHide:true,timeout:20_000});
  expect({exit:result.status,stderr:result.stderr}).toEqual({exit:0,stderr:''});
  return JSON.parse(readFileSync(join(output,'manifest.json'),'utf8')) as {totalBatches:number;catalogueCounts:Record<string,number>;requiredTitleOwners:Array<{titleId:number}>;batches:Array<{file:string;sha256:string;rows:number}>};
}

describe('artwork delta exact-byte publication contract',()=>{
  it('hashes precisely the validated UTF-8 bytes written for the existing uploader',()=>{
    const {folder,path}=fixture(1);const output=join(folder,'delta');const manifest=generate(path,output);
    for(const entry of manifest.batches){const body=readFileSync(join(output,entry.file),'utf8');expect(sha(body)).toBe(entry.sha256);const batch=validateImportBatch(JSON.parse(body));expect(sha(JSON.stringify(batch.rows))).toBe(batch.contentHash);expect(body).toContain('Épisode 測定');}
  },25_000);
  it('splits long evidence by both byte and row limits while preserving every row and exact hashes',()=>{
    const {folder,path}=fixture(36,true);const output=join(folder,'delta');const manifest=generate(path,output);
    expect(manifest.totalBatches).toBeGreaterThan(2);expect(manifest.batches.reduce((total,entry)=>total+entry.rows,0)).toBe(36);
    for(const entry of manifest.batches){const body=readFileSync(join(output,entry.file),'utf8');expect(Buffer.byteLength(body,'utf8')).toBeLessThanOrEqual(MAX_IMPORT_BYTES);expect(entry.rows).toBeLessThanOrEqual(MAX_IMPORT_ROWS);expect(sha(body)).toBe(entry.sha256);expect(validateImportBatch(JSON.parse(body)).rows).toHaveLength(entry.rows);}
  },25_000);
  it('filters explicit owners without changing or overwriting a previous delta directory',()=>{
    const {folder,path}=fixture(2);const output=join(folder,'delta');const manifest=generate(path,output,['--title-ids=2']);
    expect(manifest.catalogueCounts.artwork_matches).toBe(1);expect(manifest.requiredTitleOwners.map(row=>row.titleId)).toEqual([2]);
    const previous=readFileSync(join(output,'manifest.json'),'utf8');
    const result=spawnSync(process.execPath,['--import','tsx','scripts/artwork/delta.ts',`--db=${path}`,`--out=${output}`,'--written-row-budget=2000'],{cwd:projectRoot,encoding:'utf8',windowsHide:true,timeout:20_000});
    expect(result.status).not.toBe(0);expect(readFileSync(join(output,'manifest.json'),'utf8')).toBe(previous);
  },25_000);
});

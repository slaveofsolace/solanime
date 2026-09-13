import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrate } from '../server/db.ts';
import { prepareBaseline } from '../scripts/cloud-data/prepare-baseline.ts';
import { createPrivateBaselineReader } from '../server/cloud/data/baseline.ts';
import { createCatalogueRepository } from '../server/cloud/data/catalogue.ts';

const parent=resolve('../solanime-cloud-artifacts/tmp');mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,'baseline-catalogue-'));
const date='2026-09-13T00:00:00Z';const source=join(root,'source.sqlite'),output=join(root,'assets');
let runtime:Miniflare,db:Awaited<ReturnType<Miniflare['getD1Database']>>,local:DatabaseSync;
let prepared:Awaited<ReturnType<typeof prepareBaseline>>;
function statements(sql:string){const result:string[]=[];let part='',quote='',comment=false;for(let i=0;i<sql.length;i++){const char=sql[i],next=sql[i+1];if(comment){if(char==='\n'){comment=false;part+=' ';}continue;}if(!quote&&char==='-'&&next==='-'){comment=true;i++;continue;}if(quote){part+=char;if(char===quote){if(next===quote){part+=next;i++;}else quote='';}continue;}if(char==='\''||char==='"'){quote=char;part+=char;continue;}if(char===';'){if(part.trim())result.push(part.trim());part='';}else part+=char;}if(part.trim())result.push(part.trim());return result;}
function title(id:number,name:string,source='anikoto'){local.prepare('INSERT INTO titles(id,source,source_id,slug,canonical_url,name,description,format,release_year,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,source,`source-${id}`,`title-${id}`,`https://example.invalid/title-${id}`,name,'Full source description','TV',2020+id,'Finished',date,date,date,date);}
function episode(id:number,titleId:number){local.prepare('INSERT INTO episodes(id,title_id,source_id,number_text,number_sort,label,slug,canonical_url,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,titleId,`episode-${id}`,`S1 E${id}`,10_000+id,`Episode ${id}`,`ep-${id}`,`https://example.invalid/ep/${id}`,date,date,date,date);local.prepare('INSERT INTO episode_versions(id,episode_id,source_id,language,version_label,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?)').run(id,id,`version-${id}`,'sub','Subtitled',date,date);local.prepare('INSERT INTO episode_provider_mappings(id,version_id,provider_id,source_mapping_id,provider_resource_id,first_seen_at,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,id,'hd-1',`mapping-${id}`,`private-resource-${id}`,date,date,date);}
async function copyRows(table:string,where=''){for(const row of local.prepare(`SELECT * FROM ${table} ${where}`).all()){const keys=Object.keys(row);await db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>row[key])).run();}}
function reader(corrupt?:string){const requests:string[]=[];const baseline=createPrivateBaselineReader({async fetch(url){requests.push(url);const parsed=new URL(url);if(parsed.origin!=='https://assets.local')throw new Error('Unexpected network fetch.');const path=join(output,parsed.pathname);return new Response(parsed.pathname.includes(corrupt ?? '\u0000')?'corrupted':existsSync(path)?readFileSync(path,'utf8'):null,{status:existsSync(path)?200:404});}},{id:prepared.manifest.id,manifestSha256:prepared.manifestSha256});return {baseline,requests};}
beforeAll(async()=>{
 local=new DatabaseSync(source);migrate(local);title(1,'Alpha series');title(2,'Beta series','tvmaze');title(3,'Zero episodes');for(let id=1;id<=103;id++)episode(id,1);episode(205,2);
 local.exec("INSERT INTO genres(id,slug,name) VALUES(1,'adventure','Adventure');INSERT INTO title_genres(title_id,genre_id) VALUES(1,1);INSERT INTO title_aliases(title_id,alias,language) VALUES(1,'Alternative Alpha','en')");
 local.close();prepared=await prepareBaseline(source,output);local=new DatabaseSync(source,{readOnly:true});
 runtime=new Miniflare(convertV4MiniflareOptions({name:'baseline-catalogue-contract',modules:true,script:'export default {fetch(){return new Response("test-only")}}',compatibilityDate:'2026-09-12',d1Databases:{CATALOGUE:'baseline-catalogue-test'}}));db=await runtime.getD1Database('CATALOGUE');
 for(const file of readdirSync(new URL('../migrations/cloud/catalogue/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())for(const sql of statements(readFileSync(new URL(`../migrations/cloud/catalogue/${file}`,import.meta.url),'utf8')))await db.prepare(sql).run();
},60000);
beforeEach(async()=>{for(const table of ['episode_provider_mappings','episode_versions','episodes','title_genres','title_aliases','titles'])await db.prepare(`DELETE FROM ${table}`).run();await copyRows('titles');await copyRows('episodes','WHERE id=1');await copyRows('episode_versions','WHERE id=1');await copyRows('episode_provider_mappings','WHERE id=1');await db.prepare("UPDATE episode_provider_mappings SET availability_state='blocked',unavailable_reason='Operator disabled this resource',provider_resource_id='newer-private-resource' WHERE id=1").run();});
afterAll(async()=>{local?.close();await runtime?.dispose();if(!resolve(root).startsWith(`${parent}\\`)&&!resolve(root).startsWith(`${parent}/`))throw new Error('Refuse unsafe test cleanup.');rmSync(root,{recursive:true,force:true});});

describe('private baseline with a partially hydrated actual D1 catalogue',()=>{
 it('searches full aliases, filters and episode counts without reading card assets for existing D1 titles',async()=>{
  const test=reader(),repository=createCatalogueRepository(db,test.baseline);const result=await repository.browseTitles({q:'Alternative',genre:'adventure',language:'sub',page:1,pageSize:100,sort:'episodes'});
  expect(result.total).toBe(1);expect(result.items[0]).toMatchObject({id:'1',episodeCount:103,name:'Alpha series'});expect(result.facets?.languages).toContainEqual({value:'sub',label:'SUB',count:2});expect(test.requests.some(url=>url.includes('/browse/')||url.includes('/titles/'))).toBe(false);
 expect((await repository.getFilters()).genres).toContainEqual({value:'adventure',label:'Adventure',count:1});
 });
 it('combines baseline anime with D1-backed non-animation TV and movie collections',async()=>{
  for(const [id,sourceId,source,name,format] of [[90,'Q90','wikipedia-tv','External TV','TV'],[91,'Q91','wikipedia-movie','External Movie','Movie']] as const) {
   await db.prepare('INSERT INTO titles(id,source,source_id,slug,canonical_url,name,description,format,release_year,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,source,sourceId,`external-${id}`,`https://en.wikipedia.org/wiki/${sourceId}`,name,'External catalogue record',format,2026,'Upcoming',date,date,date,date).run();
  }
  const repository=createCatalogueRepository(db,reader().baseline);
  expect((await repository.browseTitles({scope:'anime',page:1,pageSize:100,sort:'name'})).items.map(row=>row.name)).toEqual(['Alpha series','Zero episodes']);
  expect((await repository.browseTitles({scope:'tv',page:1,pageSize:100,sort:'name'})).items.map(row=>row.name)).toEqual(['Beta series','External TV']);
  expect((await repository.browseTitles({scope:'movies',page:1,pageSize:100,sort:'name'})).items.map(row=>row.name)).toEqual(['External Movie']);
  expect((await repository.browseTitles({scope:'all',q:'External',page:1,pageSize:100,sort:'name'})).items.map(row=>row.name)).toEqual(['External Movie','External TV']);
 });
 it('falls back only missing D1 cards while keeping baseline sorting and requested pagination',async()=>{
  await db.prepare('DELETE FROM titles WHERE id=2').run();const test=reader();const result=await createCatalogueRepository(db,test.baseline).browseTitles({page:1,pageSize:2,sort:'name',includeFacets:false});
  expect(result.items.map(row=>row.id)).toEqual(['1','2']);expect(result.items[1]).toMatchObject({name:'Beta series',episodeCount:1,description:'Full source description'});expect(result).not.toHaveProperty('facets');expect(test.requests.filter(url=>url.includes('/browse/'))).toHaveLength(1);
 });
 it('returns every baseline episode page and preserves newer D1 episode state and title metadata',async()=>{
  await db.prepare("UPDATE titles SET description='Newer description',availability_state='stale' WHERE id=1").run();await db.prepare("UPDATE episodes SET availability_state='blocked',label='Operator label' WHERE id=1").run();const result=await createCatalogueRepository(db,reader().baseline).getTitle('title-1');
  expect(result.episodes).toHaveLength(103);expect(result.episodes.slice(0,11).map(episode=>String((episode as {number?:unknown}).number))).toEqual(['S1 E1','S1 E2','S1 E3','S1 E4','S1 E5','S1 E6','S1 E7','S1 E8','S1 E9','S1 E10','S1 E11']);expect(result.episodes[0]).toMatchObject({id:'1',label:'Operator label',availability:'blocked'});expect(result.title).toMatchObject({description:'Newer description',availability:'stale',episodeCount:103});expect(result.genres).toEqual([{slug:'adventure',name:'Adventure'}]);expect(result.aliases).toMatchObject([{name:'Alternative Alpha'}]);
 });
 it('serves a missing episode/provider inventory and never exposes private resolver references in choices',async()=>{
  const repository=createCatalogueRepository(db,reader().baseline);const result=await repository.getEpisodeProviders(2,'sub');expect(result.episode).toMatchObject({id:'2',titleSlug:'title-1'});expect(result.providers).toMatchObject([{mappingId:'2',providerId:'hd-1'}]);expect(JSON.stringify(result)).not.toContain('private-resource');expect((await repository.getMapping(2)).providerResourceId).toBe('private-resource-2');
 });
 it('keeps D1 disabled mappings authoritative, including null reasons and stable-resource changes',async()=>{
  const repository=createCatalogueRepository(db,reader().baseline);expect((await repository.getEpisodeProviders(1,'sub')).providers[0]).toMatchObject({mappingId:'1',status:'blocked',reason:'Operator disabled this resource'});expect(await repository.getMapping(1)).toMatchObject({availability:'blocked',providerResourceId:'newer-private-resource'});
  await db.prepare("UPDATE episode_provider_mappings SET availability_state='available',unavailable_reason=NULL WHERE id=1").run();expect((await createCatalogueRepository(db,reader().baseline).getEpisodeProviders(1,'sub')).providers[0]).toMatchObject({status:'available',reason:null});
 });
 it('retains baseline SUB default when D1 has only DUB while supporting its added variant',async()=>{
  await db.prepare('DELETE FROM episode_provider_mappings').run();await db.prepare('DELETE FROM episode_versions').run();await db.prepare("INSERT INTO episode_versions(id,episode_id,source_id,language,version_label,first_seen_at,last_seen_at) VALUES(1000,1,'dub-new','dub','Dubbed',?,?)").bind(date,date).run();const repository=createCatalogueRepository(db,reader().baseline);
  expect((await repository.getEpisodeProviders(1)).version.language).toBe('sub');expect((await repository.getEpisodeProviders(1,'dub')).version.language).toBe('dub');expect((await repository.getTitle('title-1')).episodes[0].versions).toMatchObject([{language:'sub'},{language:'dub'}]);await expect(repository.getEpisodeProviders(1,'silent')).rejects.toMatchObject({status:404});
 });
 it('reports actual D1 counts in diagnostics and leaves no-baseline behavior unchanged',async()=>{
  const repository=createCatalogueRepository(db,reader().baseline);expect((await repository.adminStatus()).counts).toMatchObject({titles:3,episodes:1,versions:1,mappings:1});expect((await createCatalogueRepository(db).getTitle('title-1')).episodes).toHaveLength(1);expect((await createCatalogueRepository(db).browseTitles({page:1,pageSize:24,sort:'name'})).items[0].episodeCount).toBe(1);
 });
 it('does not reinterpret corrupted known snapshot assets as empty data or a valid D1 fallback',async()=>{
  await expect(createCatalogueRepository(db,reader('/episode-pages/').baseline).getTitle('title-1')).rejects.toMatchObject({status:503});await expect(createCatalogueRepository(db,reader('/indexes/').baseline).browseTitles({page:1,pageSize:24,sort:'name'})).rejects.toMatchObject({status:503});expect((await db.prepare('SELECT COUNT(*) AS count FROM episodes').first())?.count).toBe(1);
 });
 it('validates IDs/pages and uses source-proven empty or pending states instead of invented episodes',async()=>{
  const repository=createCatalogueRepository(db,reader().baseline);await expect(repository.getEpisodeProviders(-1)).rejects.toMatchObject({status:400});await expect(repository.browseTitles({page:0,pageSize:100,sort:'name'})).rejects.toMatchObject({status:400});expect(await repository.getTitle('title-3')).toMatchObject({collectionState:'pending',episodes:[]});await expect(repository.getMapping(99999)).rejects.toMatchObject({status:404});
 });
 it('never attaches a later same-language D1 version to an earlier baseline version identity',async()=>{
  await db.prepare('DELETE FROM episode_provider_mappings').run();await db.prepare('DELETE FROM episode_versions').run();await db.prepare("INSERT INTO episode_versions(id,episode_id,source_id,language,version_label,first_seen_at,last_seen_at) VALUES(1000,1,'different-sub','sub','Different edition',?,?)").bind(date,date).run();
  const result=await createCatalogueRepository(db,reader().baseline).getEpisodeProviders(1,'sub');expect(result.version).toMatchObject({id:'1',sourceId:'version-1'});expect(result.providers[0].mappingId).toBe('1');
 });
 it('fails closed if persisted title or episode IDs were retargeted outside the checked importer',async()=>{
  await db.prepare("UPDATE titles SET source_id='retargeted' WHERE id=1").run();await expect(createCatalogueRepository(db,reader().baseline).getTitle('title-1')).rejects.toMatchObject({status:409,code:'IMPORT_IDENTITY_CONFLICT'});
  await db.prepare("UPDATE episodes SET source_id='retargeted' WHERE id=1").run();await expect(createCatalogueRepository(db,reader().baseline).getEpisodeProviders(1)).rejects.toMatchObject({status:409,code:'IMPORT_IDENTITY_CONFLICT'});
 });
});

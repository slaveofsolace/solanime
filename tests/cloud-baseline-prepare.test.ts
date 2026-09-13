import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { migrate } from '../server/db.ts';
import { prepareBaseline } from '../scripts/cloud-data/prepare-baseline.ts';
import { baselineHashBucket, baselineNumericBucket, baselinePath, validateBaselineManifest, type BaselineManifest } from '../server/cloud/data/baseline-schema.ts';

const parent=resolve(process.env.SOLANIME_TEST_TMP || '../solanime-cloud-artifacts/tmp'); mkdirSync(parent,{recursive:true});
const root=mkdtempSync(join(parent,'baseline-contract-'));
const sha=(body:Buffer|string)=>createHash('sha256').update(body).digest('hex');
function fixture(name:string, count=103) {
 const source=join(root,`${name}.sqlite`),db=new DatabaseSync(source);migrate(db);
 const at='2026-09-13T00:00:00Z';
 db.prepare('INSERT INTO titles(id,source_id,slug,canonical_url,name,description,format,release_year,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?)').run('source-one','test-series','https://example.invalid/title/test-series','Test Series','Full description','TV',2020,'Finished',at,at,at,at);
 db.prepare('INSERT INTO title_aliases(title_id,alias,language) VALUES(1,?,?)').run('Alternate title','en');
 db.exec("INSERT INTO genres(id,slug,name) VALUES(1,'adventure','Adventure'); INSERT INTO title_genres(title_id,genre_id) VALUES(1,1)");
 const episode=db.prepare('INSERT INTO episodes(id,title_id,source_id,number_text,number_sort,label,slug,canonical_url,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,1,?,?,?,?,?,?,?,?,?,?)');
 const version=db.prepare('INSERT INTO episode_versions(id,episode_id,source_id,language,version_label,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?)');
 const mapping=db.prepare('INSERT INTO episode_provider_mappings(id,version_id,provider_id,source_mapping_id,provider_resource_id,canonical_embed_url,first_seen_at,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
 for(let id=1;id<=count;id++){episode.run(id,`episode-${id}`,id===2?'1.5':String(id),id,`Episode ${id}`,`ep-${id}`,`https://example.invalid/ep/${id}`,at,at,at,at);version.run(id,id,`version-${id}`,'sub','Subtitled',at,at);mapping.run(id,id,'hd-1',`mapping-${id}`,`resource-${id}`,`https://example.invalid/embed/${id}`,at,at,at);}
 db.exec("CREATE TABLE private_account_test(password TEXT); INSERT INTO private_account_test VALUES('PRIVATE_SENTINEL_NOT_A_REAL_PASSWORD')");db.close();return source;
}
const readAsset=(output:string,path:string)=>JSON.parse(readFileSync(join(output,path.slice(1)),'utf8'));
afterAll(()=>{const exact=resolve(root);if(!exact.startsWith(`${parent}\\`)&&!exact.startsWith(`${parent}/`))throw new Error('Refuse cleanup outside test directory.');rmSync(exact,{recursive:true,force:true});});

describe('private catalogue baseline preparation',()=>{
 it('reconciles real schema fixtures, keeps irregular numbering and paginates without dropping variants',async()=>{
  const source=fixture('complete'),before=sha(readFileSync(source)),output=join(root,'complete-assets');
  const result=await prepareBaseline(source,output,{existingAssetFiles:1521});
  expect(result.manifest.counts).toEqual({titles:1,episodes:103,versions:103,mappings:103});expect(sha(readFileSync(source))).toBe(before);expect(result.manifest.aggregateFiles).toBe(result.manifest.files+1521);
  expect(result.manifest.bucketSpans.mappings).toBe(512);
  const manifest=result.manifest;const title=readAsset(output,baselinePath(manifest.id,`titles/${baselineNumericBucket(1,manifest.bucketSpans.titles)}.json`))['1'];
  expect(title.episodePages).toHaveLength(2);expect(readAsset(output,title.episodePages[0]).episodes).toHaveLength(100);expect(readAsset(output,title.episodePages[1]).episodes).toHaveLength(3);expect(readAsset(output,title.episodePages[0]).episodes[1].number).toBe('1.5');
  const episode=readAsset(output,baselinePath(manifest.id,`episodes/${baselineNumericBucket(2,manifest.bucketSpans.episodes)}.json`))['2'];expect(episode.versions[0].providers[0].mappingId).toBe('2');
  expect(readAsset(output,baselinePath(manifest.id,`slugs/${baselineHashBucket('test-series',256)}.json`))['test-series']).toBe('1');
  const postings=readAsset(output,manifest.postings.path);expect(postings.genres.adventure).toEqual(['1']);expect(postings.episodeCounts).toEqual({'1':103});expect(Object.keys(postings.episodeCounts)).toEqual(postings.orders.name);expect(Object.values(postings.episodeCounts).reduce((sum:number,count:unknown)=>sum+Number(count),0)).toBe(manifest.counts.episodes);expect(readAsset(output,manifest.search.path)[0][1]).toContain('alternate title');
  expect(validateBaselineManifest(manifest)).toBe(manifest);
 },15_000);
 it('checksums every private payload and excludes account/crawl data from the complete emitted tree',async()=>{
  const output=join(root,'checksum-assets'),result=await prepareBaseline(fixture('checksum',2),output);let files=0;
  for(const ref of Object.values(result.manifest.referenceShards)){const bytes=readFileSync(join(output,ref.path.slice(1)));expect(sha(bytes)).toBe(ref.sha256);for(const payload of Object.values(JSON.parse(bytes.toString())) as Array<{path:string;sha256:string;bytes:number}>){const body=readFileSync(join(output,payload.path.slice(1)));expect(sha(body)).toBe(payload.sha256);expect(body.length).toBe(payload.bytes);expect(body.toString()).not.toContain('PRIVATE_SENTINEL');files++;}}
  expect(files+Object.keys(result.manifest.referenceShards).length+1).toBe(result.manifest.files);
 });
 it('keeps provider identity but excludes expiring URLs and credential-bearing resource references',async()=>{
  const credentialUrl=new URL('https://example.invalid/embed/1');credentialUrl.username='fixture-user';
  const source=fixture('private-refs',1),db=new DatabaseSync(source);db.prepare('UPDATE episode_provider_mappings SET provider_resource_id=?,canonical_embed_url=?').run('https://example.invalid/video?token=test-expiring',credentialUrl.href);db.close();
  const output=join(root,'private-ref-assets'),{manifest}=await prepareBaseline(source,output);const record=readAsset(output,baselinePath(manifest.id,`mappings/${baselineNumericBucket(1,manifest.bucketSpans.mappings)}.json`))['1'];
  expect(record.mapping.providerResourceId).toBeNull();expect(record.mapping.canonicalEmbedUrl).toBeNull();expect(record.mapping.mappingId).toBe(1);expect(record.provenance.mappingOrigin).toBe('native');expect(record.provenance.resourceOmittedReason).toBe('UNSTABLE_OR_UNSAFE_RESOURCE_REFERENCE');
 });
 it('includes stable immutable native approval records with their exact mapping identity',async()=>{
  const source=fixture('approved-resource',1),db=new DatabaseSync(source);db.prepare('INSERT INTO native_resources(mapping_id,provider_id,resource_id,language,edition,license,rights_evidence_url,identity_evidence_url,approved_at,enabled) VALUES(1,?,?,?,?,?,?,?,?,1)').run('hd-1','resource-1','sub','Reviewed test edition','Reviewed test rights','https://example.invalid/rights','https://example.invalid/identity','2026-09-13T00:00:00Z');db.close();
  const output=join(root,'approved-resource-assets'),{manifest}=await prepareBaseline(source,output);const record=readAsset(output,baselinePath(manifest.id,`mappings/${baselineNumericBucket(1,manifest.bucketSpans.mappings)}.json`))['1'];
  expect(record.resource).toEqual({mapping_id:1,provider_id:'hd-1',resource_id:'resource-1',language:'sub',edition:'Reviewed test edition',license:'Reviewed test rights',rights_evidence_url:'https://example.invalid/rights',identity_evidence_url:'https://example.invalid/identity',approved_at:'2026-09-13T00:00:00Z',enabled:1,content_sha1:null});expect(record.provenance.resourceOmittedReason).toBeNull();
 });
 it('fails closed on broken foreign-key relationships before output exists',async()=>{
  const source=fixture('broken',1),db=new DatabaseSync(source,{enableForeignKeyConstraints:false});db.exec('PRAGMA foreign_keys=OFF;UPDATE episode_provider_mappings SET version_id=999');db.close();const output=join(root,'broken-assets');await expect(prepareBaseline(source,output)).rejects.toThrow('integrity');expect(existsSync(output)).toBe(false);
 });
 it('refuses nonempty WAL sources, existing destinations, and aggregate over-quota packages',async()=>{
  const source=fixture('guards',1),walSource=fixture('wal',1);writeFileSync(`${walSource}-wal`,'nonempty');await expect(prepareBaseline(walSource,join(root,'wal-output'))).rejects.toThrow('WAL');
  const existing=join(root,'existing');mkdirSync(existing);writeFileSync(join(existing,'preserve.txt'),'keep');await expect(prepareBaseline(source,existing)).rejects.toThrow('already exists');expect(readFileSync(join(existing,'preserve.txt'),'utf8')).toBe('keep');
  await expect(prepareBaseline(source,join(root,'too-many'),{existingAssetFiles:19990,reservedAssetFiles:0})).rejects.toThrow('allowance');expect(existsSync(join(root,'too-many'))).toBe(false);
 });
 it('rejects oversized individual records without publishing an incomplete manifest',async()=>{
  const source=fixture('oversized',1),db=new DatabaseSync(source);db.prepare('UPDATE titles SET description=?').run('x'.repeat(300000));db.close();const output=join(root,'oversized-assets');await expect(prepareBaseline(source,output)).rejects.toThrow('individual titles');expect(existsSync(output)).toBe(false);
 });
 it('validates pin paths and rejects forged asset references or unsafe identifiers',async()=>{
  expect(()=>baselinePath('a'.repeat(64),'../../secrets')).toThrow();expect(()=>baselineNumericBucket(-1)).toThrow();expect(()=>baselineNumericBucket(1,513)).toThrow();
  const {manifest}=await prepareBaseline(fixture('forged',1),join(root,'forged-assets'));const forged=structuredClone(manifest) as BaselineManifest;forged.search.path='https://example.invalid/private';expect(()=>validateBaselineManifest(forged)).toThrow('search');
 });
 it('treats prototype-like imported names as data rather than object properties',async()=>{
  const source=fixture('prototype',1),db=new DatabaseSync(source);db.exec("UPDATE titles SET slug='__proto__',status='constructor';UPDATE genres SET slug='__proto__'");db.close();const output=join(root,'prototype-assets'),{manifest}=await prepareBaseline(source,output);
  expect(readAsset(output,baselinePath(manifest.id,`slugs/${baselineHashBucket('__proto__',256)}.json`))['__proto__']).toBe('1');expect(readAsset(output,manifest.postings.path).genres['__proto__']).toEqual(['1']);expect(readAsset(output,manifest.postings.path).statuses.constructor).toEqual(['1']);
 });
});

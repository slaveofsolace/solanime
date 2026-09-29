import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCatalogueRepository } from '../server/cloud/data/catalogue.ts';
import { consumeSyncMessage } from '../server/cloud/data/sync.ts';
import { getWriteBudget, reserveWriteBudget } from '../server/cloud/data/budget.ts';
import { withQueryBudget } from '../server/cloud/data/query-budget.ts';
import { createSnapshotImportRepository } from '../server/cloud/data/snapshot.ts';
import { createArtworkSyncHandlers, enqueueCloudArtwork } from '../server/artwork/cloud.ts';
import { applyImportBatch, importHash, validateImportBatch } from '../server/cloud/data/import.ts';
import type { ImportRow } from '../server/cloud/data/import-schema.ts';
import { parseStoredMatch, resourceMutation, reviewMutation, sourceIdentityReview, type ArtworkReview } from '../server/artwork/model.ts';
import worker, { handleCloudRequest } from '../server/cloud/worker.ts';
import { artworkTestPng as png } from './helpers/artwork-image.ts';
import { inspectSourceIdentity } from '../server/artwork/identity.ts';
import { parseAniListMedia } from '../server/artwork/source.ts';

let runtime: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const date = '2026-09-12T00:00:00.000Z';
const budget = { dailyWrittenRows: 75_000, dailyQueueOperations: 2500 };
const poster = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx42-TestOnly.png';
const banner = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/42-TestOnly.png';
const matchId = 'anikoto:test-art:anilist:42';
const metadata = { id:42,idMal:100,type:'ANIME',format:'TV',startDate:{year:2026},title:{english:'Test Title',romaji:'Test Alias',native:null},siteUrl:'https://anilist.co/anime/42',coverImage:{extraLarge:poster},bannerImage:banner };
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const review:ArtworkReview={titleId:1,titleSource:'anikoto',titleSourceId:'test-art',mediaId:42,malId:100,releaseYear:2026,format:'TV',reviewedAt:date,evidence:{sourceUrl:'https://anikototv.to/watch/test-art',metadataUrl:'https://anilist.co/anime/42',sourceName:'Test Title',metadataName:'Test Title',sourceAlias:'Test Alias',metadataAlias:'Test Alias',sourcePosterSha256:'a'.repeat(64),metadataPosterSha256:hash(png(460,650)),posterComparison:'same-key-art-manually-reviewed',premiereDate:'2026-04-01',notes:'Deterministic fixture only.'}};
function statements(sql:string){
  const result:string[]=[];let current='';let quote='';let comment=false;
  for(let index=0;index<sql.length;index++){
    const char=sql[index];const next=sql[index+1];
    if(comment){if(char==='\n'){comment=false;current+=' ';}continue;}
    if(!quote&&char==='-'&&next==='-'){comment=true;index++;continue;}
    if(quote){current+=char;if(char===quote){if(next===quote){current+=next;index++;}else quote='';}continue;}
    if(char==="'"||char==='"'){quote=char;current+=char;continue;}
    if(char===';'){if(current.trim())result.push(current.trim());current='';}else current+=char;
  }
  if(current.trim())result.push(current.trim());return result;
}
beforeAll(async()=>{
  runtime=new Miniflare(convertV4MiniflareOptions({name:'artwork-contracts',modules:true,script:'export default { fetch() { return new Response("test-only") } }',compatibilityDate:'2026-09-12',d1Databases:{CATALOGUE:'artwork-test'}}));
  db=await runtime.getD1Database('CATALOGUE');
  for(const file of readdirSync(new URL('../migrations/cloud/catalogue/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort()) {
    const sql=readFileSync(new URL(`../migrations/cloud/catalogue/${file}`,import.meta.url),'utf8');
    for(const statement of statements(sql)) await db.prepare(statement).run();
  }
},60_000);
afterAll(async()=>{await runtime?.dispose();});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
beforeEach(async()=>{
  for(const table of ['artwork_jobs','title_artwork','artwork_matches','artwork_source_policy','cloud_snapshot_jobs','crawl_tasks','crawl_runs','titles','cloud_import_receipts','cloud_budget_reservations','cloud_daily_budget'])await db.prepare(`DELETE FROM ${table}`).run();
  await db.prepare("INSERT INTO titles(id,source,source_id,slug,canonical_url,name,format,release_year,artwork_url,first_seen_at,last_seen_at,created_at,updated_at) VALUES(1,'anikoto','test-art','test-art','https://anikototv.to/watch/test-art','Test Title','TV',2026,'https://cdn.anipixcdn.co/thumbnail/test-only.jpg',?,?,?,?)").bind(date,date,date,date).run();
  const mutation=reviewMutation(review);await db.prepare(mutation.sql).bind(...mutation.values).run();
  await db.prepare("INSERT INTO crawl_runs(id,source,mode,status,created_at,updated_at) VALUES(1,'artwork','incremental','queued',?,?)").bind(date,date).run();
  await db.prepare('UPDATE cloud_sync_control SET enabled=1').run();
});
const message=(taskId:number)=>({body:{taskId},ack(){},retry(){}});
async function due() { await db.prepare("UPDATE crawl_tasks SET available_at=? WHERE task_type='artwork_refresh'").bind(date).run();await db.prepare('UPDATE artwork_source_policy SET next_request_at=?').bind(date).run(); }
async function importBatch(table:string,rows:ImportRow[],id=crypto.randomUUID()){return {version:1,id,snapshotId:'artwork-fixtures-only',target:'catalogue',table,rows,contentHash:await importHash(rows)};}
const origin = 'https://artwork-contract.example.test';
const operatorToken = 'artwork-test-only-operator-material-32-characters';
function apiEnvironment(overrides: Partial<CloudEnv> = {}): CloudEnv {
  return {
    CATALOGUE: db, ACCOUNTS: db, RESEARCH: db,
    API_LIMITER: { async limit() { return { success: true }; } },
    RESOLVE_LIMITER: { async limit() { return { success: true }; } },
    SYNC_QUEUE: {
      async metrics() { return { backlogCount: 0, backlogBytes: 0 }; },
      async send() { return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } }; },
      async sendBatch() { return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } }; },
    },
    IMPORT_ASSETS: { async fetch() { throw new Error('Artwork refresh must not read snapshot assets.'); }, connect() { throw new Error('No sockets in fixture.'); } },
    SOLANIME_APP_ORIGIN: origin, SOLANIME_ALLOWED_ORIGINS: '', SOLANIME_REGISTRATION: 'closed',
    SOLANIME_ADMIN_TOKEN: operatorToken, FIREBASE_PROJECT_ID: '', FIREBASE_API_KEY: '', FIREBASE_SERVICE_ACCOUNT_JSON: '', AUTH_CREDENTIAL_KEY: '', RELEASE_CHANNEL: 'test',
    SYNC_ENABLED: 'true', SOURCE_REFRESH_ENABLED: 'false', SYNC_DAILY_WRITE_BUDGET: '75000', SYNC_DAILY_QUEUE_BUDGET: '2500',
    IMPORT_MANIFEST_PATH: '/fixture-only-manifest.json', IMPORT_MANIFEST_SHA256: '0'.repeat(64),
    CATALOGUE_BASELINE_ENABLED: 'false', CATALOGUE_BASELINE_ID: '0'.repeat(64),
    CATALOGUE_BASELINE_MANIFEST_SHA256: '0'.repeat(64),
    ...overrides,
  };
}
function refreshRequest(value: unknown, options: { authenticated?: boolean; origin?: string } = {}) {
  return new Request(`${origin}/api/admin/artwork/refresh`, { method: 'POST', headers: {
    'content-type': 'application/json', origin: options.origin ?? origin, 'sec-fetch-site': 'same-origin',
    ...(options.authenticated === false ? {} : { 'x-admin-token': operatorToken }),
  }, body: JSON.stringify(value) });
}

describe('real D1 artwork contracts',{timeout:30_000},()=>{
  it('imports an offline exact-ID proof without falsely calling it a manual review, and rejects a retargeted proof',async()=>{
    await db.prepare('DELETE FROM artwork_matches').run();
    await db.prepare("UPDATE titles SET source_id='1642' WHERE id=1").run();
    const owner={titleId:1,source:'anikoto' as const,sourceId:'1642',slug:'test-art',name:'Test Title',aliases:['Test Alias'],year:2026,format:'TV',episodes:[{sourceId:'30298',number:1}]};
    const observed=inspectSourceIdentity({success:true,results:{animeId:1642,slug:'test-art',totalEpisodes:1,episodes:[{id:'30298',episode_no:1,mal_id:100}]}},owner,{observedAt:date,responseSha256:'a'.repeat(64)});
    if(observed.status!=='verified')throw new Error('Expected exact-ID fixture.');
    const reviewed=sourceIdentityReview(owner,observed.proof,parseAniListMedia(metadata,42),date);
    const row:ImportRow={id:'anikoto:1642:anilist:42',title_id:1,title_source:'anikoto',title_source_id:'1642',metadata_source:'anilist',media_id:42,mal_id:100,release_year:2026,format:'TV',review_status:'approved',evidence_json:JSON.stringify(reviewed.evidence),reviewed_at:date,created_at:date,updated_at:date};
    await applyImportBatch(db,db,await importBatch('artwork_matches',[row]),budget);
    const image:ImportRow={match_id:row.id,role:'backdrop',url:banner,width:1900,height:400,format:'png',content_sha256:hash(png(1900,400)),reuse_status:'reference-only',first_seen_at:date,last_checked_at:date,last_successful_verification_at:date,last_error_code:null};
    await applyImportBatch(db,db,await importBatch('title_artwork',[image]),budget);
    expect((await createCatalogueRepository(db).getTitle('test-art')).title.artwork).toMatchObject({backdrop:{identityReview:'source-id-verified',reuseStatus:'reference-only'}});
    const invalid={...row,evidence_json:JSON.stringify({...reviewed.evidence,identityProof:{...observed.proof,sourceTitleId:'1643'}})};
    await expect(applyImportBatch(db,db,await importBatch('artwork_matches',[invalid]),budget)).rejects.toMatchObject({code:'IMPORT_IDENTITY_CONFLICT'});
    expect((await db.prepare('SELECT evidence_json FROM artwork_matches').first())?.evidence_json).toBe(row.evidence_json);
  });
  it('projects measured artwork with unchanged source identities and unknown reuse permission',async()=>{
    const match=parseStoredMatch((await db.prepare('SELECT * FROM artwork_matches WHERE id=?').bind(matchId).first())!);
    const mutation=resourceMutation(match,'backdrop',{url:banner,width:1900,height:400,format:'png',bytes:32,contentSha256:hash(png(1900,400)),verifiedAt:date});
    await db.prepare(mutation.sql).bind(...mutation.values).run();
    const result=await createCatalogueRepository(db).browseTitles({page:1,pageSize:20,sort:'updated',includeFacets:false});
    expect(result.items[0]).toMatchObject({id:'1',sourceId:'test-art',imageUrl:'https://cdn.anipixcdn.co/thumbnail/test-only.jpg',backdropUrl:banner,artwork:{backdrop:{reuseStatus:'reference-only',width:1900,height:400}}});
    expect((await createCatalogueRepository(db).getTitle('test-art')).title.backdropUrl).toBe(banner);
    await db.prepare("UPDATE artwork_matches SET review_status='disabled'").run();expect((await createCatalogueRepository(db).getTitle('test-art')).title.backdropUrl).toBeNull();
  });
  it('runs generic resumable metadata/poster/backdrop tasks with a bounded query budget',async()=>{
    expect((await enqueueCloudArtwork(db,1,budget)).enqueued).toBe(1);expect((await enqueueCloudArtwork(db,1,budget)).enqueued).toBe(0);
    const task=await db.prepare("SELECT id FROM crawl_tasks WHERE task_type='artwork_refresh'").first<{id:number}>();const requested:string[]=[];
    const send:typeof fetch=async(input)=>{const url=String(input);requested.push(url);return url.includes('graphql')?Response.json({data:{Media:metadata}}):new Response(url===poster?png(460,650):png(1900,400),{headers:{'content-type':'image/png'}});};
    for(let phase=0;phase<3;phase++){
      await due();const counter={used:0,maximum:45};const bounded=withQueryBudget(db,counter);
      const result=await consumeSyncMessage(message(task!.id),bounded,createArtworkSyncHandlers(bounded,{budget,fetch:send}),budget);
      expect(result.status).toBe(phase===2?'completed':'checkpointed');expect(counter.used).toBeLessThanOrEqual(45);
    }
    expect(requested).toEqual(['https://graphql.anilist.co/',poster,banner]);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM title_artwork').first())?.count).toBe(2);
    expect((await createCatalogueRepository(db).getTitle('test-art')).title.backdropUrl).toBe(banner);
    expect((await getWriteBudget(db,budget)).writtenRowsReserved).toBeGreaterThan(0);
  });
  it('pauses before an upstream request when the shared daily allowance is exhausted',async()=>{
    await enqueueCloudArtwork(db,1,budget);const task=await db.prepare('SELECT id FROM crawl_tasks').first<{id:number}>();
    const tiny={dailyWrittenRows:300,dailyQueueOperations:20};await reserveWriteBudget(db,'other-work',260,0,tiny);let requests=0;
    const result=await consumeSyncMessage(message(task!.id),db,createArtworkSyncHandlers(db,{budget:tiny,fetch:async()=>{requests++;return Response.json({data:{Media:metadata}});}}),tiny);
    expect(result.status).toBe('quota_paused');expect(requests).toBe(0);expect((await db.prepare('SELECT checkpoint_json FROM crawl_tasks').first())?.checkpoint_json).toBe('{}');
  });
  it('preserves a refused host across an operator task retry instead of masking headers',async()=>{
    await enqueueCloudArtwork(db,1,budget);const task=await db.prepare('SELECT id FROM crawl_tasks').first<{id:number}>();let requests=0;
    const handlers=createArtworkSyncHandlers(db,{budget,fetch:async(_input,init)=>{requests++;expect(init?.headers).not.toHaveProperty('referer');return new Response(null,{status:403});}});
    expect((await consumeSyncMessage(message(task!.id),db,handlers,budget)).status).toBe('blocked');
    await db.prepare("UPDATE crawl_tasks SET status='retry',available_at=?").bind(date).run();await db.prepare("UPDATE crawl_runs SET status='queued'").run();
    expect((await consumeSyncMessage(message(task!.id),db,handlers,budget)).status).toBe('blocked');expect(requests).toBe(1);
    expect((await db.prepare('SELECT blocked_status FROM artwork_source_policy').first())?.blocked_status).toBe(403);
  });
  it('imports additive artwork through the existing protected receipt/quota contract and preserves operator decisions',async()=>{
    const row=(await db.prepare('SELECT * FROM artwork_matches').first<ImportRow>())!;
    await db.prepare("UPDATE artwork_matches SET review_status='disabled',reviewed_at='2026-09-13T00:00:00Z'").run();
    const incoming={...row,updated_at:'2026-09-14T00:00:00Z',reviewed_at:'2026-09-14T00:00:00Z',evidence_json:JSON.stringify({...JSON.parse(String(row.evidence_json)),notes:'Replacement must not overwrite prior review.'})};
    await applyImportBatch(db,db,await importBatch('artwork_matches',[incoming]),budget);
    expect(await db.prepare('SELECT review_status,reviewed_at,evidence_json FROM artwork_matches').first()).toEqual({review_status:'disabled',reviewed_at:'2026-09-13T00:00:00Z',evidence_json:row.evidence_json});
    expect((await getWriteBudget(db,budget)).writtenRowsReserved).toBeGreaterThan(0);
  });
  it('atomically rejects wrong catalogue parents and duplicate owner/media identities with typed409',async()=>{
    const row=(await db.prepare('SELECT * FROM artwork_matches').first<ImportRow>())!;
    const invalid=await importBatch('artwork_matches',[{...row,title_id:999,updated_at:'2026-09-14T00:00:00Z'}]);
    await expect(applyImportBatch(db,db,invalid,budget)).rejects.toMatchObject({status:409,code:'IMPORT_IDENTITY_CONFLICT'});
    expect(await db.prepare('SELECT id FROM cloud_import_receipts WHERE id=?').bind(invalid.id).first()).toBeNull();
    expect((await db.prepare('SELECT title_id FROM artwork_matches').first())?.title_id).toBe(1);
    const proof=JSON.parse(String(row.evidence_json));const second={...row,id:'anikoto:test-art:anilist:43',media_id:43,evidence_json:JSON.stringify({...proof,metadataUrl:'https://anilist.co/anime/43'}),updated_at:'2026-09-14T00:00:00Z'};
    await expect(applyImportBatch(db,db,await importBatch('artwork_matches',[second]),budget)).rejects.toMatchObject({code:'IMPORT_IDENTITY_CONFLICT'});
    expect(()=>validateImportBatch({version:1,id:'dupe',snapshotId:'test',target:'catalogue',table:'artwork_matches',contentHash:'a'.repeat(64),rows:[row,second]})).toThrow('multiple internal IDs');
    await db.prepare('DELETE FROM artwork_matches').run();
    const orphan={...row,id:'anikoto:absent:anilist:42',title_source_id:'absent'};
    await expect(applyImportBatch(db,db,await importBatch('artwork_matches',[orphan]),budget)).rejects.toMatchObject({code:'IMPORT_IDENTITY_CONFLICT'});
  });
  it('retains newer verified images and permission state on stale replay, and rejects non-source URLs',async()=>{
    const image:ImportRow={match_id:matchId,role:'backdrop',url:banner,width:1900,height:400,format:'png',content_sha256:hash(png(1900,400)),reuse_status:'reference-only',first_seen_at:date,last_checked_at:date,last_successful_verification_at:date,last_error_code:null};
    const initial=await importBatch('title_artwork',[image]);const receipt=await applyImportBatch(db,db,initial,budget);expect(receipt.status).toBe('imported');
    await db.prepare("UPDATE title_artwork SET reuse_status='permission-recorded',url=?,last_successful_verification_at='2026-09-13T00:00:00Z',last_checked_at='2026-09-13T00:00:00Z'").bind(banner.replace('TestOnly','Newer')).run();
    await applyImportBatch(db,db,await importBatch('title_artwork',[image]),budget);
    expect(await db.prepare('SELECT url,reuse_status FROM title_artwork').first()).toEqual({url:banner.replace('TestOnly','Newer'),reuse_status:'permission-recorded'});
    await applyImportBatch(db,db,await importBatch('title_artwork',[{...image,last_successful_verification_at:'2026-09-14T00:00:00Z',last_checked_at:'2026-09-14T00:00:00Z'}]),budget);
    expect((await db.prepare('SELECT reuse_status FROM title_artwork').first())?.reuse_status).toBe('permission-recorded');
    await db.prepare("UPDATE title_artwork SET last_checked_at='2026-09-15T00:00:00Z',last_error_code='UNAVAILABLE'").run();
    await applyImportBatch(db,db,await importBatch('title_artwork',[{...image,last_successful_verification_at:'2026-09-14T00:00:00Z',last_checked_at:'2026-09-14T00:00:00Z'}]),budget);
    expect(await db.prepare('SELECT last_checked_at,last_error_code FROM title_artwork').first()).toEqual({last_checked_at:'2026-09-15T00:00:00Z',last_error_code:'UNAVAILABLE'});
    await expect(applyImportBatch(db,db,await importBatch('title_artwork',[{...image,url:'http://127.0.0.1/private'}]),budget)).rejects.toMatchObject({status:400,code:'INVALID_IMPORT'});
  });

  it('requires protected explicit identities and rejects disabled, unknown, oversized or URL-based refresh requests', async () => {
    const env = apiEnvironment(); const input = { key: 'approved-only', matchIds: [matchId] };
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    expect((await handleCloudRequest(refreshRequest(input, { authenticated: false }), env)).status).toBe(401);
    expect((await handleCloudRequest(refreshRequest(input, { origin: 'https://foreign.example.test' }), env)).status).toBe(403);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await handleCloudRequest(refreshRequest(input), apiEnvironment({ SYNC_ENABLED: 'false' }))).status).toBe(503);
    for (const invalid of [ {}, { ...input, key: '../bad' }, { ...input, matchIds: [] }, { ...input, matchIds: [matchId, matchId] }, { ...input, matchIds: Array.from({ length: 6 }, (_, i) => `anikoto:fixture-${i}:anilist:${i + 1}`) }, { ...input, url: 'http://127.0.0.1/private' } ]) {
      expect((await handleCloudRequest(refreshRequest(invalid), env)).status).toBe(400);
    }
    expect((await handleCloudRequest(refreshRequest({ ...input, matchIds: ['anikoto:missing:anilist:999'] }), env)).status).toBe(409);
    await db.prepare("UPDATE artwork_matches SET review_status='disabled'").run();
    expect((await handleCloudRequest(refreshRequest(input), env)).status).toBe(409);
    expect(network).not.toHaveBeenCalled();
    expect((await db.prepare("SELECT COUNT(*) AS count FROM crawl_runs WHERE source LIKE 'artwork-cloud:%'").first())?.count).toBe(0);
    expect(log.mock.calls.flat().every(value => !String(value).includes(operatorToken))).toBe(true);
  });

  it('reaches the normal Worker queue and cron for every artwork phase while preserving the full snapshot', async () => {
    const env = apiEnvironment(); const input = { key: 'explicit-refresh', matchIds: [matchId] };
    await db.prepare("INSERT INTO crawl_runs(id,source,mode,status,created_at,updated_at) VALUES(500,'fixture-pinned-snapshot','full','running',?,?)").bind(date,date).run();
    await db.prepare("INSERT INTO crawl_tasks(id,run_id,task_key,task_type,payload_json,status,available_at,created_at,updated_at,checkpoint_json) VALUES(501,500,'pinned','snapshot_import','{}','pending',?,?,?,'{\"nextBatch\":111}')").bind(date,date,date).run();
    await db.prepare("INSERT INTO cloud_snapshot_jobs(id,manifest_path,manifest_hash,source_manifest_hash,run_id,task_id,total_batches,total_rows,created_at) VALUES('artwork-fixture-snapshot','/fixture.json',?,?,500,501,28364,999999,?)").bind('a'.repeat(64),'b'.repeat(64),date).run();
    const before = await db.prepare('SELECT * FROM crawl_tasks WHERE id=501').first();
    const notified: number[] = [];
    vi.spyOn(env.SYNC_QUEUE, 'send').mockImplementation(async value => {
      expect(Object.keys(value as object)).toEqual(['taskId']); notified.push(Number((value as { taskId: number }).taskId));
      return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
    });
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input); requested.push(url);
      return url.includes('graphql') ? Response.json({ data: { Media: metadata } }) : new Response(url === poster ? png(460,650) : png(1900,400), { headers: { 'content-type': 'image/png' } });
    });
    const started = await handleCloudRequest(refreshRequest(input), env);
    expect(started.status).toBe(202);
    const result = await started.json() as { job: { runId: number; status: string }; dispatch: { dispatched: number } };
    expect(result.job.status).toBe('created'); expect(result.job.runId).toBeGreaterThan(1_000_000_000);
    expect(result.dispatch.dispatched).toBe(1); expect(requested).toEqual([]);
    const task = await db.prepare('SELECT id FROM crawl_tasks WHERE run_id=?').bind(result.job.runId).first<{ id: number }>();
    expect(notified).toEqual([task!.id]); expect(task!.id).toBeGreaterThan(1_000_000_000);
    for (let phase = 0; phase < 3; phase++) {
      if (phase) {
        await due();
        await worker.scheduled({ scheduledTime: Date.parse('2026-09-12T12:00:00Z'), cron: '* * * * *', noRetry() {} }, env);
        expect(notified.at(-1)).toBe(task!.id);
      }
      const ack = vi.fn();
      await worker.queue({ queue: 'artwork-fixture', messages: [{ body: { taskId: task!.id }, ack, retry() {} }], ackAll() {}, retryAll() {} } as unknown as MessageBatch<unknown>, env);
      expect(ack).toHaveBeenCalledTimes(1);
      expect((await db.prepare('SELECT status FROM crawl_tasks WHERE id=?').bind(task!.id).first())?.status).toBe(phase === 2 ? 'completed' : 'retry');
    }
    expect(requested).toEqual(['https://graphql.anilist.co/',poster,banner]);
    const replay = await handleCloudRequest(refreshRequest(input), env);
    expect((await replay.json() as { job: { status: string; runId: number } }).job).toMatchObject({ status: 'existing', runId: result.job.runId });
    expect((await db.prepare('SELECT COUNT(*) AS count FROM crawl_tasks WHERE run_id=?').bind(result.job.runId).first())?.count).toBe(1);
    // Completed-key replay must not restart the snapshot merely to dispatch unrelated work.
    expect(await db.prepare('SELECT * FROM crawl_tasks WHERE id=501').first()).toEqual(before);
    const snapshots = await createSnapshotImportRepository(db, env.IMPORT_ASSETS, budget).status();
    expect(snapshots.jobs).toMatchObject([{ runId: 500, runStatus: 'running', taskId: 501, importedBatches: 111 }]);
    expect((await createCatalogueRepository(db).getTitle('test-art')).title.backdropUrl).toBe(banner);
  });

  it('keeps operator pause and shared quota authoritative for explicit artwork refresh', async () => {
    const input = { key: 'paused-refresh', matchIds: [matchId] }; const send = vi.fn();
    const env = apiEnvironment(); vi.spyOn(env.SYNC_QUEUE, 'send').mockImplementation(send);
    await db.prepare('UPDATE cloud_sync_control SET enabled=0').run();
    const response = await handleCloudRequest(refreshRequest(input), env);
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ dispatch: { status: 'paused', dispatched: 0 } });
    expect(send).not.toHaveBeenCalled(); expect((await db.prepare('SELECT enabled FROM cloud_sync_control').first())?.enabled).toBe(0);
    const runs = (await db.prepare('SELECT COUNT(*) AS count FROM crawl_runs').first())?.count;
    const quota = await handleCloudRequest(refreshRequest({ ...input, key: 'quota-refused' }), apiEnvironment({ SYNC_DAILY_WRITE_BUDGET: '1' }));
    expect(quota.status).toBe(429); expect(await quota.json()).toMatchObject({ error: { code: 'IMPORT_QUOTA_PAUSED' } });
    expect((await db.prepare('SELECT COUNT(*) AS count FROM crawl_runs').first())?.count).toBe(runs);
  });
});

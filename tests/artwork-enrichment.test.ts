import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../server/db.ts';
import { browseTitles } from '../server/catalogue.ts';
import { fetchSourceIdentity, inspectSourceIdentity, type ArtworkIdentityOwner } from '../server/artwork/identity.ts';
import { artworkOwner, migrateArtworkEnrichment, runArtworkEnrichmentStep, seedArtworkEnrichment } from '../server/artwork/enrichment.ts';
import { fetchAniListMediaByMal, fetchArtworkResource, parseAniListMedia } from '../server/artwork/source.ts';
import { sourceIdentityReview, validateArtworkReview } from '../server/artwork/model.ts';
import { completeRaster } from '../server/artwork/raster.ts';
import { artworkTestPng } from './helpers/artwork-image.ts';

const date = '2026-09-13T00:00:00.000Z';
const poster = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx42-TestOnly.png';
const banner = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/42-TestOnly.png';
const owner = (): ArtworkIdentityOwner => ({titleId:1,source:'anikoto',sourceId:'1642',slug:'test-title',name:'Test Title',aliases:['Test Alias'],year:2026,format:'TV',episodes:[{sourceId:'30298',number:1},{sourceId:'30299',number:2}]});
const identity = () => ({success:true,results:{animeId:1642,slug:'test-title',totalEpisodes:2,episodes:[{id:'30298',episode_no:1,mal_id:'21',server_ids:'NEVER_RETAIN_THIS'},{id:'30299',episode_no:2,mal_id:'21',server_ids:'NEVER_RETAIN_THIS'}]}});
const metadata = () => ({id:42,idMal:21,type:'ANIME',format:'TV',startDate:{year:2026},title:{english:'Test Title',romaji:'Test Alias',native:null},siteUrl:'https://anilist.co/anime/42',coverImage:{extraLarge:poster},bannerImage:banner});
const observation = {observedAt:date,responseSha256:'a'.repeat(64)};
const databases: DatabaseSync[] = [];
function setup() {
  const db = new DatabaseSync(':memory:'); const queue = new DatabaseSync(':memory:'); databases.push(db,queue); migrate(db); migrateArtworkEnrichment(queue);
  db.prepare("INSERT INTO titles(id,source,source_id,slug,canonical_url,name,format,release_year,first_seen_at,last_seen_at,created_at,updated_at) VALUES(1,'anikoto','1642','test-title','https://anikototv.to/watch/test-title','Test Title','TV',2026,?,?,?,?)").run(date,date,date,date);
  db.prepare("INSERT INTO title_aliases(title_id,alias) VALUES(1,'Test Alias')").run();
  for (const episode of owner().episodes) db.prepare("INSERT INTO episodes(title_id,source_id,number_text,number_sort,slug,canonical_url,first_seen_at,last_seen_at,created_at,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?)").run(episode.sourceId,String(episode.number),episode.number,String(episode.number),`https://anikototv.to/watch/test-title/ep-${episode.number}`,date,date,date,date);
  seedArtworkEnrichment(db,queue,[1],date); return {db,queue};
}
afterEach(() => { vi.useRealTimers(); databases.splice(0).forEach(db => db.close()); });
const advance = () => vi.setSystemTime(new Date(Date.now()+5000));
const options = (send: typeof fetch, limit = 20) => ({titleIds:[1],dailyRequestLimit:limit,fetch:send});

describe('exact source identity artwork crosswalk', () => {
  it('uses all imported episode IDs and keeps only filtered provenance, never opaque server fields', () => {
    const result = inspectSourceIdentity(identity(),owner(),observation);
    expect(result).toMatchObject({status:'verified',malId:21,proof:{sourceTitleId:'1642',sourceSlug:'test-title',matchedEpisodes:2,catalogueEpisodes:2}});
    expect(JSON.stringify(result)).not.toContain('NEVER_RETAIN_THIS');
    if (result.status !== 'verified') throw new Error('Expected a verified test crosswalk.');
    const review = sourceIdentityReview(owner(),result.proof,parseAniListMedia(metadata(),42),date);
    expect(validateArtworkReview(review).evidence.identityProof?.malId).toBe(21);
    expect(review.evidence.posterComparison).toBeUndefined();
    expect(() => validateArtworkReview({...review,evidence:{...review.evidence,posterComparison:'same-key-art-manually-reviewed'}})).toThrow('must not imply');
  });
  it('does not infer matching seasons from the same name, slug or MAL ID alone', () => {
    for (const update of [{animeId:999},{slug:'different-title'}]) expect(inspectSourceIdentity({...identity(),results:{...identity().results,...update}},owner(),observation)).toMatchObject({status:'unresolved',code:'SOURCE_IDENTITY_CONFLICT'});
    const changed = identity(); changed.results.episodes[1].episode_no = 3;
    expect(inspectSourceIdentity(changed,owner(),observation)).toMatchObject({status:'unresolved',code:'SOURCE_IDENTITY_CONFLICT'});
    const wrongSeason = {...owner(),year:2025}; const result = inspectSourceIdentity(identity(),owner(),observation);
    if (result.status !== 'verified') throw new Error('Fixture invalid.');
    expect(() => sourceIdentityReview(wrongSeason,result.proof,parseAniListMedia(metadata(),42),date)).toThrow('conflicting or missing');
  });
  it('records missing, ambiguous and partial inventories without guessing IDs or deleting rows', () => {
    const mixed = identity(); mixed.results.episodes[1].mal_id = '22';
    expect(inspectSourceIdentity(mixed,owner(),observation)).toMatchObject({status:'unresolved',code:'AMBIGUOUS_MAL_IDENTIFIER'});
    const missing = identity(); missing.results.episodes[1].mal_id = '';
    expect(inspectSourceIdentity(missing,owner(),observation)).toMatchObject({status:'unresolved',code:'MISSING_MAL_IDENTIFIER'});
    expect(inspectSourceIdentity({...identity(),results:{...identity().results,totalEpisodes:3}},owner(),observation)).toMatchObject({code:'INCOMPLETE_EPISODE_RESPONSE'});
    expect(inspectSourceIdentity(identity(),{...owner(),episodes:[]},observation)).toMatchObject({code:'NO_IMPORTED_EPISODE_ANCHOR'});
    const duplicate = identity(); duplicate.results.episodes[1].id = '30298';
    expect(() => inspectSourceIdentity(duplicate,owner(),observation)).toThrow('duplicated');
  });
  it('rejects a wrong idMal result and observes only the exact normal metadata interfaces', async () => {
    const identityFetch = vi.fn<typeof fetch>(async (input,init) => { expect(String(input)).toBe('https://anime.vidy.st/api/episodes/test-title'); expect(init).toMatchObject({redirect:'manual',headers:{accept:'application/json'}}); expect(init?.headers).not.toHaveProperty('referer'); return Response.json(identity()); });
    expect((await fetchSourceIdentity(owner(),identityFetch)).status).toBe('verified');
    const metadataFetch = vi.fn<typeof fetch>(async (_input,init) => { expect(JSON.parse(String(init?.body))).toMatchObject({variables:{id:21}}); expect(String(init?.body)).toContain('idMal: $id'); return Response.json({data:{Media:metadata()}}); });
    expect((await fetchAniListMediaByMal(21,metadataFetch)).id).toBe(42);
    await expect(fetchAniListMediaByMal(22,metadataFetch)).rejects.toThrow();
    for (const status of [302,403,429]) await expect(fetchSourceIdentity(owner(),async()=>new Response(null,{status,headers:{'retry-after':'120'}}))).rejects.toMatchObject({status});
  });
});

describe('whole-catalogue durable artwork queue and selected execution', () => {
  it('seeds all real titles idempotently and preserves identity/failure state on re-seed', () => {
    const {db,queue} = setup();
    db.prepare("INSERT INTO titles(id,source,source_id,slug,canonical_url,name,format,release_year,first_seen_at,last_seen_at,created_at,updated_at) VALUES(2,'anikoto','1643','title-two','https://anikototv.to/watch/title-two','Title Two','TV',2026,?,?,?,?)").run(date,date,date,date);
    expect(seedArtworkEnrichment(db,queue,[1],date).catalogueTitles).toBe(2);
    expect(seedArtworkEnrichment(db,queue,[1],date).insertedOrReprioritized).toBe(0);
    expect(queue.prepare('SELECT status,reason FROM artwork_enrichment_tasks WHERE title_id=2').get()).toMatchObject({status:'review_needed',reason:'NO_IMPORTED_EPISODE_ANCHOR'});
    queue.prepare("UPDATE artwork_enrichment_tasks SET status='blocked',reason='BLOCKED' WHERE title_id=1").run();
    seedArtworkEnrichment(db,queue,[1],date); expect(queue.prepare('SELECT status FROM artwork_enrichment_tasks WHERE title_id=1').get()?.status).toBe('blocked');
    db.prepare("UPDATE titles SET source_id='changed' WHERE id=1").run(); expect(()=>seedArtworkEnrichment(db,queue,[1],date)).toThrow('different or changed');
  });
  it('resumes ID→metadata→poster→banner and exposes actual new artwork in the normal catalogue API', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(date)); const {db,queue} = setup(); const before = db.prepare('SELECT * FROM titles').all();
    const requested:string[] = [];
    const send: typeof fetch = async input => { const url = String(input); requested.push(url); return url.includes('vidy.st') ? Response.json(identity()) : url.includes('graphql') ? Response.json({data:{Media:metadata()}}) : new Response(url===poster ? artworkTestPng() : artworkTestPng(1900,400),{headers:{'content-type':'image/png'}}); };
    for (const stage of ['metadata','artwork','artwork','done']) { expect(await runArtworkEnrichmentStep(db,queue,options(send))).toMatchObject({stage,requests:1}); advance(); }
    expect(requested).toEqual(['https://anime.vidy.st/api/episodes/test-title','https://graphql.anilist.co/',poster,banner]);
    expect(browseTitles(db,{page:1,pageSize:20,sort:'updated'}).items[0]).toMatchObject({id:'1',posterUrl:poster,backdropUrl:banner,artwork:{backdrop:{identityReview:'source-id-verified',reuseStatus:'reference-only'}}});
    expect(db.prepare('SELECT * FROM titles').all()).toEqual(before);
    expect(await runArtworkEnrichmentStep(db,queue,options(send))).toMatchObject({status:'idle',requests:0});
    expect(queue.prepare('SELECT requests_reserved FROM artwork_enrichment_budget').get()?.requests_reserved).toBe(4);
    expect(JSON.stringify(queue.prepare('SELECT * FROM artwork_enrichment_tasks').all())).not.toContain('NEVER_RETAIN_THIS');
  });
  it('keeps missing/small image reasons even when there was no previous resource row', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(date)); const {db,queue} = setup();
    const send: typeof fetch = async input => String(input).includes('vidy.st') ? Response.json(identity()) : String(input).includes('graphql') ? Response.json({data:{Media:{...metadata(),bannerImage:null}}}) : new Response(artworkTestPng(230,307),{headers:{'content-type':'image/png'}});
    for (let index=0;index<4;index++) { await runArtworkEnrichmentStep(db,queue,options(send)); advance(); }
    expect(JSON.parse(String(queue.prepare('SELECT checkpoint_json FROM artwork_enrichment_tasks').get()?.checkpoint_json))).toMatchObject({outcomes:{poster:'BELOW_SIZE_THRESHOLD',backdrop:'IMAGE_ABSENT'}});
    expect(db.prepare('SELECT COUNT(*) AS count FROM title_artwork').get()?.count).toBe(0);
  });
  it('retains refused-host state and does not spend a request on pacing, replay or quota exhaustion', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(date)); const {db,queue} = setup(); const send = vi.fn<typeof fetch>(async()=>Response.json(identity()));
    expect((await runArtworkEnrichmentStep(db,queue,options(send,1))).requests).toBe(1); advance();
    expect(await runArtworkEnrichmentStep(db,queue,options(send,1))).toMatchObject({status:'retry',reason:'QUOTA_EXHAUSTED',requests:0}); expect(send).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-14T00:00:05Z'));
    const refusal = vi.fn<typeof fetch>(async()=>new Response(null,{status:403}));
    expect(await runArtworkEnrichmentStep(db,queue,options(refusal,1))).toMatchObject({status:'blocked',reason:'BLOCKED',requests:1});
    queue.prepare("UPDATE artwork_enrichment_tasks SET status='retry',available_at=?").run(date); advance();
    expect(await runArtworkEnrichmentStep(db,queue,options(refusal,1))).toMatchObject({status:'blocked',reason:'BLOCKED',requests:0}); expect(refusal).toHaveBeenCalledTimes(1);
  });
  it('rejects stale lease responses without advancing identity checkpoints', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(date)); const {db,queue} = setup();
    const send: typeof fetch = async()=>{queue.prepare("UPDATE artwork_enrichment_tasks SET lease='replacement'").run();return Response.json(identity());};
    expect(await runArtworkEnrichmentStep(db,queue,options(send))).toMatchObject({status:'stale_lease'});
    expect(queue.prepare('SELECT mal_id,stage FROM artwork_enrichment_tasks').get()).toEqual({mal_id:null,stage:'identity'});
    expect(artworkOwner(db,1)?.episodes).toHaveLength(2);
  });
});

describe('measured image-container integrity', () => {
  it('rejects truncated dimension headers, changed CRCs, absent frames and portrait banners', async () => {
    const valid = artworkTestPng(1900,400); expect(completeRaster(valid,'png')).toBe(true);
    for (const value of [valid.slice(0,24),valid.slice(0,-12),new Uint8Array([0xff,0xd8,0xff,0xd9])]) expect(completeRaster(value,'png')).toBe(false);
    const corrupt = valid.slice(); corrupt[33] ^= 1; expect(completeRaster(corrupt,'png')).toBe(false);
    await expect(fetchArtworkResource(banner,42,'backdrop',async()=>new Response(valid.slice(0,24),{headers:{'content-type':'image/png'}}))).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    expect(completeRaster(new Uint8Array(50),'webp')).toBe(false);
  });
});

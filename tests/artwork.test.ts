import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../server/db.ts';
import { browseTitles, getTitle } from '../server/catalogue.ts';
import { applyArtworkBundle, validateArtworkBundle } from '../server/artwork/bundle.ts';
import { approveLocalArtwork, enqueueLocalArtwork, runLocalArtworkStep } from '../server/artwork/local.ts';
import { validateArtworkReview, type ArtworkReview } from '../server/artwork/model.ts';
import { fetchAniListMedia, fetchArtworkResource, imageDimensions, parseAniListMedia, usefulArtwork, validateArtworkUrl } from '../server/artwork/source.ts';
import { artworkTestPng as png } from './helpers/artwork-image.ts';

const date = '2026-09-12T22:00:00.000Z';
const sourcePoster = 'https://cdn.anipixcdn.co/thumbnail/test-only.jpg';
const poster = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx42-TestOnly.png';
const banner = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/42-TestOnly.png';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const raw = () => ({ id: 42, idMal: 100, type: 'ANIME', format: 'TV', startDate: { year: 2026 }, title: { english: 'Test Title', romaji: 'Test Alias', native: null }, siteUrl: 'https://anilist.co/anime/42', coverImage: { extraLarge: poster }, bannerImage: banner });
const review = (): ArtworkReview => ({ titleId: 1, titleSource: 'anikoto', titleSourceId: 'test-art', mediaId: 42, malId: 100, releaseYear: 2026, format: 'TV', reviewedAt: date, evidence: { sourceUrl: 'https://anikototv.to/watch/test-art', metadataUrl: 'https://anilist.co/anime/42', sourceName: 'Test Title', metadataName: 'Test Title', sourceAlias: 'Test Alias', metadataAlias: 'Test Alias', sourcePosterSha256: 'a'.repeat(64), metadataPosterSha256: hash(png()), posterComparison: 'same-key-art-manually-reviewed', premiereDate: '2026-04-01', notes: 'Deterministic test fixture only; never a production catalogue record.' } });
const resource = (role: 'poster' | 'backdrop' = 'poster') => { const image = role === 'poster' ? png() : png(1900,400); return { role, url: role === 'poster' ? poster : banner, width: role === 'poster' ? 460 : 1900, height: role === 'poster' ? 650 : 400, format: 'png' as const, contentSha256: hash(image), verifiedAt: date, bytes: image.length }; };
const bundle = () => ({ version: 1, records: [{ review: review(), metadata: parseAniListMedia(raw(), 42), resources: [resource(),resource('backdrop')] }] });
const databases: DatabaseSync[] = [];
function database() { const db = new DatabaseSync(':memory:'); databases.push(db); migrate(db); db.prepare("INSERT INTO titles(id,source,source_id,slug,canonical_url,name,description,format,release_year,artwork_url,first_seen_at,last_seen_at,created_at,updated_at) VALUES(1,'anikoto','test-art','test-art','https://anikototv.to/watch/test-art','Test Title','Test synopsis','TV',2026,?,?,?,?,?)").run(sourcePoster,date,date,date,date); return db; }
afterEach(() => { vi.useRealTimers(); databases.splice(0).forEach(db => db.close()); });

describe('artwork source contract', () => {
  it('accepts only the metadata-returned image host, role and authoritative ID', () => {
    expect(validateArtworkUrl(poster,42,'poster')).toBe(poster);
    for (const value of ['http://127.0.0.1/a.jpg',poster.replace('s4.anilist.co','s4.anilist.co.evil.test'),poster+'?url=http://localhost',poster.replace('bx42','bx43'),poster.replace('https://','https://user:pass@')]) expect(() => validateArtworkUrl(value,42,'poster')).toThrow();
    expect(() => validateArtworkUrl(poster,42,'backdrop')).toThrow();
  });
  it('preserves genuinely missing banners and rejects identity/schema drift', () => {
    expect(parseAniListMedia({...raw(),bannerImage:null},42).backdropUrl).toBeNull();
    expect(() => parseAniListMedia({...raw(),id:43},42)).toThrow();
    expect(() => parseAniListMedia({...raw(),type:'MANGA'},42)).toThrow();
    expect(() => parseAniListMedia({...raw(),coverImage:{extraLarge:poster.replace('bx42','bx43')}},42)).toThrow();
  });
  it('requires measured dimensions, not the word extraLarge or a portrait stretched into a banner', () => {
    expect(imageDimensions(png())).toEqual({width:460,height:650,format:'png'});
    expect(usefulArtwork({width:230,height:307,format:'jpeg'},'poster')).toBe(false);
    expect(usefulArtwork({width:460,height:650,format:'jpeg'},'backdrop')).toBe(false);
    expect(usefulArtwork({width:1200,height:254,format:'jpeg'},'backdrop')).toBe(true);
  });
  it('uses normal documented ID requests and validates response MIME/body', async () => {
    const send = vi.fn<typeof fetch>(async (_input,init) => { expect(init?.redirect).toBe('manual'); expect(init?.headers).not.toHaveProperty('referer'); expect(JSON.parse(String(init?.body)).variables).toEqual({id:42}); return Response.json({data:{Media:raw()}}); });
    expect((await fetchAniListMedia(42,send)).id).toBe(42); expect(send).toHaveBeenCalledTimes(1);
    await expect(fetchAniListMedia(42,async()=>new Response('<html/>'))).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    await expect(fetchAniListMedia(42,async()=>Response.json({errors:[{message:'changed'}]}))).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('does not follow redirects, retry explicit refusals, or accept oversized/non-image resources', async () => {
    for (const status of [302,403,429]) { const send = vi.fn<typeof fetch>(async()=>new Response(null,{status,headers:{location:'https://example.invalid/','retry-after':'120'}})); await expect(fetchArtworkResource(banner,42,'backdrop',send)).rejects.toMatchObject({status}); expect(send).toHaveBeenCalledTimes(1); }
    await expect(fetchArtworkResource(banner,42,'backdrop',async()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}))).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    await expect(fetchArtworkResource(banner,42,'backdrop',async()=>new Response(png(),{headers:{'content-type':'image/png','content-length':'9000000'}}))).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    const measured = await fetchArtworkResource(banner,42,'backdrop',async()=>new Response(png(1900,400),{headers:{'content-type':'image/png'}})); expect(measured).toMatchObject({width:1900,height:400,contentSha256:hash(png(1900,400))});
  });
});

describe('reviewed local artwork storage and live catalogue wiring', () => {
  it('requires explicit composite review, not a name-only search result', () => {
    expect(validateArtworkReview(review()).mediaId).toBe(42);
    expect(() => validateArtworkReview({...review(),evidence:{...review().evidence,posterComparison:'not-reviewed'}})).toThrow();
    expect(() => validateArtworkReview({...review(),evidence:{...review().evidence,metadataAlias:'Different season'}})).toThrow();
    expect(() => validateArtworkBundle({...bundle(),records:[bundle().records[0],bundle().records[0]]})).toThrow();
  });
  it('adds real optional artwork to catalogue/details/related without changing imported IDs or the original image', () => {
    const db=database(); const before=db.prepare('SELECT * FROM titles').all();
    expect(applyArtworkBundle(db,bundle())).toMatchObject({reviewedRecords:1,resourceUpserts:2,sourceIdentifiersChanged:0,upstreamRequests:0});
    expect(db.prepare('SELECT * FROM titles').all()).toEqual(before);
    const title=browseTitles(db,{page:1,pageSize:20,sort:'updated'}).items[0];
    expect(title).toMatchObject({id:'1',sourceId:'test-art',imageUrl:sourcePoster,posterUrl:poster,backdropUrl:banner,artwork:{backdrop:{width:1900,height:400,reuseStatus:'reference-only',identityReview:'manual-reviewed'}}});
    expect(getTitle(db,'test-art').title.backdropUrl).toBe(banner);
    applyArtworkBundle(db,bundle()); expect(db.prepare('SELECT COUNT(*) AS count FROM artwork_matches').get()?.count).toBe(1); expect(db.prepare('SELECT COUNT(*) AS count FROM title_artwork').get()?.count).toBe(2);
  });
  it('keeps schema8 browsing available before the additive tables are installed', () => {
    const db=database(); db.exec('DROP TABLE artwork_jobs; DROP TABLE title_artwork; DROP TABLE artwork_matches; DROP TABLE artwork_source_policy;');
    expect(browseTitles(db,{page:1,pageSize:20,sort:'updated'}).items[0]).toMatchObject({imageUrl:sourcePoster,posterUrl:sourcePoster,backdropUrl:null});
  });
  it('never re-enables an operator-disabled match or retargets an authoritative identity', () => {
    const db=database(); applyArtworkBundle(db,bundle()); db.prepare("UPDATE artwork_matches SET review_status='disabled'").run();
    expect(()=>applyArtworkBundle(db,bundle())).toThrow('stays disabled');
    expect(browseTitles(db,{page:1,pageSize:20,sort:'updated'}).items[0].backdropUrl).toBeNull();
    expect(()=>approveLocalArtwork(db,{...review(),mediaId:43,evidence:{...review().evidence,metadataUrl:'https://anilist.co/anime/43'}})).toThrow('different reviewed mapping');
    expect(()=>approveLocalArtwork(db,{...review(),titleSourceId:'different'})).toThrow('existing catalogue identity');
  });
  it('hides malformed artwork/changed catalogue ownership and falls back for a genuinely absent banner', () => {
    const db=database(); applyArtworkBundle(db,bundle()); db.prepare("UPDATE title_artwork SET url='https://example.invalid/not-the-title' WHERE role='backdrop'").run();
    expect(getTitle(db,'test-art').title.backdropUrl).toBeNull();
    applyArtworkBundle(db,bundle()); db.prepare("UPDATE title_artwork SET last_error_code='IMAGE_ABSENT' WHERE role='backdrop'").run(); expect(getTitle(db,'test-art').title.backdropUrl).toBeNull();
    db.prepare("UPDATE titles SET source_id='changed-owner' WHERE id=1").run(); expect(getTitle(db,'test-art').title.posterUrl).toBe(sourcePoster);
  });
});

describe('durable artwork refresh phases', () => {
  it('resumes metadata→poster→backdrop without repeating completed requests or inventing a missing banner', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(date));
    const db=database(); approveLocalArtwork(db,review()); enqueueLocalArtwork(db); const requested:string[]=[];
    const send:typeof fetch=async(input)=>{requested.push(String(input));return String(input).includes('graphql')?Response.json({data:{Media:{...raw(),bannerImage:null}}}):new Response(png(),{headers:{'content-type':'image/png'}});};
    expect((await runLocalArtworkStep(db,{fetch:send})).status).toBe('checkpoint');
    vi.setSystemTime(new Date(Date.parse(date)+5000)); expect((await runLocalArtworkStep(db,{fetch:send})).status).toBe('checkpoint');
    vi.setSystemTime(new Date(Date.parse(date)+10000)); expect((await runLocalArtworkStep(db,{fetch:send})).status).toBe('completed');
    expect(requested).toEqual(['https://graphql.anilist.co/',poster]); expect(getTitle(db,'test-art').title.backdropUrl).toBeNull(); expect(getTitle(db,'test-art').title.posterUrl).toBe(poster);
    expect((await runLocalArtworkStep(db,{fetch:send})).status).toBe('idle');
  });
  it('retains good resources on a malformed import and preserves host refusal across retries', async () => {
    const db=database(); applyArtworkBundle(db,bundle()); enqueueLocalArtwork(db,0,100,true); const calls=vi.fn<typeof fetch>(async()=>new Response(null,{status:403}));
    expect((await runLocalArtworkStep(db,{fetch:calls})).status).toBe('blocked');
    const title=getTitle(db,'test-art').title; expect(title.backdropUrl).toBe(banner); expect(title.artwork).toMatchObject({backdrop:{freshness:'last-known-good'}});
    db.prepare("UPDATE artwork_jobs SET status='retry',available_at=?").run('2020-01-01T00:00:00Z');
    expect((await runLocalArtworkStep(db,{fetch:calls})).status).toBe('blocked'); expect(calls).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale worker after its lease was superseded without writing the response checkpoint', async () => {
    const db=database(); approveLocalArtwork(db,review()); enqueueLocalArtwork(db);
    const result=await runLocalArtworkStep(db,{fetch:async()=>{db.prepare("UPDATE artwork_jobs SET lease='replacement'").run();return Response.json({data:{Media:raw()}});}});
    expect(result.status).toBe('stale_lease'); expect(db.prepare('SELECT checkpoint_json FROM artwork_jobs').get()?.checkpoint_json).toBe('{}');
  });
});

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve(process.argv[2]);await fs.mkdir(out,{recursive:false});
const origins=['https://solanime.pages.dev','https://cloud-release.solanime.pages.dev'];
const cases=[
 {key:'remow-episode-1',slug:'b-project-netsuretsu-love-call-27sfl',titleSourceId:'6771',episodeSourceId:'104039',expectedVideoId:'_3Gcm-iGAQk'},
 {key:'gundam-episode-1',slug:'gundam-reconguista-in-g-lcjdy',titleSourceId:'5301',episodeSourceId:'82950',expectedVideoId:null},
];
const report={scope:'Read-only anonymous deployed-origin observation. Not a catalogue certification.',
 startedAt:new Date().toISOString(),browser:'Playwright Chromium',viewport:{width:1280,height:800},
 egressRegion:'not independently established',deployedCommit:'not established',health:[],cases:[]};
const clean=s=>String(s).replace(/https?:\/\/\S+/g,u=>u.split('?')[0]).slice(0,500);
async function getJson(url){
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 const contentType=r.headers.get('content-type');
 if(!r.ok||!contentType?.includes('json'))throw new Error(`HTTP ${r.status}; content-type ${contentType}`);
 return {status:r.status,data:await r.json()};
}
for(const origin of origins){
 try{const r=await getJson(origin+'/api/health');report.health.push({origin,...r});}
 catch(e){report.health.push({origin,error:clean(e.message)});}
}
const browser=await chromium.launch();
try{
 for(const c of cases){
  const origin=origins[1],result={...c,origin,livePlayback:'not_verified',errors:[],popups:0,apiResponses:[]};
  const context=await browser.newContext({viewport:report.viewport});const page=await context.newPage();
  page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(30000);
  page.on('console',m=>{if(m.type()==='error')result.errors.push(clean(m.text()));});
  page.on('pageerror',e=>result.errors.push(clean(e.message)));
  page.on('response',r=>{const u=new URL(r.url());if(u.origin===origin&&u.pathname.startsWith('/api/'))result.apiResponses.push({path:u.pathname,status:r.status()});});
  context.on('page',p=>{if(p!==page){result.popups++;p.close().catch(()=>{});}});
  try{
   const {data}=await getJson(origin+'/api/titles/'+c.slug);
   const title=data.title??data;
   const episodes=data.episodes??title.episodes??[];
   result.titleIdentity={name:title.name??title.title,sourceId:title.sourceId,slug:title.slug};
   result.apiShape={topKeys:Object.keys(data),titleKeys:Object.keys(title),episodeKeys:Object.keys(episodes[0]??{})};
   if(String(title.sourceId)!==c.titleSourceId)throw new Error('Current API title identity did not match the catalogue crosswalk');
   const e=episodes.find(e=>String(e.sourceId)===c.episodeSourceId);
   if(!e?.id)throw new Error('Exact episode source ID was absent from current API response');
   result.episodeId=e.id;
   await page.goto(`${origin}/watch/${c.slug}/${encodeURIComponent(e.id)}?language=sub`,{waitUntil:'domcontentloaded'});
   if(new URL(page.url()).origin!==origin)throw new Error('Unexpected parent-origin navigation');
   await page.locator('main').waitFor();
   const source=page.getByLabel('Playback source');await source.waitFor();
   let options=[],official=null;
   for(let attempt=0;attempt<40;attempt++){
     options=await source.locator('option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent,disabled:e.disabled})));
     official=options.find(o=>/youtube|remow|gundam|it's anime/i.test(o.text??'')&&!o.disabled);
     if(official)break;
     await page.waitForTimeout(500);
   }
   result.sourceOptions=options;
   if(!official)throw new Error('No selectable official YouTube source observed within the 20-second readiness window; inspect final UI/API state');
   await source.selectOption(official.value);result.selectedSource=official;
   const iframe=page.locator('iframe[src^="https://www.youtube-nocookie.com/embed/"]');await iframe.waitFor({timeout:20000});
   const src=await iframe.getAttribute('src');const u=new URL(src);result.videoId=u.pathname.split('/').pop();
   result.sandbox=await iframe.getAttribute('sandbox');
   if(c.expectedVideoId&&result.videoId!==c.expectedVideoId)throw new Error('Iframe video ID differs from the reviewed approval');
   result.approvalIdentityVerified=Boolean(c.expectedVideoId);
   const handle=await iframe.elementHandle();const frame=await handle.contentFrame();
   if(!frame)throw new Error('YouTube frame did not attach');
   const largePlay=frame.locator('.ytp-large-play-button');
   if(await largePlay.isVisible())await largePlay.click();else await frame.locator('.ytp-play-button').click();
   const video=frame.locator('video').first();await video.waitFor({timeout:20000});
   const sample=()=>frame.evaluate(()=>{
     const v=document.querySelector('video'),p=document.querySelector('#movie_player');
     return {time:v?.currentTime??null,duration:v?.duration??null,paused:v?.paused??null,
      readyState:v?.readyState??null,adShowing:Boolean(p?.classList.contains('ad-showing')||p?.classList.contains('ad-interrupting'))};
   });
   for(let i=0;i<15;i++){const s=await sample();if(!s.adShowing&&!s.paused&&s.time>0)break;await page.waitForTimeout(2000);}
   const before=await sample();await page.waitForTimeout(6000);const after=await sample();result.progression={before,after};
   if(before.adShowing||after.adShowing)throw new Error('Advertisement still present; episode progression not certified');
   if(!(after.time>before.time+2))throw new Error('No sustained episode progression observed');
   result.livePlayback='progression_observed';
   const bar=frame.locator('.ytp-progress-bar');
   const seekBefore=await sample();await bar.focus();for(let i=0;i<3;i++)await bar.press('ArrowRight');
   await page.waitForTimeout(1500);result.seek={before:seekBefore,after:await sample()};
   const cc=frame.locator('.ytp-subtitles-button');
   result.captions={controlPresent:await cc.isVisible(),renderedCueObserved:false};
   if(result.captions.controlPresent){
     if(await cc.getAttribute('aria-pressed')!=='true')await cc.click();
     await page.waitForTimeout(5000);
     result.captions.enabled=await cc.getAttribute('aria-pressed');
     result.captions.renderedCueObserved=await frame.locator('.caption-window').evaluateAll(es=>es.some(e=>e.getBoundingClientRect().height>0&&e.textContent?.trim()));
   }
   await page.screenshot({path:path.join(out,c.key+'-player.png'),fullPage:false});
   await frame.locator('.ytp-play-button').click();result.pause=await sample();
   const back=page.getByRole('link',{name:'Back to title',exact:true});await back.click();
   await page.waitForTimeout(1500);
   result.cleanup={iframeCount:await page.locator('iframe[src^="https://www.youtube-nocookie.com/embed/"]').count(),
     nativeVideoCount:await page.locator('video').count(),contextPages:context.pages().length,
     sameOrigin:new URL(page.url()).origin===origin};
  }catch(e){result.blocker=clean(e.message);}
  finally{
   result.youtubeFrameText=[];
   for(const f of page.frames()){if(f.url().startsWith('https://www.youtube-nocookie.com/embed/'))result.youtubeFrameText.push((await f.locator('body').innerText().catch(()=>'')).slice(0,2000));}
   result.finalUrl=page.url().split('?')[0];result.pageTitle=await page.title().catch(()=>'');
   result.finalBodyText=(await page.locator('body').innerText().catch(()=>'')).slice(0,6000);
   await page.screenshot({path:path.join(out,c.key+'-final.png'),fullPage:false}).catch(()=>{});
   await context.close();report.cases.push(result);
   await fs.writeFile(path.join(out,'deployed-playback.json'),JSON.stringify(report,null,2));
  }
 }
}finally{await browser.close();report.completedAt=new Date().toISOString();await fs.writeFile(path.join(out,'deployed-playback.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));

#!/usr/bin/env python3
"""Inspect explicitly linked public page/modules for selected high-value streaming entries."""
import argparse, concurrent.futures as cf, re, time, json
from urllib.parse import urlsplit
from pathlib import Path
from bs4 import BeautifulSoup
import collect as c
import enrich as e

PRIORITY=['pstream.cfd','zstream.mov','www.1shows.org','fireflix.pages.dev','anicine.xyz','cinejoy.to','www.movy.sx','aether.ist','streamwatch.online','cinemaos.live','www.rivestream.app','flixer.gd','hexa.su','popcornmovies.ac','cinefork.net','kdesa.stream','nepu.io','hydrahd.ws','www.miruro.com','hianime.to','animepahe.si','animesaturn.cx','nuvio.tv']

def deepen(record, fetcher, modules):
    prior={o.get('url') for o in record.get('observations',[]) if o.get('status')=='reachable'}
    refs=record.setdefault('references',[]);host=c.hostname(record.get('availability',{}).get('final_url') or record['url'])
    queue=list(dict.fromkeys(r['url'] for r in refs if c.hostname(r['url'])==host and r['url'] not in prior and r['kind'] in ('script','asset-link') and re.search(r'\.m?js(?:\?|$)',r['url'])))
    queue.sort(key=lambda u:(not any(s in u.lower() for s in ('player','provider','watch','source','api','app-')),any(s in u.lower() for s in ('vendor','polyfill','jquery','react'))))
    pages=list(dict.fromkeys(r['url'] for r in refs if r['kind']=='link' and c.hostname(r['url'])==host and re.search(r'/(watch|movie|tv|anime)/[^/]+',urlsplit(r['url']).path)))[:1]
    manifests=list(dict.fromkeys(r['url'] for r in refs if r['kind']=='manifest' and c.hostname(r['url'])==host))[:1]
    followed=[]
    for url in pages+manifests+queue[:modules]:
        if time.monotonic()>fetcher.deadline: break
        info,text=fetcher.get(url,'linked_module_or_public_detail_page');record.setdefault('observations',[]).append(info);followed.append({'url':url,'status':info.get('status')})
        if info.get('status')!='reachable' or not text: continue
        rr,ff=c.inspect_text(text,info.get('final_url',url))
        refs.extend(e.evidence_ref(r,url,info.get('observed_at')) for r in rr);record.setdefault('frameworks',[]).extend(ff)
    record['references']=list({(r['url'],r['kind'],r.get('evidence_url')):r for r in refs}.values())
    record['deeper_inspection']={'observed_at':c.now(),'requests':followed,'module_limit':modules,'available_linked_modules_not_inspected':max(0,len(queue)-modules),'public_detail_pages_selected':len(pages),'media_playback_attempted':False}
    return record

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',default='data-dump');p.add_argument('--seconds',type=int,default=180);p.add_argument('--modules',type=int,default=8);p.add_argument('--site');args=p.parse_args();root=Path(args.root)
    records=[e.load(x) for x in (root/'sites').glob('*/metadata.json')];fetcher=c.Fetcher(time.monotonic()+args.seconds)
    selected=[r for r in records if (c.hostname(r['url']) in PRIORITY and r.get('availability',{}).get('status')=='reachable') or r.get('availability',{}).get('status')=='queued']
    if args.site: selected=[r for r in records if args.site in (r['id'],r['url'],c.hostname(r['url']))]
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        jobs={pool.submit(c.scan,r,fetcher,1) if r.get('availability',{}).get('status')=='queued' else pool.submit(deepen,r,fetcher,args.modules):r for r in selected}
        for future in cf.as_completed(jobs):
            original=jobs[future]
            try: result=future.result();e.save_record(root,result)
            except Exception as exc:
                original['deeper_inspection']={'status':'unavailable','reason':type(exc).__name__};e.save_record(root,original)
    info,text=fetcher.get('https://fmhy.net/video','seed_coverage_crosscheck')
    comparison={'observation':info,'original_snapshot_retained':True}
    if info.get('status')=='reachable':
        current,resources=c.extract_listing(text,'https://fmhy.net/video');old=e.load(root/'indexes/discovered-resources.json',[]);soup=BeautifulSoup(text,'html.parser');article=soup.select_one('main .vp-doc') or soup.select_one('.vp-doc') or soup.find('main')
        no_http=[{'text':c.safe_text(li.get_text(' ',strip=True)),'research_status':'unexpanded_non_http_listing','source_url':'https://fmhy.net/video'} for li in article.find_all('li') if not any(c.normalize(a.get('href',''),'https://fmhy.net/video') for a in li.find_all('a',href=True))]
        annotations=[]
        for li in article.find_all('li'):
            labels=[]
            for element in li.find_all(True):
                for attribute in ('title','aria-label','alt'):
                    if element.get(attribute): labels.append({'attribute':attribute,'text':c.safe_text(str(element[attribute]))})
            if labels: annotations.append({'text':c.safe_text(li.get_text(' ',strip=True)),'labels':labels,'source_url':'https://fmhy.net/video','evidence_scope':'publisher_declared_annotation_not_runtime_verification'})
        comparison.update(current_parsed_entries=len(current),current_article_list_items=len(article.find_all('li')),non_http_list_items=len(no_http),current_resources=len(resources),new_urls_since_original=sorted(set(resources)-{r['url'] for r in old}),urls_not_in_current_source=sorted({r['url'] for r in old}-set(resources)))
        c.dump(root/'indexes/non-http-listing-items.json',no_http);c.dump(root/'sources/listing-annotations.json',annotations)
    c.dump(root/'reports/source-coverage-crosscheck.json',comparison)
    c.dump(root/'reports/deeper-inspection.json',{'observed_at':c.now(),'selected_resources':len(selected),'priority_hosts':PRIORITY,'scope':'explicitly linked public modules/manifests and up to one detail/watch document per selected site; no playback or authentication','seconds_budget':args.seconds})
    print(json.dumps({'selected_resources':len(selected),'source_crosscheck':comparison}),flush=True)
if __name__=='__main__': main()

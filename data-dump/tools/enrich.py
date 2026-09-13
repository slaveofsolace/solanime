#!/usr/bin/env python3
"""Resume public research; normalize evidence without turning references into playback claims."""
import argparse
import asyncio
import concurrent.futures as cf
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlsplit
import collect as c

DOCS = [
 'https://docs.pstream.cfd/connections',
 'https://docs.pstream.cfd/proxy/introduction',
 'https://docs.pstream.cfd/backend/introduction',
 'https://docs.pstream.cfd/backend/deploy',
 'https://docs.pstream.cfd/proxy/deploy',
 'https://docs.aiostreams.viren070.me/',
 'https://github.com/Viren070/AIOStreams',
 'https://github.com/cedya77/aiometadata',
 'https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md',
 'https://github.com/AniList/docs',
 'https://developer.themoviedb.org/docs/getting-started',
 'https://developer.themoviedb.org/docs/image-basics',
 'https://jellyfin.org/docs/general/networking/',
 'https://nuvio.wiki/',
]
REPO_PRIORITY = ['Viren070/AIOStreams','cedya77/aiometadata','Stremio/stremio-addon-sdk','AniList/docs','fmhy/edit']
PACKAGE_HINTS = {'react':'React','next':'Next.js','vue':'Vue','nuxt':'Nuxt','svelte':'Svelte','vite':'Vite',
 'express':'Express','fastify':'Fastify','hono':'Hono','redis':'Redis client','ioredis':'Redis client',
 'pg':'PostgreSQL client','better-sqlite3':'SQLite client','sqlite3':'SQLite client','prisma':'Prisma',
 'hls.js':'HLS.js','dashjs':'dash.js','video.js':'Video.js','plyr':'Plyr','socket.io':'Socket.IO','graphql':'GraphQL'}
HOSTING = [('cloudflare-pages','Cloudflare Pages','pages.dev'),('cloudflare-workers','Cloudflare Workers','workers.dev'),
 ('vercel','Vercel','vercel.app'),('netlify','Netlify','netlify.app'),('github-pages','GitHub Pages','github.io')]

def load(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default

def save_record(root, record): c.dump(root/'sites'/record['id']/'metadata.json',record)

def evidence_ref(ref, source, observed):
    ref.update(evidence_url=source,observed_at=observed,confidence='verified',verification_scope='public_source_reference_not_runtime_use')
    return ref

def log(event, **kwargs): print(json.dumps({'event':event,**kwargs}),flush=True)

def repository_pass(records, fetcher, maximum):
    candidates=set(REPO_PRIORITY)
    for record in records:
        for url in [record['url']]+[r['url'] for r in record.get('references',[])]:
            repo=c.repository(url)
            if repo: candidates.add(urlsplit(repo).path.strip('/'))
    ignored={'solutions','enterprise','features','resources','customer-stories','collections','events','readme','security','site','marketplace','sponsors','settings'}
    candidates=[r for r in candidates if r.split('/')[0] not in ignored]
    candidates.sort(key=lambda s:(s.lower() not in [r.lower() for r in REPO_PRIORITY],s.lower()))
    checks=[]
    for full_name in candidates[:maximum]:
        if time.monotonic()>fetcher.deadline: break
        url='https://api.github.com/repos/'+full_name
        info,body=fetcher.get(url,'public_repository_metadata')
        check={'requested_full_name':full_name,'source_url':url,'observation':info,'code_files_inspected':[],'private_data_requested':False}
        try: data=json.loads(body)
        except (ValueError,TypeError): data={}
        if info.get('http_status')==200 and data.get('private') is False and data.get('full_name'):
            check.update(status='verified_public_repository',full_name=data['full_name'],url=data['html_url'],default_branch=data['default_branch'],archived=data.get('archived'),fork=data.get('fork'),language=data.get('language'),description=data.get('description'),license_spdx=(data.get('license') or {}).get('spdx_id'),homepage=c.normalize(data.get('homepage') or ''),parent_repository=(data.get('parent') or {}).get('full_name'),last_pushed_at=data.get('pushed_at'))
            for filename in ('README.md','package.json'):
                raw='https://raw.githubusercontent.com/'+data['full_name']+'/'+data['default_branch']+'/'+filename
                ri,text=fetcher.get(raw,'public_repository_readme_or_package')
                file_note={'path':filename,'source_url':raw,'observation':ri,'declared_dependencies':[],'references':[]}
                if ri.get('status')=='reachable' and text:
                    refs,_=c.inspect_text(text,raw)
                    file_note['references']=[evidence_ref(r,raw,ri.get('observed_at')) for r in refs]
                    if filename=='package.json':
                        try:
                            package=json.loads(text)
                            for bucket in ('dependencies','devDependencies','peerDependencies','optionalDependencies'):
                                for name,version in (package.get(bucket) or {}).items():
                                    if isinstance(version,str) and version.startswith(('http:','https:')): version=c.normalize(version) or '[REDACTED-URL]'
                                    file_note['declared_dependencies'].append({'name':name,'version_specification':version,'scope':bucket,'recognized_role':PACKAGE_HINTS.get(name),'confidence':'verified','verification_scope':'repository_dependency_declaration_not_live_server'})
                        except ValueError: file_note['parse_error']='invalid_json'
                check['code_files_inspected'].append(file_note)
        else:
            check['status']='unverified_repository_candidate'
            if info.get('http_status') in (403,429):
                checks.append(check);log('repository_rate_or_access_limit',checked=len(checks));break
        checks.append(check)
        if len(checks)%10==0: log('repository_checks',checked=len(checks))
    return checks

async def browser_pass(records, root, maximum=16):
    """Read-only, bounded homepage network observation, not player or bypass testing."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return [{'status':'unavailable','reason':'playwright_not_installed'}]
    selected=[r for r in records if r.get('availability',{}).get('status')=='reachable' and 'primary' in r.get('roles',[]) and any(any(term in category.lower() for term in ('stream','anime','server')) for chain in r.get('categories',[]) for category in chain) and c.hostname(r['url']) not in ('github.com','www.youtube.com','youtube.com')]
    groups=defaultdict(list)
    for record in selected: groups[' / '.join(record.get('categories',[['other']])[0])].append(record)
    selected=[]
    while groups and len(selected)<maximum:
        for category in list(groups):
            selected.append(groups[category].pop(0))
            if not groups[category]: del groups[category]
            if len(selected)>=maximum: break
    outputs=[];policy=c.Fetcher(time.monotonic()+210)
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True)
        semaphore=asyncio.Semaphore(3)
        async def visit(record):
            async with semaphore:
                if time.monotonic()>policy.deadline: return
                output={'site_id':record['id'],'url':record['url'],'observed_at':c.now(),'scope':'homepage_only_no_media_activation','request_policy':'GET only; robots and public DNS; binary media/fonts blocked; service workers disabled; new ephemeral context; no account data','requests':[],'websocket_references':[],'popup_attempts':0,'status':'inspected'}
                context=await browser.new_context(accept_downloads=False,service_workers='block',viewport={'width':1280,'height':800},user_agent='Mozilla/5.0 SolanimePublicResearch/1.0 Chromium (public read-only inventory)')
                page=await context.new_page();locks=defaultdict(asyncio.Lock);last={};counter=0
                async def route_handler(route):
                    nonlocal counter
                    req=route.request;url=c.normalize(req.url);counter+=1
                    item={'url':url,'method':req.method,'resource_type':req.resource_type,'initiator_frame_url':None,'decision':'blocked'}
                    try: item['initiator_frame_url']=c.normalize(req.frame.url)
                    except Exception: pass
                    reason=None
                    if not url or urlsplit(url).scheme not in ('http','https'): reason='unsupported_url'
                    elif req.method!='GET': reason='non_get_not_sent'
                    elif counter>65 or time.monotonic()>policy.deadline: reason='bounded_request_budget'
                    elif req.resource_type in ('media','font') or c.MEDIA.search(url): reason='binary_resource_not_downloaded'
                    elif '%5BREDACTED' in url or '[REDACTED' in url: reason='credential_or_opaque_url_redacted'
                    elif re.search(r'(?i)/(?:delete|destroy|logout|signout|unsubscribe|admin|wp-admin)(?:/|$)',urlsplit(url).path): reason='potentially_mutating_or_admin_route'
                    if reason is None:
                        host=c.hostname(url)
                        allowed,_=await asyncio.to_thread(c.public_address,host)
                        if not allowed: reason='dns_failure_or_nonpublic_address'
                        else:
                            permitted,_=await asyncio.to_thread(policy.permitted,url)
                            if not permitted: reason='robots_disallow_or_unavailable'
                    if reason is None:
                        async with locks[host]:
                            delay=max(1,policy.host_delay[host])-(time.monotonic()-last.get(host,0))
                            if delay>0: await asyncio.sleep(delay)
                            last[host]=time.monotonic()
                        item['decision']='sent'
                    else: item['reason']=reason
                    output['requests'].append(item)
                    try:
                        if reason: await route.abort()
                        else: await route.continue_()
                    except Exception: pass
                async def ws_handler(route):
                    output['websocket_references'].append({'url':c.normalize(route.url),'decision':'connection_not_opened','scope':'attempted_websocket_reference_only'})
                    await route.close()
                async def popup_handler(popup):
                    output['popup_attempts']+=1
                    await popup.close()
                async def response_handler(response):
                    url=c.normalize(response.url)
                    for item in reversed(output['requests']):
                        if item.get('url')==url and item['decision']=='sent':
                            item['http_status']=response.status
                            item['content_type']=response.headers.get('content-type')
                            break
                await context.route('**/*',route_handler)
                await context.route_web_socket('**/*',ws_handler)
                page.on('popup',popup_handler);page.on('response',response_handler)
                try:
                    await page.goto(record['url'],wait_until='domcontentloaded',timeout=22000)
                    await page.wait_for_timeout(3500)
                    output['final_url']=c.normalize(page.url)
                    output['title']=await page.title()
                    output['visible_frame_origins']=sorted(set(c.hostname(frame.url) for frame in page.frames if frame.url.startswith(('https:','http:'))))
                except Exception as exc:
                    output['status']='partial';output['reason']=type(exc).__name__
                finally:
                    try: await context.close()
                    except Exception: pass
                outputs.append(output);record['browser_observation']=output
                for item in output['requests']:
                    if not item['url']: continue
                    kind='browser-request-sent' if item['decision']=='sent' else 'browser-request-attempted-not-sent'
                    record.setdefault('references',[]).append({'url':item['url'],'kind':kind,'evidence_url':record['url'],'observed_at':output['observed_at'],'confidence':'verified','verification_scope':kind,'http_status':item.get('http_status'),'resource_type':item['resource_type'],'policy_reason':item.get('reason')})
                for item in output['websocket_references']:
                    if item['url']: record.setdefault('references',[]).append({'url':item['url'],'kind':'websocket-attempted-not-connected','evidence_url':record['url'],'observed_at':output['observed_at'],'confidence':'verified','verification_scope':'attempt_only'})
                save_record(root,record);log('browser_homepage_observed',site_id=record['id'],requests=len(output['requests']),status=output['status'])
        results=await asyncio.gather(*(visit(r) for r in selected),return_exceptions=True)
        for record,result in zip(selected,results):
            if isinstance(result,Exception): outputs.append({'site_id':record['id'],'url':record['url'],'status':'unavailable','reason':type(result).__name__,'scope':'browser_collector_error'})
        await browser.close()
    return outputs

def finalize(root, entries, records, fetcher, repo_checks, browser_observations):
    old_domains=load(root/'indexes/domains.json',[])
    for d in old_domains:
        if d.get('dns'): fetcher.dns.setdefault(d['hostname'],d['dns'])
    seed=load(root/'sources/seed-manifest.json',{})
    base=c.build(root,entries,records,fetcher,seed)
    providers={r['id']:r for r in load(root/'indexes/providers.json',[])}
    edges=load(root/'indexes/relationships.json',[])
    repository_records=load(root/'indexes/repositories.json',[])
    domains=load(root/'indexes/domains.json',[])
    by_repo={c.normalize(x.get('url','')).lower():x for x in repo_checks if x.get('url') and c.normalize(x.get('url',''))}
    for repo in repository_records:
        checked=by_repo.get(repo['url'].lower())
        if checked:
            repo.update(status=checked['status'],license=checked.get('license_spdx') or 'unknown',source_code_inspected=any(f.get('path')=='package.json' and f.get('observation',{}).get('status')=='reachable' for f in checked['code_files_inspected']),repository_metadata=checked)
    groups=defaultdict(set);asset_groups=defaultdict(set);api_groups=defaultdict(set);ip_groups=defaultdict(set)
    redirects=[];listed_groups=[]
    for entry in entries:
        urls=list(dict.fromkeys(l['url'] for l in entry['links'] if l.get('role')!='internal-section'))
        if len(urls)>1: listed_groups.append({'entry_id':entry['id'],'urls':urls,'labels':[l['label'] for l in entry['links']],'relationship':'co-listed_resources','confidence':'verified','verification_scope':'FMHY_grouping_only_not_mirror_or_shared_backend','source_url':entry['source_url']})
    def add_provider(record,pid,name,category,evidence,kind='hosting-domain-indicator'):
        providers.setdefault(pid,{'id':pid,'name':name,'category':category,'identity_scope':'domain_or_header_indicator_not_operator_identity'})
        record.setdefault('provider_ids',[])
        if pid not in record['provider_ids']: record['provider_ids'].append(pid)
        edges.append({'id':c.uid('rel',record['id']+'|'+pid+'|'+kind+'|'+evidence),'source':record['id'],'target':pid,'type':kind,'source_url':evidence,'observed_at':record.get('observed_at',seed.get('observed_at')),'confidence':'verified','verification_scope':'observed_declaration_or_network_indicator'})
    for record in records:
        final=record.get('availability',{}).get('final_url') or record['url'];host=c.hostname(final)
        for slug,name,suffix in HOSTING:
            if host==suffix or host.endswith('.'+suffix): add_provider(record,'provider-'+slug,name,'hosting-platform',final)
        server=record.get('availability',{}).get('headers',{}).get('server','')
        if 'cloudflare' in server.lower(): add_provider(record,'provider-cloudflare-edge','Cloudflare edge','edge-cdn',final,'server-header-indicator')
        if 'vercel' in server.lower(): add_provider(record,'provider-vercel','Vercel','hosting-platform',final,'server-header-indicator')
        for ref in record.get('references',[]):
            h=c.hostname(ref['url'])
            if not h: continue
            if ref['kind']=='embed': add_provider(record,'provider-embed-'+c.uid('host',h),h,'embed-origin-unidentified',ref['evidence_url'],'declares-iframe-origin')
            if ref['kind'] in ('client-endpoint-reference','browser-request-sent') or h.startswith(('api.','graphql.')):
                api_groups[h].add(record['id'])
        for obs in record.get('observations',[]):
            if obs.get('sha256') and not obs.get('truncated') and re.search(r'\.m?js(?:\?|$)',obs.get('url','')):
                asset_groups[obs['sha256']].add(record['id'])
        if record.get('availability',{}).get('redirects'):
            redirects.append({'site_id':record['id'],'initial_url':record['url'],'final_url':record['availability'].get('final_url'),'hops':record['availability']['redirects'],'final_status':record['availability'].get('status'),'observed_at':record.get('observed_at'),'interpretation':'Observed HTTP redirection; permanence, common ownership and replacement status not inferred.'})
        for pid in record.get('provider_ids',[]): groups[pid].add(record['id'])
        save_record(root,record)
    for d in domains:
        for address in (d.get('dns') or {}).get('addresses',[]): ip_groups[address].add(d['hostname'])
    edges=list({e['id']:e for e in edges}.values())
    c.dump(root/'indexes/providers.json',list(providers.values()));c.dump(root/'indexes/relationships.json',edges);c.dump(root/'indexes/repositories.json',repository_records)
    sites=load(root/'indexes/sites.json',[]);by_id={r['id']:r for r in records}
    for site in sites: site['provider_ids']=by_id[site['id']].get('provider_ids',[])
    c.dump(root/'indexes/sites.json',sites)
    cluster_data={
      'providers':[{'provider_id':pid,'site_ids':sorted(ids),'resource_count':len(ids)} for pid,ids in sorted(groups.items(),key=lambda x:-len(x[1]))],
      'shared_api_host_references':[{'hostname':h,'site_ids':sorted(ids),'verification_scope':'shared_public_reference_not_proven_shared_live_backend'} for h,ids in api_groups.items() if len(ids)>1],
      'identical_client_asset_hashes':[{'sha256':h,'site_ids':sorted(ids),'verification_scope':'identical_downloaded_JS_bytes_not_proof_of_shared_backend_or_ownership'} for h,ids in asset_groups.items() if len(ids)>1],
      'shared_resolved_ips':[{'ip':ip,'hostnames':sorted(hosts),'verification_scope':'shared_resolved_address_only_CDN_or_shared_hosting_possible'} for ip,hosts in ip_groups.items() if len(hosts)>1]}
    c.dump(root/'indexes/clusters.json',cluster_data);c.dump(root/'indexes/listed-relationships.json',listed_groups);c.dump(root/'indexes/redirects.json',redirects)
    c.dump(root/'repositories/public-checks.json',repo_checks);c.dump(root/'reports/browser-observations.json',browser_observations)
    direct_ids={r['id'] for r in load(root/'indexes/discovered-resources.json',[])}
    direct=[r for r in records if r['id'] in direct_ids]
    counts=Counter(r.get('availability',{}).get('status','discovered') for r in direct)
    base.update(distinct_linked_resources=len(direct),supplemental_resources=len(records)-len(direct),resource_status_counts=dict(counts),resources_http_reachable=counts['reachable'],providers_identified_by_domain_reference=len(providers),relationships=len(edges),repository_candidates=len(repository_records),repositories_confirmed_public=sum(r['status']=='verified_public_repository' for r in repository_records),repository_metadata_requests=len(repo_checks),repository_package_files_read=sum(f['path']=='package.json' and f['observation'].get('status')=='reachable' for r in repo_checks for f in r.get('code_files_inspected',[])),browser_homepages_inspected=len([b for b in browser_observations if b.get('site_id') and b.get('scope')!='browser_collector_error']),browser_scope='bounded homepages only; no video activation; no playback certification',observed_redirect_chains=len(redirects),shared_api_host_reference_groups=len(cluster_data['shared_api_host_references']),identical_javascript_groups=len(cluster_data['identical_client_asset_hashes']),completed_entries=0,confirmed_dead_services=0)
    base['snapshot_at']=c.now();base['completeness']='All parsed listing occurrences retained; bounded static, repository and homepage-network research. End-to-end playback chains remain incomplete.'
    c.dump(root/'SUMMARY.json',base)
    (root/'SUMMARY.md').write_text('# FMHY Video research snapshot\n\n```json\n'+json.dumps(base,indent=2)+'\n```\n\nResource counts represent distinct linked URLs, not independent streaming services. Provider counts include metadata, hosting, analytics and asset services. Endpoint counts are references, not tested APIs. Complete entry count remains zero because per-entry runtime media paths and recursive dependencies have not all been established.\n')
    ranking='# Shared infrastructure findings\n\nCounts below are distinct resource records, not certified independent sites or active playback integrations.\n\n| Provider / infrastructure | Referencing resources | Category |\n|---|---:|---|\n'
    for row in cluster_data['providers'][:50]:
        provider=providers[row['provider_id']];ranking+='| '+provider['name']+' | '+str(row['resource_count'])+' | '+provider['category']+' |\n'
    ranking+='\n## Other clusters\n\n'+str(len(cluster_data['shared_api_host_references']))+' shared API-host reference groups; '+str(len(cluster_data['identical_client_asset_hashes']))+' identical JavaScript hash groups; '+str(len(cluster_data['shared_resolved_ips']))+' shared resolved-IP groups. Exact membership and caveats are in indexes/clusters.json. Shared hosting or identical libraries are not evidence of a common operator or backend.\n'
    (root/'reports/shared-infrastructure.md').write_text(ranking)
    statuses=Counter(r.get('availability',{}).get('reason','none') for r in direct if r.get('availability',{}).get('status')!='reachable')
    status_report='# Availability, redirects and unresolved entries\n\n'+str(len(redirects))+' redirect chains were observed; see indexes/redirects.json. No service is conclusively labeled dead or replaced solely from a request failure.\n\n| Unresolved reason | Resource count |\n|---|---:|\n'
    for reason,count in statuses.most_common(): status_report+='| '+str(reason)+' | '+str(count)+' |\n'
    status_report+='\nAll resources remain in reports/unresolved.json. A successful response can be a shell, landing page or challenge not detected by the heuristic. A single 403/404/timeout is not a service-wide availability judgment.\n'
    (root/'reports/dead-and-replaced-services.md').write_text(status_report)
    return base

def validate(root):
    entries=load(root/'indexes/entries.json',[]);coverage=load(root/'indexes/coverage.json',[])
    kinds=['sites','domains','providers','repositories','endpoints'];all_ids=set();checks={}
    for kind in kinds:
        rows=load(root/'indexes'/f'{kind}.json',[]);ids=[r['id'] for r in rows]
        checks[kind+'_ids_unique']=len(ids)==len(set(ids));all_ids.update(ids)
    edges=load(root/'indexes/relationships.json',[])
    checks['entry_coverage_exact']={e['id'] for e in entries}=={e['entry_id'] for e in coverage}
    checks['relationship_targets_exist']=all(e['source'] in all_ids and e['target'] in all_ids for e in edges)
    checks['no_false_completion']=all(e.get('complete') is False for e in coverage)
    checks['all_json_parseable']=True
    try:
        for path in root.rglob('*.json'): json.loads(path.read_text())
    except (ValueError,UnicodeError): checks['all_json_parseable']=False
    result={'observed_at':c.now(),'checks':checks,'passed':all(checks.values()),'evidence_scope':'data_integrity_not_live_playback','entries':len(entries),'relationships':len(edges)}
    c.dump(root/'reports/validation.json',result)
    if not result['passed']: raise RuntimeError('Dataset validation failed: '+json.dumps(result))
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',default='data-dump');parser.add_argument('--seconds',type=int,default=600);parser.add_argument('--repositories',type=int,default=35);parser.add_argument('--browser-sites',type=int,default=16);parser.add_argument('--offline',action='store_true');args=parser.parse_args()
    root=Path(args.root);entries=load(root/'indexes/entries.json');records=[load(p) for p in (root/'sites').glob('*/metadata.json')]
    if not entries or not records: raise RuntimeError('Initial inventory required before enrichment')
    fetcher=c.Fetcher(time.monotonic()+args.seconds)
    repo_checks=load(root/'repositories/public-checks.json',[]);browser_observations=load(root/'reports/browser-observations.json',[])
    if not args.offline:
        pending=[r for r in records if r.get('availability',{}).get('status',r.get('research_status')) in ('queued','discovered')]
        log('resume_inventory',pending=len(pending),total=len(records))
        resume_fetcher=c.Fetcher(time.monotonic()+max(40,args.seconds-210))
        with cf.ThreadPoolExecutor(max_workers=12) as pool:
            jobs={pool.submit(c.scan,r,resume_fetcher,1):r for r in pending}
            replacement={}
            for future in cf.as_completed(jobs):
                original=jobs[future]
                try: record=future.result()
                except Exception as exc: record={**original,'availability':{'status':'unavailable','reason':type(exc).__name__},'research_status':'unavailable'}
                replacement[record['id']]=record;save_record(root,record)
                if len(replacement)%100==0: log('resume_progress',processed=len(replacement),total=len(pending))
        records=[replacement.get(r['id'],r) for r in records];fetcher.dns.update(resume_fetcher.dns)
        by_url={r['url']:r for r in records}
        for url in DOCS:
            url=c.normalize(url)
            if url in by_url: continue
            record={'id':c.uid('site',url),'name':c.hostname(url)+urlsplit(url).path,'url':url,'entry_ids':[],'roles':['architecture_doc'],'categories':[['Supplemental primary documentation']],'research_status':'discovered','discovery_basis':'public documentation for an FMHY-listed service or protocol'}
            record=c.scan(record,fetcher,0);records.append(record);by_url[url]=record
        repo_checks=repository_pass(records,fetcher,args.repositories)
        c.dump(root/'repositories/public-checks.json',repo_checks)
        for check in repo_checks:
            repo_url=c.normalize(check.get('url') or 'https://github.com/'+check['requested_full_name'])
            related=[r for r in records if c.repository(r['url']) and c.repository(r['url']).lower()==repo_url.lower()]
            if not related and check.get('status')=='verified_public_repository':
                record={'id':c.uid('site',repo_url),'name':check['full_name'],'url':repo_url,'entry_ids':[],'roles':['supplemental_repository'],'categories':[['Supplemental public repository']],'research_status':'repository_checked','availability':check['observation'],'references':[],'observed_at':c.now()}
                records.append(record);related=[record]
            for record in related:
                record['repository_inspection']=check
                for file in check.get('code_files_inspected',[]): record.setdefault('references',[]).extend(file['references'])
                save_record(root,record)
        if args.browser_sites>0:
            try: browser_observations=asyncio.run(browser_pass(records,root,args.browser_sites))
            except Exception as exc: browser_observations=[{'status':'unavailable','reason':type(exc).__name__,'scope':'browser_collector_error'}]
    summary=finalize(root,entries,records,fetcher,repo_checks,browser_observations)
    result=validate(root)
    log('enrichment_complete',summary=summary,validation=result)
if __name__=='__main__': main()

#!/usr/bin/env python3
"""Public FMHY architecture inventory; GET/DNS only; no login, media downloads or circumvention."""
import argparse, concurrent.futures as cf, hashlib, ipaddress, json, re, socket, threading, time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser
import requests
from bs4 import BeautifulSoup

UA = 'SolanimePublicResearch/1.0 (public read-only architecture inventory)'
SECRET = re.compile(r'(?i)(token|secret|password|passwd|authorization|cookie|session|signature|api[_-]?key|access[_-]?key|credential|^sig$|^key$|^auth$|^jwt$|nonce|csrf|^state$|ticket|challenge|clearance)')
URL_RE = re.compile(r'''(?:https?|wss?)://[^\s<>"'`\\)\]}]+''')
MEDIA = re.compile(r'(?i)\.(mp4|mkv|webm|mp3|aac|ts|m4s|avi|mov|flac|zip|exe|dmg|apk|pdf|woff2?|ttf|otf|png|jpe?g|gif|webp|svg)(?:$|\?)')
KNOWN = [
 ('tmdb','TMDB','metadata',['themoviedb.org','tmdb.org']),
 ('anilist','AniList','metadata',['anilist.co']),
 ('myanimelist','MyAnimeList','metadata',['myanimelist.net']),
 ('jikan','Jikan','metadata-api',['jikan.moe']),
 ('kitsu','Kitsu','metadata',['kitsu.io','kitsu.app']),
 ('opensubtitles','OpenSubtitles','subtitles',['opensubtitles.com','opensubtitles.org']),
 ('google-fonts','Google Fonts','fonts',['fonts.googleapis.com','fonts.gstatic.com']),
 ('google-analytics','Google Analytics/Tag Manager','analytics',['google-analytics.com','googletagmanager.com']),
 ('google-ads','Google advertising','advertising',['doubleclick.net','googlesyndication.com','googleadservices.com']),
 ('cloudflare-insights','Cloudflare Insights','analytics',['cloudflareinsights.com']),
 ('cloudflare-challenge','Cloudflare challenge/Turnstile','anti-bot',['challenges.cloudflare.com']),
 ('jsdelivr','jsDelivr','asset-cdn',['jsdelivr.net']),
 ('unpkg','UNPKG','asset-cdn',['unpkg.com']),
 ('sentry','Sentry','observability',['sentry.io']),
 ('supabase','Supabase','backend-platform',['supabase.co','supabase.in']),
 ('firebase','Firebase','backend-platform',['firebaseio.com','firebaseapp.com','firebasestorage.googleapis.com','firestore.googleapis.com']),
 ('clerk','Clerk','authentication',['clerk.accounts.dev','clerk.com']),
 ('auth0','Auth0','authentication',['auth0.com']),
 ('vidlink','VidLink','embed-provider',['vidlink.pro']),
 ('vidfast','VidFast','embed-provider',['vidfast.pro']),
 ('videasy','Videasy','embed-provider',['videasy.net']),
 ('multiembed','MultiEmbed','embed-provider',['multiembed.mov']),
 ('embed-su','Embed.su','embed-provider',['embed.su']),
 ('streamtape','Streamtape','video-host',['streamtape.com','streamtape.to']),
 ('filemoon','Filemoon','video-host',['filemoon.sx','filemoon.to']),
 ('mixdrop','Mixdrop','video-host',['mixdrop.co','mixdrop.to']),
 ('voe','VOE','video-host',['voe.sx']),
 ('dailymotion','Dailymotion','video-platform',['dailymotion.com','dmcdn.net']),
 ('youtube','YouTube','video-platform',['youtube.com','youtube-nocookie.com','ytimg.com','googlevideo.com']),
 ('vimeo','Vimeo','video-platform',['vimeo.com','vimeocdn.com']),
 ('internet-archive','Internet Archive','archive',['archive.org']),
]
def now(): return datetime.now(timezone.utc).isoformat()
def uid(prefix,value): return prefix+'-'+hashlib.sha256(value.encode()).hexdigest()[:16]
def hostname(url): return urlsplit(url).hostname or ''
def normalize(url,base=None):
    try:
        p=urlsplit(urljoin(base or '',url.strip()))
        if p.scheme not in ('http','https','ws','wss') or not p.hostname or p.username or p.password: return None
        if p.port and p.port not in (80,443): return None
        host=p.hostname.encode('idna').decode().lower()
        if ':' in host: host='['+host+']'
        port=':'+str(p.port) if p.port and (p.scheme,p.port) not in [('http',80),('https',443)] else ''
        query=[(k,'[REDACTED]' if SECRET.search(k) else v) for k,v in parse_qsl(p.query,keep_blank_values=True) if not k.lower().startswith('utm_')]
        path=re.sub(r'(?<![A-Za-z0-9])[A-Za-z0-9_=-]{80,}','[REDACTED-OPAQUE]',p.path or '/')
        return urlunsplit((p.scheme,host+port,path,urlencode(query,doseq=True),''))
    except (ValueError,UnicodeError): return None

def public_address(host):
    try:
        addresses=sorted({row[4][0] for row in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)})
        return bool(addresses) and all(ipaddress.ip_address(a).is_global for a in addresses),addresses
    except (OSError,ValueError): return False,[]

def safe_text(text):
    return re.sub(r'(?i)(\b(?:PW|password|invite codes?)\s*:)[^/\n]*',r'\1 [REDACTED]',text)

def dump(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2,sort_keys=True)+'\n',encoding='utf-8')

class Fetcher:
    def __init__(self,deadline,delay=1.0,maximum=1250000):
        self.deadline,self.delay,self.maximum=deadline,delay,maximum
        self.locks=defaultdict(threading.RLock);self.robot_locks=defaultdict(threading.RLock)
        self.last=defaultdict(float);self.robots={};self.dns={};self.cache={};self.blocked_hosts=set()
        self.host_delay=defaultdict(lambda:delay)
    def permitted(self,url):
        p=urlsplit(url);origin=urlunsplit((p.scheme,p.netloc,'','',''))
        with self.robot_locks[origin]:
            if origin not in self.robots:
                info,text=self.raw(origin+'/robots.txt',False)
                parser=RobotFileParser();parser.set_url(origin+'/robots.txt')
                if info.get('http_status')==200:
                    parser.parse(text.splitlines());self.robots[origin]=(parser,info)
                    cd=parser.crawl_delay(UA) or parser.crawl_delay('*')
                    rate=parser.request_rate(UA) or parser.request_rate('*')
                    self.host_delay[p.hostname]=max(self.delay,float(cd or 0),float(rate.seconds/rate.requests) if rate else 0)
                elif info.get('http_status') in (404,410): self.robots[origin]=(None,info)
                else: self.robots[origin]=(False,info)
            parser,info=self.robots[origin]
            return parser is None or (parser is not False and parser.can_fetch(UA,url)),info
    def raw(self,url,check_redirect_robots=True):
        chain=[]
        for _ in range(9):
            if time.monotonic()>self.deadline: return {'status':'queued','reason':'run_budget_exhausted','redirects':chain},''
            if chain and check_redirect_robots and not self.permitted(url)[0]:
                return {'status':'blocked','reason':'redirect_target_robots_disallow_or_unavailable','redirects':chain,'final_url':url},''
            host=hostname(url);allowed,addresses=public_address(host)
            self.dns.setdefault(host,{'hostname':host,'addresses':addresses,'observed_at':now(),'evidence_type':'system_dns_resolution'})
            if not allowed: return {'status':'unavailable','reason':'dns_failure_or_nonpublic_address','redirects':chain,'final_url':url},''
            with self.locks[host]:
                wait=self.host_delay[host]-(time.monotonic()-self.last[host])
                if time.monotonic()+max(wait,0)>self.deadline: return {'status':'queued','reason':'run_budget_exhausted','redirects':chain},''
                if wait>0: time.sleep(wait)
                self.last[host]=time.monotonic()
                try:
                    with requests.Session() as session:
                        session.trust_env=False
                        with session.get(url,headers={'User-Agent':UA,'Accept':'text/html,application/json,text/plain;q=0.9,*/*;q=0.1'},timeout=(5,10),allow_redirects=False,stream=True) as response:
                            code=response.status_code
                            headers={k.lower():re.sub(r"nonce-[^' ]+",'nonce-[REDACTED]',v) for k,v in response.headers.items() if k.lower() in ['server','content-type','x-powered-by','via','x-cache','cf-cache-status','x-frame-options','access-control-allow-origin']}
                            if code in (301,302,303,307,308):
                                target=normalize(response.headers.get('Location',''),url)
                                chain.append({'url':url,'http_status':code,'location':target})
                                if not target or '[REDACTED' in target or '%5BREDACTED' in target or MEDIA.search(target):
                                    return {'status':'redirected','reason':'redirect_target_not_requested','redirects':chain,'final_url':target},''
                                url=target;continue
                            ct=response.headers.get('Content-Type','').lower()
                            info={'http_status':code,'headers':headers,'final_url':url,'redirects':chain,'content_type':ct}
                            if code in (401,403,429):
                                if code==429: self.blocked_hosts.add(host)
                                return {**info,'status':'blocked','reason':'http_'+str(code)},''
                            if code>=400: return {**info,'status':'unavailable','reason':'http_'+str(code)},''
                            if code>=300: return {**info,'status':'degraded','reason':'unexpected_http_'+str(code)},''
                            if not any(x in ct for x in ('text/','json','javascript','xml')): return {**info,'status':'reachable','reason':'nontext_body_not_downloaded'},''
                            chunks=[];size=0;truncated=False
                            for chunk in response.iter_content(32768):
                                if time.monotonic()>self.deadline: truncated=True;break
                                if size+len(chunk)>self.maximum:
                                    chunks.append(chunk[:self.maximum-size]);truncated=True;break
                                chunks.append(chunk);size+=len(chunk)
                            body=b''.join(chunks);text=body.decode(response.encoding or 'utf-8',errors='replace')
                            info.update(status='reachable',sha256=hashlib.sha256(body).hexdigest(),bytes_read=len(body),truncated=truncated,hash_scope='bounded_response_body' if truncated else 'response_body')
                            if re.search(r'(?i)<title>\s*(?:just a moment|attention required|access denied)',text): info.update(status='blocked',reason='challenge_document')
                            return info,text
                except requests.RequestException as exc: return {'status':'unavailable','reason':type(exc).__name__,'redirects':chain,'final_url':url},''
        return {'status':'degraded','reason':'redirect_limit','redirects':chain},''
    def get(self,url,kind='page'):
        url=normalize(url)
        if not url or urlsplit(url).scheme not in ('http','https'): return {'url':url,'status':'excluded','reason':'unsupported_url'},''
        if '[REDACTED' in url or '%5BREDACTED' in url: return {'url':url,'status':'excluded','reason':'credential_or_opaque_url_redacted'},''
        if MEDIA.search(url): return {'url':url,'status':'excluded','reason':'nontext_or_media_resource'},''
        if re.search(r'(?i)/(?:delete|destroy|logout|signout|unsubscribe|admin|wp-admin)(?:/|$)',urlsplit(url).path):
            return {'url':url,'status':'excluded','reason':'potentially_mutating_or_admin_route'},''
        if url in self.cache: return self.cache[url]
        if time.monotonic()>self.deadline: return {'url':url,'status':'queued','reason':'run_budget_exhausted'},''
        if hostname(url) in self.blocked_hosts: return {'url':url,'status':'blocked','reason':'host_rate_limited'},''
        allowed,robots=self.permitted(url)
        if not allowed: result=({'url':url,'status':'blocked','reason':'robots_disallow_or_unavailable','robots_evidence':robots,'observed_at':now()},'')
        else:
            info,text=self.raw(url);info.update(url=url,observed_at=now(),request_kind=kind);result=(info,text)
        self.cache[url]=result
        return result

def extract_listing(text,seed):
    soup=BeautifulSoup(text,'html.parser');root=soup.select_one('main .vp-doc') or soup.select_one('.vp-doc') or soup.find('main')
    if root is None: raise ValueError('FMHY article root not found; refusing navigation-only inventory')
    entries=[];resources={};section=[];seen_ids=set()
    for element in root.find_all(['h2','h3','h4','li']):
        if element.name!='li':
            level=int(element.name[1])-2;section=section[:level]+[element.get_text(' ',strip=True).replace('\u200b','').strip()];continue
        links=[]
        for anchor in element.find_all('a',href=True):
            if anchor.find_parent('li') is not element: continue
            raw=anchor['href'];url=normalize(raw,seed)
            if not url: continue
            label=anchor.get_text(' ',strip=True).replace('\u200b','').strip()
            role='internal-section' if hostname(url)==hostname(seed) and urlsplit(url).path==urlsplit(seed).path else 'listed-resource'
            link={'url':url,'label':label,'role':role}
            if raw.startswith('#'): link['fragment']=raw[1:]
            if link not in links: links.append(link)
        if not links: continue
        identity='|'.join(section)+'|'+links[0]['url']+'|'+links[0]['label'];eid=uid('entry',identity)
        if eid in seen_ids: eid=uid('entry',identity+'|'+str(len(entries)))
        seen_ids.add(eid)
        entry={'id':eid,'name':links[0]['label'] or hostname(links[0]['url']),'category':list(section),'description':safe_text(element.get_text(' ',strip=True)),'links':links,'source_url':seed,'evidence_type':'fmhy_listing','confidence':'verified','verification_scope':'listing_existence_only'}
        entries.append(entry)
        for pos,link in enumerate(links):
            if link['role']=='internal-section': continue
            r=resources.setdefault(link['url'],{'id':uid('site',link['url']),'name':link['label'] or hostname(link['url']),'url':link['url'],'entry_ids':[],'roles':[],'categories':[],'research_status':'discovered'})
            if eid not in r['entry_ids']: r['entry_ids'].append(eid)
            role='primary' if pos==0 else 'listed_related'
            if role not in r['roles']: r['roles'].append(role)
            if section not in r['categories']: r['categories'].append(list(section))
    for anchor in root.find_all('a',href=True):
        url=normalize(anchor['href'],seed)
        if not url or hostname(url)==hostname(seed) and urlsplit(url).path==urlsplit(seed).path: continue
        if url not in resources: resources[url]={'id':uid('site',url),'name':anchor.get_text(' ',strip=True) or hostname(url),'url':url,'entry_ids':[],'roles':['article_reference'],'categories':[],'research_status':'discovered'}
    return entries,resources

def repository(url):
    p=urlsplit(url);parts=[s for s in p.path.split('/') if s]
    if p.hostname in ('github.com','www.github.com') and len(parts)>=2 and parts[0] not in ('topics','search','orgs','users','settings','login','features','sponsors','marketplace'):
        return 'https://github.com/'+parts[0]+'/'+parts[1].removesuffix('.git')
    return None

def inspect_text(text,url):
    refs={};frameworks=[]
    def add(value,kind):
        value=normalize(value,url)
        if value and len(value)<1600: refs[(value,kind)]={'url':value,'kind':kind}
    soup=BeautifulSoup(text,'html.parser') if '<' in text[:2000] else None
    if soup:
        for tag,attr,kind in [('script','src','script'),('iframe','src','embed'),('img','src','image'),('video','src','media'),('source','src','media'),('a','href','link')]:
            for node in soup.find_all(tag):
                if node.get(attr): add(node[attr],kind)
        for node in soup.find_all('link',href=True): add(node['href'],'manifest' if 'manifest' in ' '.join(node.get('rel',[])) else 'asset-link')
        for node in soup.find_all('form',action=True): add(node['action'],'form-action-not-requested')
    for match in URL_RE.finditer(text): add(match.group(0),'source-literal')
    for match in re.finditer(r'''(?:fetch|axios\.(?:get|post)|WebSocket)\s*\(\s*["']([^"']+)["']''',text): add(match.group(1),'client-endpoint-reference')
    for name,pattern in [('Next.js',r'__NEXT_DATA__|/_next/|self\.__next_f'),('Nuxt',r'__NUXT__|/_nuxt/'),('Vite',r'/@vite/|vite/modulepreload'),('WordPress',r'wp-content/|wp-includes/'),('SvelteKit',r'/_app/immutable/|__sveltekit'),('Angular',r'ng-version='),('HLS.js',r'hls\.js|Hls\.isSupported'),('dash.js',r'dashjs|dash\.all\.min\.js'),('Video.js',r'video\.js|videojs\('),('JW Player',r'jwplayer\('),('Plyr',r'new Plyr\(')]:
        if re.search(pattern,text,re.I): frameworks.append({'name':name,'confidence':'strongly_inferred','evidence_type':'source_signature','source_url':url})
    return list(refs.values()),frameworks

def scan(record,fetcher,max_js):
    observation,text=fetcher.get(record['url']);record=dict(record)
    record.update(research_status='inspected' if observation['status']=='reachable' else observation['status'],availability=observation,observed_at=observation.get('observed_at',now()),observations=[],references=[],frameworks=[],limitations=['Static public HTTP inspection; reachability is not proof of functional or authorized playback.'])
    record['observations'].append({k:v for k,v in observation.items() if k!='robots_evidence'})
    if not text or observation['status']!='reachable': return record
    final=observation.get('final_url',record['url']);refs,frameworks=inspect_text(text,final)
    for ref in refs: ref.update(evidence_url=final,evidence_sha256=observation.get('sha256'),observed_at=observation.get('observed_at'),confidence='verified',verification_scope='public_source_reference_not_runtime_use')
    record['references'].extend(refs);record['frameworks'].extend(frameworks)
    js=list(dict.fromkeys(r['url'] for r in refs if r['kind']=='script' and hostname(r['url'])==hostname(final)))
    docs=list(dict.fromkeys(r['url'] for r in refs if r['kind']=='link' and (hostname(r['url'])==hostname(final) or hostname(r['url']).startswith('docs.')) and re.search(r'(?i)(/docs/?$|/api/?$|/documentation/?$)',r['url'])))
    followups=js[:max_js]+docs[:1]
    for extra in followups:
        oi,body=fetcher.get(extra,'linked_javascript_or_documentation');record['observations'].append({k:v for k,v in oi.items() if k!='robots_evidence'})
        if oi.get('status')!='reachable' or not body: continue
        rr,ff=inspect_text(body,oi.get('final_url',extra))
        for ref in rr: ref.update(evidence_url=extra,evidence_sha256=oi.get('sha256'),observed_at=oi.get('observed_at'),confidence='verified',verification_scope='public_source_reference_not_runtime_use')
        record['references'].extend(rr);record['frameworks'].extend(ff)
    record['references']=list({(r['url'],r['kind'],r['evidence_url']):r for r in record['references']}.values())
    record['frameworks']=list({r['name']:r for r in record['frameworks']}.values())
    record['depth']={'linked_scripts_discovered':len(js),'followups_http_reachable':sum(o.get('status')=='reachable' for o in record['observations'][1:]),'script_limit':max_js,'repositories_checked':False,'runtime_network_checked':False,'playback_chain_verified':False}
    return record

def build(root,entries,records,fetcher,seed_evidence):
    domains={};providers={};repos={};endpoints={};edges={}
    def edge(source,target,kind,evidence,confidence='verified',scope='public_reference',timestamp=None):
        key=uid('rel',source+'|'+target+'|'+kind+'|'+evidence)
        edges[key]={'id':key,'source':source,'target':target,'type':kind,'source_url':evidence,'observed_at':timestamp or seed_evidence.get('observed_at'),'confidence':confidence,'verification_scope':scope}
    for record in records:
        record['provider_ids']=[];record['domain_ids']=[];record['endpoint_ids']=[];record['repository_ids']=[]
        all_refs=[{'url':record['url'],'kind':'listed-domain','evidence_url':seed_evidence['url']}]+record.get('references',[])
        for hop in record.get('availability',{}).get('redirects',[]):
            if hop.get('location'): all_refs.append({'url':hop['location'],'kind':'http-redirect','evidence_url':hop['url']})
        for ref in all_refs:
            url=ref['url'];host=hostname(url)
            if not host: continue
            did=uid('domain',host);domains.setdefault(did,{'id':did,'hostname':host,'dns':fetcher.dns.get(host),'ownership':'unknown','first_party_relationship':'not_inferred_from_shared_ip'})
            if did not in record['domain_ids']: record['domain_ids'].append(did)
            edge(record['id'],did,ref['kind'],ref['evidence_url'],timestamp=ref.get('observed_at'))
            repo=repository(url)
            if repo:
                rid=uid('repo',repo);repos.setdefault(rid,{'id':rid,'url':repo,'owner':urlsplit(repo).path.split('/')[1],'status':'publicly_referenced_not_independently_verified','license':'unknown','source_code_inspected':False})
                if rid not in record['repository_ids']: record['repository_ids'].append(rid)
                edge(record['id'],rid,'references-repository',ref['evidence_url'],timestamp=ref.get('observed_at'))
            if ref['kind']!='listed-domain' and (urlsplit(url).scheme in ('ws','wss') or re.search(r'(?i)(/api(?:/|$)|graphql|^https?://api\.|^https?://graphql\.)',url) or ref['kind']=='client-endpoint-reference'):
                eid=uid('endpoint',url);endpoints.setdefault(eid,{'id':eid,'url':url,'host':host,'transport':'websocket' if url.startswith(('ws:','wss:')) else 'http','verification':'public_reference_only','http_method':'unknown','authentication_requirements':'unknown','playback_authorization':'unknown','requested':False})
                if eid not in record['endpoint_ids']: record['endpoint_ids'].append(eid)
                edge(record['id'],eid,'references-endpoint',ref['evidence_url'],timestamp=ref.get('observed_at'))
            for pid,name,kind,suffixes in KNOWN:
                if any(host==suffix or host.endswith('.'+suffix) for suffix in suffixes):
                    provider_id='provider-'+pid;providers.setdefault(provider_id,{'id':provider_id,'name':name,'category':kind,'hostname_patterns':suffixes,'identity_scope':'domain_label_not_common_ownership_claim'})
                    if provider_id not in record['provider_ids']: record['provider_ids'].append(provider_id)
                    relation='references-provider' if ref['kind'] in ('link','listed-domain','source-literal') else 'declares-'+ref['kind']+'-from-provider'
                    edge(record['id'],provider_id,relation,ref['evidence_url'],timestamp=ref.get('observed_at'))
        if record.get('references'): record['research_status']='infrastructure_partially_mapped'
        site_dir=root/'sites'/record['id'];dump(site_dir/'metadata.json',record)
        (site_dir/'README.md').write_text('# '+record['name']+'\n\nURL: '+record['url']+'\n\nStatus: '+record['research_status']+'\n\nSee metadata.json for evidence, observations and unresolved fields. A reference does not prove runtime use, common ownership, media availability or integration permission.\n',encoding='utf-8')
    coverage=[];by_url={r['url']:r for r in records}
    for entry in entries:
        linked=[by_url[l['url']] for l in entry['links'] if l['url'] in by_url];counts=Counter(r.get('availability',{}).get('status',r['research_status']) for r in linked)
        coverage.append({'entry_id':entry['id'],'name':entry['name'],'category':entry['category'],'resource_ids':[r['id'] for r in linked],'status_counts':dict(counts),'inspection_attempted':any(r.get('availability',{}).get('status') not in ('queued','discovered',None) for r in linked),'complete':False,'unresolved':['End-to-end playback chains and all transitive dependencies are not certified.']})
    for name,rows in [('entries',entries),('sites',[{k:r.get(k) for k in ('id','name','url','entry_ids','categories','research_status','provider_ids','domain_ids','endpoint_ids','repository_ids')} for r in records]),('domains',list(domains.values())),('providers',list(providers.values())),('repositories',list(repos.values())),('endpoints',list(endpoints.values())),('relationships',list(edges.values())),('coverage',coverage)]: dump(root/'indexes'/(name+'.json'),rows)
    counts=Counter(r.get('availability',{}).get('status',r['research_status']) for r in records)
    summary={'snapshot_at':now(),'fmhy_entries_discovered':len(entries),'distinct_linked_resources':len(records),'entries_with_inspection_attempt':sum(c['inspection_attempted'] for c in coverage),'resources_http_reachable':counts['reachable'],'resource_status_counts':dict(counts),'providers_identified_by_domain_reference':len(providers),'domains_identified':len(domains),'public_endpoint_references':len(endpoints),'public_repository_references':len(repos),'relationships':len(edges),'completed_entries':0,'confirmed_dead_services':0,'completeness':'partial; full parsed seed inventory with bounded public inspection','important_distinction':'HTTP errors and robots blocks do not establish dead services. Static references are not runtime-verified integrations.'}
    dump(root/'SUMMARY.json',summary)
    (root/'SUMMARY.md').write_text('# FMHY Video research snapshot\n\n```json\n'+json.dumps(summary,indent=2)+'\n```\n\nFull coverage denominator: indexes/entries.json. Research status: indexes/coverage.json. No entry is labeled fully complete.\n',encoding='utf-8')
    rank=Counter()
    for r in records: rank.update(r['provider_ids'])
    report='# Shared infrastructure references\n\nCounts are distinct listed resources referencing a provider, NOT verified playback usage or independent websites. Hyperlinks and source literals are separated from loaded-resource declarations by relationship type.\n\n| Provider | Referencing resources |\n|---|---:|\n'
    for pid,n in rank.most_common(): report+='| '+providers[pid]['name']+' | '+str(n)+' |\n'
    (root/'reports').mkdir(exist_ok=True);(root/'reports/shared-infrastructure.md').write_text(report,encoding='utf-8')
    reports=[
      ('architecture-map.md','Architecture map','Query indexes/relationships.json by source, target and type. Join site IDs with indexes/sites.json. Declared edges are verified only as declarations. Endpoints from source literals are not called. The chain site -> API/index -> metadata -> player -> final media remains partial until each hop has independent runtime evidence.'),
      ('streaming-provider-map.md','Streaming provider map','Filter indexes/providers.json for embed-provider, video-host or video-platform and join relationship targets. An embed URL is not a direct playable media source. Metadata IDs and provider names do not establish playback authorization.'),
      ('dead-and-replaced-services.md','Unavailable and redirected resources','Inspect sites/<id>/metadata.json availability.redirects for observed redirect chains. One 404, 403 or timeout does not prove a whole service dead or replaced. No dead-service conclusions are certified in this pass.'),
      ('findings.md','Findings and limitations','Every category and HTTP link in the parsed FMHY article is retained. Robots exclusions, rate limits, unavailable documents and unvisited transitive links remain explicit. Multiple links in one FMHY bullet are listed relationships, not automatically mirrors or common ownership. Framework signatures are inferred. Browser runtime, repository licenses, historical domains and final media delivery require deeper inspection.')]
    for filename,title,body in reports: (root/'reports'/filename).write_text('# '+title+'\n\n'+body+'\n',encoding='utf-8')
    dump(root/'reports/unresolved.json',[{'id':r['id'],'url':r['url'],'status':r['research_status'],'reason':r.get('availability',{}).get('reason'),'remaining':r.get('limitations',[])} for r in records])
    return summary

def main():
    p=argparse.ArgumentParser();p.add_argument('--seed',default='https://fmhy.net/video');p.add_argument('--root',default='data-dump');p.add_argument('--workers',type=int,default=8);p.add_argument('--seconds',type=int,default=600);p.add_argument('--max-js',type=int,default=2);p.add_argument('--site');p.add_argument('--reindex',action='store_true');args=p.parse_args()
    root=Path(args.root);root.mkdir(parents=True,exist_ok=True);fetcher=Fetcher(time.monotonic()+args.seconds)
    if args.reindex:
        entries=json.loads((root/'indexes/entries.json').read_text(encoding='utf-8'));records=[json.loads(f.read_text(encoding='utf-8')) for f in (root/'sites').glob('*/metadata.json')];seed=json.loads((root/'sources/seed-manifest.json').read_text(encoding='utf-8'))
        prior=root/'indexes/domains.json'
        if prior.exists():
            for d in json.loads(prior.read_text(encoding='utf-8')):
                if d.get('dns'): fetcher.dns[d['hostname']]=d['dns']
        print(json.dumps(build(root,entries,records,fetcher,seed)));return
    info,text=fetcher.get(args.seed,'seed')
    if info.get('status')!='reachable': raise RuntimeError('Seed unavailable: '+json.dumps(info))
    entries,resources=extract_listing(text,args.seed)
    if len(entries)<100: raise RuntimeError('Suspiciously small seed; refusing partial overwrite')
    dump(root/'sources/seed-manifest.json',info)
    (root/'sources/fmhy-video.md').write_text('# FMHY Video listing snapshot\n\nObserved: '+now()+'\n\nSource: '+args.seed+'\n\nResponse SHA-256: '+str(info.get('sha256'))+'\n\n'+'\n'.join('## '+e['id']+' - '+e['name']+'\n\nCategory: '+' / '.join(e['category'])+'\n\n'+e['description']+'\n\n'+'\n'.join('- ['+l['label']+']('+l['url']+')' for l in e['links'])+'\n' for e in entries),encoding='utf-8')
    queue=sorted(resources.values(),key=lambda r:('primary' not in r['roles'],r['url']))
    if args.site: queue=[r for r in queue if r['id']==args.site or r['url']==args.site or hostname(r['url'])==args.site]
    print(json.dumps({'event':'seed_inventory','entries':len(entries),'resources':len(resources),'queued':len(queue)}),flush=True)
    # Persist the denominator before enrichment so interruption never hides unvisited entries.
    dump(root/'indexes/entries.json',entries);dump(root/'indexes/discovered-resources.json',list(resources.values()))
    records=[]
    with cf.ThreadPoolExecutor(max_workers=max(1,min(12,args.workers))) as pool:
        jobs={pool.submit(scan,r,fetcher,args.max_js):r for r in queue}
        for future in cf.as_completed(jobs):
            original=jobs[future]
            try: record=future.result()
            except Exception as exc: record={**original,'research_status':'unavailable','availability':{'status':'unavailable','reason':type(exc).__name__},'limitations':['Collector error; rescan required.']}
            records.append(record)
            dump(root/'sites'/record['id']/'metadata.json',record)
            if len(records)%25==0: print(json.dumps({'event':'progress','resources':len(records),'total':len(queue),'statuses':dict(Counter(r.get('availability',{}).get('status') for r in records))}),flush=True)
    if args.site:
        scanned={r['id'] for r in records};records += [json.loads(f.read_text(encoding='utf-8')) for f in (root/'sites').glob('*/metadata.json') if f.parent.name not in scanned]
        present={r['id'] for r in records}
        records += [r for r in resources.values() if r['id'] not in present]
    records.sort(key=lambda r:r['id']);summary=build(root,entries,records,fetcher,info)
    dump(root/'sources/run-manifest.json',{'observed_at':now(),'arguments':vars(args),'request_policy':{'get_only':True,'authentication':False,'robots_respected':True,'per_host_delay_seconds_minimum':1,'redirect_limit':8,'response_byte_limit':fetcher.maximum,'javascript_execution':False,'media_downloads':False},'source_sha256':info.get('sha256'),'dns_hosts':len(fetcher.dns)})
    print(json.dumps(summary),flush=True)
if __name__=='__main__': main()

#!/usr/bin/env python3
"""Offline evidence-quality audit, canonicalization and human-readable research reports."""
import argparse, ipaddress, json, re
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit
import collect as c
import enrich as e

RESERVED_GH={'solutions','enterprise','features','resources','customer-stories','collections','events','readme','security','site','marketplace','sponsors','settings','topics','search','orgs','users','login'}

def valid_hostname(host):
    if not host or len(host)>253: return False
    try: return ipaddress.ip_address(host).is_global
    except ValueError: pass
    if '.' not in host: return False
    return all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',part,re.I) for part in host.rstrip('.').split('.'))

def shape(url):
    host=c.hostname(url)
    if not valid_hostname(host): return 'unresolved-host-expression'
    if re.search(r'\$\{|[{}<>]|%7[BbDd]|/(?:[:][A-Za-z_])',url): return 'url-template'
    if host in ('www.w3.org','w3.org','schema.org','www.schema.org'): return 'schema-or-standard-reference'
    if host.endswith(('.example','.test','.invalid','.localhost')) or host in ('example.com','example.org','example.net'): return 'documentation-placeholder'
    return 'concrete-url-reference'

def api_like(ref):
    if shape(ref['url'])!='concrete-url-reference': return False
    if ref['kind']=='client-endpoint-reference': return True
    if ref['kind']=='browser-request-sent' and ref.get('resource_type') in ('xhr','fetch'): return True
    return bool(re.search(r'(?i)(^https?://(?:api|graphql)\.|/api(?:/|$)|/graphql(?:/|$))',ref['url']))

def forge_repo(url):
    p=urlsplit(url);parts=[x for x in p.path.split('/') if x]
    if p.hostname in ('codeberg.org','bitbucket.org') and len(parts)>=2 and parts[0] not in ('explore','user','repo','assets','api'):
        return 'https://'+p.hostname+'/'+parts[0]+'/'+parts[1].removesuffix('.git')
    if p.hostname=='gitlab.com' and '/-/' in p.path: return 'https://gitlab.com'+p.path.split('/-/')[0]
    return None

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',default='data-dump');args=p.parse_args();root=Path(args.root)
    load=lambda name:e.load(root/'indexes'/f'{name}.json',[])
    records=[e.load(path) for path in (root/'sites').glob('*/metadata.json')]
    providers={x['id']:x for x in load('providers')};repos={x['id']:x for x in load('repositories')};domains=load('domains');endpoints=load('endpoints');edges=load('relationships');entries=load('entries')
    aliases={};rejected=[];repo_by_case={}
    for rid,repo in repos.items():
        parts=urlsplit(repo['url']).path.strip('/').split('/')
        repo['is_repository_candidate']=len(parts)==2 and parts[0].lower() not in RESERVED_GH and not any(ch in repo['url'] for ch in ('${','{','}'))
        if not repo['is_repository_candidate']:
            repo['status']='not_repository_path';rejected.append({'id':rid,'url':repo['url'],'reason':'reserved_namespace_or_unresolved_path','retained_as':'source reference'})
        key=repo['url'].lower()
        if key in repo_by_case: aliases[rid]=repo_by_case[key]
        else: repo_by_case[key]=rid
    for rid in aliases:
        current=repos[rid];canonical=repos[aliases[rid]]
        if current.get('status')=='verified_public_repository': canonical.update({k:v for k,v in current.items() if k not in ('id','url')})
    for pid,provider in list(providers.items()):
        if provider.get('category')!='embed-origin-unidentified': continue
        host=provider['name']
        for slug,name,category,suffixes in c.KNOWN:
            target='provider-'+slug
            if target in providers and any(host==s or host.endswith('.'+s) for s in suffixes): aliases[pid]=target;break
    for d in domains:
        d['valid_hostname']=valid_hostname(d['hostname']);d['record_kind']='domain-name-reference' if d['valid_hostname'] else 'unresolved-host-expression'
    for endpoint in endpoints:
        endpoint['reference_class']=shape(endpoint['url']);endpoint['verified_operational_endpoint']=False
    by_provider=defaultdict(set);apis=defaultdict(set);focus=[];framework_downgrades=0;templates=[]
    for record in records:
        final=record.get('availability',{}).get('final_url') or record['url']
        for field in ('provider_ids','repository_ids'): record[field]=sorted(set(aliases.get(x,x) for x in record.get(field,[])))
        for f in record.get('frameworks',[]):
            if f.get('source_url')!=final:
                f.update(confidence='unknown',attribution='bundle_signature_may_describe_a_dependency_or_upstream_site',verification_scope='signature_present_only');framework_downgrades+=1
            else: f['verification_scope']='homepage_source_signature_not_server_code_verification'
        for ref in record.get('references',[]):
            ref['reference_class']=shape(ref['url'])
            if ref['reference_class'] in ('unresolved-host-expression','url-template','documentation-placeholder'):
                templates.append({'site_id':record['id'],'url':ref['url'],'reference_class':ref['reference_class'],'source_url':ref['evidence_url']})
            if api_like(ref): apis[c.hostname(ref['url'])].add(record['id'])
            repo_url=forge_repo(ref['url'])
            if repo_url:
                rid=c.uid('repo',repo_url);repos.setdefault(rid,{'id':rid,'url':repo_url,'owner':urlsplit(repo_url).path.strip('/').split('/')[0],'status':'publicly_referenced_not_independently_verified','license':'unknown','source_code_inspected':False,'is_repository_candidate':True,'forge':c.hostname(repo_url)})
                if rid not in record['repository_ids']: record['repository_ids'].append(rid)
                edges.append({'id':c.uid('rel',record['id']+'|'+rid+'|references-repository|'+ref['evidence_url']),'source':record['id'],'target':rid,'type':'references-repository','source_url':ref['evidence_url'],'observed_at':ref.get('observed_at'),'confidence':'verified','verification_scope':'public_source_reference_only'})
        for pid in record.get('provider_ids',[]): by_provider[pid].add(record['id'])
        record.setdefault('depth',{}).update(repositories_checked=bool(record.get('repository_inspection')),runtime_network_checked=bool(record.get('browser_observation')),playback_chain_verified=False)
        focus.append({'id':record['id'],'name':record['name'],'url':record['url'],'availability':record.get('availability',{}).get('status','discovered'),'final_url':final,'entry_ids':record.get('entry_ids',[]),'provider_ids':record.get('provider_ids',[]),'api_host_references':sorted({c.hostname(ref['url']) for ref in record.get('references',[]) if api_like(ref)}),'embed_origins':sorted({c.hostname(ref['url']) for ref in record.get('references',[]) if ref['kind']=='embed' and valid_hostname(c.hostname(ref['url']))}),'media_url_references':[ref['url'] for ref in record.get('references',[]) if ref['kind']=='media'][:25],'media_chain_status':'not_verified','limitations':record.get('limitations',[])})
        e.save_record(root,record)
        text='# '+record['name']+'\n\nListed URL: '+record['url']+'\n\nHTTP observation: '+record.get('availability',{}).get('status','discovered')+'; final URL: '+final+'\n\nObserved: '+str(record.get('observed_at','unknown'))+'\n\n## Architecture evidence\n\n'
        names=[providers[x]['name'] for x in record.get('provider_ids',[]) if x in providers]
        text+='Provider/infrastructure references: '+(', '.join(names) or 'None identified in inspected material.')+'\n\n'
        text+='These are source declarations or bounded homepage observations, not verified playback integrations. No end-to-end playable-media chain is certified.\n\n'
        refs=[r for r in record.get('references',[]) if api_like(r) or r['kind'] in ('embed','media','browser-request-sent')]
        if refs:
            text+='| Reference | Evidence type | Source |\n|---|---|---|\n'
            for ref in list({(r['url'],r['kind']):r for r in refs}.values())[:25]: text+='| '+ref['url'].replace('|','%7C')+' | '+ref['kind']+' | '+ref['evidence_url'].replace('|','%7C')+' |\n'
            text+='\nAdditional references and exact timestamps/hashes are retained in metadata.json.\n'
        text+='\n## Unresolved\n\nLive server/provider selections, downstream media/CDN delivery, authorization, and any unvisited dependencies remain unknown unless a separate explicit claim establishes them. HTTP errors and blockers are not proof of service death.\n'
        (root/'sites'/record['id']/'README.md').write_text(text)
    for edge in edges:
        edge['source']=aliases.get(edge['source'],edge['source']);edge['target']=aliases.get(edge['target'],edge['target'])
    for alias in aliases:
        repos.pop(alias,None);providers.pop(alias,None)
    edges=list({(x['source'],x['target'],x['type'],x['source_url']):x for x in edges}.values())
    updates={'providers':list(providers.values()),'repositories':list(repos.values()),'domains':domains,'endpoints':endpoints,'relationships':edges,'normalization-aliases':[{'id':a,'canonical_id':b} for a,b in aliases.items()],'unresolved-url-templates':templates,'architecture-footprints':focus}
    sites=load('sites');by_id={r['id']:r for r in records}
    for site in sites:
        for field in ('provider_ids','repository_ids'): site[field]=by_id[site['id']].get(field,[])
    updates['sites']=sites
    clusters=load('clusters')
    if not isinstance(clusters,dict): clusters={}
    clusters['providers']=[{'provider_id':pid,'site_ids':sorted(ids),'resource_count':len(ids)} for pid,ids in sorted(by_provider.items(),key=lambda x:-len(x[1])) if pid in providers]
    clusters['shared_api_host_references']=[{'hostname':h,'site_ids':sorted(ids),'verification_scope':'shared_api_reference_or_bounded_fetch_observation_not_proof_of_common_backend_ownership'} for h,ids in apis.items() if len(ids)>1]
    updates['clusters']=clusters
    for name,rows in updates.items(): c.dump(root/'indexes'/f'{name}.json',rows)
    c.dump(root/'reports/rejected-repository-candidates.json',rejected)
    summary=e.load(root/'SUMMARY.json',{})
    summary.update(snapshot_at=c.now(),domains_identified=sum(d['valid_hostname'] for d in domains),hostname_candidates_total=len(domains),unresolved_hostname_expressions=sum(not d['valid_hostname'] for d in domains),public_endpoint_references=sum(x['reference_class']=='concrete-url-reference' for x in endpoints),endpoint_candidates_total=len(endpoints),repository_candidates=sum(r.get('is_repository_candidate',False) for r in repos.values()),public_repository_references=sum(r.get('is_repository_candidate',False) for r in repos.values()),repositories_confirmed_public=sum(r.get('status')=='verified_public_repository' for r in repos.values()),providers_identified_by_domain_reference=len(providers),relationships=len(edges),shared_api_host_reference_groups=len(clusters['shared_api_host_references']),framework_signatures_not_attributed_to_site=framework_downgrades,canonical_aliases_merged=len(aliases),source_snapshot_complete=e.load(root/'sources/seed-manifest.json',{}).get('truncated') is False)
    c.dump(root/'SUMMARY.json',summary)
    (root/'SUMMARY.md').write_text('# FMHY Video research snapshot\n\n**Full parsed listing inventory; partial infrastructure research.**\n\n```json\n'+json.dumps(summary,indent=2)+'\n```\n\nCounts distinguish listing occurrences, linked URL resources, syntactically valid domain-name references, concrete endpoint references, repository candidates, and verified public repositories. None of those counts certifies active video playback. Unknown expressions and references remain in the dataset, but are not counted as real domains or operational APIs.\n')
    report='# Architecture footprints\n\nThese footprints summarize observed declarations. API references, metadata, iframe origins and media references are different layers. A blank layer remains unknown; it is not inferred from neighboring sites. Full machine-readable records: indexes/architecture-footprints.json.\n\n| FMHY-linked resource | HTTP state | API-host references | Embedded origins |\n|---|---|---|---|\n'
    selected=[r for r in focus if any(k in (r['name']+' '+r['url']).lower() for k in ('pstream','1shows','cinejoy','fireflix','anilist','movy','jellyfin','aiostream','aiometadata','stremio','zstream','anicine','vidlink','videasy'))]
    for row in selected[:60]: report+='| '+row['name'].replace('|','/')+' | '+row['availability']+' | '+', '.join(row['api_host_references'][:8])+' | '+', '.join(row['embed_origins'][:5])+' |\n'
    (root/'reports/architecture-footprints.md').write_text(report)
    shared='# Shared infrastructure\n\nOne record per canonical provider. Counts are distinct research resources referencing it, not the number of independent services playing video through it.\n\n| Provider | Resources | Category |\n|---|---:|---|\n'
    for group in clusters['providers'][:60]:
        prov=providers[group['provider_id']];shared+='| '+prov['name']+' | '+str(group['resource_count'])+' | '+prov['category']+' |\n'
    shared+='\n## Shared API-host references\n\n'
    for group in sorted(clusters['shared_api_host_references'],key=lambda x:-len(x['site_ids']))[:30]: shared+='- '+group['hostname']+': '+str(len(group['site_ids']))+' resource records.\n'
    shared+='\nSee indexes/clusters.json for memberships, identical JavaScript bytes and shared DNS addresses. Identical libraries, CDN addresses and co-listed aliases do not establish a common backend or operator.\n'
    (root/'reports/shared-infrastructure.md').write_text(shared)
    c.dump(root/'reports/data-quality-audit.json',{'observed_at':c.now(),'framework_signatures_downgraded':framework_downgrades,'aliases_merged':aliases,'non_repository_paths':len(rejected),'unresolved_host_expressions':summary['unresolved_hostname_expressions'],'concrete_endpoint_references':summary['public_endpoint_references'],'preservation':'Original sanitized references retained in per-site records; uncertain candidates explicitly typed, not silently discarded.'})
    validation=e.validate(root)
    validation['checks']['untruncated_seed_snapshot']=summary['source_snapshot_complete'];validation['passed']=all(validation['checks'].values())
    c.dump(root/'reports/validation.json',validation)
    if not validation['passed']: raise RuntimeError('Audit validation failure')
    print(json.dumps({'summary':summary,'validation':validation}),flush=True)
if __name__=='__main__': main()

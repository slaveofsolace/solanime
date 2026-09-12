#!/usr/bin/env python3
"""Read and reconcile the public source audit; this tool makes no network requests."""
from __future__ import annotations
import argparse, collections, gzip, hashlib, json
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
ROOT = Path(__file__).resolve().parents[1]

def load(path: Path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)

def normalized(url: str) -> str:
    p = urlsplit(url)
    host = (p.hostname or '').lower()
    port = '' if p.port in (None, 80, 443) else ':' + str(p.port)
    return urlunsplit((p.scheme.lower(), host + port, p.path or '/', p.query, ''))

def audit(root: Path = ROOT):
    return load(root / 'curated/source-audit.json.gz')

def validate(data: dict) -> dict:
    checks = {}
    for key in ('documents', 'entities', 'relationships', 'endpoints', 'inspections'):
        ids = [x['id'] for x in data[key]]
        checks[key + '_ids_unique'] = len(ids) == len(set(ids))
    docs = {x['id'] for x in data['documents']}
    entities = {x['id'] for x in data['entities']}
    checks['evidence_resolves'] = all(set(x.get('evidence_ids', [])) <= docs and bool(x.get('evidence_ids')) for key in ('entities','relationships','endpoints','inspections') for x in data[key])
    checks['relationship_entities_resolve'] = all(x['source'] in entities and x['target'] in entities for x in data['relationships'])
    checks['endpoint_entities_resolve'] = all(x['entity_id'] in entities for x in data['endpoints'])
    checks['no_invented_runtime_verification'] = all(x['runtime_verified'] is False for x in data['entities']) and all(x['tested'] is False for x in data['endpoints'])
    checks['confidence_explicit'] = all(x['confidence'] in ('verified','strongly_inferred','unknown') for x in data['relationships'])
    checks['scope_explicit'] = all(bool(x.get('scope')) for x in data['relationships'])
    checks['no_url_userinfo'] = all(not urlsplit(u).username and not urlsplit(u).password for x in data['entities'] for u in x['urls'])
    return {'passed':all(checks.values()),'checks':checks,'scope':'schema_and_provenance_integrity_not_live_service_testing'}

def coverage(root: Path = ROOT) -> dict:
    entries = load(root / 'indexes/entries.json')
    sites = {normalized(x['url']):x for x in load(root / 'indexes/sites.json')}
    rows = load(root / 'indexes/coverage.json')
    data = audit(root)
    inspected = collections.defaultdict(list)
    for x in data['inspections']:
        if x['kind'] == 'page': inspected[normalized(x['url'])].append(x)
    result=[]
    for e in entries:
        primary = normalized(e['links'][0]['url']) if e['links'] else None
        site = sites.get(primary, {})
        extra = inspected.get(primary, [])
        bulk_attempted = bool(site) and site.get('research_status') not in ('queued','discovered')
        result.append({'entry_id':e['id'],'name':e['name'],'primary_url':primary,'bulk_status':site.get('research_status','unknown'),'supplemental_observations':[x['id'] for x in extra],'any_primary_inspection_attempt':bulk_attempted or bool(extra),'supplemental_readable':any(x['outcome']=='readable' for x in extra),'complete':False})
    return {'entries':result,'summary':{'entries':len(entries),'bulk_entries_with_any_inspection_attempt':sum(bool(x['inspection_attempted']) for x in rows),'combined_entries_with_primary_inspection_attempt':sum(x['any_primary_inspection_attempt'] for x in result),'complete_playback_chains':0,'note':'Bulk collector and supplemental web representations are distinct evidence scopes. Attempts do not mean successful playback.'}}

def bindings(root: Path = ROOT) -> list:
    """Bind by exact URL/hostname only; never infer mirrors or merge different domains."""
    site_index = collections.defaultdict(list)
    for x in load(root / 'indexes/sites.json'): site_index[normalized(x['url'])].append(x['id'])
    domains = {x['hostname']:x['id'] for x in load(root / 'indexes/domains.json')}
    repos = {normalized(x['url']):x['id'] for x in load(root / 'indexes/repositories.json')}
    result=[]
    for e in audit(root)['entities']:
        result.append({'audit_entity_id':e['id'],'site_ids':sorted({i for u in e['urls'] for i in site_index.get(normalized(u),[])}),'domain_ids':sorted({domains[urlsplit(u).hostname] for u in e['urls'] if urlsplit(u).hostname in domains}),'repository_ids':sorted({repos[normalized(u)] for u in e['urls'] if normalized(u) in repos}),'binding_scope':'exact_url_or_hostname_reference_not_common_ownership'})
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['summary','validate','upstreams','shared','coverage','bindings'])
    parser.add_argument('entity', nargs='*')
    args=parser.parse_args(); data=audit()
    if args.command=='summary': result=data['counts']
    elif args.command=='validate': result=validate(data)
    elif args.command=='coverage': result=coverage()
    elif args.command=='bindings': result=bindings()
    else:
        needed=2 if args.command=='shared' else 1
        if len(args.entity)!=needed: parser.error(f'{args.command} requires {needed} entity ID(s)')
        if any(i not in {x['id'] for x in data['entities']} for i in args.entity): parser.error('Unknown audit entity ID')
        edges=[[e for e in data['relationships'] if e['source']==i] for i in args.entity]
        if args.command=='upstreams': result=edges[0]
        else:
            common=set(e['target'] for e in edges[0]) & set(e['target'] for e in edges[1])
            result={'shared_target_ids':sorted(common),'evidence':[e for group in edges for e in group if e['target'] in common],'warning':'Shared declared dependencies are not proof of a shared deployed backend.'}
    print(json.dumps(result,ensure_ascii=False,indent=2,sort_keys=True))
    if args.command=='validate' and not result['passed']: raise SystemExit(1)
if __name__=='__main__': main()

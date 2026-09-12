#!/usr/bin/env python3
"""Query the research indexes locally. No network requests or application changes."""
import argparse,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',default='data-dump');g=p.add_mutually_exclusive_group(required=True);g.add_argument('--site');g.add_argument('--provider');g.add_argument('--api-host');g.add_argument('--redirects',action='store_true');g.add_argument('--summary',action='store_true');a=p.parse_args();root=Path(a.root)
def read(name): return json.loads((root/'indexes'/f'{name}.json').read_text())
if a.summary: result=json.loads((root/'SUMMARY.json').read_text())
elif a.redirects: result=read('redirects')
elif a.site:
    result=[r for r in read('architecture-footprints') if a.site.lower() in (r['id']+' '+r['name']+' '+r['url']).lower()]
elif a.api_host: result=[r for r in read('architecture-footprints') if a.api_host in r['api_host_references']]
else:
    providers=[r for r in read('providers') if a.provider.lower() in (r['id']+' '+r['name']).lower()];ids={r['id'] for r in providers}
    result={'providers':providers,'resources':[r for r in read('sites') if ids.intersection(r.get('provider_ids',[]))],'caution':'References are not verified active integrations. Inspect relationship type, evidence source and verification scope.'}
print(json.dumps(result,ensure_ascii=False,indent=2))

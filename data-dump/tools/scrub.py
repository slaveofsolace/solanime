#!/usr/bin/env python3
"""Redact transient URL state from the research snapshot; no network access."""
import argparse, json, re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import collect as c
import enrich as e

SENSITIVE = re.compile(r'(?i)(token|secret|password|passwd|authorization|cookie|session|signature|api[_-]?key|access[_-]?key|credential|nonce|csrf|ticket|challenge|clearance|^sig$|^key$|^auth$|^jwt$|^state$)')
TEXT_PARAM = re.compile(r'''(?i)([?&](?:[^&\s=]*?(?:nonce|csrf|token|secret|password|session|ticket|challenge|clearance)[^&\s=]*|state|jwt|sig|auth)=)([^&\s<>"'`\)\]]+)''')

def scrub_url(value, depth=0):
    if depth>4 or not value.startswith(('http://','https://','ws://','wss://')): return value
    try:
        p=urlsplit(value);items=parse_qsl(p.query,keep_blank_values=True);changed=False;out=[]
        for key,val in items:
            new='[REDACTED]' if val and SENSITIVE.search(key) else scrub_url(val,depth+1)
            changed |= new!=val;out.append((key,new))
        return urlunsplit((p.scheme,p.netloc,p.path,urlencode(out,doseq=True),p.fragment)) if changed else value
    except ValueError: return value

def scrub_text(value):
    if value.startswith(('https://','http://','ws://','wss://')) and '\n' not in value:
        return scrub_url(value)
    return TEXT_PARAM.sub(lambda m:m.group(1)+'%5BREDACTED%5D' if 'REDACTED' not in m.group(2) else m.group(0),value)

def visit(value):
    if isinstance(value,dict): return {k:visit(v) for k,v in value.items()}
    if isinstance(value,list): return [visit(v) for v in value]
    if isinstance(value,str): return scrub_text(value)
    return value

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',default='data-dump');args=parser.parse_args();root=Path(args.root)
    changed=[]
    for path in sorted(root.rglob('*.json')):
        before=json.loads(path.read_text());after=visit(before)
        if after!=before:
            c.dump(path,after);changed.append(path.relative_to(root).as_posix())
    for path in sorted(root.rglob('*.md')):
        before=path.read_text();after=scrub_text(before)
        if before!=after: path.write_text(after);changed.append(path.relative_to(root).as_posix())
    collector=root/'tools/collect.py';code=collector.read_text();updated=code.replace('|^jwt$)', '|^jwt$|nonce|csrf|^state$|ticket|challenge|clearance)')
    if code!=updated: collector.write_text(updated)
    template=root/'tools/github-workflow.yml';code=template.read_text();needle='      - run: python data-dump/tools/audit.py\n';addition='      - run: python data-dump/tools/scrub.py\n'
    if addition not in code: template.write_text(code.replace(needle,needle+addition))
    readme=root/'README.md';text=readme.read_text();note='\n## Transient URL-state redaction\n\nAfter any refresh or offline rebuild, run `python data-dump/tools/scrub.py`. This removes nonce, CSRF, OAuth-state and other sensitive URL values, including nested return URLs, from the final records and reports. Parameter names and endpoint structure remain available as architectural evidence. This is an additional conservative privacy check, not permission to retain credentials.\n'
    if '## Transient URL-state redaction' not in text: readme.write_text(text+note)
    validation=e.validate(root)
    validation['checks']['untruncated_seed_snapshot']=e.load(root/'sources/seed-manifest.json',{}).get('truncated') is False
    validation['passed']=all(validation['checks'].values());c.dump(root/'reports/validation.json',validation)
    audit={'observed_at':c.now(),'changed_files':changed,'redacted_parameter_classes':['nonce','csrf','state','tokens_and_other_sensitive_query_values'],'scope':'JSON URL strings, nested return URLs, Markdown URL references; no network calls','original_source_body_hashes_retained':True,'raw_values_logged':False,'record_ids_retained':True,'validation_passed':validation['passed']}
    c.dump(root/'reports/privacy-audit.json',audit)
    if not validation['passed']: raise RuntimeError('Privacy pass data validation failed')
    print(json.dumps({'redacted_files':len(changed),'validation_passed':validation['passed']}),flush=True)
if __name__=='__main__':main()

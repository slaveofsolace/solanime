"""Read the exact GitHub LFS checkpoint on an isolated runner; never certify media."""
import csv
import hashlib
import itertools
import json
import os
from pathlib import Path
import sqlite3
import sys
from urllib.parse import urlsplit

EXPECTED = '70010385d696b0d039ab0d0bd0a24297451192bceb4861050035595bfa8ff9a6'
BASE = 'f06c18f605baeb70d4e32e101f616277907edb32'
TRIAD = ('vidstream-2', 'hd-1', 'hd-2')

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(4194304), b''): h.update(b)
    return h.hexdigest()

def atom(v):
    return "'"+v if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@')) else v

def digest(v):
    return hashlib.sha256(str(v).encode()).hexdigest() if v is not None else None

def export(path, out, expected=EXPECTED):
    path=Path(path).resolve(strict=True);out=Path(out).resolve()
    assert sha(path)==expected, 'LFS content checksum mismatch'
    assert not any(Path(str(path)+s).exists() for s in ('-wal','-shm','-journal')), 'Not a quiescent checkpoint'
    out.mkdir(parents=True,exist_ok=False)
    db=sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1',uri=True)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA query_only=ON');db.execute('PRAGMA trusted_schema=OFF')
    info={'source_commit':BASE,'source_sha256':expected,'scope':'GitHub tracked partial checkpoint; NOT current PC or production',
          'live_playback_tests':0,'current_playback_verified':False,'counts':{},'provider_counts':[],
          'triad_version_distribution':{str(n):0 for n in range(4)},'grid_rows':0,'episodes_without_versions':0,
          'versions_without_mappings':0,'titles_without_episodes':0,'mapped_rows_exported':0}
    for table in ('titles','episodes','episode_versions','episode_provider_mappings'):
        info['counts'][table]=db.execute('SELECT count(*) FROM '+table).fetchone()[0]
    info['integrity_check']=[r[0] for r in db.execute('PRAGMA integrity_check')]
    info['foreign_key_violation_count']=sum(1 for _ in db.execute('PRAGMA foreign_key_check'))
    info['provider_counts']=[dict(r) for r in db.execute('SELECT provider_id,count(*) mappings FROM episode_provider_mappings GROUP BY provider_id')]
    try:
        info['crawl_tasks']=[dict(r) for r in db.execute('SELECT task_type,status,count(*) tasks FROM crawl_tasks GROUP BY task_type,status')]
    except sqlite3.OperationalError:info['crawl_tasks']='not_available'
    with (out/'titles-without-episodes.csv').open('w',newline='',encoding='utf-8') as f:
        w=csv.writer(f);w.writerow(['source','source_id','slug','name'])
        for r in db.execute('SELECT source,source_id,slug,name FROM titles t WHERE NOT EXISTS(SELECT 1 FROM episodes e WHERE e.title_id=t.id)'):
            w.writerow([atom(x) for x in r]);info['titles_without_episodes']+=1
    q='''SELECT t.source,t.source_id title_source_id,t.id title_id,t.slug,t.name,
          e.source_id episode_source_id,e.id episode_id,e.number_text,e.episode_type,
          v.source_id version_source_id,v.id version_id,v.language,m.id mapping_id,
          m.provider_id,m.source_mapping_id,m.provider_resource_id,m.canonical_embed_url,
          m.availability_state,m.resolution_evidence_state,m.last_playback_verification_at
          FROM titles t JOIN episodes e ON e.title_id=t.id
          LEFT JOIN episode_versions v ON v.episode_id=e.id
          LEFT JOIN episode_provider_mappings m ON m.version_id=v.id
          ORDER BY t.id,e.id,v.id,m.provider_id,m.id'''
    with (out/'episode-server-grid.csv').open('w',newline='',encoding='utf-8') as cf, (out/'episode-version-map.jsonl').open('w',encoding='utf-8') as jf:
        w=csv.writer(cf)
        w.writerow(['title_source','title_source_id','title','slug','episode_source_id','episode_number','episode_type','episode_id','version_source_id','version_id','language','triad_applies','vidstream-2_mapping_ids','hd-1_mapping_ids','hd-2_mapping_ids','mapping_count','other_provider_ids','current_playback'])
        for key, it in itertools.groupby(db.execute(q),lambda r:(r['title_id'],r['episode_id'],r['version_id'])):
            rows=list(it);r=rows[0];maps=[]
            for m in rows:
                if m['mapping_id'] is None:continue
                try:host=urlsplit(m['canonical_embed_url'] or '').hostname
                except ValueError:host=None
                maps.append({'mapping_id':m['mapping_id'],'provider_id':m['provider_id'],'source_mapping_id_sha256':digest(m['source_mapping_id']),
                  'provider_resource_id_sha256':digest(m['provider_resource_id']),'stored_embed_host':host,
                  'stored_availability':m['availability_state'],'stored_resolution_evidence':m['resolution_evidence_state'],
                  'stored_last_playback_at':m['last_playback_verification_at'],'current_playback':'not_tested'})
            slots={p:[m['mapping_id'] for m in maps if m['provider_id']==p] for p in TRIAD}
            applicable=r['source']=='anikoto' and r['language'] in ('sub','dub')
            if applicable:info['triad_version_distribution'][str(sum(bool(ids) for ids in slots.values()))]+=1
            if r['version_id'] is None:info['episodes_without_versions']+=1
            elif not maps:info['versions_without_mappings']+=1
            info['grid_rows']+=1;info['mapped_rows_exported']+=len(maps)
            data={k:r[k] for k in ('source','title_source_id','title_id','slug','name','episode_source_id','episode_id','number_text','episode_type','version_source_id','version_id','language')}
            data.update({'triad_applies':applicable,'triad_mapping_ids':slots,'mappings':maps,'current_playback':'not_tested'})
            jf.write(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
            w.writerow([atom(x) for x in [r['source'],r['title_source_id'],r['name'],r['slug'],r['episode_source_id'],r['number_text'],r['episode_type'],r['episode_id'],r['version_source_id'],r['version_id'],r['language'],applicable,*[';'.join(map(str,slots[p])) for p in TRIAD],len(maps),';'.join(sorted({m['provider_id'] for m in maps}-set(TRIAD))),'not_tested']])
    db.close()
    assert sha(path)==expected,'Source changed during read'
    assert info['mapped_rows_exported']==info['counts']['episode_provider_mappings'],'Orphan mappings require review'
    info['source_hash_unchanged']=True
    (out/'summary.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(info,indent=2))
    return info

if __name__=='__main__':
    assert os.environ.get('GITHUB_ACTIONS')=='true','This entrypoint is for an isolated GitHub runner only.'
    export(sys.argv[1],sys.argv[2])

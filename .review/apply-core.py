from pathlib import Path
import json
R=Path.cwd()
def replace(path, old, new):
    p=R/path;s=p.read_text();assert old in s,(path,old[:100]);p.write_text(s.replace(old,new))
def put(path,text):
    p=R/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
p=R/'package.json';j=json.loads(p.read_text());j['version']='0.2.0';j['engines']['node']='>=24.10.0 <27'
for k,v in list(j['scripts'].items()):
    if v.startswith('tsx scripts/'):j['scripts'][k]='node --env-file-if-exists=.env --import tsx '+v[4:]
j['scripts'].update({'api':'node --env-file-if-exists=.env --import tsx server/app.ts','api:dev':'node --env-file-if-exists=.env --watch --import tsx server/app.ts','test:e2e':'pnpm build && playwright test','start':'node --env-file-if-exists=.env --import tsx server/app.ts --serve-static','preview':'vite preview','check':'pnpm typecheck && pnpm test && pnpm build','doctor':'node --env-file-if-exists=.env --import tsx scripts/doctor.ts'})
p.write_text(json.dumps(j,indent=2)+'\n')
put('.nvmrc','24\n')
put('.editorconfig','root = true\n[*]\ncharset = utf-8\nindent_style = space\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n[*.md]\ntrim_trailing_whitespace = false\n')
put('.prettierrc.json','{"singleQuote":true,"trailingComma":"all","printWidth":100}\n')
put('.prettierignore','node_modules\ndist\ndata\nevidence\nplaywright-report\ntest-results\npnpm-lock.yaml\n*.mp4\n')

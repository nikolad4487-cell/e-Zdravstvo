import openpyxl,json,gzip,re,hashlib,collections
from pathlib import Path
import argparse,subprocess,tempfile
parser=argparse.ArgumentParser(description='Extract supplied HZJZ XLSX and CEZIH PDF, preserving original sections.')
parser.add_argument('xlsx',type=Path);parser.add_argument('pdf',type=Path)
parser.add_argument('--output',type=Path,default=Path('data/medical-catalogs'))
args=parser.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True);x=args.xlsx
sheet=openpyxl.load_workbook(x,read_only=True,data_only=True).active
rows=[{'code':str(r[0]),'name':r[4],'parent':r[1],'block_start':r[5],'block_end':r[6],'block_name':r[7],'chapter_number':r[8],'chapter_name':r[9],'chapter_subname':r[10],'compact_code':r[3]} for r in sheet.iter_rows(min_row=2,values_only=True) if r[0]]
with open(out/'mkb.json.gz','wb') as f:
 with gzip.GzipFile(fileobj=f,mode='wb',mtime=0) as z:z.write(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode())
pdf=args.pdf
with tempfile.TemporaryDirectory() as temporary:
 txt=Path(temporary)/'source.txt';subprocess.run(['pdftotext','-layout',str(pdf),str(txt)],check=True);text=txt.read_text()
lines=text.splitlines();clean=[]
for line in lines:
 if '8/15517-FCPBA' in line or 'Commercial in confidence' in line or line.strip()=='Specifikacija kodnih lista':continue
 clean.append(line)
text='\n'.join(clean)
heads=[m for m in re.finditer(r'^\s*(2\.[12]\.\d+)\s+([^\n]+)',text,re.M) if '...' not in m[2] and not re.search(r'\.{4}',m[2])]
catalogs=[];total=0
for i,h in enumerate(heads):
 body=text[h.end():heads[i+1].start() if i+1<len(heads) else len(text)].strip()
 title=h[2].strip();name_match=re.search(r'Naziv (?:kodne liste|šifrarnika):\s*([^\n]+)',body)
 if name_match:title=name_match[1].strip()
 if title in ['Kodna','Kodna lista','Kodna lista:']:title+=' '+body.splitlines()[0].strip()
 oid=re.search(r'OID[^:\n]*:\s*([0-9.]+)',body)
 entries=[]
 catalogs.append({'id':h[1],'name':title,'oid':oid[1] if oid else None,'source_text':body,'entries':entries,'external_only':not bool(entries)})
(out/'cezih.json').write_text(json.dumps(catalogs,ensure_ascii=False,indent=2))
manifest={'mkb':{'file':x.name,'sha256':hashlib.sha256(x.read_bytes()).hexdigest(),'count':len(rows)},'cezih':{'file':pdf.name,'sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'revision':'RevBE 2023-07-12 (printed in supplied PDF)','lists':len(catalogs),'entries':total},'imported_on':'2026-10-11'}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))

import pdfplumber,json,re,collections
from pathlib import Path
path=out/'cezih.json'
cs={x['id']:x for x in json.loads(path.read_text())};rows=collections.defaultdict(dict);current=None
pdf=pdfplumber.open(args.pdf)
def norm(s,src):
 s=re.sub(r'\s+',' ',s or '').strip()
 # Repair PDF font-run splits only when the joined word exists in the original text extraction.
 def join(m):
  joined=m[1]+m[2]
  return joined if joined in src else m[0]
 return re.sub(r'\b([A-ZČĆĐŠŽ]) ([a-zčćđšž]+)',join,s).replace('bolniĂ¨ki','bolnički')
for pi,page in enumerate(pdf.pages):
 if pi<6:continue
 words=page.extract_words();markers=[(w['top'],'head',w['text']) for w in words if re.fullmatch(r'2\.[12]\.\d+',w['text']) and (w['x0']<115 or w['text']=='2.2.4')]
 tables=page.find_tables();row_events=[]
 for t in tables:
  content=t.extract()
  metadata=any(norm(r[0],'').startswith(('Naziv kodne','Sadržaj kodne','Šifra/Vrijednost','Šifra / Vrijednost')) for r in content if r)
  offset=2 if any('DRGDIJAG_SIF' in (v or '') for r in content for v in r) else (1 if metadata else 0)
  for r,geometry in zip(content,t.rows):
   boxes=[c for c in geometry.cells if c]
   if boxes:row_events.append((min(b[1] for b in boxes),'row',(r,offset)))
 events=sorted(markers+row_events,key=lambda x:x[0])
 for _,kind,item in events:
  if kind=='head':current=item;continue
  if current not in cs:continue
  r,offset=item;src=cs[current]['source_text']
  if not r or len(r)<=offset:continue
  first=norm(r[0],src)
  if first.startswith(('Naziv kodne','Identifikator','OID')):continue
  code=norm(r[offset],src)
  if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.*/()–-]{0,39}',code):continue
  if not (any(c.isdigit() for c in code) or code.isupper()):continue
  if code in ['OID','HL7','DTP']:continue
  values=[norm(v,src) for v in r[offset+1:] if v]
  if not values:continue
  desc=' | '.join(values)
  row={'code':code,'name':values[0],'description':desc,'raw_lines':values,'page':pi+1}
  if code in rows[current] and rows[current][code]['description']!=desc:
   rows[current][code]['description']+=' / '+desc
  else:rows[current][code]=row
 if pi%20==0:print('Parsed page',pi+1,flush=True)
for id,c in cs.items():
 c['entries']=list(rows[id].values());c['external_only']=not bool(c['entries'])
 if id=='2.2.5':
  for e in c['entries']:e['name']=e['description']
path.write_text(json.dumps(list(cs.values()),ensure_ascii=False,indent=2))
p=path.parent/'manifest.json';m=json.loads(p.read_text());m['cezih']['lists']=len(cs);m['cezih']['entries']=sum(len(c['entries']) for c in cs.values());p.write_text(json.dumps(m,ensure_ascii=False,indent=2));print(m['cezih'])
for id in ['2.2.5','2.2.30','2.2.31','2.2.175','2.2.191']:
 print(id,len(cs[id]['entries']),[(r['code'],r['name']) for r in cs[id]['entries'][:2]])

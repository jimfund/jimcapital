"""Keep the hand-separated drawings and current local layout in the cloud draft."""
import json,re,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[1]
# Article text is taken from the authored HTML; no private library export is packaged.
from html.parser import HTMLParser
class Content(HTMLParser):
 def __init__(self): super().__init__(); self.items=[]; self.inside=False; self.title=''; self.heading=False
 def handle_starttag(self,t,a):
  if t=='li': self.inside=True; self.items.append('')
  if t=='h1': self.heading=True
 def handle_endtag(self,t):
  if t=='li': self.inside=False
  if t=='h1': self.heading=False
 def handle_data(self,s):
  if self.inside:self.items[-1]+=s
  if self.heading:self.title+=s
p=Content(); page=(root/'prac/001/index.html').read_text(); p.feed(page)
drawings=[]
for name in re.findall(r'src="doodles/([^"/]+)\.svg"',page):
 svg=ET.parse(root/f'prac/001/doodles/{name}.svg').getroot()
 x,y,w,h=map(float,svg.attrib['viewBox'].split())
 paths=[]
 for path in svg.findall('.//{http://www.w3.org/2000/svg}path'):
  d=path.attrib['d']
  d=re.sub(r'([ML])\s*(-?[\d.]+)[ ,]+(-?[\d.]+)',lambda m:f'{m[1]}{float(m[2])-x:.2f} {float(m[3])-y:.2f}',d)
  paths.append(d)
 drawings.append(dict(id=name,width=w,height=h,paths=paths))
layout=json.loads((root/'prac/001/layout.json').read_text());layout.setdefault('deleted',[]);layout.pop('version',None)
seed={'sourceId':'0745987d-f172-4df9-9991-1cec2b21e0f3','slug':'prac/001','document':dict(title=p.title,markdown='\n'.join(f'{i+1}. {s}' for i,s in enumerate(p.items)),drawings=drawings,layout=layout)}
(root/'cloud/seed.json').write_text(json.dumps(seed,separators=(',',':'))+'\n')

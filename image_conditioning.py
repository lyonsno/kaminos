"""Retained source-camera depth/normal bytes, shared by human and agent pages."""
import hashlib,json,math,os,re,struct,tempfile
from pathlib import Path
from urllib.parse import urlencode

def digest(value):
 if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('Invalid conditioning digest')
 return value

def header(body):
 if len(body)<4:raise ValueError('Incomplete conditioning geometry')
 length=struct.unpack_from('<I',body)[0];offset=4+((length+3)//4)*4
 if offset>len(body):raise ValueError('Incomplete conditioning header')
 try:value=json.loads(body[4:4+length])
 except (ValueError,UnicodeDecodeError) as error:raise ValueError('Invalid conditioning header') from error
 if not isinstance(value,dict):raise ValueError('Invalid conditioning header')
 w,h=value.get('width'),value.get('height')
 if value.get('schema')!='kaminos.conditioning-geometry.v1' or type(w)is not int or type(h)is not int or min(w,h)<2 or len(body)!=offset+w*h*16:raise ValueError('Incomplete conditioning geometry arrays')
 meta=value.get('metadata')
 if not isinstance(meta,dict) or not isinstance(meta.get('source'),dict):raise ValueError('Conditioning source metadata required')
 for field in [meta.get('cacheKey'),meta.get('producerSha256'),meta['source'].get('sha256')]:digest(field)
 if not isinstance(meta['source'].get('source'),str) or not meta['source']['source'].startswith('/api/'):raise ValueError('Mounted conditioning source required')
 prepared=meta.get('preparation',{}).get('prepared') if isinstance(meta.get('preparation'),dict) else None
 if not isinstance(prepared,dict) or not isinstance(prepared.get('source'),str) or not prepared['source'].startswith('/api/read?root=image-preparations&path='):raise ValueError('Retained foreground preparation required')
 digest(prepared.get('sha256'))
 route=meta.get('route');evidence=route.get('runtimeEvidence',{}) if isinstance(route,dict) else {}
 if not isinstance(evidence,dict):raise ValueError('Invalid MoGe runtime evidence')
 if not isinstance(route,dict) or route.get('effectiveRouteId')!='moge.depth-normal.webgpu-local.v0' or route.get('status')!='real' or route.get('fallbackReason') or evidence.get('weights')!='real' or evidence.get('encoderFeatures')!='backbone-gpu':raise ValueError('Real source-image MoGe route required')
 depth=struct.iter_unpack('<f',body[offset:offset+w*h*4])
 if not any(math.isfinite(x[0]) and x[0]>0 for x in depth):raise ValueError('No valid conditioning depth')
 return value

def write(path,content):
 path.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:temporary=Path(f.name);f.write(content)
 try:os.replace(temporary,path)
 finally:temporary.unlink(missing_ok=True)

def save(root,body):
 root=Path(root);value=header(body);sha=hashlib.sha256(body).hexdigest();target=root/(sha+'.bin');write(target,body)
 entry={'schema':'kaminos.conditioning-artifact.v1','source':'/api/read?'+urlencode({'root':'image-conditioning','path':target.name}),'sha256':sha,'width':value['width'],'height':value['height'],'metadata':value['metadata']}
 write(root/(digest(value['metadata']['cacheKey'])+'.json'),json.dumps(entry).encode());return entry

def load(root,key):
 path=Path(root)/(digest(key)+'.json')
 if not path.exists():return None
 entry=json.loads(path.read_text());body=(Path(root)/(digest(entry['sha256'])+'.bin')).read_bytes()
 if hashlib.sha256(body).hexdigest()!=entry['sha256']:raise ValueError('Retained conditioning bytes changed')
 value=header(body)
 if value['metadata']['cacheKey']!=key or entry['metadata']!=value['metadata']:raise ValueError('Retained conditioning identity mismatch')
 return entry

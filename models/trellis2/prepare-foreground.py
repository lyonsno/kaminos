"""Prepare admitted foreground pixels with the existing MLX crew's CPU helper."""
import argparse
import hashlib
import importlib
from importlib import metadata
import json
from pathlib import Path
import subprocess
import sys
import time
import traceback

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root',type=Path,required=True)
parser.add_argument('--expected-source-commit',required=True)
parser.add_argument('--image',type=Path,required=True)
parser.add_argument('--expected-image-sha256',required=True)
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
report={'schema':'trellis2.foreground-preparation.v0','status':'running','phase':'source-input-admission',
        'command':sys.argv,'modelCalls':0,'requestedRoute':'actual MLX crew foreground crop/alpha + rembg U2Net CPU'}
started=time.perf_counter()
def h(data):return hashlib.sha256(data).hexdigest()
def persist():(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
def ident(root):return {'root':str(root),'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
                       'dirty':subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True)}
persist()
try:
    source=args.source_root.resolve();report['source']=ident(source)
    if report['source']['commit']!=args.expected_source_commit or report['source']['dirty']:raise ValueError('exact clean preprocessing source required')
    raw=args.image.read_bytes();report['input']={'path':str(args.image.resolve()),'byteLength':len(raw),'sha256':h(raw)}
    if report['input']['sha256']!=args.expected_image_sha256:raise ValueError('exact original image bytes required')
    sys.path.insert(0,str(source));module=importlib.import_module('trellmlx.preprocess')
    if Path(module.__file__).resolve()!=(source/'trellmlx/preprocess.py').resolve():raise ValueError('effective preprocessing source mismatch')
    report['source']['moduleSha256']=h((source/'trellmlx/preprocess.py').read_bytes())
    report['phase']='foreground-model';persist()
    from PIL import Image
    with Image.open(args.image) as image:
        has_alpha=image.mode=='RGBA' and image.getchannel('A').getextrema()!=(255,255)
    session=None;report['effectiveProviders']=[]
    if not has_alpha:
        from rembg import new_session,remove
        session=new_session(module.DEFAULT_BACKGROUND_MODEL,providers=['CPUExecutionProvider'])
        report['effectiveProviders']=session.inner_session.get_providers()
        if report['effectiveProviders']!=['CPUExecutionProvider']:raise ValueError('explicit CPU background route required')
    def capture(image,*,session):
        report['modelCalls']+=1;persist()
        rgba=remove(image,session=session)
        rgba.save(out/'foreground-alpha.png')
        return rgba
    result=module.preprocess_image_with_provenance(args.image,rembg_session=session,remove_background=capture)
    report['preparation']=result.provenance
    if result.provenance.get('fallback') or result.provenance['foreground_pixels']<1:raise ValueError('no foreground; raw-input fallback is not background preparation')
    if result.provenance['route']=='input-alpha':
        from PIL import Image
        with Image.open(args.image) as image:image.save(out/'foreground-alpha.png')
    report['phase']='prepared-image-write';persist()
    result.image.save(out/'prepared-shoe.png')
    files={}
    for name in ['foreground-alpha.png','prepared-shoe.png']:
        data=(out/name).read_bytes();files[name]={'path':str(out/name),'byteLength':len(data),'sha256':h(data)}
    report['files']=files;report['effectiveRoute']=result.provenance['route']+'/reference-crop-premultiply/CPU'
    report['sourceAfter']=ident(source)
    if report['sourceAfter']!={k:report['source'][k] for k in ['root','commit','dirty']}:raise ValueError('source changed during preprocessing')
    report['packages']={k:metadata.version(k) for k in ['rembg','onnxruntime','pillow','numpy']}
    report['status']='succeeded';report['phase']=None
except Exception as e:
    report.update(status='failed',error={'message':str(e),'traceback':traceback.format_exc()})
finally:
    report['elapsedSeconds']=time.perf_counter()-started;persist()
print(json.dumps({k:report.get(k) for k in ['status','phase','modelCalls','effectiveRoute','files','error']}),flush=True)
sys.exit(0 if report['status']=='succeeded' else 1)

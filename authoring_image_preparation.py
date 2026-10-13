"""Retain original/cutout bytes using the shop's rembg U2Net CPU route.

The command is also the headless entrypoint. Unlike Trellis preparation it
retains RGBA at the original canvas size; SF3D owns resize/blend/normalization.
"""
import argparse
import hashlib
from importlib import metadata
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import traceback
import uuid

def sha(data):
    return hashlib.sha256(data).hexdigest()

def write(path,data):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        temporary=Path(f.name);f.write(data)
    try: os.replace(temporary,path)
    finally: temporary.unlink(missing_ok=True)

def prepare(content,store,model_path):
    from PIL import Image,ImageOps
    started=time.perf_counter()
    original_sha=sha(content)
    with Image.open(io.BytesIO(content)) as decoded:
        image=ImageOps.exif_transpose(decoded).convert('RGBA')
    alpha=image.getchannel('A')
    existing_alpha=alpha.getextrema()!=(255,255)
    runtime={'python':sys.version.split()[0],'pillow':metadata.version('pillow')}
    model=None
    if not existing_alpha:
        if not model_path.is_file():raise ValueError('U2Net weights missing; set KAMINOS_BACKGROUND_MODEL_PATH to the existing u2net.onnx')
        model={'name':'u2net','sha256':sha(model_path.read_bytes()),'path':str(model_path)}
        runtime.update(rembg=metadata.version('rembg'),onnxruntime=metadata.version('onnxruntime'))
    key=sha(json.dumps({'input':original_sha,'runtime':runtime,'model':model,'source':sha(Path(__file__).read_bytes())},sort_keys=True).encode())
    directory=store/key;directory.mkdir(parents=True,exist_ok=True)
    report_path=directory/'report.json'
    if report_path.exists():
        old=json.loads(report_path.read_text())
        if old.get('status')=='complete':
            if sha((directory/'original').read_bytes())!=original_sha or sha((directory/'cutout.png').read_bytes())!=old['prepared']['sha256']:raise ValueError('Retained preparation bytes do not match their recorded identity')
            return {**old,'cached':True,'modelCalls':0,'elapsedSeconds':time.perf_counter()-started}
    report={'schema':'kaminos.image-preparation.v1','status':'running','phase':'background-removal','original':{'sha256':original_sha},'runtime':runtime,'model':model,'providers':[],'cached':False,'modelCalls':0}
    write(directory/'original',content);write(report_path,(json.dumps(report,indent=2)+'\n').encode())
    try:
        if existing_alpha:
            result=image;report['route']='input-alpha'
        else:
            from rembg import new_session,remove
            # Reuse rembg's existing U2Net session; no GPU provider or download.
            os.environ['U2NET_HOME']=str(model_path.parent)
            if model_path.name!='u2net.onnx':raise ValueError('U2Net model path must name u2net.onnx')
            session=new_session('u2net',providers=['CPUExecutionProvider'])
            if sha(model_path.read_bytes())!=model['sha256']:raise ValueError('Background weights changed during session creation')
            report['providers']=session.inner_session.get_providers()
            if report['providers']!=['CPUExecutionProvider']:raise ValueError('Expected CPU-only background removal')
            report['modelCalls']=1
            result=remove(image,session=session).convert('RGBA');report['route']='rembg-u2net-cpu'
        if result.size!=image.size:raise ValueError('Background removal changed the image canvas')
        histogram=result.getchannel('A').histogram();foreground=sum(histogram[1:]);transparent=sum(histogram[:255])
        if not foreground or not transparent:raise ValueError('Preparation did not produce a nonempty foreground with transparency')
        report.update(foregroundPixels=foreground,transparentPixels=transparent,phase='prepared-image-write')
        output=io.BytesIO();result.save(output,format='PNG');data=output.getvalue();write(directory/'cutout.png',data)
        report['prepared']={'sha256':sha(data),'width':result.width,'height':result.height,'bytes':len(data),'path':f'{key}/cutout.png'}
        report['original']['path']=f'{key}/original'
        report.update(status='complete',phase=None)
    except Exception as error:
        report.update(status='failed',error=str(error),traceback=traceback.format_exc());raise
    finally:
        report['elapsedSeconds']=time.perf_counter()-started;write(report_path,(json.dumps(report,indent=2)+'\n').encode())
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--store',type=Path,required=True);parser.add_argument('--model',type=Path,required=True);args=parser.parse_args()
    content=sys.stdin.buffer.read()
    try:
        value=prepare(content,args.store.expanduser().resolve(),args.model.expanduser().resolve());print(json.dumps(value))
    except Exception as error:
        value={'schema':'kaminos.image-preparation.v1','status':'failed','phase':'preparation','error':str(error),'original':{'sha256':sha(content)},'source':str(Path(__file__).resolve()),'sourceSha256':sha(Path(__file__).read_bytes()),'command':sys.argv,'traceback':traceback.format_exc()}
        failures=args.store.expanduser().resolve()/'failures';failures.mkdir(parents=True,exist_ok=True);report=failures/f'{uuid.uuid4()}.json';write(report,(json.dumps(value,indent=2)+'\n').encode());value['report']=str(report)
        print(json.dumps(value));sys.exit(1)

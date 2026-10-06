"""Model-free prepared-image/profile package using identical retained weights."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
import numpy as np
from PIL import Image

p=argparse.ArgumentParser(description=__doc__)
for name in ['repo-root','base','foreground','out']:p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--expected-commit',required=True)
p.add_argument('--pipeline-type',choices=['512','1024_cascade'],required=True)
p.add_argument('--steps',type=int,required=True)
a=p.parse_args();out=a.out.resolve();out.mkdir(parents=True,exist_ok=True)
report={'schema':'trellis2.prepared-generation-package.v0','status':'running','phase':'source-admission','modelCalls':0,'command':sys.argv}
def sha(data):return hashlib.sha256(data).hexdigest()
def file_sha(file):
    d=hashlib.sha256()
    with file.open('rb') as stream:
        for b in iter(lambda:stream.read(1024*1024),b''):d.update(b)
    return d.hexdigest()
def persist():(out/'package-report.json').write_text(json.dumps(report,indent=2)+'\n')
manifest_path=out/'manifest.json'
def atomic_text(path,text):
    pending=path.with_name(path.name+'.pending-'+str(os.getpid()))
    pending.write_text(text)
    os.replace(pending,path)
def block_current_attempt(status):
    # Keep old artifacts as an explicit previous package, never current admission.
    state={'schema':'trellis2.generation-inputs.v0','status':status,'modelCalls':0,
        'packageReport':'package-report.json','requestedPipelineType':a.pipeline_type,'requestedSteps':a.steps}
    if 'previousManifest' in report:state['previousManifest']=report['previousManifest']
    atomic_text(manifest_path,json.dumps(state,indent=2)+'\n')
persist()
try:
    if manifest_path.exists():
        previous_bytes=manifest_path.read_bytes();previous=json.loads(previous_bytes)
        if previous.get('status')=='succeeded':
            digest=sha(previous_bytes);name='previous-manifest-'+digest+'.json';prior=out/name
            if prior.exists() and file_sha(prior)!=digest:raise ValueError('previous package identity collision')
            if not prior.exists():prior.write_bytes(previous_bytes)
            report['previousManifest']={'file':name,'sha256':digest,'byteLength':len(previous_bytes),
                'reuse':'explicit prior-manifest selection required; not the current attempt'}
        elif previous.get('previousManifest'):
            report['previousManifest']=previous['previousManifest']
    block_current_attempt('running');persist()
    root=a.repo_root.resolve();base=a.base.resolve();foreground=a.foreground.resolve()
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    dirty=subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True)
    if commit!=a.expected_commit or dirty:raise ValueError('exact clean package producer required')
    if a.steps<1:raise ValueError('positive explicit sampler steps required')
    report['producer']={'root':str(root),'commit':commit,'dirty':dirty,'scriptSha256':file_sha(Path(__file__))}
    base_bytes=(base/'manifest.json').read_bytes();original=json.loads(base_bytes)
    if original.get('schema')!='trellis2.generation-inputs.v0' or original.get('status')!='succeeded' or original.get('modelCalls')!=0:
        raise ValueError('complete model-free retained checkpoint base required')
    report['phase']='foreground-admission';persist()
    prep_bytes=(foreground/'report.json').read_bytes();prep=json.loads(prep_bytes)
    if prep.get('status')!='succeeded' or prep['preparation'].get('fallback') or prep['preparation']['foreground_pixels']<1:
        raise ValueError('successful real foreground preparation required; raw fallback is not admitted')
    image_row=prep['files']['prepared-shoe.png'];image_path=Path(image_row['path']).resolve()
    if not image_path.is_relative_to(foreground) or file_sha(image_path)!=image_row['sha256'] or image_path.stat().st_size!=image_row['byteLength']:
        raise ValueError('complete unchanged prepared image required')
    m=copy.deepcopy(original);m['pipelineType']=a.pipeline_type;m['meshResolution']=512 if a.pipeline_type=='512' else 1024;m['samplingSteps']=a.steps
    m['producer']=report['producer'];m['basePackage']={'path':str(base/'manifest.json'),'sha256':sha(base_bytes),'producer':original['producer']}
    if a.pipeline_type=='512':
        del m['models']['highResolutionShape']
        for role in ['shapeDecoder','textureDecoder']:m['models'][role]['config']['resolution']=32
    for role in ['sparseFlow','lowResolutionShape','highResolutionShape','textureFlow']:
        if role in m['models']:m['models'][role]['config']['steps']=a.steps
    needed={original['image']['pixelTensor']}
    needed.update(m['dino']['prefix'].values())
    for layer in m['dino']['layers']:needed.update(layer.values())
    for model in m['models'].values():
        needed.update(model['tensors'].values())
        for key in ['phases','siluTable']:
            if key in model:needed.add(model[key])
    report['phase']='checkpoint-byte-reuse';persist()
    image_tensor=original['image']['pixelTensor'];m['tensors']={k:v for k,v in m['tensors'].items() if k in needed}
    linked=0;linked_bytes=0
    for key,row in m['tensors'].items():
        if key==image_tensor:continue
        if Path(row['file']).name!=row['file']:raise ValueError('safe retained tensor name required')
        source=base/row['file'];target=out/row['file']
        if source.stat().st_size!=row['byteLength']:raise ValueError('partial retained checkpoint '+key)
        if not target.exists():os.link(source,target)
        if not os.path.samefile(source,target):raise ValueError('checkpoint file is not the exact retained inode '+key)
        linked+=1;linked_bytes+=row['byteLength']
    report['phase']='prepared-DINO-pixels';persist()
    with Image.open(image_path) as image:
        rgb=image.convert('RGB');source_size=list(rgb.size)
        resized=rgb.resize((512,512),Image.Resampling.LANCZOS)
        pixels=np.asarray(resized,dtype=np.float32)/np.float32(255)
    mean=np.asarray(original['image']['mean'],dtype=np.float32);std=np.asarray(original['image']['std'],dtype=np.float32)
    values=np.ascontiguousarray(((pixels-mean)/std)[None],dtype='<f4')
    if values.shape!=(1,512,512,3) or not np.isfinite(values).all():raise ValueError('complete finite normalized prepared pixels required')
    # Content-addressed pixels keep an explicit previous package replayable.
    pixel_data=values.tobytes();pixel_file=out/('prepared-pixels-'+sha(pixel_data)+'.f32')
    if pixel_file.exists() and file_sha(pixel_file)!=sha(pixel_data):raise ValueError('prepared pixel identity collision')
    if not pixel_file.exists():pixel_file.write_bytes(pixel_data)
    m['tensors'][image_tensor]={'file':pixel_file.name,'shape':list(values.shape),'dtype':'float32','byteLength':values.nbytes,'sha256':file_sha(pixel_file)}
    m['image']={'sourcePath':str(image_path),'sourceFileSha256':image_row['sha256'],'sourceByteLength':image_row['byteLength'],
        'sourceRgbSize':source_size,'resize':{'size':[512,512],'filter':'PIL.Image.LANCZOS','operationApplied':True},
        'scale':'float32(pixel)/255.0','mean':mean.tolist(),'std':std.tolist(),'layout':'NHWC','dtype':'float32',
        'pixelValuesShape':list(values.shape),'pixelValuesSha256':m['tensors'][image_tensor]['sha256'],'pixelValuesByteLength':values.nbytes,
        'pixelTensor':image_tensor,'preparation':{'reportPath':str(foreground/'report.json'),'reportSha256':sha(prep_bytes),
            'route':prep['effectiveRoute'],'modelCalls':prep['modelCalls'],'provenance':prep['preparation']},
        'handoff':'foreground-prepared normalized pixels; no retained conditioning or learned fields'}
    m['comparison']='explicit foreground-prepared source preview; changed input/settings, browser noise not matched MLX RNG'
    m['status']='succeeded';m['phase']=None
    manifest=json.dumps(m,indent=2)+'\n';atomic_text(manifest_path,manifest)
    report.update(status='succeeded',phase=None,manifestSha256=sha(manifest.encode()),pipelineType=a.pipeline_type,
        meshResolution=m['meshResolution'],samplingSteps=a.steps,textureSize=1024,
        checkpointFilesLinked=linked,checkpointBytesLinked=linked_bytes,pixelTensor=m['tensors'][image_tensor],foregroundModelCalls=prep['modelCalls'])
except Exception as error:
    report.update(status='failed',error={'message':str(error),'traceback':traceback.format_exc()})
finally:
    if report['status']!='succeeded':block_current_attempt('failed')
    persist()
print(json.dumps({k:report.get(k) for k in ['status','phase','pipelineType','meshResolution','samplingSteps','checkpointFilesLinked','manifestSha256','error']}))
sys.exit(0 if report['status']=='succeeded' else 1)

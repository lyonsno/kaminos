"""Append two admitted CPU predictions to a retained baseline motion export.

The caller owns input/output paths. No inference, fitting, or mesh rescaling.
"""
from pathlib import Path
import argparse,copy,hashlib,json,uuid

def read(path):return json.loads(Path(path).read_text())
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,value):Path(path).write_text(json.dumps(value,separators=(',',':'),allow_nan=False)+'\n')
def require(ok,error):
 if not ok:raise ValueError(error)
def checked(path,digest):require(sha(path)==digest,'source_digest:'+str(path))
def validate_report(r,checkpoint,manifest,reg):
 i=r['identity']
 require(r['status']=='observed' and r['primaryOutputWritten'] and r['inputCount']==r['completed']==685,'incomplete_replay')
 require(r['effectiveRoute']=='mobrecon_densestack_dsconv_cpu_replay' and i['device']=='cpu' and i['backend']=='pytorch' and i['decoder']=='dsconv' and i['checkpointSha256']==checkpoint and i['jointRegressorSha256']==reg and r['manifestSha256']==manifest,'replay_identity')
def validate_rows(rows,images):
 import numpy as np
 require(len(rows)==len(images),'partial_payload')
 result={}
 for r,image in zip(rows,images):
  require(r['input']==image and r['captureId']==image['captureId'] and r['sourceSha256']==image['sha256'] and r['status']=='observed' and r['completePredictionValid'],'input_identity')
  v=np.asarray(r['verticesMeters']);require(v.shape==(778,3) and np.isfinite(v).all(),'invalid_vertices');require(r['captureId'] not in result,'duplicate_capture');result[r['captureId']]=r
 return result

def augment_frame(frame,vertices,reg):
 import numpy as np
 f=copy.deepcopy(frame);f['hands']=f['hands'][:3];base=f['hands'][0];world=np.asarray(base['joints'][0])+base['camera']['translation']
 for v in vertices:
  v=np.asarray(v);require(v.shape==(778,3) and np.isfinite(v).all(),'invalid_vertices');j=reg@v;c=copy.deepcopy(base['camera']);c.pop('fitRmsePx',None);c.update(translation=(world-j[0]).tolist(),method='Shared original MobRecon camera and wrist; no independent registration or mesh scale fit',placementAuthority='estimated_shared_wrist_not_calibrated');f['hands'].append(dict(status='observed',vertices=v.tolist(),joints=j.tolist(),cropBox=base['cropBox'],fallback=False,camera=c))
 return f

def prepare(input_path,output,prefix):
 out=Path(output);out.mkdir(parents=True,exist_ok=True);g=uuid.uuid4().hex
 report=dict(status='failed',phase='bootstrap',primaryOutputWritten=False,lastTrustworthyEvidence=None,scriptSha256=sha(__file__),generation=g,inputPath=str(input_path));write(out/'export-report.json',report)
 try:
  import numpy as np
  report['phase']='source_validation';write(out/'export-report.json',report);s=read(input_path);report['inputSha256']=sha(input_path)
  for key in ['handoff','baseCatalog','baseReport','inputManifest','regressor']:checked(s[key],s[key+'Sha256'])
  cat=read(s['baseCatalog']);oldreport=read(s['baseReport']);require(oldreport['status']=='observed' and oldreport['primaryOutputWritten'] and oldreport['catalogSha256']==s['baseCatalogSha256'] and cat['generation']==oldreport['generation'],'base_export_identity')
  expected=['2b634114dadb324802c9e55a8b7a9236f0e7b476157ac0b175f0eb258d9d276c','b3c18c68acca9e41fe8ac06a3ffdb0ea5526b024f5f5cc3ede906c93cf3598d7','bb37e4f55cde37b99a505e13ae216a3d0b0ebd53885fefc567e8ef741be6ae28']
  require([m['checkpointSha256'] for m in cat['models'][:3]]==expected,'baseline_identity');images=read(s['inputManifest'])['images'];require(len(images)==685,'input_count');motion=[x for x in images if x['evaluationSubset']=='replay559'];require(len(motion)==559,'motion_count');require(len(s['models'])==2,'two_variants_required')
  reg=np.load(s['regressor'])[[0,13,14,15,20,1,2,3,16,4,5,6,17,10,11,12,19,7,8,9,18]];native=[];sources=[];models=copy.deepcopy(cat['models'][:3])
  for spec in s['models']:
   for key in ['report','outputs','checkpoint','terminal']:checked(spec[key],spec[key+'Sha256'])
   r=read(spec['report']);validate_report(r,spec['checkpointSha256'],s['inputManifestSha256'],s['regressorSha256']);require(r['outputsSha256']==spec['outputsSha256'],'payload_report_digest');terminal=read(spec['terminal']);require(terminal['status']=='observed' and terminal['replayReport']==spec['report'] and terminal['chain'] and all(x['state']['status']=='done' and x['state']['exit_code']==0 for x in terminal['chain']),'replay_terminal')
   rows=[json.loads(line) for line in Path(spec['outputs']).open()];native.append(validate_rows(rows,images));sources.append(dict(spec,identity=r['identity']));models.append(dict(id=spec['id'],label=spec['label'],checkpointSha256=spec['checkpointSha256'],faces=models[0]['faces'],identity=dict(route=r['effectiveRoute'],reportSha256=spec['reportSha256'],outputsSha256=spec['outputsSha256'],placement='shared_original_world_wrist',units='meters')))
  require(len({m['id'] for m in models})==5,'duplicate_model_id');require({'original','trained'} <= {m['id'] for m in models},'guided_pair_ids');models[0]['alwaysVisible']=models[1]['alwaysVisible']=True
  report.update(phase='export',lastTrustworthyEvidence='two_native_685_CPU_sources_admitted',sources=sources);write(out/'export-report.json',report);folder=out/g;folder.mkdir();sequences=[];moments=[];offset=0;maxerror=0.
  for si,meta in enumerate(cat['sequences']):
   source=Path(s['baseCatalog']).parent/Path(meta['url']).relative_to(s['basePrefix']);checked(source,meta['sha256']);seq=read(source);frames=[];require(seq['models']==cat['models'] and seq['generation']==cat['generation'],'sequence_identity')
   for f in seq['frames']:
    image=motion[offset];require(f['captureId']==image['captureId'] and f['captureEpochMs']==image['captureTimestampMs'],'recording_identity');require(f['timeMs']==f['captureEpochMs']-seq['frames'][0]['captureEpochMs'],'recording_timing');checked(image['path'],image['sha256']);require(f['hands'][0]['camera']['sourceCaptureId']==f['captureId'],'camera_capture_identity');result=augment_frame(f,[n[f['captureId']]['verticesMeters'] for n in native],reg)
    world=np.asarray(f['hands'][0]['joints'][0])+f['hands'][0]['camera']['translation']
    for h in result['hands']:maxerror=max(maxerror,float(np.max(np.abs(np.asarray(h['joints'][0])+h['camera']['translation']-world))))
    frames.append(result);offset+=1
   file=folder/f'sequence-{si}.json';write(file,dict(seq,generation=g,models=models,frames=frames));sequences.append(dict(meta,url=f'{prefix}/{g}/{file.name}',sha256=sha(file)));moments.append(dict(id=f'recording-{si}',title=meta['label'],question='Original, released DSConv and Learned geometry alongside matched continued geometry and mean-neutral size constancy. Raw predictions; common estimated camera/wrist. No per-model fit or scale normalization.',sequence=si,start=0,end=len(frames)-1,frame=0,finger=4,loop=False,captures=dict(start=frames[0]['captureId'],end=frames[-1]['captureId'],frame=frames[0]['captureId'])))
  require(offset==559 and [x['frames'] for x in sequences]==[120,439] and maxerror<1e-14,'motion_preservation')
  write(out/'catalog.json',dict(cat,generation=g,models=models,sequences=sequences,limit='Five native saved models; all559recorded frames, original timing/camera. Variants share original wrist without mesh rescaling. No new inference or registration.'));write(out/'guide.json',dict(schema='hand-state.replay-guide.v1',generation=g,catalogSha256=sha(out/'catalog.json'),moments=moments));report.update(status='observed',phase=None,primaryOutputWritten=True,lastTrustworthyEvidence='five_models_all559frames',frames=offset,models=5,catalogSha256=sha(out/'catalog.json'),maximumSharedWristErrorMeters=maxerror,newInference=False,newTraining=0)
 except BaseException as error:report['error']=repr(error);raise
 finally:write(out/'export-report.json',report)
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--url-prefix',required=True);a=p.parse_args();print(json.dumps(prepare(a.input,a.output,a.url_prefix)))

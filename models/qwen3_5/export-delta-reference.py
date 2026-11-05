"""Native FP32 conformance reference for the WebGPU delta port; run in Greenroom."""
import argparse,importlib.util,json,hashlib,traceback,sys
from pathlib import Path

def module(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def main():
 p=argparse.ArgumentParser();p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--adapter-dir',type=Path,required=True);p.add_argument('--adapter-repo',type=Path,required=True);p.add_argument('--package',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
 r={'status':'failed','phase':'load','modes':[],'precision':'native-port FP32 activations and factor multiplies; BF16 source values expanded losslessly, offset norms sanitized/rounded as conversion'}
 def save(): (a.out/'report.json').write_text(json.dumps(r,indent=2)+'\n')
 save()
 try:
  ref=module('model_reference',Path(__file__).with_name('export-model-reference.py'));ctrl=module('delta_controller',a.adapter_repo/'models/bfl-pup/mlx_switchable_adapter.py');cfg=json.loads((a.model_dir/'config.json').read_text());model,mx=ref.load_native_fp32(a.model_dir,cfg,r)
  # Source BF16 norm sanitization is already rounded in the native base manifest.
  original=ctrl.compute_mlx_exact_swap_pair
  def pair(**kw):
   q,b=original(**kw)
   if ctrl.is_mlx_offset_norm_key(kw['key']):b=b.astype(mx.bfloat16).astype(mx.float32)
   return q,b
  ctrl.compute_mlx_exact_swap_pair=pair
  controller=ctrl.MLXSwitchableDeltaController(model,a.adapter_dir,base_role='qwen')
  for _,_,_,wrapped,exact in controller._wrapped_modules:
   if not exact:
    wrapped._holder.lora_A=wrapped._holder.lora_A.astype(mx.float32);wrapped._holder.lora_B=wrapped._holder.lora_B.astype(mx.float32)
  r['controllerSource']={'path':str(a.adapter_repo/'models/bfl-pup/mlx_switchable_adapter.py'),'sha256':ref.sha((a.adapter_repo/'models/bfl-pup/mlx_switchable_adapter.py').read_bytes())}
  r['modeCount']=3
  from tokenizers import Tokenizer
  import numpy as np
  ids=Tokenizer.from_file(str(a.model_dir/'tokenizer.json')).encode('A red fox.',add_special_tokens=False).ids
  for mode,enabled in [('off',False),('on-r256',True),('off-again',False)]:
   r['phase']=mode;save();controller.set_mode(enabled,rank=256);out=a.out/mode;out.mkdir(exist_ok=True);arrays={};next_ids={}
   def array(name,value):
    mx.eval(value);v=np.ascontiguousarray(np.array(value,dtype=np.float32));assert np.isfinite(v).all();raw=v.tobytes();(out/(name+'.bin')).write_bytes(raw);arrays[name]={'file':name+'.bin','shape':list(v.shape),'bytes':len(raw),'sha256':ref.sha(raw),'dtype':'f32'};return v
   def run(stage,tokens,cache,offset):
    positions=mx.broadcast_to(mx.arange(offset,offset+len(tokens))[None,None,:],(3,1,len(tokens)));sink=[];hidden=model.model(mx.array([tokens]),cache=cache,position_ids=positions,capture_layer_ids=list(range(32)),hidden_sink=sink);logits=model.lm_head(hidden[:,-1:,:]);v=array(stage+'.logits',logits.reshape(-1));array(stage+'.layers',mx.stack([x[0,-1]for x in sink]));array(stage+'.norm',hidden[0,-1]);return int(v.argmax())
   cache=model.make_cache();next_ids['prefill']=run('prefill',ids,cache,0);continuation=[next_ids['prefill']];next_ids['decode']=run('decode',continuation,cache,len(ids));next_ids['full-prefix']=run('full-prefix',ids+continuation,model.make_cache(),0);assert next_ids['decode']==next_ids['full-prefix'];manifest=json.loads((a.package/'weights.json').read_text());meta={'schema':'kaminos.qwen35-model-reference.v1','source':manifest['source'],'weightsManifestSha256':ref.sha((a.package/'weights.json').read_bytes()),'deltaManifestSha256':ref.sha((a.package/'delta.json').read_bytes()),'mode':mode,'enabled':enabled,'rank':256,'effective':r['effective'],'implementation':r['implementation'],'inputIds':ids,'continuationIds':continuation,'expectedNextIds':next_ids,'arrays':arrays};(out/'meta.json').write_text(json.dumps(meta,indent=2)+'\n');(out/'weights.json').write_bytes((a.package/'weights.json').read_bytes());(out/'report.json').write_text(json.dumps({'status':'passed','effective':r['effective'],'metaSha256':ref.sha((out/'meta.json').read_bytes()),'weightsManifestSha256':meta['weightsManifestSha256'],'precision':r['precision']},indent=2)+'\n');r['modes'].append({'mode':mode,'expectedNextIds':next_ids,'metaSha256':ref.sha((out/'meta.json').read_bytes())});save()
  for f in (a.out/'off').glob('*.bin'):assert f.read_bytes()==(a.out/'off-again'/f.name).read_bytes()
  r.update(status='passed',phase='complete',offRoundtripIdentical=True)
 except BaseException:r['error']=traceback.format_exc()
 finally:save()
 print(json.dumps(r));return 0 if r['status']=='passed'else 1
if __name__=='__main__':sys.exit(main())

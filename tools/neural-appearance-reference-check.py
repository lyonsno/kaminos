#!/usr/bin/env python3
"""Retain source angular fields and camera views before fitting the material."""
import argparse,hashlib,json,os,pathlib,subprocess,traceback
import numpy as np

def run(args):
 out=pathlib.Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True);report={'status':'running','phase':'admission','root':str(pathlib.Path.cwd()),'job':os.environ.get('GREENROOM_JOB_ID'),'source':str(pathlib.Path(args.source).resolve()),'captures':[]}
 def save():(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 save()
 try:
  if not report['job']:raise RuntimeError('Greenroom admission required')
  report['commit']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
  if report['commit']!=os.environ.get('EXPECTED_COMMIT') or subprocess.check_output(['git','status','--porcelain'],text=True).strip():raise RuntimeError('Pinned clean source required')
  import mlx.core as mx
  from PIL import Image
  from neural_appearance_patterned_metal import PatternedMetal,reference_queries,reference_footprint,filtered_response
  if not mx.metal.is_available():raise RuntimeError('Metal reference required; no CPU fallback')
  mx.set_default_device(mx.gpu);report['backend']={'library':'mlx','version':mx.__version__,'device':str(mx.default_device()),'metal':True};report['phase']='load-source';save();teacher=PatternedMetal(args.source);report['sourceManifest']=teacher.manifest
  report['phase']='source-response';save();size=128;v,u=np.mgrid[0:size,0:size];uv=np.stack([(u.flatten()+.5)/size,(v.flatten()+.5)/size],axis=-1).astype(np.float32)
  light=np.array([.4,.15,.9041570660],np.float32);light/=np.linalg.norm(light);selected_resolution=args.latent_resolution;footprint=reference_footprint(selected_resolution);report['footprint']=footprint;filter_rng=np.random.Generator(np.random.PCG64(940))
  def encode(name,rgb,width,height):
   rgb=np.asarray(rgb,np.float32);assert np.isfinite(rgb).all() and (rgb>=0).all();raw=rgb.astype('<f4').tobytes();file=out/(name+'.f32');file.write_bytes(raw);display=np.clip(rgb*2,0,1);display=np.where(display<=.0031308,display*12.92,1.055*display**(1/2.4)-.055);png=out/(name+'.png');Image.fromarray(np.round(display*255).astype(np.uint8).reshape(height,width,3)).save(png)
   return {'path':str(file),'sha256':hashlib.sha256(raw).hexdigest(),'image':str(png),'width':width,'height':height,'mean':float(rgb.mean()),'std':float(rgb.std()),'maximum':float(rgb.max()),'displayExposure':2}
  fields={}
  for name,view in [('frontal',[0,0,1]),('near-reflection',[-light[0],-light[1],light[2]]),('grazing',[-.95,0,.3122498999])]:
   q=np.concatenate([uv,np.tile(view,(len(uv),1)),np.tile(light,(len(uv),1))],axis=-1).astype(np.float32);answer=np.asarray(filtered_response(teacher.evaluate,q,filter_rng,footprint,reference=True));assert np.isfinite(answer).all() and (answer>=0).all();fields[name]=encode('field-'+name,answer,size,size)
  report['fields']=fields
  # A replayable independent query batch proves source regeneration on this route.
  rng=np.random.Generator(np.random.PCG64(41));state=rng.bit_generator.state;q=reference_queries(rng,65536,selected_resolution);a=np.asarray(filtered_response(teacher.evaluate,q,rng,footprint));other=np.random.Generator(np.random.PCG64());other.bit_generator.state=state;q2=reference_queries(other,65536,selected_resolution);b=np.asarray(filtered_response(teacher.evaluate,q2,other,footprint));assert np.array_equal(q,q2) and np.array_equal(a,b)
  for name,array in [('replay-queries',q),('replay-labels',a)]:array.astype('<f4').tofile(out/(name+'.f32'))
  report['replay']={'rng':'numpy.PCG64','numpyVersion':np.__version__,'stateBefore':state,'queriesSha256':hashlib.sha256(q.tobytes()).hexdigest(),'labelsSha256':hashlib.sha256(a.tobytes()).hexdigest(),'bitEqual':True,'rawRetained':True,'footprint':footprint,'stateAfter':rng.bit_generator.state}
  # Camera rays against a real plane and sphere, then source evaluation in each
  # surface's tangent frame. These are source pictures, not learned output.
  def unit(x):return x/np.maximum(np.linalg.norm(x,axis=-1,keepdims=True),1e-20)
  width,height=640,400;yy,xx=np.mgrid[:height,:width];sx=(2*(xx+.5)/width-1)*width/height*np.tan(np.deg2rad(35)/2);sy=(1-2*(yy+.5)/height)*np.tan(np.deg2rad(35)/2)
  lights=[(unit(np.array([.4,.5,1.])),[2.4,2.2,1.9]),(unit(np.array([-.7,.2,1.])),[1.1,1.3,1.6]),(unit(np.array([.1,-.8,.5])),[.35,.4,.5])]
  for camera_name,camera in [('front',[0,.25,7.]),('left',[-2.4,.7,6.5]),('right',[2.4,.7,6.5])]:
   camera=np.array(camera);forward=unit(-camera);right=unit(np.cross(forward,[0,1,0]));up=np.cross(right,forward);rays=unit(forward+sx[...,None]*right+sy[...,None]*up).reshape(-1,3)
   tplane=-camera[2]/rays[:,2];p=camera+rays*tplane[:,None];plane=(tplane>0)&(p[:,0]>=-2.8)&(p[:,0]<=-.2)&(abs(p[:,1])<=1.3)
   center=np.array([1.35,0,0]);oc=camera-center;beta=rays@oc;disc=beta*beta-(oc@oc-1.15**2);ts=-beta-np.sqrt(np.maximum(disc,0));sphere=(disc>=0)&(ts>0)&(~plane|(ts<tplane));valid=plane|sphere
   point=p.copy();point[sphere]=camera+rays[sphere]*ts[sphere,None];normal=np.tile([0.,0.,1.],(len(p),1));normal[sphere]=unit(point[sphere]-center)
   tangent=np.tile([1.,0.,0.],(len(p),1));tangent[sphere]=unit(np.stack([normal[sphere,2],np.zeros(sphere.sum()),-normal[sphere,0]],axis=-1));bitangent=np.cross(normal,tangent)
   coords=np.stack([(point[:,0]+2.8)/2.6,(point[:,1]+1.3)/2.6],axis=-1);coords[sphere,0]=np.arctan2(normal[sphere,0],normal[sphere,2])/(2*np.pi)+.5;coords[sphere,1]=np.arccos(np.clip(normal[sphere,1],-1,1))/np.pi
   view=unit(camera-point);project=lambda w:np.stack([np.sum(w*tangent,axis=-1),np.sum(w*bitangent,axis=-1),np.sum(w*normal,axis=-1)],axis=-1)
   for resolution in [None,selected_resolution]:
    source_uv=coords if resolution is None else (np.floor(coords*resolution)+.5)/resolution;color=np.zeros((len(p),3),np.float32)
    for direction,intensity in lights:
     q=np.concatenate([source_uv,project(view),project(np.broadcast_to(direction,view.shape))],axis=-1).astype(np.float32);q=q[valid];rgb=np.asarray(teacher.evaluate(mx.array(q)) if resolution is None else filtered_response(teacher.evaluate,q,filter_rng,footprint));assert np.isfinite(rgb).all() and (rgb>=0).all();color[valid]+=rgb*np.array(intensity,np.float32)
    item=encode(camera_name+'-'+('source4k' if resolution is None else str(resolution)),color,width,height);item.update(camera=camera.tolist(),latentGrid=resolution,meaning='Untrained source; three directional lights, no environment',footprint=reference_footprint(4096) if resolution is None else footprint,filterSamples=1 if resolution is None else footprint['trainingSamples']);report['captures'].append(item);save()
  # Magnified raw-vs-point-vs-prefiltered patches expose the native detail that
  # a whole-material camera image can undersample. Each patch spans256 source
  # texels at256 output pixels. Retain all raw radiance, without display blur.
  report['phase']='magnified-source-detail';save();size=256;v,u=np.mgrid[:size,:size];patch_uv=np.stack([.30+(u.flatten()+.5)/4096,.30+(v.flatten()+.5)/4096],axis=-1)
  for mode in ['source4k','point'+str(selected_resolution),'filtered'+str(selected_resolution)]:
   uv=patch_uv if mode=='source4k' else (np.floor(patch_uv*selected_resolution)+.5)/selected_resolution
   q=np.concatenate([uv,np.tile([-light[0],-light[1],light[2]],(len(uv),1)),np.tile(light,(len(uv),1))],axis=-1).astype(np.float32)
   rgb=teacher.evaluate(mx.array(q)) if not mode.startswith('filtered') else filtered_response(teacher.evaluate,q,filter_rng,footprint,reference=True)
   item=encode('detail-'+mode,rgb,size,size);item.update(meaning='Untrained source near-reflection;256-native-texel patch at1:1;point-coarse is a rejected aliasing control',mode=mode,uvMin=[.30,.30],uvExtent=[256/4096]*2,filterSamples=256 if mode.startswith('filtered') else 1);report['captures'].append(item);save()
  report['status']='passed';report['phase']='complete';report['claim']='Pinned MaterialX graph port produces finite angular response at the recorded native/coarse footprints and deterministic source replay; source visual quality still requires retained-image inspection. No NVIDIA-backend parity or learned appearance claim.'
 except BaseException:
  report['status']='failed';report['error']=traceback.format_exc();raise
 finally:save()
 return report

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');p.add_argument('--latent-resolution',type=int,default=512);a=p.parse_args();run(a)

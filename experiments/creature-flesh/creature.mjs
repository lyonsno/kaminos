import * as THREE from '../../lib/three.core.js';
import {createGpuSkinDeformer} from '../creature-motion/gpu-skin-deformer.mjs';
import {createGpuFleshVolume} from './gpu-volume.mjs';
import {prepareSmoothFleshEmbedding} from './embedding.mjs';
import {addFleshOffsets,torsoNodeWeights} from './torso.mjs';
import {skinTransport,transportDualQuaternions} from '../../hindquarter-live-core.mjs';

export async function loadCreatureFlesh(spec,data){
 if(!spec)return data;
 const source=spec.preparations?.find(p=>p.case_sha256===data.source.caseSha256);
 if(!source||typeof source.url!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256??''))throw Error('This cast has no matching physical preparation');
 const response=await fetch(source.url,{cache:'no-store'});if(!response.ok)throw Error('Physical preparation HTTP '+response.status);
 const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==source.sha256)throw Error('Physical preparation hash mismatch');
 const p=JSON.parse(new TextDecoder().decode(bytes));if(p.schema!=='kaminos.creature-flesh.torso-proxy.v0'||p.source.caseSha256!==data.source.caseSha256||p.source.vertices!==data.manifest.vertices||p.source.channels!==data.manifest.channels.length)throw Error('Physical preparation differs from the actual cast');
 return {...data,fleshPrepared:p};
}

// A deformer for the ordinary creature. Same physical device/state/material as
// the accepted contact experiment; no extra renderer or private frame loop.
export function createCreatureFleshDeformer({enabled=true,interpolation='smooth'}={}){
 if(typeof enabled!=='boolean'||!['linear','smooth'].includes(interpolation))throw Error('Invalid creature flesh settings');
 return args=>{
  const prepared=args.fleshPrepared;if(!prepared)throw Error('Physical creature requires its verified preparation');
  const embedding=interpolation==='smooth'?prepareSmoothFleshEmbedding(prepared):prepared,volume=createGpuFleshVolume(prepared),skin=createGpuSkinDeformer({...args,physical:embedding,physicalAttribute:volume.attribute});
  volume.setEnabled(enabled);
  const nodeRest=Float32Array.from(prepared.positions.flat()),weights=torsoNodeWeights(prepared,args.manifest.channels),C=args.channels;
  let running=false,validated=false,validationStarted=false,error=null,accumulator=0,palette=null,currentRotations=null,lastRotations=null,pending=null,snapshotEpoch=-1,snapshotPose='',poseKey='',offsets=prepared.positions.map(()=>[0,0,0]),pick=null,pickKey='',disposed=false;
  const update=matrices=>{
   skin.update(matrices);palette=matrices;poseKey=matrices.flat().join(',');
   const points=skinTransport(nodeRest,weights,matrices),{real}=transportDualQuaternions(matrices);
   currentRotations=prepared.positions.map((_,i)=>{let dominant=0;for(let j=1;j<C;j++)if(weights[i*C+j]>weights[i*C+dominant])dominant=j;const q=[0,0,0,0];for(let j=0;j<C;j++){const sign=real[j].reduce((s,x,k)=>s+x*real[dominant][k],0)<0?-1:1;for(let k=0;k<4;k++)q[k]+=sign*weights[i*C+j]*real[j][k];}const n=Math.hypot(...q);return new THREE.Quaternion(q[1]/n,q[2]/n,q[3]/n,q[0]/n);});
   const delta=currentRotations.map((q,i)=>{const r=lastRotations?q.clone().multiply(lastRotations[i].clone().invert()):new THREE.Quaternion();return[r.w,r.x,r.y,r.z];});
   volume.setTargets(Array.from({length:prepared.positions.length},(_,i)=>Array.from(points.subarray(i*3,i*3+3))),delta);
  };
  const current=()=>snapshotEpoch===volume.read().epoch&&snapshotPose===poseKey;
  async function snapshot(){const key=poseKey,result=await volume.snapshot();if(key===poseKey&&result.epoch===volume.read().epoch){offsets=result.offsets;snapshotEpoch=result.epoch;snapshotPose=key;}return result;}
  return {
   update,flush(renderer){volume.bind(renderer);skin.flush(renderer);if(!validationStarted){validationStarted=true;volume.validate().then(()=>{validated=true;}).catch(e=>{error=e.message;});}
    if(validated&&!running&&!current()&&!pending)pending=snapshot().catch(e=>{error=e.message;}).finally(()=>{pending=null;});
   },
   advance(seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('Finite nonnegative flesh time required');if(error)throw Error(error);accumulator+=seconds;if(!validated)return;
    while(accumulator>=1/60){volume.step(1/60);lastRotations=currentRotations.map(q=>q.clone());accumulator-=1/60;}skin.invalidate();
   },
   setRunning(value){if(typeof value!=='boolean')throw Error('Boolean flesh run state required');running=value;},
   setEnabled(value){if(typeof value!=='boolean')throw Error('Boolean flesh response required');enabled=value;volume.setEnabled(value);skin.invalidate();},
   setContacts:contacts=>volume.setCapsules(contacts),
   capsules(){const p=volume.targets(),c=prepared.construction.crossSection,s=prepared.construction.sections,m=(c-1)/2,centers=[],radii=[];for(let k=0;k<s;k++){const center=p[(k*c+m)*c+m];centers.push(center);radii.push(Math.max(...[p[(k*c+m)*c],p[(k*c+m)*c+c-1],p[(k*c)*c+m],p[(k*c+c-1)*c+m]].map(q=>Math.hypot(...q.map((v,a)=>v-center[a])))));}return [{a:centers[1],b:centers[s-2],radius:radii[Math.floor(s/2)]}];},
   snapshot,mirrorKey:()=>volume.read().epoch+':'+poseKey,
   cpuPositions(base){if(volume.read().steps>0&&!current())throw Error('Pause the creature for an exact physical snapshot/export');return addFleshOffsets(base,embedding,offsets);},
   // Picking is an explicit current skeletal-pose proxy during live physics;
   // export/diagnostic geometry above always requires the exact held snapshot.
   pickGeometry(data,matrices){const key=poseKey+':'+(current()?snapshotEpoch:'pose-proxy');if(pick&&key===pickKey)return pick;const points=skinTransport(data.rest,data.weights,matrices),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(current()?addFleshOffsets(points,embedding,offsets):points,3));g.setIndex(new THREE.BufferAttribute(data.triangles,1));g.computeBoundingBox();g.computeBoundingSphere();pick?.dispose();pick=g;pickKey=key;return g;},
   readback:()=>skin.readback(),read:()=>({...skin.read(),flesh:{enabled,interpolation,validated,error,running,pendingSeconds:accumulator,...volume.read(),cpuShape:{current:current(),snapshotEpoch,picking:current()?'physical-snapshot':'current-skeletal-pose-proxy',export:'exact-held-physical-snapshot'}}}),
   dispose(){if(disposed)return;disposed=true;pick?.dispose();skin.dispose();volume.dispose();},
  };
 };
}

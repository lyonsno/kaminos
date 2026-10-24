import * as THREE from '../../lib/three.core.js';
import {createGpuSkinDeformer} from '../creature-motion/gpu-skin-deformer.mjs';
import {createGpuFleshVolume} from './gpu-volume.mjs';
import {prepareSmoothFleshEmbedding} from './embedding.mjs';
import {addFleshOffsets,torsoNodeWeights,prepareMovementSupports} from './torso.mjs';
import {skinTransport,transportDualQuaternions} from '../../hindquarter-live-core.mjs';
import {prepareGpuPhysicalEmbedding} from '../creature-motion/gpu-skin-data.mjs';

const smoothEmbeddings=new WeakMap();
function embeddingFor(prepared,interpolation){
 if(interpolation!=='smooth')return prepared;
 if(!smoothEmbeddings.has(prepared))smoothEmbeddings.set(prepared,prepareSmoothFleshEmbedding(prepared));
 return smoothEmbeddings.get(prepared);
}

// Only the small authored material lattice is evaluated here. No renderer,
// physical stepping or dense-skin deformation is needed to refuse a bad Open.
export function validateCreatureFleshPoses(data,poses){
 const prepared=data.fleshPrepared;if(!prepared)return;
 const {channels,bones}=data.manifest,rest=Float32Array.from(prepared.positions.flat()),weights=torsoNodeWeights(prepared,channels),volume=createGpuFleshVolume(prepared);
 const inverse=new Map(bones.map(b=>[b.name,new THREE.Matrix4().set(...b.restMatrix.flat()).invert()]));
 try{for(const pose of poses){
  const local=new Map(pose.bones.map(b=>[b.name,b])),world=new Map();
  const at=name=>{if(!world.has(name)){const b=local.get(name);if(!b)throw Error('Physical pose differs from the given bone inventory');const m=new THREE.Matrix4().fromArray(b.localMatrix);if(b.parent)m.premultiply(at(b.parent));world.set(name,m);}return world.get(name);};
  const palette=[new THREE.Matrix4().toArray(),...channels.slice(1).map(name=>at(name).clone().multiply(inverse.get(name)).toArray())],points=skinTransport(rest,weights,palette);
  volume.setTargets(Array.from({length:prepared.positions.length},(_,i)=>Array.from(points.subarray(i*3,i*3+3))));
 }}finally{volume.dispose();}
}

export async function loadCreatureFlesh(spec,data){
 if(!spec)return data;
 const source=spec.preparations?.find(p=>p.case_sha256===data.source.caseSha256);
 if(!source||typeof source.url!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256??''))throw Error('This cast has no matching physical preparation');
 const response=await fetch(source.url,{cache:'no-store'});if(!response.ok)throw Error('Physical preparation HTTP '+response.status);
 const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==source.sha256)throw Error('Physical preparation hash mismatch');
 const p=JSON.parse(new TextDecoder().decode(bytes));if(p.schema!=='kaminos.creature-flesh.torso-proxy.v0'||p.source.caseSha256!==data.source.caseSha256||p.source.vertices!==data.manifest.vertices||p.source.channels!==data.manifest.channels.length)throw Error('Physical preparation differs from the actual cast');
 // Open must exercise the same lattice, transfer and volume admission as
 // construction before the shared entry releases its current working room.
 const embedding=embeddingFor(p,spec.interpolation??'smooth');prepareGpuPhysicalEmbedding(embedding,data.manifest.vertices);
 torsoNodeWeights(p,data.manifest.channels);
 const profile=p.construction?.profile;if(!Array.isArray(profile)||profile.length!==p.construction.sections||!profile.every(s=>Array.isArray(s.radius)&&s.radius.length===2&&s.radius.every(v=>Number.isFinite(v)&&v>0)))throw Error('Complete finite torso section profile required');
 const volume=createGpuFleshVolume(p);volume.dispose();
 return {...data,fleshPrepared:p};
}

// A deformer for the ordinary creature. Same physical device/state/material as
// the accepted contact experiment; no extra renderer or private frame loop.
export function createCreatureFleshDeformer({enabled=true,interpolation='smooth'}={}){
 if(typeof enabled!=='boolean'||!['linear','smooth'].includes(interpolation))throw Error('Invalid creature flesh settings');
 return args=>{
  const prepared=args.fleshPrepared;if(!prepared)throw Error('Physical creature requires its verified preparation');
  const embedding=embeddingFor(prepared,interpolation),volume=createGpuFleshVolume(prepared),skin=createGpuSkinDeformer({...args,physical:embedding,physicalAttribute:volume.attribute});
  volume.setEnabled(enabled);
  const nodeRest=Float32Array.from(prepared.positions.flat()),weights=torsoNodeWeights(prepared,args.manifest.channels),C=args.channels;
  const support=prepareMovementSupports(args),supportRest=Float32Array.from(support.positions.flat());
  let running=false,validated=false,validationStarted=false,error=null,accumulator=0,palette=null,currentRotations=null,lastRotations=null,pending=null,snapshotEpoch=-1,snapshotPose='',poseKey='',offsets=prepared.positions.map(()=>[0,0,0]),disposed=false;
  const boneRest=args.manifest.bones.map(b=>({...b,at:b.restMatrix.slice(0,3).map(r=>r[3]),channel:args.manifest.channels.indexOf(b.name)})),pickRadius=prepared.construction.profile[Math.floor(prepared.construction.sections/2)].radius[0];
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
   contactNodes:()=>volume.targets().filter((_,i)=>!prepared.pinned[i]),
   movementCores(){if(!palette)return[];const p=skinTransport(supportRest,support.weights,palette);return support.positions.map((_,i)=>({a:Array.from(p.subarray(i*3,i*3+3)),b:Array.from(p.subarray(i*3,i*3+3)),radius:support.radii[i],part:support.parts[i]}));},
   capsules(){const p=volume.targets(),c=prepared.construction.crossSection,s=prepared.construction.sections,m=(c-1)/2,centers=[],radii=[];for(let k=0;k<s;k++){const center=p[(k*c+m)*c+m];centers.push(center);radii.push(Math.max(...[p[(k*c+m)*c],p[(k*c+m)*c+c-1],p[(k*c)*c+m],p[(k*c+c-1)*c+m]].map(q=>Math.hypot(...q.map((v,a)=>v-center[a])))));}return [{a:centers[1],b:centers[s-2],radius:radii[Math.floor(s/2)]}];},
   snapshot,mirrorKey:()=>volume.read().epoch+':'+poseKey,
   cpuPositions(base){if(volume.read().steps>0&&!current())throw Error('Pause the creature for an exact physical snapshot/export');return addFleshOffsets(base,embedding,offsets);},
   // Selection uses small rig-supported hit shapes, never a dense CPU skin
   // solve or a GPU readback on the pointer path. Export remains exact/held.
   raycast(raycaster,hits,object){
    const world=object.matrixWorld,scale=new THREE.Vector3().setFromMatrixScale(world).x,points=new Map(boneRest.map(b=>[b.name,new THREE.Vector3(...b.at).applyMatrix4(new THREE.Matrix4().fromArray(palette[b.channel])).applyMatrix4(world)]));
    const shapes=this.capsules().map(c=>({a:new THREE.Vector3(...c.a).applyMatrix4(world),b:new THREE.Vector3(...c.b).applyMatrix4(world),radius:c.radius*scale}));
    for(const bone of boneRest){const a=points.get(bone.name),b=points.get(bone.parent)??a;shapes.push({a,b,radius:pickRadius*scale*(bone.name==='head'?.5:bone.name.includes('hip')?.4:bone.name.startsWith('tail')?.1:.2)});}
    let closest=null;for(const shape of shapes){const onRay=new THREE.Vector3(),onAxis=new THREE.Vector3(),d2=raycaster.ray.distanceSqToSegment(shape.a,shape.b,onRay,onAxis);if(d2>shape.radius**2)continue;const along=onRay.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction),distance=Math.max(0,along-Math.sqrt(Math.max(0,shape.radius**2-d2)));if(distance<raycaster.near||distance>raycaster.far||closest&&distance>=closest.distance)continue;closest={distance,point:raycaster.ray.at(distance,new THREE.Vector3()),object,face:null};}if(closest)hits.push(closest);
   },
   readback:()=>skin.readback(),read:()=>({...skin.read(),flesh:{enabled,interpolation,validated,error,running,pendingSeconds:accumulator,...volume.read(),cpuShape:{current:current(),snapshotEpoch,picking:'rig-capsule-selection-proxy',export:'exact-held-physical-snapshot'}}}),
   dispose(){if(disposed)return;disposed=true;skin.dispose();volume.dispose();},
  };
 };
}

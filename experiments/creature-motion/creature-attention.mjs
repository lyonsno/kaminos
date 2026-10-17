import {createAttentionPolicy} from './attention-policy.mjs';
import {createLookPoseModifier} from './look-pose.mjs';

// Head-local muzzle forward/up for one cast, measured from its own skin: the
// front-most head-weighted vertices relative to the head joint at rest. Bone
// axes and tails are not muzzle directions on these rigs.
export function deriveHeadProfile({skin,frame,head='head',tip='head-end',chest='spine-chest',threshold=.5,count=200}) {
 const fail=message=>{throw Error(message);};
 const channels=skin?.manifest?.channels,vertices=skin?.manifest?.vertices;
 if(!Array.isArray(channels)||!Number.isInteger(vertices))fail('Head profile requires the cast manifest channels and vertex count');
 const {rest,weights}=skin;
 if(rest?.length!==vertices*3||weights?.length!==vertices*channels.length)fail('Head profile requires complete rest positions and weights');
 const specs=new Map((frame?.bones??[]).map(b=>[b.name,b]));
 for(const name of [head,chest])if(!specs.has(name))fail(`Head profile requires rig Bone "${name}"`);
 const headChannel=channels.indexOf(head),tipChannel=channels.indexOf(tip);
 if(headChannel<0)fail(`Cast has no weight channel for "${head}"`);
 const restOf=name=>specs.get(name).restMatrix;
 const position=name=>[0,1,2].map(r=>restOf(name)[r][3]);
 const headPosition=position(head),chestPosition=position(chest);
 const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
 const unit=v=>{const l=Math.hypot(...v);if(!(l>1e-9))fail('Degenerate head profile direction');return v.map(x=>x/l);};
 const body=unit(sub(headPosition,chestPosition));
 const rows=[];
 for(let v=0;v<vertices;v++){
  const w=weights[v*channels.length+headChannel]+(tipChannel<0?0:weights[v*channels.length+tipChannel]);
  if(w>threshold)rows.push([rest[v*3],rest[v*3+1],rest[v*3+2]]);
 }
 if(rows.length<count)fail(`Too few head-weighted vertices (${rows.length}) to measure a muzzle`);
 rows.sort((a,b)=>dot(b,body)-dot(a,body));
 const front=rows.slice(0,count).reduce((s,p)=>s.map((x,i)=>x+p[i]/count),[0,0,0]);
 const forwardRest=unit(sub(front,headPosition));
 // Head rest rotation columns are the head-local axes in rest space.
 const m=restOf(head),toLocal=v=>[0,1,2].map(c=>m[0][c]*v[0]+m[1][c]*v[1]+m[2][c]*v[2]);
 const forward=unit(toLocal(forwardRest)),upRest=toLocal([0,1,0]);
 const up=unit(sub(upRest,forward.map(x=>x*dot(upRest,forward))));
 return {forward,up,method:'front-most head-weighted rest vertices',headWeightedVertices:rows.length,sampled:count,muzzleRest:front};
}

const smooth=(rate,dt)=>1-Math.exp(-dt/Math.max(rate,1e-6));

// Autonomous attention for one creature. It reads interests from the scene,
// lets the policy choose and remember a focus, and expresses it as a bounded,
// blended neck/head correction over the creature's own animated pose.
export function createCreatureAttention({THREE,rigFrame,profile,interests,options={}}) {
 if(typeof interests!=='function')throw Error('Creature attention requires an interest source');
 const o={noticeRadius:3,fieldOfView:1.9,threshold:.12,boredSeconds:3.5,recoverSeconds:6,renotice:.75,acquireSeconds:.35,releaseSeconds:.6,aimSeconds:.18,maxYaw:1.05,maxPitch:.55,neckShare:.4,reach:1.35,...options};
 const policy=createAttentionPolicy({minDwellSeconds:.6,defaultMemorySeconds:1.2,switchMargin:.05});
 const lookFor=p=>createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:p.forward,up:p.up,maxYaw:o.maxYaw,maxPitch:o.maxPitch,neckShare:o.neckShare});
 let look=lookFor(profile);
 const habituation=new Map();
 let weight=0,aim=null,lastTime=null,focus=null,noticed=[],reachable=false,error=null,enabled=true;

 const reticle=new THREE.Group();reticle.name='Attention focus';
 Object.assign(reticle.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true,kaminosAttentionReticle:true});
 const ringMaterial=new THREE.LineBasicMaterial({color:0xffc857,depthTest:false,transparent:true,opacity:.95});
 for(const rotate of [[0,0,0],[Math.PI/2,0,0],[0,Math.PI/2,0]]){
  const ring=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:40},(_,i)=>new THREE.Vector3(Math.cos(i/40*Math.PI*2),Math.sin(i/40*Math.PI*2),0))),ringMaterial);
  ring.rotation.set(...rotate);ring.renderOrder=999;reticle.add(ring);
 }
 reticle.visible=false;

 function poseOf(bones,group){
  group.updateMatrixWorld(true);
  return {actorMatrix:group.matrixWorld.toArray(),bones:[...bones.values()].map(bone=>({name:bone.name,parent:bone.parent?.isBone?bone.parent.name:null,localMatrix:bone.matrix.toArray(),worldMatrix:bone.matrixWorld.toArray()}))};
 }
 const worldPosition=bone=>new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);

 function modify({bones,group,time,placement}){
  if(!enabled){reticle.visible=false;return;}
  const dt=lastTime===null?0:Math.max(0,time-lastTime);lastTime=time;
  try{
   group.updateMatrixWorld(true);
   const head=bones.get('head'),chest=bones.get('spine-chest');
   const headAt=worldPosition(head),body=headAt.clone().sub(worldPosition(chest));body.y=0;
   if(body.lengthSq()<1e-12)throw Error('Creature body heading is degenerate');body.normalize();
   noticed=[];const observations=[];
   for(const source of interests()){
    const toward=new THREE.Vector3(...source.point).sub(headAt),distance=toward.length();
    const flat=toward.clone();flat.y=0;
    const angle=flat.lengthSq()>1e-12?body.angleTo(flat):0;
    const view=Math.max(0,1-Math.max(0,angle-o.fieldOfView*.5)/(o.fieldOfView*.35));
    const near=Math.max(0,1-distance/o.noticeRadius);
    const novelty=Math.exp(-(habituation.get(source.id)??0)/o.boredSeconds);
    // Holding a focus only needs it to stay salient; catching attention again
    // needs it to be fairly fresh, so a just-released thing is not re-grabbed.
    const fresh=source.id===focus?.id||novelty>=o.renotice;
    const raw=source.interest*view*near*near*novelty,score=fresh?Math.max(0,raw-o.threshold):0;
    noticed.push({id:source.id,label:source.label,distance,angle,view,novelty,fresh,score});
    // Only salient things count as observed now; a dull or unseen focus is
    // carried by the policy's brief memory and then released.
    if(score>0)observations.push({id:source.id,point:source.point,score,reason:source.reason});
   }
   focus=policy.update({time,observations}).focus;
   for(const [id,seconds] of habituation)habituation.set(id,Math.max(0,seconds-dt*o.boredSeconds/o.recoverSeconds));
   if(focus)habituation.set(focus.id,(habituation.get(focus.id)??0)+dt*(1+o.boredSeconds/o.recoverSeconds));
   let want=0;
   if(focus){
    const target=new THREE.Vector3(...focus.point),flat=target.clone().sub(headAt);flat.y=0;
    reachable=flat.lengthSq()<1e-12||body.angleTo(flat)<=o.reach;want=reachable?1:0;
    aim=aim?aim.lerp(target,smooth(o.aimSeconds,dt)):target;
   }else reachable=false;
   weight+=(want-weight)*smooth(want>weight?o.acquireSeconds:o.releaseSeconds,dt);
   if(weight<1e-3&&!focus){weight=0;aim=null;}
   if(aim&&weight>0){
    const out=look.apply(poseOf(bones,group),{target:aim.toArray(),strength:Math.min(1,weight)});
    if(out.applied){
     for(const name of ['neck','head']){const row=out.pose.bones.find(b=>b.name===name);new THREE.Matrix4().fromArray(row.localMatrix).decompose(bones.get(name).position,bones.get(name).quaternion,bones.get(name).scale);}
     group.updateMatrixWorld(true);
    }
   }
   reticle.visible=Boolean(focus)&&weight>.2;
   if(reticle.visible&&placement){
    placement.updateMatrixWorld(true);
    reticle.position.copy(placement.worldToLocal(new THREE.Vector3(...focus.point)));
    const s=new THREE.Vector3().setFromMatrixScale(placement.matrixWorld);reticle.scale.set(.05/s.x,.05/s.y,.05/s.z);
   }
   error=null;
  }catch(failure){error=failure.message;reticle.visible=false;throw failure;}
 }

 function read(){
  return {enabled,weight,reachable,error,profile:structuredClone(profile),
   focus:focus?structuredClone(focus):null,aim:aim?aim.toArray():null,
   noticed:structuredClone(noticed).sort((a,b)=>b.score-a.score),
   habituation:Object.fromEntries(habituation),options:{...o}};
 }
 function setEnabled(value){if(typeof value!=='boolean')throw Error('Attention enabled must be boolean');enabled=value;if(!value){policy.reset();focus=null;weight=0;aim=null;lastTime=null;reticle.visible=false;}return read();}
 // A different cast on the same rig has its own muzzle; keep focus and memory.
 function setProfile(next){const replacement=lookFor(next);look=replacement;profile=next;return read();}
 function dispose(){reticle.removeFromParent();reticle.traverse(node=>{node.geometry?.dispose();});ringMaterial.dispose();}
 return Object.freeze({modify,read,setEnabled,setProfile,reticle,dispose});
}

// Authored interests attached to existing scene objects, resolved live so that
// moving or removing the prop changes what the creature can notice.
export function sceneObjectInterests({THREE,root,specs}) {
 if(!Array.isArray(specs))throw Error('Interests must be an array');
 const checked=specs.map(spec=>{
  if(typeof spec?.object!=='string'||!spec.object.trim())throw Error('Interest requires a scene object id');
  if(!Number.isFinite(spec.interest)||spec.interest<0)throw Error('Interest strength must be finite and nonnegative');
  if(spec.anchor!==undefined&&!['top','center'].includes(spec.anchor))throw Error('Unknown interest anchor');
  return {object:spec.object,interest:spec.interest,anchor:spec.anchor??'top',reason:spec.reason??'authored interest'};
 });
 const boxes=new Map();
 function find(id){let found=null;root().traverse(node=>{if(!found&&node.userData?.kaminosSceneObject?.id===id)found=node;});return found;}
 function localBox(object){
  if(!boxes.has(object)){
   object.updateMatrixWorld(true);const inverse=object.matrixWorld.clone().invert(),box=new THREE.Box3();
   object.traverse(node=>{if(!node.geometry)return;node.geometry.computeBoundingBox?.();if(!node.geometry.boundingBox)return;box.union(node.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(node.matrixWorld)));});
   if(box.isEmpty())box.setFromCenterAndSize(new THREE.Vector3(),new THREE.Vector3());boxes.set(object,box);
  }
  return boxes.get(object);
 }
 return ()=>checked.flatMap(spec=>{
  const object=find(spec.object);if(!object)return [];
  const box=localBox(object),center=box.getCenter(new THREE.Vector3());if(spec.anchor==='top')center.y=box.max.y;
  object.updateMatrixWorld(true);
  return [{id:spec.object,label:object.userData.kaminosSceneObject.label??spec.object,point:center.applyMatrix4(object.matrixWorld).toArray(),interest:spec.interest,reason:spec.reason}];
 });
}

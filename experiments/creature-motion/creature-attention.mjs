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

// Ground points around a creature for sampling light, snapped to a fixed world
// grid so a point sampled again is the same point: static light and shade read
// the same each time, and only real change in the world shows up.
export function lightSamplePoints({center,radius,ground,count=8,cell=.25}) {
 if(!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0||!Number.isFinite(ground))throw Error('Light samples require a finite center, radius and ground height');
 const snap=v=>Math.round(v/cell)*cell,seen=new Set(),points=[];
 for(let i=0;i<count;i++){
  const x=snap(center[0]+Math.cos(i/count*Math.PI*2)*radius),z=snap(center[2]+Math.sin(i/count*Math.PI*2)*radius),key=`${x},${z}`;
  if(!seen.has(key)){seen.add(key);points.push([x,ground,z]);}
 }
 return points;
}

const smooth=(rate,dt)=>1-Math.exp(-dt/Math.max(rate,1e-6));
// Small deterministic generator so idle looking around replays identically.
function generator(seed){let a=seed>>>0||1;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}

// Autonomous attention for one creature. Looks have causes: a thing seen for
// the first time, a familiar thing that moved, a forgotten thing seen again,
// or idle looking around. Inspecting a thing makes it familiar, which is what
// ends a look; familiarity fades over minutes. Every look records its cause.
export function createCreatureAttention({THREE,rigFrame,profile,interests,options={}}) {
 if(typeof interests!=='function')throw Error('Creature attention requires an interest source');
 const o={noticeRadius:3,fieldOfView:1.9,threshold:.12,inspectSeconds:1.6,forgetSeconds:180,inspectedAt:.85,forgottenAt:.3,impulseSeconds:1.2,moveSpeed:.05,moveDistance:.05,
  adaptSeconds:2.5,flareAt:.35,shadowAt:.5,lightFloor:.002,lightCell:.25,lightForgetSeconds:30,idleScan:true,scanEvery:[4,9],scanSeconds:1.2,scanStrength:.5,scanDistance:1.5,seed:1,onEvent:()=>{},
  minDwellSeconds:1.5,switchMargin:.12,memorySeconds:.8,restSeconds:2,startle:.3,acquireSeconds:.35,releaseSeconds:.6,aimSeconds:.18,maxYaw:1.05,maxPitch:.55,neckShare:.4,reach:1.35,...options};
 const policy=createAttentionPolicy({minDwellSeconds:o.minDwellSeconds,defaultMemorySeconds:o.memorySeconds,switchMargin:o.switchMargin});
 const lookFor=p=>createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:p.forward,up:p.up,maxYaw:o.maxYaw,maxPitch:o.maxPitch,neckShare:o.neckShare});
 let look=lookFor(profile);
 const random=generator(o.seed),memory=new Map(),history=[],pendingLight=[],lightSources=new Map();
 let light={status:'none',time:null,samples:0,last:null,flareArmed:true};
 const patches=new Map();
 let weight=0,aim=null,lastTime=null,focus=null,why=null,restUntil=-Infinity,quietSince=0,nextScan=null,scan=null,scans=0,candidates=[],reachable=false,error=null,enabled=true;

 const reticle=new THREE.Group();reticle.name='Attention focus';
 Object.assign(reticle.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true,kaminosAttentionReticle:true});
 const ringMaterial=new THREE.LineBasicMaterial({color:0xffc857,depthTest:false,transparent:true,opacity:.95});
 for(const rotate of [[0,0,0],[Math.PI/2,0,0],[0,Math.PI/2,0]]){
  // Closed Line, not LineLoop: the WebGPU renderer does not draw LineLoop.
  const ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:41},(_,i)=>new THREE.Vector3(Math.cos(i/40*Math.PI*2),Math.sin(i/40*Math.PI*2),0))),ringMaterial);
  ring.rotation.set(...rotate);ring.renderOrder=999;reticle.add(ring);
 }
 // Optional in-view caption with the cause of the current look.
 let caption=null,captionText='';
 const canvas=o.document?.createElement?.('canvas');
 if(typeof canvas?.getContext==='function'&&canvas.getContext('2d')){
  canvas.width=512;canvas.height=96;
  const texture=new THREE.CanvasTexture(canvas),material=new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true});
  caption=new THREE.Sprite(material);caption.renderOrder=1000;caption.center.set(.5,0);caption.scale.set(5.3,1,1);caption.position.set(0,1.4,0);caption.userData.canvas=canvas;reticle.add(caption);
 }
 function setCaption(text){
  if(!caption||text===captionText)return;captionText=text;
  const canvas=caption.userData.canvas,g=canvas.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);
  g.font='600 40px system-ui, sans-serif';const width=Math.min(canvas.width,g.measureText(text).width+28);
  g.fillStyle='rgba(20,22,24,.72)';g.fillRect(0,14,width,64);g.fillStyle='#ffc857';g.fillText(text,14,60);caption.material.map.needsUpdate=true;
 }
 reticle.visible=false;

 function poseOf(bones,group){
  return {actorMatrix:group.matrixWorld.toArray(),bones:[...bones.values()].map(bone=>({name:bone.name,parent:bone.parent?.isBone?bone.parent.name:null,localMatrix:bone.matrix.toArray(),worldMatrix:bone.matrixWorld.toArray()}))};
 }
 const worldPosition=bone=>new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
 const remember=(kind,time,extra)=>{const event={kind,time,...extra};history.push(event);if(history.length>32)history.shift();try{o.onEvent(event);}catch{}};
 const memo=id=>{if(!memory.has(id))memory.set(id,{familiarity:0,everSeen:false,seen:false,last:null,impulse:0,cause:null});return memory.get(id);};

 function modify({bones,group,time,placement}){
  if(!enabled){reticle.visible=false;return;}
  const dt=lastTime===null?0:Math.max(0,time-lastTime);lastTime=time;
  try{
   // Playback updates world matrices before calling the modifier.
   const head=bones.get('head'),chest=bones.get('spine-chest');
   const headAt=worldPosition(head),body=headAt.clone().sub(worldPosition(chest));body.y=0;
   if(body.lengthSq()<1e-12)throw Error('Creature body heading is degenerate');body.normalize();
   const sight=(point,range=o.noticeRadius,fov=o.fieldOfView)=>{const toward=new THREE.Vector3(...point).sub(headAt),distance=toward.length(),flat=toward.clone();flat.y=0;
    const angle=flat.lengthSq()>1e-12?body.angleTo(flat):0,view=fov>=2*Math.PI?1:Math.max(0,1-Math.max(0,angle-fov*.5)/(fov*.35));
    return {distance,angle,view,visible:view>0&&distance<range};};
   const decay=Math.exp(-dt/o.impulseSeconds),forget=Math.exp(-dt/o.forgetSeconds);
   candidates=[];const observations=[];
   // Light events sensed since the last frame: alert the creature to their
   // source wherever it is (light reaches all around).
   for(const event of pendingLight.splice(0)){
    const m=memo(event.id);m.familiarity*=.4;m.impulse=Math.max(m.impulse,event.strength);m.cause=event.cause;m.alerted=true;m.eventAt=time;m.inspected=false;
    // The light already reached the creature, so its source counts however far.
    lightSources.set(event.id,{id:event.id,label:event.label,point:event.point,interest:event.strength,noticeRadius:Infinity,until:time+o.impulseSeconds*3});
   }
   const listed=interests(),ids=new Set(listed.map(x=>x.id));
   for(const [id,x] of lightSources)if(time>x.until&&focus?.id!==id)lightSources.delete(id);
   for(const source of [...listed,...[...lightSources.values()].filter(x=>!ids.has(x.id))]){
    const m=memo(source.id),significance=source.interest,active=source.active!==false;
    // Per-source cause names (a flame is lit, flares up, flickers) and its own
    // forgetting time: a restless source never stays familiar for long.
    const names={lit:'lit',changed:'changed',again:'noticed again',...source.causes};
    // Bright things such as flame are seen from farther than ordinary props.
    const range=source.noticeRadius??o.noticeRadius;
    const forgetThis=Math.exp(-dt/(source.forgetSeconds??o.forgetSeconds));
    const lit=active&&m.wasActive===false,changed=m.version!==undefined&&source.version!==undefined&&source.version!==m.version;
    m.wasActive=active;m.version=source.version;
    const hidden={distance:Infinity,angle:Math.PI,view:0,visible:false};
    const plain=active?sight(source.point,range):hidden;
    // Sudden changes (a flame lit or flaring) are noticed over a wider field
    // than steady presence; once alerted, the creature looks until it has seen it.
    const wide=active&&source.eventFieldOfView?sight(source.point,range,source.eventFieldOfView):plain;
    if((lit||changed)&&wide.visible){m.alerted=true;m.eventAt=time;}
    const s=m.alerted&&active?sight(source.point,range,2*Math.PI):plain;
    const moved=m.last?Math.hypot(...source.point.map((v,i)=>v-m.last[i])):0;
    m.impulse*=decay;
    if(s.visible){
     // Causes fire on transitions and changes, not on mere presence.
     if(lit||(m.everSeen&&!m.seen&&m.litUnseen)){m.familiarity*=.4;m.impulse=Math.max(m.impulse,significance);m.cause=names.lit;m.litUnseen=false;m.inspected=false;}
     else if(changed||(m.everSeen&&!m.seen&&m.changedUnseen)){m.familiarity*=.4;m.impulse=Math.max(m.impulse,significance);m.cause=names.changed;m.changedUnseen=false;m.inspected=false;}
     else if(m.everSeen&&(moved>o.moveDistance&&(dt===0||moved/Math.max(dt,1e-6)>o.moveSpeed)||(!m.seen&&m.movedUnseen))){m.familiarity*=.4;m.impulse=Math.max(m.impulse,significance);m.cause='moved';m.movedUnseen=false;}
     else if(!m.seen&&!m.inspected&&m.eventAt!==time){m.impulse=Math.max(m.impulse,significance*(1-m.familiarity));m.cause=m.forgotten?names.again:m.started?'back to it':'first sight';}
     m.everSeen=true;
    }else{if(m.everSeen&&moved>o.moveDistance)m.movedUnseen=true;if(lit)m.litUnseen=true;if(changed&&active)m.changedUnseen=true;}
    m.seen=s.visible;m.last=[...source.point];
    const attended=focus?.id===source.id;
    // Inspected once familiar enough; forgotten only after it fades well below.
    if(attended){m.started=true;m.familiarity+=(1-m.familiarity)*smooth(o.inspectSeconds,dt);if(m.familiarity>=o.inspectedAt){m.inspected=true;m.forgotten=false;m.alerted=false;}}
    else{m.familiarity*=forgetThis;if(m.inspected&&m.familiarity<o.forgottenAt){m.inspected=false;m.forgotten=true;m.started=false;}}
    // A thing seen but not yet inspected keeps its pull while in view; an
    // inspected (familiar) thing pulls only through a fresh cause.
    // It waits its turn: only a fresh event interrupts an ongoing inspection.
    const inspecting=focus&&!focus.id.startsWith('look-around-');
    const pending=m.everSeen&&!m.inspected&&(!inspecting||attended)?significance*(1-m.familiarity):0;
    if(pending>m.impulse&&!attended&&m.eventAt!==time)m.cause=m.forgotten?names.again:m.started?'back to it':'first sight';
    // A look lasts until the thing is inspected, however weak its pull at a distance.
    const drive=attended?Math.max(m.impulse,m.familiarity<o.inspectedAt?significance:0):Math.max(m.impulse,pending);
    // Only a sudden event can draw the eye beyond comfortable neck reach;
    // presence alone there would be an invisible look.
    const withinReach=s.angle<=o.reach||m.alerted;
    const near=Math.max(0,1-s.distance/range),score=s.visible&&withinReach?Math.max(0,drive*(attended?1:s.view*(.5+.5*near))-o.threshold):0;
    candidates.push({id:source.id,label:source.label??source.id,cause:m.cause,familiarity:m.familiarity,impulse:m.impulse,distance:s.distance,angle:s.angle,score});
    const resting=!focus&&time<restUntil;
    if(score>(resting?o.startle:0))observations.push({id:source.id,point:source.point,score,reason:m.cause??'authored interest'});
   }
   // Idle looking around: a brief look at a spot beside the path ahead.
   if(o.idleScan){
    if(nextScan===null)nextScan=time+o.scanEvery[0]+random()*(o.scanEvery[1]-o.scanEvery[0]);
    if(!scan&&!focus&&time>=nextScan&&time>=restUntil){
     const side=random()<.5?-1:1,turn=side*(.5+random()*.5),dir=body.clone().applyAxisAngle(new THREE.Vector3(0,1,0),turn);
     scan={id:`look-around-${++scans}`,point:headAt.clone().addScaledVector(dir,o.scanDistance).toArray(),impulse:o.scanStrength,started:time};
    }
    if(scan){
     scan.impulse*=decay;const score=Math.max(0,scan.impulse-o.threshold);
     candidates.push({id:scan.id,label:'around',cause:'looking around',impulse:scan.impulse,score});
     if(score>0&&time-scan.started<o.scanSeconds+o.minDwellSeconds)observations.push({id:scan.id,point:scan.point,score,reason:'looking around'});else scan=null;
    }
   }
   const previous=focus;focus=policy.update({time,observations}).focus;
   if(focus&&focus.id!==previous?.id){
    const c=candidates.find(x=>x.id===focus.id);
    why={cause:focus.reason,id:focus.id,label:c?.label??focus.id,since:time,familiarity:c?.familiarity??null,competitors:candidates.filter(x=>x.id!==focus.id&&x.score>0).map(x=>({id:x.id,label:x.label,cause:x.cause,score:x.score}))};
    remember('look',time,{id:why.id,label:why.label,cause:why.cause,from:previous?.id??null});
   }
   // A fresh event on the thing already being looked at says why the look goes on.
   if(focus&&focus.id===previous?.id&&why&&memory.get(focus.id)?.eventAt===time){const m=memory.get(focus.id);why={...why,cause:m.cause,since:time};remember('look',time,{id:why.id,label:why.label,cause:why.cause,from:focus.id});}
   if(previous&&!focus){restUntil=time+o.restSeconds;remember('release',time,{id:previous.id,label:why?.label,cause:why?.cause,held:time-(why?.since??time)});why=null;quietSince=time;nextScan=null;}
   if(scan&&focus?.id!==scan.id&&previous?.id===scan.id)scan=null;
   let want=0;
   if(focus){
    const target=new THREE.Vector3(...focus.point),flat=target.clone().sub(headAt);flat.y=0;
    // Beyond comfortable reach the head stays put, unless the creature was
    // alerted by a sudden change: then it turns as far as it can.
    reachable=flat.lengthSq()<1e-12||body.angleTo(flat)<=o.reach;want=reachable||memory.get(focus.id)?.alerted?1:0;
    aim=aim?aim.lerp(target,smooth(o.aimSeconds,dt)):target;
   }else reachable=false;
   weight+=(want-weight)*smooth(want>weight?o.acquireSeconds:o.releaseSeconds,dt);
   if(weight<1e-3&&!focus){weight=0;aim=null;}
   if(aim&&weight>0){
    const out=look.apply(poseOf(bones,group),{target:aim.toArray(),strength:Math.min(1,weight)});
    if(out.applied){
     for(const name of ['neck','head']){const row=out.pose.bones.find(b=>b.name===name);new THREE.Matrix4().fromArray(row.localMatrix).decompose(bones.get(name).position,bones.get(name).quaternion,bones.get(name).scale);}
     bones.get('neck').updateMatrixWorld(true);
    }
   }
   reticle.visible=Boolean(focus)&&weight>.2;
   if(reticle.visible&&placement){
    placement.updateMatrixWorld(true);
    reticle.position.copy(placement.worldToLocal(new THREE.Vector3(...focus.point)));
    const sc=new THREE.Vector3().setFromMatrixScale(placement.matrixWorld);reticle.scale.set(.05/sc.x,.05/sc.y,.05/sc.z);
    setCaption(why?(why.cause==='looking around'?'looking around':`${why.cause} · ${why.label}`):'');
   }
   error=null;
  }catch(failure){error=failure.message;reticle.visible=false;throw failure;}
 }

 // Light around the creature, sampled elsewhere (e.g. the fire light field at
 // world points). Change against a slowly adapting baseline is what counts:
 // a flare draws a look at the light's source, a sudden local darkening
 // draws a look at where the shadow fell. Steady light, bright or dim, does not.
 function sense({time,samples,source=null,status='effective'}){
  if(!enabled)return;
  if(status!=='effective'||!Array.isArray(samples)){light={...light,status,time};return;}
  if(!Number.isFinite(time))throw Error('Light sense requires a finite time');
  const dt=light.time===null?0:Math.max(0,time-light.time);
  // Light is remembered per fixed patch of ground, not per sample slot, so
  // walking through static light and shade changes nothing; a patch seen for
  // the first time simply starts its own baseline.
  const k=smooth(o.adaptSeconds,dt),eps=o.lightFloor;let flare=null,shadow=null,brightest=-Infinity;
  for(const x of samples){
   if(!Number.isFinite(x.luminance)||!Array.isArray(x.point))continue;
   const key=`${x.point[0].toFixed(4)},${x.point[2].toFixed(4)}`;
   let patch=patches.get(key);
   if(!patch){patches.set(key,{value:x.luminance,armed:true,seen:time});continue;}
   const change=Math.log((x.luminance+eps)/(patch.value+eps));
   brightest=Math.max(brightest,change);
   // Each change is reported once; it re-arms after the light settles.
   if(change>o.flareAt&&light.flareArmed&&(!flare||change>flare.change))flare={change};
   if(change<-o.shadowAt&&patch.armed&&(!shadow||change<shadow.change))shadow={change,point:x.point,patch};
   if(change>-o.shadowAt*.5)patch.armed=true;
   patch.value+=(x.luminance-patch.value)*k;patch.seen=time;
  }
  for(const [key,patch] of patches)if(time-patch.seen>o.lightForgetSeconds)patches.delete(key);
  if(brightest<o.flareAt*.5)light.flareArmed=true;
  if(flare)light.flareArmed=false;
  if(shadow)shadow.patch.armed=false;
  if(flare&&source)pendingLight.push({id:source.id,label:source.label??source.id,point:[...source.point],cause:'light flared',strength:Math.min(2,.6+flare.change)});
  if(shadow)pendingLight.push({id:'shadow',label:'shadow',point:[...shadow.point],cause:'shadow',strength:Math.min(2,.6-shadow.change*.5)});
  light={...light,status,time,samples:samples.length,last:samples.map(x=>x.luminance)};
 }
 function read(){
  return {enabled,weight,light:{status:light.status,time:light.time,samples:light.samples},reachable,error,profile:structuredClone(profile),
   focus:focus?structuredClone(focus):null,why:why?structuredClone(why):null,aim:aim?aim.toArray():null,
   candidates:structuredClone(candidates).sort((a,b)=>b.score-a.score),history:structuredClone(history),
   familiarity:Object.fromEntries([...memory].map(([id,m])=>[id,m.familiarity])),options:Object.fromEntries(Object.entries(o).filter(([,v])=>typeof v!=='function'&&typeof v!=='object'||Array.isArray(v)))};
 }
 function setEnabled(value){if(typeof value!=='boolean')throw Error('Attention enabled must be boolean');enabled=value;if(!value){policy.reset();focus=null;why=null;scan=null;nextScan=null;weight=0;aim=null;lastTime=null;restUntil=-Infinity;reticle.visible=false;}return read();}
 // A different cast on the same rig has its own muzzle; keep focus and memory.
 function setProfile(next){const replacement=lookFor(next);look=replacement;profile=next;return read();}
 function dispose(){reticle.removeFromParent();reticle.traverse(node=>{node.geometry?.dispose();node.material?.map?.dispose();});ringMaterial.dispose();caption?.material.dispose();}
 return Object.freeze({modify,sense,read,setEnabled,setProfile,reticle,dispose});
}

// Authored interests attached to existing scene objects, resolved live so that
// moving or removing the prop changes what the creature can notice.
export function sceneObjectInterests({THREE,root,specs}) {
 if(!Array.isArray(specs))throw Error('Interests must be an array');
 const checked=specs.map(spec=>{
  if(typeof spec?.object!=='string'||!spec.object.trim())throw Error('Interest requires a scene object id');
  if(!Number.isFinite(spec.interest)||spec.interest<0)throw Error('Interest strength must be finite and nonnegative');
  if(spec.anchor!==undefined&&!['top','center'].includes(spec.anchor))throw Error('Unknown interest anchor');
  if(spec.label!==undefined&&(typeof spec.label!=='string'||!spec.label.trim()))throw Error('Interest label must be a nonempty string');
  return {object:spec.object,interest:spec.interest,anchor:spec.anchor??'top',reason:spec.reason??'authored interest',label:spec.label};
 });
 const boxes=new Map(),found=new Map();
 const attached=(object,scene)=>{let node=object;while(node.parent)node=node.parent;return node===scene;};
 // Look each prop up once; search the scene again only after it leaves it.
 function find(id){const scene=root(),cached=found.get(id);if(cached&&cached.userData?.kaminosSceneObject?.id===id&&attached(cached,scene))return cached;
  let hit=null;scene.traverse(node=>{if(!hit&&node.userData?.kaminosSceneObject?.id===id)hit=node;});if(hit)found.set(id,hit);else found.delete(id);return hit;}
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
  return [{id:spec.object,label:spec.label??object.userData.kaminosSceneObject.label??spec.object,point:center.applyMatrix4(object.matrixWorld).toArray(),interest:spec.interest,reason:spec.reason}];
 });
}

// The scene's flame as an interest, read through the shared flame workbench.
// It can be seen only while burning, and while burning and not frozen it is
// restless, so creatures keep glancing back at it. Flares are not read from
// its settings: they reach creatures as light, through the light sense.
export function flameInterests({THREE,root,workbench,interest=1.5,id='flame-emitter',pollMs=500,now=()=>performance.now()}) {
 if(typeof workbench?.read!=='function')throw Error('Flame interest requires the shared flame workbench');
 if(!Number.isFinite(interest)||interest<0)throw Error('Flame interest must be finite and nonnegative');
 let state={active:false,paused:false},polled=-Infinity,cached=null,dirty=false;
 // Edits re-read the flame's state promptly instead of waiting for the poll.
 const unsubscribe=workbench.subscribe?.(()=>{dirty=true;})??(()=>{});
 function find(){const scene=root();if(cached&&cached.userData?.kaminosSceneObject?.id===id){let node=cached;while(node.parent)node=node.parent;if(node===scene)return cached;}
  cached=null;scene.traverse(node=>{if(!cached&&node.userData?.kaminosSceneObject?.id===id)cached=node;});return cached;}
 function read(){
  const object=find();if(!object)return [];
  const time=now();if(dirty||time-polled>=pollMs){polled=time;dirty=false;try{const r=workbench.read();state={active:r?.active===true,paused:r?.paused===true};}catch{state={active:false,paused:false};}}
  return [{id,label:'flame',point:new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).toArray(),interest,noticeRadius:12,active:state.active,
   restless:state.active&&!state.paused,forgetSeconds:state.active&&!state.paused?8:undefined,causes:{lit:'flame lit',again:'flickering'}}];
 }
 return Object.freeze({read,dispose(){unsubscribe();}});
}

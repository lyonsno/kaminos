import {createAttentionPolicy} from './attention-policy.mjs';
import {createSignalFamiliarity} from './signal-familiarity.mjs';
import {applyStartlePose} from './startle-pose.mjs';
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
  adaptSeconds:6,glanceSeconds:1,flareAt:.5,lightShadows:false,shadowDepth:.4,shadowAt:.2,shadowReach:.8,lightFloor:.002,darkFraction:.25,lightCell:.25,lightForgetSeconds:30,idleScan:true,scanEvery:[4,9],scanSeconds:1.2,scanStrength:.5,scanDistance:1.5,seed:1,onEvent:()=>{},
  familiarSeconds:180,interruptSeconds:.65,investigateSeconds:1.8,stillSeconds:.18,lossRate:.3,
  lingerSeconds:2.5,urgencyGain:2.5,keepFraction:.4,minDwellSeconds:1.5,switchMargin:.12,memorySeconds:.8,restSeconds:2,startle:.3,acquireSeconds:.35,releaseSeconds:.6,aimSeconds:.18,maxYaw:1.05,maxPitch:.55,neckShare:.4,reach:1.35,...options};
 const policy=createAttentionPolicy({minDwellSeconds:o.minDwellSeconds,defaultMemorySeconds:o.memorySeconds,switchMargin:o.switchMargin});
 const lookFor=p=>createLookPoseModifier({THREE,rigFrame,neck:'neck',head:'head',forward:p.forward,up:p.up,maxYaw:o.maxYaw,maxPitch:o.maxPitch,neckShare:o.neckShare});
 let look=lookFor(profile);
 const random=generator(o.seed),memory=new Map(),history=[],pendingLight=[],lightSources=new Map();
 let light={status:'none',time:null,samples:0,last:null,flareArmed:true,powerNow:null,powerUsual:null},shadows=0;
 const patches=new Map();
 const states=new Map(),powerHistory=createSignalFamiliarity({decaySeconds:o.familiarSeconds});
 let interruption=null,powerDropArmed=true,startle=null,onset=null,previousPower=null;
 const localLevels=new Map();
 let gazeLocal=null;
 let weight=0,lastUrgency=0,aim=null,lastTime=null,focus=null,why=null,restUntil=-Infinity,quietSince=0,nextScan=null,scan=null,scans=0,candidates=[],reachable=false,error=null,enabled=true;

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
 function interrupt({id,cause,familiarity,evidence},time){
  // One perceived cessation may arrive through source state and light power.
  if(cause==='light faded'&&states.get(id)?.previous==='off')return;
  if(interruption?.id===id&&time-interruption.since<o.glanceSeconds)return;
  const surprise=1-familiarity;
  interruption={id,cause,familiarity,surprise,since:time,until:time+o.interruptSeconds+o.investigateSeconds*surprise,evidence};
  startle=null;onset=null;
  policy.reset();focus=null;why=null;scan=null;nextScan=null;
  const m=memory.get(id);if(m){m.impulse=0;m.urgency=0;m.alerted=false;}
  remember('interrupt',time,structuredClone(interruption));
 }
 function recoilAmount(response,time){
  if(!response)return 0;
  const elapsed=time-response.since,attack=.09,release=Math.max(.01,response.until-response.since-attack);
  return elapsed<attack?response.initialStrength+(response.strength-response.initialStrength)*Math.sin(Math.max(0,elapsed)/attack*Math.PI/2):response.strength*Math.pow(Math.max(0,1-(elapsed-attack)/release),2);
 }
 function recoil({id,point,strength,familiarity,evidence},time){
  const duration=.4+strength*(.9-.6*familiarity);
  startle={id,point:[...point],initialStrength:recoilAmount(startle,time),strength,familiarity,since:time,until:time+duration,holdUntil:time+.15+.3*strength,evidence};
  remember('startle',time,structuredClone(startle));
 }
 const motionSeconds=(from,to)=>{
  if(!enabled)return Math.max(0,to-from);
  const spans=[interruption&&[interruption.since,interruption.until],startle&&[startle.since,startle.holdUntil]].filter(Boolean).map(([a,b])=>[Math.max(from,a),Math.min(to,b)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  let held=0,end=from;for(const [a,b] of spans){held+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
  return Math.max(0,to-from-held);
 };

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
   if(interruption&&time>=interruption.until){remember('settled',time,{id:interruption.id,cause:interruption.cause});interruption=null;restUntil=time+o.restSeconds;}
   if(startle&&time>=startle.until)startle=null;
   candidates=[];const observations=[];
   // Light events sensed since the last frame: alert the creature to their
   // source wherever it is (light reaches all around).
   for(const event of pendingLight.splice(0)){
    const m=memo(event.id);m.evidence=event.evidence??null;m.urgency=Math.max(m.urgency??0,event.urgency??event.strength);m.familiarity*=.4;m.impulse=Math.max(m.impulse,event.strength);m.cause=event.cause;m.alerted=true;m.eventAt=time;m.inspected=false;
    // The light already reached the creature, so its source counts however far.
    lightSources.set(event.id,{id:event.id,label:event.label,point:event.point,interest:event.strength,noticeRadius:Infinity,transient:true,until:time+o.impulseSeconds*3});
   }
   const listed=interests(),ids=new Set(listed.map(x=>x.id));
   for(const [id,x] of lightSources)if(time>x.until&&focus?.id!==id)lightSources.delete(id);
   const sources=[...listed,...[...lightSources.values()].filter(x=>!ids.has(x.id))];
   // A remembered light event is not a current observation of its source.
   for(const [id,known] of states)if(!ids.has(id)){known.memory.gap();known.previous=null;if(onset?.id===id)onset=null;}
   for(const source of sources){
    const m=memo(source.id),significance=source.interest,active=source.active!==false&&source.sensed!==false;
    // Per-source cause names (a flame is lit, flares up, flickers) and its own
    // forgetting time: a restless source never stays familiar for long.
    const names={lit:'lit',changed:'changed',again:'noticed again',...source.causes};
    // Bright things such as flame are seen from farther than ordinary props.
    const range=source.noticeRadius??o.noticeRadius;
    // Learn only a source state that can actually be observed. A failed read
    // or a source outside view is a gap, not an observed disappearance.
    if(source.restless!==undefined||source.active!==undefined){
     let known=states.get(source.id);if(!known){known={memory:createSignalFamiliarity({decaySeconds:o.familiarSeconds}),previous:null};states.set(source.id,known);}
     // An ongoing look turns the head independently of the walking body.
     // Keep observing that source through the actual last presented gaze;
     // memory or a requested aim alone is not evidence that it remains in view.
     const gaze=gazeLocal?.clone().transformDirection(group.matrixWorld);
     const toward=new THREE.Vector3(...source.point).sub(headAt);
     const watched=focus?.id===source.id&&gaze&&toward.length()<range&&gaze.angleTo(toward)<o.fieldOfView*.85;
     if(source.sensed!==false&&(sight(source.point,range).visible||watched)){
      const state=!active?'off':source.restless?'moving':'still',learned=known.memory.observe({time,value:state});
      known.familiarity=learned.familiarity;
      if(known.previous&&known.previous!=='off'&&state==='off')interrupt({id:source.id,cause:'light went out',familiarity:learned.familiarity,evidence:{from:known.previous,to:state}},time);
      else if(known.previous==='moving'&&state==='still')interrupt({id:source.id,cause:'movement stopped',familiarity:learned.familiarity,evidence:{from:known.previous,to:state}},time);
      else if(known.previous==='still'&&state==='moving'){m.impulse=Math.max(m.impulse,significance);m.urgency=Math.max(m.urgency??0,significance);m.familiarity*=.4;m.alerted=true;m.eventAt=time;m.inspected=false;m.cause='movement resumed';}
      if(known.previous==='off'&&state!=='off')onset={id:source.id,since:time,observedOver:dt,familiarity:learned.familiarity};
      if(state==='off'&&onset?.id===source.id)onset=null;
      known.previous=state;
     }else{known.memory.gap();known.previous=null;if(onset?.id===source.id)onset=null;}
    }
    const forgetThis=Math.exp(-dt/(source.forgetSeconds??o.forgetSeconds));
    const lit=active&&m.wasActive===false,changed=m.version!==undefined&&source.version!==undefined&&source.version!==m.version;
    m.wasActive=source.sensed===false?undefined:active;m.version=source.version;
    const hidden={distance:Infinity,angle:Math.PI,view:0,visible:false};
    const plain=active?sight(source.point,range):hidden;
    // Sudden changes (a flame lit or flaring) are noticed over a wider field
    // than steady presence; once alerted, the creature looks until it has seen it.
    const wide=active&&source.eventFieldOfView?sight(source.point,range,source.eventFieldOfView):plain;
    if((lit||changed)&&wide.visible){m.alerted=true;m.eventAt=time;}
    const s=m.alerted&&active?sight(source.point,range,2*Math.PI):plain;
    const moved=m.last?Math.hypot(...source.point.map((v,i)=>v-m.last[i])):0;
    m.impulse*=decay;m.urgency=(m.urgency??0)*Math.exp(-dt/o.lingerSeconds);
    if(s.visible){
     // Causes fire on transitions and changes, not on mere presence.
     if(lit||(m.everSeen&&!m.seen&&m.litUnseen)){m.familiarity*=.4;m.impulse=Math.max(m.impulse,significance);m.urgency=Math.max(m.urgency??0,significance);m.cause=names.lit;m.litUnseen=false;m.inspected=false;}
     else if(changed||(m.everSeen&&!m.seen&&m.changedUnseen)){m.familiarity*=.4;m.impulse=Math.max(m.impulse,significance);m.urgency=Math.max(m.urgency??0,significance);m.cause=names.changed;m.changedUnseen=false;m.inspected=false;}
     else if(m.everSeen&&(moved>o.moveDistance&&(dt===0||moved/Math.max(dt,1e-6)>o.moveSpeed)||(!m.seen&&m.movedUnseen))){m.familiarity*=.4;m.impulse=Math.max(m.impulse,significance);m.urgency=Math.max(m.urgency??0,significance*Math.min(2,.5+(dt>0?moved/dt:0)));m.eventAt=time;m.cause='moved';m.movedUnseen=false;}
     else if(!m.seen&&!m.inspected&&m.eventAt!==time&&!source.transient){m.impulse=Math.max(m.impulse,significance*(1-m.familiarity));m.cause=m.forgotten?names.again:m.started?'back to it':'first sight';}
     m.everSeen=true;
    }else{if(m.everSeen&&moved>o.moveDistance)m.movedUnseen=true;if(lit)m.litUnseen=true;if(changed&&active)m.changedUnseen=true;}
    m.seen=s.visible;m.last=[...source.point];
    const attended=focus?.id===source.id;
    // Inspected once familiar enough; forgotten only after it fades well below.
    if(attended){m.started=true;m.familiarity+=(1-m.familiarity)*smooth(o.inspectSeconds,dt);if(m.familiarity>=o.inspectedAt){m.inspected=true;m.forgotten=false;}}
    else{m.familiarity*=forgetThis;if(m.inspected&&m.familiarity<o.forgottenAt){m.inspected=false;m.forgotten=true;m.started=false;}}
    // An alert lasts while its urgency does, so an urgent look can linger on
    // something outside the usual field of view.
    if(m.alerted&&m.inspected&&(m.urgency??0)<.15)m.alerted=false;
    // A thing seen but not yet inspected keeps its pull while in view; an
    // inspected (familiar) thing pulls only through a fresh cause.
    // It waits its turn: only a fresh event interrupts an ongoing inspection.
    const inspecting=focus&&!focus.id.startsWith('look-around-');
    const pending=!source.transient&&m.everSeen&&!m.inspected&&(!inspecting||attended)?significance*(1-m.familiarity):0;
    if(pending>m.impulse&&!attended&&m.eventAt!==time)m.cause=m.forgotten?names.again:m.started?'back to it':'first sight';
    // A look lasts until the thing is inspected, however weak its pull at a distance.
    // An urgent look lingers: its urgency fades over seconds and holds the look.
    const drive=attended?Math.max(m.impulse,m.familiarity<o.inspectedAt?significance:0,m.urgency>.15?m.urgency:0):Math.max(m.impulse,pending);
    // Only a sudden event can draw the eye beyond comfortable neck reach;
    // presence alone there would be an invisible look.
    const withinReach=s.angle<=o.reach||m.alerted;
    // Hysteresis: catching the eye takes the full threshold, keeping it less.
    const near=Math.max(0,1-s.distance/range),score=s.visible&&withinReach?Math.max(0,drive*(attended?1:s.view*(.5+.5*near))-o.threshold*(attended?o.keepFraction:1)):0;
    candidates.push({id:source.id,label:source.label??source.id,cause:m.cause,familiarity:m.familiarity,impulse:m.impulse,distance:s.distance,angle:s.angle,score});
    const resting=!focus&&time<restUntil;
    const canRedirect=interruption&&time-interruption.since>=o.stillSeconds&&(m.eventAt??-Infinity)>interruption.since;
    if((!interruption||canRedirect)&&score>(resting?o.startle:0))observations.push({id:source.id,point:source.point,score,reason:m.cause??'authored interest'});
   }
   // Idle looking around: a brief look at a spot beside the path ahead.
   if(o.idleScan&&!interruption){
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
   if(interruption&&observations.length){remember('resolved',time,{id:interruption.id,cause:interruption.cause,resolvedBy:observations[0].id});interruption=null;}
   const previous=focus;focus=policy.update({time,observations}).focus;
   if(focus&&focus.id!==previous?.id){
    const c=candidates.find(x=>x.id===focus.id);
    why={cause:focus.reason,id:focus.id,label:c?.label??focus.id,since:time,familiarity:c?.familiarity??null,competitors:candidates.filter(x=>x.id!==focus.id&&x.score>0).map(x=>({id:x.id,label:x.label,cause:x.cause,score:x.score}))};
    remember('look',time,{id:why.id,label:why.label,cause:why.cause,from:previous?.id??null,...(memory.get(focus.id)?.eventAt!==undefined&&memory.get(focus.id)?.evidence?{evidence:memory.get(focus.id).evidence}:{})});
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
    const u=memory.get(focus.id)?.urgency??0,quick=1+o.urgencyGain*u;
    aim=aim?aim.lerp(target,smooth(o.aimSeconds/quick,dt)):target;
   }else reachable=false;
   if(interruption){
    // First arrest, then sample alternate sides. These are sample directions,
    // not a claimed source location or a focus reticle on an invented object.
    const elapsed=time-interruption.since;
    if(elapsed>=o.stillSeconds){
     const phase=(elapsed-o.stillSeconds)/Math.max(.01,interruption.until-interruption.since-o.stillSeconds);
     const turn=phase<.4?.8:phase<.8?-.8:.25;
     const target=headAt.clone().addScaledVector(body.clone().applyAxisAngle(new THREE.Vector3(0,1,0),turn),o.scanDistance);
     aim=aim?aim.lerp(target,smooth(.08,dt)):target;
    }
    want=aim?1:0;
   }
   // Bigger, faster changes turn the head faster and let it go more slowly.
   const urgency=focus?memory.get(focus.id)?.urgency??0:lastUrgency;if(focus)lastUrgency=urgency;
   weight+=(want-weight)*smooth(want>weight?o.acquireSeconds/(1+o.urgencyGain*urgency):o.releaseSeconds*(1+urgency),dt);
   if(weight<1e-3&&!focus){weight=0;aim=null;}
   if(aim&&weight>0){
    const out=look.apply(poseOf(bones,group),{target:aim.toArray(),strength:Math.min(1,weight)});
    if(out.applied){
     for(const name of ['neck','head']){const row=out.pose.bones.find(b=>b.name===name);new THREE.Matrix4().fromArray(row.localMatrix).decompose(bones.get(name).position,bones.get(name).quaternion,bones.get(name).scale);}
     bones.get('neck').updateMatrixWorld(true);
    }
   }
   if(startle)applyStartlePose({THREE,bones,point:startle.point,strength:recoilAmount(startle,time)});
   gazeLocal=new THREE.Vector3(...profile.forward).transformDirection(head.matrixWorld).transformDirection(group.matrixWorld.clone().invert());
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
 function sense({time,samples,source=null,sourcePower=null,status='effective'}){
  if(!enabled)return;
  const valid=Array.isArray(samples)&&samples.length>0&&samples.every(x=>Number.isFinite(x.luminance)&&x.luminance>=0&&Array.isArray(x.point)&&x.point.length===3&&x.point.every(Number.isFinite));
  if(status!=='effective'||!valid){light={...light,status:status==='effective'?(samples?.length?'invalid':'empty'):status,time};powerHistory.gap();light.powerNow=null;light.powerUsual=null;light.lossSpeed=0;localLevels.clear();previousPower=null;onset=null;return;}
  if(!Number.isFinite(time))throw Error('Light sense requires a finite time');
  const dt=light.time===null?0:Math.max(0,time-light.time);
  // A source observed off then on is a real onset even when its renderer left
  // the old light atlas resident while off. Local illumination sets amplitude;
  // an unavailable probe or first sight alone cannot supply that measurement.
  const known=source&&states.get(source.id),litOnset=Boolean(onset&&source&&onset.id===source.id&&known?.previous!=='off');
  const raw=samples.map(x=>x.luminance).sort((a,b)=>a-b),local=raw[Math.floor(raw.length/2)];
  const priorLevels=new Map(localLevels);localLevels.clear();
  const contrasts=samples.flatMap(x=>{const key=x.point.join(','),before=priorLevels.get(key);localLevels.set(key,x.luminance);return before===undefined?[]:[Math.log((x.luminance+o.lightFloor)/(before+o.lightFloor))];}).sort((a,b)=>a-b);
  const contrast=litOnset?Math.log1p(local/o.lightFloor):contrasts.length?contrasts[Math.floor(contrasts.length/2)]:0;
  const sourceRise=Number.isFinite(sourcePower)&&previousPower!==null?Math.log((sourcePower+1e-6)/(previousPower+1e-6)):0;
  const riseSeconds=litOnset?Math.max(dt,time-onset.since+onset.observedOver):dt;
  if(source&&known?.previous!=='off'&&contrast>.7&&(litOnset||sourceRise>.5)&&riseSeconds>0){
   const rate=contrast/riseSeconds,strength=(1-Math.exp(-(contrast-.7)/2))*rate/(rate+2);
   if(rate>1&&strength>recoilAmount(startle,time)){
    const familiarity=litOnset?onset.familiarity:known?.familiarity??0;
    recoil({id:source.id,point:source.point,strength,familiarity,evidence:{kind:litOnset?'observed-onset':'measured-rise',local,contrast,sourceRise,dt,riseSeconds,sourcePower}},time);
   }
  }
  if(litOnset)onset=null;
  previousPower=Number.isFinite(sourcePower)?sourcePower:null;
  // Light is remembered per fixed patch of ground, not per sample slot, so
  // walking through static light and shade changes nothing; a patch seen for
  // the first time simply starts its own baseline.
  // Each patch keeps a short average (what it looks like now, with flicker
  // smoothed out) and a slow baseline (what it usually looks like). A flare is
  // the light rising everywhere at once; a shadow is one patch darkening
  // against the others. Firelight's own flicker averages away.
  const slow=smooth(o.adaptSeconds,dt),fast=smooth(o.glanceSeconds,dt),seen=[];
  for(const x of samples){
   if(!Number.isFinite(x.luminance)||!Array.isArray(x.point))continue;
   const key=`${x.point[0].toFixed(4)},${x.point[1].toFixed(4)},${x.point[2].toFixed(4)}`;
   let patch=patches.get(key);
   if(!patch){patches.set(key,{now:x.luminance,usual:x.luminance,armed:true,seen:time});continue;}
   patch.now+=(x.luminance-patch.now)*fast;seen.push({point:x.point,patch,luminance:x.luminance});
  }
  // Changes in near-darkness are too faint to see: the floor follows the
  // scene's typical light here, the way eyes stop resolving deep shade.
  const current=samples.map(x=>x.luminance).filter(Number.isFinite).sort((p,q)=>p-q),typical=current.length?current[Math.floor(current.length/2)]:0;
  const eps=Math.max(o.lightFloor,typical*o.darkFraction);
  const changes=seen.map(c=>({change:Math.log((c.patch.now+eps)/(c.patch.usual+eps)),point:c.point,patch:c.patch}));
  for(const c of seen){c.patch.usual+=(c.luminance-c.patch.usual)*slow;c.patch.seen=time;}
  const sorted=changes.map(c=>c.change).sort((p,q)=>p-q),overall=sorted.length?sorted[Math.floor(sorted.length/2)]:0;
  // A flare is the light source itself brightening against its recent level,
  // read from the source's own output so it holds wherever the creature walks.
  let flare=null,surge=0;
  if(Number.isFinite(sourcePower)&&sourcePower>=0){
   const learned=powerHistory.observe({time,value:sourcePower});
   if(light.powerNow===null){light.powerNow=sourcePower;light.powerUsual=sourcePower;}
   const before=light.powerNow;light.powerNow+=(sourcePower-light.powerNow)*fast;
   surge=Math.log((light.powerNow+1e-6)/(light.powerUsual+1e-6));
   const fallRate=dt>0?(before-light.powerNow)/(Math.max(light.powerUsual,1e-6)*dt):0;
   // Keep the evidence of a sharp fall while the short average catches up;
   // a slow downward drift never accumulates that rate by merely lasting.
   light.lossSpeed=Math.max(fallRate,(light.lossSpeed??0)*Math.exp(-dt/(2*o.glanceSeconds)));
   if(surge<-o.flareAt&&light.lossSpeed>o.lossRate&&powerDropArmed&&source){interrupt({id:source.id,cause:'light faded',familiarity:learned.familiarity,evidence:{power:sourcePower,now:light.powerNow,usual:light.powerUsual,fallRate,recentFallRate:light.lossSpeed}},time);powerDropArmed=false;}
   if(surge>-o.flareAt*.5)powerDropArmed=true;
   // How fast the light is rising, per second: a sudden jump is more urgent.
   light.rise=dt>0?Math.max(0,(surge-(light.lastSurge??surge))/dt):0;light.lastSurge=surge;
   light.powerUsual+=(sourcePower-light.powerUsual)*slow;
   if(surge>o.flareAt&&light.flareArmed)flare={change:surge,rise:light.rise};
  }else{powerHistory.gap();light.powerNow=null;light.powerUsual=null;light.lossSpeed=0;}
  // A shadow from an object darkens an area: at least two neighbouring
  // patches together. One patch dipping on its own is the field's own noise.
  let shadow=null;
  // A shadow takes away a real share of the scene's typical light from the
  // patch, and the patch actually darkens (not merely brightens less).
  const depthOf=c=>(c.patch.usual-c.patch.now)/Math.max(typical,o.lightFloor);
  const dark=changes.map(c=>({...c,local:c.change-Math.max(overall,0),depth:depthOf(c)})).filter(c=>c.depth>o.shadowDepth&&c.change<-o.shadowAt&&c.local<-o.shadowAt);
  for(const c of changes)if(depthOf(c)<o.shadowDepth*.5)c.patch.armed=true;
  for(const c of dark){
   const neighbours=dark.filter(d=>d!==c&&Math.hypot(d.point[0]-c.point[0],d.point[2]-c.point[2])<=o.shadowReach);
   if(!neighbours.length||!c.patch.armed)continue;
   if(!shadow||c.depth>shadow.depth)shadow={change:c.local,depth:c.depth,point:c.point,patch:c.patch,area:[c,...neighbours]};
  }
  const brightest=surge;
  for(const [key,patch] of patches)if(time-patch.seen>o.lightForgetSeconds)patches.delete(key);
  if(brightest<o.flareAt*.5)light.flareArmed=true;
  if(flare)light.flareArmed=false;
  if(shadow)for(const c of shadow.area)c.patch.armed=false;
  if(flare&&source)pendingLight.push({id:source.id,label:source.label??source.id,point:[...source.point],cause:'light flared',strength:Math.min(2,.6+flare.change),urgency:flare.change*(1+flare.rise/2),evidence:{power:sourcePower,powerNow:light.powerNow,powerUsual:light.powerUsual,surge:flare.change}});
  // Each light event carries what was sensed, so a look's why can be checked.
  // Off by default: the fire's own light flickers locally as much as a real
  // shadow darkens, so luminance alone cannot tell them apart yet.
  if(shadow&&o.lightShadows)pendingLight.push({id:`shadow-${++shadows}`,label:'shadow',point:[...shadow.point],cause:'shadow',strength:Math.min(2,.6+shadow.depth),urgency:shadow.depth,evidence:{overall,typical,patches:shadow.area.map(c=>({point:c.point,now:c.patch.now,usual:c.patch.usual,depth:c.depth}))}});
  light={...light,status,time,samples:samples.length,last:samples.map(x=>x.luminance)};
 }
 function read(){
  return {enabled,weight,arrested:enabled&&(interruption!==null||Boolean(startle&&lastTime<startle.holdUntil)),startle:startle?structuredClone(startle):null,interruption:interruption?structuredClone(interruption):null,light:{status:light.status,time:light.time,samples:light.samples},reachable,error,profile:structuredClone(profile),
   focus:focus?structuredClone(focus):null,why:why?structuredClone(why):null,aim:aim?aim.toArray():null,
   candidates:structuredClone(candidates).sort((a,b)=>b.score-a.score),history:structuredClone(history),
   familiarity:Object.fromEntries([...memory].map(([id,m])=>[id,m.familiarity])),options:Object.fromEntries(Object.entries(o).filter(([,v])=>typeof v!=='function'&&typeof v!=='object'||Array.isArray(v)))};
 }
 function setEnabled(value){if(typeof value!=='boolean')throw Error('Attention enabled must be boolean');enabled=value;if(!value){policy.reset();focus=null;why=null;scan=null;nextScan=null;interruption=null;startle=null;onset=null;localLevels.clear();previousPower=null;states.clear();powerHistory.gap();light.powerNow=null;light.powerUsual=null;pendingLight.length=0;gazeLocal=null;weight=0;aim=null;lastTime=null;restUntil=-Infinity;reticle.visible=false;}return read();}
 // A different cast on the same rig has its own muzzle; keep focus and memory.
 function setProfile(next){const replacement=lookFor(next);look=replacement;profile=next;gazeLocal=null;return read();}
 function dispose(){reticle.removeFromParent();reticle.traverse(node=>{node.geometry?.dispose();node.material?.map?.dispose();});ringMaterial.dispose();caption?.material.dispose();}
 return Object.freeze({modify,sense,read,motionSeconds,setEnabled,setProfile,reticle,dispose});
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
 let state={active:false,paused:false,available:false},polled=-Infinity,cached=null,dirty=false;
 // Edits re-read the flame's state promptly instead of waiting for the poll.
 const unsubscribe=workbench.subscribe?.(()=>{dirty=true;})??(()=>{});
 function find(){const scene=root();if(cached&&cached.userData?.kaminosSceneObject?.id===id){let node=cached;while(node.parent)node=node.parent;if(node===scene)return cached;}
  cached=null;scene.traverse(node=>{if(!cached&&node.userData?.kaminosSceneObject?.id===id)cached=node;});return cached;}
 function read(){
  const object=find();if(!object)return [];
  const time=now();if(dirty||time-polled>=pollMs){polled=time;dirty=false;try{const r=workbench.read();state={active:r?.active===true,paused:r?.paused===true,available:typeof r?.active==='boolean'&&typeof r?.paused==='boolean'};}catch{state={...state,available:false};}}
  return [{id,label:'flame',point:new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).toArray(),interest,noticeRadius:12,active:state.active,
   sensed:state.available,restless:state.active&&!state.paused,forgetSeconds:state.active&&!state.paused?8:undefined,causes:{lit:'flame lit',again:'flickering'}}];
 }
 return Object.freeze({read,dispose(){unsubscribe();}});
}

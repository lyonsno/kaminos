// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createCreatureAttention,deriveHeadProfile,sceneObjectInterests,flameInterests} from '../experiments/creature-motion/creature-attention.mjs';

// A small quadruped spine in the retained rigs' convention: rest rotations map
// head-local +Y to rest -Z (forward) and head-local +Z to rest +Y (up).
const restRotation=[[1,0,0],[0,0,1],[0,-1,0]];
const restAt=p=>[[...restRotation[0],p[0]],[...restRotation[1],p[1]],[...restRotation[2],p[2]],[0,0,0,1]];
const names=['pelvis','spine-chest','neck','head','head-end'],parents=[null,'pelvis','spine-chest','neck','head'];
const restPositions=[[0,0,0],[0,.2,-1],[0,.4,-1.4],[0,.5,-1.8],[0,.6,-2]];
const frame={bones:names.map((name,i)=>({name,parent:parents[i],restMatrix:restAt(restPositions[i])}))};

{
 // Head-weighted vertices whose front-most cluster sits ahead and slightly to
 // +X of the head joint: the measured muzzle must follow the skin, not -Z.
 const channels=['fixed',...names],vertices=600,rest=new Float32Array(vertices*3),weights=new Float32Array(vertices*channels.length);
 for(let v=0;v<vertices;v++){
  const t=v/vertices,p=v<300?[.3*t,.5,-1.8-.5*t]:[0,0,-.5*t];rest.set(p,v*3);
  weights[v*channels.length+channels.indexOf(v<300?'head':'pelvis')]=1;
 }
 const profile=deriveHeadProfile({skin:{manifest:{channels,vertices},rest,weights},frame,count:20});
 const muzzle=[.3*.95,0,-.5*.95],length=Math.hypot(...muzzle),expected=[muzzle[0]/length,-muzzle[2]/length,muzzle[1]/length];
 profile.forward.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<.03,`measured head-local muzzle follows the skin (${profile.forward} vs ${expected})`));
 assert.ok(Math.abs(profile.forward.reduce((s,v,i)=>s+v*profile.up[i],0))<1e-9,'up is orthogonal to forward');
 assert.throws(()=>deriveHeadProfile({skin:{manifest:{channels,vertices},rest,weights},frame,count:400}),/Too few head-weighted vertices/);
}

function creature(){
 const scene=new THREE.Scene(),placement=new THREE.Group(),group=new THREE.Group(),bones=new Map();scene.add(placement);placement.add(group);
 const inverse=new Map(names.map((n,i)=>[n,new THREE.Matrix4().set(...restAt(restPositions[i]).flat())]));
 for(const [i,name] of names.entries()){
  const bone=new THREE.Bone();bone.name=name;const world=inverse.get(name),parent=parents[i]?inverse.get(parents[i]).clone().invert():new THREE.Matrix4();
  parent.multiply(world).decompose(bone.position,bone.quaternion,bone.scale);(parents[i]?bones.get(parents[i]):group).add(bone);bones.set(name,bone);
 }
 scene.updateMatrixWorld(true);return {scene,placement,group,bones};
}
const profile={forward:[0,1,0],up:[0,0,1]};
const headForward=bones=>new THREE.Vector3(0,1,0).transformDirection(bones.get('head').matrixWorld);
const headPosition=bones=>new THREE.Vector3().setFromMatrixPosition(bones.get('head').matrixWorld);
const alignment=(bones,point)=>headForward(bones).dot(new THREE.Vector3(...point).sub(headPosition(bones)).normalize());
// Playback writes the unmodified animated pose before attention every frame.
function run(attention,c,seconds,start=0,step=1/30){c.base??=new Map([...c.bones].map(([n,b])=>[n,b.matrix.clone()]));let t=start;for(;t<start+seconds-1e-9;t+=step){for(const [n,m] of c.base)m.decompose(c.bones.get(n).position,c.bones.get(n).quaternion,c.bones.get(n).scale);c.scene.updateMatrixWorld(true);attention.modify({bones:c.bones,group:c.group,time:t,placement:c.placement});}return t;}

// Watch a creature for a while and keep the attention state at every frame.
function watch(attention,c,seconds,start){const rows=[];let t=start;for(let i=0;i<Math.round(seconds*30);i++){t=run(attention,c,1/30,t);const s=attention.read();rows.push({t,focus:s.focus?.id??null,cause:s.why?.cause??null,weight:s.weight,reticle:attention.reticle.visible});}return {rows,t};}
const looks=rows=>rows.filter((row,i)=>row.focus&&(i===0||rows[i-1].focus!==row.focus)).map(row=>({id:row.focus,cause:row.cause,t:row.t}));
const turnAway=(c,yaw)=>{c.placement.rotation.y=yaw;c.scene.updateMatrixWorld(true);};

{
 // First sight: a prop the creature has never seen draws a look by itself,
 // with the reticle on it and the cause recorded, and is released once inspected.
 const c=creature(),point=[1,.5,-2.6];
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'brazier',point,interest:1}]});
 c.placement.add(attention.reticle);
 const before=alignment(c.bones,point);
 let t=run(attention,c,1.2);let state=attention.read();
 assert.equal(state.focus?.id,'brazier','unprompted look at the new prop');
 assert.equal(state.why?.cause,'first sight','the look records why it happened');
 assert.ok(state.weight>.85,`look has blended in (${state.weight})`);
 assert.ok(alignment(c.bones,point)>before+.2,`head actually turns toward it (${before} -> ${alignment(c.bones,point)})`);
 assert.ok(attention.reticle.visible,'reticle shows the active focus');
 attention.reticle.traverse(node=>assert.ok(!node.isLineLoop,'reticle uses primitives the WebGPU renderer draws'));
 c.placement.updateMatrixWorld(true);
 assert.ok(attention.reticle.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...point))<1e-6,'reticle sits on the focus point');
 let w=watch(attention,c,12,t);t=w.t;
 const released=w.rows.findIndex(row=>row.focus===null);
 assert.ok(released>=0,'inspecting the prop makes it familiar and the look ends');
 assert.ok(w.rows[released].t-1.2>1,'but only after a real look');
 assert.ok(w.rows.slice(released).every(row=>row.focus===null),'a familiar, unchanged prop in plain view does not keep drawing looks');

 // Turning away and back within minutes: still familiar, no new look.
 turnAway(c,Math.PI);w=watch(attention,c,3,t);t=w.t;turnAway(c,0);w=watch(attention,c,6,t);t=w.t;
 assert.equal(looks(w.rows).length,0,`coming back into view of a familiar prop is not a reason to look (${JSON.stringify(looks(w.rows))})`);

 // Changing it is a reason: the operator moves the prop.
 point[0]=1.4;w=watch(attention,c,2,t);t=w.t;
 assert.deepEqual(looks(w.rows).map(l=>[l.id,l.cause]),[['brazier','moved']],'moving a familiar prop draws a look because it moved');

 const history=attention.read().history;
 assert.deepEqual(history.filter(e=>e.kind==='look').map(e=>e.cause),['first sight','moved'],'the history keeps each look and its cause');
 assert.ok(history.some(e=>e.kind==='release'),'releases are recorded too');
}

{
 // A far prop (weak pull) is still inspected properly, and stays familiar for
 // minutes: no "noticed again" a few seconds after the look ends.
 const c=creature(),point=[1.4,.5,-3.9];
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'far',point,interest:1}]});
 const w=watch(attention,c,150,0);
 assert.deepEqual(looks(w.rows).map(l=>l.cause),['first sight'],`one look, then familiar for minutes (${JSON.stringify(looks(w.rows))})`);
 const end=w.rows.findIndex(r=>!r.focus&&r.t>.5);assert.ok(w.rows[end].t>2,`the far prop is looked at properly (${w.rows[end].t.toFixed(2)} s)`);
 assert.ok(attention.read().familiarity.far>.3,'and is not yet forgotten minutes later');
}

{
 // A look cut short before the prop is inspected: coming back to it is not a first sight.
 const c=creature(),point=[1,.5,-2.6];
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'brazier',point,interest:1}]});
 let {t}=watch(attention,c,.8,0);turnAway(c,Math.PI);({t}=watch(attention,c,4,t));turnAway(c,0);
 const w=watch(attention,c,6,t);
 assert.deepEqual(looks(w.rows).map(l=>l.cause),['back to it'],`an unfinished look resumes as such (${JSON.stringify(looks(w.rows))})`);
}

{
 // Flame: an unlit flame draws nothing; lighting it is a reason to look;
 // turning it up is another; a burning flame keeps drawing glances.
 const c=creature(),flame={id:'flame',label:'flame',point:[.9,.6,-2.5],interest:1,active:false,version:0,restless:true,forgetSeconds:8,causes:{lit:'flame lit',changed:'flared up',again:'flickering'}};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{...flame,point:[...flame.point]}]});
 let w=watch(attention,c,3,0),t=w.t;
 assert.equal(looks(w.rows).length,0,'an unlit flame is not looked at');
 flame.active=true;w=watch(attention,c,6,t);t=w.t;
 assert.deepEqual(looks(w.rows).map(l=>l.cause),['flame lit'],`lighting it draws a look (${JSON.stringify(looks(w.rows))})`);
 flame.version++;w=watch(attention,c,4,t);t=w.t;
 assert.deepEqual(looks(w.rows).map(l=>l.cause),['flared up'],'turning it up draws a look');
 w=watch(attention,c,60,t);t=w.t;const again=looks(w.rows);
 assert.ok(again.length>=2&&again.every(l=>l.cause==='flickering'),`a burning flame keeps drawing glances (${JSON.stringify(again)})`);
 const busy=w.rows.filter(r=>r.focus).length/w.rows.length;
 assert.ok(busy<.6,`but not a fixed stare (${busy.toFixed(2)} of the time)`);
 flame.active=false;w=watch(attention,c,20,t);
 const ended=w.rows.findIndex(r=>!r.focus);
 assert.ok(ended>=0&&w.rows[ended].t-t<1,'putting it out ends any look at it promptly');
 assert.equal(looks(w.rows.slice(ended)).length,0,'and once out it draws nothing');
}

{
 // Familiarity fades over minutes: a long absence makes the prop worth a look again.
 const c=creature(),point=[1,.5,-2.6];
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false,forgetSeconds:20},interests:()=>[{id:'brazier',point,interest:1}]});
 let {t}=watch(attention,c,8,0);turnAway(c,Math.PI);({t}=watch(attention,c,60,t));turnAway(c,0);
 const w=watch(attention,c,3,t);
 assert.deepEqual(looks(w.rows).map(l=>l.cause),['noticed again'],'after forgetting, seeing it again draws a look');
}

{
 // Nothing happening: the creature looks around now and then, briefly.
 const c=creature();
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{seed:3},interests:()=>[]});
 const w=watch(attention,c,30,0),scans=looks(w.rows);
 assert.ok(scans.length>=2&&scans.length<=8,`occasional looking around (${scans.length} in 30 s)`);
 assert.ok(scans.every(l=>l.cause==='looking around'),'idle looks say so');
 const focused=w.rows.filter(r=>r.focus).length/w.rows.length;
 assert.ok(focused<.5,`mostly not looking at anything in particular (${focused.toFixed(2)})`);
}

{
 // Behind the animal or out of range: nothing is noticed and the pose is untouched.
 for(const point of [[0,.5,3],[0,.5,-9]]){
  const c=creature(),attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'p',point,interest:1,reason:'authored'}]});
  const before=c.bones.get('head').matrixWorld.clone();run(attention,c,2);
  assert.equal(attention.read().focus,null,`no focus for ${point}`);
  assert.ok(c.bones.get('head').matrixWorld.equals(before),'unattending pose stays exactly the animated pose');
 }
}

{
 // Interests resolve from live scene objects and follow the prop when moved.
 const scene=new THREE.Scene(),prop=new THREE.Mesh(new THREE.BoxGeometry(1,2,1));prop.userData.kaminosSceneObject={id:'mesh-1',label:'Brazier'};prop.position.set(3,1,0);scene.add(prop);scene.updateMatrixWorld(true);
 const read=sceneObjectInterests({THREE,root:()=>scene,specs:[{object:'mesh-1',interest:.8},{object:'missing',interest:1}]});
 let rows=read();assert.equal(rows.length,1,'missing scene objects contribute nothing');
 assert.equal(rows[0].label,'Brazier','scene label by default');
 assert.equal(sceneObjectInterests({THREE,root:()=>scene,specs:[{object:'mesh-1',interest:1,label:'brazier A'}]})()[0].label,'brazier A','an authored name tells look-alike props apart');
 assert.deepEqual(rows[0].point.map(v=>+v.toFixed(9)),[3,2,0],'top anchor of the prop');
 // The renderer refreshes world matrices each frame; interests read them.
 prop.position.x=5;scene.updateMatrixWorld(true);rows=read();assert.equal(rows[0].point[0],5,'moving the prop moves the interest');
 prop.removeFromParent();assert.equal(read().length,0,'removing the prop removes the interest');
 scene.add(prop);assert.equal(read().length,1,'a prop restored to the scene is found again');
 assert.throws(()=>sceneObjectInterests({THREE,root:()=>scene,specs:[{object:'mesh-1',interest:-1}]}),/finite and nonnegative/);
}
{
 // Two new props side by side: each gets its own first look, one after the
 // other, each held; then both are familiar and the creature settles.
 const c=creature(),points={a:[.6,.5,-2.6],b:[-.6,.5,-2.6]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>Object.entries(points).map(([id,point])=>({id,point,interest:1}))});
 const w=watch(attention,c,30,0),seen=looks(w.rows);
 assert.deepEqual(seen.map(l=>l.id).sort(),['a','b'],`each new prop gets one first look (${JSON.stringify(seen)})`);
 assert.ok(seen.every(l=>l.cause==='first sight'));
 const spans=[];for(const row of w.rows){const last=spans.at(-1);if(!last||last.focus!==row.focus)spans.push({focus:row.focus,start:row.t,end:row.t});else last.end=row.t;}
 for(const span of spans.filter(s=>s.focus))assert.ok(span.end-span.start>=1.4,`each look is held (${span.focus} ${(span.end-span.start).toFixed(2)} s)`);
 assert.equal(w.rows.at(-1).focus,null,'with nothing new, the creature settles');
}

{
 // A flame flaring up behind the creature is still noticed, and the head turns
 // as far as it can toward it even beyond comfortable reach.
 const c=creature(),flame={id:'flame',label:'flame',point:[1.2,.6,.5],interest:1.5,noticeRadius:12,eventFieldOfView:2*Math.PI,active:true,version:0,restless:true,forgetSeconds:8,causes:{lit:'flame lit',changed:'flared up',again:'flickering'}};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{...flame}]});
 let w=watch(attention,c,3,0),t=w.t;
 assert.equal(looks(w.rows).length,0,'a steady flame behind it is not seen');
 const before=alignment(c.bones,flame.point);
 flame.version++;w=watch(attention,c,1.5,t);t=w.t;
 assert.deepEqual(looks(w.rows).map(l=>l.cause),['flared up'],`a flare behind it draws a look (${JSON.stringify(looks(w.rows))})`);
 assert.ok(alignment(c.bones,flame.point)>before+.15,`the head turns toward it as far as it can (${before.toFixed(3)} -> ${alignment(c.bones,flame.point).toFixed(3)})`);
}

{
 // No invisible looks: something off to the side beyond neck reach does not
 // win attention by mere presence (the head could not turn to it anyway).
 const c=creature(),side=[1,.5,-1.95];
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'side',point:side,interest:2}]});
 const w=watch(attention,c,4,0);
 assert.ok(w.rows.every(r=>!r.focus||r.weight>.05||r.t<.5),'any chosen focus is actually looked at');
 assert.equal(looks(w.rows).length,0,'a prop beyond reach is not chosen by presence alone');
}

{
 // A flare while the creature is already looking at the flame re-labels the look.
 const c=creature(),flame={id:'flame',label:'flame',point:[.9,.6,-2.5],interest:1.5,noticeRadius:12,eventFieldOfView:2*Math.PI,active:true,version:0,restless:true,forgetSeconds:8,causes:{lit:'flame lit',changed:'flared up',again:'flickering'}};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{...flame}]});
 let w=watch(attention,c,1,0);assert.equal(attention.read().why?.cause,'first sight');
 flame.version++;w=watch(attention,c,.5,w.t);
 assert.equal(attention.read().why?.cause,'flared up','the current look now says why it continues');
 assert.ok(attention.read().history.some(e=>e.kind==='look'&&e.cause==='flared up'),'and the event is recorded');
}

{
 // A flame is seen from much farther than an ordinary prop: per-source range.
 const c=creature(),far=[1.5,.9,-6];
 const prop=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'prop',point:far,interest:1}]});
 assert.equal(looks(watch(prop,c,3,0).rows).length,0,'an ordinary prop that far away goes unnoticed');
 const lit=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'flame',point:far,interest:1.5,noticeRadius:12}]});
 assert.equal(looks(watch(lit,c,3,0).rows).length,1,'a flame at the same distance is noticed');
}

{
 // The flame source reads the shared flame workbench: burning (and not frozen),
 // edits as changes, position from the flame source object.
 const scene=new THREE.Scene(),emitter=new THREE.Object3D();emitter.userData.kaminosSceneObject={id:'flame-emitter',label:'Flame source'};emitter.position.set(1,2,3);scene.add(emitter);scene.updateMatrixWorld(true);
 let state={active:false,paused:false,settings:{domControls:{'volume-fuel':{value:1}}}},listener=null,clock=0,reads=0;
 const workbench={read:()=>{reads++;return structuredClone(state);},subscribe:fn=>{listener=fn;return ()=>{listener=null;};}};
 const flames=flameInterests({THREE,root:()=>scene,workbench,interest:1.5,now:()=>clock});
 let [row]=flames.read();
 assert.equal(row.active,false,'unlit flame is reported as not active');assert.ok(row.noticeRadius>=10,'a flame is visible from afar');assert.ok(row.eventFieldOfView>=2*Math.PI-1e-9,'its changes are noticed all around');assert.deepEqual(row.point,[1,2,3]);assert.equal(row.causes.lit,'flame lit');
 state.active=true;clock+=100;[row]=flames.read();assert.equal(row.active,false,'not re-read within the poll interval');
 clock+=600;[row]=flames.read();assert.equal(row.active,true);assert.equal(row.restless,true,'a burning flame is restless');
 const before=row.version;listener();[row]=flames.read();assert.equal(row.version,before,'an unrelated edit notification is not a flame change');
 state.settings={domControls:{'volume-fuel':{value:2}}};listener();[row]=flames.read();assert.equal(row.version,before+1,'a change in the flame settings is a change, picked up at once');
 listener();[row]=flames.read();assert.equal(row.version,before+1,'and counted once');
 state.paused=true;clock+=600;[row]=flames.read();assert.equal(row.restless,false,'a frozen flame does not flicker');
 const polled=reads;for(let i=0;i<10;i++)flames.read();assert.equal(reads,polled,'reads are throttled, not per call');
 emitter.removeFromParent();clock+=600;assert.deepEqual(flames.read(),[],'no flame source, no flame interest');
 flames.dispose();assert.equal(listener,null,'dispose unsubscribes');
}

console.log('Creatures look for reasons: first sight, change, renewed sight after forgetting, and idle looking around, each recorded');

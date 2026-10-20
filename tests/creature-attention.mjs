// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createCreatureAttention,deriveHeadProfile,sceneObjectInterests,flameInterests,lightSamplePoints} from '../experiments/creature-motion/creature-attention.mjs';

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
 const windowStart=t;w=watch(attention,c,60,t);t=w.t;const again=looks(w.rows).filter(l=>l.t>windowStart+.05);
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
 // Light sense: the creature samples light around itself and notices change,
 // not brightness. A flare behind it draws a look at the light's source; a
 // sudden shadow on one side draws a look there; steady light does nothing.
 const c=creature(),fire={id:'flame-emitter',label:'flame',point:[1.2,.6,.5]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false,lightShadows:true},interests:()=>[]});
 const ring=Array.from({length:8},(_,i)=>[Math.cos(i/8*Math.PI*2)*.7,0,-1.8+Math.sin(i/8*Math.PI*2)*.7]);
 let level=ring.map(()=>.1),power=1,t=0;
 const step=seconds=>{for(let k=0;k<Math.round(seconds*4);k++){attention.sense({time:t,source:fire,sourcePower:power,samples:ring.map((point,i)=>({point,luminance:level[i]}))});const w=watch(attention,c,.25,t);t=w.t;}};
 step(4);assert.equal(attention.read().history.filter(e=>e.kind==='look').length,0,'steady light draws nothing');
 const before=alignment(c.bones,fire.point);
 level=level.map(l=>l*2.5);power*=2.5;step(1.5);
 let seen=attention.read().history.filter(e=>e.kind==='look');
 assert.deepEqual(seen.map(e=>[e.id,e.cause]),[['flame-emitter','light flared']],`a flare behind it draws a look at the source (${JSON.stringify(seen)})`);
 assert.ok(alignment(c.bones,fire.point)>before+.1,'and the head turns toward it');
 step(12);
 const after=attention.read().history.filter(e=>e.kind==='look').length;
 step(8);assert.equal(attention.read().history.filter(e=>e.kind==='look').length,after,'once adapted, the brighter light draws nothing more');
 level[2]=level[2]*.15;level[3]=level[3]*.15;step(2.5);
 seen=attention.read().history.filter(e=>e.kind==='look').slice(after);
 assert.equal(seen.length,1,'a sudden shadow draws one look');assert.equal(seen[0].cause,'shadow');
 const focus=attention.read().focus?.point??attention.read().aim;
 assert.ok(Math.hypot(focus[0]-ring[2][0],focus[2]-ring[2][2])<.05,'at the place the shadow fell');
 assert.doesNotThrow(()=>attention.sense({time:t,source:fire,samples:null,status:'unavailable'}),'an unavailable probe is not an event');
 assert.equal(attention.read().light.status,'unavailable','and is reported as such');
}

{
 // Walking through static light and shade is not an event: light is tracked per
 // patch of ground, so a fixed shadow edge passing under the creature's moving
 // sample ring draws nothing; a shadow that falls on a patch it already knows does.
 const c=creature(),fire={id:'flame-emitter',label:'flame',point:[6,.6,-2]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false,lightShadows:true},interests:()=>[]});
 const field=(x)=>x<1?.02:.3;let t=0,offset=-2;
 const ringAt=dx=>lightSamplePoints({center:[dx,0,-1.8],radius:.7,ground:0});
 for(let k=0;k<64;k++){offset+=.08;const ring=ringAt(offset);attention.sense({time:t,source:fire,sourcePower:1,samples:ring.map(point=>({point,luminance:field(point[0])}))});t=watch(attention,c,.25,t).t;}
 assert.equal(attention.read().history.filter(e=>e.kind==='look').length,0,`walking across a static shadow edge draws nothing (${JSON.stringify(attention.read().history)})`);
 // While still walking, the flame flares: that is a change in the world and is noticed.
 for(let k=0;k<8;k++){offset+=.08;const ring=ringAt(offset);attention.sense({time:t,source:fire,sourcePower:2.5,samples:ring.map(point=>({point,luminance:field(point[0])*2.5}))});t=watch(attention,c,.25,t).t;}
 assert.deepEqual(attention.read().history.filter(e=>e.kind==='look').map(e=>e.cause),['light flared'],'a flare while walking is noticed');
}

{
 // Firelight flickers: patches near the flame brighten and dim several times a
 // second. That is the light's normal texture, not an event.
 const c=creature(),fire={id:'flame-emitter',label:'flame',point:[1.2,.6,.5]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false,lightShadows:true},interests:()=>[]});
 const ring=Array.from({length:8},(_,i)=>[Math.cos(i/8*Math.PI*2)*.7,0,-1.8+Math.sin(i/8*Math.PI*2)*.7]);
 let t=0,seed=7;const rand=()=>((seed=(seed*16807)%2147483647)/2147483647);
 for(let k=0;k<160;k++){const flicker=.1*(1+.45*(rand()*2-1));attention.sense({time:t,source:fire,sourcePower:flicker*10,samples:ring.map((point,i)=>({point,luminance:flicker*(1+.3*(rand()*2-1))}))});t=watch(attention,c,.25,t).t;}
 assert.equal(attention.read().history.filter(e=>e.kind==='look').length,0,`flicker draws nothing (${JSON.stringify(attention.read().history.map(e=>e.cause))})`);
 assert.equal(attention.read().history.filter(e=>e.kind==='interrupt').length,0,'ordinary flicker does not arrest the creature');
}

{
 // The light field is computed from a live simulation, so single ground points
 // jitter on their own. One point dipping is noise; a shadow darkens an area.
 const c=creature(),fire={id:'flame-emitter',label:'flame',point:[1.2,.6,.5]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false,lightShadows:true},interests:()=>[]});
 const ring=Array.from({length:8},(_,i)=>[Math.cos(i/8*Math.PI*2)*.7,0,-1.8+Math.sin(i/8*Math.PI*2)*.7]);
 let t=0;
 for(let k=0;k<120;k++){const dip=Math.floor(k/12)%8;attention.sense({time:t,source:fire,sourcePower:1,samples:ring.map((point,i)=>({point,luminance:i===dip?.01:.1}))});t=watch(attention,c,.25,t).t;}
 assert.equal(attention.read().history.filter(e=>e.kind==='look').length,0,`single-point dips draw nothing (${JSON.stringify(attention.read().history.map(e=>e.cause))})`);
}

{
 // Firelight shadows sway as the flame's center wanders. A creature by a fire
 // gets used to that: patches that keep swaying stop drawing looks.
 const c=creature(),fire={id:'flame-emitter',label:'flame',point:[1.2,.6,.5]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false,lightShadows:true},interests:()=>[]});
 const ring=Array.from({length:8},(_,i)=>[Math.cos(i/8*Math.PI*2)*.7,0,-1.8+Math.sin(i/8*Math.PI*2)*.7]);
 let t=0;
 for(let k=0;k<160;k++){const sway=Math.sin(k/4*Math.PI)>0?.1:.012;attention.sense({time:t,source:fire,sourcePower:1,samples:ring.map((point,i)=>({point,luminance:i===1||i===2?sway:.1}))});t=watch(attention,c,.25,t).t;}
 const looked=attention.read().history.filter(e=>e.kind==='look'&&e.time>8);
 assert.equal(looked.length,0,`after a while, swaying shadows draw nothing (${JSON.stringify(looked.map(e=>[e.time.toFixed(1),e.cause]))})`);
}

{
 // From the room's evidence: (a) while the fire's light comes up after load,
 // a patch that brightens less than the rest is not a shadow; (b) changes in
 // near-black patches are too faint to see, however large as a ratio.
 const c=creature(),fire={id:'flame-emitter',label:'flame',point:[1.2,.6,.5]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false,lightShadows:true},interests:()=>[]});
 const ring=Array.from({length:8},(_,i)=>[Math.cos(i/8*Math.PI*2)*.7,0,-1.8+Math.sin(i/8*Math.PI*2)*.7]);
 let t=0;
 for(let k=0;k<16;k++){const up=Math.min(1,k/8);attention.sense({time:t,source:fire,sourcePower:1,samples:ring.map((point,i)=>({point,luminance:i<2?.06:.004+.08*up}))});t=watch(attention,c,.25,t).t;}
 for(let k=0;k<80;k++){const dim=k%12<6;attention.sense({time:t,source:fire,sourcePower:1,samples:ring.map((point,i)=>({point,luminance:i===4||i===5?(dim?.003:.02):.06}))});t=watch(attention,c,.25,t).t;}
 assert.equal(attention.read().history.filter(e=>e.kind==='look').length,0,`neither draws a look (${JSON.stringify(attention.read().history.map(e=>[e.time.toFixed(1),e.cause]))})`);
}

{
 // Two shadows in different places are two events, not one shadow that moved.
 const c=creature(),fire={id:'flame-emitter',label:'flame',point:[1.2,.6,.5]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false,lightShadows:true},interests:()=>[]});
 const ring=Array.from({length:8},(_,i)=>[Math.cos(i/8*Math.PI*2)*.7,0,-1.8+Math.sin(i/8*Math.PI*2)*.7]);
 let level=ring.map(()=>.1),t=0;
 const step=seconds=>{for(let k=0;k<Math.round(seconds*4);k++){attention.sense({time:t,source:fire,sourcePower:1,samples:ring.map((point,i)=>({point,luminance:level[i]}))});t=watch(attention,c,.25,t).t;}};
 step(4);level[1]*=.15;level[2]*=.15;step(8);level[1]=level[2]=.1;step(6);level[5]*=.15;level[6]*=.15;step(3);
 const seen=attention.read().history.filter(e=>e.kind==='look');
 assert.deepEqual(seen.map(e=>e.cause),['shadow','shadow'],`two separate shadows (${JSON.stringify(seen.map(e=>[e.id,e.cause]))})`);
 assert.notEqual(seen[0].id,seen[1].id,'each shadow is its own thing');
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
 assert.equal(row.active,false,'unlit flame is reported as not active');assert.ok(row.noticeRadius>=10,'a flame is visible from afar');assert.deepEqual(row.point,[1,2,3]);assert.equal(row.causes.lit,'flame lit');assert.equal(row.causes.changed,undefined);
 state.active=true;clock+=100;[row]=flames.read();assert.equal(row.active,false,'not re-read within the poll interval');
 clock+=600;[row]=flames.read();assert.equal(row.active,true);assert.equal(row.restless,true,'a burning flame is restless');
 assert.equal(row.version,undefined,'flares are not read from flame settings; they arrive as light');
 state.paused=true;listener();[row]=flames.read();assert.equal(row.restless,false,'an edit notification re-reads the flame at once');state.paused=false;clock+=600;[row]=flames.read();
 state.paused=true;clock+=600;[row]=flames.read();assert.equal(row.restless,false,'a frozen flame does not flicker');
 const polled=reads;for(let i=0;i<10;i++)flames.read();assert.equal(reads,polled,'reads are throttled, not per call');
 emitter.removeFromParent();clock+=600;assert.deepEqual(flames.read(),[],'no flame source, no flame interest');
 flames.dispose();assert.equal(listener,null,'dispose unsubscribes');
}

{
 // Shadow events are off unless asked for.
 const c=creature(),a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[]});
 const ring=Array.from({length:8},(_,i)=>[Math.cos(i/8*Math.PI*2)*.7,0,-1.8+Math.sin(i/8*Math.PI*2)*.7]);let lv=ring.map(()=>.1),t=0;
 for(let k=0;k<40;k++){if(k===16){lv[2]*=.1;lv[3]*=.1;}a.sense({time:t,sourcePower:1,samples:ring.map((point,i)=>({point,luminance:lv[i]}))});t=watch(a,c,.25,t).t;}
 assert.equal(a.read().history.filter(e=>e.cause==='shadow').length,0,'no shadow looks by default');
}

{
 // Bigger, faster changes draw faster looks that linger; small ones, gentle
 // looks that let go sooner. Measured on a flare of two sizes behind the creature.
 const flareLook=size=>{
  const c=creature(),fire={id:'flame-emitter',label:'flame',point:[1.2,.6,.5]};
  const a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[]});
  const ring=Array.from({length:8},(_,i)=>[Math.cos(i/8*Math.PI*2)*.7,0,-1.8+Math.sin(i/8*Math.PI*2)*.7]);
  let t=0,power=1,turnedAt=null,since=null,until=null;
  for(let k=0;k<160;k++){if(k===16)power=size;a.sense({time:t,sourcePower:power,source:fire,samples:ring.map(point=>({point,luminance:.1*power}))});
   for(let f=0;f<8;f++){t=run(a,c,1/32,t);const st=a.read();if(st.focus&&since===null)since=t;if(since!==null&&turnedAt===null&&st.weight>.8)turnedAt=t;if(since!==null&&until===null&&!st.focus)until=t;}}
  assert.ok(since!==null&&turnedAt!==null,`a ${size}x flare draws a look`);
  return {turn:turnedAt-since,held:(until??t)-since};
 };
 const big=flareLook(8),small=flareLook(2.5);
 assert.ok(big.turn<small.turn*.7,`a bigger flare turns the head faster (${big.turn.toFixed(2)} s vs ${small.turn.toFixed(2)} s)`);
 assert.ok(big.held>small.held+1,`and the look lingers longer (${big.held.toFixed(2)} s vs ${small.held.toFixed(2)} s)`);
 assert.ok(big.held>=3,`a big flare holds attention for a while (${big.held.toFixed(2)} s)`);
}

{
 // Hysteresis: a thing whose pull hovers around the threshold does not flicker
 // attention on and off; catching the eye takes more than keeping it.
 const c=creature();let interest=1;
 const a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'p',point:[1,.5,-2.6],interest}]});
 let t=0;const rows=[];
 for(let k=0;k<20*30;k++){interest=1+.6*Math.sin(k/30*Math.PI*1.5);t=run(a,c,1/30,t);rows.push(a.read().focus?.id??null);}
 const changes=rows.filter((r,i)=>i&&(r===null)!==(rows[i-1]===null)).length;
 assert.ok(changes<=4,`no on/off flicker (${changes} changes in 20 s)`);
}

{
 // Familiar destination: the same off event gets a brief interruption after
 // a short burn, but a longer response after light became the usual condition.
 const cessation=burnSeconds=>{
  const c=creature(),flame={id:'fire',point:[.8,.5,-2.5],interest:1,active:false,restless:false};
  const a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{...flame}]});
  let t=watch(a,c,30,0).t;flame.active=true;flame.restless=true;t=watch(a,c,burnSeconds,t).t;
  flame.active=false;flame.restless=false;run(a,c,1/30,t);
  const s=a.read();
  assert.equal(s.interruption?.cause,'light went out','a disappearing visible source interrupts explicitly');
  assert.equal(s.arrested,true,'the attention state requests a stride hold');
  assert.equal(s.focus,null,'cessation does not invent a point to stare at');
  const event=structuredClone(s.interruption),before=headForward(c.bones);
  t=watch(a,c,.8,t+1/30).t;
  assert.ok(headForward(c.bones).distanceTo(before)>.05,'the interruption produces an actual scanning head pose');
  t=watch(a,c,5,t).t;
  assert.equal(a.read().arrested,false,'the hold ends without further events');
  assert.equal(a.read().interruption,null,'the scan ends too');
  assert.equal(a.read().history.filter(e=>e.kind==='interrupt').length,1,'steady absence does not retrigger');
  a.setEnabled(false);assert.equal(a.read().arrested,false);
  return event;
 };
 const brief=cessation(2),established=cessation(600);
 assert.ok(brief.familiarity>.85&&established.familiarity<.05,'destination familiarity reflects experienced history');
 assert.ok(established.until-established.since>brief.until-brief.since+1,'familiar return settles sooner');
}
{
 const c=creature(),flame={id:'fire',point:[.8,.5,-2.5],interest:1,active:true,restless:true};
 const a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{...flame}]});
 let t=watch(a,c,10,0).t;flame.restless=false;run(a,c,1/30,t);
 assert.equal(a.read().interruption?.cause,'movement stopped','a frozen visible flame is distinct from one going out');
 t=watch(a,c,.4,t+1/30).t;flame.restless=true;watch(a,c,.2,t);
 assert.equal(a.read().arrested,false,'renewed motion resolves the scan after the initial arrest');
 assert.equal(a.read().why?.cause,'movement resumed','the fresh source gives the creature a directed look');
 a.setEnabled(false);assert.equal(a.read().interruption,null,'disabling clears the interruption immediately');
}
{
 const c=creature(),flame={id:'fire',point:[.8,.5,-2.5],interest:1,active:false,restless:false};let present=true;
 const a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>present?[{...flame}]:[]});
 let t=watch(a,c,30,0).t;flame.active=true;flame.restless=true;t=watch(a,c,2,t).t;
 present=false;t=watch(a,c,600,t).t;present=true;flame.active=false;flame.restless=false;watch(a,c,.1,t);
 assert.equal(a.read().interruption,null,'FC-2: reappearance cannot manufacture a cessation across an unobserved gap');
}
{
 const c=creature(),source={id:'fire',point:[.8,.5,-2.5]};
 const a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[]});let t=0;
 const sample=power=>{a.sense({time:t,source,sourcePower:power,samples:[{point:[0,.3,0],luminance:.1*power}]});t=watch(a,c,.25,t).t;};
 for(let k=0;k<120;k++)sample(1);
 for(let k=1;k<=240;k++)sample(1-k/240);
 assert.equal(a.read().history.filter(e=>e.kind==='interrupt').length,0,'gradual dimming is not a sudden interruption');
}
{
 // Sensory gaps and out-of-view sources do not confer knowledge of a stop.
 const c=creature(),flame={id:'hidden',point:[0,.5,4],interest:1,active:true,restless:true};
 const a=createCreatureAttention({THREE,rigFrame:frame,profile,interests:()=>[{...flame}]});
 let t=watch(a,c,5,0).t;flame.active=false;watch(a,c,1,t);
 assert.equal(a.read().interruption,null,'an unseen cessation is not perceived');
 a.sense({time:t+2,status:'unavailable',samples:null,sourcePower:0});
 assert.equal(a.read().interruption,null,'missing light data is not darkness');
}
{
 const c=creature(),source={id:'fire',point:[.8,.5,-2.5]};
 const a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[]});
 const samples=[{point:[0,.3,0],luminance:.1}];let t=0;
 const power=(value,seconds)=>{for(let i=0;i<seconds*4;i++){a.sense({time:t,source,sourcePower:value,samples});t=watch(a,c,.25,t).t;}};
 power(1,30);power(8,2);power(1,4);
 const stopped=a.read().history.find(e=>e.kind==='interrupt');
 assert.equal(stopped?.cause,'light faded','a sharp return from a flare is an interruption');
 assert.ok(stopped.familiarity>.85,'returning to the usual level settles quickly');
 a.sense({time:t,source,sourcePower:0,samples:[]});watch(a,c,1,t);
 assert.equal(a.read().history.filter(e=>e.kind==='interrupt').length,1,'an empty probe cannot impersonate a loss of light');
 t+=1;power(1,4);
 for(let i=0;i<8;i++){a.sense({time:t,source,sourcePower:0,samples:[{point:[0,.3,0],luminance:NaN}]});t=watch(a,c,.25,t).t;}
 assert.equal(a.read().history.filter(e=>e.kind==='interrupt').length,1,'invalid probe values cannot impersonate darkness either');
}

console.log('Creatures attend, learn familiar states, interrupt on cessation, scan, and settle');

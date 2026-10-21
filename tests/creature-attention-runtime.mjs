// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';

// The joined walking creature: attention follows the cast that is actually
// applied, and switching attention off while paused clears the turn at once.
class Element {
 constructor(){this.children=[];this.style={};this.value='0';this.checked=true;}
 append(...nodes){this.children.push(...nodes);} prepend(...nodes){this.children.unshift(...nodes);} setAttribute(){} remove(){} dispatchEvent(){}
}
const document={createElement:()=>new Element(),getElementById:()=>null};
const names=['pelvis','spine-chest','neck','head','head-end'],parentIndex=[-1,0,1,2,3];
const positions=[[0,0,0],[0,0,-1],[0,.2,-1.4],[0,.3,-1.8],[0,.35,-2.1]];
const at=p=>[[1,0,0,p[0]],[0,1,0,p[1]],[0,0,1,p[2]],[0,0,0,1]];
const bones=names.map((name,i)=>({name,parent:parentIndex[i]<0?null:names[parentIndex[i]],restMatrix:at(positions[i]),tail:[0,0,-.1]}));
const channels=['fixed',...names];
// A cast whose front-most head vertices lean to one side by `lean`.
function skin(lean,digit){
 const head=400,vertices=3+head,rest=new Float32Array(vertices*3),weights=new Float32Array(vertices*channels.length);
 rest.set([0,0,0,1,0,0,0,1,0]);for(let v=0;v<3;v++)weights[v*channels.length+1]=1;
 for(let i=0;i<head;i++){const t=i/head,v=3+i;rest.set([lean*t,.3,-1.8-.4*t],v*3);weights[v*channels.length+channels.indexOf('head')]=1;}
 return {manifest:{bones,channels,vertices,triangles:1},rest,weights,triangles:new Uint32Array([0,1,2]),source:{caseSha256:digit.repeat(64)}};
}
const frames=60,motion={frames,joints:names.length,skeleton:{fps:30,jointNames:names,parents:parentIndex},
 positions:Array.from({length:frames},(_,f)=>positions.map(p=>[p[0],p[1],p[2]-.01*f]).flat()).flat(),localRotations:Array(frames*names.length).fill([1,0,0,0]).flat()};
const base=skin(0,'c'),casts={c:base,d:skin(.4,'d'),e:skin(-.4,'e')};
const data={...base,frame:{canonicalWorldToSourceNormalized:at([0,0,0]),bones},motion,source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
const choices=['c','d','e'].map(digit=>({cast:digit,label:digit,attachment:'x',case:`case-${digit}`,case_sha256:digit.repeat(64)}));
let callback=null;const scene=new THREE.Scene();
const prop=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2));prop.position.set(.9,.3,-2.6);prop.userData.kaminosSceneObject={id:'prop',label:'Prop'};scene.add(prop);scene.updateMatrixWorld(true);
const session={async attach(root){scene.add(root);return {id:root.uuid,root,owned:true};},onFrame(fn){callback=fn;return ()=>callback=null;},redraw(){},setView(){},readView:()=>({position:[4,2,4],target:[0,0,0]}),async dispose(){callback=null;}};
const host={controls:{document},scene:{open:async()=>session,refreshPresentation(){}}};
const deferred=new Map();
const dependencies={loadSources:async()=>data,loadSkin:input=>new Promise(resolve=>deferred.set(input.case_sha256[0],()=>resolve(casts[input.case_sha256[0]])))};
const inputs={blend_frames:0,radius:4,case:'case-c',case_sha256:'c'.repeat(64),choices,attention:{interests:[{object:'prop',interest:1}]}};
const oldWindow=globalThis.window;globalThis.window={};
try{
 const creature=await createWalkingCreature({host,inputs},dependencies);
 const profileOf=()=>creature.read().attention.profile.forward;
 // R1: the older request finishes last but is superseded; attention must use
 // the cast that was actually applied to the body.
 const first=creature.operations.skin({cast:'d',attachment:'x'}),second=creature.operations.skin({cast:'e',attachment:'x'});
 await Promise.resolve();deferred.get('e')();deferred.get('d')();
 const results=await Promise.all([first,second]);
 assert.deepEqual(results.map(r=>r.status),['superseded','applied']);
 assert.equal(creature.read().currentSkin.current.cast,'e');
 assert.equal(creature.read().attention.profileCaseSha256,'e'.repeat(64),'attention profile belongs to the applied cast');
 assert.ok(profileOf()[0]<-.1,`muzzle measured from the applied cast leans its way (${profileOf()})`);

 // R2: acquire, pause, switch attention off — the turn leaves the body now,
 // with no seek, advance or play, and the paused frame is kept.
 creature.operations.play();for(let i=0;i<45;i++){scene.updateMatrixWorld(true);callback?.({deltaSeconds:1/30});}
 assert.ok(creature.read().attention.weight>.8,`attention blended in (${creature.read().attention.weight})`);
 creature.operations.pause();
 const head=()=>(creature.inspect??window.kaminosWalkingCreature)().boneWorld.find(b=>b.name==='head').matrix;
 const turned=head(),frame=creature.read().playback.frame,turnedVertices=(creature.inspect??window.kaminosWalkingCreature)().vertices;
 creature.operations.attention({enabled:false});
 const state=creature.read();
 assert.equal(state.playback.status,'paused');assert.equal(state.playback.frame,frame,'paused frame is unchanged');
 assert.equal(state.attention.enabled,false);
 const local=(creature.inspect??window.kaminosWalkingCreature)().boneWorld.find(b=>b.name==='head');
 assert.ok(head().some((v,i)=>Math.abs(v-turned[i])>1e-6),'disabling removes the head turn immediately');
 const q=new THREE.Quaternion();new THREE.Matrix4().fromArray(local.matrix).decompose(new THREE.Vector3(),q,new THREE.Vector3());
 assert.ok(q.angleTo(new THREE.Quaternion())<1e-9,'head returns to the unmodified source orientation');
 assert.ok((creature.inspect??window.kaminosWalkingCreature)().vertices.some((v,i)=>Math.abs(v-turnedVertices[i])>1e-6),'the deformed body follows');
 await creature.dispose();

 // Attention may hold locomotion without pausing the creature's observation
 // clock. Exercise the real walking consumer, source adapter and flame bridge.
 const emitter=new THREE.Object3D();emitter.userData.kaminosSceneObject={id:'flame-emitter'};emitter.position.set(.8,.4,-2.5);scene.add(emitter);
 let fire={active:false,paused:false},notify=null;
 window.kaminosFlameWorkbench={open:async()=>({read:()=>({...fire}),subscribe:fn=>{notify=fn;return ()=>notify=null;}})};
 const walker=await createWalkingCreature({host,inputs:{...inputs,choices:[],attention:{interests:[],flame:{interest:1}}}},dependencies);
 await Promise.resolve();
 await walker.operations.action({kind:'wander'});
 const step=seconds=>{for(let i=0;i<Math.round(seconds*30);i++){scene.updateMatrixWorld(true);callback?.({deltaSeconds:1/30});}};
 step(2);fire.active=true;notify();step(.1);
 assert.equal(walker.read().attention.focus?.id,'flame-emitter','a fresh look has begun before cessation');
 fire.active=false;notify();step(1/30);
 assert.equal(walker.read().attention.arrested,true,'the actual flame bridge requests an arrest');
 const before=walker.read(),poseBefore=walker.pose({bones:['pelvis','spine-chest','head']});
 step(.25);
 const during=walker.read(),poseDuring=walker.pose({bones:['pelvis','spine-chest','head']});
 assert.equal(during.playback.status,'playing','an attention hold does not change the authored Run/Pause choice');
 assert.equal(during.playback.frame,before.playback.frame,'the stride sample is held');
 assert.deepEqual(poseDuring.bones.slice(0,2),poseBefore.bones.slice(0,2),'pelvis and chest do not travel or animate during arrest');
 assert.ok(poseDuring.bones[2].matrix.some((v,i)=>Math.abs(v-poseBefore.bones[2].matrix[i])>1e-5),'head scanning continues while the stride is held');
 step(4);
 assert.equal(walker.read().attention.arrested,false,'the independent attention clock releases locomotion');
 assert.notDeepEqual(walker.pose({bones:['pelvis']}).bones,poseBefore.bones.slice(0,1),'walking resumes without a user play command');
 await walker.dispose();assert.equal(notify,null,'dispose removes the flame subscription');

 // FC-1: exercise rejected and disappearing probes through the actual timer
 // bridge. Missing observations must not become long exposure at the old level.
 const timers={set:globalThis.setInterval,clear:globalThis.clearInterval};let poll;
 globalThis.setInterval=fn=>{poll=fn;return {testTimer:true};};globalThis.clearInterval=()=>{};
 let sampled;
 try{
  fire={active:true,paused:false};let power=1,reject=false;
  const probe={sample:async points=>{if(reject)throw Error('probe unavailable');return {status:'effective',source:{power},values:points.map(()=>({luminance:.1*power}))};}};
  window.kaminosFireLightProbe=probe;
  sampled=await createWalkingCreature({host,inputs:{...inputs,choices:[],attention:{interests:[],flame:{interest:1}}}},dependencies);await Promise.resolve();
  await sampled.operations.action({kind:'wander'});
  const tick=()=>{for(let i=0;i<8;i++){scene.updateMatrixWorld(true);callback?.({deltaSeconds:1/30});}};
  await poll();reject=true;tick();await poll();
  assert.equal(sampled.read().attention.light.status,'unavailable','FC-1: a rejected probe lowers sensory status');
  for(let i=0;i<119;i++){tick();await poll();}
  reject=false;power=8;for(let i=0;i<8;i++){tick();await poll();}
  power=1;for(let i=0;i<16;i++){tick();await poll();}
  const faded=sampled.read().attention.history.find(e=>e.kind==='interrupt'&&e.cause==='light faded');
  assert.ok(faded&&faded.familiarity<.2,'FC-1: failed polls did not teach the old power as a familiar destination');
  delete window.kaminosFireLightProbe;tick();await poll();
  assert.equal(sampled.read().attention.light.status,'unavailable','a disappearing probe also breaks observation continuity');
 }finally{await sampled?.dispose();globalThis.setInterval=timers.set;globalThis.clearInterval=timers.clear;delete window.kaminosFireLightProbe;}

 // Actual timer -> source-state onset -> retained motion consumer. The light
 // probe deliberately keeps its cached lit output while the source is off,
 // matching the native volume-toggle observation from the room.
 for(const engage of [false,true]){
 let onsetWalker,onsetPoll;const savedTimers={set:globalThis.setInterval,clear:globalThis.clearInterval};
 globalThis.setInterval=fn=>{onsetPoll=fn;return {};};globalThis.clearInterval=()=>{};
 try{
  fire={active:false,paused:false};
  window.kaminosFireLightProbe={sample:async points=>({status:'effective',source:{power:700},values:points.map(()=>({luminance:.08}))})};
  onsetWalker=await createWalkingCreature({host,inputs:{...inputs,choices:[],attention:{engage,interests:[],flame:{interest:1}}}},dependencies);await Promise.resolve();
  await onsetWalker.operations.action({kind:'wander'});
  const advance=seconds=>{for(let i=0;i<Math.round(seconds*60);i++){scene.updateMatrixWorld(true);callback?.({deltaSeconds:1/60});}};
  advance(.1); // OS-1: source transition precedes the first successful poll.
  fire.active=true;notify();advance(.1);await onsetPoll();advance(1/60);
  assert.ok(onsetWalker.read().attention.startle,'real timer bridge reads onset despite cached light while off');
  const before=onsetWalker.read(),pose=onsetWalker.pose({bones:['pelvis','spine-chest']});
  advance(.1);
  assert.equal(onsetWalker.read().playback.frame,before.playback.frame,'startle holds retained stride');
  assert.deepEqual(onsetWalker.pose({bones:['pelvis']}).bones,pose.bones.slice(0,1),'root does not slide during recoil');
  assert.notDeepEqual(onsetWalker.pose({bones:['spine-chest']}).bones,pose.bones.slice(1),'chest expresses the pulse while stride is held');
  advance(3);assert.equal(onsetWalker.read().attention.startle,null);
  if(engage){assert.equal(onsetWalker.read().action.engagement.phase,'cautious','strong native light bridge onset extends caution beyond recoil');advance(5);}
  assert.ok(onsetWalker.read().action.motion.elapsed>before.action.motion.elapsed,'autonomous walking resumes');
  if(engage){onsetWalker.operations.pause();onsetWalker.operations.engagement({enabled:false});assert.equal(onsetWalker.read().action.engagement.phase,'wandering');assert.equal(onsetWalker.read().action.motion.path.status,'wandering');assert.equal(onsetWalker.read().recipe.attention.engage,false);}

 }finally{await onsetWalker?.dispose();globalThis.setInterval=savedTimers.set;globalThis.clearInterval=savedTimers.clear;delete window.kaminosFireLightProbe;}

 }
 // Wander held-endpoint and removed-area cases return with the Wander action
 // (not on this host yet).
}finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
console.log('Attention uses the applied cast profile and clears its turn when switched off while paused');

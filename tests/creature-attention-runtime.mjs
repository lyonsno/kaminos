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
 const head=()=>creature.inspect().boneWorld.find(b=>b.name==='head').matrix;
 const turned=head(),frame=creature.read().playback.frame,turnedVertices=creature.inspect().vertices;
 creature.operations.attention({enabled:false});
 const state=creature.read();
 assert.equal(state.playback.status,'paused');assert.equal(state.playback.frame,frame,'paused frame is unchanged');
 assert.equal(state.attention.enabled,false);
 const local=creature.inspect().boneWorld.find(b=>b.name==='head');
 assert.ok(head().some((v,i)=>Math.abs(v-turned[i])>1e-6),'disabling removes the head turn immediately');
 const q=new THREE.Quaternion();new THREE.Matrix4().fromArray(local.matrix).decompose(new THREE.Vector3(),q,new THREE.Vector3());
 assert.ok(q.angleTo(new THREE.Quaternion())<1e-9,'head returns to the unmodified source orientation');
 assert.ok(creature.inspect().vertices.some((v,i)=>Math.abs(v-turnedVertices[i])>1e-6),'the deformed body follows');
 await creature.dispose();

 // Wander: switching attention while held at the final frame keeps that exact
 // frame and action state; with the area removed the turn still clears.
 const wanderer=await createWalkingCreature({host,inputs:{...inputs,action:'wander',play:false}},dependencies);
 const actionState=()=>{const r=wanderer.read();return {status:r.playback.status,frame:r.playback.frame,cycle:r.cycle,motion:JSON.stringify(r.action.motion)};};
 wanderer.operations.seek({frame:frames-1});const held=actionState(),heldHead=wanderer.inspect().boneWorld.find(b=>b.name==='head').matrix;
 wanderer.operations.attention({enabled:false});
 assert.deepEqual(actionState(),held,'toggling attention at a held Wander endpoint keeps frame, status, cycle and path');
 assert.deepEqual(wanderer.inspect().boneWorld.find(b=>b.name==='head').matrix,heldHead,'the held source sample is unchanged');
 wanderer.operations.attention({enabled:true});
 wanderer.operations.play();for(let i=0;i<45;i++){scene.updateMatrixWorld(true);callback?.({deltaSeconds:1/30});}
 assert.ok(wanderer.read().attention.weight>.8,`wandering attention blended in (${wanderer.read().attention.weight})`);
 wanderer.operations.pause();
 scene.getObjectByName('Wander area').removeFromParent();
 const turnedWhileHeld=wanderer.inspect().boneWorld.find(b=>b.name==='head').matrix,before=actionState();
 wanderer.operations.attention({enabled:false});
 assert.deepEqual(actionState(),before,'removed area: action state unchanged');
 assert.ok(wanderer.inspect().boneWorld.find(b=>b.name==='head').matrix.some((v,i)=>Math.abs(v-turnedWhileHeld[i])>1e-6),'removed area: disabling still clears the turn');
 await wanderer.dispose();
}finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
console.log('Attention uses the applied cast profile and clears its turn when switched off while paused');

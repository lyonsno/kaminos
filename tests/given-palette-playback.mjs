// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module;try{module=await import('../experiments/creature-motion/given-palette-playback.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!error.message.includes('given-palette-playback.mjs'))throw error;module={};}
assert.equal(typeof module.attachGivenPalettePlayback,'function','ordinary live Bone runtime lacks source-motion playback');
class Element{constructor(){this.children=[];this.style={};}append(...nodes){this.children.push(...nodes);}setAttribute(){}remove(){this.removed=true;}}
const document={createElement:()=>new Element()},mountRoot=new Element(),scene=new THREE.Scene(),group=new THREE.Group(),bone=new THREE.Bone();bone.name='pelvis';group.add(bone);scene.add(group);
let clock=0,updates=0;const original=()=>{updates++;},runtime={group,bones:new Map([['pelvis',bone]]),update:original};
const I=new THREE.Matrix4().toArray(),adapter={frames:3,fps:30,jointNames:['pelvis'],frame(index){const actor=new THREE.Matrix4().makeTranslation(index,0,0).toArray();return {frame:index,actorMatrix:actor,bones:[{name:'pelvis',parent:null,localMatrix:I,worldMatrix:actor,skinMatrix:I}]};}};
const source={motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)};
const player=module.attachGivenPalettePlayback({THREE,runtime,adapter,source,document,mountRoot,now:()=>clock,dirty:()=>{}});
player.play();clock=34;player.tick(clock);assert.equal(player.read().frame,1);assert.equal(group.position.x,1);assert.equal(bone.position.x,0,'actor travel must not duplicate into the Bone');
player.pause();clock=1000;player.tick(clock);assert.equal(player.read().frame,1);assert.equal(group.position.x,1);
player.seek(2);assert.equal(player.read().status,'held');assert.equal(group.position.x,2);
player.replay();clock+=34;player.tick(clock);assert.equal(player.read().frame,1);
player.pause();bone.position.y=.2;runtime.update();assert.equal(player.read().editedSinceSourcePose,true,'gizmo edits must not impersonate exact source pose');
assert.equal(typeof player.restore,'function','source playback must retain the editable pre-motion actor and Bone pose');
player.restore();assert.equal(group.position.x,0);assert.equal(bone.position.y,0);assert.equal(player.read().status,'restored');assert.equal(player.read().frame,null,'starting pose is not a generated source frame');
assert.throws(()=>player.seek(3),/frame/);assert.equal(player.read().frame,1);
player.dispose();assert.equal(runtime.update,original);assert.equal(group.parent,scene,'motion disposal must preserve skin owner root');assert.equal(mountRoot.children[0].removed,true);assert.ok(updates>0);
console.log('Existing host update drives source playback once; pause/hold/edit identity/dispose remain explicit');

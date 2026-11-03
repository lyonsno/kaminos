// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEngagement} from '../experiments/creature-motion/engagement.mjs';
import * as THREE from '../lib/three.core.js';
import {createCreatureAttention,deriveHeadProfile,sceneObjectInterests,flameInterests,lightSamplePoints} from '../experiments/creature-motion/creature-attention.mjs';

// A small quadruped spine in the retained rigs' convention: rest rotations map
// head-local +Y to rest -Z (forward) and head-local +Z to rest +Y (up).
const restRotation=[[1,0,0],[0,0,1],[0,-1,0]];
const restAt=p=>[[...restRotation[0],p[0]],[...restRotation[1],p[1]],[...restRotation[2],p[2]],[0,0,0,1]];
const names=['pelvis','spine-chest','neck','head','head-end'],parents=[null,'pelvis','spine-chest','neck','head'];
const restPositions=[[0,0,0],[0,.2,-1],[0,.4,-1.4],[0,.5,-1.8],[0,.6,-2]];
const frame={bones:names.map((name,i)=>({name,parent:parents[i],restMatrix:restAt(restPositions[i])}))};
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


test('initial investigation scales with actual sight evidence',()=>{
 const drives=[];
 for(const interest of [.15,1.5]){
  const c=creature(),a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'prop',point:[0,.5,-2.8],interest}]});
  run(a,c,1/30);const sensed=a.read(),e=createEngagement();
  const state=e.update({time:0,position:[0,0,0],observed:sensed.perceived,focus:sensed.focus});
  drives.push(sensed.perceived[0]?.drive);if(interest===1.5)assert.ok(state.motivation.drive>0);
  a.dispose();
 }
 assert.ok(drives.every(Number.isFinite),'actual attention observations carry measured drive');
 assert.ok(drives[1]>drives[0]*8,'ten times stronger sight must produce substantially stronger initial interest');
});
test('a source output change without received light cannot supply an offscreen bearing',()=>{
 for(const local of [0,.5]){
  const c=creature(),source={id:'fire',point:[0,.5,3]},a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[]});
  a.sense({time:0,source,sourcePower:0,samples:[{point:[0,0,0],luminance:0}]});
  a.sense({time:.1,source,sourcePower:1,samples:[{point:[0,0,0],luminance:local}]});run(a,c,1/30,.1);
  if(local===0){assert.equal(a.read().focus,null,'a wholly dark field supplies no source bearing');assert.equal(a.read().startle,null);}
  else assert.equal(a.read().focus?.id,'fire','measured local illumination still orients offscreen');
  a.dispose();
 }
});
test('source diagnostics distinguish range and gaze rejection from perception',()=>{
 const c=creature(),a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[{id:'behind',point:[0,.5,3],interest:1,noticeRadius:12},{id:'far',point:[0,.5,-20],interest:1}]});run(a,c,1/30);
 assert.equal(a.read().candidates.find(x=>x.id==='behind').gate,'outside gaze');
 assert.equal(a.read().candidates.find(x=>x.id==='far').gate,'out of range');
 assert.equal(a.read().perceived.length,0);a.dispose();
});
test('an unavailable probe cannot relabel old measurements as current',()=>{
 const a=createCreatureAttention({THREE,rigFrame:frame,profile,options:{idleScan:false},interests:()=>[]});
 a.sense({time:1,samples:[{point:[0,0,0],luminance:.2}]});a.sense({time:2,status:'unavailable',samples:null});
 const light=a.read().light;assert.equal(light.status,'unavailable');assert.equal(light.sampleTime,1,'Raw measurements retain the last actual sampling time');assert.equal(light.time,2,'Probe status keeps its own report time');a.dispose();
});

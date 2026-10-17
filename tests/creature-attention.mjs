// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createCreatureAttention,deriveHeadProfile,sceneObjectInterests} from '../experiments/creature-motion/creature-attention.mjs';

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

{
 // An interesting prop off to the side ahead is noticed without any command:
 // the head turns toward it while the reticle marks it, then boredom releases it.
 const c=creature(),point=[1,.5,-2.6];let present=true;
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,interests:()=>present?[{id:'brazier',point,interest:1,reason:'authored'}]:[]});
 c.placement.add(attention.reticle);
 const before=alignment(c.bones,point);
 let t=run(attention,c,1.2);
 let state=attention.read();
 assert.equal(state.focus?.id,'brazier','unprompted acquisition of the nearby interest');
 assert.ok(state.weight>.85,`look has blended in (${state.weight})`);
 assert.ok(alignment(c.bones,point)>before+.2,`head actually turns toward it (${before} -> ${alignment(c.bones,point)})`);
 assert.ok(attention.reticle.visible,'reticle shows the active focus');
 attention.reticle.traverse(node=>assert.ok(!node.isLineLoop,'reticle uses primitives the WebGPU renderer draws'));
 c.placement.updateMatrixWorld(true);const marked=attention.reticle.getWorldPosition(new THREE.Vector3());
 assert.ok(marked.distanceTo(new THREE.Vector3(...point))<1e-6,'reticle sits on the focus point');
 // Record the rhythm rather than sampling one instant: a hold, a real
 // look-away with the reticle gone, then renewed interest.
 const trace=[];for(let i=0;i<25*30;i++){t=run(attention,c,1/30,t);const s=attention.read();trace.push({t,focus:s.focus?.id??null,weight:s.weight,reticle:attention.reticle.visible});}
 const firstAway=trace.findIndex(row=>row.focus===null);
 assert.ok(firstAway>0&&trace[firstAway].t-trace[0].t>.5,'the focus is held for a while before release');
 let longest=0,run0=null;for(const row of trace){if(row.focus===null&&row.weight<.05&&!row.reticle){run0??=row.t;longest=Math.max(longest,row.t-run0);}else run0=null;}
 assert.ok(longest>2,`a real look-away with the reticle gone (${longest.toFixed(2)} s)`);
 assert.ok(trace.slice(firstAway).some(row=>row.focus==='brazier'),'interest recovers after looking away for a while');
 const switches=trace.filter((row,i)=>i&&(row.focus===null)!==(trace[i-1].focus===null)).length;
 assert.ok(switches<=6,`no flip-flopping (${switches} acquire/release changes in 25 s)`);
 present=false;t=run(attention,c,3,t);
 assert.equal(attention.read().focus,null,'removing the prop releases attention after brief memory');
}

{
 // Behind the animal or out of range: nothing is noticed and the pose is untouched.
 for(const point of [[0,.5,3],[0,.5,-9]]){
  const c=creature(),attention=createCreatureAttention({THREE,rigFrame:frame,profile,interests:()=>[{id:'p',point,interest:1,reason:'authored'}]});
  const before=c.bones.get('head').matrixWorld.clone();run(attention,c,2);
  assert.equal(attention.read().focus,null,`no focus for ${point}`);
  assert.ok(c.bones.get('head').matrixWorld.equals(before),'unattending pose stays exactly the animated pose');
 }
}

{
 // Interests resolve from live scene objects and follow the prop when moved.
 const scene=new THREE.Scene(),prop=new THREE.Mesh(new THREE.BoxGeometry(1,2,1));prop.userData.kaminosSceneObject={id:'mesh-1',label:'Brazier'};prop.position.set(3,1,0);scene.add(prop);
 const read=sceneObjectInterests({THREE,root:()=>scene,specs:[{object:'mesh-1',interest:.8},{object:'missing',interest:1}]});
 let rows=read();assert.equal(rows.length,1,'missing scene objects contribute nothing');
 assert.deepEqual(rows[0].point.map(v=>+v.toFixed(9)),[3,2,0],'top anchor of the prop');
 prop.position.x=5;rows=read();assert.equal(rows[0].point[0],5,'moving the prop moves the interest');
 assert.throws(()=>sceneObjectInterests({THREE,root:()=>scene,specs:[{object:'mesh-1',interest:-1}]}),/finite and nonnegative/);
}
{
 // Two equally interesting props side by side (the braziers stand in clusters):
 // the creature holds one before considering the other, and rests after letting go.
 const c=creature(),points={a:[.6,.5,-2.6],b:[-.6,.5,-2.6]};
 const attention=createCreatureAttention({THREE,rigFrame:frame,profile,interests:()=>Object.entries(points).map(([id,point])=>({id,point,interest:1,reason:'authored'}))});
 let t=0;const trace=[];for(let i=0;i<30*30;i++){t=run(attention,c,1/30,t);trace.push({t,focus:attention.read().focus?.id??null});}
 const spans=[];for(const row of trace){const last=spans.at(-1);if(!last||last.focus!==row.focus)spans.push({focus:row.focus,start:row.t,end:row.t});else last.end=row.t;}
 const held=spans.slice(0,-1).filter(s=>s.focus!==null);
 assert.ok(held.length>=2,'both props get attention over time');
 for(const span of held)assert.ok(span.end-span.start>=1.4,`each focus is held before moving on (${span.focus} for ${(span.end-span.start).toFixed(2)} s)`);
 const rests=spans.slice(1,-1).filter(s=>s.focus===null);
 assert.ok(rests.length>=1&&rests.every(s=>s.end-s.start>=1.5),`after letting go the creature rests (${rests.map(s=>(s.end-s.start).toFixed(2))})`);
}
console.log('Creatures notice authored interests unprompted, turn the head toward them, mark them, habituate and release');

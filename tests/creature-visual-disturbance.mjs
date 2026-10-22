// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createCreatureAttention} from '../experiments/creature-motion/creature-attention.mjs';
const specs=[['pelvis',null,[0,0,0]],['spine-chest','pelvis',[0,.5,-1]],['neck','spine-chest',[0,.7,-1.4]],['head','neck',[0,.8,-1.8]],['head-end','head',[0,.8,-2]],['foreleg','spine-chest',[.3,.4,-1]],['toe','foreleg',[.3,0,-1]]];
const matrix=p=>new THREE.Matrix4().makeTranslation(...p),frame={bones:specs.map(([name,parent,p])=>({name,parent,restMatrix:[0,1,2,3].map(r=>[0,1,2,3].map(c=>matrix(p).elements[c*4+r]))}))};
function animal(){
 const group=new THREE.Group(),bones=new Map(),base=new Map();
 for(const [name,parent,p] of specs){const b=new THREE.Bone();b.name=name;const m=matrix(p);if(parent)m.premultiply(matrix(specs.find(s=>s[0]===parent)[2]).invert());m.decompose(b.position,b.quaternion,b.scale);(bones.get(parent)??group).add(b);bones.set(name,b);base.set(name,m);}
 const fire={id:'fire',point:[.8,1,-2.5],interest:1,active:false,restless:false};
 const a=createCreatureAttention({THREE,rigFrame:frame,profile:{forward:[0,0,-1],up:[0,1,0]},interests:()=>[{...fire}],options:{idleScan:false}});
 let t=0;
 function step(dt=.025){t+=dt;for(const [n,m] of base)m.decompose(bones.get(n).position,bones.get(n).quaternion,bones.get(n).scale);group.updateMatrixWorld(true);a.modify({bones,group,time:t});group.updateMatrixWorld(true);return a.read();}
 const sample=(level,power=level)=>a.sense({time:t,source:fire,sourcePower:power,samples:[{point:[0,0,0],luminance:level}]});
 const seconds=n=>{for(let i=0;i<Math.round(n/.025);i++)step();};
 return {a,bones,group,fire,step,sample,seconds,time:()=>t};
}

// No lighting probe: source geometry alone must drive a visible transient.
function geometricBurst(radius,distance){
 const c=animal();c.fire.point=[0,.8,-1.8-distance];c.fire.visual={center:[...c.fire.point],radius,provenance:'test-rigid-geometry'};
 c.step();c.seconds(.5);c.fire.active=true;const state=c.step(.05);return {c,state};
}
const near=geometricBurst(.5,1),far=geometricBurst(.5,8);
assert.ok(near.state.startle,'An observed large visual onset must recruit the body without a light change');
assert.ok(near.state.startle.strength>(far.state.startle?.strength??0),'The same source has more visual impact nearby');
near.c.seconds(.1);assert.ok(near.c.bones.get('spine-chest').quaternion.angleTo(new THREE.Quaternion())>.005,'Geometric disturbance reaches actual chest pose');
{
 const c=animal();c.fire.active=true;c.fire.visual={center:[...c.fire.point],radius:.4,provenance:'test-rigid-geometry'};c.step();
 assert.equal(c.a.read().startle,null,'First sight is not an observed appearance');
 c.group.position.x+=.2;c.step(.05);
 assert.equal(c.a.read().startle,null,'Self-motion past a stationary source does not manufacture a source disturbance');
 c.fire.visual.radius=1.2;c.step(.05);
 assert.ok(c.a.read().startle,'A rapid expansion recruits the same response');
}
console.log('Geometric visual transients reach the actual attention and body consumer');

const {createVisualDisturbance}=await import('../experiments/creature-motion/visual-disturbance.mjs');
const shape=(x=0,radius=.5)=>({center:[x,0,-2],radius,provenance:'rigid-test'});
const input=(time,visual,extra={})=>({time,eye:[0,0,0],visual,...extra});
const motion=(duration,radius=.5)=>{const v=createVisualDisturbance();v.update(input(0,shape(0,radius)));return v.update(input(duration,shape(1,radius)));};
assert.ok(motion(.1).strength>motion(2).strength,'Fast lateral motion is stronger than the same slow displacement');
assert.ok(motion(.1,1).strength>motion(.1,.1).strength,'Large moving sources sweep more visual area');
{
 const v=createVisualDisturbance();v.update(input(0,shape()));
 assert.equal(v.update(input(.1,shape(),{eye:[1,0,0]})).triggered,false,'Observer translation is removed');
 v.update(input(.2,shape(),{observed:false}));
 assert.equal(v.update(input(.3,shape(2))),null,'Returning after a visibility gap establishes a baseline');
}
{
 const v=createVisualDisturbance();v.update(input(0,{...shape(),sampleTime:0}));
 for(let i=1;i<10;i++)assert.equal(v.update(input(i*.025,{...shape(),sampleTime:0})),null);
 const event=v.update(input(.25,{...shape(1),sampleTime:.25}));
 assert.equal(event.dt,.25,'Async source samples use their observation interval, not the last display frame');
}
{
 const v=createVisualDisturbance();v.update(input(0,shape(),{active:false}));
 const event=v.update(input(.1,shape()));assert.ok(event.triggered);
 for(let i=2;i<30;i++)assert.equal(v.update(input(i*.1,shape())).triggered,false,'A held visual change cannot retrigger continuously');
}
const {sceneObjectInterests}=await import('../experiments/creature-motion/creature-attention.mjs');
{
 const scene=new THREE.Scene(),box=new THREE.Mesh(new THREE.BoxGeometry(1,2,3));box.userData.kaminosSceneObject={id:'box'};scene.add(box);scene.updateMatrixWorld(true);
 const read=sceneObjectInterests({THREE,root:()=>scene,specs:[{object:'box',interest:1}]});
 const first=read()[0];box.position.x=2;box.scale.setScalar(3);scene.updateMatrixWorld(true);const next=read()[0];
 assert.equal(next.visual.radius,first.visual.radius*3);assert.equal(next.visual.center[0],2);
 box.visible=false;assert.equal(read()[0].active,false,'Ordinary object visibility supplies an observed appearance transition');
}

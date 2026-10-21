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
function burst(level,{familiar=false}={}){
 const c=animal();
 if(familiar){c.fire.active=true;c.fire.restless=true;c.step();c.sample(level);c.seconds(300);c.sample(level);}
 c.fire.active=false;c.fire.restless=false;c.step();c.seconds(4);c.sample(0);c.step(.25);c.sample(0);
 c.fire.active=true;c.fire.restless=true;c.step();c.sample(level);c.step(.025);
 assert.ok(c.a.read().startle,'an observed burst recruits a bodily response');
 const event=c.a.read().startle;c.seconds(.1);
 const chest=c.bones.get('spine-chest'),toe=c.bones.get('toe');
 assert.ok(chest.quaternion.angleTo(new THREE.Quaternion())>.005,'chest actually recoils');
 assert.ok(toe.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(.3,0,-1))<1e-8,'retained foot stays planted');
 assert.ok(c.a.motionSeconds(c.time(),c.time()+.05)<.001,'stride checks during initial recoil');
 c.seconds(4);assert.equal(c.a.read().startle,null,'response settles');assert.equal(c.a.read().arrested,false);
 assert.ok(chest.quaternion.angleTo(new THREE.Quaternion())<1e-8,'chest returns exactly to source pose');
 return event;
}
const small=burst(.01),large=burst(.4),known=burst(.4,{familiar:true});
assert.ok(large.strength>small.strength*1.5,'experienced magnitude strongly changes bodily amplitude');
assert.ok(Math.abs(known.strength-large.strength)<1e-8,'familiarity does not erase the initial reflex');
assert.ok(known.until-known.since<large.until-large.since,'familiar destination permits faster recovery');
{
 const c=animal();c.fire.active=true;c.fire.restless=true;c.step();c.sample(.4);c.step();
 assert.equal(c.a.read().startle,null,'first sight of an already burning flame is not an observed burst');
 c.sample(0);c.step(.25);c.sample(.4);c.step();assert.ok(c.a.read().startle,'a measured local rise also recruits the body');
 c.a.setEnabled(false);assert.equal(c.a.read().startle,null);assert.equal(c.a.read().arrested,false);
}
{
 const c=animal();c.fire.active=true;c.fire.restless=true;c.step();c.sample(.01);
 for(let i=0;i<100;i++){c.step(.25);c.sample(.01+i*.001);}
 assert.equal(c.a.read().history.filter(e=>e.kind==='startle').length,0,'gradual brightening is not a startle');
 c.a.sense({time:c.time(),status:'unavailable',samples:null});c.step(.25);c.sample(10);c.step();
 assert.equal(c.a.read().startle,null,'a sensory gap cannot manufacture an abrupt rise');
}
{
 const c=animal();c.step();c.seconds(2);c.fire.active=true;c.fire.restless=true;c.step();
 c.a.sense({time:c.time(),status:'unavailable',samples:null});c.seconds(.25);c.sample(.4);c.step();
 assert.equal(c.a.read().startle,null,'an old onset cannot survive a sensory gap and startle late');
}
{
 const c=animal();c.step();c.seconds(3);c.sample(0);c.fire.active=true;c.fire.restless=true;c.step(.25);c.sample(.01);c.step();
 const first=c.a.read().startle;assert.ok(first);c.step(.25);c.sample(.4);
 const next=c.a.read().startle;assert.ok(next.strength>first.strength,'a stronger burst during recovery intensifies recoil');
 assert.ok(next.initialStrength>0,'intensification starts from the ongoing recoil, not zero');
 c.step();assert.ok(c.a.read().arrested,'stronger follow-up checks stride again');
}
console.log('Magnitude-scaled bodily startle, planted feet, familiarity recovery, and sensory continuity');

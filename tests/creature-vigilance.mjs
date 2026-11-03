// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createEngagement} from '../experiments/creature-motion/engagement.mjs';
import {createCreatureAttention} from '../experiments/creature-motion/creature-attention.mjs';

const source={id:'source',point:[2,0,0],standOff:1};
function motive(strength,position=[0,0,0]){
 const e=createEngagement();
 e.update({time:0,position,observed:[source],focus:source,alarm:{...source,since:0,strength,familiarity:0}});
 return {e,state:e.update({time:1,position,observed:[source],focus:source})};
}
const strong=motive(.95),gentle=motive(.2),near=motive(.95,[1.5,0,0]);
assert.ok(strong.state.watch?.strength>.5,'high fear and interest retain a separate watch intention');
assert.equal(strong.state.watch.id,source.id);
assert.ok(strong.state.pace>1,'urgent withdrawal speeds the gait');
assert.ok(near.state.pace>strong.state.pace,'being nearer than the desired distance increases withdrawal urgency');
assert.ok(gentle.state.pace<1,'cautious approach is slower than ordinary walking');
const before=strong.state.motivation;
const held=strong.e.update({time:1.1,position:[-3,0,0],observed:[source],focus:source});
assert.equal(held.phase,'cautious');assert.ok(held.watch.strength>0,'reaching distance does not discharge vigilance');
assert.ok(held.motivation.aversion<before.aversion,'recovery follows observation time');
const unseen=strong.e.update({time:1.2,position:[-3,0,0],observed:[],focus:null});
assert.deepEqual(unseen.watch.point,source.point);assert.equal(unseen.watch.remembered,true);
assert.equal(strong.e.update({time:5,position:[-3,0,0],observed:[],focus:null}).watch??null,null,'unobserved watch eventually releases');

const specs=[['pelvis',null,[0,0,0]],['spine-chest','pelvis',[0,.5,-1]],['neck','spine-chest',[0,.7,-1.4]],['head','neck',[0,.8,-1.8]],['head-end','head',[0,.8,-2]]];
const matrix=p=>new THREE.Matrix4().makeTranslation(...p);
const frame={bones:specs.map(([name,parent,p])=>({name,parent,restMatrix:[0,1,2,3].map(r=>[0,1,2,3].map(c=>matrix(p).elements[c*4+r]))}))};
function animal(){
 const group=new THREE.Group(),bones=new Map(),base=new Map();
 for(const [name,parent,p] of specs){const b=new THREE.Bone(),m=matrix(p);b.name=name;if(parent)m.premultiply(matrix(specs.find(s=>s[0]===parent)[2]).invert());m.decompose(b.position,b.quaternion,b.scale);(bones.get(parent)??group).add(b);bones.set(name,b);base.set(name,m);}
 const item={id:'watched',point:[.5,.8,-4],interest:1,sensed:true},other={id:'other',point:[-.8,.8,-3],interest:0};
 const a=createCreatureAttention({THREE,rigFrame:frame,profile:{forward:[0,0,-1],up:[0,1,0]},interests:()=>[item,other],options:{idleScan:false}});
 let t=0;
 function step(){t+=1/30;for(const [n,m] of base)m.decompose(bones.get(n).position,bones.get(n).quaternion,bones.get(n).scale);group.updateMatrixWorld(true);a.modify({bones,group,time:t});return a.read();}
 return {a,group,bones,item,other,step,time:()=>t};
}
function watchHidden(hidden){
 const c=animal();for(let i=0;i<30;i++)c.step();
 const last=[...c.item.point];let until=0;const rows=[];
 for(let i=0;i<240;i++){
  until=c.time()+2;
  c.a.setEngagement({id:c.item.id,watch:{id:c.item.id,point:[...c.item.point],strength:.9,lastObservedAt:c.time(),until}});
  rows.push(c.step());
 }
 assert.ok(rows.filter(r=>r.focus?.id===c.item.id).length>220,'vigilance survives familiarity and owns most gaze time');
 const glances=rows.filter(r=>r.why?.cause==='checking surroundings');
 assert.ok(glances.length>0&&glances.length<20,'brief deliberate checks return to watch');
 assert.equal(rows.at(-1).focus?.id,c.item.id);
 c.item.sensed=false;c.item.point=hidden;
 c.a.setEngagement({id:c.item.id,watch:{id:c.item.id,point:last,strength:.9,lastObservedAt:c.time(),until:c.time()+1}});
 for(let i=0;i<12;i++)c.step();
 const gap=c.a.read();assert.equal(gap.focus?.id,c.item.id);assert.equal(gap.focus.remembered,true);assert.deepEqual(gap.focus.point,last,'watch remembers an observation, never the hidden transform');
 for(let i=0;i<100;i++)c.step();assert.notEqual(c.a.read().focus?.id,c.item.id,'stale watch expires');
 c.a.setEnabled(false);assert.equal(c.a.read().focus,null);
 return gap.focus.point;
}
assert.deepEqual(watchHidden([100,100,100]),watchHidden([-100,-100,-100]));
console.log('Vigilance survives conflicting motives; brief checks return, unseen transforms do not steer, and urgency changes pace');

// A fresh competing disturbance borrows gaze; it does not discharge the watch.
{
 const c=animal();for(let i=0;i<150;i++)c.step();
 c.a.setEngagement({id:c.item.id,watch:{id:c.item.id,point:[...c.item.point],strength:.9,lastObservedAt:c.time(),until:c.time()+10}});
 for(let i=0;i<20;i++)c.step();
 c.other.interest=2;c.other.point[0]+=.5;
 const redirected=[];for(let i=0;i<12;i++)redirected.push(c.step());
 assert.ok(redirected.some(r=>r.focus?.id==='other'),'observed new disturbance interrupts vigilance briefly');
 for(let i=0;i<24;i++)c.step();assert.equal(c.a.read().focus?.id,c.item.id,'the original unresolved concern regains gaze');
}

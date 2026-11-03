// kaminos-test: node
import assert from 'node:assert/strict';
import {createEngagement} from '../experiments/creature-motion/engagement.mjs';
const source={id:'unchanged',point:[5,0,0],standOff:1,approach:true,familiarity:1};
function run({behavior={},gap=false,stop=false,event=false}={}){
 const e=createEngagement({behavior}),rows=[];
 for(let i=0;i<=600;i++){
  const time=i/10,hidden=gap&&i===40,cessation=stop&&i===10?{...source,since:1,until:2,surprise:.8}:null;
  const seen={...source,eventAt:event&&i>=400?40:null,eventStrength:1};
  rows.push({time,...e.update({time,position:[0,0,0],observed:hidden?[]:[seen],focus:hidden?null:source,cessation,interrupted:!!cessation})});
 }
 return rows;
}
const plain=run();
assert.ok(plain.slice(300).every(r=>r.phase==='wandering'),'Unchanged familiar source must stay satisfied after its first investigation, even if gaze supplies it again');
const stopped=run({stop:true}),glance=run({stop:true,gap:true});
assert.ok(glance[41].motivation.drive<glance[39].motivation.drive,'A brief look-away/back must not refill unchanged quiet-source interest');
assert.ok(glance.slice(300).every(r=>r.phase==='wandering'),'Brief sensory gaps cannot restart a satisfied investigation');
const renewed=run({event:true});
assert.ok(renewed.slice(400,430).some(r=>r.id===source.id&&r.phase!=='wandering'),'A fresh observed change renews satisfied interest');
assert.ok(renewed.slice(570).every(r=>r.phase==='wandering'),'One event timestamp cannot replenish drive every frame');
const release=rows=>rows.find(r=>r.time>1&&r.phase==='wandering').time;
assert.ok(release(run({behavior:{habituation:2}}))<release(plain),'Faster habituation satisfies interest sooner');
assert.equal(release(run({behavior:{recoveryTime:3}})),release(plain),'Fear recovery does not set quiet-interest decay');
const e=createEngagement();
e.update({time:0,position:[0,0,0],observed:[source],focus:source});
for(let i=1;i<300;i++)e.update({time:i/10,position:[0,0,0],observed:[source],focus:source});
const near={...source,point:[2,0,0]};
const alarm=e.update({time:30,position:[0,0,0],observed:[near],focus:near,alarm:{...near,since:30,strength:.95,familiarity:1}});
assert.equal(alarm.phase,'cautious');
assert.equal(e.update({time:31,position:[0,0,0],observed:[near],focus:near}).phase,'withdrawing','A strong disturbance still renews aversion after interest is satisfied');
console.log('Familiar experience spends interest, brief gaps preserve satisfaction, and fresh change renews it independently of recovery');

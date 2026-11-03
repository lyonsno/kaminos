// kaminos-test: node
import assert from 'node:assert/strict';
import {createEngagement} from '../experiments/creature-motion/engagement.mjs';
const source={id:'source',point:[2,0,0],standOff:1,approach:true};
function response(strength,behavior={}){
 const e=createEngagement({behavior}),alarm={id:source.id,point:[...source.point],since:0,strength,familiarity:0};
 const step=(time,extra={})=>e.update({time,position:[0,0,0],observed:[source],focus:source,...extra});
 step(0,{alarm});const state=step(1.2);return {e,step,state};
}
const weak=response(.2),strong=response(.95);
assert.equal(weak.state.phase,'approaching','gentle change permits investigation');
assert.equal(strong.state.phase,'withdrawing','strong nearby change buys distance instead of merely a longer look');
assert.ok(strong.state.destination[0]<0,'withdrawal requests movement away from the observed source');
assert.ok(strong.state.motivation.drive>0&&strong.state.motivation.aversion>strong.state.motivation.drive,'conflicting motives remain separately visible');
const cessation={id:source.id,point:[...source.point],since:1.3,until:2.3,surprise:.8,cause:'movement stopped'};
assert.equal(strong.step(1.3,{observed:[],focus:null,cessation,interrupted:true}).hold,true,'cessation still arrests locomotion');
const after=strong.step(2.4,{observed:[],focus:null});
assert.equal(after.phase,'approaching','unresolved cessation can lead to investigation after arrest');
assert.deepEqual(after.point,source.point,'investigate the last observed location');
assert.ok(after.motivation.caution>after.motivation.aversion,'immediate aversion falls faster than lingering caution');
assert.ok(after.destination[0]>0,'post-cessation movement is toward the place');
const gap=response(.95);gap.step(1.3,{observed:[],focus:null});
assert.equal(gap.step(4.1,{observed:[],focus:null}).phase,'wandering','observation loss alone cannot manufacture a cessation investigation');
const fresh=createEngagement(),familiar=createEngagement();
for(const [e,surprise] of [[fresh,.9],[familiar,.02]]){
 e.update({time:0,position:[0,0,0],observed:[],cessation:{...cessation,since:0,until:1,surprise},interrupted:true});
 e.update({time:1.1,position:[0,0,0],observed:[]});
}
assert.equal(fresh.read().phase,'approaching');
assert.equal(familiar.read().phase,'wandering','a familiar return need not start another investigation');
const renewed=strong.step(2.5,{alarm:{id:source.id,point:[2,0,0],since:2.5,strength:.95,familiarity:0}});
assert.equal(renewed.phase,'cautious','a renewed disturbance interrupts the approach');
assert.equal(strong.step(3.3).phase,'withdrawing');
// Cessation of a different source cannot discharge this source's aversion.
const isolated=response(.95);
isolated.step(1.3,{cessation:{...cessation,id:'other',point:[-4,0,0]},interrupted:true});
const other=isolated.step(2.4,{observed:[source],focus:source});
assert.equal(other.id,source.id);assert.ok(other.motivation.aversion>.5,'source-local aversion survives another source going quiet');
console.log('Drive and aversion change actions; cessation, gaps, familiarity and source identity remain distinct');

// RM-1 amended by satiation: an observed changed return renews interest;
// re-seeing unchanged presence preserves the completed episode.
const returning=createEngagement(),far={...source,point:[5,0,0]};
const again=(time,extra={})=>returning.update({time,position:[0,0,0],observed:[far],focus:far,...extra});
again(0);again(1.1);
again(1.2,{observed:[],focus:null,cessation:{...cessation,since:1.2,until:2.2},interrupted:true});
again(2.3,{observed:[],focus:null});again(12,{observed:[],focus:null});
assert.equal(again(13).phase,'wandering','return does not bypass the completed-episode cooldown');
assert.equal(again(25).phase,'wandering','unchanged observed return preserves satisfaction');
assert.equal(again(25.1,{observed:[{...far,eventAt:25.1}]}).phase,'watching','a fresh observed change renews investigation without recoil');
assert.equal(again(26.2).phase,'approaching','returned source can be investigated again');
const returnedDrive=returning.read().motivation.drive;
assert.equal(again(27).motivation.drive,returnedDrive,'unchanged presence cannot accumulate investigation drive');
const still=createEngagement();
const stillStep=(time,extra={})=>still.update({time,position:[0,0,0],observed:[far],focus:far,...extra});
stillStep(0);stillStep(1.2,{cessation:{...cessation,since:1.2,until:2.2},interrupted:true});
const quiet=stillStep(2.3);assert.equal(quiet.phase,'approaching');
assert.ok(stillStep(3).motivation.drive<quiet.motivation.drive,'continued sight of the stopped source does not restart its event');
assert.ok(stillStep(3.1,{observed:[{...far,eventAt:3.1}]}).motivation.drive>=1,'observed renewed movement can end the cessation episode');

assert.equal(response(.95,{aversion:0}).state.phase,'approaching','aversion control changes the choice while preserving the sensory alarm');
assert.equal(response(.95,{curiosity:3}).state.phase,'inspecting','strong curiosity can outweigh aversion');

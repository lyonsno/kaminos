// kaminos-test: node
import assert from 'node:assert/strict';
import {encounterSteering,createEncounterWorld} from '../experiments/creature-motion/encounters.mjs';
const a={id:'a',position:[0,0],direction:[1,0],speed:1,radius:.5},b={id:'b',position:[2,0],direction:[-1,0],speed:1,radius:.5};
const before=encounterSteering(a,[],{seconds:.1});assert.deepEqual(before.direction,[1,0]);assert.equal(before.distanceScale,1);
const turn=encounterSteering(a,[b],{seconds:.1});assert.ok(turn.direction[1]<0,'head-on walkers choose their own right-hand pass');assert.ok(turn.distanceScale<=1);
const control=encounterSteering(a,[b],{seconds:.1,avoidance:false});assert.deepEqual(control.direction,[1,0]);
const overlap=encounterSteering(a,[{...b,position:[.8,0]}],{seconds:.1,avoidance:false});assert.equal(overlap.touching,true);assert.equal(overlap.distanceScale,0,'contact still stops further forward penetration when anticipation is off');
const high={...b,position:[.8,0],capsules:[{a:[.8,3,0],b:[.8,4,0],radius:.2}]},low={...a,capsules:[{a:[0,0,0],b:[0,1,0],radius:.2}]};assert.equal(encounterSteering(low,[high],{seconds:.1,avoidance:false}).touching,false,'overlapping planning discs are not physical contact between separated bodies');
const world=createEncounterWorld();let x=0;const stop=world.actor('a').register(()=>({mounted:true,...a,position:[x,0],capsules:[]}));world.actor('b').register(()=>({mounted:true,...b,capsules:[]}));world.actor('a').steer({time:1,seconds:.1,direction:[1,0],speed:1});x=99;assert.equal(world.actor('b').steer({time:1,seconds:.1,direction:[-1,0],speed:1}).neighbours,1,'one frame uses one snapshot');stop();assert.equal(world.read().actors,1);world.dispose();assert.throws(()=>encounterSteering(a,[],{seconds:NaN}),/time/);
for(const order of [['a','b'],['b','a']]){
 const room=createEncounterWorld();let shifted=false;
 for(const row of [a,b])room.actor(row.id).register(()=>({mounted:true,...row,position:shifted?[99,99]:row.position,capsules:[{a:[...row.position,0],b:[...row.position,1],radius:.5}]}));
 const observation=room.beginStep();shifted=true;
 for(const id of order){const self=id==='a'?a:b;assert.equal(room.actor(id).steer({time:observation,seconds:.1,direction:self.direction,speed:1}).neighbours,1,'Room step must observe before any actor advances');assert.ok(room.actor(id).contacts(observation)[0].a[0]<3);}
 room.dispose();
}

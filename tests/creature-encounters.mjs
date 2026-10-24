// kaminos-test: node
import assert from 'node:assert/strict';
import {encounterSteering,createEncounterWorld} from '../experiments/creature-motion/encounters.mjs';
import * as encounter from '../experiments/creature-motion/encounters.mjs';
const a={id:'a',position:[0,0],direction:[1,0],speed:1,radius:.5},b={id:'b',position:[2,0],direction:[-1,0],speed:1,radius:.5};
const before=encounterSteering(a,[],{seconds:.1});assert.deepEqual(before.direction,[1,0]);assert.equal(before.distanceScale,1);
const turn=encounterSteering(a,[b],{seconds:.1});assert.ok(turn.direction[1]<0,'head-on walkers choose their own right-hand pass');assert.ok(turn.distanceScale<=1);
const control=encounterSteering(a,[b],{seconds:.1,avoidance:false});assert.deepEqual(control.direction,[1,0]);
const overlap=encounterSteering(a,[{...b,position:[.8,0]}],{seconds:.1,avoidance:false});assert.equal(overlap.touching,true);assert.equal(overlap.distanceScale,0,'contact still stops further forward penetration when anticipation is off');
const high={...b,position:[.8,0],capsules:[{a:[.8,3,0],b:[.8,4,0],radius:.2}]},low={...a,capsules:[{a:[0,0,0],b:[0,1,0],radius:.2}]};assert.equal(encounterSteering(low,[high],{seconds:.1,avoidance:false}).touching,false,'overlapping planning discs are not physical contact between separated bodies');
const softA={...a,capsules:[{a:[0,0,0],b:[0,1,0],radius:1}],nodes:[[.4,.5,0],[-.4,.5,0]]},softB={...b,position:[1.5,0],capsules:[{a:[1.5,0,0],b:[1.5,1,0],radius:1}],nodes:[[1.1,.5,0],[1.9,.5,0]]};
assert.equal(encounterSteering(softA,[softB],{seconds:.1,avoidance:false}).touching,false,'An enclosing proxy overlap must not brake before any material contact node reaches the other collider');
const pressed={...softB,position:[1.2,0],capsules:[{a:[1.2,0,0],b:[1.2,1,0],radius:1}],nodes:[[.8,.5,0],[1.6,.5,0]]};
assert.equal(encounterSteering(softA,[pressed],{seconds:.1,avoidance:false}).touching,true,'Contact braking must agree with the GPU node/capsule penetration law');
assert.equal(encounterSteering(pressed,[softA],{seconds:.1,avoidance:false}).touching,true,'Either actor sees the same material engagement');
const world=createEncounterWorld();let x=0;const stop=world.actor('a').register(()=>({mounted:true,...a,position:[x,0],capsules:[]}));world.actor('b').register(()=>({mounted:true,...b,capsules:[]}));world.actor('a').steer({time:1,seconds:.1,direction:[1,0],speed:1});x=99;assert.equal(world.actor('b').steer({time:1,seconds:.1,direction:[-1,0],speed:1}).neighbours,1,'one frame uses one snapshot');stop();assert.equal(world.read().actors,1);world.dispose();assert.throws(()=>encounterSteering(a,[],{seconds:NaN}),/time/);
for(const order of [['a','b'],['b','a']]){
 const room=createEncounterWorld();let shifted=false;
 for(const row of [a,b])room.actor(row.id).register(()=>({mounted:true,...row,position:shifted?[99,99]:row.position,capsules:[{a:[...row.position,0],b:[...row.position,1],radius:.5}]}));
 const observation=room.beginStep();shifted=true;
 for(const id of order){const self=id==='a'?a:b;assert.equal(room.actor(id).steer({time:observation,seconds:.1,direction:self.direction,speed:1}).neighbours,1,'Room step must observe before any actor advances');assert.ok(room.actor(id).contacts(observation)[0].a[0]<3);}
 room.dispose();
}
assert.equal(typeof encounter.limitTorsoMotion,'function','Root turning needs swept contact admission');
const rod={id:'rod',position:[0,0],radius:.2,capsules:[{a:[-1,0,0],b:[1,0,0],radius:.1}]},obstacle={id:'obstacle',position:[0,.8],radius:.2,capsules:[{a:[0,0,.8],b:[0,0,.8],radius:.1}]};
const rotation={pivot:[0,0,0],translation:[0,0,0],angle:Math.PI};
const limited=encounter.limitTorsoMotion(rod,[obstacle],rotation);
assert.ok(limited.fraction>0&&limited.fraction<.5,'An endpoint-clear half-turn must stop before its intervening collision');
assert.equal(encounter.limitTorsoMotion(rod,[],rotation).fraction,1);
const crossing=encounter.limitTorsoMotion({...rod,capsules:[{a:[-2,0,0],b:[-2,0,0],radius:.1}]},[{...obstacle,capsules:[{a:[0,0,0],b:[0,0,0],radius:.1}]}],{pivot:[-2,0,0],translation:[4,0,0],angle:0});
assert.ok(crossing.fraction<.5,'A large step cannot tunnel through a body even when its final pose is clear');
const highObstacle={...obstacle,capsules:[{a:[0,3,.8],b:[0,3,.8],radius:.1}]};
assert.equal(encounter.limitTorsoMotion(rod,[highObstacle],rotation).fraction,1,'Swept admission is three-dimensional');
const near={...rod,capsules:[{a:[0,0,0],b:[0,0,0],radius:.2}]},touch={...obstacle,capsules:[{a:[.39,0,0],b:[.39,0,0],radius:.2}]};
assert.equal(encounter.limitTorsoMotion(near,[touch],{pivot:[0,0,0],translation:[-.5,0,0],angle:0}).fraction,1,'A compressed body can move out of contact');
assert.ok(encounter.limitTorsoMotion(near,[touch],{pivot:[0,0,0],translation:[.5,0,0],angle:0}).fraction<.1,'Compression allowance cannot license passing through');
const slider={id:'slider',position:[0,0],radius:.5,capsules:[{a:[0,0,-1],b:[0,0,1],radius:.2}],nodes:[[.2,0,0]]},rail={id:'rail',position:[.35,0],radius:.5,capsules:[{a:[.35,0,-5],b:[.35,0,5],radius:.2}],nodes:[[.15,0,0]]};
const slide=encounter.limitTorsoMotion(slider,[rail],{pivot:[0,0,0],translation:[0,0,.1],angle:0});
assert.equal(slide.fraction,1);assert.ok(slide.probes<20,'A constant-gap straight slide must use a swept segment, not inverse-tolerance steps');
const tilted=encounter.moveTorso({...rod,nodes:[[1,0,0]]},{...rotation,angle:Math.PI/2,axis:[0,0,1]});
assert.ok(Math.hypot(...tilted.nodes[0].map((v,i)=>v-[0,1,0][i]))<1e-12,'Torso motion must follow its supplied authored rotation axis');
for(const scale of [1e-6,.001,1,1000]){
 const scaled=body=>({...body,position:body.position.map(v=>v*scale),radius:body.radius*scale,nodes:body.nodes.map(p=>p.map(v=>v*scale)),capsules:body.capsules.map(c=>({a:c.a.map(v=>v*scale),b:c.b.map(v=>v*scale),radius:c.radius*scale}))});
 const point=scaled({id:'point',position:[-.5,0],radius:.5,nodes:[[-.4,0,0]],capsules:[{a:[-.5,0,-.5],b:[-.5,0,.5],radius:.1}]}),bar=scaled({id:'bar',position:[0,0],radius:.5,nodes:[[-.1,0,0]],capsules:[{a:[0,0,-.5],b:[0,0,.5],radius:.1}]});
 const result=encounter.limitTorsoMotion(point,[bar],{pivot:[-.5*scale,0,0],translation:[scale,0,0],angle:0});
 assert.ok(result.fraction>.33&&result.fraction<.35,'An endpoint-clear material node must not pass through its stationary capsule at any tested scale');
 const chord={a:[-.5*scale,0,0],b:[.5*scale,0,0],radius:0};assert.ok(Math.abs(encounter.capsuleGap(chord,bar.capsules[0])+.1*scale)<scale*1e-12,'Perpendicular segment distance must preserve scale');
}
const shared=createEncounterWorld({avoidance:false}),sphere=(id,x)=>({id,mounted:true,position:[x,0],direction:[1,0],speed:1,radius:.5,capsules:[{a:[x,0,0],b:[x,0,0],radius:.5}]});
const yieldingA={...softA,movementCores:[{a:[0,.5,0],b:[0,.5,0],radius:.2}]},yieldingB={...pressed,movementCores:[{a:[1.2,.5,0],b:[1.2,.5,0],radius:.2}]};
assert.equal(encounterSteering(yieldingA,[yieldingB],{seconds:.1,avoidance:false}).distanceScale,1,'The yielding shell must be allowed to engage without becoming a rigid locomotion wall');
const long={...rod,movementCores:[{a:[-1.5,0,0],b:[-1.5,0,0],radius:.25},{a:[1.5,0,0],b:[1.5,0,0],radius:.25}]},noseObstacle={...obstacle,movementCores:[{a:[.62,0,2.12],b:[.62,0,2.12],radius:.2}]};
assert.ok(encounter.limitTorsoMotion(long,[noseObstacle],{pivot:[-1.5,0,0],translation:[0,0,0],angle:Math.PI/2}).fraction<.5,'The long front must not swing through another body about its rear pivot');
const gaitBefore={...rod,movementCores:[{a:[-1,0,0],b:[-1,0,0],radius:.2}]},gaitAfter={...rod,movementCores:[{a:[1,0,0],b:[1,0,0],radius:.2}]},gaitObstacle={...obstacle,movementCores:[{a:[0,0,0],b:[0,0,0],radius:.2}]};
assert.ok(encounter.limitTorsoMotion(gaitBefore,[gaitObstacle],{pivot:[0,0,0],translation:[0,0,0],angle:0},gaitAfter).fraction<.5,'The proposed gait pose must be checked even with no path-root motion');
const left=sphere('left',0),rightBody=sphere('right',2);shared.actor('left').register(()=>left);shared.actor('right').register(()=>rightBody);const token=shared.beginStep();
const firstMove={pivot:[0,0,0],translation:[.7,0,0],angle:0};assert.equal(shared.actor('left').limit({time:token,body:left,motion:firstMove}).fraction,1);shared.actor('left').commit(token,encounter.moveTorso(left,firstMove));
assert.ok(shared.actor('right').limit({time:token,body:rightBody,motion:{pivot:[2,0,0],translation:[-.7,0,0],angle:0}}).fraction<1,'Two callbacks must not spend the same separation gap independently');shared.dispose();

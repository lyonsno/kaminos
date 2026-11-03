// kaminos-test: node
import assert from 'node:assert/strict';
import workshop from '../experiments/link-workshop.experiment.mjs';
import furnace from '../experiments/furnace-door.experiment.mjs';
const calls=[],runtime={read:()=>({}),operations:{frame:v=>calls.push(['frame',v]),mode:v=>calls.push(['mode',v]),importBodies:async v=>calls.push(['bodies',v])}};
const service={add:async recipe=>{calls.push(['add',recipe]);return runtime;}};
const host={scene:{objects:()=>[]},controls:{document:{defaultView:{kaminosMechanisms:service}}}};
await furnace.create({host,inputs:{}});
assert.ok(calls.some(([op,v])=>op==='add'&&v.bodyGeometry?.bodies.length>0),'Native persistent mechanism receives constructed furnace bodies');
assert.ok(calls.some(([op,v])=>op==='mode'&&v.value==='B'),'Native persistent mechanism honors authored initial pose');
assert.ok(calls.some(([op,v])=>op==='frame'&&v?.view?.position),'Authored viewing angle reaches native frame operation');
calls.length=0;
await workshop.create({host,inputs:{}});
assert.equal(calls.filter(([op])=>op==='add').length,1);
assert.equal(calls.filter(([op])=>op==='bodies').length,0,'An ordinary new mechanism does not import unrelated geometry');
console.log('Persistent mechanism experiment composition passed');

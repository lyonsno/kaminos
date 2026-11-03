// kaminos-test: node
import assert from 'node:assert/strict';
let implementation={};try{implementation=await import('../experiments/creature-motion/stimulus-sequence.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof implementation.createStimulusSequence,'function','The courtyard needs a simulation-time event schedule');
const {createStimulusSequence}=implementation;
const program={duration:6,events:[{at:0,source:'lamp',patch:{visible:false}},{at:2,source:'lamp',patch:{visible:true}},{at:4,source:'lamp',patch:{visible:false}}]};
const run=parts=>{const s=createStimulusSequence(program),rows=[];for(const dt of parts)rows.push(...s.advance(dt));return {s,rows};};
const one=run([13]),many=run(Array(130).fill(.1));
const events=rows=>rows.flatMap(x=>x.events.map(e=>[e.cycle,e.at,e.source,e.patch.visible]));
assert.deepEqual(events(one.rows),events(many.rows),'Frame partition cannot drop/duplicate events, including loop boundaries');
assert.equal(one.s.read().time,13);assert.ok(Math.abs(many.s.read().time-13)<1e-10);
assert.equal(one.rows.reduce((n,x)=>n+x.seconds,0),13,'Every simulation second is offered to the consumer');
const before=one.s.read();for(const seconds of [-1,NaN,Infinity])assert.throws(()=>one.s.advance(seconds));assert.deepEqual(one.s.read(),before);
assert.equal(events(one.s.repeat()).length,1,'Repeat applies the cycle-zero baseline without changing a creature');assert.equal(one.s.read().time,0);
assert.throws(()=>createStimulusSequence({...program,events:[{at:6,source:'x',patch:{}}]}),/duration/);
assert.throws(()=>createStimulusSequence({...program,events:[{at:1,source:'x',patch:{}},{at:0,source:'x',patch:{}}]}),/order/);
console.log('Stimulus schedule preserves every crossed event and simulation second, loops deterministically, and validates before mutation');

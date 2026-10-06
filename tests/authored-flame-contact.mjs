import test from 'node:test';import assert from 'node:assert/strict';
import {authoredFlameContactGeometry,pointTouchesAuthoredFlame} from '../authored-flame-contact.mjs';
const ring={family:'ring',coordinateSpace:'volume-local',origin:[.3,-.76,0],axis:[0,1,0],radius:.04,extent:.7,sourceDepth:.006,sourceLaw:'shallow-primary',strength:1};
test('ring contact follows emitting annulus, rejects hole and outside',()=>{
 const g=authoredFlameContactGeometry(ring);assert.equal(pointTouchesAuthoredFlame([.3,-.76,0],g),false);assert.equal(pointTouchesAuthoredFlame([1,-.76,0],g),true);assert.equal(pointTouchesAuthoredFlame([1.2,-.76,0],g),false);assert.equal(pointTouchesAuthoredFlame([1,-.7,0],g),false);
});
test('moved, scaled and rotated emitting geometry follows actual descriptor',()=>{
 const g=authoredFlameContactGeometry({...ring,origin:[0,0,0],axis:[1,0,0],extent:.4,radius:.02});assert.equal(pointTouchesAuthoredFlame([0,.4,0],g),true);assert.equal(pointTouchesAuthoredFlame([.3,.4,0],g),false);assert.equal(pointTouchesAuthoredFlame([0,.7,0],g),false);
});
test('unsupported or disabled analytic sources do not borrow legacy sphere',()=>{
 assert.equal(pointTouchesAuthoredFlame([0,0,0],authoredFlameContactGeometry({...ring,family:'nozzle'})),false);assert.equal(pointTouchesAuthoredFlame([1,-.76,0],authoredFlameContactGeometry({...ring,strength:0})),false);
});

import {liquidFireContactConsumerParams,createLiquidFireContactConsumerShaderWGSL} from '../liquid-fire-contact-consumer.mjs';
test('actual contact uniforms retain ring units, orientation and mode',()=>{const b=liquidFireContactConsumerParams({allocationGeneration:1,epoch:1,sourceFrameHash:7,sourceQuenchCenter:[.65,.12,.5],sourceQuenchRadius:.02,sourceAxis:[1,0,0],sourceContactMode:1,sourceRingRadius:.35,sourceHalfDepth:.0015,sourceShallow:true});const f=new Float32Array(b);assert.equal(b.byteLength,112);assert.deepEqual([...f.slice(20,24)],[1,0,0,1]);assert.ok(Math.abs(f[24]-.35)<1e-6);assert.equal(f[26],1);assert.match(createLiquidFireContactConsumerShaderWGSL(16),/if \(touchesSource\)/);});
test('deep shallow ring requires torus and inlet-depth intersection',()=>{
 const g=authoredFlameContactGeometry({...ring,sourceDepth:.36});assert.equal(pointTouchesAuthoredFlame([1,-.66,0],g),false);assert.equal(pointTouchesAuthoredFlame([1,-.74,0],g),true);
});
test('inflow boundary ring has no authored-volume ring contact claim',()=>{
 assert.equal(pointTouchesAuthoredFlame([1,-.76,0],authoredFlameContactGeometry({...ring,sourceLaw:'inflow-boundary'})),false);
});

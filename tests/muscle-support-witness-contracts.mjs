// kaminos-test: node
import assert from 'node:assert/strict';
import {validateSupportSnapshot,validateCycle} from '../muscle-support-assay-witness.mjs';
const modes=['transport-field','bone-blend','field-only'];
const metrics=modes.map(mode=>({mode,steps:1,fieldErrorMax:0,fieldErrorMean:0,edgeRatioMin:1,edgeRatioMax:1,displacementRms:0,displacementMax:0}));
const fixture={schema:'kaminos-muscle-support-assay-v1',status:'loaded',effectiveRoute:'dedicated-kaminos-procedural-assay',rendererBackend:'WebGPUBackend',registeredObjects:modes.map((mode,i)=>({id:String(i),mode})),selectedBone:'fixture-hinge-bone',metrics,fixture:{vertices:1},sampleCount:1,samples:[{metrics,positions:[[0,0,0],[0,0,0],[0,0,0]]}]};
assert.equal(validateSupportSnapshot(fixture),fixture);
assert.throws(()=>validateSupportSnapshot({...fixture,samples:[]}), /sample/);
for(const replacement of [{status:'loading'},{rendererBackend:'WebGLBackend'},{effectiveRoute:'cached-demo'},{registeredObjects:[{id:'a'},{id:'a'},{id:'b'}]},{selectedBone:'other'},{samples:[{positions:[[0,0,0],[0,0,0]]}]},{samples:[{positions:[[NaN,0,0],[0,0,0],[0,0,0]]}]}])assert.throws(()=>validateSupportSnapshot({...fixture,...replacement}));
console.log('support witness rejects unloaded, fallback, wrong route/bone, duplicate, partial, non-finite evidence');
assert.throws(()=>validateSupportSnapshot({...fixture,metrics:[{},{},{}]}));
assert.throws(()=>validateSupportSnapshot({...fixture,registeredObjects:modes.map((_,i)=>({id:String(i),mode:'field-only'}))}));
assert.throws(()=>validateSupportSnapshot({...fixture,sampleCount:2}));
const cycle={events:[{type:'cycle-start',cycleId:'new',sampleIndex:0,inputSteps:2},{type:'cycle-end',cycleId:'new',startSampleIndex:0,endSampleIndex:2}],samples:[{cycleId:'new',pose:{quaternion:[0,0,.4,1]}},{cycleId:'new',pose:{quaternion:[0,0,0,1]}}]};
validateCycle(cycle,'new');
assert.throws(()=>validateCycle(cycle,'old'));
assert.throws(()=>validateCycle({...cycle,samples:cycle.samples.slice(0,1)},'new'));
assert.throws(()=>validateCycle({...cycle,samples:cycle.samples.map(sample=>({...sample,cycleId:'old'}))},'new'));

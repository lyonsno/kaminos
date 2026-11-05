// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import * as native from '../volume-optical-native.mjs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
test('obsolete algorithms migrate explicitly and never select their old GPU variants',()=>{
 for(const [retired,successor] of [['current','numerical'],['fixed-dense','fixed']]){const c=native.opticalSteppingConfig({mode:retired});assert.equal(c.mode,successor);assert.equal(c.retiredMode,retired);assert.notEqual(c.value,0);assert.notEqual(c.value,3);}
 assert.doesNotMatch(core,/fn adaptiveRayStepScale\(/);assert.doesNotMatch(core,/fn raymarchInterest\(/);
});
test('retained modes are independently named and skip controls are available on each',()=>{
 assert.equal(typeof native.RAYMARCH_MODES,'object');assert.deepEqual(Object.keys(native.RAYMARCH_MODES),['numerical','fixed','budgeted','joins','history']);
 assert.equal(new Set(Object.values(native.RAYMARCH_MODES).map(m=>m.label)).size,5);
});
test('vacuum certification requires one complete supported interval, including zero-valued quadrature endpoints',async()=>{
 const {certifyEmptyInterval}=await import('../volume-empty-space.mjs');
 const base={start:[.1,.2,.3],end:[.8,.7,.6],sample:[.5,.5,.5],lo:[0,0,0],hi:[1,1,1],support:0,threshold:0,strength:1};
 assert.equal(certifyEmptyInterval(base),true);
 for(const patch of [{strength:0},{support:1e-10},{end:[1.001,.7,.6]},{sample:[-1,0,0]},{support:NaN},{threshold:Infinity},{lo:[1,0,0]}])assert.equal(certifyEmptyInterval({...base,...patch}),false);
 assert.equal(certifyEmptyInterval({...base,support:.00015,threshold:.0002}),true);
 assert.equal(certifyEmptyInterval({...base,support:.00015,threshold:.0002,strength:.5}),false);
});
test('active integrators consume skipped spans without spending evaluations or dropping interval coverage',()=>{
 assert.match(core,/var allocatedSamples\s*=\s*0u/);
 assert.match(core,/guidedNext\(&guidedRay,ro,rd,allocatedSamples/);
 assert.match(core,/if\(guided && allocatedSamples>=expensiveSampleBudget\)/);
 assert.match(core,/emptyOpticalInterval\(/);
 assert.match(native.OPTICAL_STEPPING_WGSL,/fn opticalStepSkipEmpty\(/);
 assert.match(core,/opticalStepSkipEmpty\(&opticalStep\)/);
 assert.match(core,/allocatedSamples\+\+;\s*continue;/);
});

test('empty numerical panel follows the zero-transfer acceptance progression, including retained endpoint',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=native.OPTICAL_STEPPING_WGSL.match(/fn opticalStepSkipEmpty\([^]*?\n\}/)[0];
 const body=source.slice(source.indexOf('{')+1,-1).replaceAll('(*s)','s').replaceAll('1u','1').replaceAll('0u','0').replace(/let /g,'const ').replace('vec4<f32>(0)','[0,0,0,0]');
 const advance=runInNewContext('(s)=>{'+body+'}',{min:Math.min,select:(a,b,c)=>c?b:a,opticalStepResetPositions:s=>{s.positions=Array.from({length:5},(_,i)=>s.width*i*.25);}});
 for(const phased of [0,1])for(const width of [.125,.5,1]){
  const state={cursor:2,end:4,width,maximum:1,minimum:.125,phased,mask:0,probes:[],transfer:[.3,.2,.1,.8]};advance(state);
  assert.equal(state.cursor,2+width);assert.equal(state.width,Math.min(2-width,phased?1:Math.min(1,width*2)));assert.deepEqual(state.transfer,[.3,.2,.1,.8]);assert.equal(state.mask,1);assert.deepEqual(Array.from(state.probes[0]),[0,0,0,0]);
 }
});

test('uniform fallback advance retains its declared Fine interval end',()=>{
 const beforeAdvance=core.slice(core.indexOf('    let smoke = select(legacySmoke'),core.indexOf('    let rayStepOpacity'));
 assert.match(beforeAdvance,/let fineSegmentEnd\s*=\s*select\(endT, min\(endT, nearHit.y\), worldActive\)/);
});

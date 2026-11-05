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

test('zero panels preserve jittered supported probes and transfer independently of executed work',async()=>{
 const {runInNewContext}=await import('node:vm');
 const dimension=core.match(/opticalStepPositionJittered\(&opticalStep, rayNoiseSample\(in.pos.xy, u.occupancy_controls.y, ([^)]+)\)\)/)[1].replace(/(\d+)u/g,'$1');
 const virtual=core.match(/quadratureProbes\s*\+=\s*([^;]+);/)?.[1]?.replace(/(\d+)u/g,'$1').replaceAll('opticalStep.mask','mask')??'0';
 const dim=(logical,executed)=>runInNewContext(dimension,{quadratureProbes:logical,rayMaterialSamples:executed});
 const noise=d=>{const x=Math.floor((Math.fround(d*.754877666)%1)*128),y=Math.floor((Math.fround(d*.569840296)%1)*128);return ((x*17+y*31)%256+.5)/256;};
 const compose=(a,b)=>[a[0]+a[1]*b[0],a[1]*b[1]];
 for(const mode of ['fixed','numerical'])for(const mask of [0,1]){
  const missing=mask===0?5:4;const before=20;
  const skipped=runInNewContext(virtual,{mask,select:(a,b,c)=>c?b:a});
  let offLogical=before+missing,onLogical=before+skipped,offExecuted=before+missing,onExecuted=before;
  const positions=(logical,executed)=>[0,.25+.5*noise(dim(logical,executed)),1,1.25+.5*noise(dim(logical+2,executed+2)),2];
  const off=positions(offLogical,offExecuted),on=positions(onLogical,onExecuted);
  assert.deepEqual(on,off,`${mode}: removing a zero panel's ${missing} evaluations cannot resample supported material`);
  const transfer=points=>points.slice(1).reduce((out,t,i)=>{const l=points[i],h=t-l;const emission=((1+l*l)+(1+t*t))*.5,sigma=((.1+l*l*l)+(.1+t*t*t))*.5;return compose(out,[emission*(1-Math.exp(-sigma*h))/sigma,Math.exp(-sigma*h)]);},[0,1]);
  assert.deepEqual(transfer(on),transfer(off),mode+' preserves the supported optical integral');assert.ok(onExecuted<offExecuted);
 }
});

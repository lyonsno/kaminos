// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import * as native from '../volume-optical-native.mjs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
test('obsolete algorithms migrate explicitly and never select their old GPU variants',()=>{
 for(const [retired,successor] of [['current','numerical'],['fixed-dense','fixed']]){const c=native.opticalSteppingConfig({mode:retired});assert.equal(c.mode,successor);assert.equal(c.retiredMode,retired);assert.notEqual(c.value,0);assert.notEqual(c.value,3);}
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

test('empty numerical panels advance without changing transfer and joins restore the regional width',async()=>{
 const {evalWgslBatch,withKaminosGpu}=await import('../tools/shader-herder.mjs');
 const preamble=native.OPTICAL_STEPPING_WGSL;
 const body=`var s=opticalStepInit(0.0,4.0,1.0);s.cursor=2.0;s.width=arg0;s.minimum=.125;s.maximum=1.0;s.phased=u32(arg1);s.transfer=vec4<f32>(.3,.2,.1,.8);opticalStepSkipEmpty(&s);return vec4<f32>(s.cursor,s.width,s.transfer.w,f32(s.mask));`;
 const inputs=[0,1].flatMap(phased=>[.125,.5,1].map(width=>[width,phased]));
 const expected=inputs.map(([width,phased])=>[2+width,Math.min(2-width,phased?1:Math.min(1,width*2)),Math.fround(.8),1]);
 const joinBody=`var s=opticalStepInit(0.0,8.0,1.0);s.width=.25;opticalStepConstrain(&s,.125,arg0,8.0);return s.width;`;
 await withKaminosGpu(async ctx=>{
  assert.deepEqual(await evalWgslBatch(ctx,{preamble,argTypes:['f32','f32'],returnType:'vec4<f32>',body,inputs}),expected);
  assert.deepEqual(await evalWgslBatch(ctx,{preamble,argTypes:['f32'],returnType:'f32',body:joinBody,inputs:[[2],[.5]]}),[2,.5]);
 },{wgslSources:[{label:'empty-panel-and-region-join',entryPoint:'main',code:preamble+'\n@compute @workgroup_size(1) fn main(){var s=opticalStepInit(0.0,4.0,1.0);opticalStepSkipEmpty(&s);opticalStepConstrain(&s,.125,2.0,4.0);}'}]});
});

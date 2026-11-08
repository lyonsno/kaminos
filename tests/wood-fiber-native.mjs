// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {WOOD_FIBER_WGSL} from '../wood-fiber-wgsl.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';

test('finished wood fiber cone follows axis and rejects back lighting', async()=>{
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{
   preamble:WOOD_FIBER_WGSL,argTypes:['f32','f32','f32'],returnType:'f32',
   body:`let v=normalize(vec3<f32>(0.5,0.0,1.0));
    let l=normalize(vec3<f32>(arg0,0.0,arg1));
    let axis=normalize(vec3<f32>(1.0,0.0,arg2));
    return woodFiberLobe(vec3<f32>(0.0,0.0,1.0),axis,v,l,0.1745,1.5);`,
   inputs:[[-.5,1,0],[.5,1,0],[-.5,-1,0],[-.5,1,.8]],
  });
  assert.ok(result[0]>.04 && result[0]<.09,'opposed longitudinal directions meet the fiber cone');
  assert.ok(result[0]>result[1]*10,'same-side directions leave the cone');
  assert.equal(result[2],0,'back light supplies no fiber irradiance');
  assert.ok(result[0]>result[3]*10,'fiber inclination changes the response');
  for(const v of result) assert.ok(Number.isFinite(v)&&v>=0);
  // A valid compiled shader with the fiber contribution disconnected must
  // fail the same optical expectation, rather than pass on compilation alone.
  const disconnected=await evalWgslBatch(ctx,{
   preamble:WOOD_FIBER_WGSL,argTypes:['f32'],returnType:'f32',
   body:`return arg0*woodFiberLobe(vec3<f32>(0,0,1),vec3<f32>(1,0,0),
    normalize(vec3<f32>(.5,0,1)),normalize(vec3<f32>(-.5,0,1)),.1745,1.5);`,inputs:[[0]],
  });
  assert.throws(()=>assert.ok(disconnected[0]>.04),'a disconnected contribution cannot close the optical check');
  const edge=await evalWgslBatch(ctx,{
   preamble:WOOD_FIBER_WGSL,argTypes:['f32'],returnType:'f32',
   body:`return woodFiberLobe(vec3<f32>(0,0,1),vec3<f32>(1,0,0),
     vec3<f32>(1,0,0),vec3<f32>(0,0,1),arg0,1.0);`,inputs:[[0],[.1745]],
  });
  for(const v of edge) assert.ok(Number.isFinite(v)&&v>=0);
 });
});

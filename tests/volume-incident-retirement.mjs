// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as material from '../volume-emissive-transport.mjs';
import {VOLUME_WGSL} from '../volume-core.js';
import {SCENE_POINT_SMOKE_WGSL} from '../scene-point-light.mjs';
import {COMPOSED_SMOKE_WGSL} from '../scene-smoke-reconstruction.mjs';
import {evalWgslBatch,extractWgslFunction,withKaminosGpu} from '../tools/shader-herder.mjs';

test('the retired six-direction GPU producer is no longer an available implementation',()=>{
 assert.equal(material.createEmissiveLightField,undefined);
});

test('without an attached incident-light producer the production camera receives zero incident light',async()=>{
 // The legacy implementation reads this nonzero fixture. Keeping it here
 // exposes an accidental return to a hidden fallback, rather than testing
 // only an already empty input. The production function is unchanged in the test.
 const incident=extractWgslFunction(material.EMISSIVE_TRANSPORT_WGSL,'incidentAt');
 const preamble=`const LIGHT_GRID:u32=2u;
 var<private> emissiveIncident:array<vec4<f32>,8>;
 fn lightIndex(c:vec3<u32>)->u32{return c.x+2u*(c.y+2u*c.z);}
 ${incident}`;
 const options={preamble,argTypes:['f32'],returnType:'vec3<f32>',body:`for(var i=0u;i<8u;i++){emissiveIncident[i]=vec4<f32>(1,2,3,1);}return incidentAt(vec3<f32>(arg0));`,inputs:[[-1],[0],[1]]};
 await withKaminosGpu(async ctx=>{
  assert.deepEqual(await evalWgslBatch(ctx,options),[[0,0,0],[0,0,0],[0,0,0]]);
  // Valid WGSL negative control: an accidental hidden light must fail numerically.
  const polluted={...options,preamble:preamble.replace(incident,'fn incidentAt(p:vec3<f32>)->vec3<f32>{return vec3<f32>(1,2,3);}')};
  assert.notDeepEqual(await evalWgslBatch(ctx,polluted),[[0,0,0],[0,0,0],[0,0,0]]);
 },{wgslSources:[{label:'unattached-production-incident-light',code:preamble+'\n@compute @workgroup_size(1) fn main(){_=incidentAt(vec3<f32>(0));}',entryPoint:'main'}]});
});


test('production volume shaders compile with unattached, point and distributed incident lighting',async()=>{
 const variants=[
  ['unattached',VOLUME_WGSL],
  ['point',VOLUME_WGSL.replaceAll('medium.scattering * incidentAt(p)','medium.scattering * (incidentAt(p) + scenePointIncident(p))')+SCENE_POINT_SMOKE_WGSL],
  ['distributed',VOLUME_WGSL.replaceAll('medium.scattering * incidentAt(p)','medium.scattering * distributedMeanIncident(p)')
   .replace('fn opticalIncidentMaskFlags(p: vec3<f32>) -> vec2<f32> { return vec2<f32>(0.0); }','fn opticalIncidentMaskFlags(p: vec3<f32>) -> vec2<f32> { return distributedLastMaskFlags; }')+COMPOSED_SMOKE_WGSL],
 ];
 await withKaminosGpu(async ctx=>{
  for(const [label,code]of variants)await ctx.compileShaderModule({label:'production-volume-'+label,code});
 },{wgslSources:variants.map(([label,code])=>({label,code,entryPoint:'cs'}))});
});

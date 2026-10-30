// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldSmoke,worldSmokePlan,intermediateSmokePlan,intermediateFlowPlan} from '../volume-world-smoke.mjs';

// Exercise the actual uniform producer, including changes to a resident field.
function producer(plan,anchor={translate:[0,0,0],scale:1},borrow=false){
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8};
 globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
 globalThis.GPUShaderStage={COMPUTE:1};
 const resource=d=>({...d,createView(){return this;},destroy(){}});let uniform;
 const device={limits:{maxTextureDimension3D:2048,maxStorageBufferBindingSize:1e9,maxBufferSize:1e9},createBuffer:resource,createTexture:resource,createShaderModule:x=>x,createBindGroupLayout:x=>x,createPipelineLayout:x=>x,createComputePipeline:x=>x,createBindGroup:x=>x,queue:{writeBuffer(b,o,data){if(b.label==='world smoke uniforms')uniform=Array.from(data);}}};
 const field=createWorldSmoke(device,plan,anchor,borrow?{borrowMaterial:{buffers:[{},{}],optical:resource({})}}:{});
 const encoder={beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}})};
 return (fineDims,transform=anchor)=>{field.encode(encoder,{fineBuffer:{},reactionTexture:resource({}),fineDims,transform,time:{dtScale:1,backtraceScale:1},iterations:0});return {lo:uniform.slice(72,75),hi:uniform.slice(76,79)};};
}
const inside=(b,c,a)=>c.every((n,k)=>2*n+1+(k===a)>=b.lo[k]&&2*n+1+(k===a)<=b.hi[k]);

test('physical outlet faces are owned independently of the inset material donor',()=>{
 const far=worldSmokePlan({flow:16,material:32,extent:6});
 const middle=intermediateSmokePlan(far,{flow:48,material:48,pressure:12,extent:4});
 const encode=producer(middle),b=encode([48,96,48]);
 assert.deepEqual(b,{lo:[36,36,36],hi:[60,84,60]},'physical Fine bounds in doubled receiver-cell coordinates');
 assert.ok(inside(b,[23,41,23],1),'the nominal y=3 outlet must inherit Fine velocity');
 assert.ok(!inside(b,[23,42,23],1),'the next exterior face must remain receiver-owned');
 for(const width of [16,32,64,96,128])assert.deepEqual(encode([width,width*2,width]),b,'material resolution cannot shrink momentum coverage');
});

test('all component face lattices respect transformed bounds, including real subcell gaps',()=>{
 const plan=worldSmokePlan({flow:16,material:8,extent:2});
 const anchor={translate:[10,-4,20],scale:2},encode=producer(plan,anchor);
 // Field-local offset(.25,.5,-.25), scale .5; bounds x[-.25,.75], y[0,2], z[-.75,.25].
 const b=encode([16,32,16],{translate:[10.5,-3,19.5],scale:1});
 assert.deepEqual(b,{lo:[14,16,10],hi:[22,32,18]});
 for(let a=0;a<3;a++)for(let z=0;z<16;z++)for(let y=0;y<32;y++)for(let x=0;x<16;x++){
  const c=[x,y,z],p=c.map((n,k)=>-2+(n+.5+(k===a?.5:0))*.25);
  const expected=p.every((v,k)=>v>=[-.25,0,-.75][k]&&v<=[.75,2,.25][k]);
  assert.equal(inside(b,c,a),expected,`${c}/${a}`);
 }
 const shifted=encode([16,32,16],{translate:[10+2e-9,-4,20],scale:2});
 assert.equal(shifted.lo[0],9,'a real displacement is not rounded back onto the lower face');
 assert.equal(shifted.hi[0],24);
 assert.deepEqual(encode([16,32,16]),{lo:[8,8,8],hi:[24,40,24]},'resident transform updates recompute coverage');
});

test('aligned rational pitches and borrowed material have the same physical face rule',()=>{
 for(const n of [12,24,48,96]){
  const p=worldSmokePlan({flow:n,material:16,extent:4});
  const b=producer(p)([48,96,48]);
  assert.deepEqual(b,{lo:[3*n/4,3*n/4,3*n/4],hi:[5*n/4,7*n/4,5*n/4]});
 }
 const far=worldSmokePlan({flow:16,material:32,extent:4});
 const p=intermediateFlowPlan(far,[32,64,32]);
 assert.deepEqual(producer(p,undefined,true)([32,64,32]),{lo:[8,8,8],hi:[40,72,40]});
});

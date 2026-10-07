import assert from 'node:assert/strict';
import * as coordinates from '../occupancy-coordinates.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../../webgpu-inference-kit/src/core.js';
import {createHash} from 'node:crypto';
import sourceFixture from './fixtures/slat-regrid-source.json' with {type:'json'};
assert.equal(typeof coordinates.createTrellisSLatRegridAdapter,'function',
  'Low-resolution decoded support must reach the high-resolution flow without CPU coordinate requantization.');
const {createTrellisSLatRegridAdapter:create,buildSLatRegridPlan:build}=coordinates;
const cases=sourceFixture.cases;
assert.equal(sourceFixture.source.commit,'34a7a570d5d6d8b9c99bbddb1d52bd414600d5c6');
assert.equal(sourceFixture.execution.route,'unmodified-source-function-AST-with-NumPy');
const hash=values=>createHash('sha256').update(Buffer.from(Int32Array.from(values).buffer)).digest('hex');
for(const test of cases){assert.equal(hash(test.input),test.inputSha256);assert.equal(hash(test.expected),test.expectedSha256);}
function harness(test){
  const allocations=[],runs=[],reads=[];let failStage,badCount;
  const runtime={device:{limits:{maxStorageBufferBindingSize:134217728,maxComputeWorkgroupsPerDimension:65535},
    queue:{async onSubmittedWorkDone(){}}},createTensor(spec){
      const Type=spec.dtype==='f32'?Float32Array:spec.dtype==='i32'?Int32Array:Uint32Array,
        t={...spec,byteLength:spec.shape.reduce((a,b)=>a*b,4),data:new Type(spec.shape.reduce((a,b)=>a*b,1)),
          buffer:{destroy(){t.destroyed=true;}}};allocations.push(t);return t;},
    uploadTensor(){assert.fail('Regrid borrows coordinates and has no CPU data/weights to upload.');},defineComputeKernel(k){return k;},
    async runKernel(k,o){runs.push({k,o});if(o.stage===failStage)throw Error('injected regrid failure');
      const a=k.bindings.map(b=>b.resource),grid=Math.floor(test.meshResolution/16);
      if(o.stage==='slat-regrid-clear')a[0].data.fill(0);
      if(o.stage==='slat-regrid-mark'){
        const map=c=>{const x=(c+0.5)/test.sourceResolution*(grid-1),lo=Math.floor(x),
          rounded=x-lo===0.5?(lo%2?lo+1:lo):Math.round(x);return Math.max(0,Math.min(grid-1,rounded));};
        for(let row=0;row<a[0].shape[0];row++){
          const [z,y,x]=Array.from(a[0].data.subarray(row*3,row*3+3),map);a[1].data[(z*grid+y)*grid+x]=1;
        }
      }
      if(o.stage==='decoder-child-counts')for(let row=0;row<a[1].data.length;row++)
        a[1].data[row]=Array.from(a[0].data.subarray(row*8,row*8+8)).filter(v=>v>0).length;
      if(o.stage==='decoder-child-scan')for(let base=0;base<a[0].data.length;base+=256){let sum=0;
        for(let i=base;i<Math.min(base+256,a[0].data.length);i++){a[1].data[i]=sum;sum+=a[0].data[i];}a[2].data[base/256]=sum;}
      if(o.stage==='decoder-child-scan-add')for(let i=0;i<a[1].data.length;i++)a[1].data[i]+=a[0].data[Math.floor(i/256)];
      if(o.stage==='slat-regrid-compact')for(let i=0;i<grid**3;i++)if(a[0].data[i]>0){
        let dest=a[1].data[Math.floor(i/8)];for(let j=Math.floor(i/8)*8;j<i;j++)if(a[0].data[j]>0)dest++;
        a[2].data.set([Math.floor(i/(grid*grid)),Math.floor(i/grid)%grid,i%grid],dest*3);
      }
    },async readTensor(t){reads.push(t);assert.equal(t.dtype,'u32');assert.equal(t.byteLength,4);
      return badCount??t.data.slice();}};
  const input=runtime.createTensor({name:'decoder-coordinates',shape:[test.input.length/3,3],dtype:'i32',usage:U.storage});
  input.data=Int32Array.from(test.input);
  return {runtime,input,allocations,runs,reads,route:{runtime,routeId:'local-regrid-contract'},
    fail(stage){failStage=stage;},badMetadata(value){badCount=value;}};
}
for(const test of cases){
  const h=harness(test),config={tokenRows:test.input.length/3,sourceResolution:test.sourceResolution,meshResolution:test.meshResolution},
    p=build(config),a=create({route:h.route,...config,coordinateTensor:h.input}),invocation={id:'same-cascade-job'};
  assert.equal(p.coordinateOrder,'z-y-x-lexicographic');assert.equal(p.rounding,'source-F64-equivalent-ties-even');
  assert.equal(a.outputs.coordinates,undefined);
  const result=await a.run(invocation);assert.deepEqual(Array.from(result.coordinates.data),test.expected);
  assert.equal(result.metadataReadbackBytes,4);assert.equal(result.resolution,Math.floor(test.meshResolution/16));
  assert.ok(h.runs.every(v=>v.o.schedulerInvocation===invocation));assert.equal(h.reads.length,1);
  assert.match(h.runs.find(v=>v.o.stage==='slat-regrid-mark').k.code,/atomicStore/);
  assert.ok(h.runs.some(v=>v.o.stage==='decoder-child-scan'),'Reuse the production hierarchical scan instead of serial coordinate enumeration.');
  await assert.rejects(a.run(invocation),/completed|single/);a.dispose();assert.ok(!h.input.destroyed);
  assert.ok(h.allocations.filter(t=>t!==h.input).every(t=>t.destroyed));
}
for(const config of [{tokenRows:0,sourceResolution:512,meshResolution:1024},
  {tokenRows:5,sourceResolution:3,meshResolution:1024},{tokenRows:5,sourceResolution:512,meshResolution:0}])assert.throws(()=>build(config));
for(const metadata of [new Uint32Array([]),new Uint32Array([0]),new Uint32Array([262145])]){
  const h=harness(cases[0]);h.badMetadata(metadata);const a=create({route:h.route,tokenRows:5,sourceResolution:512,
    meshResolution:1024,coordinateTensor:h.input});await assert.rejects(a.run({}),/metadata|empty|capacity/);
  assert.equal(a.outputs.coordinates,undefined);await assert.rejects(a.run({}),/failed|poison/);a.dispose();
}
const h=harness(cases[0]),a=create({route:h.route,tokenRows:5,sourceResolution:512,meshResolution:1024,coordinateTensor:h.input});
h.fail('slat-regrid-mark');await assert.rejects(a.run({}),/injected/);assert.equal(a.outputs.coordinates,undefined);a.dispose();
console.log('Resident regrid follows source centered ties-even/clipping/lexicographic unique support, hierarchical scan and borrowed lifetime; fake runtime is not native conformance.');

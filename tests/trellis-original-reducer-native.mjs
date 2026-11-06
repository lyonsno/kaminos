// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createBrowserMeshPostprocess} from '../models/trellis2/mesh-cleanup.js';
import {NodeTrellisUVWorker} from '../models/trellis2/node-uv-worker.mjs';
import {CLOSEST_SURFACE_WGSL,DUAL_CONTOUR_WGSL} from '../models/trellis2/original-remesh-wgsl.js';
import {CUMESH_SIMPLIFY_WGSL} from '../models/trellis2/original-remesh-simplify-wgsl.js';
import {createCuMeshReducerGpu} from '../models/trellis2/original-remesh-simplify-gpu.js';
import {reducerTopology,compactReduction} from '../models/trellis2/original-remesh-simplify-topology.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/trellis-original-reducer-metal.json',import.meta.url)));
const edgeFixture=JSON.parse(readFileSync(new URL('./fixtures/trellis-original-reducer-edges-metal.json',import.meta.url)));
const close=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<3e-6,`component ${i}: ${x} != ${expected[i]}`));};
const wgslSources=['get_qem','edge_cost','propagate','select_edges','collapse'].map(entryPoint=>({code:CUMESH_SIMPLIFY_WGSL,entryPoint,label:'CuMesh '+entryPoint}));
test('original remesh uses native parallel CuMesh reduction on the observed asymmetric surface',async()=>{
 await withKaminosGpu(async({device})=>{
  const c=fixture.case,p=createBrowserMeshPostprocess({mode:'original-remesh',device,...c.settings,WorkerClass:NodeTrellisUVWorker});
  try{
   const out=await p({vertices:Float32Array.from(c.inputVertices.flat()),triangles:Uint32Array.from(c.inputTriangles.flat())});
   assert.deepEqual([...out.triangles],c.stages.reduced.faces.flat(),'complete observed native reduced topology');
   close([...out.vertices],c.stages.reduced.vertices.flat());
   assert.equal(out.metadata.postprocess.reducer.route,'CuMesh parallel QEM / WebGPU');
  }finally{p.dispose();}
 },{wgslSources:[...wgslSources,{label:'original closest surface',code:CLOSEST_SURFACE_WGSL,entryPoint:'closest_surface'},{label:'original dual contour',code:DUAL_CONTOUR_WGSL,entryPoint:'dual_contour'}]});
});

test('one production GPU step matches the complete observed Metal collapse and rejects lost selection',async()=>{
 await withKaminosGpu(async({device})=>{
  const c=edgeFixture.curvedCube,v=Float32Array.from(c.input.vertices.flat()),t=Uint32Array.from(c.input.faces.flat()),topology=reducerTopology(v,t);
  const expected=out=>{assert.deepEqual([...out.triangles],c.faces.flat());close([...out.vertices],c.vertices.flat());};
  const run=async device=>{
   const step=await createCuMeshReducerGpu({device});
   const out=await step(v,t,topology,{threshold:c.threshold,lambdaLength:c.lambdaEdge,lambdaSkinny:c.lambdaSkinny});
   return compactReduction(out.vertices,out.triangles,out.flags);
  };
  expected(await run(device));
  const faulty=new Proxy(device,{get(target,key){
   if(key==='createShaderModule')return descriptor=>target.createShaderModule({...descriptor,code:descriptor.code.replace('flags[p.V+p.F+ei]=1u;','flags[p.V+p.F+ei]=0u;')});
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  // The deliberately valid WGSL still executes all stages; a missing selected
  // flag yields the uncollapsed surface and cannot masquerade as conformance.
  const lastFault=await run(faulty);
  assert.throws(()=>expected(lastFault));
 },{wgslSources});
});

test('flat-cell collapse preserves disjoint neighborhoods and every kept row across device rounding',async()=>{
 await withKaminosGpu(async({device})=>{
  const c=fixture.singleStep,v=Float32Array.from(c.input.vertices.flat()),t=Uint32Array.from(c.input.faces.flat()),topology=reducerTopology(v,t),{V,F,E,edges}=topology;
  const step=await createCuMeshReducerGpu({device}),out=await step(v,t,topology,{threshold:c.threshold,lambdaLength:c.lambdaEdge,lambdaSkinny:c.lambdaSkinny});
  const wantV=v.slice(),wantT=t.slice(),keep=new Uint32Array(V+F).fill(1),touched=new Set();let selected=0;
  for(let e=0;e<E;e++){
   const chosen=out.flags[V+F+e];assert.ok(chosen===0||chosen===1);if(!chosen)continue;selected++;
   const a=edges[e*2],b=edges[e*2+1],neighbors=new Set();
   for(let f=0;f<F;f++){const ids=[t[f*3],t[f*3+1],t[f*3+2]];if(ids.includes(a)||ids.includes(b))neighbors.add(f);}
   for(const f of neighbors){assert.ok(!touched.has(f),'selected edges must not share a face neighborhood');touched.add(f);}
   const boundary=topology.offsets.boundary,w=topology.packed[boundary+a]&&!topology.packed[boundary+b]?1:!topology.packed[boundary+a]&&topology.packed[boundary+b]?0:.5;
   for(let k=0;k<3;k++)wantV[a*3+k]=v[a*3+k]*w+v[b*3+k]*(1-w);keep[b]=0;
   for(const f of neighbors){const ids=[t[f*3],t[f*3+1],t[f*3+2]];
    if(ids.includes(a)&&ids.includes(b))keep[V+f]=0;
    const corner=ids.indexOf(b);if(corner!==-1)wantT[f*3+corner]=a;
   }
  }
  assert.ok(selected>0,'an unchanged or blank step is not reduction evidence');
  assert.deepEqual([...out.flags.subarray(0,V+F)],[...keep],'all vertex/face keep flags obey selected collapses');
  assert.deepEqual(out.triangles,wantT,'all surviving and removed face rows have the native replacement law');close([...out.vertices],[...wantV]);
  const compacted=compactReduction(out.vertices,out.triangles,out.flags);assert.equal(compacted.vertices.length/3,V-selected);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],sub=(a,b)=>a.map((x,k)=>x-b[k]);
  const normal=(positions,triangles,f)=>{const p=[0,1,2].map(k=>[...positions.subarray(triangles[f*3+k]*3,triangles[f*3+k]*3+3)]);return cross(sub(p[1],p[0]),sub(p[2],p[0]));};
  for(let f=0;f<F;f++)if(keep[V+f]){const before=normal(v,t,f),after=normal(out.vertices,out.triangles,f);assert.ok(before.reduce((sum,x,k)=>sum+x*after[k],0)>=-3e-8,'kept triangle orientation must not flip');}
  // Native itself changes this near-flat intermediate topology after a 1e-7
  // translation. Preserve a complete cross-device diagnostic without turning
  // one M4's tie-sensitive choices into a universal arithmetic contract.
  if(JSON.stringify([...compacted.triangles])!==JSON.stringify(c.faces.flat()))console.log('native-flat-collapse-diagnostic: '+JSON.stringify({vertices:[...compacted.vertices],triangles:[...compacted.triangles],selected,nativeFaces:c.faces.length}));
 },{wgslSources});
});

test('Stop before an admitted reducer duty prevents every GPU submission',async()=>{
 await withKaminosGpu(async({device})=>{
  const controller=new AbortController(),c=fixture.singleStep,v=Float32Array.from(c.input.vertices.flat()),t=Uint32Array.from(c.input.faces.flat());let duties=0;
  const step=await createCuMeshReducerGpu({device,signal:controller.signal,withGpu:async(_phase,work)=>{
   duties++;controller.abort();return work(()=>{assert.fail('aborted duty encoded a command');});
  }});
  await assert.rejects(step(v,t,reducerTopology(v,t),{threshold:c.threshold}),{name:'AbortError'});assert.equal(duties,1);
 },{wgslSources});
});

test('device capacity refusal precedes reducer buffer allocation',async()=>{
 await withKaminosGpu(async({device})=>{
  let allocations=0;
  const limited=new Proxy(device,{get(target,key){
   if(key==='limits')return {...target.limits,maxBufferSize:16,maxStorageBufferBindingSize:16};
   if(key==='createBuffer')return descriptor=>{allocations++;return target.createBuffer(descriptor);};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const step=await createCuMeshReducerGpu({device:limited}),c=fixture.singleStep,v=Float32Array.from(c.input.vertices.flat()),t=Uint32Array.from(c.input.faces.flat());
  await assert.rejects(step(v,t,reducerTopology(v,t),{threshold:c.threshold}),/effective device capacity/);assert.equal(allocations,0);
 },{wgslSources});
});

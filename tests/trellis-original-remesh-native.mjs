// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch,extractWgslFunction} from '../tools/shader-herder.mjs';
import {buildRemeshBVH} from '../models/trellis2/original-remesh-bvh.js';
import {createRemeshGpu} from '../models/trellis2/original-remesh-gpu.js';
import {createBrowserMeshPostprocess} from '../models/trellis2/mesh-cleanup.js';
import {NodeTrellisUVWorker} from '../models/trellis2/node-uv-worker.mjs';
import {CLOSEST_SURFACE_WGSL,DUAL_CONTOUR_WGSL} from '../models/trellis2/original-remesh-wgsl.js';
import {readFileSync} from 'node:fs';
const wgslSources=[{label:'original closest surface',code:CLOSEST_SURFACE_WGSL,entryPoint:'closest_surface'},
  {label:'original dual contour',code:DUAL_CONTOUR_WGSL,entryPoint:'dual_contour'}];
const close=(actual,expected,tolerance=2e-6)=>{assert.equal(actual.length,expected.length);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<tolerance,`lane ${i}: ${v} != ${expected[i]}`));};

test('closest-point arithmetic oracle rejects a valid WGSL barycentric fault',async()=>{
 await withKaminosGpu(async ctx=>{
  const segment=extractWgslFunction(CLOSEST_SURFACE_WGSL,'segment'),triangle=extractWgslFunction(CLOSEST_SURFACE_WGSL,'triangleBary');
  const evaluate=fn=>evalWgslBatch(ctx,{preamble:segment+'\n'+fn,argTypes:['f32'],returnType:'vec3<f32>',
   body:'return triangleBary(vec3<f32>(arg0,0.25,0.5),vec3<f32>(0.0),vec3<f32>(1.0,0.0,0.0),vec3<f32>(0.0,1.0,0.0));',inputs:[[.25]]});
  const correct=await evaluate(triangle);close(correct[0],[.5,.25,.25]);
  const faulty=await evaluate(triangle.replace('1.0-v-w','1.0'));
  assert.throws(()=>close(faulty[0],[.5,.25,.25]));
 },{wgslSources});
});

test('production closest-surface kernel retains face identity, vertices, edges and degenerate triangles',async()=>{
  await withKaminosGpu(async({device})=>{
    const vertices=new Float32Array([0,0,0,1,0,0,0,1,0, 0,0,2,1,0,2,0,1,2, 3,0,0,3,0,0,3,1,0]);
    const triangles=new Uint32Array([0,1,2,3,4,5,6,7,8]);
    const gpu=await createRemeshGpu({device,bvh:buildRemeshBVH(vertices,triangles)});
    try{
      const hit=await gpu.query(new Float32Array([.25,.25,.5, 1,1,1.8, -.5,-.5,0, 3,.5,.25]));
      close([...hit.distances],[.5,Math.sqrt(.54),Math.sqrt(.5),.25]);
      close([...hit.positions],[.25,.25,0,.5,.5,2,0,0,0,3,.5,0]);
      const ids=new Uint32Array(hit.packed.buffer);assert.deepEqual([ids[7],ids[15],ids[23],ids[31]],[0,1,0,2]);
      // An execution oracle must reject a plausible wrong-surface answer.
      assert.throws(()=>close([...hit.positions],[.25,.25,2,.5,.5,0,0,0,0,3,.5,0]));
    }finally{gpu.dispose();}
  },{wgslSources});
});

test('production traversal visits leaves beyond 64 levels without a stack cap',async()=>{
  await withKaminosGpu(async({device})=>{
    // A chain of internal nodes leading to a single leaf is a valid preorder
    // escape-link tree; the nearest triangle can only be reached at depth 96.
    const nodes=new ArrayBuffer(97*48),f=new Float32Array(nodes),u=new Uint32Array(nodes);
    for(let i=0;i<97;i++){f.set([-1,-1,-1],i*12);f.set([1,1,1],i*12+4);u.set([97,0,i===96?1:0,0],i*12+8);}
    const gpu=await createRemeshGpu({device,bvh:{nodes,vertices:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),order:new Uint32Array([0])}});
    try{const hit=await gpu.query(new Float32Array([.25,.25,.5]));close([...hit.distances],[.5]);}finally{gpu.dispose();}
  },{wgslSources});
});

test('actual original-remesh worker and app-device kernels rebuild a closed box with caller-selected grid',async()=>{
  await withKaminosGpu(async({device})=>{
    const vertices=new Float32Array([-.25,-.25,-.25,.25,-.25,-.25,.25,.25,-.25,-.25,.25,-.25,-.25,-.25,.25,.25,-.25,.25,.25,.25,.25,-.25,.25,.25]);
    const triangles=new Uint32Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]);
    let rebuilt;
    const provider=createBrowserMeshPostprocess({mode:'original-remesh',device,resolution:8,targetFaces:100000,WorkerClass:NodeTrellisUVWorker,onReconstruction:m=>{rebuilt=m;}});
    try{
      const out=await provider({vertices,triangles,metadata:{source:'closed-box'}});
      assert.equal(out.metadata.postprocess.effectiveRoute,'TRELLIS.2/original-narrow-band-dc/WebGPU');
      assert.equal(out.metadata.postprocess.settings.resolution,8);assert.equal(out.metadata.postprocess.prefill.filledLoops,0);
      assert.ok(rebuilt.triangles.length>triangles.length);assert.deepEqual(out.vertices,rebuilt.vertices);assert.deepEqual(out.triangles,rebuilt.triangles);
      assert.equal(out.metadata.source,'closed-box');assert.equal(vertices.length,24);
      const projected=await provider.projectMaterialPositions(new Float32Array([0,0,.4]));close([...projected],[0,0,.25]);
      const edges=new Map();for(let i=0;i<out.triangles.length;i+=3)for(const [a,b] of [[0,1],[1,2],[2,0]]){const x=out.triangles[i+a],y=out.triangles[i+b],k=[Math.min(x,y),Math.max(x,y)].join(',');edges.set(k,(edges.get(k)??0)+1);}
      assert.ok([...edges.values()].every(n=>n===2),'closed source box must reconstruct closed sheets');
    }finally{provider.dispose();}
  },{wgslSources});
});

test('reconstruction and projection conform to captured native Metal outputs before reduction',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/trellis-original-remesh-metal.json',import.meta.url)));
 await withKaminosGpu(async({device})=>{
  for(const observed of fixture.cases){
   let rebuilt;
   const provider=createBrowserMeshPostprocess({mode:'original-remesh',device,...observed.settings,targetFaces:100000,WorkerClass:NodeTrellisUVWorker,onReconstruction:m=>{rebuilt=m;}});
   try{
    await provider({vertices:Float32Array.from(observed.vertices.flat()),triangles:Uint32Array.from(observed.triangles.flat())});
    assert.deepEqual([...rebuilt.triangles],observed.outputTriangles.flat(),observed.name+' complete ordered native topology');
    if(!observed.settings.projectBack)close([...rebuilt.vertices],observed.outputVertices.flat(),3e-6);
    else{
      // At symmetric-box ties the BVHs can select different exact minimizers.
      // Require both source-surface membership and the observed minimum
      // displacement; this still rejects an arbitrary farther projection.
      const before=fixture.cases.find(c=>c.name==='box').outputVertices,expected=observed.outputVertices;
      for(let i=0;i<before.length;i++){
        const actual=[...rebuilt.vertices.subarray(i*3,i*3+3)],distance=p=>Math.hypot(...p.map((v,a)=>v-before[i][a]));
        assert.ok(actual.every(v=>v>=-.250003&&v<=.250003)&&Math.abs(Math.max(...actual.map(Math.abs))-.25)<3e-6,'projected vertex must be on the source box');
        close([distance(actual)],[distance(expected[i])],3e-6);
      }
    }
   }finally{provider.dispose();}
  }
 },{wgslSources});
});

// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as collection from '../volume-immersed-source-collection.mjs';
import {createImmersedSourceWeightCache} from '../volume-core.js';
const controls={resolution:16,emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',pressureIterations:8,immersedRadius:.2,immersedSpeed:.1,immersedFuel:.56,immersedTemperature:1.2};
test('runtime source preparation is parameters-only even when source pose and GPU collision revision change',()=>{
 const compiler=collection.createRuntimeImmersedSourceCache(),forbidden={read(){throw Error('Live preparation entered CPU cell geometry');}},records=[{id:'a',worldSource:true,controls}],options={controls,grid:16,gridHeight:32,weightCaches:new Map([['a',forbidden]])};
 const first=compiler.collection(records,options);
 assert.equal(first.sources[0].config.effective.normalizationBackend,'gpu');
 assert.equal(first.sources[0].config.effective.fluxEffectivePredicted,null);
 assert.equal(first.sources[0].weights,undefined);
 assert.equal(first.data,undefined,'live packets carry coefficients and authored pattern inputs only');
 assert.equal(compiler.collection(records,{...options,solidRevision:42}),first,'an unread GPU mask cannot invalidate host source inputs');
 assert.equal(compiler.collection(records,{...options,controls:{...controls,lightingDirections:64}}),first);
 const moved=compiler.collection([{...records[0],controls:{...controls,immersedCentreX:.3}}],options);
 assert.notEqual(moved,first);assert.equal(moved.sources[0].config.effective.centreCells[0],10.4);
});

test('runtime source fields evolve on GPU without uploading another CPU image',async()=>{
 const {existsSync}=await import('node:fs'),url=new URL('../volume-immersed-source-gpu.mjs',import.meta.url),api=existsSync(url)?await import(url):{};
 assert.equal(typeof api.createGPUImmersedCollection,'function','live source fields need a GPU producer');
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,INDIRECT:16};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2,STORAGE_BINDING:4};
 const uploads=[],writes=[],passes=[];const d={limits:{maxTextureArrayLayers:256,maxStorageBufferBindingSize:2**27,maxBufferSize:2**28,maxComputeWorkgroupsPerDimension:65535},createBuffer:s=>({...s,destroy(){}}),createTexture:s=>({...s,createView(){return this;},destroy(){}}),createShaderModule:s=>s,createComputePipeline:s=>({...s,getBindGroupLayout:()=>({})}),createBindGroup:s=>s,queue:{writeBuffer(b,offset,data){writes.push(data.byteLength);},writeTexture(...args){uploads.push(args);},onSubmittedWorkDone:async()=>{}}};
 const encoder={clearBuffer(){},beginComputePass({label}){passes.push(label);return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){},end(){}};}};
 const compiler=collection.createRuntimeImmersedSourceCache(),packet=compiler.collection([{id:'a',controls:{...controls,emitterPuff:.4,emitterInletTurbulence:.3}}],{controls,grid:16,gridHeight:32,weightCaches:new Map()}),g=api.createGPUImmersedCollection(d);
 try{g.update(packet,{grid:16,step:0});const texture=g.texture,initial=uploads.length;for(let step=1;step<=3;step++){g.update(packet,{grid:16,step});const before=writes.length;g.encode(encoder,{step,controls});assert.ok(writes.slice(before).every(n=>n<=128),'per-step writes are compact clocks and source descriptors');}assert.equal(g.texture,texture);assert.equal(uploads.length,initial,'source field pixels cannot cross the CPU every step');assert.ok(passes.includes('GPU immersed source fields'));}finally{g.destroy();}
});

test('exterior source submission borrows GPU compact geometry and actual count without a CPU cell list',async()=>{
 const {createGPUImmersedWorldSources}=await import('../volume-immersed-world-source-gpu.mjs');
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8};
 const writes=[],passes=[];const d={limits:{maxStorageBufferBindingSize:2**27,maxBufferSize:2**28,maxComputeWorkgroupsPerDimension:65535},createBuffer:s=>({...s,destroy(){}}),createShaderModule:s=>s,createComputePipeline:s=>({...s,getBindGroupLayout:()=>({})}),createBindGroup:s=>s,queue:{writeBuffer(b,offset,data){writes.push(data.byteLength);},onSubmittedWorkDone:async()=>{}}};
 const packet=collection.createRuntimeImmersedSourceCache().collection([{id:'a',worldSource:true,controls:{...controls,immersedCentreX:1.1}}],{controls,grid:16,gridHeight:32}),g=createGPUImmersedWorldSources(d),texture={createView(){return this;}},geometry={cells:{size:3200},stats:{size:16},counts:{size:16},maxParcels:100,activeMaxParcels:100};
 Object.defineProperty(packet.sources[0],'weights',{get(){throw Error('CPU cell geometry read');}});
 const encoder={beginComputePass({label}){passes.push(label);return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){},end(){}};}};
 try{g.update(packet,{grid:16,gridHeight:32});for(let step=0;step<3;step++){g.update(packet,{grid:16,gridHeight:32});const n=writes.length,result=g.encode(encoder,{mapping:{fineToField:[0,0,0,1]},collection:{packet,texture,geometry,encodedStep:step},step});assert.equal(result.gpu.parcelCount,null,'capacity must not impersonate actual GPU count');assert.equal(result.gpu.counts,geometry.counts);assert.equal(result.gpu.maxParcels,100);assert.ok(writes.slice(n).every(x=>x<=32));}assert.ok(passes.includes('GPU exterior source parcels'));}finally{g.destroy();}
});

test('Fine source priorities retain measured GPU puff modulation over the cached nominal supply',async()=>{
 const {sourceCoverageBounds}=await import('../volume-fine-coverage.mjs'),cache=collection.createRuntimeImmersedSourceCache(),packet=cache.collection([{id:'a',worldSource:true,controls:{...controls,emitterPuff:.4}}],{controls,grid:16,gridHeight:32,weightCaches:new Map()}),frame={translate:[0,0,0],scale:1},base=sourceCoverageBounds(packet,{dims:[16,32,16],frame}),observed=sourceCoverageBounds(packet,{dims:[16,32,16],frame,puffFactors:new Map([['a',.25]])});
 assert.ok(base[0].weight>0);assert.equal(observed[0].weight,base[0].weight*.25,'following uses the sampled source rate rather than silently freezing all sources at their nominal rate');
});

test('GPU source diagnostics preserve unread totals rather than reporting zero or exact clipping',async()=>{
 const {pressureResidualMeasurement}=await import('../volume-core.js'),packet=collection.createRuntimeImmersedSourceCache().collection([{id:'a',controls}],{controls,grid:16,gridHeight:32});
 const measured=pressureResidualMeasurement(null,null,{active:true,sources:packet.sources});assert.equal(measured.immersedSource.fluxEffectivePredicted,null);assert.match(measured.statement,/unmeasured/);
 const single=pressureResidualMeasurement(null,packet.sources[0].config);assert.equal(single.immersedSource.fluxEffectivePredicted,null);assert.doesNotMatch(single.statement,/no cell clipped/);
});

test('GPU source integer bounds retain every reference cell while avoiding a thick slab reach cube',async()=>{
 const {immersedSourceIntegerBounds}=await import('../volume-immersed-source-geometry-gpu.mjs'),{resolveImmersedSourceConfig,immersedSourceWeights}=await import('../volume-core.js');
 for(const yaw of [0,64])for(const pitch of [90,37])for(const x of [0,1.2]){
  const e=resolveImmersedSourceConfig({...controls,immersedRadius:.5,immersedYaw:yaw,immersedPitch:pitch,immersedCentreX:x},{grid:8,gridHeight:16,worldSource:true,geometryOnly:true}).effective,b=immersedSourceIntegerBounds(e,{grid:8,gridHeight:16,worldSource:true}),reference=immersedSourceWeights(e,{grid:8,gridHeight:16,unbounded:true});
  for(const c of reference.cells)assert.ok([c.x,c.y,c.z].every((v,a)=>v>=b.lo[a]&&v<b.lo[a]+b.span[a]),'conservative bounds omitted positive reference weight');
  assert.ok(reference.cells.filter(c=>c.x<0||c.x>=8||c.y<0||c.y>=16||c.z<0||c.z>=8).length<=b.exteriorCapacity);
 }
 const b=immersedSourceIntegerBounds({admitted:true,centreCells:[4,8,4],direction:[0,1,0],thickness:200,radiusCells:2},{grid:8,gridHeight:16,worldSource:true});assert.ok(b.span[0]<12&&b.span[2]<12&&b.span[1]>200,'thickness may lengthen the normal axis without expanding a cubic walk');
});

test('pose changes retain every current authored pattern beyond the shared reference cache size',()=>{
 const compiler=collection.createRuntimeImmersedSourceCache(),records=Array.from({length:20},(_,i)=>({id:'source-'+i,worldSource:true,controls:{...controls,emitterAperturePattern:'jets',immersedRadius:.2+i*.01}})),options={controls,grid:8,gridHeight:16},before=compiler.collection(records,options),moved=compiler.collection(records.map(r=>({...r,controls:{...r.controls,immersedCentreX:.1}})),options);
 for(let i=0;i<records.length;i++)assert.ok(moved.sources[i].pattern===before.sources[i].pattern,records[i].id+' rebuilt unchanged pattern');
 const changed=compiler.collection(records.map((r,i)=>({...r,controls:{...r.controls,immersedCentreX:.1,...(i===0?{immersedRadius:.8}:{})}})),options);assert.notEqual(changed.sources[0].pattern,moved.sources[0].pattern);assert.equal(changed.sources[1].pattern,moved.sources[1].pattern);
});

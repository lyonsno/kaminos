// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {createSceneVolumeSource} from '../scene-volume-source.mjs';
import {exteriorSegments} from '../scene-exterior-medium.mjs';
import {createExteriorSmokeLight} from '../scene-exterior-light.mjs';
import {resolveWorldRegions} from '../volume-region-controls.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const uploads=new Map(),groups=[];
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(b,offset,data){uploads.set(b.label,new Float32Array(data));},submit(){}},
 createBuffer({label}){return {label,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
 createShaderModule(){return {};},createComputePipeline(){return {getBindGroupLayout(){return {};}};},createBindGroup(value){groups.push(value);return value;},
 createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
const geometry={nodes:new Float32Array(12),triangles:new Float32Array(12),nodeCount:0,triangleCount:0};
const source={status:'encoded',texture:device.createTexture(),dimensions:[4,8,4],generation:7,frame:9};
const bounds={lo:[-3,-2,-4],hi:[3,10,2]};
assert.deepEqual(exteriorSegments([-4,0,0],[1,0,0],20,[-3,-3,-3],[3,9,3]),[[1,3],[5,7]]);
assert.deepEqual(exteriorSegments([0,0,0],[1,0,0],20,[-3,-3,-3],[3,9,3]),[[1,3]],'inside fine: only downstream exterior attenuates sky');
assert.deepEqual(exteriorSegments([-4,0,0],[1,0,0],3,[-3,-3,-3],[3,9,3]),[[1,3]],'source attenuation ends at fine entry');
assert.deepEqual(exteriorSegments([-4,0,0],[1,0,0],.5,[-3,-3,-3],[3,9,3]),[],'zero path through medium stays transparent');
const gather=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,sourceDimensions:source.dimensions,smokeRefinement:1,receiverBounds:bounds});
assert.deepEqual(Array.from(uploads.get('surface and smoke receivers').slice(0,3)),[-1.5,-.5,-2.5],
 'exterior receivers must use actual translated world bounds, not fine-box positions');
assert.deepEqual(gather.volumeDimensions,[2,4,2]);
const frame=gather.encode(source);
assert.deepEqual(frame.sourceDomain,{lo:[-1,-1,-1],hi:[1,3,1]},'fine source integration domain must not expand');
assert.deepEqual(frame.smokeReconstruction.localMin,bounds.lo);
assert.deepEqual(frame.smokeReconstruction.localMax,bounds.hi);
gather.destroy();
let world={texture:device.createTexture(),dimensions:[4,8,4],localMin:bounds.lo,localMax:bounds.hi};
const producer=createSceneVolumeSource({device,module:{},uniformBuffer:{},fluidBuffers:[{}],frontBuffers:[{}],getReactantTextures:()=>[device.createTexture()],grid:4,gridY:8,getWorldSmoke:()=>world,worldRenderUniform:{}});
producer.encode(device.createCommandEncoder(),0,9);
assert.equal(producer.describe().exterior?.status,'encoded','world material must publish current physical extinction, not raw soot/heat interpreted as optical depth');
assert.equal(producer.describe().exterior.generation,producer.describe().generation);
assert.deepEqual(producer.describe().exterior.localMin,bounds.lo);
world.middle={texture:device.createTexture(),dimensions:[8,16,8],localMin:[-2,-2,-2],localMax:[2,6,2]};
producer.encode(device.createCommandEncoder(),0,10);
const middle=producer.describe().exterior.middle;
assert.ok(middle?.texture,'independent intermediate material must publish its own extinction field');
assert.deepEqual(middle.dimensions,[8,16,8],'intermediate detail must not be downsampled to world dimensions');
assert.equal(middle.generation,producer.describe().generation);
assert.deepEqual(middle.localMax,[2,6,2]);
assert.ok(groups.some(g=>g.entries.some(e=>e.binding===33)),'intermediate material seed must bind the actual intermediate optical field');
const lighting=createExteriorSmokeLight(device,{grid:2,refinement:1});
const lit=lighting.encode(producer.describe(),{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
assert.deepEqual(lit.middle.smokeReconstruction.localMin,world.middle.localMin);
assert.deepEqual(lit.middle.smokeReconstruction.localMax,world.middle.localMax);
assert.equal(lit.middle.generation,lit.generation);
assert.notEqual(lit.middle.texture,lit.texture,'middle lighting has independent spatial coverage');
assert.deepEqual(lit.sourceDomain,{lo:[-1,-1,-1],hi:[1,3,1]},'three region lighting still samples the actual fine emitter bounds');
const actualMiddle=resolveWorldRegions({worldSmokeIntermediate:'fields'},[64,128,64]).middle;
world.middle={texture:device.createTexture(),dimensions:actualMiddle.materialDims,localMin:actualMiddle.min,localMax:actualMiddle.max};
producer.encode(device.createCommandEncoder(),0,11);
const actualLighting=createExteriorSmokeLight(device);
const actualLit=actualLighting.encode(producer.describe(),{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
assert.deepEqual(actualLit.middle.smokeReconstruction.localMin,actualMiddle.min);
assert.deepEqual(actualLit.middle.smokeReconstruction.localMax,actualMiddle.max,'production intermediate proportions preserve exact coverage');
assert.deepEqual(actualLit.middle.smokeReconstruction.coarseDimensions,[9,15,9]);
actualLighting.destroy();
world.middle=null;producer.encode(device.createCommandEncoder(),0,11);
assert.equal(producer.describe().exterior.middle,null,'removing intermediate must clear its published support');
assert.equal(lighting.encode(producer.describe(),{geometry,revision:1,worldGeometry:false,directions:4,gain:1}).middle,null);
lighting.destroy();
world=null;producer.encode(device.createCommandEncoder(),0,10);
assert.equal(producer.describe().exterior,null,'disabled world must not retain stale lighting support');
producer.destroy();
// The ordinary joined material has both an exterior and a fine scattering
// site. Execute the native-host production substitution on both sites.
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const host=core.split('function renderSceneTransportHost() {')[1].split('function ')[0];
const substitution=host.match(/code=code(\.replace(?:All)?\('medium\.scattering \* incidentAt\(p\)','medium\.scattering \* distributedMeanIncident\(p\)'\))/)[1];
const substituted=new Function('code',`return code${substitution}`)('medium.scattering * incidentAt(p); medium.scattering * incidentAt(p)');
assert.equal(substituted.match(/distributedMeanIncident/g)?.length,2,'native host must light both fine and exterior material sites');
console.log('exterior receivers preserve fine source bounds and actual world coordinates');

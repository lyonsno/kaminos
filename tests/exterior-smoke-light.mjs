// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {createSceneVolumeSource} from '../scene-volume-source.mjs';
import {exteriorSegments} from '../scene-exterior-medium.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const uploads=new Map();
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(b,offset,data){uploads.set(b.label,new Float32Array(data));},submit(){}},
 createBuffer({label}){return {label,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
 createShaderModule(){return {};},createComputePipeline(){return {getBindGroupLayout(){return {};}};},createBindGroup(){return {};},
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

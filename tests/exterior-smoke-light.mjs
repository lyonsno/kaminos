// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {createSceneVolumeSource, SCENE_VOLUME_SOURCE_WGSL} from '../scene-volume-source.mjs';
import {WORLD_SMOKE_OPTICS_WGSL} from '../volume-world-smoke-optics.mjs';
import {exteriorSegments} from '../scene-exterior-medium.mjs';
import {createExteriorSmokeLight} from '../scene-exterior-light.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const uploads=new Map(),groups=[];
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(b,offset,data){uploads.set(b.label,new Float32Array(data));},submit(){}},
 createBuffer({label}){return {label,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
 createShaderModule(){return {};},createComputePipeline(){return {getBindGroupLayout(){return {};}};},createBindGroup(value){groups.push(value);return value;},
 createCommandEncoder(){return {copyBufferToBuffer(){},beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
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
assert.equal(Object.hasOwn(producer.describe().exterior,'middle'),false,'retired Middle input cannot publish a third physical material region');
// Check composition against the current exported helper interfaces, rather
// than pinning the old branch's call arity. Native validation still owns WGSL.
function argumentsAt(text,start){
 let depth=0,count=1;
 for(let i=start;i<text.length;i++){
  if(text[i]==='(')depth++;
  else if(text[i]===')'){if(--depth===0)return count;}
  else if(text[i]===','&&depth===1)count++;
 }
 throw Error('unterminated shader call');
}
for(const name of ['regionSmokeMaterial','regionSmokeSample']){
 const definition=WORLD_SMOKE_OPTICS_WGSL.indexOf('fn '+name+'(');
 assert.ok(definition>=0,'regional optics must export '+name);
 const arity=argumentsAt(WORLD_SMOKE_OPTICS_WGSL,WORLD_SMOKE_OPTICS_WGSL.indexOf('(',definition));
 for(const call of SCENE_VOLUME_SOURCE_WGSL.matchAll(new RegExp('\\b'+name+'\\(','g')))
  assert.equal(argumentsAt(SCENE_VOLUME_SOURCE_WGSL,call.index+name.length),arity,name+' seed call must match the current optical atlas helper');
}
const lighting=createExteriorSmokeLight(device,{grid:2,refinement:1,receiverCoverage:{lo:world.middle.localMin,hi:world.middle.localMax,pitch:1}});
const lit=lighting.encode(producer.describe(),{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
assert.deepEqual(lit.middle.smokeReconstruction.localMin,world.middle.localMin);
assert.deepEqual(lit.middle.smokeReconstruction.localMax,world.middle.localMax);
assert.equal(lit.middle.generation,lit.generation);
assert.notEqual(lit.middle.texture,lit.texture,'middle lighting has independent spatial coverage');
assert.deepEqual(lit.sourceDomain,{lo:[-1,-1,-1],hi:[1,3,1]},'receiver refinement still samples the actual fine emitter bounds');
world.middle=null;producer.encode(device.createCommandEncoder(),0,11);
assert.equal(Object.hasOwn(producer.describe().exterior,'middle'),false);
lighting.setReceiverCoverage(null);
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

// Near construction and bounds rebuild must never substitute Fine directions.
device.limits.maxStorageBufferBindingSize=134217728;
const independentNear=createExteriorSmokeLight(device,{receiverCoverage:{lo:[-1.5,-1,-1.5],hi:[1.5,5,1.5],pitch:.125,directions:8}});
const independentSource={...source,exterior:{...source,dimensions:[8,16,8],localMin:[-3,-3,-3],localMax:[3,9,3]}};
for(const coverage of [null,{lo:[-1.75,-1,-1.5],hi:[1.25,5,1.5],pitch:.125,directions:8}]){
 if(coverage)independentNear.setReceiverCoverage(coverage);
 let field;assert.doesNotThrow(()=>{field=independentNear.encode(independentSource,{geometry,revision:1,worldGeometry:false,directions:2048,gain:1});},'fitting Near8 must be constructed with8, even when Fine2048 is valid');
 assert.equal(field.middle.directions,8);assert.equal(field.middle.smokeReconstruction.refinement,4);
}
independentNear.destroy();

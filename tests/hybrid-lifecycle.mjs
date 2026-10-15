// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {mountDistributedSceneRadiance} from '../scene-hybrid-radiance.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const passes=[],uploads=[],pipelines=[];
let failPass=null,failSource=null;
const consumedSources=[];
const pipeline={getBindGroupLayout(){return {};}};
const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(buffer,offset,data){uploads.push([buffer.label,new Float32Array(data)]);},submit(){}},
 createBuffer({label}){return {label,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
 createShaderModule(){return {};},createComputePipeline(descriptor){pipelines.push(descriptor.label);return pipeline;},createBindGroup({entries}){const source=entries.find(e=>e.binding===5)?.resource?.source;if(source===failSource&&source)throw Error('injected source binding failure');return {source};},
 createCommandEncoder(){return {beginComputePass({label}={}){passes.push(label);if(label===failPass)throw Error('injected preparation failure');return {setPipeline(){},setBindGroup(_,group){if(label==='live distributed flame transport')consumedSources.push(group.source);},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
let consume,hostFrame;
const field={source:{status:'encoded',texture:{createView(){return {source:'A'};}},dimensions:[4,8,4],localMax:[1,3,1],generation:1,frame:1}};
const prototype={setSceneMediumSource(){},setSceneSourceFrameConsumer(fn){consume=fn;},setSceneDistributedLightFrame(frame){hostFrame=frame;},sceneVolumeSourceField:()=>field.source};
const renderer={library:new THREE.StandardNodeLibrary(),backend:{get(){return {};}}},scene=new THREE.Scene();
const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial({color:0xaaff88});
const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;scene.add(mesh);
const mount=mountDistributedSceneRadiance({renderer,scene,prototype,device,volumeGrid:2,smokeRefinement:1,pointCount:2,createShadow:()=>({visibility:THREE.TSL.float(1),render(){},debugState:()=>({fixture:true}),dispose(){}})});
consume(field);assert.equal(mount.canRender(),true);assert.equal(mesh.geometry,geometry,'hybrid must not clone/build surface receivers');
assert.equal(mount.debugState().frame.pointRegions.partition,'energy');
const twoSourceMaterialKey=mesh.material.customProgramCacheKey();
mount.setPointCount(1);assert.equal(mount.canRender(),false,'changed source layout must await current reduction');consume(field);
assert.notEqual(mesh.material.customProgramCacheKey(),twoSourceMaterialKey,'replacement irradiance graph must invalidate Three shader cache, not only material version');
assert.equal(mount.debugState().pointCount,1);assert.equal(mount.debugState().shadows.length,1);
mount.setPointCount(2);consume(field);assert.equal(mount.debugState().pointCount,2);assert.equal(mount.debugState().shadows.length,2);
assert.throws(()=>mount.setPointCount(0),/point count/);assert.equal(mount.canRender(),true);
assert.equal(geometry.hasAttribute('sceneReceiverIndex'),false);assert.equal(mount.debugState().surfaceReceivers,0);assert.equal(hostFrame.volumeReceivers,16);
const first=mount.debugState();mount.setReceiverSpacing(.8);mount.setSurfaceReconstruction(8);field.source.generation++;field.source.frame++;consume(field);
assert.deepEqual(first.frame.smokeReconstruction.dimensions,[2,4,2],'explicit cheap smoke reconstruction must be effective');
assert.equal(mount.debugState().geometryBuilds,first.geometryBuilds,'surface spacing controls must not construct an unused cache');
field.source.worldTransform={translate:[2,-1,4],scale:2};field.source.generation++;consume(field);
assert.equal(mount.debugState().geometryBuilds,1,'source movement reuses world BVH');
assert.equal(passes.filter(p=>p==='reproject world BVH without CPU rebuild').length,2);
assert.equal(passes.filter(p=>p==='prepare static smoke interpolation').length,2,'source movement must invalidate dependent smoke geometry');
assert.equal(passes.filter(p=>p==='static kiln visibility preparation').length,2,'source movement must invalidate smoke ray visibility');
assert.equal(uploads.filter(([label])=>label==='surface and smoke receivers').length,1);
field.source.generation++;assert.equal(mount.canRender(),false,'new generation must not render stale point fields');consume(field);
const pipelineCount=pipelines.length,preparations=passes.filter(p=>p==='static kiln visibility preparation').length;
mount.setEditing(true);
for(let i=1;i<=3;i++){
 mesh.position.x=i*.25;mesh.rotation.y=i*.2;mesh.scale.set(1+i*.1,1,1-i*.1);field.source.generation++;consume(field);
 assert.equal(mount.debugState().geometryBuilds,1,'solid transforms must reuse mesh-local BVHs');
 assert.equal(mount.canRender(),true,'transformed smoke and surface lighting must share the current frame');
}
mount.setEditing(false);
assert.equal(pipelines.length,pipelineCount,'solid transforms must not recreate compute pipelines');
assert.equal(passes.filter(p=>p==='static kiln visibility preparation').length,preparations+3,'every changed pose must refresh smoke visibility');
geometry.attributes.position.needsUpdate=true;consume(field);
assert.equal(mount.debugState().geometryBuilds,2,'actual vertex edits must rebuild local visibility');
mesh.position.x=2;failPass='live distributed flame transport';
assert.throws(()=>consume(field),/injected preparation failure/);assert.equal(mount.canRender(),false);
const failedProjectionCount=passes.filter(p=>p==='reproject world BVH without CPU rebuild').length;
failPass=null;consume(field);
assert.equal(passes.filter(p=>p==='reproject world BVH without CPU rebuild').length,failedProjectionCount+1,'retry must re-encode an abandoned transform');
mesh.position.x=3;failPass='live distributed flame transport';assert.throws(()=>consume(field),/injected/);
mesh.position.x=2;failPass=null;consume(field);const restoredCount=passes.filter(p=>p==='reproject world BVH without CPU rebuild').length;
mesh.position.x=3;consume(field);
assert.equal(passes.filter(p=>p==='reproject world BVH without CPU rebuild').length,restoredCount+1,'returning to a committed pose must discard a different pending transform');
assert.equal(consumedSources.at(-1),'A');
field.source.texture={createView(){return {source:'B'};}};field.source.generation++;failSource='B';
assert.throws(()=>consume(field),/injected source binding failure/);assert.equal(mount.canRender(),false);
failSource=null;consume(field);
assert.equal(consumedSources.at(-1),'B','retry must consume the replacement source, not merely publish its generation');
assert.equal(mount.canRender(),true);
field.source.exterior={texture:{createView(){return {source:'exterior'};}},dimensions:[4,8,4],localMin:[-3,-2,-3],localMax:[3,10,3],generation:field.source.generation};
consume(field);
assert.deepEqual(hostFrame.exteriorSmokeReconstruction?.localMax,[3,10,3],'joined smoke must get a separate full exterior lighting receiver field');
assert.deepEqual(hostFrame.smokeReconstruction.dimensions,[2,4,2],'retain fine lighting receiver density');
assert.equal(hostFrame.exteriorSourceGeneration,field.source.generation);
field.source.exterior.generation--;
assert.throws(()=>consume(field),/stale/);assert.equal(mount.canRender(),false);
field.source.exterior=null;consume(field);assert.equal(hostFrame.exteriorSmokeReconstruction,null);
mesh.material.color.setHex(0xff0000);mount.dispose();assert.equal(mesh.material.color.getHex(),0xff0000);assert.equal(mesh.geometry,geometry);assert.equal(mount.canRender(),false);assert.equal(hostFrame,null);
console.log('hybrid lifecycle and honest rebuild boundaries passed');

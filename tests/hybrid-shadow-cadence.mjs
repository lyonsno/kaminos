// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {mountDistributedSceneRadiance} from '../scene-hybrid-radiance.mjs';
import {fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const passes=[],uploads=[],pipelines=[];
let failPass=null,failSource=null;
const consumedSources=[];
const pipeline={getBindGroupLayout(){return {};}};
const device={limits:{maxUniformBufferBindingSize:65536,maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
 queue:{writeBuffer(buffer,offset,data){uploads.push([buffer.label,new Float32Array(data)]);},submit(){}},
 createBuffer({label}){return {label,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
 createShaderModule(){return {};},createComputePipeline(descriptor){pipelines.push(descriptor.label);return pipeline;},createBindGroup({entries}){const source=entries.find(e=>e.binding===5)?.resource?.source;if(source===failSource&&source)throw Error('injected source binding failure');return {source};},
 createCommandEncoder(){return {copyTextureToTexture(){},beginComputePass({label}={}){passes.push(label);if(label===failPass)throw Error('injected preparation failure');return {setPipeline(){},setBindGroup(_,group){if(label==='live distributed flame transport')consumedSources.push(group.source);},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
let consume,hostFrame;
const field={source:{status:'encoded',texture:{createView(){return {source:'A'};}},dimensions:[4,8,4],localMax:[1,3,1],generation:1,frame:1}};
const prototype={setSceneMediumSource(){},setSceneSourceFrameConsumer(fn){consume=fn;},setSceneDistributedLightFrame(frame){hostFrame=frame;},sceneVolumeSourceField:()=>field.source};
const renderer={library:new THREE.StandardNodeLibrary(),backend:{get(){return {};}}},scene=new THREE.Scene();
const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial({color:0xaaff88});
const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;scene.add(mesh);
const patterns=[],batches=[];
let compileRelease,compileCalls=0,held=false,failCapture=false;
const rebuild={hold(value){held=value;},compile(){compileCalls++;return new Promise(resolve=>compileRelease=resolve);}};
const mount=mountDistributedSceneRadiance({renderer,scene,prototype,device,nearBox:{enabled:false},volumeGrid:2,smokeRefinement:1,pointCount:6,smokeShadowSteps:2,smokeShadowResolution:2,createShadow:({filterPattern})=>{patterns.push(filterPattern);return {visibility:THREE.TSL.float(1),render(batch){batches.push(batch);if(failCapture)throw Error('injected cube capture failure');},debugState:()=>({fixture:true}),setQuality(){},dispose(){}};}});

assert.equal(typeof mount.setShadowCaptureBudget,'function','ordinary lighting needs an independent solid-cube capture budget');
mount.setShadowCaptureBudget(2);
const advance=()=>{field.source.frame++;consume(field);return mount.debugState();};
let s=advance();assert.equal(s.capturedPointCount,6);assert.equal(s.residentShadowCount,6);assert.equal(s.frame.solidShadowCapture.reason,'initialize');
for(const expected of [[0,1],[2,3],[4,5]]){
 s=advance();assert.equal(s.capturedPointCount,2);assert.equal(s.residentShadowCount,6);assert.equal(s.evaluatedPointCount,6);
 assert.deepEqual(s.frame.solidShadowCapture.refreshedIndices,expected);assert.ok(s.frame.solidShadowCapture.oldestAge<=2);
 assert.equal(s.frame.pointRegions.frame,field.source.frame,'point powers retain current source identity');
 assert.equal(s.frame.smokeShadow.frame,field.source.frame,'smoke extinction prefixes stay current independently of solid cubes');
}
const budgetPipelines=pipelines.length;mount.setShadowCaptureBudget(1);s=advance();assert.equal(s.capturedPointCount,1);assert.equal(pipelines.length,budgetPipelines,'refresh budget must be a live scheduling edit');
const current=s.frame;assert.throws(()=>mount.setShadowCaptureBudget(-1),/nonnegative integer/);assert.equal(mount.canRender(),true);assert.equal(mount.debugState().frame,current);
mesh.position.x=2;s=advance();assert.equal(s.capturedPointCount,1,'ordinary caster pose motion keeps the chosen bounded shadow lag');
geometry.attributes.position.needsUpdate=true;s=advance();assert.equal(s.capturedPointCount,6,'structural caster edits invalidate all retained cubes');assert.equal(s.frame.solidShadowCapture.reason,'invalidate');
mount.setShadowQuality({resolution:64});s=advance();assert.equal(s.capturedPointCount,6,'resized targets must all be initialized before sampling');
field.source.worldTransform={translate:[3,1,0],scale:2};s=advance();assert.equal(s.capturedPointCount,6,'changed Fine coordinates cannot inherit prior anchor transforms');
mount.setSurfaceEnabled(false);s=advance();assert.equal(s.capturedPointCount,0);assert.equal(s.frame.solidShadowCapture,null);
mount.setSurfaceEnabled(true);s=advance();assert.equal(s.capturedPointCount,6,'reenabling surface lighting refreshes the stale bank');
const beforeFailure=mount.debugState().solidShadowCapture;
failCapture=true;assert.throws(advance,/injected cube capture failure/);
assert.equal(mount.canRender(),false,'an incomplete bank cannot be presented');
assert.equal(mount.debugState().capturedPointCount,0,'failed work is not advertised as captured');
failCapture=false;s=advance();
assert.equal(s.solidShadowCapture.ordinal,beforeFailure.ordinal+1,'failure does not consume a scheduling frame');
assert.deepEqual(s.solidShadowCapture.refreshedIndices,[0],'retry retains the failed selection');
mount.setShadowCaptureBudget(0);assert.equal(advance().capturedPointCount,6);
mount.dispose();assert.equal(hostFrame,null);
console.log('PASS hybrid staged solid capture, live radiance/prefix identities and invalidation');

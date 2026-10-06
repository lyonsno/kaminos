import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {mountDistributedSceneRadiance} from '../scene-distributed-radiance.mjs';

// Actual local Three geometry/material lifecycle; no GPU arithmetic claim.
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
function fixture(castShadow=true) {
  const uploads=[],passes=[],copies=[];
  const pipeline={getBindGroupLayout(){return {};}};
  const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
    queue:{writeBuffer(buffer,offset,data){if(buffer.label==='surface and smoke receivers')uploads.push(new Float32Array(data));},submit(){}},
    createBuffer({label}){return {label,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
    createShaderModule(){return {};},createComputePipeline(){return pipeline;},createBindGroup(){return {};},
    createCommandEncoder(){return {copyBufferToBuffer(...args){copies.push(args);},beginComputePass({label}){passes.push(label);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
  let consume;
  const prototype={setSceneMediumSource(){},setSceneSourceFrameConsumer(fn){consume=fn;},setSceneDistributedLightFrame(){}};
  const renderer={library:new THREE.StandardNodeLibrary(),backend:{get(){return {};}}};
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setIndex([0,1,2]);geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial();
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=castShadow;
  const scene=new THREE.Scene();scene.add(mesh);
  const statuses=[];
  const mount=mountDistributedSceneRadiance({renderer,scene,prototype,device,volumeGrid:2,onStatus:s=>statuses.push(s)});
  const field={source:{status:'encoded',texture:{createView(){return {}; }},localMax:[1,3,1],dimensions:[32,64,32],generation:1,frame:1}};
  return {mesh,mount,geometry,material,uploads,device,statuses,passes,copies,field,prepare(){consume(field);}};
}
const selected=process.argv[2];
if(!selected||selected==='receiver-spacing'){
  const f=fixture();f.prepare();
  assert.equal(typeof f.mount.setReceiverSpacing,'function','receiver spacing must be a real live-mount control');
  const originalIndex=f.mesh.geometry.getAttribute('sceneReceiverIndex');
  f.mount.setReceiverSpacing(2);f.prepare();f.prepare();
  let state=f.mount.debugState();
  assert.equal(state.receiverSampling.spacing,2);
  assert(state.surfaceReceivers<3,'coarse layout must reduce actual GPU ray receiver rows');
  assert.equal(state.renderVertices,3,'render mesh remains intact');
  assert.equal(state.visibilityBuilds,1,'changing spacing reuses packed caster geometry');
  assert.equal(f.mesh.geometry.getAttribute('sceneReceiverIndex').itemSize,4);
  assert.equal(f.mesh.geometry.getAttribute('sceneReceiverWeight').itemSize,4);
  f.mount.setReceiverSpacing(0);f.prepare();f.prepare();
  state=f.mount.debugState();assert.equal(state.surfaceReceivers,3);assert.equal(state.visibilityBuilds,1);
  assert.equal(f.mesh.geometry.getAttribute('sceneReceiverIndex').itemSize,originalIndex.itemSize);
  assert.equal(f.mesh.geometry.hasAttribute('sceneReceiverWeight'),false);
  f.mesh.position.x=.1;f.prepare();assert.equal(f.mount.debugState().visibilityBuilds,2,'actual geometry movement invalidates cached packed triangles');
  f.mount.dispose();assert.equal(f.mesh.geometry.hasAttribute('sceneReceiverIndex'),false);assert.equal(f.mesh.geometry.hasAttribute('sceneReceiverWeight'),false);
}
if(!selected||selected==='source') {
  const f=fixture();f.mount.setDirections(12);
  assert.doesNotThrow(()=>f.mount.setAngularPattern('source'),'source-aware mode must reach the live mount');
  f.prepare();
  let state=f.mount.debugState().frame;
  assert.equal(state.angularPattern,'source');
  assert.equal(state.integration,'exact-cell');
  assert.equal(state.angularCache.preparedRayDirections,12);
  f.mount.setDirections(16);f.prepare();
  assert.equal(f.copies.length,1,'growing progressive quality copies existing visibility');
  state=f.mount.debugState().frame;
  assert.equal(state.angularCache.preparedRayDirections,16,'only four new rays per receiver were traced');
  assert.equal(state.angularCache.lastPreparedDirections,4);
  f.mount.setDirections(12);f.prepare();
  assert.equal(f.mount.debugState().frame.angularCache.preparedRayDirections,16,'lower quality reuses the prefix');
  assert.equal(f.mount.debugState().frame.directions,12);
  assert.equal(f.uploads.length,1);
  f.mount.setRetainComparisons(true);
  f.mount.setAngularPattern('fixed');f.prepare();
  assert.equal(f.mount.debugState().frame.integration,'midpoint');
  const prepared=f.mount.debugState().frame.angularCache.visibilityPreparations;
  f.mount.setAngularPattern('source');f.prepare();
  assert.equal(f.mount.debugState().frame.angularCache.visibilityPreparations,prepared,'A/B mode retains source visibility across baseline comparison');
  f.mount.dispose();
}
if(!selected||selected==='reconstruction') {
  const f=fixture();f.prepare();
  assert.equal(f.passes.filter(p=>p==='current-frame surface reconstruction').length,0);
  f.mount.setSurfaceReconstruction?.(4);f.prepare();
  assert.equal(f.passes.filter(p=>p==='current-frame surface reconstruction').length,4,'requested reconstruction must filter the current gather before mesh presentation');
  assert.equal(f.mount.debugState().frame.surfaceReconstruction.passes,4);
  assert.equal(f.mount.debugState().geometryBuilds,1,'reconstruction must reuse static visibility');
  f.mount.setSurfaceReconstruction(0);f.prepare();
  assert.equal(f.passes.filter(p=>p==='current-frame surface reconstruction').length,4,'off must dispatch no filtering');
  assert.throws(()=>f.mount.setSurfaceReconstruction(3),/nonnegative even integer/);
  f.mount.dispose();
}
if(!selected||selected==='failure') {
  const f=fixture();f.prepare();
  const previous=f.mount.debugState().frame;
  f.device.limits.maxStorageBufferBindingSize=4096;
  f.mount.setDirections(96);
  assert.throws(()=>f.prepare(),/cached first solid distance/);
  const state=f.mount.debugState();
  assert.equal(state.status,'preparation-failed','failed angular preparation must not retain successful status');
  assert.equal(state.directions,96);assert.equal(state.frame.directions,24);
  assert.equal(state.frame,previous,'last effective frame retained for diagnosis');
  assert.match(state.error,/cached first solid distance/);
  assert.equal(f.statuses.at(-1).status,'preparation-failed');
  f.mount.dispose();
}
if(!selected||selected==='interaction') {
  const f=fixture();f.prepare();
  f.mount.setEditing?.('gizmo',true);
  for(const x of [.2,.4,.6]){f.mesh.position.x=x;f.prepare();}
  assert.equal(f.uploads.length,1,'continuous geometry editing must not rebuild visibility');
  assert.equal(f.mount.debugState().previewStale,true,'stale geometry must be explicit');
  f.mount.setEditing('gizmo',false);
  f.prepare();
  assert.equal(f.uploads.length,1,'queue one presentation of rebuilding status before blocking preparation');
  assert.equal(f.mount.debugState().status,'rebuild-pending');
  f.prepare();
  assert.equal(f.uploads.length,2,'committed edit builds once');
  assert.equal(f.uploads.at(-1)[0],Math.fround(.6),'latest authored position is built');
  assert.equal(f.mount.debugState().previewStale,false);
  f.prepare();assert.equal(f.uploads.length,2);f.mount.dispose();
}
if(!selected||selected==='angular') {
  const f=fixture();f.prepare();
  f.mount.setRetainComparisons(true);
  for(const count of [12,16,24,12]) {
    f.mount.setDirections(count);f.prepare();
    assert.equal(f.uploads.length,1,'angular changes reuse geometry and surface receivers');
    assert.equal(f.mount.debugState().frame.directions,count);
  }
  assert.equal(f.mount.debugState().frame.angularCache.visibilityPreparations,3,'returning to a retained count reuses its exact visibility');
  assert.deepEqual(f.mount.debugState().frame.angularCache.counts,[24,12,16]);
  f.mount.setRetainComparisons(false);f.prepare();
  assert.deepEqual(f.mount.debugState().frame.angularCache.counts,[12],'explicitly leaving comparison mode releases other states');
  f.mesh.position.x=.5;f.prepare();
  assert.equal(f.uploads.length,2,'geometry change invalidates all angular states');
  assert.deepEqual(f.mount.debugState().frame.angularCache.counts,[12]);
  f.mount.dispose();
}
if(!selected||selected==='pattern') {
  const f=fixture();f.prepare();
  for(const [pattern,rotation] of [['fixed',.7],['spatial',0],['fixed',0]]) {
    f.mount.setAngularPattern(pattern,rotation);f.prepare();
    const state=f.mount.debugState();
    assert.equal(state.geometryBuilds,1,'angular orientation reuses geometry');
    assert.equal(state.frame.angularPattern,pattern);assert.equal(state.frame.angularRotation,rotation);
    assert.deepEqual(state.frame.angularCache.counts,[24],'new pattern invalidates obsolete first hits');
  }
  assert.equal(f.mount.debugState().frame.angularCache.visibilityPreparations,4);
  f.mount.dispose();
}
if(!selected||selected==='softness') {
  const f=fixture();f.prepare();
  for(const value of [1,4,0,8,0]){
    f.mount.setSourceSoftness(value);f.prepare();
    const state=f.mount.debugState();
    assert.equal(state.sourceSoftness,value);assert.equal(state.frame.sourceSoftness,value);
    assert.equal(f.uploads.length,1,'softness never rebuilds receiver visibility');
    assert.equal(state.frame.sourceSoftening.staticPreparations,1,'source geometry prepared once');
  }
  assert.throws(()=>f.mount.setSourceSoftness(-1),/nonnegative integer/);f.mount.dispose();
}
if(!selected||selected==='sides') {
  const f=fixture();f.mesh.material.side=THREE.DoubleSide;f.prepare();
  assert.equal(f.uploads[0][3],2,'double-sided receiver requests separate opaque hemispheres');
  assert.equal(f.mount.debugState().surfaceReceivers,3,'two-sided receiving must reuse the full-sphere visibility cache');
  f.mesh.material.side=THREE.BackSide;f.mesh.material.needsUpdate=true;f.prepare();
  assert.equal(f.uploads.at(-1)[3],2,'back-only material also computes the opposite receiving hemisphere');
  assert.equal(f.uploads.at(-1)[6],1,'receiving basis stays aligned with the authored normal');
  f.mount.dispose();assert.equal(f.mesh.geometry,f.geometry);
}
if(!selected||selected==='edits') {
  const f=fixture();f.prepare();
  f.mesh.geometry.attributes.position.setX(0,.25);f.mesh.geometry.attributes.position.needsUpdate=true;
  f.mesh.geometry.index.setX(1,2);f.mesh.geometry.index.setX(2,1);f.mesh.geometry.index.needsUpdate=true;
  f.mesh.material.color.setHex(0xff0000);f.mesh.material.side=THREE.DoubleSide;f.mesh.material.needsUpdate=true;
  f.prepare();
  assert.equal(f.mesh.geometry.attributes.position.getX(0),.25,'cache rebuild must preserve current vertex edit');
  assert.equal(f.mesh.geometry.index.getX(1),2,'winding edit must survive rebuilding');
  assert.equal(f.mesh.material.color.getHex(),0xff0000,'material edit must survive rebuilding');
  assert.equal(f.mesh.material.side,THREE.DoubleSide);
  assert.equal(f.uploads.at(-1)[0],.25,'new receiver snapshot reflects geometry edit');
  f.mount.dispose();assert.equal(f.mesh.geometry,f.geometry);assert.equal(f.mesh.material,f.material);
  assert.equal(f.geometry.attributes.position.getX(0),.25);assert.equal(f.material.color.getHex(),0xff0000);
  assert.equal(f.geometry.hasAttribute('sceneReceiverIndex'),false);
  const external=fixture();external.prepare();
  const replacementGeometry=new THREE.BoxGeometry(),replacementMaterial=new THREE.MeshStandardMaterial({color:0xabcdef});
  external.mesh.geometry=replacementGeometry;external.mesh.material=replacementMaterial;external.mount.dispose();
  assert.equal(external.mesh.geometry,replacementGeometry,'disposal preserves intervening geometry replacement');
  assert.equal(external.mesh.material,replacementMaterial,'disposal preserves intervening material replacement');
}
if(!selected||selected==='shared') {
  for(const kind of ['geometry','material'])for(const terminal of ['rebuild','dispose']) {
    const f=fixture();
    const peer=new THREE.Mesh(kind==='geometry'?f.geometry:f.geometry.clone(),kind==='material'?f.material:f.material.clone());
    peer.castShadow=true;f.mesh.parent.add(peer);f.prepare();
    if(kind==='geometry'){f.mesh.geometry.attributes.position.setX(0,.25);f.mesh.geometry.attributes.position.needsUpdate=true;}
    else {f.mesh.material.color.setHex(0xff0000);f.mesh.material.needsUpdate=true;}
    if(terminal==='rebuild')f.prepare();else f.mount.dispose();
    if(kind==='geometry') {
      assert.equal(f.mesh.geometry.attributes.position.getX(0),.25,`${terminal} preserves edited shared geometry`);
      assert.equal(peer.geometry.attributes.position.getX(0),0,'unaffected geometry peer remains unchanged');
      if(terminal==='rebuild')assert.equal(f.uploads.at(-1)[0],.25);
    } else {
      assert.equal(f.mesh.material.color.getHex(),0xff0000,`${terminal} preserves edited shared material`);
      assert.equal(peer.material.color.getHex(),0xffffff,'unaffected material peer remains unchanged');
    }
    if(terminal==='rebuild')f.mount.dispose();
    assert.equal(f.mesh.geometry.hasAttribute('sceneReceiverIndex'),false);
    assert.equal(peer.geometry.hasAttribute('sceneReceiverIndex'),false);
  }
}
if(!selected||selected==='normals') {
  const f=fixture();f.prepare();
  for(let i=0;i<3;i++)f.mesh.geometry.attributes.normal.setZ(i,-1);
  f.mesh.geometry.attributes.normal.needsUpdate=true;f.prepare();
  assert.equal(f.uploads.length,2,'normal edit invalidates uploaded receiver data');
  assert.equal(f.uploads.at(-1)[6],-1,'receiver snapshot contains changed normal');f.mount.dispose();
  const receiver=fixture(false);receiver.prepare();receiver.mesh.position.x=2;receiver.prepare();
  assert.equal(receiver.uploads.length,2,'noncasting receiver movement invalidates receiver snapshot');
  assert.equal(receiver.uploads.at(-1)[0],2);receiver.mount.dispose();
}
if(!selected||selected==='surface-gain'){
  const f=fixture();f.prepare();const before=f.mount.debugState();
  f.mount.setSurfaceGain(4);const after=f.mount.debugState();
  assert.equal(after.surfaceGain,4);assert.equal(after.gain,before.gain,'trim leaves transport master unchanged');
  assert.equal(after.frame,before.frame,'trim cannot rebuild or replace smoke/source transport');
  assert.equal(f.uploads.length,1,'trim preserves static visibility');
  f.mount.setSurfaceGain(0);assert.equal(f.mount.debugState().surfaceGain,0);
  assert.throws(()=>f.mount.setSurfaceGain(NaN));f.mount.dispose();
}
if(!selected||selected==='source-transform'){
  const f=fixture();f.prepare();f.field.source.worldTransform={translate:[2,-1,4],scale:2};f.prepare();
  assert.equal(f.uploads.length,2,'source relocation invalidates relative solid visibility');
  assert.deepEqual(Array.from(f.uploads.at(-1).slice(0,3)),[-1,.5,-2],'world surface positions enter volume-local lighting coordinates');
  f.mesh.position.set(2,-1,4);f.prepare();assert.deepEqual(Array.from(f.uploads.at(-1).slice(0,3)),[0,0,0]);
  f.mount.dispose();assert.equal(f.geometry.attributes.position.getX(0),0,'lighting coordinate conversion cannot mutate authored geometry');
}
console.log('distributed authored-edit and receiver lifecycle contracts passed');

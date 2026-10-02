import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {mountDistributedSceneRadiance} from '../scene-distributed-radiance.mjs';

// Actual local Three geometry/material lifecycle; no GPU arithmetic claim.
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
function fixture(castShadow=true) {
  const uploads=[];
  const pipeline={getBindGroupLayout(){return {};}};
  const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
    queue:{writeBuffer(buffer,offset,data){if(buffer.label==='surface and smoke receivers')uploads.push(new Float32Array(data));},submit(){}},
    createBuffer({label}){return {label,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},
    createShaderModule(){return {};},createComputePipeline(){return pipeline;},createBindGroup(){return {};},
    createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
  let consume;
  const prototype={setSceneMediumSource(){},setSceneSourceFrameConsumer(fn){consume=fn;},setSceneDistributedLightFrame(){}};
  const renderer={library:new THREE.StandardNodeLibrary(),backend:{get(){return {};}}};
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setIndex([0,1,2]);geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial();
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=castShadow;
  const scene=new THREE.Scene();scene.add(mesh);
  const mount=mountDistributedSceneRadiance({renderer,scene,prototype,device,volumeGrid:2});
  const field={source:{status:'encoded',texture:{createView(){return {}; }},localMax:[1,3,1],dimensions:[32,64,32],generation:1,frame:1}};
  return {mesh,mount,geometry,material,uploads,prepare(){consume(field);}};
}
const selected=process.argv[2];
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
console.log('distributed authored-edit and receiver lifecycle contracts passed');

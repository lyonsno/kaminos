import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function viewerFixture() {
  const THREE=await import('../../lib/three.webgpu.js');
  const calls={direct:0,gi:0,settings:[],estimator:[]};
  const context=vm.createContext({document:{hidden:false},Uint8Array,Uint16Array,Float32Array});
  const module=new vm.SourceTextModule(await readFile(new URL('./viewer.js',import.meta.url),'utf8'),{context});
  await module.link(async specifier=>{
    const exports=specifier==='three/webgpu'?THREE:specifier==='three/tsl'?{uniform:value=>({value})}:
      specifier.includes('scene-gi')?{createSceneGI(){}}:await import(specifier);
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const[name,value]of Object.entries(exports))this.setExport(name,value);},{context});
  });
  await module.evaluate();
  const viewer=new module.namespace.MaterialPhotoViewer();
  viewer.scene=new THREE.Scene();viewer.camera=new THREE.PerspectiveCamera(53,1,.001,100);
  viewer.key=new THREE.DirectionalLight();viewer.scene.add(viewer.key,viewer.key.target);
  viewer.renderer={toneMappingExposure:1,render(){calls.direct++;},setSize(){}};
  viewer.pipeline={render(){calls.gi++;}};
  viewer.gi={setSettings(value){calls.settings.push(value);},setEstimatorSettings(value){calls.estimator.push(value);},debugState:()=>({estimator:calls.estimator.at(-1)})};
  viewer.canvas={parentElement:{getBoundingClientRect:()=>({width:400,height:400})}};
  viewer.orbit=new THREE.Vector2();viewer.target=new THREE.Vector2();viewer.current=new THREE.Vector2();
  viewer.textures=[];viewer.mode='original';viewer.map='surface';viewer.useGI=true;
  viewer.aoStrength={value:.5};
  const image={width:2,height:2,data:new Uint8Array(16).fill(255)};
  const depth={width:2,height:2,depth:new Float32Array([1,1,1,1]),mask:new Uint8Array([1,1,1,1]),
    points:new Float32Array([-.5,.5,1,.5,.5,1,-.5,-.5,1,.5,-.5,1]),normals:new Float32Array([0,0,-1,0,0,-1,0,0,-1,0,0,-1]),fovX:1,fovY:1};
  viewer.setImage(image,depth);viewer.setMaterials({maps:{albedo:image,roughness:image,metallic:image,orm:image}});
  return {viewer,calls,THREE,module};
}
test('original remains DoubleSide and uses the same orbit as the depth surface',async()=>{
  const {viewer,THREE}=await viewerFixture();
  assert.equal(viewer.original.material.side,THREE.DoubleSide);
  viewer.orbit.set(.2,.1);viewer.mode='photo';viewer.render();const camera=viewer.camera.position.toArray();
  viewer.mode='original';viewer.render();assert.deepEqual(viewer.camera.position.toArray(),camera);
});
test('relit and inferred share geometry, camera, light, exposure and GI but not image maps',async()=>{
  const {viewer,calls}=await viewerFixture();
  viewer.mode='relit';viewer.render();assert.equal(calls.gi,1);
  assert.equal(viewer.mesh.material,viewer.relitMaterial);assert.equal(viewer.relitMaterial.roughness,.4);assert.equal(viewer.relitMaterial.metalness,0);
  const geometry=viewer.mesh.geometry,camera=viewer.camera.position.toArray(),light=viewer.key.position.toArray();
  viewer.mode='materials';viewer.render();assert.equal(calls.gi,2);
  assert.equal(viewer.mesh.geometry,geometry);assert.deepEqual(viewer.camera.position.toArray(),camera);assert.deepEqual(viewer.key.position.toArray(),light);
  assert.equal(viewer.renderer.toneMappingExposure,1);assert.notEqual(viewer.relitMaterial.map,viewer.physicalMaterial.map);
  viewer.mode='photo';viewer.render();assert.equal(calls.direct,1);assert.equal(calls.gi,2);
});
test('viewer validates full presets atomically, accepts additive metadata and preserves settings on partial edits',async()=>{
  const {viewer,calls}=await viewerFixture();
  assert.equal(typeof viewer.exportPreset,'function');
  viewer.setTuning({gain:2,steps:128,normalPhi:8});viewer.setTuning({radius:.3});
  assert.equal(viewer.getTuning().gain,2);assert.equal(viewer.getTuning().normalPhi,8);
  assert.equal(calls.settings.at(-1).steps,128);assert.equal(calls.estimator.at(-1).normalPhi,8);
  const preset=JSON.parse(JSON.stringify(viewer.exportPreset()));
  const before=JSON.stringify(viewer.exportPreset()),invalids=[
    {...preset,settings:{...preset.settings,steps:1.5}},
    {...preset,settings:{...preset.settings,depthPhi:'0.1'}},
    {...preset,settings:{...preset.settings,screenSpaceSampling:1}},
    {...preset,light:{x:2,y:0}},
    {...preset,camera:{orbit:[NaN,0]}},
  ];
  for(const invalid of invalids){assert.throws(()=>viewer.applyPreset(invalid));assert.equal(JSON.stringify(viewer.exportPreset()),before);}
  viewer.setLightHandle(.3,.4);const chosen=JSON.parse(JSON.stringify(viewer.exportPreset()));
  viewer.setTuning({gain:1});viewer.setLightHandle(0,0);viewer.applyPreset({...chosen,metadata:{future:true}});
  assert.equal(JSON.stringify(viewer.exportPreset()),JSON.stringify(chosen));
});
test('sun stays in the camera-relative front hemisphere and glow is inferred-only',async()=>{
  const {viewer,THREE}=await viewerFixture();
  assert.equal(typeof viewer.setLightHandle,'function');viewer.setLightHandle(.3,.4);
  viewer.orbit.set(.3,.2);viewer.mode='materials';viewer.glow=true;viewer.render();
  const offset=viewer.key.position.clone().sub(viewer.key.target.position).applyQuaternion(viewer.camera.quaternion.clone().invert());
  assert.ok(offset.z>0);assert.equal(viewer.physicalMaterial.emissiveIntensity,1);
  assert.equal(viewer.emissionMap.type,THREE.HalfFloatType);assert.equal(viewer.emissionMap.colorSpace,THREE.NoColorSpace);
  assert.ok(viewer.emissionMap.image.data instanceof Uint16Array);
  viewer.mode='relit';viewer.render();assert.equal(viewer.relitMaterial.emissiveIntensity,0);
  viewer.glow=false;viewer.mode='materials';viewer.render();assert.equal(viewer.physicalMaterial.emissiveIntensity,0);
});
test('presentation records effective geometry, normals, material and light rather than fixed identity flags',async()=>{
  const {viewer}=await viewerFixture();
  viewer.mode='relit';viewer.render();const relit=viewer.presentation();
  assert.equal(relit.physicalbaseline.geometryId,viewer.mesh.geometry.uuid);
  assert.equal(relit.normalsMatchSurface,true);assert.equal(relit.physicalbaseline.relit.roughness,.4);
  assert.equal(relit.physicalbaseline.relit.mapUUID,viewer.photoMaterial.map.uuid);
  assert.ok(relit.light.direction.every(Number.isFinite));
  viewer.mode='materials';viewer.render();const inferred=viewer.presentation();
  assert.equal(inferred.physicalbaseline.geometryId,relit.physicalbaseline.geometryId);
  assert.equal(inferred.physicalbaseline.activeMaterial.mapUUID,viewer.maps.albedo.uuid);
  assert.equal(inferred.physicalbaseline.activeMaterial.roughnessMapUUID,viewer.maps.orm.uuid);
  assert.equal(inferred.emissiveIntensity,0);
  viewer.mesh.geometry.attributes.normal.array=new Float32Array(viewer.surface.normal);
  assert.equal(viewer.presentation().normalsMatchSurface,false);
});

test('ordinary sun drags project roundoff-prone rim positions without rejecting them',async()=>{
  const {viewer}=await viewerFixture();
  for(const [u,v]of [[.88,.158],[.12,.842],[1,1],[0,0],[.3,.4]]) {
    assert.doesNotThrow(()=>viewer.setLightScreenPosition(u,v));
    const light=viewer.getLightHandle();assert.ok(Math.hypot(light.x,light.y)<=1);
    const preset=JSON.parse(JSON.stringify(viewer.exportPreset()));assert.doesNotThrow(()=>viewer.applyPreset(preset));
  }
  const preset=JSON.parse(JSON.stringify(viewer.exportPreset()));preset.light={x:1.001,y:0};
  assert.throws(()=>viewer.applyPreset(preset),/hemisphere/);
});

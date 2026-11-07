import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from '../scene-radiance.mjs';
import * as radiance from '../scene-radiance.mjs';

const library=new THREE.StandardNodeLibrary();
for(const Material of [THREE.MeshStandardMaterial,THREE.MeshPhysicalMaterial]) {
  const original=new Material({color:0x453021,roughness:.73,metalness:.17});
  original.map=new THREE.Texture();
  original.normalMap=new THREE.Texture();
  original.roughnessMap=new THREE.Texture();
  for(const source of [original,library.fromMaterial(original.clone())]) {
    const copy=cloneSceneRadianceMaterial(library,source);
    assert.notEqual(copy,source);
    assert.equal(copy.map,source.map,'authored albedo texture must survive conversion');
    assert.equal(copy.normalMap,source.normalMap);
    assert.equal(copy.roughnessMap,source.roughnessMap);
    assert.equal(copy.color.getHex(),source.color.getHex());
    assert.equal(copy.roughness,source.roughness);
    assert.equal(copy.metalness,source.metalness);
    copy.color.setHex(0xffffff);
    assert.equal(source.color.getHex(),0x453021,'conversion cannot mutate authored color');
  }
}
console.log('scene radiance material contracts passed');
assert.equal(typeof radiance.createClearSceneMedium,'function','withdrawn point-light transport needs a retained zero-depth medium');
const clear=radiance.createClearSceneMedium();
assert.equal(clear.isData3DTexture,true);
assert.deepEqual([clear.image.width,clear.image.height,clear.image.depth],[1,1,1]);
assert.deepEqual(Array.from(clear.image.data),[0],'absent gas has zero optical depth, not zero independent point-light intensity');
assert.equal(clear.format,THREE.RedFormat);assert.equal(clear.type,THREE.FloatType);
clear.dispose();

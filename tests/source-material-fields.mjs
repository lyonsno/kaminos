// kaminos-test: node
// Attribute construction/lifecycle only; actual production TSL is exercised in the native viewer.
import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from '../lib/three.webgpu.js';
import{populateSourceMaterialFields,createSourceFieldMaterial}from'../source-material-fields.mjs';
test('source PBR parameters become vertex fields without palette quantization',()=>{
 const g=new THREE.BufferGeometry(),s={materials:[{color:[.2,.3,.4],roughness:.62,metalness:.999999}],triangles:[{a:[0,0,0],b:[1,0,0],c:[0,0,1],materialIndex:0}]};
 populateSourceMaterialFields(g,s);assert.equal(g.getAttribute('sourceColor').count,3);assert.ok(Math.abs(g.getAttribute('sourceMetalness').getX(0)-.999999)<1e-7);assert.ok(Math.abs(g.getAttribute('sourceRoughness').getX(2)-.62)<1e-7);
 const material=createSourceFieldMaterial({tracing:false});assert.equal(material.colorWrite,true);assert.equal(material.depthWrite,true);assert.ok(material.colorNode&&material.metalnessNode&&material.roughnessNode);material.dispose();g.dispose();
});

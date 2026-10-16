// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createLogSurfaceMask} from '../live-log-surface-mask.mjs';

test('surface summary excludes empty bounding-box corners and interior cells',()=>{
  const sphere=new THREE.SphereGeometry(1,16,12);sphere.computeBoundingBox();
  const mask=createLogSurfaceMask(sphere,sphere.boundingBox,8);
  assert.equal(mask[0],0);assert.equal(mask[7+8*(7+8*7)],0);
  assert.equal(mask[4+8*(4+8*4)],0);
  assert.equal(mask[7+8*(4+8*4)],1);
  assert.ok(mask.some(Boolean));assert.ok(mask.some(value=>value===0));
});

test('triangle interiors contribute even when the cell contains no mesh vertex',()=>{
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,.5,1,0,.5,0,1,.5],3));
  const bounds=new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(1,1,1));
  const mask=createLogSurfaceMask(geometry,bounds,8);
  assert.equal(mask[2+8*(2+8*4)],1);
  assert.equal(mask[7+8*(7+8*4)],0);
  geometry.setDrawRange(0,0);assert.throws(()=>createLogSurfaceMask(geometry,bounds,8),/no intersecting/);
});

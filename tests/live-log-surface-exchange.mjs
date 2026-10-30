// kaminos-test: node
import {liveLogHeatWGSL} from '../live-log-heat-gpu.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createLogSurfaceMask} from '../live-log-surface-mask.mjs';

test('thermal surface cells carry an actual point and outward normal, not an interior centre',()=>{
  const geometry=new THREE.BoxGeometry(2,2,2);geometry.computeBoundingBox();
  const mask=createLogSurfaceMask(geometry,geometry.boundingBox,4);
  assert.ok(mask.samples instanceof Float32Array,'surface exchange requires resident mesh-surface samples');
  assert.equal(mask.samples.length,4**3*8);
  const i=3+4*(1+4*1),s=mask.samples.slice(i*8,i*8+8);
  assert.deepEqual(Array.from(s),[1,-.25,-.25,1,1,0,0,0]);
  assert.equal(mask[1+4*(1+4*1)],0);
  assert.equal(mask.samples[(1+4*(1+4*1))*8+3],0);
});


test('wood samples transported heat without adding an appearance carrier',()=>{
 const source=liveLogHeatWGSL(true);
 const sampling=source.slice(source.indexOf('fn fluidHeat('),source.indexOf('fn surfaceHeat('));
 assert.doesNotMatch(sampling,/base\+2u/,'appearance support cannot become extra heating');
});

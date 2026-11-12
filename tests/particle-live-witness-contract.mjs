// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as witness from '../tools/optical-particles-witness.mjs';
const expected={capacity:50000,acquisitionMode:1,depthMode:1,depthSlices:16,fillExtinction:1};
const state=()=>({backend:'webgpu:apple',gridHeight:{widthCells:8,heightCells:12},worldSmoke:{effective:'off'},opticalParticles:{effective:'world-optical-particles',settings:{...expected},gridAssist:{effective:'current-single-grid-extinction',generation:1}}});
test('single-grid native witness rejects fallback, effective-config drift and missing extinction work',()=>{
 assert.equal(typeof witness.verifySingleGridParticleState,'function','native control verification must inspect the effective route');
 witness.verifySingleGridParticleState(state(),expected);
 const wrongBackend=state();wrongBackend.backend='wasm';assert.throws(()=>witness.verifySingleGridParticleState(wrongBackend,expected),/backend|webgpu/i);
 const wrongGrid=state();wrongGrid.gridHeight.widthCells=10;assert.throws(()=>witness.verifySingleGridParticleState(wrongGrid,expected),/grid|8/i);
 const fallback=state();fallback.opticalParticles.settings.depthSlices=8;assert.throws(()=>witness.verifySingleGridParticleState(fallback,expected),/depthSlices|effective/i);
 const missing=state();missing.opticalParticles.gridAssist.effective='off';assert.throws(()=>witness.verifySingleGridParticleState(missing,expected),/extinction|assist/i);
 const coupled=state();coupled.worldSmoke.effective='one-way-world-field';assert.throws(()=>witness.verifySingleGridParticleState(coupled,expected),/single|coarse|world/i);
});
test('native image verification rejects partial and blank output',()=>{
 assert.equal(typeof witness.verifyParticleImage,'function','native pixel verification is available');
 assert.throws(()=>witness.verifyParticleImage({width:2,height:2,rgba:new Uint8Array(4)}),/size|partial/i);
 assert.throws(()=>witness.verifyParticleImage({width:2,height:2,rgba:new Uint8Array(16)}),/blank/i);
 witness.verifyParticleImage({width:2,height:2,rgba:new Uint8Array([255,100,20,255,0,0,0,255,0,0,0,255,0,0,0,255])});
});

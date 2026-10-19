// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_SMOKE_WGSL} from '../volume-world-smoke.mjs';
// GPU output parity is exercised by world-smoke-contract-witness; these pin the
// work-elision contract, not a performance or external-runtime claim.
test('donor material bypasses evolution that would be overwritten',()=>{
  const body=WORLD_SMOKE_WGSL.slice(WORLD_SMOKE_WGSL.indexOf('fn transportMaterial'));
  assert.ok(body.indexOf('if(donor(p))')<body.indexOf('var r=gas('));
  assert.match(body,/storeMaterial\(c,i,p,r\);return;/);
});
test('the known-empty collision route bypasses voxel traversal and mixing interpolation',()=>{
  assert.match(WORLD_SMOKE_WGSL,/fn clipped[^]*?if\(u.time.w<.5\)\{return q;\}/);
  assert.match(WORLD_SMOKE_WGSL,/neighbors\+=gasCell\(c\+axis\(a\)\).a\+gasCell\(c-axis\(a\)\).a/);
});

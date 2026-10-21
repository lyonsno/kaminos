// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const transfer=readFileSync(new URL('../volume-pressure-resolution.mjs',import.meta.url),'utf8');
test('world timing cannot pass with absent or reversed stage timestamps',async()=>{
  const {worldProfileWindows}=await import('../volume-pressure-resolution.mjs');
  assert.equal(typeof worldProfileWindows,'function');
  assert.deepEqual(worldProfileWindows([1000n,3000n,4000n,7000n]),{flowUs:2,materialUs:3});
  for(const values of [[0n,3000n,4000n,7000n],[1000n,3000n,0n,7000n],[1000n,3000n,4000n,2000n]])assert.equal(worldProfileWindows(values),null);
});
test('open-world pressure, forces and transport share an explicit boundary admission',()=>{
  assert.match(core,/fn openWorldBoundary\(\) -> bool/);
  assert.match(core,/openWorldBoundary\(\) && !insideGrid\(c\)/);
  assert.match(core,/if \(joinedBoundary\(\) \|\| openWorldBoundary\(\)\) \{ return joinedLowerFace/);
  assert.match(core,/let materialWallFade = [^\n]*joinedBoundary\(\) \|\| openWorldBoundary\(\)/);
  assert.match(core,/openWorldAmbient/);
});
test('half pressure carries the lower-face correction and preserves open upper faces',()=>{
  assert.match(transfer,/coarseLower/);
  assert.match(transfer,/fineLower/);
  assert.match(transfer,/shape.bounds.z/);
});
test('exterior march uses quality controls and reports its samples',()=>{
  const start=core.indexOf('if(worldActive && !worldInsideFine(p))');
  assert.ok(start>=0,'locate existing exterior branch');
  const exterior=core.slice(start,start+1800);
  assert.match(exterior,/worldMarchStep/);
  assert.match(exterior,/rayMaterialSamples\s*\+=\s*1u/);
});

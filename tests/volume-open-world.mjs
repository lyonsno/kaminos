// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const transfer=readFileSync(new URL('../volume-pressure-resolution.mjs',import.meta.url),'utf8');
test('full projection timestamps finish on the lower-face correction',()=>{
  assert.match(core,/open \? \{ querySet: options.timestampWrites.querySet, beginningOfPassWriteIndex: options.timestampWrites.beginningOfPassWriteIndex \}/);
  assert.match(core,/openBoundary.encode\(encoder,true,options.timestampWrites/);
});
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
  const start=core.indexOf('if(worldActive && !fineRayInterval)');
  assert.ok(start>=0,'locate existing exterior branch');
  const exterior=core.slice(start,start+1800);
  assert.match(exterior,/worldMarchStep/);
  assert.match(exterior,/rayMaterialSamples\s*\+=\s*1u/);
});
test('fine/world ray ownership uses the intersection interval and clips both transitions',()=>{
  assert.match(core,/let fineRayInterval = nearHit.y > nearHit.x && t >= nearHit.x && t < nearHit.y;/);
  assert.match(core,/let fineSegmentEnd = select\(endT, min\(endT, nearHit.y\), worldActive\);/);
  assert.match(core,/fineSegmentEnd - t/);
  // Review's replayable float32 ray: coordinate membership fails at exact
  // slab entry, whereas interval ownership must evaluate fine before exit.
  const f=Math.fround,ro=[-1.2191815376281738,.0839615985751152,4.962988376617432],
    rd=[.1329101026058197,.05615606904029846,-.989535927772522],
    entry=f(4.0048956871032715),exit=f(6.026045322418213);
  const p=ro.map((v,i)=>f(v+f(rd[i]*entry)));
  assert.ok(p[2]>1);
  assert.ok(f(entry+2.5)>exit,'a coarse step would skip the fine interval');
  const ownsFine=t=>exit>entry&&t>=entry&&t<exit;
  assert.equal(ownsFine(entry),true);
  assert.equal(ownsFine(exit),false);
  assert.equal(ownsFine(entry-0.01),false);
});

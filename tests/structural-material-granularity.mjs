import assert from 'node:assert/strict';
import * as host from '../structural-material-workbench-host.mjs';
assert.equal(typeof host.stoneMaterialParameters,'function','Material granularity needs explicit requested/effective routing');
assert.equal(host.stoneMaterialParameters('').get('inputs'),'./scratch/bounded-fine-inputs');
assert.equal(host.stoneMaterialParameters('?stoneMesh=coarse&stoneFragments=grains').get('inputs'),'./scratch/shard-live-inputs');
assert.equal(host.stoneMaterialParameters('?stoneMesh=coarse&stoneFragments=grains').get('fragments'),'grains');
assert.throws(()=>host.stoneMaterialParameters('?stoneMesh=wrong'),/granularity/);
assert.throws(()=>host.stoneMaterialParameters('?stoneFragments=wrong'),/fragments/);
console.log('Explicit granularity preserves fine default and refuses silent substitution');

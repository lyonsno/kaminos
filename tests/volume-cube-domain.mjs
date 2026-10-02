import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {solidFieldIndex,voxelizeTriangleSolid,packSolidTextureRows} from '../volume-scene-solid.mjs';
import {outerSmokeConfig,outerDonorBounds,outerSmokeShader} from '../volume-outer-smoke.mjs';
const grid=8;
const field=voxelizeTriangleSolid([[[-1,0,-1],[1,0,-1],[1,0,1]]],grid,grid);
assert.equal(field.cells.length,grid**3,'cube collider must allocate cube shape');
assert.equal(solidFieldIndex(grid,1,2,3,grid),1+grid*(2+grid*3),'cube solid stride');
assert.equal(packSolidTextureRows(field.cells,grid,grid).rowsPerImage,grid);
const c=outerSmokeConfig({nearHeightRatio:1});
assert.deepEqual(outerDonorBounds(c).max,[.75,.75,.75],'cube donor must stop below cube top');
assert.match(outerSmokeShader(c,64),/const NEAR_HEIGHT:i32=64;/,'coarse donor addresses cubic fine state');
assert.throws(()=>outerSmokeConfig({nearHeightRatio:1.5}),/near height/);
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const listeners=index.slice(index.indexOf("for (const id of [\n    'volume-emitter-source-law'"));
assert.ok(listeners.slice(0,listeners.indexOf(']) {')).includes("'volume-domain-shape'"),
  'shape changes must have a direct live input/change listener');
console.log('cube domain contracts passed');

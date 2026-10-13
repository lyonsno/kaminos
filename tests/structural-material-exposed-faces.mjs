import assert from 'node:assert/strict';
import * as fragments from '../structural-material-bounded-fragments.mjs';
assert.equal(typeof fragments.packFixedCellFaces,'function','Fixed cell faces need topology-owned exposure');
const positions=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],bonds=mask=>edges.flatMap(([a,b],i)=>[a,b,Number(!(mask&(1<<i))),0]);
const shell=fragments.buildFixedCellShell({positions,tetrahedra:[[0,1,2,3]],bonds:bonds(0)});
for(let mask=0;mask<64;mask++){
 const faces=fragments.visibleFixedCellFaces(shell,bonds(mask)),reference=fragments.buildBoundedFragments({positions,tetrahedra:[[0,1,2,3]],bonds:bonds(mask)});
 assert.equal(faces.length,reference.exteriorTriangles+reference.interiorTriangles,`Exact exposure for mask ${mask}`);
}
const packed=fragments.packFixedCellFaces(shell);assert.equal(packed.faces.byteLength,shell.geometry.exterior.length*32);
assert.equal(fragments.visibleFixedCellFaces(shell,bonds(0)).length,24);
assert.ok(fragments.visibleFixedCellFaces(shell,bonds(63)).length>24);
console.log('GPU exposure descriptors preserve exactly the reference shell under all 64 local damage masks');
const decimal=fragments.buildFixedCellShell({positions:[[.1,.2,.3],[.2,.3,.4],[-.1,.5,.3],[.1,.5,-.2]],tetrahedra:[[0,1,2,3]],bonds:bonds(0)});
assert.doesNotThrow(()=>fragments.packFixedCellFaces(decimal),'Opposed faces match material identity, not floating-coordinate summation order');

// kaminos-test: node
import assert from 'node:assert/strict';
import {buildPolyMesh,classifyEdges} from '../poly-mesh-core.mjs';
import {EDGE_CLASSES,edgeClassSegments} from '../poly-edge-overlay.mjs';

const names=EDGE_CLASSES.map(c=>c.name);
assert.deepEqual(names,['nonManifold','boundary','sharp','flipped','uvSeam']);
assert.equal(new Set(EDGE_CLASSES.map(c=>c.color)).size,names.length,'each class reads in its own colour');

// The fin's shared diagonal is the only non-manifold edge; its segment runs between welded endpoints.
const fin=buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,0,1,1,0,0,1,0,.5,.5,1),indices:Uint32Array.of(0,1,2,0,2,3,0,2,4)});
const finSegments=edgeClassSegments(fin,classifyEdges(fin));
assert.equal(finSegments.nonManifold.length,6);
const endpoints=[[...finSegments.nonManifold.subarray(0,3)],[...finSegments.nonManifold.subarray(3,6)]].map(p=>p.join(',')).sort();
assert.deepEqual(endpoints,['0,0,0','1,1,0']);
assert.equal(finSegments.boundary.length,6*6,'six open edges');
assert.equal(finSegments.sharp.length,0);

// An edge carrying several classes appears in each, so hiding one class never hides another.
// Two triangles fold about 55 degrees along a shared edge, each side in its own atlas island.
const seam=buildPolyMesh({
  positions:Float32Array.of(0,0,0,1,0,0,0,1,0, 0,1,0,1,0,0,1,1,1),
  uvs:Float32Array.of(0,0,.5,0,0,1, .9,1,.9,0,1,1),
  indices:Uint32Array.of(0,1,2,3,4,5)});
const seamFlags=classifyEdges(seam,{sharpAngle:30}),seamSegments=edgeClassSegments(seam,seamFlags);
assert.equal(seamSegments.sharp.length,6,'the folded diagonal is a crease');
assert.equal(seamSegments.uvSeam.length,6,'and a UV seam');
assert.throws(()=>edgeClassSegments(seam,new Uint8Array(1)),/flags/);

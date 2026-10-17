// kaminos-test: node
// The finisher can run the source's cleanup-first order (generate.py's general
// path) on a mesh over target, instead of simplify-first; the trace shows the
// order that ran, and simplify-first stays the default.
import assert from 'node:assert/strict';
import {cleanupAndSimplifyPreservingSurface,createBrowserMeshPostprocess} from '../mesh-cleanup.js';
import {MESH_FINISHING_CASES} from './mesh-finishing-fixture.js';

const spec=MESH_FINISHING_CASES['simplify-route'],{vertices,triangles}=spec.build();
assert.ok(triangles.length/3>spec.targetFaces,'fixture starts over target');
const ops=r=>r.trace.map(t=>t.operation);
const first=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:spec.targetFaces});
assert.equal(ops(first)[0],'simplify_first','simplify-first stays the default');
const clean=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:spec.targetFaces,order:'cleanup-first'});
assert.equal(ops(clean)[0],'cleanup','cleanup-first cleans before simplifying');
assert.ok(!ops(clean).includes('simplify_first'),'no simplify-first pass');
assert.ok(ops(clean).some(o=>o.startsWith('simplify_')),'it still simplifies');
assert.equal(ops(clean).at(-1),'cleanup_final');
assert.ok(clean.faces.length/3<=spec.targetFaces*1.1,'reaches the target band');
assert.throws(()=>cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:10,order:'sideways'}),/order/);
const out=await createBrowserMeshPostprocess({targetFaces:spec.targetFaces,order:'cleanup-first'})({vertices,triangles,metadata:{}});
assert.equal(out.metadata.postprocess.order,'cleanup-first','the receipt records the order');
assert.equal(out.metadata.postprocess.operationTrace[0].operation,'cleanup');

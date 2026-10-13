// kaminos-test: node
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

assert.ok(existsSync(new URL('../volume-optical-refinement.mjs',import.meta.url)),
  'shared numerical and teacher-informed refinement controller missing');
const {buildOpticalHierarchy,refineOpticalHierarchy}=await import('../volume-optical-refinement.mjs');
const probe=e=>({sigma:0,emission:[e,0,0],scattered:[0,0,0],flags:[0,0]});
const flat=Array.from({length:65},()=>probe(2));
for(const count of [3,5]) {
  const tree=buildOpticalHierarchy(flat,{length:1,rootSpan:32,probeCount:count});
  const numerical=refineOpticalHierarchy(tree,{policy:'numerical',tolerances:[1e-8,1e-8,1e-8,1e-8]});
  assert.equal(numerical.uniqueProbeCount,2*(count-1)+1);
  assert.deepEqual(numerical.transfer,[2,0,0,1]);
  assert.deepEqual(numerical.accepted.map(n=>[n.start,n.end]),[[0,32],[32,64]]);
  assert.equal(numerical.unresolvedLeafCount,0);
}
// Five root probes miss a sheet; the teacher-informed arm has information the estimator lacks.
const thin=Array.from({length:65},()=>probe(0));
thin[5]=probe(8);thin[6]=probe(16);thin[7]=probe(8);
const tree=buildOpticalHierarchy(thin,{length:1,rootSpan:32,probeCount:5});
const loose=[0.001,0.001,0.001,0.001];
const numerical=refineOpticalHierarchy(tree,{policy:'numerical',tolerances:loose});
const teacher=refineOpticalHierarchy(tree,{policy:'teacher-informed',tolerances:loose});
assert.equal(numerical.transfer[0],0);
assert.ok(teacher.uniqueProbeCount>numerical.uniqueProbeCount);
assert.ok(teacher.error[0]<numerical.error[0]);
assert.ok(tree.roots[0].children.length===2);
assert.ok(tree.roots[0].teacherDisagreement.every(Number.isFinite));
assert.throws(()=>buildOpticalHierarchy(flat,{length:1,rootSpan:7,probeCount:5}),/power of two/);
assert.throws(()=>refineOpticalHierarchy(tree,{policy:'unknown',tolerances:loose}),/policy/);
assert.throws(()=>refineOpticalHierarchy(tree,{policy:'numerical',tolerances:[-1,1,1,1]}),/tolerances/);
const split=refineOpticalHierarchy(tree,{policy:'predicted',tolerances:loose,predictError:()=>[1,1,1,1]});
assert.equal(split.uniqueProbeCount,new Set(split.observedIndices).size);
assert.equal(split.uniqueProbeCount,33); // eight leaves, four panels each, shared endpoints
assert.ok(split.unresolvedLeafCount>0);
assert.throws(()=>refineOpticalHierarchy(tree,{policy:'predicted',tolerances:loose,predictError:()=>[NaN,0,0,0]}),/prediction/);
for(const sparse of [new Array(4),[0,,0,0]]) {
  assert.throws(()=>refineOpticalHierarchy(tree,{policy:'predicted',tolerances:loose,predictError:()=>sparse}),/prediction/);
  assert.throws(()=>refineOpticalHierarchy(tree,{policy:'numerical',tolerances:sparse}),/tolerances/);
  assert.throws(()=>refineOpticalHierarchy(tree,{policy:'numerical',tolerances:loose,calibration:sparse}),/calibration/);
}
const clipped=buildOpticalHierarchy(flat.slice(0,49),{length:0.75,rootSpan:32,probeCount:5});
const clippedResult=refineOpticalHierarchy(clipped,{policy:'numerical',tolerances:loose});
assert.deepEqual(clippedResult.accepted.map(n=>[n.start,n.end]),[[0,32],[32,48]]);
assert.deepEqual(clippedResult.transfer,[1.5,0,0,1]);
const unresolved=Array.from({length:65},()=>probe(0));unresolved[5]=probe(32);
const unresolvedResult=refineOpticalHierarchy(buildOpticalHierarchy(unresolved,{length:1,rootSpan:32,probeCount:5}),
  {policy:'teacher-informed',tolerances:loose});
assert.ok(unresolvedResult.unresolvedReferenceCount>0,'an unresolved teacher must not look converged');
console.log('shared refinement, unique probe charging, clipping and unresolved leaves passed');

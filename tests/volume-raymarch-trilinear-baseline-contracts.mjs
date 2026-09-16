import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const raymarchStart = core.indexOf('let startT =');
const raymarchEnd = core.indexOf('let exposed =', raymarchStart);
assert.ok(raymarchStart >= 0 && raymarchEnd > raymarchStart, 'production raymarch body is discoverable');
const raymarch = core.slice(raymarchStart, raymarchEnd);
const rayOrigin = raymarch.slice(0, raymarch.indexOf('var trans ='));
const traversalStart = raymarch.indexOf('let flowKernelReconstructionActive');
const traversalEnd = raymarch.indexOf('let state = reconstructed.velocityDensity', traversalStart);
assert.ok(traversalStart >= 0 && traversalEnd > traversalStart, 'reconstruction/admission boundary is discoverable');
const traversal = raymarch.slice(traversalStart, traversalEnd);

assert.doesNotMatch(rayOrigin, /bonfireSpatialRayDephase|hash31\s*\(/, 'ray origin has no Bonfire-only per-pixel hash texture');
assert.match(rayOrigin, /var t = startT \+ jitter;/, 'every scene starts at the deterministic midpoint of its first ray segment');

assert.match(page, /id="volume-flow-kernel-strength"[^>]*value="0\.00"/, 'ordinary cockpit default is direct trilinear sampling');
assert.doesNotMatch(
  traversal,
  /select\(directCellOpticalSupport\(p\),\s*1\.0,\s*flowKernelReconstructionActive\)/,
  'optional reconstruction cannot globally declare every traversed cell occupied',
);
assert.doesNotMatch(core, /fn flowReconstructionOpticalSupport\b/, 'optional filtering does not become a second authority for material support');
assert.match(
  traversal,
  /let directSupport = directCellOpticalSupport\(p\);[\s\S]*if \(!fullGridCapture && directSupport <= 0\.0001\) \{[\s\S]*directCellExitDistance\(p, rd\)[\s\S]*continue;[\s\S]*var reconstructed: FlowReconstructionSample;[\s\S]*if \(flowKernelReconstructionActive\)/,
  'authoritative center support crosses empty cells before either semantic sampling path runs',
);
assert.match(
  traversal,
  /if \(flowKernelReconstructionActive\) \{[\s\S]*reconstructed = sampleWorldFlowReconstruction\(p\);[\s\S]*\} else \{[\s\S]*reconstructed = sampleWorldFlowReconstructionRaw\(p\);/,
  'explicit reconstruction filters only already-supported samples while zero stays direct trilinear',
);
assert.equal(
  (traversal.match(/sampleWorldFlowReconstruction\(p\)/g) || []).length,
  1,
  'reconstruction-on evaluates the directional kernel exactly once per admitted traversal point',
);
assert.equal(
  (traversal.match(/sampleWorldFlowReconstructionRaw\(p\)/g) || []).length,
  1,
  'reconstruction-off evaluates the trilinear semantic bundle exactly once per admitted occupied point',
);

console.log('volume raymarch trilinear baseline contracts passed');

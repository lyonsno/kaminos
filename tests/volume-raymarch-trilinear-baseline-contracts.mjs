import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function assertRaymarchTrilinearAuthority(core) {
const executableCore = core.replace(/\/\*[\s\S]*?\*\//g, '');
const raymarchStart = executableCore.indexOf('let startT =');
const raymarchEnd = executableCore.indexOf('let exposed =', raymarchStart);
assert.ok(raymarchStart >= 0 && raymarchEnd > raymarchStart, 'production raymarch body is discoverable');
const raymarch = executableCore.slice(raymarchStart, raymarchEnd);
const rayOrigin = raymarch.slice(0, raymarch.indexOf('var trans ='));
const traversalStart = raymarch.indexOf('let flowKernelReconstructionActive');
const traversalEnd = raymarch.indexOf('let state = reconstructed.velocityDensity', traversalStart);
assert.ok(traversalStart >= 0 && traversalEnd > traversalStart, 'reconstruction/admission boundary is discoverable');
const traversal = raymarch.slice(traversalStart, traversalEnd);

assert.doesNotMatch(rayOrigin, /bonfireSpatialRayDephase|hash31\s*\(/, 'ray origin has no Bonfire-only per-pixel hash texture');
assert.match(
  rayOrigin,
  /^let startT = select\(max\(hit\.x, 0\.0\), 0\.0, fullGridCapture\);\s*let endT =/,
  'ray origin start distance must be the unmodulated box entry',
);
assert.match(rayOrigin, /var t = startT \+ jitter;/, 'every scene starts at the deterministic midpoint of its first ray segment');
const rawSampler = balancedWgslBlock(executableCore, 'fn sampleWorldFlowReconstructionRaw(', {
  label: 'direct trilinear semantic sampler',
});
const rawMaterialCallee = balancedWgslBlock(executableCore, 'fn sampleWorldMaterial(', {
  label: 'direct trilinear material callee',
});
assert.match(
  rawMaterialCallee,
  /^fn sampleWorldMaterial\(p: vec3<f32>\) -> vec4<f32> \{\s*let cell = worldToCell\(p\);\s*return sampleFluidSlot\(cell, 1u\);\s*\}$/,
  'raw material callee must preserve direct trilinear field sampling',
);
assert.match(
  rawSampler,
  /^fn sampleWorldFlowReconstructionRaw\(p: vec3<f32>\) -> FlowReconstructionSample \{\s*var sample: FlowReconstructionSample;\s*sample\.velocityDensity = sampleWorldVelocity\(p\);\s*sample\.material = sampleWorldMaterial\(p\);\s*sample\.fireLayer = sampleWorldFireLayer\(p\);\s*sample\.microLayer = sampleWorldMicrodetail\(p\);\s*sample\.kernelTangentRadius = vec4<f32>\(0\.0\);\s*sample\.frontTopology = sampleWorldFrontField\(p\);\s*return sample;\s*\}$/,
  'raw sampler must preserve direct trilinear fields without hidden filtering',
);
const preTraversal = raymarch.slice(0, raymarch.indexOf('  loop {'));
assert.deepEqual(
  [...preTraversal.matchAll(/(?:^|\n)\s*(?:var\s+)?t\s*(?:[+\-*/]?=)/g)].map(match => match[0].trim()),
  ['var t ='],
  'ray origin must have only its deterministic initialization before traversal',
);

assert.match(page, /id="volume-flow-kernel-strength"[^>]*value="0\.00"/, 'ordinary cockpit default is direct trilinear sampling');
assert.doesNotMatch(
  traversal,
  /select\(directCellOpticalSupport\(p\),\s*1\.0,\s*flowKernelReconstructionActive\)/,
  'optional reconstruction cannot globally declare every traversed cell occupied',
);
assert.doesNotMatch(core, /fn flowReconstructionOpticalSupport\b/, 'optional filtering does not become a second authority for material support');
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
const supportAdmission = traversal.slice(
  traversal.indexOf('let directSupport ='),
  traversal.indexOf('var reconstructed: FlowReconstructionSample;'),
);
assert.match(
  supportAdmission,
  /^let directSupport = directCellOpticalSupport\(p\);\s*if \(!fullGridCapture && directSupport <= 0\.0001\) \{\s*let cellExit = directCellExitDistance\(p, rd\);\s*let emptyCellAdvance = mix\(\s*dtBase,\s*max\(dtBase, cellExit \+ 0\.0001\),\s*occupancySkipStrength\s*\);\s*t = t \+ min\(emptyCellAdvance, max\(0\.0001, endT - t\)\);\s*continue;\s*\}\s*$/,
  'one live direct-support skip must own admission before sampling',
);
const sampleBranch = traversal.slice(
  traversal.indexOf('var reconstructed: FlowReconstructionSample;'),
);
assert.match(
  sampleBranch,
  /^var reconstructed: FlowReconstructionSample;\s*if \(flowKernelReconstructionActive\) \{\s*reconstructed = sampleWorldFlowReconstruction\(p\);\s*\} else \{\s*reconstructed = sampleWorldFlowReconstructionRaw\(p\);\s*\}\s*expensiveSamples = expensiveSamples \+ 1u;\s*$/,
  'raw zero route must contain one direct trilinear assignment and no filtering',
);
}

assertRaymarchTrilinearAuthority(core);

const falseClosureMutations = [
  [
    'renamed hash added to first-sample startT',
    source => source
      .replace('fn sampleWorldFlowReconstructionRaw(', 'fn hiddenRayOffset(p: vec3<f32>) -> f32 { return hash31(p) * 0.2; }\n\nfn sampleWorldFlowReconstructionRaw(')
      .replace('let startT = select(max(hit.x, 0.0), 0.0, fullGridCapture);', 'let startT = select(max(hit.x, 0.0), 0.0, fullGridCapture) + hiddenRayOffset(ro);'),
    /ray origin start distance must be the unmodulated box entry/,
  ],
  [
    'forward-backward filtering hidden inside raw sampler',
    source => source.replace('sample.material = sampleWorldMaterial(p);', 'sample.material = 0.5 * sampleWorldMaterial(p) + 0.25 * sampleWorldMaterial(p + vec3<f32>(0.01)) + 0.25 * sampleWorldMaterial(p - vec3<f32>(0.01));'),
    /raw sampler must preserve direct trilinear fields without hidden filtering/,
  ],
  [
    'forward-backward filtering hidden inside raw material callee',
    source => source.replace(
      'fn sampleWorldMaterial(p: vec3<f32>) -> vec4<f32> {\n  let cell = worldToCell(p);\n  return sampleFluidSlot(cell, 1u);\n}',
      'fn sampleWorldMaterial(p: vec3<f32>) -> vec4<f32> {\n  let cell = worldToCell(p);\n  return 0.5 * sampleFluidSlot(cell, 1u) + 0.25 * sampleFluidSlot(worldToCell(p + vec3<f32>(0.01)), 1u) + 0.25 * sampleFluidSlot(worldToCell(p - vec3<f32>(0.01)), 1u);\n}',
    ),
    /raw material callee must preserve direct trilinear field sampling/,
  ],
  [
    'commented decoy skip followed by global support alias',
    source => source
      .replace('    let directSupport = directCellOpticalSupport(p);', '    /*\n    let directSupport = directCellOpticalSupport(p);')
      .replace('    var reconstructed: FlowReconstructionSample;', '    */\n    let directSupport = directCellOpticalSupport(p);\n    let effectiveSupport = select(directSupport, 1.0, flowKernelReconstructionActive);\n    if (!fullGridCapture && effectiveSupport <= 0.0001) { continue; }\n    var reconstructed: FlowReconstructionSample;'),
    /one live direct-support skip must own admission before sampling/,
  ],
  [
    'renamed first-sample hash helper',
    source => source
      .replace('fn sampleWorldFlowReconstructionRaw(', 'fn hiddenRayOffset(p: vec3<f32>) -> f32 { return hash31(p) * 0.2; }\n\nfn sampleWorldFlowReconstructionRaw(')
      .replace('  var t = startT + jitter;', '  var t = startT + jitter;\n  t = t + hiddenRayOffset(ro);'),
    /ray origin must have only its deterministic initialization before traversal/,
  ],
  [
    'hidden filter on raw zero route',
    source => source
      .replace('fn sampleWorldFlowReconstructionRaw(', 'fn hiddenRawFilter(p: vec3<f32>, center: FlowReconstructionSample) -> FlowReconstructionSample { return mixFlowReconstructionSample(center, sampleWorldFlowReconstructionRaw(p + vec3<f32>(0.01)), sampleWorldFlowReconstructionRaw(p - vec3<f32>(0.01)), 0.5); }\n\nfn sampleWorldFlowReconstructionRaw(')
      .replace('      reconstructed = sampleWorldFlowReconstructionRaw(p);', '      reconstructed = sampleWorldFlowReconstructionRaw(p);\n      reconstructed = hiddenRawFilter(p, reconstructed);'),
    /raw zero route must contain one direct trilinear assignment and no filtering/,
  ],
  [
    'dead support skip with live global-occupancy alias',
    source => source
      .replace('    if (!fullGridCapture && directSupport <= 0.0001) {', '    if (false) {\n    if (!fullGridCapture && directSupport <= 0.0001) {')
      .replace('    var reconstructed: FlowReconstructionSample;', '    }\n    let effectiveSupport = select(directSupport, 1.0, flowKernelReconstructionActive);\n    if (!fullGridCapture && effectiveSupport <= 0.0001) { continue; }\n    var reconstructed: FlowReconstructionSample;'),
    /one live direct-support skip must own admission before sampling/,
  ],
];
for (const [name, mutate, expectedFailure] of falseClosureMutations) {
  const mutated = mutate(core);
  assert.notEqual(mutated, core, `${name} mutation must alter source`);
  assert.throws(() => assertRaymarchTrilinearAuthority(mutated), expectedFailure, name);
}

console.log('volume raymarch trilinear baseline contracts passed');

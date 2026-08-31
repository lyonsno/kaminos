#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const loopStart = core.indexOf('let expensiveSampleBudget');
const loopEnd = core.indexOf('let exposed =', loopStart);
const raymarchLoop = core.slice(loopStart, loopEnd);

assert.match(core, /const RAYMARCH_SUPPORT_BRICK_SIZE = 4;/, 'host declares the exact support brick size');
assert.match(core, /fn raymarchSupportBrickGrid\(\) -> u32[\s\S]*GRID \+ RAYMARCH_SUPPORT_BRICK_SIZE - 1u/, 'shader derives a complete ceil-div brick grid');
assert.match(core, /@group\(0\) @binding\(13\) var<storage, read_write> raymarchSupportHierarchy:\s*array<vec4<f32>>/, 'one bound hierarchy carries base support and brick maxima');

const basePass = core.match(/fn csRaymarchSupportBase[\s\S]*?(?=\n@compute)/)?.[0] || '';
assert.match(basePass, /directCellOpticalSupportFromSlots/, 'base support uses the same optical authority as occupied direct-cell reconstruction');
assert.match(basePass, /boundarySidecar\[index3\(gid\)\]/, 'base support carries the baked ridge envelope without per-ray neighbor reconstruction');
assert.match(basePass, /raymarchSupportHierarchy\[raymarchSupportBaseIndex\(gid\)\]\s*=\s*vec4<f32>/, 'base support writes one compact semantic record per native cell');

const brickPass = core.match(/fn csRaymarchSupportBricks[\s\S]*?(?=\n@compute)/)?.[0] || '';
assert.match(brickPass, /RAYMARCH_SUPPORT_BRICK_SIZE \+ 1u/, 'brick reduction includes the positive trilinear halo');
assert.match(brickPass, /supportMax = max\(supportMax, raymarchSupportHierarchy\[raymarchSupportBaseIndex\(cell\)\]\)/, 'brick support is a conservative componentwise maximum');
assert.match(brickPass, /raymarchSupportBrickIndex/, 'brick reduction writes the look-ahead level separately from native-cell support');

const sidecarPass = core.match(/fn csBoundarySidecar[\s\S]*?(?=\n@compute)/)?.[0] || '';
assert.match(sidecarPass, /directCellOpticalSupportFromSlots/, 'the ordinary baked-sidecar pass derives exact optical support during its existing native-cell visit');
assert.match(sidecarPass, /raymarchSupportHierarchy\[raymarchSupportBaseIndex\(gid\)\]/, 'the baked-sidecar pass publishes native support without a redundant full-grid dispatch');

assert.match(core, /raymarchSupportHierarchyBufferBytes/, 'runtime sizes the complete base-plus-brick hierarchy explicitly');
assert.match(core, /raymarchSupportBasePipeline[\s\S]*entryPoint:\s*'csRaymarchSupportBase'/, 'runtime compiles the base support pass');
assert.match(core, /raymarchSupportBrickPipeline[\s\S]*entryPoint:\s*'csRaymarchSupportBricks'/, 'runtime compiles the brick reduction pass');
assert.match(core, /function encodeRaymarchSupportHierarchy[\s\S]*raymarchSupportBasePipeline[\s\S]*raymarchSupportBrickPipeline/, 'one encoder path orders base production before brick reduction');
assert.match(core, /function encodeRaymarchSupportHierarchy[\s\S]*sourceName === 'override'[\s\S]*raymarchSupportBasePipeline/, 'only an applied external sidecar pays the standalone native-support pass');
assert.match(core, /leanStockRaymarchAdmission\([\s\S]*boundarySidecarBuiltThisFrame[\s\S]*flowKernelStrength/, 'lean admission receives sidecar freshness and authored reconstruction state');
assert.doesNotMatch(core, /sourceName !== 'baked' \|\| !state\.boundarySidecarBuiltThisFrame/, 'hierarchy encoding does not discover baked freshness after specialization admission');
assert.match(core, /raymarchSupportBaseEncodedBeforeDraw\.add\(encoder\)/, 'the baked native-support producer binds completion order to the exact command encoder');
assert.match(core, /raymarchSupportBaseEncodedBeforeDraw\.has\(encoder\)/, 'lean admission proves baked base production precedes brick reduction on the exact encoder');
assert.match(core, /const effectiveBindGroup = options\.bindGroup \|\| bindGroups\[currentFluid\][\s\S]*encodeRaymarchSupportHierarchy\(encoder, effectiveBindGroup\)[\s\S]*beginRenderPass/, 'ordinary raymarch builds support from the exact render source before drawing');
assert.match(core, /captureSelectiveHeadLiveFrame[\s\S]*raymarchSupportHierarchy:\s*state\.raymarchSupportHierarchy/, 'external frozen captures disclose the effective hierarchy producer and dimensions');

assert.match(raymarchLoop, /sampleRaymarchSupportBrick\(p\)[\s\S]*raymarchSupportBrickExitDistance\(p, rd\)[\s\S]*continue/, 'a conservatively empty brick advances directly to its exit before native-field reconstruction');
assert.match(raymarchLoop, /sampleRaymarchCellSupport\(p\)[\s\S]*directCellExitDistance\(p, rd\)[\s\S]*continue/, 'an empty native cell advances to its exit through compact support');
const cellExit = core.match(/fn directCellExitDistance[\s\S]*?(?=\nfn sampleRaymarchCellSupport)/)?.[0] || '';
const brickExit = core.match(/fn raymarchSupportBrickExitDistance[\s\S]*?(?=\nfn curlAtCell)/)?.[0] || '';
for (const [label, exitFunction] of [['native cell', cellExit], ['support brick', brickExit]]) {
  assert.match(exitFunction, /let q = \(p \* 0\.5 \+ vec3<f32>\(0\.5\)\) \* f32\(GRID\) - vec3<f32>\(0\.5\)/, `${label} exit derives distance from unclamped ray geometry`);
  assert.match(exitFunction, /let cell = vec3<u32>\(floor\(clamp\(q,/, `${label} exit clamps only the lookup identity`);
  assert.doesNotMatch(exitFunction, /return min\(best, 0\.[24]0\)/, `${label} exit has no arbitrary distance cap`);
}
assert.match(core, /fn raymarchSupportOccupied[\s\S]*max\(support\.x, max\(support\.y, support\.z\)\)/, 'empty skipping requires macro support, boundary coverage, and ridge support all to be absent');
assert.match(raymarchLoop, /directSupportWithRidge[\s\S]*raymarchSupportOccupied\(raymarchCellSupport\)/, 'the legacy direct-support check cannot discard an admitted ridge-only cell');
assert.match(raymarchLoop, /sampleDirectCell\(p\)/, 'occupied cells retain the authoritative direct-cell reconstruction');

assert.match(raymarchLoop, /let ridgeRefinementSampleBudget = min\(16u, max\(4u, u32\(ceil\(steps \* 0\.10\)\)\)\)/, 'ridge refinement receives a small explicit allowance tied to the authored ray budget');
assert.match(raymarchLoop, /let leanExpensiveSampleBudget = expensiveSampleBudget \+ ridgeRefinementSampleBudget/, 'lean traversal names its complete expensive-sample ceiling');
assert.match(raymarchLoop, /let maxTraversalSteps = GRID \* 3u \+ leanExpensiveSampleBudget \+ 3u/, 'traversal safety is bounded by grid crossings plus the complete expensive-sample ceiling');
assert.match(raymarchLoop, /LEAN_STOCK_RAYMARCH && !fullGridCapture && expensiveSamples >= leanExpensiveSampleBudget/, 'lean rendering cannot exceed the explicit nominal-plus-ridge sample budget');
assert.match(raymarchLoop, /let ridgeEnvelope = raymarchCellSupport\.z/, 'local refinement is admitted by ridge support rather than broader boundary coverage');
assert.match(raymarchLoop, /let ridgeRefinementApplied = ridgeRefinementActive && ridgeLocalDt < baseAdaptiveDt[\s\S]*ridgeRefinementSamples = ridgeRefinementSamples \+ select\(0u, 1u, ridgeRefinementApplied\)/, 'only samples whose segment was actually shortened spend the bounded allowance');
assert.doesNotMatch(raymarchLoop, /maxIntegrationSamples/, 'the replacement bound cannot scale hidden expensive work with grid resolution');
assert.match(raymarchLoop, /rayStepOpacity = localDt \* 3\.65/, 'refined segments continue to scale optical depth by their actual length');

const rawReconstruction = core.match(/fn sampleWorldFlowReconstructionRaw[\s\S]*?(?=\nfn flowReconstructionStructure)/)?.[0] || '';
const directReconstruction = core.match(/fn sampleDirectCell[\s\S]*?(?=\nfn directCellExitDistance)/)?.[0] || '';
assert.match(rawReconstruction, /sample\.kernelTangentRadius = vec4<f32>\(0\.0\)/, 'raw zero-kernel reconstruction owns a zero tangent-radius lane');
assert.match(directReconstruction, /sample\.reconstructed\.kernelTangentRadius = vec4<f32>\(0\.0\)/, 'fused direct-cell reconstruction preserves the raw zero-kernel lane exactly');

console.log('volume ridge event raymarch contracts passed');

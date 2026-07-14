import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');

assert.match(core, /BOUNDARY_SPLAT_INSTANCE_DESCRIPTOR_IDENTITY\s*=\s*'boundary-splat-instance-descriptor-v0'/, 'runtime must publish a stable instance descriptor identity');
assert.match(core, /normalizeBoundarySplatInstanceCount/, 'runtime must normalize requested splat instance count explicitly');
assert.match(page, /volume_boundary_splat_instances/, 'operator route must expose boundary splat instance count');
assert.match(page, /volume_boundary_splat_composition/, 'operator route must encode the composed-field camera and layout instead of relying on hidden browser pose state');
assert.match(page, /function frameVolumeCamera\(\)[\s\S]*applyBoundarySplatCompositionCamera[\s\S]*if \(composedCamera\) return/, 'generic smoke framing must not overwrite the composed-field route camera');
assert.match(page, /url-owned-effective-camera-pose/, 'camera telemetry must identify the actual post-controls pose as effective route authority');
assert.match(page, /id="volume-boundary-splat-instances"/, 'operator UI must expose a splat instance control');
assert.match(page, /id="volume-boundary-splat-instances"[^>]*max="128"/, 'operator UI must expose a measured scale-demo range beyond the original four-flame proof');
assert.match(core, /const BOUNDARY_SPLAT_MAX_INSTANCES = 128/, 'runtime must lift the product cap to the measured 128-instance scale-demo ceiling');
assert.match(core, /function boundarySplatInstanceLayout/, 'runtime must generate instance layouts instead of hardcoding four clone positions');
assert.match(core, /BOUNDARY_SPLAT_FIELD_COMPOSITION_IDENTITY\s*=\s*'boundary-splat-composed-field-v0'/, 'runtime must publish a stable composed-field identity');
assert.match(core, /boundarySplatLayoutBounds/, 'runtime telemetry must preserve the effective field bounds');
assert.match(core, /Array\.from\(\{ length: requestedInstanceCount \}/, 'descriptor generation must cover all requested instances up to the measured scale ceiling');

assert.match(core, /boundarySplatInstanceDescriptorBuffer/, 'renderer must own an explicit per-instance descriptor buffer');
assert.match(core, /boundarySplatInstanceDescriptors/, 'WGSL must bind per-instance descriptors rather than hardcoding clone offsets');
assert.match(core, /boundarySplatDraw\.sourceCandidateCount/, 'draw telemetry must preserve source candidate count separately from rendered instance count');
assert.match(core, /const phaseSourceCount = Math\.max\(1, Math\.min\(historyDepth, state\.boundarySplatPhaseSourceCount \|\| 1\)\)/, 'draw telemetry must preserve descriptor-derived effective phase-source count within the requested history depth');
assert.match(core, /let descriptorCount = boundarySplatDrawGroups\[groupIndex\]\.descriptorCount[\s\S]*let groupInstanceCount = effectiveBudget \* descriptorCount/, 'finalize pass must multiply each populated tier candidate count by its explicit descriptor count');
assert.match(core, /sourceCandidateIndex\s*=\s*localInstanceIndex\s*\/\s*descriptorCount/, 'vertex shader must reuse one nested compacted source prefix without CPU readback');
assert.match(core, /descriptorIndex\s*=\s*min\(drawGroup\.descriptorStart \+ \(localInstanceIndex % descriptorCount\)/, 'vertex shader must derive the transformed fire descriptor from its tier-local indirect instance id');
assert.match(core, /let instanceScale = descriptor\.transform\.w;[\s\S]*splat\.shape\.x[\s\S]*instanceScale[\s\S]*splat\.positionSupport\.xyz \* instanceScale/, 'per-instance scale must transform both splat footprint and candidate position');
assert.match(core, /phaseSourceIdentity:\s*'shared-current-control'/, 'runtime telemetry must label the synchronized shared-current control phase source');
assert.match(core, /phaseSourceIdentity:\s*'live-history-offset'/, 'runtime telemetry must reserve truthful live-history phase source identity');
assert.match(core, /boundarySplatIncrementalInstanceCost/, 'runtime telemetry must report incremental per-instance cost proxy');
assert.match(core, /sampleBoundarySplatInstanceCostLadder/, 'runtime must expose a serial GPU instance-cost ladder from the existing live simulation');
assert.match(core, /captureBoundarySplatWitnessFrame/, 'prototype must expose a bounded exact-frame witness pause');
assert.match(core, /resumeBoundarySplatWitnessFrame/, 'prototype must resume the same live render loop after witness capture');
assert.match(core, /const exactDrawState = await sampleBoundarySplatDrawState\(\)/, 'exact-frame pause must bind its screenshot to a direct post-submit GPU draw-state readback');
assert.match(core, /boundarySplatIndirectBuffer = device\.createBuffer\(\{[\s\S]*?usage:\s*GPUBufferUsage\.INDIRECT \| GPUBufferUsage\.COPY_SRC \| GPUBufferUsage\.COPY_DST/, 'physical indirect arguments must be copy-readable by the post-submit witness');
assert.match(core, /async function sampleBoundarySplatDrawState\(\)[\s\S]*?copyBufferToBuffer\(\s*boundarySplatIndirectBuffer,[\s\S]*?const indirectCommand = \{[\s\S]*?vertexCount:\s*indirectState\[0\][\s\S]*?instanceCount:\s*indirectState\[1\][\s\S]*?firstVertex:\s*indirectState\[2\][\s\S]*?firstInstance:\s*indirectState\[3\]/, 'exact-frame witness must read the physical four-word command consumed by drawIndirect');
assert.match(core, /indirectCommandAuthority:\s*'gpu-indirect-command-buffer-post-submit-readback-v0'/, 'draw evidence must identify physical indirect-command readback authority');
assert.match(core, /if \(!indirectCommandAgreement\)[\s\S]*?throw new Error\(`boundary-splat-indirect-command-mismatch:/, 'physical and logical indirect draw state disagreement must fail loud');
assert.match(core, /boundarySplatWitnessExactDrawState = exactDrawState/, 'paused-frame draw state must retain explicit custody until resume');
assert.match(core, /boundarySplatWitnessExactDrawState\.sourceCandidateCount/, 'candidate geometry must size from retained exact draw state rather than ambient throttled telemetry');
assert.match(core, /\(index \* phaseStride\) % historyDepth/, 'large fields must cycle across the truthful history ring instead of saturating almost every flame onto the oldest slot');

assert.match(witness, /duplicateMotionWitness/, 'witness must produce an explicit duplicate-motion diagnostic');
assert.match(witness, /shared-current-control/, 'witness must capture the synchronized shared-current control phase source');
assert.match(witness, /live-history-offset/, 'witness must capture or explicitly mark the truthful live-history offset phase source');
assert.match(witness, /phaseSourceIdentity/, 'witness frames must preserve phase-source identity per instance mode');
assert.match(witness, /motionCorrelation/, 'witness must compute motion correlation so synchronized clones are distinguishable from offset motion');
assert.match(witness, /incrementalInstanceCost/, 'witness must preserve incremental instance cost measurements');

console.log('boundary splat instancing contracts passed');

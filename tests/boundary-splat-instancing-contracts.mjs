import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');

assert.match(core, /BOUNDARY_SPLAT_INSTANCE_DESCRIPTOR_IDENTITY\s*=\s*'boundary-splat-instance-descriptor-v0'/, 'runtime must publish a stable instance descriptor identity');
assert.match(core, /normalizeBoundarySplatInstanceCount/, 'runtime must normalize requested splat instance count explicitly');
assert.match(page, /volume_boundary_splat_instances/, 'operator route must expose boundary splat instance count');
assert.match(page, /id="volume-boundary-splat-instances"/, 'operator UI must expose a splat instance control');
assert.match(page, /id="volume-boundary-splat-instances"[^>]*max="128"/, 'operator UI must expose a measured scale-demo range beyond the original four-flame proof');
assert.match(core, /const BOUNDARY_SPLAT_MAX_INSTANCES = 128/, 'runtime must lift the product cap to the measured 128-instance scale-demo ceiling');
assert.match(core, /function boundarySplatInstanceLayout/, 'runtime must generate instance layouts instead of hardcoding four clone positions');
assert.match(core, /Array\.from\(\{ length: requestedInstanceCount \}/, 'descriptor generation must cover all requested instances up to the measured scale ceiling');

assert.match(core, /boundarySplatInstanceDescriptorBuffer/, 'renderer must own an explicit per-instance descriptor buffer');
assert.match(core, /boundarySplatInstanceDescriptors/, 'WGSL must bind per-instance descriptors rather than hardcoding clone offsets');
assert.match(core, /boundarySplatDraw\.sourceCandidateCount/, 'draw telemetry must preserve source candidate count separately from rendered instance count');
assert.match(core, /const phaseSourceCount = Math\.max\(1, Math\.min\(historyDepth, state\.boundarySplatPhaseSourceCount \|\| 1\)\)/, 'draw telemetry must preserve descriptor-derived effective phase-source count within the requested history depth');
assert.match(core, /candidateCount\s*\*\s*boundarySplatDraw\.requestedInstanceCount/, 'finalize pass must multiply one source candidate count into many rendered instances');
assert.match(core, /sourceCandidateIndex\s*=\s*instanceIndex\s*\/\s*max\(1u,\s*u32\(boundarySplatCamera\.instanceInfo\.y\)\)/, 'vertex shader must reuse one compacted source candidate buffer without CPU readback');
assert.match(core, /fireInstanceIndex\s*=\s*instanceIndex\s*%\s*max\(1u,\s*u32\(boundarySplatCamera\.instanceInfo\.y\)\)/, 'vertex shader must derive the transformed fire index from the indirect instance id');
assert.match(core, /phaseSourceIdentity:\s*'shared-current-control'/, 'runtime telemetry must label the synchronized shared-current control phase source');
assert.match(core, /phaseSourceIdentity:\s*'live-history-offset'/, 'runtime telemetry must reserve truthful live-history phase source identity');
assert.match(core, /boundarySplatIncrementalInstanceCost/, 'runtime telemetry must report incremental per-instance cost proxy');

assert.match(witness, /duplicateMotionWitness/, 'witness must produce an explicit duplicate-motion diagnostic');
assert.match(witness, /shared-current-control/, 'witness must capture the synchronized shared-current control phase source');
assert.match(witness, /live-history-offset/, 'witness must capture or explicitly mark the truthful live-history offset phase source');
assert.match(witness, /phaseSourceIdentity/, 'witness frames must preserve phase-source identity per instance mode');
assert.match(witness, /motionCorrelation/, 'witness must compute motion correlation so synchronized clones are distinguishable from offset motion');
assert.match(witness, /incrementalInstanceCost/, 'witness must preserve incremental instance cost measurements');

console.log('boundary splat instancing contracts passed');

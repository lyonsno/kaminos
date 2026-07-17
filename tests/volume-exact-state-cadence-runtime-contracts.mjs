#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const core = readFileSync(resolve(root, 'volume-core.js'), 'utf8');
const page = readFileSync(resolve(root, 'index.html'), 'utf8');

assert.match(core, /createExactStateCadenceGpuRuntime/, 'volume runtime imports the exact-state GPU cadence substrate');
assert.match(core, /EXACT_STATE_CADENCE_GPU_IDENTITY/, 'volume telemetry names the exact cadence runtime identity');
assert.match(core, /function initializeExactStateCadenceRuntime/, 'volume runtime allocates cadence state only after WebGPU device creation');
assert.match(core, /function destroyExactStateCadenceRuntime[\s\S]*exactStateCadenceRuntime\?\.destroy\(\)/, 'cadence buffers and timers have an explicit destruction path');
assert.match(core, /function rebuildExactStateCadencePresentationBindGroups/, 'presentation owns render, majorant, sidecar, and splat bind groups');
assert.match(core, /presentationFluidBuffer[\s\S]*presentationFrontBuffer/, 'presentation groups consume interpolated buffers instead of the producer ping-pong state');
assert.match(core, /exactStateCadencePresentationBindGroups\s*=\s*\{[\s\S]*render:[\s\S]*majorant:[\s\S]*sidecar:[\s\S]*splat:/, 'all renderer-derived field consumers share the delayed presentation state');
assert.match(core, /async function pumpExactStateCadenceProducer/, 'producer has an independent asynchronous clock');
assert.match(core, /setTimeout\(pumpExactStateCadenceProducer/, 'producer scheduling is decoupled from requestAnimationFrame');
assert.match(core, /planProduction\([\s\S]*encodeSim\(encoder[\s\S]*encodeProductionArchive/, 'one authoritative simulator step is archived into the reserved cadence slot');
assert.match(core, /device\.queue\.submit\(\[encoder\.finish\(\)\]\)[\s\S]*await exactStateCadenceRuntime\.completeProduction/, 'archive authority becomes completed only after submitted GPU work finishes');
assert.match(core, /production\.reason === 'producer-would-overwrite-unpresented-state'[\s\S]*exactStateCadenceProducerBackpressureCount[\s\S]*exactStateCadenceProducerBackpressureReceipt[\s\S]*exactStateCadenceEffective = residentCount >= requiredResidentCount \? 'active' : 'warming'[\s\S]*exactStateCadenceFallbackReason = null/, 'a full truthful ring backpressures production without becoming a fallback or overwriting the last completed producer receipt');
assert.match(core, /function encodeExactStateCadencePresentation[\s\S]*selectPresentation[\s\S]*encodePresentation/, 'RAF presentation selects and interpolates only completed adjacent states');
assert.match(core, /exactStateCadenceEffective[\s\S]*encodeExactStateCadencePresentation[\s\S]*else[\s\S]*encodeSim\(encoder\)/, 'effective cadence presentation replaces the RAF simulation step rather than duplicating it');
assert.match(core, /function resetExactStateCadenceForControlChange[\s\S]*controlGeneration[\s\S]*source-controls-changed/, 'source-control changes invalidate the ring with an explicit generation reset');
const cadenceSourceSignature = core.slice(
  core.indexOf('function exactStateCadenceSimulatorControlValues'),
  core.indexOf('function exactStateCadenceConfigurationSignature'),
);
assert.match(cadenceSourceSignature, /Object\.values\(exactStateCadenceSimulatorControlValues\(snapshot\)\)/, 'cadence generation derives from one named simulator-control normalization path');
for (const simulatorControl of [
  'microdetail',
  'interfaceShred',
  'fireLicks',
  'fireScale',
  'detailScale',
  'plumeHeight',
]) {
  assert.match(
    cadenceSourceSignature,
    new RegExp(`snapshot\\.${simulatorControl}\\b`),
    `${simulatorControl} changes must invalidate resident cadence history before a new generation can interpolate`,
  );
}
assert.match(core, /selective-head-presentation-input-unavailable/, 'cadence refuses learned selective-head routing until that runtime can consume presentation buffers');
assert.match(core, /exactStateCadenceRequested/, 'debug state preserves requested cadence mode');
assert.match(core, /exactStateCadenceEffective/, 'debug state distinguishes requested from effective cadence mode');
assert.match(core, /exactStateCadenceFallbackReason/, 'debug state fails loud when cadence cannot apply');
assert.match(core, /exactStateCadenceProducerReceipt/, 'debug state exposes the latest producer completion receipt');
assert.match(core, /exactStateCadenceProducerBackpressureCount/, 'debug state exposes bounded producer backpressure frequency');
assert.match(core, /exactStateCadenceProducerBackpressureReceipt/, 'debug state exposes the latest truthful no-overwrite refusal');
assert.match(core, /exactStateCadencePresentationReceipt/, 'debug state exposes source steps, slots, alpha, and lead for presentation');
assert.match(core, /exactStateCadenceAddedSimulationPasses:\s*0/, 'cadence telemetry states that it adds no simulator beyond the one authority');

for (const parameter of [
  'volume_exact_state_cadence',
  'volume_cadence_depth',
  'volume_cadence_delay_steps',
  'volume_cadence_producer_ms',
  'volume_cadence_presentation_ms',
]) {
  assert.ok(page.includes(parameter), `operator route carries ${parameter}`);
}
assert.match(page, /exactStateCadenceRequested:\s*routedExactStateCadenceRequested/, 'route request reaches the runtime control snapshot');
assert.match(page, /exactStateCadenceDepth:\s*routedExactStateCadenceDepth/, 'requested depth reaches allocation without a hidden replacement');
assert.match(page, /exactStateCadenceDelaySteps:\s*routedExactStateCadenceDelaySteps/, 'requested delay reaches the presentation contract');
assert.match(page, /exactStateCadenceProducerIntervalMs:\s*routedExactStateCadenceProducerIntervalMs/, 'producer interval remains invocation-scoped route input');
assert.match(page, /exactStateCadencePresentationStepMs:\s*routedExactStateCadencePresentationStepMs/, 'presentation step remains invocation-scoped route input');

console.log('exact-state cadence runtime contracts passed');

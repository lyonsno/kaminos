import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(core, /async function captureBoundarySplatSupervisionFrame/, 'renderer exposes a dedicated fixed-candidate supervision capture');
assert.match(core, /captureBoundarySplatSupervisionFrame[\s\S]*cancelAnimationFrame\(raf\)/, 'supervision capture arrests the live render loop before paired evidence');
assert.match(core, /captureBoundarySplatSupervisionFrame[\s\S]*boundarySplatSupervisionCaptureActive\s*=\s*true/, 'supervision capture suspends live render callbacks before yielding to the GPU queue');
assert.match(core, /function render\(now\)[\s\S]*boundarySplatSupervisionCaptureActive/, 'live render callbacks honor the supervision suspension gate');
assert.match(core, /captureBoundarySplatSupervisionFrame[\s\S]*sameStateCaptureId/, 'supervision capture binds candidate and target evidence to one state identity');
assert.match(core, /captureBoundarySplatSupervisionFrame[\s\S]*boundarySplatMode:\s*'analytic'[\s\S]*boundarySplatFeatureCapture:\s*true/, 'candidate capture explicitly requests analytic attributes and exact live feature rows');
assert.match(core, /captureBoundarySplatSupervisionFrame[\s\S]*sampleFrame\(\{[\s\S]*advanceSim:\s*false[\s\S]*includeBoundarySplatSupervision:\s*true/, 'candidate capture does not advance simulation and requests the uncapped supervision rows');
assert.match(core, /captureBoundarySplatSupervisionFrame[\s\S]*candidateSample\.boundarySplatOverflowCount\s*>\s*0[\s\S]*growBoundarySplatCapacity\(candidateSample\.boundarySplatCandidateCount\)[\s\S]*sampleFrame\(\{[\s\S]*advanceSim:\s*false[\s\S]*includeBoundarySplatSupervision:\s*true/, 'supervision capture grows and rerenders the same frozen state instead of accepting a first-N candidate truncation');
assert.match(core, /captureBoundarySplatSupervisionFrame[\s\S]*boundarySplatMode:\s*'off'[\s\S]*sampleFrame\(\{[\s\S]*advanceSim:\s*false[\s\S]*includeRgba:\s*true/, 'target capture disables splats and reads native raymarch pixels without advancing simulation');
assert.match(core, /fireRenderMode:\s*'stock'[\s\S]*shellInspectMode:\s*'boundary_fire'[\s\S]*boundarySplatSupervisionFireOnlyTargetActive\s*=\s*true[\s\S]*includeRgba:\s*true/, 'target capture explicitly selects stock-fire radiance, baked boundary-fire support, and the fire-only raymarch decomposition');
assert.match(core, /directFlameSupervisionContribution[\s\S]*mix\(standardRadianceContribution, directFlameSupervisionContribution, supervisionFireOnlyTarget\)/, 'capture-only target accumulates direct flame emission instead of inheriting smoke/local shading');
assert.match(core, /directFlameUnitEmission\s*=\s*fireRadianceEmission\([\s\S]*1\.0,\s*0\.0\)/, 'capture-only direct emission uses an intrinsic unit-gain flame signal instead of the operator-facing radiance and glow controls');
assert.match(core, /directFlameCandidateFireSignal\s*=\s*flame\s*\*\s*1\.25[\s\S]*flameDetail\s*\*\s*0\.52[\s\S]*combustionFront\s*\*\s*0\.86[\s\S]*fireLick\s*\*\s*0\.72[\s\S]*heat\s*\*\s*0\.24/, 'capture-only target reuses the exact live splat candidate fire signal');
assert.match(core, /directFlameCandidateStructuralSignal\s*=\s*directFlameCandidateSidecar\.z\s*\*\s*smoothstep\(0\.055,\s*0\.32,\s*directFlameCandidateSidecar\.y\)[\s\S]*smoothstep\(0\.018,\s*0\.16,\s*directFlameCandidateFireSignal\)/, 'capture-only target reuses the exact live splat candidate structural signal');
assert.match(core, /directFlameCandidateSupport\s*=\s*directFlameCandidateStructuralSignal\s*\*\s*step\(0\.11,\s*directFlameCandidateStructuralSignal\)/, 'capture-only target applies the exact live splat candidate threshold');
assert.match(core, /directFlameSupervisionContribution\s*=\s*stockRenderMode\s*\*\s*directFlameCandidateAlpha\s*\*\s*directFlameUnitEmission/, 'capture-only direct emission is gated by exact candidate support rather than permissive inspect-body authority');
assert.match(core, /directFlameSupervisionExtinction[\s\S]*mix\(standardExtinctionStep, directFlameSupervisionExtinction, supervisionFireOnlyTarget\)/, 'capture-only target advances transmittance from flame authority rather than hidden smoke extinction');
assert.match(core, /supervisionFireOnlyTarget[\s\S]*smokeAlpha\s*=\s*smokeAlpha\s*\*/, 'fire-only supervision suppresses smoke extinction inside the native raymarch rather than post-processing pixels');
assert.match(core, /candidateSample\.boundarySplatRendererIdentity\s*!==\s*BOUNDARY_SPLAT_RENDERER_IDENTITY/, 'supervision capture rejects a substituted candidate renderer');
assert.match(core, /targetSample\.volumeReconstructionStyle\s*===\s*BOUNDARY_SPLAT_RENDERER_IDENTITY/, 'supervision capture rejects a splat target pretending to be raymarch');
assert.match(core, /candidateSample\.boundarySplatCandidateCount\s*!==\s*candidateSample\.boundarySplatSupervisionCapture\.rowCount/, 'supervision capture rejects partial candidate rows');
assert.match(core, /candidateSample\.simStepCount\s*!==\s*targetSample\.simStepCount/, 'supervision capture rejects candidate and raymarch evidence from different simulation states');
assert.doesNotMatch(core, /targetSample\.simStepCount\s*!==\s*baseSimStepCount/, 'a pre-capture diagnostic counter cannot invalidate an internally identical candidate-target pair');
assert.match(core, /cameraRight:\s*Array\.from\(/, 'supervision camera metadata includes the exact billboard right basis used by the rasterizer');
assert.match(core, /cameraUp:\s*Array\.from\(/, 'supervision camera metadata includes the exact billboard up basis used by the rasterizer');
assert.match(core, /splatControls:[\s\S]*radius:[\s\S]*sharpness:/, 'supervision metadata records the effective splat footprint controls required for differentiable replay');
assert.match(
  core,
  /const effectiveEmitterSource = getPrimitiveSource\(\);[\s\S]*controlConditioning:[\s\S]*inputRadius:\s*effectiveEmitterSource\.radius[\s\S]*flowRate:\s*effectiveEmitterSource\.flowRate/,
  'conditioning records the effective primitive-backed emitter rather than UI controls that the simulator may ignore',
);
assert.doesNotMatch(
  core,
  /controlConditioning:[\s\S]{0,700}inputRadius:\s*clampFinite\(controlsBefore\.inputRadius|controlConditioning:[\s\S]{0,700}flowRate:\s*clampFinite\(controlsBefore\.flowRate/,
  'effective emitter conditioning cannot silently fall back to shadowed UI radius or flow',
);
assert.match(core, /controlsSnapshot\s*=\s*controlsBefore[\s\S]*resetTemporalHistory\('fixed-candidate-supervision-restore'\)/, 'supervision capture restores controls after success or failure');
assert.match(core, /boundarySplatSupervisionCaptureActive\s*=\s*false[\s\S]*requestAnimationFrame\(render\)/, 'supervision capture releases the live-render suspension before optionally resuming animation');
assert.match(core, /boundarySplatSupervisionFireOnlyTargetActive\s*=\s*false/, 'supervision capture always releases the fire-only target override');
assert.match(core, /captureBoundarySplatSupervisionFrame,/, 'fixed-candidate supervision capture is exported on the live prototype');

console.log('boundary splat supervision live contracts passed');

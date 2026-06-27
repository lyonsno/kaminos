import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /ApertureTangencyWitnessPlan/, 'composition names aperture tangency witness plan');
assert.match(core, /ApertureTangencySample/, 'composition names aperture tangency samples');
assert.match(core, /makeApertureTangencyVectorGeometry/, 'composition renders aperture tangency vector geometry');
assert.match(core, /frameApertureTangencyWitness/, 'composition can frame aperture tangency witness');
assert.match(core, /enableApertureTangencyWitness/, 'composition can enable aperture tangency overlay witness');
assert.match(witness, /aperture-tangency/, 'composition witness supports aperture-tangency focus');
assert.match(witness, /apertureTangencyWitnessPlan/, 'composition witness reports aperture tangency plan');
assert.match(witness, /apertureTangencySampleCount/, 'composition witness reports aperture tangency sample count');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({ variantId: 'wide-cup', variationSeed: 7 });
const tangencyPlan = fixture.macroFamilySubstripPlan?.apertureTangencyWitnessPlan;
const terminationPlan = fixture.macroFamilySubstripPlan?.apertureRelativeTerminationPlan;

assert.equal(tangencyPlan?.schema, 'ApertureTangencyWitnessPlan', 'fixture exposes aperture tangency witness plan');
assert.equal(tangencyPlan.mode, 'aperture-tangency-witness-v0', 'tangency witness records first diagnostic mode');
assert.equal(tangencyPlan.measuredApertureFieldId, terminationPlan.apertureField.id, 'tangency witness measures the active termination field');
assert.equal(tangencyPlan.measuredApertureSourceId, 'primary-front-teardrop-void', 'tangency witness names the visible blue aperture source');
assert.equal(tangencyPlan.visualOverlayMode, 'terminal-and-orbit-tangent-rays', 'tangency witness declares vector overlay mode');
assert.equal(tangencyPlan.sampleCount, fixture.macroFamilySubstripPlan.substripCount, 'one tangency sample per visible substrip');
assert.ok(tangencyPlan.samples.every(sample => sample.schema === 'ApertureTangencySample'), 'all tangency samples use sample schema');
assert.ok(tangencyPlan.samples.every(sample => sample.terminalPoint?.length === 3), 'samples include terminal points');
assert.ok(tangencyPlan.samples.every(sample => sample.terminalTangent?.length === 3), 'samples include terminal tangents');
assert.ok(tangencyPlan.samples.every(sample => sample.apertureOrbitTangent?.length === 3), 'samples include aperture orbit tangents');
assert.ok(tangencyPlan.samples.every(sample => Number.isFinite(sample.tangentOrbitAlignment)), 'samples include measured tangent alignment');
assert.ok(tangencyPlan.samples.every(sample => Number.isFinite(sample.tangentOrbitAngleRadians)), 'samples include measured tangent angle');
assert.ok(tangencyPlan.samples.every(sample => Number.isFinite(sample.captureRadiusError)), 'samples include measured capture radius error');
assert.ok(tangencyPlan.samples.every(sample => sample.requestedTerminationClass), 'samples preserve requested class separately from measurement');

const orbitSamples = tangencyPlan.samples.filter(sample => sample.requestedTerminationClass === 'orbit-capture');
const bladeSamples = tangencyPlan.samples.filter(sample => sample.requestedTerminationClass === 'counter-curve-blade');

assert.ok(orbitSamples.length >= 2, 'orbit-capture family contributes multiple measured samples');
assert.ok(bladeSamples.length >= 1, 'counter-curve blade family contributes measured samples');
assert.ok(orbitSamples.every(sample => sample.classVerdict === 'measured-orbit-capture-coupling' || sample.classVerdict === 'orbit-capture-request-not-yet-geometrically-proven'), 'orbit samples expose honest measured verdicts');
assert.ok(bladeSamples.every(sample => sample.classVerdict === 'measured-counter-curve-refusal' || sample.classVerdict === 'counter-curve-request-not-yet-geometrically-proven'), 'blade samples expose honest measured verdicts');
assert.ok(bladeSamples.some(sample => sample.ownsFurthestVisibleTip), 'blade witness identifies lead tip owner');
assert.ok(tangencyPlan.failureModes.includes('pretty-geometry-without-aperture-coupling'), 'tangency witness preserves false-closure failure mode');
assert.ok(tangencyPlan.overlayGeometryIds.some(id => id.includes('terminal-tangent')), 'overlay ids include terminal tangent rays');
assert.ok(tangencyPlan.overlayGeometryIds.some(id => id.includes('aperture-orbit-tangent')), 'overlay ids include aperture orbit tangent rays');

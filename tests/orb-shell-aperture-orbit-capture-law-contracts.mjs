import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /ApertureOrbitCaptureLaw/, 'composition core must name the macro-level aperture orbit capture law');
assert.match(core, /ApertureOrbitLane/, 'composition core must name aperture orbit lanes');
assert.match(core, /MacroApertureTerminalRole/, 'composition core must name macro terminal role records');
assert.match(core, /ApertureOrbitCaptureWitnessPlan/, 'composition core must expose a macro-level capture witness plan');
assert.match(witness, /aperture-orbit-capture/, 'headless witness must support aperture orbit capture focus');
assert.match(witness, /apertureOrbitCaptureLaw/, 'headless witness must report aperture orbit capture law');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

const law = fixture.apertureOrbitCaptureLaw;
assert.equal(law?.schema, 'ApertureOrbitCaptureLaw', 'fixture exposes macro-level aperture orbit capture law');
assert.equal(law.mode, 'macro-aperture-orbit-capture-v0', 'law records first macro capture mode');
assert.equal(law.sourceApertureId, 'primary-front-teardrop-void', 'law is anchored to the visible primary aperture');
assert.ok(law.failureModes.includes('floating-strip-without-aperture-destination'), 'law preserves the false-closure failure it blocks');

const laneIds = law.orbitLanes.map(lane => lane.id);
assert.ok(laneIds.includes('front-primary-orbit'), 'law exposes front primary orbit lane');
assert.ok(laneIds.includes('outer-capture-lane'), 'law exposes outer capture lane');
assert.ok(laneIds.includes('inner-return-lane'), 'law exposes inner return lane');
assert.ok(law.orbitLanes.every(lane => lane.schema === 'ApertureOrbitLane'), 'all lanes use aperture orbit lane schema');
assert.ok(law.orbitLanes.every(lane => lane.center?.length === 3 && lane.radius?.length === 2), 'all lanes carry center and ellipse radius');

assert.equal(law.terminalRoles.length, fixture.macroAssemblages.length, 'law assigns one terminal role to every macro assemblage');
const roleByParent = new Map(law.terminalRoles.map(role => [role.parentAssemblage, role]));
for (const assemblage of fixture.macroAssemblages) {
  const role = roleByParent.get(assemblage.id);
  assert.equal(role?.schema, 'MacroApertureTerminalRole', `${assemblage.id} has a macro terminal role`);
  assert.ok(['orbit-tangent', 'underpass-return', 'socket-latch', 'rim-segment', 'counter-curve'].includes(role.terminalRole), `${assemblage.id} has a known terminal role`);
  assert.ok(laneIds.includes(role.targetLaneId), `${assemblage.id} targets a declared aperture lane`);
  assert.ok(role.terminalSpan[0] >= 0.52 && role.terminalSpan[0] < role.terminalSpan[1], `${assemblage.id} records a terminal span`);
  assert.ok(role.targetPoint?.length === 3 && role.targetPoint.every(Number.isFinite), `${assemblage.id} records finite target point`);
  assert.ok(role.targetTangent?.length === 3 && role.targetTangent.every(Number.isFinite), `${assemblage.id} records finite target tangent`);
  assert.ok(role.overlayGeometryIds.some(id => id.includes('target-tangent')), `${assemblage.id} has a target tangent overlay id`);
  assert.equal(assemblage.apertureOrbitCapture?.id, role.id, `${assemblage.id} has attached aperture orbit capture role`);
  assert.equal(assemblage.macroPromotedBody?.apertureOrbitCapture?.id, role.id, `${assemblage.id} promoted body has attached aperture orbit capture role`);
}

const roleClasses = new Set(law.terminalRoles.map(role => role.terminalRole));
assert.ok(roleClasses.has('orbit-tangent'), 'at least one macro is captured by an aperture orbit');
assert.ok(roleClasses.has('underpass-return') || roleClasses.has('socket-latch'), 'at least one macro is assigned a non-floating underpass/socket destination');
assert.ok(roleClasses.has('counter-curve'), 'at least one macro deliberately refuses orbit capture as counter-curve');

const witnessPlan = fixture.apertureOrbitCaptureWitnessPlan;
assert.equal(witnessPlan?.schema, 'ApertureOrbitCaptureWitnessPlan', 'fixture exposes macro-level capture witness plan');
assert.equal(witnessPlan.measuredLawId, law.id, 'witness measures the macro-level capture law');
assert.equal(witnessPlan.sampleCount, law.terminalRoles.length, 'witness includes one sample per macro role');
assert.ok(witnessPlan.overlayGeometryIds.some(id => id.includes('orbit-lane')), 'witness exposes orbit lane overlay ids');
for (const sample of witnessPlan.samples) {
  assert.equal(sample.schema, 'MacroApertureTerminalCaptureSample', `${sample.parentAssemblage} witness sample schema`);
  assert.ok(Number.isFinite(sample.tangentOrbitAlignment), `${sample.parentAssemblage} records tangent alignment`);
  assert.ok(Number.isFinite(sample.captureRadiusError), `${sample.parentAssemblage} records capture radius error`);
  assert.ok(sample.roleVerdict, `${sample.parentAssemblage} records role verdict`);
}

const orbitSamples = witnessPlan.samples.filter(sample => sample.terminalRole === 'orbit-tangent');
assert.ok(orbitSamples.some(sample => sample.tangentOrbitAlignment >= 0.6), 'at least one orbit-tangent macro approaches lane tangent alignment');

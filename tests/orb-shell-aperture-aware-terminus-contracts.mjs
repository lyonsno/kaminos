import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /ApertureAwareTerminusPlan/, 'composition names aperture-aware terminus plan');
assert.match(core, /ApertureAwareTerminus/, 'composition names aperture-aware terminus records');
assert.match(witness, /apertureAwareTerminusPlan/, 'witness reports aperture-aware terminus plan');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fixture = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 11,
});

const substripPlan = fixture.macroFamilySubstripPlan;
const terminusPlan = substripPlan?.apertureAwareTerminusPlan;
const primaryVoid = fixture.AperturePressure.primaryVoids[0];
const allowedRoles = new Set(['orbit-tangent', 'socket-latch', 'underpass-return', 'counter-curve', 'rim-segment']);

assert.equal(terminusPlan?.schema, 'ApertureAwareTerminusPlan', 'substrip plan exposes aperture-aware terminus plan');
assert.equal(terminusPlan.mode, 'aperture-aware-terminus-v0', 'terminus plan records first contour-relative mode');
assert.equal(terminusPlan.sourceApertureId, primaryVoid.id, 'terminus plan names the final visible aperture contour source');
assert.deepEqual(terminusPlan.sourceApertureRadius, primaryVoid.radius, 'terminus plan consumes the final varied non-circular socket contour');
assert.equal(terminusPlan.recordCount, terminusPlan.records.length, 'terminus plan record count matches records');
assert.equal(terminusPlan.recordCount, substripPlan.substrips.length, 'first slice assigns one aperture-aware end terminus per rendered substrip');
assert.ok(terminusPlan.failureModes.includes('generic-strip-cap-without-contour-destiny'), 'terminus plan preserves generic cap false-closure pressure');
assert.ok(terminusPlan.failureModes.includes('role-label-without-rendered-terminus-consumer'), 'terminus plan blocks high-level-only law closure');

const recordsBySubstrip = new Map(terminusPlan.records.map(record => [record.sourceSubstripId, record]));
const roles = new Set(terminusPlan.records.map(record => record.terminusRole));

assert.ok(roles.has('orbit-tangent'), 'rendered termini include an orbit-tangent contour destiny');
assert.ok(roles.has('counter-curve'), 'rendered termini include a counter-curve contour destiny');
assert.ok(
  roles.has('socket-latch') || roles.has('underpass-return'),
  'rendered termini include a tuck/latch contour destiny rather than only visible tips',
);

for (const substrip of substripPlan.substrips) {
  const record = recordsBySubstrip.get(substrip.id);
  assert.equal(record?.schema, 'ApertureAwareTerminus', `${substrip.id} has an aperture-aware terminus record`);
  assert.equal(record.sourceSubstripId, substrip.id, `${substrip.id} record points back to rendered substrip`);
  assert.equal(record.parentAssemblage, substrip.parentAssemblage, `${substrip.id} record preserves parent`);
  assert.ok(allowedRoles.has(record.terminusRole), `${substrip.id} has a known contour-relative terminus role`);
  assert.equal(record.sourceApertureId, primaryVoid.id, `${substrip.id} terminus names the visible aperture`);
  assert.deepEqual(record.sourceApertureRadius, primaryVoid.radius, `${substrip.id} terminus consumes final varied socket contour`);
  assert.ok(record.targetPoint?.length === 3 && record.targetPoint.every(Number.isFinite), `${substrip.id} terminus has finite target point`);
  assert.ok(record.targetTangent?.length === 3 && record.targetTangent.every(Number.isFinite), `${substrip.id} terminus has finite target tangent`);
  assert.ok(record.terminalBlendSpan?.[0] >= 0.5 && record.terminalBlendSpan[0] < record.terminalBlendSpan[1], `${substrip.id} terminus records active blend span`);
  assert.ok(record.renderedGeometryIds.includes(substrip.terminalCaps[1].id), `${substrip.id} end cap is a rendered consumer of aperture-aware terminus`);
  assert.ok(record.witnessGeometryIds.some(id => id.includes('target-tangent')), `${substrip.id} terminus has a target tangent witness id`);
  assert.equal(substrip.apertureAwareTerminus?.id, record.id, `${substrip.id} carries attached aperture-aware terminus`);
  assert.equal(substrip.terminalCaps[1].apertureAwareTerminus?.id, record.id, `${substrip.id} end cap carries attached aperture-aware terminus`);
  assert.equal(
    substrip.terminalCaps[1].terminalPlane,
    record.terminalPlane,
    `${substrip.id} end cap terminal plane is governed by the aperture-aware terminus`,
  );
}

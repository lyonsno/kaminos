import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /ApertureAwareTerminusPlan/, 'composition names aperture-aware terminus plan');
assert.match(core, /ApertureAwareTerminus/, 'composition names aperture-aware terminus records');
assert.match(core, /ApertureAwareTerminusRenderConsumer/, 'composition names rendered aperture-aware terminus consumers');
assert.match(core, /geometry\.userData\.ApertureAwareTerminus/, 'terminal-cap geometry exposes aperture-aware terminus consumer records');
assert.match(core, /capMesh\.userData\.ApertureAwareTerminusRenderConsumer/, 'terminal-cap mesh exposes aperture-aware terminus consumer records');
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

function pointDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

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
  const endCap = substrip.terminalCaps[1];
  assert.ok(record.renderedGeometryIds.includes(endCap.id), `${substrip.id} end cap is a rendered consumer of aperture-aware terminus`);
  assert.ok(record.witnessGeometryIds.some(id => id.includes('target-tangent')), `${substrip.id} terminus has a target tangent witness id`);
  assert.equal(substrip.apertureAwareTerminus?.id, record.id, `${substrip.id} carries attached aperture-aware terminus`);
  assert.equal(endCap.apertureAwareTerminus?.id, record.id, `${substrip.id} end cap carries attached aperture-aware terminus`);
  assert.equal(
    endCap.terminalPlane,
    record.terminalPlane,
    `${substrip.id} end cap terminal plane is governed by the aperture-aware terminus`,
  );
  assert.equal(endCap.geometryKind, 'aperture-contour-aware-substrip-end-cap', `${substrip.id} end cap declares contour-aware rendered geometry`);
  assert.equal(endCap.apertureAwareRenderConsumer?.schema, 'ApertureAwareTerminusRenderConsumer', `${substrip.id} end cap exposes rendered consumer contract`);
  assert.equal(endCap.apertureAwareRenderConsumer.recordId, record.id, `${substrip.id} rendered consumer points at the aperture-aware terminus`);
  assert.equal(endCap.apertureAwareRenderConsumer.role, record.terminusRole, `${substrip.id} rendered consumer preserves role destiny`);
  assert.equal(endCap.apertureAwareRenderConsumer.sourceApertureId, primaryVoid.id, `${substrip.id} rendered consumer preserves contour source`);
  assert.ok(endCap.apertureAwareRenderConsumer.targetContourPull > 0, `${substrip.id} rendered consumer records positive contour pull`);
  assert.ok(endCap.apertureAwareRenderConsumer.terminalTangentAlignment > 0.12, `${substrip.id} rendered consumer aligns with terminal tangent`);
  assert.ok(
    pointDistance(
      endCap.apertureAwareRenderConsumer.genericCapSamples.outerMid,
      endCap.apertureAwareRenderConsumer.shapedCapSamples.outerMid,
    ) > 0.004,
    `${substrip.id} rendered end cap outerMid moved from generic cap toward contour destiny`,
  );
  assert.deepEqual(
    endCap.capSamples.outerMid,
    endCap.apertureAwareRenderConsumer.shapedCapSamples.outerMid,
    `${substrip.id} live cap samples are the contour-shaped samples consumed by the mesh builder`,
  );
}

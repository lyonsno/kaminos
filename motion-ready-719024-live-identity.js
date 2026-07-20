import assert from 'node:assert/strict';

export function assertMotionReady719024EffectiveIdentity(debug, expected) {
  const effective = debug?.effective || {};
  const railEvidence = effective.locomotionRailEvidence || {};
  const railContinuity = effective.locomotionRailContinuity || {};
  const effectiveIdentity = {
    castId: effective.castId,
    castHash: effective.castHash,
    registrationHash: effective.registrationHash,
    deformationMode: effective.deformationMode,
    hillSource: effective.hillSourceRef,
    hillAuthority: effective.hillAuthority,
    hillIdentityProjection: effective.hillIdentityProjection,
    hillChecksums: effective.hillChecksums,
    routePlanId: effective.routePlanId,
    routeProfile: effective.routeProfile,
    transitionAdmission: effective.transitionAdmission,
    locomotionRailId: effective.locomotionRailId,
    locomotionRailSchema: effective.locomotionRailSchema,
    locomotionRailAuthority: effective.locomotionRailAuthority,
    locomotionRailLength: effective.locomotionRailLength,
    locomotionRailSampleCount: effective.locomotionRailSampleCount,
    locomotionRailEvidence: railEvidence,
    locomotionRailContinuity: railContinuity,
  };

  assert.equal(effectiveIdentity.castId, expected.castId, 'effective cast ID does not match requested cast ID');
  assert.equal(effectiveIdentity.castHash, expected.castHash, 'effective cast hash does not match requested cast hash');
  assert.equal(effectiveIdentity.registrationHash, expected.registrationHash, 'effective registration hash does not match requested registration hash');
  assert.equal(effectiveIdentity.hillSource, expected.hillSource, 'effective Hill source does not match requested Hill source');
  assert.equal(effectiveIdentity.deformationMode, 'axial-parallel-transport-wave-v1', 'unexpected deformation mode');
  assert.equal(effectiveIdentity.hillAuthority, 'live_simulation', 'Hill packet is not source-owned live-simulation evidence');
  assert.equal(effectiveIdentity.hillIdentityProjection, 'public-surface-identifiers-v0', 'Hill packet does not declare its public identity projection');
  assert.equal(effective.dynamicContinuity, 'not-claimed', 'static Hill packet must explicitly decline dynamic continuity');
  assert.equal(effectiveIdentity.routePlanId, expected.routePlanId, 'effective route plan does not match the strict witness route');
  assert.equal(effectiveIdentity.transitionAdmission, 'caller-evaluated', 'effective route did not retain caller-evaluated transition admission');
  assert.ok(effective.routePointCount >= 8, 'route is too sparse to establish terrain traversal');

  assert.equal(
    effectiveIdentity.locomotionRailSchema,
    'kaminos.creature-scale-locomotion-rail.v0',
    'effective locomotion rail schema is stale or missing',
  );
  assert.equal(effectiveIdentity.locomotionRailId, expected.locomotionRailId, 'effective locomotion rail ID does not match requested rail');
  assert.equal(effectiveIdentity.locomotionRailAuthority, 'creature-scale-route-compilation', 'effective locomotion rail lacks compiler authority');
  assert.ok(effectiveIdentity.locomotionRailLength > 0.5, 'effective locomotion rail is too short to establish travel');
  assert.ok(
    effectiveIdentity.locomotionRailSampleCount > effective.routePointCount,
    'effective locomotion rail does not contain a dense trajectory',
  );
  assert.equal(
    railEvidence.transitionAdmission,
    'caller-evaluated-dense-revalidation',
    'effective locomotion rail was not densely re-admitted',
  );
  assert.ok(
    railEvidence.denseTransitionCount >= effectiveIdentity.locomotionRailSampleCount - 1,
    'effective locomotion rail has incomplete dense transition evidence',
  );
  assert.ok(railEvidence.minimumSupportMargin >= 0, 'effective locomotion rail has negative support margin');
  assert.equal(railEvidence.rejectedSampleCount, 0, 'effective locomotion rail contains rejected support samples');
  for (const [name, value] of Object.entries(railContinuity)) {
    assert.ok(Number.isFinite(value) && value >= 0, `effective locomotion rail continuity ${name} must be finite and nonnegative`);
  }

  return effectiveIdentity;
}

import assert from 'node:assert/strict';

export function assertMotionReady719024EffectiveIdentity(debug, expected) {
  const effective = debug?.effective || {};
  const railEvidence = effective.locomotionRailEvidence || {};
  const railContinuity = effective.locomotionRailContinuity || {};
  const effectiveIdentity = {
    castId: effective.castId,
    castHash: effective.castHash,
    registrationHash: effective.registrationHash,
    contactAtlasHash: effective.contactAtlasHash,
    contactAtlasSchema: effective.contactAtlasSchema,
    contactAtlasAuthority: effective.contactAtlasAuthority,
    contactPatchIds: effective.contactPatchIds,
    activeContactAtlasHash: effective.activeContactAtlasHash,
    activeContactAtlasAuthority: effective.activeContactAtlasAuthority,
    activeContactPlaneY: effective.activeContactPlaneY,
    activeContactPatchIds: effective.activeContactPatchIds,
    contactCarriersHash: effective.contactCarriersHash,
    contactCarriersSchema: effective.contactCarriersSchema,
    contactCarriersAuthority: effective.contactCarriersAuthority,
    oracleStencilHash: effective.oracleStencilHash,
    oracleStencilSchema: effective.oracleStencilSchema,
    oracleStencilAuthority: effective.oracleStencilAuthority,
    oracleStencilStatus: effective.oracleStencilStatus,
    preservationAuthority: effective.preservationAuthority,
    proxyRegistrationHash: effective.proxyRegistrationHash,
    proxyRegistrationSchema: effective.proxyRegistrationSchema,
    proxySourceCandidateId: effective.proxySourceCandidateId,
    proxyStationCount: effective.proxyStationCount,
    bodyDeformationMode: effective.bodyDeformationMode,
    contactDeformationMode: effective.contactDeformationMode,
    cameraMode: effective.cameraMode,
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
  assert.equal(effectiveIdentity.contactAtlasHash, expected.contactAtlasHash, 'effective contact atlas hash does not match requested contact atlas hash');
  assert.equal(effectiveIdentity.contactAtlasSchema, 'kaminos.creature-contact-atlas.v0', 'effective contact atlas schema is stale or missing');
  assert.equal(effectiveIdentity.contactAtlasAuthority, 'exact-cast-consumer-derived-contact-v0', 'effective contact atlas lacks exact-cast consumer authority');
  assert.deepEqual(effectiveIdentity.contactPatchIds, ['front-left', 'front-right', 'rear-left', 'rear-right'], 'effective contact patch identity/order drifted');
  assert.equal(effectiveIdentity.contactCarriersHash, expected.contactCarriersHash, 'effective contact carriers hash does not match requested contact carriers hash');
  assert.equal(effectiveIdentity.contactCarriersSchema, 'kaminos.creature-contact-carriers.v0', 'effective contact carriers schema is stale or missing');
  assert.equal(effectiveIdentity.contactCarriersAuthority, 'exact-cast-consumer-derived-topology-v0', 'effective contact carriers lack exact-cast topology authority');
  assert.equal(effectiveIdentity.bodyDeformationMode, expected.bodyDeformationMode, 'effective body deformation mode does not match the requested A/B lane');
  assert.equal(effectiveIdentity.contactDeformationMode, expected.contactDeformationMode, 'effective contact deformation mode does not match the requested A/B lane');
  assert.equal(effectiveIdentity.cameraMode, expected.cameraMode, 'effective camera mode does not match the requested visual witness framing');
  assert.equal(debug?.motion?.contactCoupling, expected.contactCoupling, 'effective contact coupling does not match the requested A/B lane');
  assert.equal(effectiveIdentity.hillSource, expected.hillSource, 'effective Hill source does not match requested Hill source');
  const expectedDeformationMode = expected.bodyDeformationMode === 'oracle-proxy'
    ? 'oracle-proxy-cage-with-operator-contacts-v0'
    : 'axial-parallel-transport-wave-v1';
  assert.equal(effectiveIdentity.deformationMode, expectedDeformationMode, 'unexpected deformation mode');
  if (expected.bodyDeformationMode === 'oracle-proxy') {
    assert.equal(effectiveIdentity.oracleStencilHash, expected.oracleStencilHash, 'effective oracle stencil hash does not match requested stencil hash');
    assert.equal(effectiveIdentity.oracleStencilSchema, 'kaminos.oracle-mechanical-stencil.v0', 'effective oracle stencil schema is stale or missing');
    assert.equal(effectiveIdentity.oracleStencilAuthority, 'operator-authored-rest-space-semantics', 'effective oracle stencil lacks operator-authored authority');
    assert.equal(effectiveIdentity.oracleStencilStatus, 'draft', 'effective oracle stencil status drifted from the operator artifact');
    assert.equal(effectiveIdentity.proxyRegistrationHash, expected.proxyRegistrationHash, 'effective proxy registration hash does not match requested proxy hash');
    assert.equal(effectiveIdentity.proxyRegistrationSchema, 'kaminos.lirm-fitted-proxy-rig-registration.v0', 'effective proxy registration schema is stale or missing');
    assert.equal(effectiveIdentity.proxySourceCandidateId, 'lirm-armature-03', 'effective proxy source candidate drifted');
    assert.equal(effectiveIdentity.proxyStationCount, 13, 'effective proxy station count drifted');
    assert.equal(
      effectiveIdentity.preservationAuthority,
      'consumer-inferred-from-operator-body-axis',
      'composed body lane must expose its inferred preservation authority',
    );
    assert.equal(
      effectiveIdentity.activeContactAtlasHash,
      expected.oracleStencilSemanticHash,
      'composed contact lane must derive active contact identity from the exact operator stencil',
    );
    assert.equal(
      effectiveIdentity.activeContactAtlasAuthority,
      'derived-from-operator-semantic-stencil',
      'composed contact lane must expose operator-derived active contact authority',
    );
  } else {
    assert.equal(
      effectiveIdentity.activeContactAtlasHash,
      expected.contactAtlasHash,
      'frozen baseline must retain the persisted exact-cast active contact atlas',
    );
    assert.equal(
      effectiveIdentity.activeContactAtlasAuthority,
      'exact-cast-consumer-derived-contact-v0',
      'frozen baseline active contact authority drifted',
    );
  }
  assert.deepEqual(
    effectiveIdentity.activeContactPatchIds,
    ['front-left', 'front-right', 'rear-left', 'rear-right'],
    'active contact patch identity/order drifted',
  );
  assert.ok(Number.isFinite(effectiveIdentity.activeContactPlaneY), 'active contact support plane is missing');
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

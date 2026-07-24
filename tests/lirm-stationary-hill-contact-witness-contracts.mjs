import assert from 'node:assert/strict';

import {
  assertStationaryHillContactWitnessState,
  createStationaryHillContactWitnessIdentity,
  EXPECTED_STATIONARY_CONTACT_CONSTRAINTS,
  EXPECTED_STATIONARY_CONTACT_RECEIPT,
  EXPECTED_STATIONARY_CONTACT_ROUTE,
  EXPECTED_STATIONARY_CONTACT_SOURCE_HASH,
} from '../lirm-stationary-hill-contact-witness-core.mjs';

const valid = {
  status: 'loaded',
  happy: true,
  requestedRoute: EXPECTED_STATIONARY_CONTACT_ROUTE,
  effectiveRoute: EXPECTED_STATIONARY_CONTACT_ROUTE,
  sourceHash: EXPECTED_STATIONARY_CONTACT_SOURCE_HASH,
  actualSourceHash: EXPECTED_STATIONARY_CONTACT_SOURCE_HASH,
  supportSurface: {
    id: 'hill-of-hills-motion-affordance-packet-v0',
    sourceRef: 'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348',
    revision: '81c5348',
  },
  inputHashes: {
    registration: 'sha256:a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9',
    contactAtlas: 'sha256:e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
    phaseReport: 'sha256:97abeb1cdacb802ecf26e2aba6e27ae9d96508e6f85836853b9c3bdd993583ff',
    handshake: 'sha256:f6d5d91f71dd34feb5c632ca0c673cb82877a011e63d3e2348c851b2c5649112',
    axialRegistration: 'sha256:cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
    hillPacket: 'sha256:ab9900438d60ca3356327e700617c65fd65e75e4b2707d8e03da0e2f3dd8e9e2',
    hillData: 'sha256:bd29f0464aecffdd35d79496b744b6d04175b1c2b8a80934fa3c88ed34874fd7',
  },
  publication: {
    receiptSha256: EXPECTED_STATIONARY_CONTACT_RECEIPT,
    constraintsSha256: EXPECTED_STATIONARY_CONTACT_CONSTRAINTS,
    constraintsId: 'stationary-hill-probes:C:constraints',
  },
  directVertexTranslationCount: 0,
  maximumResidual: 0.01,
  solveMilliseconds: 40,
};

assert.equal(assertStationaryHillContactWitnessState(valid), valid);
assert.deepEqual(createStationaryHillContactWitnessIdentity(valid), {
  requestedRoute: EXPECTED_STATIONARY_CONTACT_ROUTE,
  effectiveRoute: EXPECTED_STATIONARY_CONTACT_ROUTE,
  sourceHash: EXPECTED_STATIONARY_CONTACT_SOURCE_HASH,
  actualSourceHash: EXPECTED_STATIONARY_CONTACT_SOURCE_HASH,
  hillId: 'hill-of-hills-motion-affordance-packet-v0',
  hillSourceRef: 'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348',
  hillRevision: '81c5348',
  inputHashes: valid.inputHashes,
  receiptSha256: EXPECTED_STATIONARY_CONTACT_RECEIPT,
  constraintsSha256: EXPECTED_STATIONARY_CONTACT_CONSTRAINTS,
  constraintsId: 'stationary-hill-probes:C:constraints',
  directVertexTranslationCount: 0,
});
for (const [name, mutate, pattern] of [
  ['fallback route', state => { state.effectiveRoute = 'fallback'; }, /route mismatch/],
  ['stale source', state => { state.actualSourceHash = 'stale'; }, /source identity/],
  ['substitute Hill id', state => { state.supportSurface.id = 'substitute'; }, /Hill support identity/],
  ['substitute Hill source', state => { state.supportSurface.sourceRef = 'substitute'; }, /Hill support identity/],
  ['stale Hill revision', state => { state.supportSurface.revision = 'stale'; }, /Hill support identity/],
  ['missing input hash', state => { delete state.inputHashes.registration; }, /input hash identity/],
  ['substitute input hash', state => { state.inputHashes.hillData = 'substitute'; }, /input hash identity/],
  ['unreviewed receipt', state => { state.publication.receiptSha256 = 'unreviewed'; }, /receipt identity/],
  ['substitute constraints', state => { state.publication.constraintsSha256 = 'substitute'; }, /constraint identity/],
  ['direct patch motion', state => { state.directVertexTranslationCount = 4; }, /direct vertex/],
  ['blank residual evidence', state => { state.maximumResidual = Number.NaN; }, /residual/],
  ['excessive residual', state => { state.maximumResidual = 0.061; }, /residual ceiling/],
  ['missing timing evidence', state => { state.solveMilliseconds = null; }, /duration/],
]) {
  const state = structuredClone(valid);
  mutate(state);
  assert.throws(
    () => assertStationaryHillContactWitnessState(state),
    pattern,
    `${name} must fail witness admission`,
  );
}

process.stdout.write('lirm stationary Hill contact witness contracts passed\n');

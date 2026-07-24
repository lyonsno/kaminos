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
  supportSurface: { revision: '81c5348' },
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
  hillRevision: '81c5348',
  receiptSha256: EXPECTED_STATIONARY_CONTACT_RECEIPT,
  constraintsSha256: EXPECTED_STATIONARY_CONTACT_CONSTRAINTS,
  constraintsId: 'stationary-hill-probes:C:constraints',
  directVertexTranslationCount: 0,
});
for (const [name, mutate, pattern] of [
  ['fallback route', state => { state.effectiveRoute = 'fallback'; }, /route mismatch/],
  ['stale source', state => { state.actualSourceHash = 'stale'; }, /source identity/],
  ['stale Hill', state => { state.supportSurface.revision = 'stale'; }, /Hill revision/],
  ['unreviewed receipt', state => { state.publication.receiptSha256 = 'unreviewed'; }, /receipt identity/],
  ['substitute constraints', state => { state.publication.constraintsSha256 = 'substitute'; }, /constraint identity/],
  ['direct patch motion', state => { state.directVertexTranslationCount = 4; }, /direct vertex/],
  ['blank residual evidence', state => { state.maximumResidual = Number.NaN; }, /residual/],
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

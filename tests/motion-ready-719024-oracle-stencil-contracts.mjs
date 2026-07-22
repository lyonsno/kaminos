import assert from 'node:assert/strict';

import {
  ORACLE_STENCIL_AUTHORITY,
  ORACLE_STENCIL_BINDING_SCHEMA,
  ORACLE_STENCIL_SCHEMA,
  canonicalizeOracleStencil,
  createOracleStencilDocument,
  deriveOracleStencilBinding,
  hashOracleStencil,
  perturbOracleStencilRegion,
  setOracleStencilStatus,
  upsertOracleStencilRegion,
  validateOracleStencilDocument,
} from '../motion-ready-719024-stencil.js';

const identity = {
  castId: 'motion-ready-719024',
  castHash: '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  registrationHash: 'cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
};

let stencil = createOracleStencilDocument({
  ...identity,
  authoringSessionId: 'operator-smoke-001',
});
assert.equal(stencil.schema, ORACLE_STENCIL_SCHEMA);
assert.equal(stencil.authoring.authority, ORACLE_STENCIL_AUTHORITY);
assert.equal(stencil.authoring.coordinateSpace, 'asset-local');

stencil = upsertOracleStencilRegion(stencil, {
  id: 'body-axis',
  kind: 'body-axis',
  label: 'Head to tail',
  points: [[1, 0, 0], [-1, 0, 0]],
  radii: [0.22, 0.22],
});
stencil = upsertOracleStencilRegion(stencil, {
  id: 'front-left-limb',
  kind: 'appendage-chain',
  label: 'Front left limb',
  points: [[0.65, 0.1, 0.3], [0.5, -0.25, 0.35], [0.44, -0.52, 0.35]],
  radii: [0.18, 0.14, 0.11],
});
stencil = upsertOracleStencilRegion(stencil, {
  id: 'front-left-contact',
  kind: 'contact-patch',
  label: 'Front left contact',
  points: [[0.44, -0.54, 0.35]],
  radii: [0.13],
});
stencil = upsertOracleStencilRegion(stencil, {
  id: 'trunk-preserve',
  kind: 'preservation-region',
  label: 'Trunk volume',
  points: [[0, 0, 0]],
  radii: [[0.95, 0.48, 0.42]],
});

const validated = validateOracleStencilDocument(stencil, identity);
assert.equal(setOracleStencilStatus(validated, 'accepted').authoring.status, 'accepted');
assert.throws(
  () => setOracleStencilStatus(createOracleStencilDocument({
    ...identity,
    authoringSessionId: 'blank-accept-reproduction',
  }), 'accepted'),
  /accepted oracle stencil requires.*body-axis.*appendage-chain.*contact-patch.*preservation-region/,
  'blank drafts must not acquire accepted operator-semantic authority',
);
for (const omittedKind of ['body-axis', 'appendage-chain', 'contact-patch', 'preservation-region']) {
  assert.throws(
    () => setOracleStencilStatus({
      ...validated,
      regions: validated.regions.filter(region => region.kind !== omittedKind),
    }, 'accepted'),
    new RegExp(`accepted oracle stencil requires.*${omittedKind}`),
    `acceptance must fail while ${omittedKind} is missing`,
  );
}
assert.deepEqual(
  JSON.parse(canonicalizeOracleStencil(validated)),
  JSON.parse(canonicalizeOracleStencil(JSON.parse(JSON.stringify(validated)))),
  'semantic stencil must round-trip without hidden runtime state',
);
const originalHash = await hashOracleStencil(validated);
assert.match(originalHash, /^[a-f0-9]{64}$/);

const positions = new Float32Array([
  0.44, -0.54, 0.35,
  0.49, -0.50, 0.34,
  -0.8, 0.1, 0.05,
  0.0, 0.0, 0.0,
]);
const binding = await deriveOracleStencilBinding(validated, positions, identity);
assert.equal(binding.schema, ORACLE_STENCIL_BINDING_SCHEMA);
assert.equal(binding.stencilHash, originalHash);
assert.deepEqual(binding.regions.find(region => region.id === 'front-left-contact').vertexIndices, [0, 1]);
assert.ok(binding.regions.find(region => region.id === 'trunk-preserve').vertexIndices.includes(3));

const perturbed = perturbOracleStencilRegion(validated, 'front-left-contact', {
  translate: [0.4, 0, 0],
  radiusScale: 0.6,
});
assert.notEqual(await hashOracleStencil(perturbed), originalHash, 'a semantic perturbation must change stencil identity');
assert.deepEqual(
  perturbed.regions.filter(region => region.id !== 'front-left-contact'),
  validated.regions.filter(region => region.id !== 'front-left-contact'),
  'sloppiness perturbation must not silently rewrite neighboring semantics',
);
const perturbedBinding = await deriveOracleStencilBinding(perturbed, positions, identity);
assert.notDeepEqual(
  perturbedBinding.regions.find(region => region.id === 'front-left-contact').vertexIndices,
  binding.regions.find(region => region.id === 'front-left-contact').vertexIndices,
  'targeted perturbation must produce an observable targeted binding delta',
);

assert.throws(
  () => validateOracleStencilDocument({ ...validated, schema: 'kaminos.creature-contact-atlas.v0' }, identity),
  /oracle stencil schema/,
  'a precomputed contact atlas must not impersonate operator-authored stencil authority',
);
assert.throws(
  () => validateOracleStencilDocument({
    ...validated,
    authoring: { ...validated.authoring, authority: 'geometry-inferred' },
  }, identity),
  /operator-authored authority/,
);
assert.throws(
  () => validateOracleStencilDocument(validated, { ...identity, castHash: 'wrong-cast' }),
  /cast hash mismatch/,
);
assert.throws(
  () => validateOracleStencilDocument({
    ...validated,
    regions: [...validated.regions, validated.regions[0]],
  }, identity),
  /duplicate region id/,
);

console.log('motion-ready-719024 oracle stencil contracts passed');

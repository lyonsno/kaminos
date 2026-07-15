import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witnessUrl = new URL('../boundary-splat-appearance-transport-witness.mjs', import.meta.url);
const witness = await import(witnessUrl);
const source = await readFile(witnessUrl, 'utf8');

const roles = {
  reference: 'exact-heldout-valid-local-donor-support-and-candidate-state-v0',
  sourceReuse: 'current-source-state-zero-flow-reuse-v0',
  oracleDonor: 'oracle-correspondence-transported-splat-donor-v0',
  oraclePredicted: 'oracle-correspondence-transport-plus-frozen-splat-residual-v0',
  learnedDonor: 'forced-support-best-valid-learned-displacement-splat-donor-v0',
  learnedPredicted: 'forced-support-learned-displacement-plus-frozen-splat-residual-v0',
};

const identity = { path: '/artifact.json', bytes: 1, sha256: 'a'.repeat(64) };
const pair = (oracle, learned) => ({
  metrics: {
    oracleTransport: { aggregate: { predictionMse: oracle } },
    learnedTransport: { aggregate: { predictionMse: learned } },
  },
});
const evaluation = {
  schema: 'kaminos-boundary-splat-phase-appearance-transport-evaluation-v0',
  status: 'completed',
  roles,
  route: { backend: 'mlx', device: 'Device(gpu, 0)', fallbackReason: null },
  model: identity,
  transportModel: identity,
  evaluationManifest: identity,
  temporal: { evaluatedPairCount: 2, pairCap: null, sampleCap: null },
  evaluation: {
    authority: 'all-adjacent-matched-appearance-transport-comparisons-v0',
    pairCount: 2,
    oracleAggregatePredictionMse: 0.2,
    learnedAggregatePredictionMse: 0.3,
    oracleBeatsLearnedPairCount: 1,
    pairCap: null,
    sampleCap: null,
  },
  pairs: [pair(0.1, 0.4), pair(0.3, 0.2)],
};
assert.doesNotThrow(() => witness.validateAppearanceTransportEvaluation(evaluation, Buffer.from('{}')));
assert.throws(
  () => witness.validateAppearanceTransportEvaluation({
    ...evaluation,
    evaluation: { ...evaluation.evaluation, oracleBeatsLearnedPairCount: 2 },
  }, Buffer.from('{}')),
  /metric recomputation mismatch/,
  'a stale or edited headline must not survive pairwise metric recomputation',
);

assert.deepEqual(witness.validateAppearanceTransportRoles(roles), roles);
assert.throws(
  () => witness.validateAppearanceTransportRoles({ ...roles, learnedPredicted: roles.oraclePredicted }),
  /role authority mismatch/,
  'oracle output must not masquerade as learned transport',
);
assert.throws(
  () => witness.validateAppearanceTransportRoles({ ...roles, sourceReuse: undefined }),
  /role authority mismatch/,
  'the native-support source-reuse control is mandatory',
);

const sites = [
  { splat: [0, 0, 0, 1, 0.2, 0.3, 0.4, 0.8, 0, 0, 0, 0] },
  { splat: [1, 0, 0, 1, 0.4, 0.3, 0.2, 0.6, 0, 0, 0, 0] },
];
assert.deepEqual(
  witness.buildAppearanceRows(sites),
  sites.map(site => site.splat),
  'beauty rows must preserve every raw splat without static attenuation',
);
const debugRows = witness.buildAppearanceRows(sites, ['transported', 'birth'], 0.625);
assert.notDeepEqual(debugRows[0].slice(4, 7), sites[0].splat.slice(4, 7));
assert.notDeepEqual(debugRows[1].slice(4, 7), sites[1].splat.slice(4, 7));
assert.throws(() => witness.buildAppearanceRows(sites, ['transported', 'birth'], 0.5), /exactly 0\.625/);

assert.match(source, /REFERENCE/);
assert.match(source, /SOURCE REUSE/);
assert.match(source, /ORACLE DONOR/);
assert.match(source, /ORACLE \+ RESIDUAL/);
assert.match(source, /LEARNED \+ RESIDUAL/);
assert.match(source, /one-step temporal sequence/i);
assert.match(source, /native differing support/i);
assert.match(source, /unsupported births/i);
assert.match(source, /pending-direct-operator-visual-smoke/);
assert.doesNotMatch(source, /-stream_loop/);
assert.doesNotMatch(source, /slice\(0,\s*\d+\)/);

console.log('boundary splat appearance transport witness contracts passed');

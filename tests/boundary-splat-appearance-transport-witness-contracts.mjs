import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const root = await mkdtemp(join(tmpdir(), 'appearance-transport-witness-contract-'));
try {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const writeIdentity = async (name, document) => {
    const path = join(root, name);
    const bytes = Buffer.from(`${JSON.stringify(document)}\n`);
    await writeFile(path, bytes);
    return { path, bytes: bytes.byteLength, sha256: hash(bytes) };
  };
  const writeRole = async (pairIndex, role, authority, colorGain) => {
    const candidates = new Float32Array(16);
    candidates[8] = pairIndex + colorGain;
    const splats = new Float32Array([
      pairIndex * 0.08, 0, 0, 1,
      0.5 + colorGain * 0.03, 0.25 + pairIndex * 0.1, 0.1, 0.9,
      0.22, 0.22, 0, 0,
    ]);
    const artifact = async (suffix, values, strideFloats) => {
      const path = join(root, `pair-${pairIndex}-${role}.${suffix}.f32`);
      const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
      await writeFile(path, bytes);
      return {
        path, bytes: bytes.byteLength, sha256: hash(bytes), count: 1,
        strideFloats, dtype: 'float32-le', authority,
      };
    };
    return {
      candidates: await artifact('features', candidates, 16),
      splats: await artifact('splats', splats, 12),
    };
  };
  const modelIdentity = await writeIdentity('appearance-model.json', { model: 'appearance' });
  const transportIdentity = await writeIdentity('transport-model.json', { model: 'transport' });
  const camera = {
    viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    right: [1, 0, 0],
    up: [0, 1, 0],
  };
  const manifestIdentity = await writeIdentity('phase-corpus.json', {
    frames: [{ id: 'frame-0', camera }, { id: 'frame-1', camera }, { id: 'frame-2', camera }],
  });
  const pairs = [];
  for (let index = 0; index < 2; index += 1) {
    const roleArtifacts = {};
    let roleIndex = 0;
    for (const [role, authority] of Object.entries(roles)) {
      roleArtifacts[role] = await writeRole(index, role, authority, roleIndex);
      roleIndex += 1;
    }
    const cohortPath = join(root, `pair-${index}-cohorts.u8`);
    const cohortBytes = Buffer.from([2]);
    await writeFile(cohortPath, cohortBytes);
    pairs.push({
      step: index + 1,
      sourceFrameId: `frame-${index}`,
      targetFrameId: `frame-${index + 1}`,
      ...roleArtifacts,
      cohorts: {
        path: cohortPath, bytes: 1, sha256: hash(cohortBytes), count: 1,
        dtype: 'uint8', authority: 'exact-oracle-support-motion-cohort-index-v0',
        order: ['stable-q1', 'stable-q2', 'stable-q3', 'stable-q4', 'transported', 'birth'],
      },
      supportAccounting: {
        targetFrameSupportCount: 1,
        exactSupportCount: 1,
        excludedUnsupportedTargetCount: 0,
        unsupportedBirthCount: 0,
        supportChanged: false,
        worldPositionsChanged: false,
        candidateStateFrozenToExact: true,
        learnedCompositionMatchesOracleSupport: true,
        learnedDonor: { destinationCount: 1, deathWouldHaveWonCount: index },
      },
      metrics: pair(index === 0 ? 0.1 : 0.3, index === 0 ? 0.4 : 0.2).metrics,
    });
  }
  const fullEvaluation = {
    ...evaluation,
    model: modelIdentity,
    transportModel: transportIdentity,
    evaluationManifest: manifestIdentity,
    temporal: {
      authority: 'all-adjacent-cross-episode-one-step-evaluations-v0',
      evaluatedPairCount: 2,
      controlledStepDeltaMs: 160,
      pairCap: null,
      sampleCap: null,
    },
    pairs,
  };
  const evaluationPath = join(root, 'evaluation.json');
  await writeFile(evaluationPath, `${JSON.stringify(fullEvaluation)}\n`);
  const outDir = join(root, 'witness');
  const report = await witness.writeAppearanceTransportWitness(evaluationPath, { outDir, width: 48, height: 48 });
  assert.equal(report.status, 'completed');
  assert.equal(report.playback.frameCount, 2);
  assert.equal((await readFile(join(outDir, 'appearance-transport-beauty.mp4'))).byteLength > 0, true);
  assert.equal((await readFile(join(outDir, 'appearance-transport-debug.mp4'))).byteLength > 0, true);
} finally {
  await rm(root, { recursive: true, force: true });
}

assert.match(source, /REFERENCE/);
assert.match(source, /SOURCE REUSE/);
assert.match(source, /ORACLE DONOR/);
assert.match(source, /ORACLE RESIDUAL/);
assert.match(source, /LEARNED RESIDUAL/);
assert.match(source, /one-step temporal sequence/i);
assert.match(source, /native differing support/i);
assert.match(source, /unsupported births/i);
assert.match(source, /pending-direct-operator-visual-smoke/);
assert.doesNotMatch(source, /-stream_loop/);
assert.doesNotMatch(source, /slice\(0,\s*\d+\)/);

console.log('boundary splat appearance transport witness contracts passed');

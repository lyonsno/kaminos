import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'volume-nonridge-explicit-support-assay.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaminos-nonridge-explicit-support-'));

const CURRENT16 = [
  'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
  'material.density', 'material.heat', 'material.fuel', 'material.detail',
  'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
  'micro.x', 'micro.y', 'micro.z', 'micro.w',
];
const SOURCE_ADDITIONS = [
  'front.topology', 'velocity.x', 'velocity.y', 'velocity.z',
  'support.reaction', 'support.interface', 'flow.curlMagnitude', 'flow.divergence',
];
const SOURCE_COMPLETE = [...CURRENT16, ...SOURCE_ADDITIONS];
const TARGETS = [
  'candidate.nonRidgeMembership',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b',
  'nonRidge.extinction',
];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function writeF32(name, values, shape, semanticRole) {
  const file = path.join(tmp, name);
  const array = Float32Array.from(values);
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  fs.writeFileSync(file, bytes);
  return {
    path: file,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    dtype: 'float32-le',
    shape,
    semanticRole,
  };
}

function smoothstep(lo, hi, value) {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function makeSetting(id, settingIndex, splitRole, negativeControl = false) {
  const shape = [8, 8, 2];
  const rows = shape.reduce((a, b) => a * b, 1);
  const features = [];
  const targets = [];
  let positiveMembershipRows = 0;
  let negativeMembershipRows = 0;
  let positiveOpticalRows = 0;
  let hardPositiveRows = 0;

  for (let index = 0; index < rows; index += 1) {
    const x = index % shape[0];
    const y = Math.floor(index / shape[0]) % shape[1];
    const z = Math.floor(index / (shape[0] * shape[1]));
    const sourcePositive = (x * 3 + y * 5 + z + settingIndex) % 11 < 4;
    const positive = !negativeControl && sourcePositive;
    const hardPositive = positive && ((x + y + settingIndex) % 3 !== 0);
    const ridge = positive && !hardPositive ? 0.92 : 0.018;
    const coverage = sourcePositive ? 0.82 : 0.10;
    const fireEnergy = sourcePositive ? 0.34 : 0.012;
    const fireEmission = sourcePositive ? 0.24 : 0.008;
    const fireDetail = sourcePositive ? 0.22 : 0.006;
    const microZ = sourcePositive ? 0.15 : 0.004;
    const heat = sourcePositive ? 0.28 : 0.010;
    const fireSignal = fireEnergy * 1.25 + fireEmission * 0.52 + fireDetail * 0.86 + microZ * 0.72 + heat * 0.24;
    const structural = ridge * smoothstep(0.055, 0.32, coverage) * smoothstep(0.018, 0.16, fireSignal);
    const ridgeOwnership = structural >= 0.11 ? Math.max(0, Math.min(1, structural)) : 0;
    const membership = positive ? 1 - ridgeOwnership : 0;
    const optical = positive ? 0.20 + 0.08 * ((x + y + z) % 4) : 0;
    const reaction = sourcePositive ? 0.76 + 0.02 * ((x + settingIndex) % 4) : 0.08 + 0.01 * (y % 3);
    const front = sourcePositive ? 0.61 + 0.03 * (z + settingIndex % 2) : 0.06;
    const interfaceSupport = sourcePositive ? 0.18 : 0.70;
    const curl = sourcePositive ? 0.52 : 0.07;
    const divergence = sourcePositive ? -0.31 : 0.02;

    features.push(
      sourcePositive ? 0.55 : 0.04, coverage, ridge, sourcePositive ? 0.7 : 0.1,
      sourcePositive ? 0.18 : 0.02, heat, sourcePositive ? 0.35 : 0.06, sourcePositive ? 0.23 : 0.04,
      fireEnergy, sourcePositive ? 0.25 : 0.01, fireEmission, fireDetail,
      sourcePositive ? 0.12 : 0.01, sourcePositive ? 0.11 : 0.01, microZ, sourcePositive ? 0.08 : 0.01,
      front, sourcePositive ? 0.06 : 0.01, sourcePositive ? 0.13 : 0.01, sourcePositive ? -0.04 : 0,
      reaction, interfaceSupport, curl, divergence,
    );
    targets.push(membership, optical * 1.4, optical * 0.7, optical * 0.2, optical * 0.4);
    positiveMembershipRows += Number(membership > 0);
    negativeMembershipRows += Number(membership === 0);
    positiveOpticalRows += Number(optical > 0);
    hardPositiveRows += Number(hardPositive);
  }

  const effectiveControls = {
    'support.thermal': 1,
    'support.reaction': 1,
    'support.front': 1,
    'support.interface': 1,
    'boundary.gradientGain': 1,
    'boundary.cut': 0.1 + settingIndex / 100,
    'boundary.softness': 0.2,
    'boundary.coreRejection': 0.3,
    'topology.gain': 1,
    'curl.gain': 1,
    'divergence.gain': 1,
    'ridge.gain': 1,
    'ridge.cut': 0.04,
    'tip.breakup': 1,
    'topology.erosion': 0.5,
  };
  if (negativeControl) {
    effectiveControls['support.thermal'] = 0;
    effectiveControls['boundary.gradientGain'] = 0;
  }
  const controlsHash = sha256(Buffer.from(canonicalJson(effectiveControls)));
  return {
    id,
    splitRole,
    effectiveControlIdentity: `sha256:${controlsHash}`,
    requestedControls: { ...effectiveControls },
    effectiveControls,
    negativeControl,
    negativeControlPredicate: negativeControl ? 'all-targets-zero-v0' : null,
    source: {
      gridShape: shape,
      gridSpacing: [0.25, 0.25, 1],
      gridAxisOrder: 'x-fastest-y-then-z-v0',
      stateHash: sha256(Buffer.from(`state-${id}`)),
      controlsHash,
      effectiveRoute: 'synthetic-explicit-support-fixture-v0',
      backend: 'cpu-fixture',
    },
    rows: {
      count: rows,
      sourceComplete: writeF32(`${id}-source-complete.f32`, features, [rows, SOURCE_COMPLETE.length], 'candidate-features-source-complete'),
      targets: writeF32(`${id}-targets.f32`, targets, [rows, TARGETS.length], 'supervision-targets-positive-nonridge'),
    },
    targetSummary: {
      positiveMembershipRows,
      negativeMembershipRows,
      positiveOpticalRows,
      allTargetsZero: negativeControl,
      fixtureHardPositiveRows: hardPositiveRows,
    },
  };
}

const settings = [
  makeSetting('setting-a', 0, 'train'),
  makeSetting('setting-b', 1, 'train'),
  makeSetting('setting-black', 2, 'train', true),
  makeSetting('setting-c', 3, 'train'),
  makeSetting('setting-d', 4, 'heldOut'),
];
const corpus = {
  schema: 'kaminos.volume.nonridge-source-basis-corpus.v0',
  status: 'complete',
  failurePhase: null,
  identity: 'sha256:synthetic-explicit-support-fixture-v0',
  authority: 'checksum-bound-randomized-nonridge-source-basis-v0',
  cohort: {
    identity: 'full-grid',
    retentionPolicy: 'retain-all-admitted-settings-and-rows-uncapped-v0',
    sampleCap: null,
    droppedRowCount: 0,
    retainedSettingCount: settings.length,
    expectedSettingCount: settings.length,
    rejectedSettingCount: 0,
    negativeControlSettingCount: 1,
    totalRows: settings.reduce((sum, setting) => sum + setting.rows.count, 0),
  },
  featureViews: {
    current16: { identity: 'live-boundary-candidate-current16-v0', order: CURRENT16, includesTargets: false, includesControls: false },
    sourceComplete: { identity: 'current16-plus-independent-source-evidence-v0', order: SOURCE_COMPLETE, includesTargets: false, includesControls: false },
  },
  targets: {
    identity: 'positive-nonridge-membership-emission-extinction-v0',
    order: TARGETS,
    semanticRole: 'supervision-only',
    membershipTeacherLeakageIntoFeatures: false,
  },
  splits: {
    identity: 'whole-effective-control-setting-holdout-v0',
    train: {
      settingIds: ['setting-a', 'setting-b', 'setting-black', 'setting-c'],
      effectiveControlIdentities: settings.slice(0, 4).map((setting) => setting.effectiveControlIdentity),
    },
    heldOut: {
      settingIds: ['setting-d'],
      effectiveControlIdentities: [settings[4].effectiveControlIdentity],
    },
    targetCoverage: {
      train: ['setting-a', 'setting-b', 'setting-black', 'setting-c'].reduce((summary, id) => {
        const setting = settings.find((candidate) => candidate.id === id);
        for (const key of ['positiveMembershipRows', 'negativeMembershipRows', 'positiveOpticalRows']) summary[key] += setting.targetSummary[key];
        return summary;
      }, { positiveMembershipRows: 0, negativeMembershipRows: 0, positiveOpticalRows: 0 }),
      heldOut: Object.fromEntries(['positiveMembershipRows', 'negativeMembershipRows', 'positiveOpticalRows'].map((key) => [key, settings[4].targetSummary[key]])),
    },
  },
  settings,
};
const corpusPath = path.join(tmp, 'corpus-manifest.json');
const corpusBytes = Buffer.from(`${JSON.stringify(corpus, null, 2)}\n`);
fs.writeFileSync(corpusPath, corpusBytes);
const corpusSha = sha256(corpusBytes);
const outDir = path.join(tmp, 'assay');

const result = spawnSync('python3', [
  SCRIPT,
  '--corpus-manifest', corpusPath,
  '--corpus-manifest-sha256', corpusSha,
  '--out-dir', outDir,
  '--calibration-setting', 'setting-c',
], { encoding: 'utf8' });
assert.equal(result.status, 0, `explicit support assay failed:\nstdout=${result.stdout}\nstderr=${result.stderr}`);

const report = JSON.parse(fs.readFileSync(path.join(outDir, 'assay-manifest.json'), 'utf8'));
assert.equal(report.schema, 'kaminos.volume.nonridge-explicit-support-assay.v0');
assert.equal(report.identity, 'deterministic-source-field-nonridge-selector-search-v0');
assert.equal(report.status, 'complete');
assert.equal(report.source.corpusManifestSha256, corpusSha);
assert.equal(report.source.corpusManifest, 'corpus-manifest.json');
assert.equal(report.source.corpusManifestLocator, 'external-basename-plus-sha256-v0');
assert.equal(report.implementation.script, 'volume-nonridge-explicit-support-assay.py');
assert.equal(report.implementation.scriptLocator, 'repository-relative-v0');
assert.equal(report.selectorRecipe.path, 'selector-recipe.json');
for (const [label, value] of [
  ['corpus', report.source.corpusManifest],
  ['implementation', report.implementation.script],
  ['recipe', report.selectorRecipe.path],
]) {
  assert.equal(path.isAbsolute(value), false, `${label} locator must not leak an ephemeral runtime path`);
}
assert.equal(report.source.sampleCap, null);
assert.equal(report.source.rowsEvaluated, 5 * 128);
assert.deepEqual(report.source.effectiveSplits, {
  fit: ['setting-a', 'setting-b', 'setting-black'],
  calibration: ['setting-c'],
  heldOut: ['setting-d'],
});

assert.equal(report.ridgeAdmission.identity, 'production-direct-flame-candidate-structural-signal-v0');
assert.equal(report.ridgeAdmission.threshold, 0.11);
assert.deepEqual(report.ridgeAdmission.inputs, [
  'sidecar.ridge', 'sidecar.coverage', 'fire.energy', 'fire.emission',
  'fire.detail', 'micro.z', 'material.heat',
]);
assert.equal(report.hardPositive.identity, 'positive-full-flame-optical-and-production-ridge-rejected-v0');
assert.equal(report.hardPositive.opticalEpsilon, 1e-6);
for (const [role, ids] of Object.entries(report.source.effectiveSplits)) {
  const expectedHard = ids.reduce((sum, id) => sum + settings.find((setting) => setting.id === id).targetSummary.fixtureHardPositiveRows, 0);
  assert.equal(report.metrics[role].hardPositive.rows, expectedHard, `${role} hard-positive count drifted from the production Ridge predicate`);
}

assert.equal(report.selector.authority, 'explicit-source-field-operator-v0');
assert.equal(report.selector.kind, 'bounded-monotone-rule-v0');
assert.equal(report.selector.terms[0].feature, 'authored.gradient-gated-fire.signal');
assert.deepEqual(report.selector.terms[0].controls, ['boundary.gradientGain']);
const authoredBoundaryDefinition = report.candidateBasisDefinitions.find(
  (candidate) => candidate.name === 'authored.boundary.raw',
);
assert.deepEqual(authoredBoundaryDefinition.controls, [
  'support.thermal', 'support.reaction', 'support.front', 'support.interface',
  'boundary.gradientGain', 'boundary.cut', 'boundary.softness',
  'boundary.coreRejection', 'topology.gain', 'curl.gain', 'divergence.gain',
]);
assert.equal(report.authoredControlLaw.identity, 'reaction-boundary-live-controls-v0');
assert.equal(report.authoredControlLaw.gradientSpace, 'world-grid-spacing-scaled-central-difference-v0');
assert.ok(report.selector.terms.length > 0 && report.selector.terms.length <= 4);
for (const term of report.selector.terms) {
  assert.ok(report.candidateBasis.includes(term.feature), `selector term ${term.feature} is not in the declared source basis`);
  assert.doesNotMatch(term.feature, /target|nonRidgeMembership|sidecar\.ridge/i);
  assert.ok(Number.isFinite(term.low) && Number.isFinite(term.high));
  assert.ok(term.high > term.low);
  assert.ok(Number.isFinite(term.weight) && term.weight > 0);
}
for (const candidate of report.candidateBasisDefinitions) {
  for (const input of candidate.inputs) assert.doesNotMatch(input, /^candidate\.|^nonRidge\.|^sidecar\.ridge$/i);
  assert.doesNotMatch(candidate.expression, /candidate\.nonRidgeMembership|nonRidge\.emission|nonRidge\.extinction/i);
}
assert.equal(report.selector.nonRidgeLayerIdentity, 'authored-nonridge-support-coefficient-layer-v0');
assert.equal(report.selector.compositionIdentity, 'separate-ridge-nonridge-shared-total-extinction-v0');
assert.deepEqual(report.selector.ownershipSeparation, {
  ridge: 'sigma_ridge=sigma_complete*ridgeOwnershipWeight',
  nonRidge: 'sigma_nonridge=sigma_complete*(1-ridgeOwnershipWeight)',
  sharedTransport: 'sigma_total=sigma_ridge+sigma_nonridge',
});

assert.ok(report.metrics.heldOut.hardPositive.rows > 0);
assert.ok(report.metrics.heldOut.hardPositive.recall >= 0.65);
assert.ok(report.metrics.heldOut.wholeGrid.precision >= 0.80);
assert.ok(report.metrics.heldOut.wholeGrid.falsePositiveRate <= 0.10);
assert.equal(report.metrics.negativeControls['setting-black'].admittedRows, 0);
assert.equal(report.metrics.negativeControls['setting-black'].rows, 128);
assert.ok(report.metrics.negativeControls['setting-black'].sourcePopulatedRows > 0);
assert.equal(report.metrics.heldOut.rowsEvaluated, 128);
assert.equal(report.metrics.heldOut.rowsDropped, 0);

const forgedOut = path.join(tmp, 'forged');
const forged = spawnSync('python3', [
  SCRIPT,
  '--corpus-manifest', corpusPath,
  '--corpus-manifest-sha256', '0'.repeat(64),
  '--out-dir', forgedOut,
], { encoding: 'utf8' });
assert.notEqual(forged.status, 0);
const failure = JSON.parse(fs.readFileSync(path.join(forgedOut, 'failure-report.json'), 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'corpus-manifest-checksum');
assert.equal(failure.lastTrustworthyEvidence.actualSha256, corpusSha);

function writeCorpus(candidate, label) {
  const file = path.join(tmp, `${label}.json`);
  const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
  fs.writeFileSync(file, bytes);
  return { file, sha: sha256(bytes) };
}

function runRejected(label, mutate, phase) {
  const candidate = structuredClone(corpus);
  mutate(candidate);
  const fixture = writeCorpus(candidate, label);
  const rejectedOut = path.join(tmp, `${label}-out`);
  const rejected = spawnSync('python3', [
    SCRIPT, '--corpus-manifest', fixture.file, '--corpus-manifest-sha256', fixture.sha,
    '--out-dir', rejectedOut, '--calibration-setting', 'setting-c',
  ], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0, `${label} must fail loud`);
  const rejectedFailure = JSON.parse(fs.readFileSync(path.join(rejectedOut, 'failure-report.json'), 'utf8'));
  assert.equal(rejectedFailure.failurePhase, phase, `${label} failed in the wrong phase`);
}

runRejected('incomplete-corpus', (candidate) => { candidate.status = 'capturing'; }, 'corpus-status');
runRejected('dropped-rows', (candidate) => { candidate.cohort.droppedRowCount = 1; }, 'corpus-retention');
runRejected('duplicate-effective-control', (candidate) => {
  candidate.settings[1].effectiveControlIdentity = candidate.settings[0].effectiveControlIdentity;
}, 'split-contract');
runRejected('contradictory-local-role', (candidate) => { candidate.settings[4].splitRole = 'train'; }, 'split-contract');
runRejected('forged-effective-controls', (candidate) => { candidate.settings[0].effectiveControls['ridge.cut'] = 0.91; }, 'control-identity');
runRejected('forged-black-control', (candidate) => { candidate.settings[2].negativeControlPredicate = null; }, 'negative-control');
runRejected('forged-target-summary', (candidate) => { candidate.settings[0].targetSummary.positiveMembershipRows += 1; }, 'target-summary');
runRejected('forged-target-coverage', (candidate) => { candidate.splits.targetCoverage.heldOut.positiveOpticalRows += 1; }, 'target-summary');

const argumentOut = path.join(tmp, 'argument-failure');
fs.mkdirSync(argumentOut, { recursive: true });
fs.writeFileSync(path.join(argumentOut, 'assay-manifest.json'), '{"status":"complete"}\n');
fs.writeFileSync(path.join(argumentOut, 'selector-recipe.json'), '{"stale":true}\n');
const argumentFailure = spawnSync('python3', [SCRIPT, '--out-dir', argumentOut], { encoding: 'utf8' });
assert.notEqual(argumentFailure.status, 0);
const argumentReport = JSON.parse(fs.readFileSync(path.join(argumentOut, 'failure-report.json'), 'utf8'));
assert.equal(argumentReport.failurePhase, 'arguments');
assert.equal(fs.existsSync(path.join(argumentOut, 'assay-manifest.json')), false);
assert.equal(fs.existsSync(path.join(argumentOut, 'selector-recipe.json')), false);

const equalsArgumentOut = path.join(tmp, 'equals-argument-failure');
const equalsArgumentFailure = spawnSync('python3', [SCRIPT, `--out-dir=${equalsArgumentOut}`], { encoding: 'utf8' });
assert.notEqual(equalsArgumentFailure.status, 0);
const equalsArgumentReport = JSON.parse(fs.readFileSync(path.join(equalsArgumentOut, 'failure-report.json'), 'utf8'));
assert.equal(equalsArgumentReport.failurePhase, 'arguments');

const repeatOut = path.join(tmp, 'repeat-assay');
const repeat = spawnSync('python3', [
  SCRIPT, '--corpus-manifest', corpusPath, '--corpus-manifest-sha256', corpusSha,
  '--out-dir', repeatOut, '--calibration-setting', 'setting-c',
], { encoding: 'utf8' });
assert.equal(repeat.status, 0, repeat.stderr);
assert.deepEqual(
  JSON.parse(fs.readFileSync(path.join(repeatOut, 'selector-recipe.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(outDir, 'selector-recipe.json'), 'utf8')),
  'selector recipe must be deterministic',
);
const repeatReport = JSON.parse(fs.readFileSync(path.join(repeatOut, 'assay-manifest.json'), 'utf8'));
assert.deepEqual(repeatReport.search.ranking, report.search.ranking, 'candidate ranking and objectives must be deterministic');
assert.deepEqual(repeatReport.metrics, report.metrics, 'semantic metrics must be deterministic');

const descriptorProbe = spawnSync('python3', ['-c', `
import importlib.util, pathlib, tempfile, json, hashlib, os, sys
script = pathlib.Path(${JSON.stringify(SCRIPT)})
spec = importlib.util.spec_from_file_location('explicit_support', script)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
root = pathlib.Path(tempfile.mkdtemp())
path = root / 'source.f32'
path.write_bytes((b'\\x00\\x00\\x80?' * 8))
digest = hashlib.sha256(path.read_bytes()).hexdigest()
artifact = module.open_verified_artifact({'path': str(path), 'bytes': 32, 'sha256': digest, 'dtype': 'float32-le', 'shape': [8, 1], 'semanticRole': 'candidate-features-source-complete'}, (8, 1), 'probe')
replacement = root / 'replacement.f32'
replacement.write_bytes((b'\\x00\\x00\\x00@' * 8))
os.replace(replacement, path)
assert float(artifact.array[0, 0]) == 1.0
try:
    module.verify_artifact_post_consumption(artifact, 'probe')
except module.AssayError as error:
    assert error.phase == 'artifact-post-consumption'
else:
    raise AssertionError('pathname replacement must fail the post-consumption custody gate')
artifact.close()

# Pin the production Ridge threshold, optical epsilon, and x-fastest spatial operators.
import numpy as np
from types import SimpleNamespace
order = ${JSON.stringify(SOURCE_COMPLETE)}
indices = {name: index for index, name in enumerate(order)}

# Each row isolates one production fire-signal coefficient inside the unsaturated smoothstep interval.
coefficient_rows = np.zeros((5, len(order)), dtype=np.float32)
coefficient_rows[:, indices['sidecar.coverage']] = 1.0
coefficient_rows[:, indices['sidecar.ridge']] = 1.0
for row, (feature, coefficient) in enumerate((
    ('fire.energy', 1.25), ('fire.emission', 0.52), ('fire.detail', 0.86),
    ('micro.z', 0.72), ('material.heat', 0.24),
)):
    coefficient_rows[row, indices[feature]] = 0.08 / coefficient
expected_t = (0.08 - 0.018) / (0.16 - 0.018)
expected_signal = expected_t * expected_t * (3.0 - 2.0 * expected_t)
assert np.allclose(
    module.ridge_structural_signal(coefficient_rows, indices),
    np.full(5, expected_signal, dtype=np.float32), atol=2e-7,
)

boundary_rows = np.zeros((3, len(order)), dtype=np.float32)
boundary_rows[:, indices['sidecar.coverage']] = 1.0
boundary_rows[:, indices['fire.energy']] = 1.0
boundary_rows[:, indices['sidecar.ridge']] = np.asarray([0.109999, 0.11, 0.110001], dtype=np.float32)
boundary_signal = module.ridge_structural_signal(boundary_rows, indices)
assert boundary_signal[0] < 0.11 and boundary_signal[1] >= 0.11 and boundary_signal[2] > 0.11

# Full optical-support x Ridge-admission truth table, including a true hard positive.
source = np.zeros((4, len(order)), dtype=np.float32)
source[:, indices['sidecar.coverage']] = 1.0
source[:, indices['fire.energy']] = 1.0
source[:, indices['sidecar.ridge']] = np.asarray([0.05, 0.05, 0.20, 0.20], dtype=np.float32)
target = np.zeros((4, 5), dtype=np.float32)
target[:, 1] = np.asarray([2.0e-6, 0.5e-6, 2.0e-6, 0.5e-6], dtype=np.float32)
setting = SimpleNamespace(source=source, target=target)
signal = module.ridge_structural_signal(source, indices)
_, optical, ridge, hard = module.truth_masks(setting, indices)
assert optical.tolist() == [True, False, True, False]
assert ridge.tolist() == [False, False, True, True]
assert hard.tolist() == [True, False, False, False]

shape = [3, 2, 2]
values = np.asarray([0, 1, 3, 2, 4, 6, 5, 7, 9, 8, 10, 12], dtype=np.float32)
grid = values.reshape((shape[2], shape[1], shape[0]))
expected_max = np.empty_like(grid)
expected_gradient = np.empty_like(grid)
for z in range(shape[2]):
    for y in range(shape[1]):
        for x in range(shape[0]):
            neighbors = [grid[z, y, x]]
            for dx, dy, dz in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)):
                xx, yy, zz = min(max(x+dx,0),shape[0]-1), min(max(y+dy,0),shape[1]-1), min(max(z+dz,0),shape[2]-1)
                neighbors.append(grid[zz, yy, xx])
            expected_max[z, y, x] = max(neighbors)
            xm, xp = max(x-1,0), min(x+1,shape[0]-1)
            ym, yp = max(y-1,0), min(y+1,shape[1]-1)
            zm, zp = max(z-1,0), min(z+1,shape[2]-1)
            dx = (grid[z,y,xp] - grid[z,y,xm]) * 0.5
            dy = (grid[z,yp,x] - grid[z,ym,x]) * 0.5
            dz = (grid[zp,y,x] - grid[zm,y,x]) * 0.5
            expected_gradient[z,y,x] = np.sqrt(dx*dx + dy*dy + dz*dz)
assert np.array_equal(module.neighbor_max(values, shape), expected_max.reshape(-1))
assert np.allclose(module.central_gradient(values, shape), expected_gradient.reshape(-1), atol=1e-7)

# Authored gradient gain is an exact permission gate even when the source body is populated.
boundary_source = np.zeros((12, len(order)), dtype=np.float32)
boundary_source[:, indices['fire.energy']] = np.linspace(0.0, 0.8, 12, dtype=np.float32)
boundary_source[:, indices['fire.emission']] = 0.12
boundary_source[:, indices['fire.detail']] = 0.16
boundary_source[:, indices['micro.z']] = 0.10
controls = {
    'support.thermal': 1.0, 'support.reaction': 1.0,
    'support.front': 1.0, 'support.interface': 1.0,
    'boundary.gradientGain': 1.0, 'boundary.cut': 0.01,
    'boundary.softness': 0.08, 'boundary.coreRejection': 0.3,
    'topology.gain': 1.0, 'curl.gain': 1.0, 'divergence.gain': 1.0,
}
active = module.authored_boundary_raw(boundary_source, indices, [3, 2, 2], [0.25, 0.5, 1.0], controls)
assert np.count_nonzero(active) > 0
controls['boundary.gradientGain'] = 0.0
disabled = module.authored_boundary_raw(boundary_source, indices, [3, 2, 2], [0.25, 0.5, 1.0], controls)
assert np.count_nonzero(disabled) == 0
`], { encoding: 'utf8' });
assert.equal(descriptorProbe.status, 0, `same-descriptor custody probe failed:\n${descriptorProbe.stderr}`);

console.log('volume nonridge explicit support assay contracts passed');

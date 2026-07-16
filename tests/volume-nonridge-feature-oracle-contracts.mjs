import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const scriptUrl = new URL('../volume-nonridge-feature-oracle-mlx.py', import.meta.url);
assert.ok(existsSync(scriptUrl), 'non-ridge feature oracle exists');
const script = await readFile(scriptUrl, 'utf8');

assert.match(script, /kaminos\.volume\.nonridge-feature-oracle\.v0/, 'oracle publishes a stable result schema');
assert.match(script, /same-state-memorization-v0/, 'oracle names memorization without implying generalization');
assert.match(script, /whole-effective-control-setting-holdout-v0/, 'oracle preserves whole-setting holdouts');
assert.match(script, /current16-plus-independent-source-evidence-v0/, 'oracle consumes the exact augmented feature authority');
assert.match(script, /candidate\.nonRidgeMembership/, 'oracle evaluates non-ridge membership');
assert.match(script, /nonRidge\.extinction/, 'oracle evaluates physical extinction');
assert.match(script, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'oracle preserves phase-local failure evidence');
assert.match(script, /kaminos\.volume\.nonridge-feature-oracle-visuals\.v0/, 'oracle publishes a stable native-grid visual schema');
assert.match(script, /x-fastest-y-then-z-v0/, 'oracle binds projections to the producer grid-axis contract');
assert.match(script, /--visual-setting/, 'oracle accepts explicit settings for in-job prediction visualization');
assert.match(script, /--truth-only/, 'oracle can render a truth-only witness without loading MLX');

const current16 = [
  'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
  'material.density', 'material.heat', 'material.fuel', 'material.detail',
  'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
  'micro.x', 'micro.y', 'micro.z', 'micro.w',
];
const additions = [
  'front.topology', 'velocity.x', 'velocity.y', 'velocity.z',
  'support.reaction', 'support.interface', 'flow.curlMagnitude', 'flow.divergence',
];
const targets = [
  'candidate.nonRidgeMembership',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b',
  'nonRidge.extinction',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(join(tmpdir(), 'kaminos-nonridge-feature-oracle-'));
const inputDir = join(root, 'input');
const outDir = join(root, 'output');
const failedOutDir = join(root, 'failed-output');
await Promise.all([mkdir(inputDir), mkdir(outDir), mkdir(failedOutDir)]);

function floatBytes(values) {
  const array = Float32Array.from(values);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

async function artifact(settingId, role, values, shape) {
  const bytes = floatBytes(values);
  const path = join(inputDir, `${settingId}-${role}.f32`);
  await writeFile(path, bytes);
  return {
    path,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    dtype: 'float32-le',
    shape,
    semanticRole: role,
  };
}

async function setting(id, splitRole, negativeControl, phase) {
  const count = 4;
  const currentRows = [];
  const sourceRows = [];
  const targetRows = [];
  for (let row = 0; row < count; row += 1) {
    const base = Array.from({ length: current16.length }, (_, channel) => (
      negativeControl ? 0 : 0.01 * (row + channel + phase)
    ));
    const hiddenCarrier = negativeControl ? 0 : ((row + phase) % 3 === 0 ? 1 : 0.2);
    currentRows.push(...base);
    sourceRows.push(...base, hiddenCarrier, 0.2, -0.1, 0.3, hiddenCarrier, hiddenCarrier * 0.8, 0.4, -0.2);
    targetRows.push(...(negativeControl
      ? [0, 0, 0, 0, 0]
      : [hiddenCarrier, hiddenCarrier, hiddenCarrier * 0.7, hiddenCarrier * 0.3, hiddenCarrier * 0.9]));
  }
  return {
    id,
    splitRole,
    negativeControl,
    rows: {
      count,
      current16: await artifact(id, 'candidate-features-current16', currentRows, [count, current16.length]),
      sourceComplete: await artifact(id, 'candidate-features-source-complete', sourceRows, [count, current16.length + additions.length]),
      targets: await artifact(id, 'supervision-targets-positive-nonridge', targetRows, [count, targets.length]),
    },
  };
}

const settings = [
  await setting('train-positive', 'train', false, 0),
  await setting('train-negative', 'train', true, 1),
  await setting('held-positive', 'heldOut', false, 2),
  await setting('held-negative', 'heldOut', true, 3),
];
const manifest = {
  schema: 'kaminos.volume.nonridge-source-basis-corpus.v0',
  status: 'complete',
  identity: `sha256:${'1'.repeat(64)}`,
  authority: 'checksum-bound-randomized-nonridge-source-basis-v0',
  cohort: {
    identity: 'full-grid',
    retainedSettingCount: settings.length,
    totalRows: settings.reduce((sum, value) => sum + value.rows.count, 0),
    droppedRowCount: 0,
    sampleCap: null,
  },
  featureViews: {
    current16: { identity: 'live-boundary-candidate-current16-v0', order: current16 },
    sourceComplete: { identity: 'current16-plus-independent-source-evidence-v0', order: [...current16, ...additions] },
  },
  targets: { identity: 'positive-nonridge-membership-emission-extinction-v0', order: targets },
  controls: { conditionedArm: null },
  frozenAuthority: {
    gridShape: [2, 2, 1],
    gridAxisOrder: 'x-fastest-y-then-z-v0',
  },
  splits: {
    identity: 'whole-effective-control-setting-holdout-v0',
    train: { settingIds: ['train-negative', 'train-positive'] },
    heldOut: { settingIds: ['held-negative', 'held-positive'] },
  },
  settings,
};
const inputPath = join(inputDir, 'corpus-manifest.json');
await writeFile(inputPath, `${JSON.stringify(manifest, null, 2)}\n`);

const reportPath = join(outDir, 'oracle-report.json');
const probe = spawnSync('python3', [
  scriptUrl.pathname,
  '--input', inputPath,
  '--out-dir', outDir,
  '--report', reportPath,
  '--probe-only',
], { encoding: 'utf8' });
assert.equal(probe.status, 0, probe.stderr || probe.stdout);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.status, 'validated');
assert.equal(report.backend, 'not-loaded-probe-only');
assert.equal(report.cohort.totalRows, 16);
assert.equal(report.cohort.droppedRowCount, 0);
assert.equal(report.featureViews.current16.channelCount, 16);
assert.equal(report.featureViews.sourceComplete.channelCount, 24);
assert.deepEqual(report.splits.train.settingIds, ['train-negative', 'train-positive']);
assert.deepEqual(report.splits.heldOut.settingIds, ['held-negative', 'held-positive']);
assert.equal(report.assays.sameState.identity, 'same-state-memorization-v0');
assert.equal(report.assays.heldSetting.identity, 'whole-effective-control-setting-holdout-v0');
assert.equal(report.controlsUsedAsFeatures, false);
assert.equal(report.lastTrustworthyEvidence.validatedArtifactCount, 12);

function readRgbPng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'witness PNG uses eight-bit channels');
      assert.equal(data[9], 2, 'witness PNG uses RGB color');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const pixels = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    const source = row * (stride + 1);
    assert.equal(raw[source], 0, 'witness PNG rows use deterministic no-filter encoding');
    raw.copy(pixels, row * stride, source + 1, source + 1 + stride);
  }
  return { width, height, pixels };
}

const truthOutDir = join(root, 'truth-visual-output');
await mkdir(truthOutDir);
const truthReportPath = join(truthOutDir, 'oracle-report.json');
const truthOnly = spawnSync('python3', [
  scriptUrl.pathname,
  '--input', inputPath,
  '--out-dir', truthOutDir,
  '--report', truthReportPath,
  '--truth-only',
  '--visual-setting', 'held-positive',
], { encoding: 'utf8' });
assert.equal(truthOnly.status, 0, truthOnly.stderr || truthOnly.stdout);
const truthReport = JSON.parse(await readFile(truthReportPath, 'utf8'));
assert.equal(truthReport.status, 'visualized-truth-only');
assert.equal(truthReport.visualizations.schema, 'kaminos.volume.nonridge-feature-oracle-visuals.v0');
assert.deepEqual(truthReport.visualizations.gridShape, [2, 2, 1]);
assert.equal(truthReport.visualizations.gridAxisOrder, 'x-fastest-y-then-z-v0');
assert.deepEqual(truthReport.visualizations.requiredRoles, ['truth']);
assert.deepEqual(truthReport.visualizations.settingIds, ['held-positive']);
assert.equal(truthReport.visualizations.images.length, 9, 'truth witness emits three modalities on all three axes');
const membershipZ = truthReport.visualizations.images.find(value => (
  value.settingId === 'held-positive'
  && value.role === 'truth'
  && value.modality === 'membership'
  && value.axis === 'z'
));
assert.ok(membershipZ, 'truth witness emits the z-axis membership projection');
const membershipZBytes = await readFile(membershipZ.path);
assert.equal(sha256(membershipZBytes), membershipZ.sha256, 'truth witness binds every image checksum');
const decodedMembershipZ = readRgbPng(membershipZBytes);
assert.equal(decodedMembershipZ.width, 2, 'z projection preserves native x width');
assert.equal(decodedMembershipZ.height, 2, 'z projection preserves native y height');
assert.deepEqual(
  [decodedMembershipZ.pixels[0], decodedMembershipZ.pixels[3], decodedMembershipZ.pixels[6], decodedMembershipZ.pixels[9]],
  [51, 255, 51, 51],
  'z projection reshapes flattened rows as x-fastest, then y, then z',
);
assert.ok(existsSync(truthReport.visualizations.htmlPath), 'truth witness writes a complete comparison surface');

const singleMixedHeld = structuredClone(manifest);
singleMixedHeld.splits.train.settingIds.push('held-negative');
singleMixedHeld.splits.train.settingIds.sort();
singleMixedHeld.splits.heldOut.settingIds = ['held-positive'];
singleMixedHeld.settings.find(value => value.id === 'held-negative').splitRole = 'train';
const mixedHeldTargets = [
  1, 1, 0.7, 0.3, 0.9,
  0, 0, 0, 0, 0,
  0.2, 0.2, 0.14, 0.06, 0.18,
  0, 0, 0, 0, 0,
];
singleMixedHeld.settings.find(value => value.id === 'held-positive').rows.targets = await artifact(
  'held-positive-mixed',
  'supervision-targets-positive-nonridge',
  mixedHeldTargets,
  [4, targets.length],
);
await writeFile(inputPath, `${JSON.stringify(singleMixedHeld, null, 2)}\n`);
const mixedHeldOutDir = join(root, 'mixed-held-output');
await mkdir(mixedHeldOutDir);
const mixedHeldReportPath = join(mixedHeldOutDir, 'oracle-report.json');
const acceptSingleMixedHeld = spawnSync('python3', [
  scriptUrl.pathname,
  '--input', inputPath,
  '--out-dir', mixedHeldOutDir,
  '--report', mixedHeldReportPath,
  '--probe-only',
], { encoding: 'utf8' });
assert.equal(acceptSingleMixedHeld.status, 0, acceptSingleMixedHeld.stderr || acceptSingleMixedHeld.stdout);
const mixedHeldReport = JSON.parse(await readFile(mixedHeldReportPath, 'utf8'));
assert.deepEqual(mixedHeldReport.splits.heldOut.settingIds, ['held-positive']);
assert.deepEqual(mixedHeldReport.splits.targetCoverage.heldOut, {
  negativeMembershipRows: 2,
  positiveMembershipRows: 2,
  positiveOpticalRows: 2,
});

await writeFile(inputPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (process.env.KAMINOS_MLX_PYTHON) {
  const mlxOutDir = join(root, 'mlx-output');
  await mkdir(mlxOutDir);
  const mlxReportPath = join(mlxOutDir, 'oracle-report.json');
  const mlxRun = spawnSync(process.env.KAMINOS_MLX_PYTHON, [
    scriptUrl.pathname,
    '--input', inputPath,
    '--out-dir', mlxOutDir,
    '--report', mlxReportPath,
    '--epochs', '2',
    '--batch-size', '4',
    '--hidden-size', '16',
    '--visual-setting', 'train-positive',
    '--visual-setting', 'held-positive',
  ], { encoding: 'utf8' });
  assert.equal(mlxRun.status, 0, mlxRun.stderr || mlxRun.stdout);
  const mlxReport = JSON.parse(await readFile(mlxReportPath, 'utf8'));
  assert.equal(mlxReport.status, 'complete');
  assert.equal(mlxReport.views.current16.normalization.rowsSeen, 16);
  assert.equal(mlxReport.views.sourceComplete.normalization.rowsSeen, 16);
  assert.equal(mlxReport.views.current16.normalization.positiveCount, 4);
  assert.equal(mlxReport.views.sourceComplete.normalization.positiveCount, 4);
  assert.equal(mlxReport.views.current16.sameState.rowCount, 8);
  assert.equal(mlxReport.views.sourceComplete.heldSetting.rowCount, 8);
  assert.equal(mlxReport.views.current16.sameState.membership.positiveRowCount, 4);
  assert.equal(mlxReport.views.sourceComplete.heldSetting.membership.positiveRowCount, 4);
  assert.equal(mlxReport.views.current16.seed, mlxReport.views.sourceComplete.seed);
  assert.equal(mlxReport.views.current16.architectureIdentity, mlxReport.views.sourceComplete.architectureIdentity);
  assert.ok(Number.isFinite(mlxReport.comparisons.sameState.opticalMseReductionFraction));
  assert.equal(mlxReport.visualizations.schema, 'kaminos.volume.nonridge-feature-oracle-visuals.v0');
  assert.deepEqual(mlxReport.visualizations.requiredRoles, ['truth', 'current16', 'sourceComplete']);
  assert.deepEqual(mlxReport.visualizations.settingIds, ['held-positive', 'train-positive']);
  assert.equal(mlxReport.visualizations.images.length, 54, 'matched witness emits every role, modality, axis, and setting');
  for (const image of mlxReport.visualizations.images) {
    const bytes = await readFile(image.path);
    assert.equal(sha256(bytes), image.sha256, `visual checksum matches ${image.path}`);
    const decoded = readRgbPng(bytes);
    assert.ok(decoded.width > 0 && decoded.height > 0, `visual has native dimensions ${image.path}`);
  }
}

const uncoveredHeldSplit = structuredClone(manifest);
uncoveredHeldSplit.splits.train.settingIds.push('held-negative');
uncoveredHeldSplit.splits.train.settingIds.sort();
uncoveredHeldSplit.splits.heldOut.settingIds = ['held-positive'];
uncoveredHeldSplit.settings.find(value => value.id === 'held-negative').splitRole = 'train';
await writeFile(inputPath, `${JSON.stringify(uncoveredHeldSplit, null, 2)}\n`);
const splitFailedOutDir = join(root, 'split-failed-output');
await mkdir(splitFailedOutDir);
const splitFailedReportPath = join(splitFailedOutDir, 'oracle-report.json');
const rejectUncoveredSplit = spawnSync('python3', [
  scriptUrl.pathname,
  '--input', inputPath,
  '--out-dir', splitFailedOutDir,
  '--report', splitFailedReportPath,
  '--probe-only',
], { encoding: 'utf8' });
assert.equal(rejectUncoveredSplit.status, 2, 'held split without negative controls must fail');
const splitFailedReport = JSON.parse(await readFile(splitFailedReportPath, 'utf8'));
assert.match(splitFailedReport.reason, /heldOut split lacks positive\/negative membership or positive optical evidence/);

const corrupt = structuredClone(manifest);
corrupt.settings[0].rows.sourceComplete.sha256 = '0'.repeat(64);
await writeFile(inputPath, `${JSON.stringify(corrupt, null, 2)}\n`);
const failedReportPath = join(failedOutDir, 'oracle-report.json');
const reject = spawnSync('python3', [
  scriptUrl.pathname,
  '--input', inputPath,
  '--out-dir', failedOutDir,
  '--report', failedReportPath,
  '--probe-only',
], { encoding: 'utf8' });
assert.equal(reject.status, 2, 'checksum-corrupt augmented evidence must fail');
const failedReport = JSON.parse(await readFile(failedReportPath, 'utf8'));
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.failurePhase, 'artifact-validation');
assert.match(failedReport.reason, /sha256 mismatch/i);
assert.ok(failedReport.lastTrustworthyEvidence.inputManifestSha256);

console.log('non-ridge feature oracle contracts passed');

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptUrl = new URL('../volume-coarse-closure-oracle.py', import.meta.url);
assert.ok(existsSync(scriptUrl), 'coarse closure oracle harness exists');
const script = await readFile(scriptUrl, 'utf8');

assert.match(script, /kaminos\.volume\.coarse-closure-oracle\.v0/, 'oracle publishes a stable result schema');
assert.match(script, /phase-aligned-filtered-high-low-step-corpus-v0/, 'oracle requires the phase-aligned closure corpus identity');
assert.match(script, /receiver-initialized-from-filtered-high-t-v0/, 'oracle rejects an independently evolved low history');
assert.match(script, /offline-oracle-training-and-diagnostic-only/, 'oracle truth application is explicitly unavailable at runtime');
assert.match(script, /runtimeTruthAvailable/, 'oracle reports runtime truth availability instead of implying product authority');
assert.match(script, /filteredHighT[\s\S]*ordinaryLowT1[\s\S]*exactClosureResidual[\s\S]*oracleApplied/, 'oracle preserves the load-bearing comparison roles');
assert.match(script, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'oracle writes phase-local failure evidence');
assert.match(script, /sha256/, 'oracle binds source arrays and basin identity by checksum');

const root = await mkdtemp(join(tmpdir(), 'kaminos-coarse-closure-contract-'));
const inputDir = join(root, 'input');
const outDir = join(root, 'output');
const failedOutDir = join(root, 'failed-output');
const provenanceFailedOutDir = join(root, 'provenance-failed-output');
const initializationFailedOutDir = join(root, 'initialization-failed-output');
await import('node:fs/promises').then(({ mkdir }) => Promise.all([
  mkdir(inputDir, { recursive: true }),
  mkdir(outDir, { recursive: true }),
  mkdir(failedOutDir, { recursive: true }),
  mkdir(provenanceFailedOutDir, { recursive: true }),
  mkdir(initializationFailedOutDir, { recursive: true }),
]));

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fluidChannels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function floatsToBytes(values) {
  return Buffer.from(new Float32Array(values).buffer);
}

async function readFloats(path) {
  const bytes = await readFile(path);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function assertFloatsClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  let maxAbs = 0;
  for (let index = 0; index < actual.length; index += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(actual[index] - expected[index]));
  }
  assert.ok(maxAbs < 1e-6, `${label} max abs ${maxAbs}`);
}

async function writeArtifact(name, values, shape) {
  const path = join(inputDir, `${name}.f32`);
  const bytes = floatsToBytes(values);
  await writeFile(path, bytes);
  return { path, shape, dtype: 'float32-le', byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function highValues(grid, channels, timeOffset) {
  const values = new Float32Array(grid ** 3 * channels);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const cell = x + y * grid + z * grid * grid;
        for (let channel = 0; channel < channels; channel += 1) {
          values[cell * channels + channel] = x * 0.03 + y * 0.05 + z * 0.07 + channel * 0.011 + timeOffset * (channel + 1) * 0.004;
        }
      }
    }
  }
  return values;
}

function boxAverage(values, highGrid, lowGrid, channels) {
  const sourceWidth = highGrid / lowGrid;
  const weights = Array.from({ length: lowGrid }, (_, target) => {
    const start = target * sourceWidth;
    const end = (target + 1) * sourceWidth;
    return Array.from({ length: highGrid }, (_, source) => (
      Math.max(0, Math.min(end, source + 1) - Math.max(start, source)) / sourceWidth
    ));
  });
  const output = new Float32Array(lowGrid ** 3 * channels);
  for (let lz = 0; lz < lowGrid; lz += 1) {
    for (let ly = 0; ly < lowGrid; ly += 1) {
      for (let lx = 0; lx < lowGrid; lx += 1) {
        const lowCell = lx + ly * lowGrid + lz * lowGrid * lowGrid;
        const sums = new Float64Array(channels);
        for (let hz = 0; hz < highGrid; hz += 1) {
          for (let hy = 0; hy < highGrid; hy += 1) {
            for (let hx = 0; hx < highGrid; hx += 1) {
              const weight = weights[lz][hz] * weights[ly][hy] * weights[lx][hx];
              if (weight === 0) continue;
              const highCell = hx + hy * highGrid + hz * highGrid * highGrid;
              for (let channel = 0; channel < channels; channel += 1) {
                sums[channel] += values[highCell * channels + channel] * weight;
              }
            }
          }
        }
        for (let channel = 0; channel < channels; channel += 1) {
          output[lowCell * channels + channel] = sums[channel];
        }
      }
    }
  }
  return output;
}

const highGrid = 5;
const receiverGrid = 3;
const highFluidT = highValues(highGrid, fluidChannels.length, 0);
const highFluidT1 = highValues(highGrid, fluidChannels.length, 1);
const highFrontT = highValues(highGrid, 1, 0);
const highFrontT1 = highValues(highGrid, 1, 1);
const filteredFluidT = boxAverage(highFluidT, highGrid, receiverGrid, fluidChannels.length);
const filteredFrontT = boxAverage(highFrontT, highGrid, receiverGrid, 1);
const filteredFluidT1 = boxAverage(highFluidT1, highGrid, receiverGrid, fluidChannels.length);
const filteredFrontT1 = boxAverage(highFrontT1, highGrid, receiverGrid, 1);
const ordinaryFluidT1 = Float32Array.from(filteredFluidT1, (value, index) => value - 0.0025 * ((index % fluidChannels.length) + 1));
const ordinaryFrontT1 = Float32Array.from(filteredFrontT1, value => value - 0.006);

const basinBytes = Buffer.from('{"identity":"contract-exact-basin"}\n');
const basinPath = join(inputDir, 'basin.json');
await writeFile(basinPath, basinBytes);

const pair = {
  id: 'pair-000',
  highT: {
    simStepCount: 10,
    fluid: await writeArtifact('high-t-fluid', highFluidT, [highGrid, highGrid, highGrid, fluidChannels.length]),
    front: await writeArtifact('high-t-front', highFrontT, [highGrid, highGrid, highGrid, 1]),
  },
  highT1: {
    simStepCount: 11,
    fluid: await writeArtifact('high-t1-fluid', highFluidT1, [highGrid, highGrid, highGrid, fluidChannels.length]),
    front: await writeArtifact('high-t1-front', highFrontT1, [highGrid, highGrid, highGrid, 1]),
  },
  ordinaryLowT1: {
    simStepCount: 1,
    initializationAuthority: 'receiver-initialized-from-filtered-high-t-v0',
    fluid: await writeArtifact('ordinary-low-t1-fluid', ordinaryFluidT1, [receiverGrid, receiverGrid, receiverGrid, fluidChannels.length]),
    front: await writeArtifact('ordinary-low-t1-front', ordinaryFrontT1, [receiverGrid, receiverGrid, receiverGrid, 1]),
  },
};

pair.ordinaryLowT1.initializedFrom = {
  identity: 'receiver-initialized-from-filtered-high-t-v0',
  highT: {
    simStepCount: pair.highT.simStepCount,
    fluidSha256: pair.highT.fluid.sha256,
    frontSha256: pair.highT.front.sha256,
  },
  filterIdentity: 'volume-overlap-box-filter-high-to-receiver-v0',
  receiverGrid,
  layoutIdentity: 'x-fastest-zyx-c-interleaved-v0',
  receiverInitialSimStepCount: 0,
  receiverInitialT: {
    fluid: await writeArtifact('receiver-initial-t-fluid', filteredFluidT, [receiverGrid, receiverGrid, receiverGrid, fluidChannels.length]),
    front: await writeArtifact('receiver-initial-t-front', filteredFrontT, [receiverGrid, receiverGrid, receiverGrid, 1]),
  },
};

const inputPath = join(inputDir, 'manifest.json');
const inputManifest = {
  schema: 'kaminos.volume.coarse-closure-corpus.v0',
  identity: 'phase-aligned-filtered-high-low-step-corpus-v0',
  basin: { path: basinPath, sha256: sha256(basinBytes), identity: 'contract-exact-basin' },
  route: {
    requested: 'contract-route', effective: 'native-3d-compute-fluid-raymarch-v0', backend: 'WebGPU:contract',
    learnedSplatModelIdentity: 'sha256:contract-model',
  },
  grids: { high: highGrid, receiver: receiverGrid },
  layout: { order: 'x-fastest-zyx-c-interleaved-v0', fluidChannels, frontChannels: ['frontTopology'] },
  pairs: [pair],
};

const invalidProvenanceManifest = structuredClone(inputManifest);
invalidProvenanceManifest.pairs[0].ordinaryLowT1.initializedFrom.highT.fluidSha256 = '0'.repeat(64);
await writeFile(inputPath, `${JSON.stringify(invalidProvenanceManifest, null, 2)}\n`);
const provenanceFailedReportPath = join(provenanceFailedOutDir, 'manifest.json');
const rejectProvenance = spawnSync('python3', [scriptUrl.pathname, '--input', inputPath, '--out-dir', provenanceFailedOutDir, '--report', provenanceFailedReportPath], { encoding: 'utf8' });
assert.equal(rejectProvenance.status, 2, 'receiver provenance must bind the exact source high-t state');
const provenanceFailedReport = JSON.parse(await readFile(provenanceFailedReportPath, 'utf8'));
assert.equal(provenanceFailedReport.failurePhase, 'input-validation');
assert.match(provenanceFailedReport.reason, /initializedFrom highT fluid sha256 mismatch/);

const invalidInitializationManifest = structuredClone(inputManifest);
const independentInitialFluid = Float32Array.from(filteredFluidT, value => value + 0.125);
invalidInitializationManifest.pairs[0].ordinaryLowT1.initializedFrom.receiverInitialT.fluid = await writeArtifact(
  'independent-receiver-initial-t-fluid',
  independentInitialFluid,
  [receiverGrid, receiverGrid, receiverGrid, fluidChannels.length],
);
await writeFile(inputPath, `${JSON.stringify(invalidInitializationManifest, null, 2)}\n`);
const initializationFailedReportPath = join(initializationFailedOutDir, 'manifest.json');
const rejectInitialization = spawnSync('python3', [scriptUrl.pathname, '--input', inputPath, '--out-dir', initializationFailedOutDir, '--report', initializationFailedReportPath], { encoding: 'utf8' });
assert.equal(rejectInitialization.status, 2, 'valid independent receiver bytes must not impersonate filtered high-t initialization');
const initializationFailedReport = JSON.parse(await readFile(initializationFailedReportPath, 'utf8'));
assert.equal(initializationFailedReport.failurePhase, 'input-validation');
assert.match(initializationFailedReport.reason, /receiverInitialT fluid does not equal filtered highT/);

for (const [ordinaryStep, label] of [[0, 'held receiver'], [2, 'two-step receiver']]) {
  const wrongStepManifest = structuredClone(inputManifest);
  wrongStepManifest.pairs[0].ordinaryLowT1.simStepCount = ordinaryStep;
  await writeFile(inputPath, `${JSON.stringify(wrongStepManifest, null, 2)}\n`);
  const wrongStepOutDir = join(root, `wrong-step-${ordinaryStep}`);
  await mkdir(wrongStepOutDir);
  const wrongStepReportPath = join(wrongStepOutDir, 'manifest.json');
  const rejectWrongStep = spawnSync('python3', [scriptUrl.pathname, '--input', inputPath, '--out-dir', wrongStepOutDir, '--report', wrongStepReportPath], { encoding: 'utf8' });
  assert.equal(rejectWrongStep.status, 2, `${label} cannot impersonate ordinaryLowT1`);
  const wrongStepReport = JSON.parse(await readFile(wrongStepReportPath, 'utf8'));
  assert.equal(wrongStepReport.failurePhase, 'input-validation');
  assert.match(wrongStepReport.reason, /ordinary low state is not one step after receiver initialization/);
}

await writeFile(inputPath, `${JSON.stringify(inputManifest, null, 2)}\n`);

const reportPath = join(outDir, 'manifest.json');
const run = spawnSync('python3', [scriptUrl.pathname, '--input', inputPath, '--out-dir', outDir, '--report', reportPath], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.status, 'captured');
assert.equal(report.applicationAuthority, 'offline-oracle-training-and-diagnostic-only');
assert.equal(report.runtimeTruthAvailable, false);
assert.deepEqual(report.roleOrder, ['filteredHighT', 'ordinaryLowT1', 'exactClosureResidual', 'oracleApplied', 'filteredHighT1']);
assert.equal(report.pairs.length, 1);
assert.ok(report.pairs[0].metrics.global.baselineRmse > 0);
assert.ok(report.pairs[0].metrics.global.holdRmse > 0);
assert.ok(Number.isFinite(report.pairs[0].metrics.global.receiverStepDirectionCosine));
assert.ok(Number.isFinite(report.pairs[0].metrics.global.ordinaryVsHoldRmseRatio));
assert.ok(Math.abs(report.pairs[0].metrics.global.ordinaryVsHoldRmseRatio - 0.6259928891998702) < 1e-12);
assert.ok(Math.abs(report.pairs[0].metrics.global.errorReductionVsHoldFraction - 0.3740071108001298) < 1e-12);
assert.ok(report.pairs[0].metrics.global.oracleRmse < 1e-7);
assert.ok(report.pairs[0].metrics.global.rmseReductionFraction > 0.999999);
assert.equal(report.pairs[0].channels.length, fluidChannels.length + 1);
assert.ok(report.pairs[0].channels.every(channel => channel.hold.rmse > 0));
assert.ok(report.pairs[0].channels.every(channel => Number.isFinite(channel.receiverStep.directionCosine)));
assert.ok(report.pairs[0].channels.every(channel => Number.isFinite(channel.receiverStep.ordinaryVsHoldRmseRatio)));
assert.equal(report.pairs[0].artifacts.exactClosureResidual.fluid.shape.at(-1), fluidChannels.length);
assert.equal(report.pairs[0].artifacts.filteredHighT1.front.shape.at(-1), 1);
assert.equal(report.pairs[0].sourceSteps.ordinaryLowInitializedFrom.highT.fluidSha256, pair.highT.fluid.sha256);
assert.equal(report.pairs[0].sourceSteps.ordinaryLowInitializedFrom.receiverInitialT.fluid.sha256, sha256(floatsToBytes(filteredFluidT)));
assert.equal(report.pairs[0].sourceSteps.ordinaryLowInitializedFrom.filterAgreement.fluid.identity, 'float32-one-ulp-at-unit-floor-v0');
assert.ok(report.pairs[0].sourceSteps.ordinaryLowInitializedFrom.filterAgreement.fluid.maxAbs > 0, '5-to-3 fixture exercises cross-implementation float drift');
assert.ok(report.pairs[0].sourceSteps.ordinaryLowInitializedFrom.filterAgreement.fluid.maxAbs <= report.pairs[0].sourceSteps.ordinaryLowInitializedFrom.filterAgreement.fluid.maxAllowed);

const expectedClosureFluid = Float32Array.from(filteredFluidT1, (value, index) => value - ordinaryFluidT1[index]);
const expectedClosureFront = Float32Array.from(filteredFrontT1, (value, index) => value - ordinaryFrontT1[index]);
assertFloatsClose(await readFloats(report.pairs[0].artifacts.filteredHighT.fluid.path), filteredFluidT, 'filtered high t fluid golden');
assertFloatsClose(await readFloats(report.pairs[0].artifacts.filteredHighT.front.path), filteredFrontT, 'filtered high t front golden');
assertFloatsClose(await readFloats(report.pairs[0].artifacts.filteredHighT1.fluid.path), filteredFluidT1, 'filtered high t1 fluid golden');
assertFloatsClose(await readFloats(report.pairs[0].artifacts.filteredHighT1.front.path), filteredFrontT1, 'filtered high t1 front golden');
assertFloatsClose(await readFloats(report.pairs[0].artifacts.exactClosureResidual.fluid.path), expectedClosureFluid, 'closure fluid golden');
assertFloatsClose(await readFloats(report.pairs[0].artifacts.exactClosureResidual.front.path), expectedClosureFront, 'closure front golden');

await writeFile(pair.highT1.fluid.path, Buffer.alloc(pair.highT1.fluid.byteLength, 0xff));
const failedReportPath = join(failedOutDir, 'manifest.json');
const reject = spawnSync('python3', [scriptUrl.pathname, '--input', inputPath, '--out-dir', failedOutDir, '--report', failedReportPath], { encoding: 'utf8' });
assert.equal(reject.status, 2, 'corrupt source array must fail validation');
const failedReport = JSON.parse(await readFile(failedReportPath, 'utf8'));
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.failurePhase, 'input-validation');
assert.match(failedReport.reason, /sha256 mismatch/);
assert.ok(failedReport.lastTrustworthyEvidence.inputManifestSha256);

console.log('coarse closure oracle contracts passed');

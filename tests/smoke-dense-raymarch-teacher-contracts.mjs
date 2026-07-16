import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const teacherUrl = new URL('../smoke-dense-raymarch-teacher.mjs', import.meta.url);
const {
  SMOKE_DENSE_RAYMARCH_TEACHER_IDENTITY,
  renderDenseSmokeRaymarchTeacher,
  writeDenseSmokeRaymarchFailureReport,
} = await import(teacherUrl);

assert.equal(SMOKE_DENSE_RAYMARCH_TEACHER_IDENTITY, 'smoke-dense-state-raymarch-teacher-v0');

const channels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeFitSource(directory, { blank = false, native = false, physicalResidual = false } = {}) {
  await mkdir(directory, { recursive: true });
  const grid = 12;
  const values = new Float32Array(grid ** 3 * channels.length);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const nx = (x + 0.5) / grid * 2 - 1;
        const ny = (y + 0.5) / grid * 2 - 1;
        const nz = (z + 0.5) / grid * 2 - 1;
        const offset = ((z * grid * grid) + (y * grid) + x) * channels.length;
        if (!blank && nx * nx + ny * ny + nz * nz < 0.28) {
          values[offset + 4] = 0.8;
          if (physicalResidual) {
            values[offset + 7] = 0.5;
            values[offset + 12] = 0.6;
            values[offset + 13] = 0.7;
          }
        }
      }
    }
  }
  const fluidBytes = Buffer.from(values.buffer);
  const fluidPath = join(directory, 'fluid.f32');
  await writeFile(fluidPath, fluidBytes);
  const camera = {
    position: [0, 0, 3],
    target: [0, 0, 0],
    projectionMatrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, -101 / 99, -1,
      0, 0, -200 / 99, 0,
    ],
    matrixWorldInverse: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -3, 1,
    ],
  };
  const report = {
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    hiddenBudgetCapApplied: false,
    teacher: {
      sourceSchema: native ? 'kaminos.volume.full-grid-field-export.v0' : 'kaminos.volume.operator-basin-replay.v0',
      manifestIdentity: `sha256:${'a'.repeat(64)}`,
      fluidPath,
      fluidIdentity: `sha256:${sha256(fluidBytes)}`,
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
      grid,
      worldSpace: {
        coordinateFrame: native ? 'kaminos-volume-world-v0' : 'kaminos-normalized-volume-local-v0',
        transformAuthority: native ? 'native-volume-grid-world-transform-v0' : 'operator-basin-normalized-volume-domain-v0',
        bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
      },
      camera,
      cameraIdentity: `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`,
    },
  };
  const fitReportPath = join(directory, 'oracle-fit-report.json');
  await writeFile(fitReportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { fitReportPath, fluidPath };
}

const directory = await mkdtemp(join(tmpdir(), 'kaminos-dense-smoke-raymarch-'));
try {
  const source = await writeFitSource(join(directory, 'source'));
  const report = await renderDenseSmokeRaymarchTeacher({
    fitReportPath: source.fitReportPath,
    outDir: join(directory, 'teacher'),
    width: 48,
    height: 48,
    samplesPerCell: 1,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.identity, SMOKE_DENSE_RAYMARCH_TEACHER_IDENTITY);
  assert.equal(report.source.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.match(report.source.cameraIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.raymarch.requestedSamplesPerCell, 1);
  assert.equal(report.raymarch.effectiveSamplesPerCell, 1);
  assert.equal(report.pixelStats.blank, false);
  assert.ok(report.pixelStats.maximumOpticalDepth > 0);
  assert.ok(report.pixelStats.centerOpticalDepth > report.pixelStats.cornerOpticalDepth);
  assert.equal(report.artifacts.opticalDepth.byteLength, 48 * 48 * 4);
  assert.equal(report.artifacts.transmittance.byteLength, 48 * 48 * 4);
  assert.equal(report.artifacts.linearRadiance.byteLength, 48 * 48 * 4);
  assert.ok(existsSync(report.artifacts.displayPng.path));
  assert.equal((await readFile(report.artifacts.displayPng.path)).readUInt32BE(0), 0x89504e47, 'display witness must be a valid PNG');

  const physicalSource = await writeFitSource(join(directory, 'physical-source'), { physicalResidual: true });
  const smokeDensityReport = await renderDenseSmokeRaymarchTeacher({
    fitReportPath: physicalSource.fitReportPath,
    outDir: join(directory, 'smoke-density-teacher'),
    width: 32,
    height: 32,
    samplesPerCell: 1,
    extinctionFieldModel: 'smoke-density-v0',
  });
  const physicalReport = await renderDenseSmokeRaymarchTeacher({
    fitReportPath: physicalSource.fitReportPath,
    outDir: join(directory, 'physical-extinction-teacher'),
    width: 32,
    height: 32,
    samplesPerCell: 1,
    extinctionFieldModel: 'physical-smoke-extinction-v0',
  });
  assert.equal(smokeDensityReport.raymarch.extinctionFieldModel, 'smoke-density-v0');
  assert.deepEqual(smokeDensityReport.raymarch.extinctionFieldWeights, { smokeDensity: 1 });
  assert.equal(physicalReport.raymarch.extinctionFieldModel, 'physical-smoke-extinction-v0');
  assert.deepEqual(physicalReport.raymarch.extinctionFieldWeights, {
    smokeDensity: 0.74,
    microdetail: 0.42,
    interfaceShred: 0.34,
    detail: 0.12,
  });
  assert.ok(
    physicalReport.pixelStats.centerOpticalDepth > smokeDensityReport.pixelStats.centerOpticalDepth,
    'the physical teacher must integrate omitted smoke carriers instead of silently falling back to smokeDensity',
  );
  await assert.rejects(
    () => renderDenseSmokeRaymarchTeacher({
      fitReportPath: physicalSource.fitReportPath,
      outDir: join(directory, 'unknown-extinction-model'),
      width: 16,
      height: 16,
      extinctionFieldModel: 'unknown-v0',
    }),
    /extinction field model/i,
    'an unknown extinction model must fail loud instead of selecting a default field',
  );

  const nativeSource = await writeFitSource(join(directory, 'native-source'), { native: true });
  const nativeReport = await renderDenseSmokeRaymarchTeacher({
    fitReportPath: nativeSource.fitReportPath,
    outDir: join(directory, 'native-teacher'),
    width: 32,
    height: 32,
    samplesPerCell: 1,
  });
  assert.equal(nativeReport.status, 'passed', 'checksum-bound native full-grid fields must support hostile-view dense teachers');

  const changed = JSON.parse(await readFile(source.fitReportPath, 'utf8'));
  changed.teacher.fluidIdentity = `sha256:${'0'.repeat(64)}`;
  await writeFile(source.fitReportPath, `${JSON.stringify(changed, null, 2)}\n`);
  await assert.rejects(
    () => renderDenseSmokeRaymarchTeacher({
      fitReportPath: source.fitReportPath,
      outDir: join(directory, 'wrong-checksum'),
      width: 16,
      height: 16,
    }),
    /fluid identity mismatch/i,
    'a changed or substituted dense field cannot become a raymarch teacher',
  );

  const blank = await writeFitSource(join(directory, 'blank'), { blank: true });
  await assert.rejects(
    () => renderDenseSmokeRaymarchTeacher({
      fitReportPath: blank.fitReportPath,
      outDir: join(directory, 'blank-output'),
      width: 16,
      height: 16,
    }),
    /blank optical output/i,
    'blank dense output must fail instead of becoming a teacher witness',
  );

  const failurePath = join(directory, 'durable-failure', 'dense-raymarch-teacher-report.json');
  const failure = await writeDenseSmokeRaymarchFailureReport({
    reportPath: failurePath,
    failurePhase: 'source-validation',
    fitReportPath: source.fitReportPath,
    lastTrustworthyEvidence: { manifestIdentity: `sha256:${'a'.repeat(64)}` },
    cause: 'synthetic checksum failure',
  });
  assert.equal(failure.status, 'failed');
  assert.equal(existsSync(failurePath), true);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke dense raymarch teacher contracts passed');

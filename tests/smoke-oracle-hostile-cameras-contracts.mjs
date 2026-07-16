import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const moduleUrl = new URL('../smoke-oracle-hostile-cameras.mjs', import.meta.url);
const { buildSmokeOracleHostileCameraSplit } = await import(moduleUrl);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const directory = await mkdtemp(join(tmpdir(), 'kaminos-hostile-cameras-'));
try {
  const camera = {
    position: [-4, 2, 8],
    target: [0, 0, 0],
    projectionMatrix: [1.9, 0, 0, 0, 0, 2.7, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.020002, 0],
    matrixWorldInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -9, 1],
  };
  const fit = {
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    hiddenBudgetCapApplied: false,
    teacher: {
      sourceSchema: 'kaminos.volume.operator-basin-replay.v0',
      manifestIdentity: `sha256:${'a'.repeat(64)}`,
      fluidIdentity: `sha256:${'b'.repeat(64)}`,
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      worldSpace: { transformAuthority: 'operator-basin-normalized-volume-domain-v0' },
      camera,
      cameraIdentity: `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`,
    },
    requestedBudgets: [1024],
    budgetCurve: [{
      requestedBudget: 1024,
      activeGaussianCount: 1024,
      artifact: { path: 'budget-1024.gaussians.f32' },
    }],
  };
  const artifactPath = join(directory, 'budget-1024.gaussians.f32');
  await writeFile(artifactPath, Buffer.alloc(1024 * 28 * 4));
  const fitReportPath = join(directory, 'oracle-fit-report.json');
  await writeFile(fitReportPath, `${JSON.stringify(fit, null, 2)}\n`);
  const originalBytes = await readFile(fitReportPath);
  const split = await buildSmokeOracleHostileCameraSplit({ fitReportPath, outDir: join(directory, 'split') });
  assert.equal(split.status, 'passed');
  assert.deepEqual(split.cameraSplit.calibrationCameraIds, ['recorded-native']);
  assert.deepEqual(split.cameraSplit.heldOutCameraIds, ['side-plus-90', 'back-plus-180', 'elevated-plus-35']);
  assert.equal(split.cameraSplit.overlap, 0);
  assert.equal(split.products.length, 4);
  assert.deepEqual(await readFile(fitReportPath), originalBytes, 'camera split must not mutate the source fit report');
  const sourceRadius = Math.hypot(...camera.position.map((value, axis) => value - camera.target[axis]));
  for (const product of split.products) {
    const derived = JSON.parse(await readFile(product.fitReportPath, 'utf8'));
    assert.equal(derived.teacher.cameraIdentity, product.cameraIdentity);
    assert.equal(product.cameraIdentity, `sha256:${sha256(Buffer.from(JSON.stringify(derived.teacher.camera)))}`);
    assert.equal(derived.teacher.manifestIdentity, fit.teacher.manifestIdentity);
    assert.equal(derived.teacher.fluidIdentity, fit.teacher.fluidIdentity);
    assert.equal(derived.cameraEvaluation.cameraId, product.cameraId);
    assert.equal(derived.cameraEvaluation.fitAuthority, 'world-space-state-fit-camera-independent-v0');
    assert.equal(isAbsolute(derived.budgetCurve[0].artifact.path), true, 'derived camera reports must not strand relative artifact paths under deeper directories');
    assert.equal(derived.budgetCurve[0].artifact.path, resolve(artifactPath));
    if (product.cameraId !== 'elevated-plus-35') {
      const radius = Math.hypot(...derived.teacher.camera.position.map((value, axis) => value - camera.target[axis]));
      assert.ok(Math.abs(radius - sourceRadius) < 1e-10, `${product.cameraId} must preserve camera radius`);
    }
  }

  const nativeFit = structuredClone(fit);
  nativeFit.teacher.sourceSchema = 'kaminos.volume.full-grid-field-export.v0';
  nativeFit.teacher.worldSpace.transformAuthority = 'native-volume-grid-world-transform-v0';
  const nativeFitReportPath = join(directory, 'native-oracle-fit-report.json');
  await writeFile(nativeFitReportPath, `${JSON.stringify(nativeFit, null, 2)}\n`);
  const nativeSplit = await buildSmokeOracleHostileCameraSplit({
    fitReportPath: nativeFitReportPath,
    outDir: join(directory, 'native-split'),
  });
  assert.equal(nativeSplit.status, 'passed', 'checksum-bound native full-grid captures must support hostile camera derivation');
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke oracle hostile camera contracts passed');

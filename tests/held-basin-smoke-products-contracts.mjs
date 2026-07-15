import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../held-basin-smoke-products.mjs', import.meta.url);
const {
  buildHeldSmokeHierarchyProduct,
  compileHeldSmokeHierarchyProduct,
  writeHeldSmokeHierarchyArtifacts,
} = await import(moduleUrl);

const channels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

function makeFrame() {
  const grid = 8;
  const field = new Float32Array(grid ** 3 * channels.length);
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const offset = (x + y * grid + z * grid * grid) * channels.length;
        const smoke = x > 0 && y > 0 && z > 0 ? 0.1 + y * 0.04 : 0;
        field[offset] = x * 0.01;
        field[offset + 1] = 0.3 + smoke;
        field[offset + 2] = z * -0.01;
        field[offset + 4] = smoke;
        field[offset + 5] = Math.max(0, 0.7 - y * 0.04);
        field[offset + 7] = x % 2 === 0 ? 0.8 : 0.05;
        field[offset + 12] = z % 2 === 0 ? 0.7 : 0.05;
        field[offset + 13] = (x + z) % 3 === 0 ? 0.9 : 0.05;
      }
    }
  }
  return {
    sourceSchema: 'kaminos.volume.operator-basin-replay.v0',
    captureId: 'operator-held-fixture',
    simStepCount: 179290,
    manifestIdentity: `sha256:${'a'.repeat(64)}`,
    sourceCaptureIdentity: `sha256:${'b'.repeat(64)}`,
    cameraIdentity: `sha256:${'c'.repeat(64)}`,
    fluidIdentity: `sha256:${'d'.repeat(64)}`,
    grid,
    field,
    manifest: {
      effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
    },
  };
}

const model = JSON.parse(await readFile(
  new URL('../artifacts/smoke-spatial-strata-v2-0713/sparse-fine-selector.json', import.meta.url),
  'utf8',
));
const config = {
  coarseBlockSize: 4,
  fineBlockSize: 2,
  extinctionCoefficient: 1.35,
  fineMassFraction: 0.5,
  articulationThreshold: 0.5,
  coarseAnchorMassRatio: 0.8,
  coarseStratumSize: 2,
  fineOccupancyMassRatio: 0.4,
  capacity: null,
};

const built = buildHeldSmokeHierarchyProduct({ frame: makeFrame(), model, config });
assert.equal(built.schema, 'kaminos.held-smoke-hierarchy-product.v0');
assert.equal(built.status, 'compiled');
assert.equal(built.source.manifestIdentity, `sha256:${'a'.repeat(64)}`);
assert.equal(built.source.simStepCount, 179290);
assert.equal(built.source.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
assert.equal(built.model.identity, model.identity);
assert.equal(built.product.producerKind, 'learned-sparse-residual-plus-conserved-coarse');
assert.equal(built.product.payloadIdentity, `sha256:${'d'.repeat(64)}`);
assert.equal(built.product.capacity.outputWasTruncated, false);
assert.equal(built.product.capacity.overflowCount, 0);
assert.ok(built.product.hierarchyCounts.coarse > 0);
assert.ok(built.product.sourceStatistics.occupiedFineBinCount > 0);
assert.equal(built.product.accounting.rejectedExtinctionMass, 0);

const wrongRoute = makeFrame();
wrongRoute.manifest.effectiveRoute = 'cached-smoke-demo-v0';
assert.throws(
  () => buildHeldSmokeHierarchyProduct({ frame: wrongRoute, model, config }),
  /wrong effective route/i,
  'a fallback source route cannot inherit the held-basin product identity',
);

const wrongSchema = makeFrame();
wrongSchema.sourceSchema = 'kaminos.volume.controls-only.v0';
assert.throws(
  () => buildHeldSmokeHierarchyProduct({ frame: wrongSchema, model, config }),
  /operator-basin-replay/i,
  'controls-only state cannot impersonate a checksum-bound evolved field',
);

assert.throws(
  () => buildHeldSmokeHierarchyProduct({
    frame: makeFrame(),
    model: { ...model, identity: `sha256:${'e'.repeat(64)}` },
    config,
  }),
  /model identity mismatch/i,
  'mutated selector contents cannot retain the source model identity',
);

assert.throws(
  () => buildHeldSmokeHierarchyProduct({
    frame: makeFrame(),
    model,
    config: { ...config, capacity: 0 },
  }),
  /capacity overflow.*refusing/i,
  'a caller capacity cannot silently truncate a larger smoke product',
);

assert.equal(typeof compileHeldSmokeHierarchyProduct, 'function');
assert.equal(typeof writeHeldSmokeHierarchyArtifacts, 'function');
const outputRoot = await mkdtemp(join(tmpdir(), 'kaminos-held-route-b-'));
try {
  const written = await writeHeldSmokeHierarchyArtifacts(built, join(outputRoot, 'captured'));
  assert.equal(written.status, 'captured');
  assert.equal(written.product.activeCount, built.product.hierarchyCounts.total);
  assert.equal(written.product.outputWasTruncated, false);
  assert.match(written.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await stat(written.artifact.path)).size, written.artifact.byteLength);
  assert.equal(JSON.parse(await readFile(written.reportPath, 'utf8')).status, 'captured');

  const failedOut = join(outputRoot, 'failed');
  await assert.rejects(
    () => compileHeldSmokeHierarchyProduct({
      manifestPath: join(outputRoot, 'missing-viewer-manifest.json'),
      expectedManifestSha256: 'a'.repeat(64),
      modelPath: join(outputRoot, 'missing-selector.json'),
      expectedModelSha256: 'b'.repeat(64),
      outDir: failedOut,
    }),
    /ENOENT/,
  );
  const failure = JSON.parse(await readFile(join(failedOut, 'route-b-report.json'), 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'teacher-load');
  assert.equal(failure.requested.manifestSha256, 'a'.repeat(64));
  assert.equal(failure.requested.modelSha256, 'b'.repeat(64));
  assert.equal(failure.lastTrustworthyEvidence.primaryArtifactWritten, false);
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

console.log('held basin smoke product contracts passed');

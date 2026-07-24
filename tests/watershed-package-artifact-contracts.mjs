import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const producerRevision = '854c57ee7086783c0b0d099058a2c985b71168cd';
const packageModule = await import('@kaminos/fluid-webgpu');

assert.equal(
  packageModule.KAMINOS_FLUID_PACKAGE_DESCRIPTOR_SCHEMA,
  'kaminos.fluid.package-descriptor.v1',
  'the canonical package publishes a versioned descriptor schema',
);
assert.deepEqual(packageModule.KAMINOS_FLUID_PACKAGE_DESCRIPTOR, {
  schema: 'kaminos.fluid.package-descriptor.v1',
  sourceAuthority: 'live_runtime',
  fallbackStatus: 'none',
  packageName: '@kaminos/fluid-webgpu',
  packageVersion: '0.3.0',
  artifactRevision: '@kaminos/fluid-webgpu@0.3.0',
  runtimeRevision: producerRevision,
  cacheKey: `@kaminos/fluid-webgpu@0.3.0:${producerRevision}`,
  runtimeRoute: 'kaminos/fluid/mapped-orthogonal-heightfield-hll-reference-v1',
  representationRoutes: ['kaminos/fluid/representation-frame'],
  sourceRoutes: ['kaminos/fluid/portable-macro-source'],
  outputRoutes: ['kaminos/fluid/terrain-feedback'],
}, 'the package descriptor carries executable identity without pretending to know its enclosing tarball SRI');
assert.equal(
  packageModule.createKaminosFluidRuntime,
  packageModule.createMappedMacroRuntime,
  'the canonical package exposes one stable runtime-factory export',
);
assert.equal(
  Object.hasOwn(packageModule.KAMINOS_FLUID_PACKAGE_DESCRIPTOR, 'integrity'),
  false,
  'runtime descriptor identity must not contain the self-referential tarball integrity',
);
assert.equal(
  Object.hasOwn(packageModule.KAMINOS_FLUID_PACKAGE_DESCRIPTOR, 'cacheStatus'),
  false,
  'runtime code must not impersonate the installer-owned cache-freshness decision',
);

const packageRoot = mkdtempSync(join(tmpdir(), 'kaminos-fluid-package-contract-'));
const consumerRoot = join(packageRoot, 'consumer');
try {
  const packResult = JSON.parse(execFileSync(process.execPath, [
    'scripts/pack-fluid-webgpu.mjs',
    '--repo-root', root,
    '--destination', packageRoot,
  ], { cwd: root, encoding: 'utf8' }))[0];
  const tarball = join(packageRoot, packResult.filename);
  assert.equal(packResult.name, '@kaminos/fluid-webgpu');
  assert.equal(packResult.version, '0.3.0');
  assert.match(packResult.integrity, /^sha512-/);
  assert.equal(packResult.bundled.includes('@kaminos/fluid-contracts'), true, 'the installable artifact bundles its private contract dependency');
  assert.equal(packResult.manifest.schema, 'kaminos.fluid.package-artifact-manifest.v1');
  assert.equal(packResult.buildRoute.requestedRepoRoot, root);
  assert.equal(packResult.buildRoute.effectiveRepoRoot, resolve(root));
  const manifest = JSON.parse(readFileSync(join(packageRoot, packResult.manifest.filename), 'utf8'));
  assert.equal(manifest.status, 'complete');
  assert.equal(Object.hasOwn(manifest, 'requestedRepoRoot'), false, 'portable artifact evidence does not embed an ephemeral checkout path');
  assert.equal(Object.hasOwn(manifest, 'effectiveRepoRoot'), false, 'portable artifact evidence does not present a stale build checkout as a live route');
  assert.equal(manifest.artifactRevision, '@kaminos/fluid-webgpu@0.3.0');
  assert.equal(manifest.artifact.filename, packResult.filename);
  assert.equal(manifest.artifact.integrity, packResult.integrity);
  assert.equal(manifest.runtimeRevision, producerRevision);
  assert.equal(manifest.runtimeRoute, packageModule.KAMINOS_FLUID_PACKAGE_DESCRIPTOR.runtimeRoute);
  assert.deepEqual(manifest.sourceRoutes, ['kaminos/fluid/portable-macro-source']);

  execFileSync('mkdir', ['-p', consumerRoot]);
  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'watershed-package-artifact-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@kaminos/fluid-webgpu': `file:${tarball}`,
    },
  }, null, 2));
  execFileSync('npm', ['install', '--ignore-scripts'], { cwd: consumerRoot, stdio: 'pipe' });
  const installedPackage = JSON.parse(readFileSync(join(consumerRoot, 'node_modules/@kaminos/fluid-webgpu/package.json'), 'utf8'));
  assert.equal(installedPackage.version, '0.3.0');
  const installedContractsPackage = JSON.parse(readFileSync(join(
    consumerRoot,
    'node_modules/@kaminos/fluid-webgpu/node_modules/@kaminos/fluid-contracts/package.json',
  ), 'utf8'));
  assert.equal(installedContractsPackage.version, '0.3.0');
  const installedModule = await import(pathToFileURL(join(consumerRoot, 'node_modules/@kaminos/fluid-webgpu/mapped-macro-core.js')));
  const installedContracts = await import(pathToFileURL(join(
    consumerRoot,
    'node_modules/@kaminos/fluid-webgpu/node_modules/@kaminos/fluid-contracts/index.js',
  )));
  assert.equal(installedModule.KAMINOS_FLUID_PACKAGE_DESCRIPTOR.runtimeRevision, producerRevision);
  assert.equal(typeof installedModule.createKaminosFluidRuntime, 'function');
  const terrainFrame = (priorEpoch, currentEpoch, motionClass, bedHeight, supportSpeed = 0) => (
    installedContracts.createTerrainFluidFrame({
      requestedRoute: 'test/clean-install-hill-frame',
      effectiveRoute: 'test/clean-install-hill-frame',
      producerId: 'clean-install-hill',
      producerRevision: `clean-install-hill-${currentEpoch}`,
      requestedSourceId: 'clean-install-live-hill',
      effectiveSourceId: 'clean-install-live-hill',
      worldMetersPerUnit: 1,
      gravity: [0, -9.81, 0],
      terrainId: 'clean-install-hills',
      supportClass: 'heightfield',
      transformId: 'clean-install-chart-v1',
      priorEpoch,
      currentEpoch,
      motionClass,
      grid: { width: 1, height: 1, spacing: [0.25, 0.25], origin: [0, 0, 0] },
      fields: {
        bedHeight: new Float64Array([bedHeight]),
        worldPosition: new Float64Array([0, bedHeight, 0]),
        jacobian: new Float64Array([1]),
        gradient: new Float64Array(2),
        tangentU: new Float64Array([1, 0, 0]),
        tangentV: new Float64Array([0, 0, 1]),
        normal: new Float64Array([0, 1, 0]),
        supportVelocity: new Float64Array([0, supportSpeed, 0]),
        valid: new Uint8Array([1]),
      },
      dirtyRegions: [{ x: 0, y: 0, width: 1, height: 1 }],
      motionSubstepEnvelope: motionClass === 'phase_morph' ? 1 / 60 : null,
      complete: true,
    })
  );
  const initialTerrain = terrainFrame(0, 1, 'stable', 0);
  const installedRuntime = installedModule.createKaminosFluidRuntime({
    terrainFrame: initialTerrain,
    depth: new Float64Array([0.1]),
    producerRevision,
  });
  const installedRemapReceipt = installedRuntime.updateTerrain({
    terrainFrame: terrainFrame(1, 2, 'phase_morph', 0.01, 0.6),
    deltaSeconds: 1 / 60,
    maximumBedDisplacement: 0.02,
    maximumSupportSpeed: 1,
  });
  assert.equal(installedRemapReceipt.schema, 'kaminos.fluid.terrain-remap-receipt.v1');
  assert.equal(installedRemapReceipt.state, 'committed');
  assert.equal(installedRuntime.identity.terrainEpoch, 2);
  const installedSourceHandle = installedRuntime.retainPortableMacroSource({
    sourceHandleId: 'clean-install-portable-source',
    requestedRoute: installedModule.PORTABLE_MACRO_SOURCE_ROUTE,
    effectiveRoute: installedModule.PORTABLE_MACRO_SOURCE_ROUTE,
  });
  const installedSourceSnapshot = installedSourceHandle.read({
    minimumTerrainEpoch: 2,
    minimumFluidEpoch: installedRuntime.identity.fluidEpoch,
  });
  assert.equal(
    installedModule.validatePortableMacroSourceSnapshot(installedSourceSnapshot),
    installedSourceSnapshot,
  );
  assert.equal(installedSourceSnapshot.sourceHandleId, 'clean-install-portable-source');
  assert.equal(installedSourceSnapshot.supportGeometry.worldPosition.length, 3);
  assert.equal(installedSourceSnapshot.macro.mappedDepth.length, 1);
  assert.equal(installedSourceHandle.release(), true);

  const lock = JSON.parse(readFileSync(join(consumerRoot, 'package-lock.json'), 'utf8'));
  const lockEntry = lock.packages['node_modules/@kaminos/fluid-webgpu'];
  assert.equal(lockEntry.version, '0.3.0');
  assert.match(lockEntry.integrity, /^sha512-/);
  assert.ok(lockEntry.resolved, 'clean-checkout evidence records the resolved artifact');

  assert.throws(() => execFileSync(process.execPath, [
    'scripts/pack-fluid-webgpu.mjs',
    '--repo-root', join(packageRoot, 'missing-repo'),
    '--destination', packageRoot,
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe' }));
  const failureReportPath = join(packageRoot, 'kaminos-fluid-webgpu-build-report.json');
  assert.equal(existsSync(failureReportPath), true, 'pre-artifact failures still write a durable build report');
  const failureReport = JSON.parse(readFileSync(failureReportPath, 'utf8'));
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.phase, 'validate-source');
  assert.equal(failureReport.lastTrustworthyEvidence, 'canonical-output-quarantined');
  assert.equal(existsSync(join(packageRoot, packResult.manifest.filename)), false, 'failed rebuild cannot leave the prior complete manifest at the canonical path');
  assert.equal(existsSync(tarball), false, 'failed rebuild cannot leave the prior tarball at the canonical path');
  assert.deepEqual(
    failureReport.quarantinedOutputs.map((entry) => entry.filename).sort(),
    [packResult.filename, packResult.manifest.filename].sort(),
    'failure evidence identifies both quarantined prior-success outputs',
  );
} finally {
  rmSync(packageRoot, { recursive: true, force: true });
}

console.log('watershed package artifact contracts ok');

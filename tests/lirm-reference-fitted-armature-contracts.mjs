import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  REFERENCE_FIT_CAMERAS,
  REFERENCE_FIT_PARAMETER_SPECS,
  assertReferenceFitCameraSplit,
  createReferenceFitAssayPlan,
  recordReferenceFitVisualInspection,
  renderReferenceArmature,
  runReferenceFittedArmatureAssay,
  validateReferenceFitReport,
} = await import('../lirm-reference-fitted-armature-core.mjs');

assert.equal(REFERENCE_FIT_CAMERAS.length, 8);
assert.equal(new Set(REFERENCE_FIT_CAMERAS.map(camera => camera.id)).size, 8);
assert.deepEqual(
  REFERENCE_FIT_CAMERAS.map(camera => camera.id),
  ['az000', 'az045', 'az090', 'az135', 'az180', 'az225', 'az270', 'az315'],
);
assert.ok(REFERENCE_FIT_CAMERAS.every(camera => camera.projection === 'orthographic'));
assert.ok(REFERENCE_FIT_CAMERAS.every(camera => Number.isFinite(camera.yaw) && Number.isFinite(camera.pitch)));

const fitViewIds = ['az000', 'az090', 'az180', 'az270'];
const heldOutViewIds = ['az045', 'az135', 'az225', 'az315'];
assert.doesNotThrow(() => assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds }));
assert.throws(
  () => assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds: ['az000', 'az135', 'az225', 'az315'] }),
  /overlap/,
);
assert.throws(
  () => assertReferenceFitCameraSplit({ fitViewIds, heldOutViewIds: ['az045', 'az135', 'az225'] }),
  /cover all eight/,
);
assert.throws(
  () => assertReferenceFitCameraSplit({ fitViewIds: ['front', 'az090', 'az180', 'az270'], heldOutViewIds }),
  /unknown camera/,
);

assert.ok(REFERENCE_FIT_PARAMETER_SPECS.length >= 10);
assert.equal(new Set(REFERENCE_FIT_PARAMETER_SPECS.map(spec => spec.id)).size, REFERENCE_FIT_PARAMETER_SPECS.length);
for (const spec of REFERENCE_FIT_PARAMETER_SPECS) {
  assert.match(spec.id, /^[a-z][a-zA-Z0-9]*$/);
  assert.ok(Number.isFinite(spec.initial));
  assert.ok(Number.isFinite(spec.min) && Number.isFinite(spec.max) && spec.min < spec.max);
  assert.ok(spec.initial > spec.min && spec.initial < spec.max, `${spec.id} must start away from its bounds`);
  assert.ok(Number.isFinite(spec.step) && spec.step > 0);
  assert.ok(typeof spec.semanticRole === 'string' && spec.semanticRole.length > 0);
}

const plan = createReferenceFitAssayPlan({
  donorPath: '/durable/donor.glb',
  donorSha256: 'sha256:abc123',
  fitViewIds,
  heldOutViewIds,
});
assert.equal(plan.schema, 'kaminos.lirm-reference-fitted-armature-plan.v0');
assert.equal(plan.requestedRoute, 'kaminos/reference-fitted-armature/software-glb-raster-plus-sdf-fit-v0');
assert.equal(plan.donor.path, '/durable/donor.glb');
assert.equal(plan.donor.sha256, 'sha256:abc123');
assert.deepEqual(plan.fitViewIds, fitViewIds);
assert.deepEqual(plan.heldOutViewIds, heldOutViewIds);
assert.deepEqual(plan.requestedCameraIds, REFERENCE_FIT_CAMERAS.map(camera => camera.id));
assert.equal(plan.evidencePredicate.allowCameraFallback, false);
assert.equal(plan.evidencePredicate.allowMissingOrPartialDonorEvidence, false);
assert.equal(plan.falseClosureGuards.productionCreatureClaim, 'forbidden');
assert.equal(plan.falseClosureGuards.meshCopyClaim, 'forbidden');

const initialParameters = Object.fromEntries(REFERENCE_FIT_PARAMETER_SPECS.map(spec => [spec.id, spec.initial]));
const render = renderReferenceArmature({
  parameters: initialParameters,
  camera: REFERENCE_FIT_CAMERAS[0],
  width: 24,
  height: 24,
});
assert.equal(render.cameraId, 'az000');
assert.equal(render.width, 24);
assert.equal(render.height, 24);
assert.equal(render.mask.length, 24 * 24);
assert.equal(render.depth.length, 24 * 24);
assert.ok(render.mask.some(Boolean), 'semantic SDF armature must produce foreground');
assert.ok(render.semanticRoles.includes('bodyMass'));
assert.ok(render.semanticRoles.includes('headOrientation'));
assert.ok(render.semanticRoles.includes('contactLimb'));

const failureDir = await mkdtemp(join(tmpdir(), 'kaminos-reference-fit-missing-donor-'));
await assert.rejects(
  () => runReferenceFittedArmatureAssay({
    donorPath: join(failureDir, 'missing.glb'),
    outDir: failureDir,
    fitViewIds,
    heldOutViewIds,
    width: 24,
    height: 24,
  }),
  /missing donor/,
);
const failurePath = join(failureDir, 'report.json');
assert.ok(existsSync(failurePath), 'failure before primary output must still write report.json');
const failure = JSON.parse(readFileSync(failurePath, 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'donor-admission');
assert.equal(failure.lastTrustworthyEvidence, 'camera split validated; donor not yet admitted');
assert.deepEqual(failure.requestedCameraIds, REFERENCE_FIT_CAMERAS.map(camera => camera.id));
assert.equal(failure.effectiveCameraIds, null);
assert.equal(failure.outputInventory.primaryWitness, null);

const reportFixture = {
  schema: 'kaminos.lirm-reference-fitted-armature-assay.v0',
  status: 'assay-passed-uninspected',
  requestedRoute: 'kaminos/reference-fitted-armature/software-glb-raster-plus-sdf-fit-v0',
  effectiveRoute: 'kaminos/reference-fitted-armature/software-glb-raster-plus-sdf-fit-v0',
  requestedCameraIds: REFERENCE_FIT_CAMERAS.map(camera => camera.id),
  effectiveCameraIds: REFERENCE_FIT_CAMERAS.map(camera => camera.id),
  fitViewIds,
  heldOutViewIds,
  donor: { path: '/durable/donor.glb', sha256: 'sha256:abc', triangleCount: 100 },
  initialParameters,
  fittedParameters: initialParameters,
  parameterSpecs: REFERENCE_FIT_PARAMETER_SPECS,
  metrics: {
    initial: { heldOut: { meanIou: 0.4, meanDepthMae: 0.2, byView: Object.fromEntries(heldOutViewIds.map(id => [id, { iou: 0.4 }])) } },
    fitted: { heldOut: { meanIou: 0.6, meanDepthMae: 0.1, byView: Object.fromEntries(heldOutViewIds.map(id => [id, { iou: 0.6 }])) } },
  },
  acceptance: { heldOutSilhouetteImprovementCount: 4, heldOutDepthImproved: true, visualInspection: 'pending' },
  outputInventory: {
    primaryWitness: { path: '/durable/silhouette.png', bytes: 100 },
    depthWitness: { path: '/durable/depth.png', bytes: 100 },
    donorEvidence: REFERENCE_FIT_CAMERAS.map(camera => ({ cameraId: camera.id })),
  },
};
assert.doesNotThrow(() => validateReferenceFitReport(reportFixture, { requireFiles: false }));
assert.throws(
  () => validateReferenceFitReport({ ...reportFixture, effectiveCameraIds: reportFixture.effectiveCameraIds.slice(0, 7) }, { requireFiles: false }),
  /effective camera coverage/,
);
assert.throws(
  () => validateReferenceFitReport({ ...reportFixture, donor: { ...reportFixture.donor, sha256: null } }, { requireFiles: false }),
  /donor hash/,
);
assert.throws(
  () => validateReferenceFitReport({ ...reportFixture, status: 'assay-passed-inspected' }, { requireFiles: false }),
  /inspection disposition/,
);

const inspectionDir = await mkdtemp(join(tmpdir(), 'kaminos-reference-fit-inspection-'));
const inspectionReportPath = join(inspectionDir, 'report.json');
await import('node:fs/promises').then(({ writeFile }) => Promise.all([
  writeFile(inspectionReportPath, `${JSON.stringify(reportFixture, null, 2)}\n`),
  writeFile(join(inspectionDir, 'silhouette.png'), Buffer.from('visual witness')),
  writeFile(join(inspectionDir, 'depth.png'), Buffer.from('depth witness')),
]));
const localFixture = {
  ...reportFixture,
  outputInventory: {
    ...reportFixture.outputInventory,
    primaryWitness: { path: join(inspectionDir, 'silhouette.png'), bytes: 14 },
    depthWitness: { path: join(inspectionDir, 'depth.png'), bytes: 13 },
  },
};
await import('node:fs/promises').then(({ writeFile }) => writeFile(inspectionReportPath, `${JSON.stringify(localFixture, null, 2)}\n`));
const inspected = await recordReferenceFitVisualInspection({
  reportPath: inspectionReportPath,
  disposition: 'accepted',
  visibleDelta: 'Fitted silhouette visibly approaches donor across all eight exact cameras.',
  limitations: ['semantic detail remains intentionally absent'],
});
assert.equal(inspected.status, 'assay-passed-inspected');
assert.equal(inspected.acceptance.visualInspection.disposition, 'accepted');
assert.equal(inspected.acceptance.visualInspection.artifacts.length, 2);
assert.ok(inspected.acceptance.visualInspection.artifacts.every(item => item.sha256.startsWith('sha256:')));

console.log('LIRM reference-fitted armature contracts passed');

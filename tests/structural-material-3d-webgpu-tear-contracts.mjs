import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildLayeredStructuralWitnessScenario,
  createLayeredStructuralMaterial,
} from '../structural-material-3d-core.js';
import {
  buildLayeredStructuralCpuSequenceOracle,
  layeredStructuralInteractionSequenceIdentity,
} from '../structural-material-3d-webgpu-retained.js';

const root = new URL('..', import.meta.url).pathname;
const tearCorePath = join(root, 'structural-material-3d-webgpu-tear.js');
const tearWitnessPath = join(root, 'structural-material-3d-webgpu-tear-witness.mjs');
const retainedCorePath = join(root, 'structural-material-3d-webgpu-retained.js');
const pagePath = join(root, 'structural-material-3d.html');

assert.ok(existsSync(tearCorePath), 'GPU-authored sympathetic tear core exists');
assert.ok(existsSync(tearWitnessPath), 'GPU-authored sympathetic tear has a reusable browser witness');

const {
  STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
  STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_VISUAL_AUTHORITY,
  buildLayeredStructuralCpuComponentOracle,
  buildLayeredStructuralGpuTearMaterial,
  compareLayeredStructuralGpuComponentParity,
  createLayeredStructuralGpuTearRequestGate,
} = await import('../structural-material-3d-webgpu-tear.js');

assert.equal(
  STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
  'kaminos.structural-material.webgpu-sympathetic-tear.v0',
);
assert.equal(
  STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_VISUAL_AUTHORITY,
  'gpu-component-label-to-visible-separation-v0',
);

const tearSource = readFileSync(tearCorePath, 'utf8');
const witnessSource = readFileSync(tearWitnessPath, 'utf8');
const retainedSource = readFileSync(retainedCorePath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');
assert.match(retainedSource, /topologyDispatchCount/, 'tear receipt exposes topology dispatch work');
assert.match(tearSource, /finalBondLiveness/, 'tear bridge consumes GPU-returned bond liveness');
assert.match(tearSource, /componentLabels/, 'tear bridge consumes GPU-returned component labels');
assert.match(witnessSource, /notchedControlDiscriminates/, 'browser witness rejects geometry-independent breakup');
assert.match(witnessSource, /visibleTransformBoundToGpuLabels/, 'browser witness binds visible transforms to GPU labels');
assert.match(witnessSource, /releasePreservedSeparation/, 'browser witness checks persistent release state');
assert.match(witnessSource, /interactiveValidation/, 'product witness requires compact hot-route validation');
assert.match(witnessSource, /hotResidency/, 'product witness proves the live WebGPU sidecar remains resident');
assert.match(witnessSource, /screenshotPixelProbe/, 'browser witness inspects the actual screenshot pixels');
assert.match(
  witnessSource,
  /visualDeadline/,
  'browser witness retries compositor capture within the caller-owned timeout budget',
);
assert.match(pageSource, /__structuralMaterial3dRunGpuSympatheticTear/, '3D route exposes the product-level GPU tear');
assert.match(pageSource, /pointerup/, 'effigy drag release remains the world-consequence boundary');
assert.match(
  pageSource,
  /querySelector\('#bind'\)\.addEventListener\('click',[\s\S]*?gpuTearRequestGate\.invalidate\(\);[\s\S]*?requestGpuBinding/,
  'Bind invalidates pending GPU tear completion before requesting resident connectivity repair',
);

const requestGate = createLayeredStructuralGpuTearRequestGate();
const staleToken = requestGate.begin();
const concurrentToken = requestGate.begin();
assert.equal(
  requestGate.accepts(staleToken) && requestGate.accepts(concurrentToken),
  true,
  'same-generation structural interactions remain accepted for ordered application',
);
let staleCompletionApplied = false;
const staleCompletion = Promise.resolve().then(() => {
  if (requestGate.accepts(staleToken)) staleCompletionApplied = true;
});
requestGate.invalidate();
await staleCompletion;
assert.equal(staleCompletionApplied, false, 'completion captured before Bind-style invalidation cannot apply');
const currentToken = requestGate.begin();
assert.equal(requestGate.accepts(currentToken), true, 'new request after invalidation remains current');

const scenario = buildLayeredStructuralWitnessScenario();
const notched = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: true });
const unnotched = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: false });
const interactions = [scenario.force];
const sequenceIdentity = layeredStructuralInteractionSequenceIdentity(interactions);
const notchedSequence = buildLayeredStructuralCpuSequenceOracle(notched, interactions);
const unnotchedSequence = buildLayeredStructuralCpuSequenceOracle(unnotched, interactions);
const notchedComponents = buildLayeredStructuralCpuComponentOracle(
  notched,
  notchedSequence.finalBondLiveness,
);
const unnotchedComponents = buildLayeredStructuralCpuComponentOracle(
  unnotched,
  unnotchedSequence.finalBondLiveness,
);

assert.ok(notchedComponents.componentCount >= 2, 'notched same-force control produces detached topology');
assert.equal(unnotchedComponents.componentCount, 1, 'unnotched same-force control remains one component');
assert.equal(notchedComponents.labels.length, notched.nodes.length);
for (const component of notchedComponents.components) {
  assert.equal(
    component.label,
    Math.min(...component.nodeIndices),
    'component identity is the deterministic minimum node index',
  );
}
assert.equal(
  compareLayeredStructuralGpuComponentParity(notchedComponents, notchedComponents.labels).ok,
  true,
  'exact component labels satisfy the independent topology oracle',
);
const substitutedLabels = [...notchedComponents.labels];
substitutedLabels[substitutedLabels.findIndex(label => label !== notchedComponents.anchoredComponentLabel)] =
  notchedComponents.anchoredComponentLabel;
assert.equal(
  compareLayeredStructuralGpuComponentParity(notchedComponents, substitutedLabels).ok,
  false,
  'one substituted detached label cannot pass topology parity',
);

const exactReceipt = {
  schema: 'kaminos.structural-material.webgpu-sympathetic-tear-receipt.v0',
  status: 'passed',
  requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
  effectiveRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
  requestedBackend: 'webgpu',
  effectiveBackend: 'webgpu',
  cpuFallbackUsed: false,
  requestedSequenceIdentity: sequenceIdentity,
  effectiveSequenceIdentity: sequenceIdentity,
  topology: {
    parity: { ok: true, labelsMatch: true },
    componentCount: notchedComponents.componentCount,
    anchoredComponentLabel: notchedComponents.anchoredComponentLabel,
    detachedComponentLabels: [...notchedComponents.detachedComponentLabels],
    topologyDispatchCount: notched.nodes.length,
  },
  gpuStructuralState: {
    finalBondLiveness: [...notchedSequence.finalBondLiveness],
    componentLabels: [...notchedComponents.labels],
  },
};

const firstGestureForce = { ...scenario.force, gestureId: 'gesture-1' };
const torn = buildLayeredStructuralGpuTearMaterial(notched, exactReceipt, firstGestureForce);
assert.equal(torn.sympatheticTear.authority, STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_VISUAL_AUTHORITY);
assert.equal(torn.sympatheticTear.effectiveRoute, STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE);
assert.equal(torn.components.length, notchedComponents.componentCount);
assert.equal(torn.bonds.filter(bond => !bond.alive).length, notchedSequence.finalBondLiveness.filter(alive => !alive).length);
assert.ok(torn.sympatheticTear.detachedNodeCount > 0, 'GPU labels identify visible detached nodes');

const directionLength = Math.hypot(scenario.force.vector.x, scenario.force.vector.y, scenario.force.vector.z);
const direction = {
  x: scenario.force.vector.x / directionLength,
  y: scenario.force.vector.y / directionLength,
  z: scenario.force.vector.z / directionLength,
};
for (const node of torn.nodes) {
  const dot = node.displacement.x * direction.x +
    node.displacement.y * direction.y +
    node.displacement.z * direction.z;
  if (node.pinned) {
    assert.deepEqual(node.displacement, { x: 0, y: 0, z: 0 }, 'anchored nodes remain fixed');
  } else if (node.componentId !== `g${notchedComponents.anchoredComponentLabel}`) {
    assert.ok(dot > 0, 'detached component moves along the causative drag direction');
  }
}

const persisted = buildLayeredStructuralGpuTearMaterial(torn, exactReceipt, firstGestureForce);
assert.deepEqual(
  persisted.nodes.map(node => node.displacement),
  torn.nodes.map(node => node.displacement),
  'reapplying the same GPU tear receipt preserves rather than compounds separation',
);
assert.equal(
  persisted.topologyEpoch,
  torn.topologyEpoch,
  'reapplying the same GPU tear receipt does not claim a new topology transition',
);
assert.equal(
  persisted.connectivityEpoch,
  torn.connectivityEpoch,
  'reapplying the same GPU tear receipt does not claim a new connectivity transition',
);

const secondSequenceIdentity = `${sequenceIdentity}:gesture-2`;
const secondReceipt = {
  ...exactReceipt,
  eventEpoch: 2,
  requestedSequenceIdentity: secondSequenceIdentity,
  effectiveSequenceIdentity: secondSequenceIdentity,
};
const secondGestureForce = {
  ...scenario.force,
  gestureId: 'gesture-2',
  vector: { x: 0, y: 1, z: 0 },
  magnitude: 0.72,
};
const continued = buildLayeredStructuralGpuTearMaterial(torn, secondReceipt, secondGestureForce);
assert.equal(
  continued.topologyEpoch,
  torn.topologyEpoch,
  'a visual-only second gesture with unchanged liveness does not advance topology epoch',
);
assert.equal(
  continued.connectivityEpoch,
  torn.connectivityEpoch,
  'a visual-only second gesture with unchanged liveness does not advance connectivity epoch',
);
for (let index = 0; index < torn.nodes.length; index += 1) {
  const before = torn.nodes[index];
  const after = continued.nodes[index];
  if (before.componentId === `g${notchedComponents.anchoredComponentLabel}`) continue;
  assert.equal(
    after.displacement.x,
    before.displacement.x,
    'a distinct second gesture preserves the first accepted displacement axis',
  );
  assert.ok(
    after.displacement.y > before.displacement.y,
    'a distinct second gesture composes its new displacement from the prior endpoint',
  );
}
const continuedReplay = buildLayeredStructuralGpuTearMaterial(
  continued,
  secondReceipt,
  secondGestureForce,
);
assert.deepEqual(
  continuedReplay.nodes.map(node => node.displacement),
  continued.nodes.map(node => node.displacement),
  'replaying a second-gesture receipt remains idempotent',
);

const invalidLiveness = [...exactReceipt.gpuStructuralState.finalBondLiveness];
invalidLiveness[0] = 1;
assert.throws(
  () => buildLayeredStructuralGpuTearMaterial(torn, {
    ...exactReceipt,
    gpuStructuralState: {
      ...exactReceipt.gpuStructuralState,
      finalBondLiveness: invalidLiveness,
    },
  }, firstGestureForce),
  /invalid bond liveness/,
  'the material-authoring boundary rejects non-boolean GPU liveness',
);

assert.throws(
  () => buildLayeredStructuralGpuTearMaterial(notched, {
    ...exactReceipt,
    effectiveRoute: 'kaminos.structural-material.wrong-route.v0',
  }, scenario.force),
  /effective route/,
  'a substituted structural route cannot author visible separation',
);
assert.throws(
  () => buildLayeredStructuralGpuTearMaterial(notched, {
    ...exactReceipt,
    topology: { ...exactReceipt.topology, parity: { ok: false, labelsMatch: false } },
  }, scenario.force),
  /topology parity/,
  'unverified component labels cannot author visible separation',
);

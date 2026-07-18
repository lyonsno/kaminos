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
assert.match(witnessSource, /contactLocalityMovedGpuBreakCentroid/, 'browser witness rejects x-invariant GPU breakup');
assert.match(witnessSource, /contactOwnedVisibleResponseMoved/, 'browser witness rejects right-only visible response');
assert.match(witnessSource, /leftContactRenderedMotionTimeline/, 'browser witness rejects unexplained movement in intermediate accepted interactions');
assert.match(witnessSource, /displacedPickPreservedRestIdentity/, 'browser witness rejects displaced display coordinates used as rest contact');
assert.match(witnessSource, /interactiveValidation/, 'product witness requires compact hot-route validation');
assert.match(witnessSource, /hotResidency/, 'product witness proves the live WebGPU sidecar remains resident');
assert.match(witnessSource, /screenshotPixelProbe/, 'browser witness inspects the actual screenshot pixels');
assert.match(
  witnessSource,
  /visualDeadline/,
  'browser witness retries compositor capture within the caller-owned timeout budget',
);
assert.match(pageSource, /__structuralMaterial3dRunGpuSympatheticTear/, '3D route exposes the product-level GPU tear');
assert.match(pageSource, /__structuralMaterial3dRunGpuContactLocalityWitness/, '3D route exposes reset-identical resident GPU contact locality evidence');
assert.match(pageSource, /__structuralMaterial3dPickTargets/, '3D route exposes projected structural targets for adversarial displaced-pick evidence');
assert.match(pageSource, /renderedMotionLedger/, '3D route preserves every accepted rendered-motion transition');
assert.match(pageSource, /renderedStructuralNodeSnapshot/, 'motion ledger reads actual Three.js node positions');
assert.match(pageSource, /renderedMotionTimeline/, 'operator witness exposes the full rendered-motion timeline');
assert.match(
  pageSource,
  /gpu-tear-operation-\$\{operationId\}/,
  'programmatic accepted GPU mutations carry stable operation identity into the motion ledger',
);
assert.match(pageSource, /pointerup/, 'effigy drag release remains the world-consequence boundary');
assert.match(
  pageSource,
  /querySelector\('#bind'\)\.addEventListener\('click', \(\) => \{\s*selectStructuralInteractionMode\('bind'\);\s*\}\);/,
  'Bind selection changes operation mode without immediately repairing connectivity',
);
assert.match(pageSource, /function selectStructuralInteractionMode[\s\S]*?cancelMaterialGesture\(\)/, 'mode changes invalidate pending opposite-mode gesture work');
assert.match(pageSource, /interaction\.operationMode === 'bind'[\s\S]*?requestGpuBinding/, 'a picked Bind gesture reaches resident connectivity repair');

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

function buildConnectedReceipt(state, identity) {
  const connected = buildLayeredStructuralCpuComponentOracle(
    state,
    state.bonds.map(bond => bond.alive),
  );
  assert.equal(connected.componentCount, 1, 'contact-response fixture begins connected');
  return {
    ...exactReceipt,
    requestedSequenceIdentity: identity,
    effectiveSequenceIdentity: identity,
    topology: {
      ...exactReceipt.topology,
      componentCount: connected.componentCount,
      anchoredComponentLabel: connected.anchoredComponentLabel,
      detachedComponentLabels: [],
    },
    gpuStructuralState: {
      finalBondLiveness: state.bonds.map(bond => bond.alive),
      componentLabels: connected.labels,
    },
  };
}

function displacementCentroidX(state) {
  let weightedX = 0;
  let totalWeight = 0;
  state.nodes.forEach(node => {
    const weight = Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z);
    weightedX += node.x * weight;
    totalWeight += weight;
  });
  return totalWeight > 0 ? weightedX / totalWeight : null;
}

const connectedReceipt = buildConnectedReceipt(notched, 'contact-owned-response-connected');
const leftContactNode = notched.nodes.find(node => node.id === 'n55');
const rightContactNode = notched.nodes.find(node => node.id === 'n61');
const contactForce = (node, gestureId) => ({
  kind: 'camera-relative-picked-layered-drag',
  gestureId,
  point: { x: node.x, y: node.y, z: node.z },
  displayPoint: { x: node.x, y: node.y, z: node.z },
  contactIdentity: {
    authority: 'stable-rest-material-contact-v0',
    kind: 'node',
    id: node.id,
    segmentT: null,
  },
  vector: { x: 1, y: 0.08, z: -0.64 },
  magnitude: 1.46,
  radius: 0.18,
});
const leftContactResponse = buildLayeredStructuralGpuTearMaterial(
  notched,
  connectedReceipt,
  contactForce(leftContactNode, 'left-contact-response'),
);
const rightContactResponse = buildLayeredStructuralGpuTearMaterial(
  notched,
  connectedReceipt,
  contactForce(rightContactNode, 'right-contact-response'),
);
const pinnedContactNode = notched.nodes.find(node => node.id === 'n54');
const pinnedContactResponse = buildLayeredStructuralGpuTearMaterial(
  notched,
  connectedReceipt,
  contactForce(pinnedContactNode, 'pinned-contact-response'),
);
assert.ok(
  Math.hypot(
    pinnedContactResponse.nodes.find(node => node.id === pinnedContactNode.id).displacement.x,
    pinnedContactResponse.nodes.find(node => node.id === pinnedContactNode.id).displacement.y,
    pinnedContactResponse.nodes.find(node => node.id === pinnedContactNode.id).displacement.z,
  ) > 0,
  'a directly manipulated contact temporarily supersedes its authored support pin',
);
assert.deepEqual(
  pinnedContactResponse.sympatheticTear.contactResponse.kinematicOverridePinnedNodeIds,
  [pinnedContactNode.id],
  'the visible response names the exact authored pin superseded by hand contact',
);
for (const node of pinnedContactResponse.nodes) {
  if (node.pinned && node.id !== pinnedContactNode.id) {
    assert.deepEqual(node.displacement, { x: 0, y: 0, z: 0 }, 'all non-contact support pins remain fixed');
  }
}
const pinnedBond = notched.bonds.find(bond => {
  const a = notched.nodes.find(node => node.id === bond.a);
  const b = notched.nodes.find(node => node.id === bond.b);
  return a.pinned && b.pinned;
});
const pinnedBondA = notched.nodes.find(node => node.id === pinnedBond.a);
const pinnedBondB = notched.nodes.find(node => node.id === pinnedBond.b);
const pinnedBondContact = {
  ...contactForce(pinnedBondA, 'pinned-bond-contact-response'),
  point: {
    x: (pinnedBondA.x + pinnedBondB.x) * 0.5,
    y: (pinnedBondA.y + pinnedBondB.y) * 0.5,
    z: (pinnedBondA.z + pinnedBondB.z) * 0.5,
  },
  contactIdentity: {
    authority: 'stable-rest-material-contact-v0',
    kind: 'bond',
    id: pinnedBond.id,
    segmentT: 0.5,
  },
};
const pinnedBondResponse = buildLayeredStructuralGpuTearMaterial(
  notched,
  connectedReceipt,
  pinnedBondContact,
);
assert.deepEqual(
  [...pinnedBondResponse.sympatheticTear.contactResponse.kinematicOverridePinnedNodeIds].sort(),
  [pinnedBond.a, pinnedBond.b].sort(),
  'a picked support bond temporarily supersedes both endpoint pins',
);
for (const nodeId of [pinnedBond.a, pinnedBond.b]) {
  const node = pinnedBondResponse.nodes.find(candidate => candidate.id === nodeId);
  assert.ok(
    Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z) > 0,
    'the rendered support-bond contact follows the hand at both endpoints',
  );
}
assert.ok(
  leftContactResponse.nodes.some(node => !node.pinned && Math.hypot(
    node.displacement.x,
    node.displacement.y,
    node.displacement.z,
  ) > 0),
  'a left contact visibly deforms nearby unpinned material even while its component remains anchored',
);
for (const node of [...leftContactResponse.nodes, ...rightContactResponse.nodes]) {
  if (node.pinned) {
    assert.deepEqual(node.displacement, { x: 0, y: 0, z: 0 }, 'authored pins remain exactly fixed');
  }
}
const leftResponseCentroidX = displacementCentroidX(leftContactResponse);
const rightResponseCentroidX = displacementCentroidX(rightContactResponse);
assert.ok(Number.isFinite(leftResponseCentroidX) && Number.isFinite(rightResponseCentroidX));
assert.ok(
  rightResponseCentroidX > leftResponseCentroidX + 0.35,
  'force-equivalent left and right contacts materially move the visible-response centroid',
);
assert.equal(
  leftContactResponse.sympatheticTear.contactResponse.primaryContactComponentLabel,
  connectedReceipt.topology.anchoredComponentLabel,
  'visible response records the GPU-labeled component that owns the accepted contact',
);
assert.equal(
  leftContactResponse.sympatheticTear.contactResponse.contactIdentity.id,
  leftContactNode.id,
  'visible response preserves the stable picked structural identity',
);

const splitBond = notched.bonds.find(bond => bond.id === 'b52');
const splitBondAIndex = notched.nodes.findIndex(node => node.id === splitBond.a);
const splitBondBIndex = notched.nodes.findIndex(node => node.id === splitBond.b);
assert.notEqual(
  notchedComponents.labels[splitBondAIndex],
  notchedComponents.labels[splitBondBIndex],
  'split-bond fixture endpoints land in distinct post-fracture GPU components',
);
const splitBondInteraction = segmentT => ({
  ...scenario.force,
  gestureId: `split-bond-${segmentT}`,
  point: {
    x: notched.nodes[splitBondAIndex].x +
      (notched.nodes[splitBondBIndex].x - notched.nodes[splitBondAIndex].x) * segmentT,
    y: notched.nodes[splitBondAIndex].y +
      (notched.nodes[splitBondBIndex].y - notched.nodes[splitBondAIndex].y) * segmentT,
    z: notched.nodes[splitBondAIndex].z +
      (notched.nodes[splitBondBIndex].z - notched.nodes[splitBondAIndex].z) * segmentT,
  },
  contactIdentity: {
    authority: 'stable-rest-material-contact-v0',
    kind: 'bond',
    id: splitBond.id,
    segmentT,
  },
});
const splitNearA = buildLayeredStructuralGpuTearMaterial(
  notched,
  exactReceipt,
  splitBondInteraction(0.25),
);
const splitNearB = buildLayeredStructuralGpuTearMaterial(
  notched,
  exactReceipt,
  splitBondInteraction(0.75),
);
const labelA = notchedComponents.labels[splitBondAIndex];
const labelB = notchedComponents.labels[splitBondBIndex];
assert.deepEqual(
  splitNearA.sympatheticTear.contactResponse.contactComponentLabels,
  [labelA, labelB].sort((a, b) => a - b),
  'split bond preserves both endpoint component labels as contact provenance',
);
assert.equal(
  splitNearA.sympatheticTear.contactResponse.primaryContactComponentLabel,
  labelA,
  'segment contact near endpoint A selects only endpoint A component as primary',
);
assert.equal(
  splitNearB.sympatheticTear.contactResponse.primaryContactComponentLabel,
  labelB,
  'segment contact near endpoint B selects only endpoint B component as primary',
);
const responseMagnitudeForLabel = (state, label) => {
  const node = state.nodes.find(candidate => candidate.componentId === `g${label}` && !candidate.pinned);
  return Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z);
};
const assertDisplacementUnchanged = (actual, expected, message) => {
  assert.ok(
    ['x', 'y', 'z'].every(axis => Math.abs(actual[axis] - expected[axis]) < 1e-12),
    message,
  );
};
const labelBSecondaryMagnitude = responseMagnitudeForLabel(splitNearA, labelB);
const labelBPrimaryMagnitude = responseMagnitudeForLabel(splitNearB, labelB);
assert.equal(
  labelBSecondaryMagnitude,
  0,
  'a detached non-primary split endpoint preserves its accepted baseline exactly',
);
assert.ok(
  labelBPrimaryMagnitude > 0,
  'selecting the detached split endpoint gives that component primary movement',
);

const splitNearASecondReceipt = {
  ...exactReceipt,
  eventEpoch: 2,
  requestedSequenceIdentity: `${sequenceIdentity}:split-near-a-2`,
  effectiveSequenceIdentity: `${sequenceIdentity}:split-near-a-2`,
};
const splitNearASecondForce = {
  ...splitBondInteraction(0.25),
  gestureId: 'split-near-a-2',
  vector: { x: 0, y: 1, z: 0 },
};
const splitNearAContinued = buildLayeredStructuralGpuTearMaterial(
  splitNearA,
  splitNearASecondReceipt,
  splitNearASecondForce,
);
for (let index = 0; index < splitNearA.nodes.length; index += 1) {
  if (splitNearA.nodes[index].componentId !== `g${labelB}`) continue;
  assertDisplacementUnchanged(
    splitNearAContinued.nodes[index].displacement,
    splitNearA.nodes[index].displacement,
    'a second gesture on endpoint A cannot accumulate movement on detached endpoint B',
  );
}
const splitNearBThenA = buildLayeredStructuralGpuTearMaterial(
  splitNearB,
  splitNearASecondReceipt,
  splitNearASecondForce,
);
assert.ok(
  responseMagnitudeForLabel(splitNearB, labelB) > 0,
  'the first gesture establishes a nonzero accepted baseline on endpoint B',
);
for (let index = 0; index < splitNearB.nodes.length; index += 1) {
  if (splitNearB.nodes[index].componentId !== `g${labelB}`) continue;
  assertDisplacementUnchanged(
    splitNearBThenA.nodes[index].displacement,
    splitNearB.nodes[index].displacement,
    'switching primary ownership to endpoint A preserves endpoint B historical displacement',
  );
}

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
const tornPrimaryComponentId = `g${torn.sympatheticTear.contactResponse.primaryContactComponentLabel}`;
for (const node of torn.nodes) {
  const dot = node.displacement.x * direction.x +
    node.displacement.y * direction.y +
    node.displacement.z * direction.z;
  if (node.pinned) {
    assert.deepEqual(node.displacement, { x: 0, y: 0, z: 0 }, 'anchored nodes remain fixed');
  } else if (node.componentId === tornPrimaryComponentId) {
    assert.ok(dot > 0, 'the detached primary component moves along the causative drag direction');
  } else if (node.componentId !== `g${notchedComponents.anchoredComponentLabel}`) {
    assertDisplacementUnchanged(
      node.displacement,
      { x: 0, y: 0, z: 0 },
      'detached non-primary components preserve their accepted baseline',
    );
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
const continuedPrimaryComponentId =
  `g${continued.sympatheticTear.contactResponse.primaryContactComponentLabel}`;
let continuedPrimaryMovedNodeCount = 0;
for (let index = 0; index < torn.nodes.length; index += 1) {
  const before = torn.nodes[index];
  const after = continued.nodes[index];
  if (before.pinned) continue;
  if (before.componentId !== continuedPrimaryComponentId) {
    assertDisplacementUnchanged(
      after.displacement,
      before.displacement,
      'a distinct gesture preserves every non-primary component baseline exactly',
    );
    continue;
  }
  assert.equal(after.displacement.x, before.displacement.x);
  if (after.displacement.y > before.displacement.y) continuedPrimaryMovedNodeCount += 1;
}
assert.ok(
  continuedPrimaryMovedNodeCount > 0,
  'a distinct second gesture composes movement on its primary component',
);
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

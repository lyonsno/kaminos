import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const auditPath = join(root, 'structural-material-3d-motion-audit.js');

assert.ok(existsSync(auditPath), 'rendered structural motion audit module exists');

const {
  STRUCTURAL_MATERIAL_3D_MOTION_AUDIT_AUTHORITY,
  assessStableNodeDisplacementContinuity,
  buildRenderedStructuralMotionEntry,
  buildRenderedStructuralMotionTimeline,
} = await import('../structural-material-3d-motion-audit.js');

const node = (id, x, componentId, displacement = { x: 0, y: 0, z: 0 }, pinned = false) => ({
  id,
  x,
  y: 0,
  z: 0,
  componentId,
  displacement,
  pinned,
});
const rendered = (id, x) => ({
  id,
  actualWorldPosition: { x, y: 0, z: 0 },
  expectedWorldPosition: { x, y: 0, z: 0 },
});
const interaction = {
  kind: 'camera-relative-picked-layered-drag',
  gestureId: 'left-drag',
  contactIdentity: { kind: 'node', id: 'n1' },
  point: { x: 0.25, y: 0, z: 0 },
  vector: { x: 1, y: 0, z: 0 },
  magnitude: 1,
};

const previousState = {
  nodes: [
    node('n0', 0, 'g0', { x: 0.1, y: 0, z: 0 }, true),
    node('n1', 0.25, 'g0', { x: 0.1, y: 0, z: 0 }),
    node('n2', 1, 'g4', { x: 0.4, y: 0, z: 0 }),
  ],
};
const nextState = {
  nodes: [
    node('n0', 0, 'g0', { x: 0.1, y: 0, z: 0 }, true),
    node('n1', 0.25, 'g0', { x: 0.2, y: 0, z: 0 }),
    node('n2', 1, 'g4', { x: 0.4, y: 0, z: 0 }),
  ],
  visualDisplacementGesture: {
    gestureId: 'left-drag',
    baselineDisplacements: [
      { x: 0.1, y: 0, z: 0 },
      { x: 0.1, y: 0, z: 0 },
      { x: 0.4, y: 0, z: 0 },
    ],
  },
  sympatheticTear: {
    contactResponse: {
      primaryContactComponentLabel: 0,
    },
  },
};

const honest = buildRenderedStructuralMotionEntry({
  sequence: 1,
  scheduler: { interactionId: 'interaction-1', generation: 0, final: false },
  interaction,
  receipt: { status: 'passed', eventEpoch: 1 },
  previousState,
  nextState,
  beforeRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.35), rendered('n2', 1.4)],
  afterRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.45), rendered('n2', 1.4)],
});

assert.equal(honest.authority, STRUCTURAL_MATERIAL_3D_MOTION_AUDIT_AUTHORITY);
assert.equal(honest.status, 'passed');
assert.deepEqual(honest.actualMovedComponentLabels, [0]);
assert.deepEqual(honest.historicalDisplacedComponentLabels, [0, 4]);
assert.deepEqual(honest.nonPrimaryActualMovedNodeIds, []);
assert.equal(honest.contact.nodeId, 'n1');
assert.equal(honest.contact.componentAfter.label, 0);
assert.equal(honest.contactAttachment.status, 'following');
assert.deepEqual(honest.components.find(component => component.label === 4).restBounds.x, [1, 1]);

const idempotentAbsoluteReplay = buildRenderedStructuralMotionEntry({
  sequence: 2,
  scheduler: { interactionId: 'interaction-replay', generation: 0, final: true },
  interaction,
  receipt: { status: 'passed', eventEpoch: 2 },
  previousState: nextState,
  nextState,
  beforeRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.45), rendered('n2', 1.4)],
  afterRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.45), rendered('n2', 1.4)],
});

assert.equal(idempotentAbsoluteReplay.status, 'passed');
assert.equal(idempotentAbsoluteReplay.contactAttachment.status, 'following');
assert.equal(idempotentAbsoluteReplay.contactAttachment.actualRenderedDeltaMagnitude, 0);
assert.ok(idempotentAbsoluteReplay.contactAttachment.currentGestureDeltaMagnitude > 0);

const immobilizedPinnedContact = buildRenderedStructuralMotionEntry({
  sequence: 3,
  scheduler: { interactionId: 'interaction-pinned', generation: 0, final: false },
  interaction: {
    ...interaction,
    contactIdentity: { kind: 'node', id: 'n0' },
    point: { x: 0, y: 0, z: 0 },
  },
  receipt: { status: 'passed', eventEpoch: 2 },
  previousState,
  nextState,
  beforeRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.35), rendered('n2', 1.4)],
  afterRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.45), rendered('n2', 1.4)],
});

assert.equal(immobilizedPinnedContact.status, 'failed');
assert.equal(immobilizedPinnedContact.contactAttachment.status, 'immobilized');
assert.equal(immobilizedPinnedContact.contactAttachment.authoredPinned, true);
assert.equal(
  immobilizedPinnedContact.firstDivergence.reason,
  'direct-manipulation-contact-immobilized-by-authored-pin',
);

const unexplained = buildRenderedStructuralMotionEntry({
  sequence: 4,
  scheduler: { interactionId: 'interaction-2', generation: 0, final: true },
  interaction,
  receipt: { status: 'passed', eventEpoch: 2 },
  previousState,
  nextState,
  beforeRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.35), rendered('n2', 1.4)],
  afterRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.45), rendered('n2', 1.55)],
});

assert.equal(unexplained.status, 'failed');
assert.deepEqual(unexplained.nonPrimaryActualMovedNodeIds, ['n2']);
assert.deepEqual(unexplained.actualMovedComponentLabels, [0, 4]);
assert.equal(unexplained.firstDivergence.reason, 'non-primary-rendered-motion');

const sceneMismatchNodes = [
  rendered('n0', 0.1),
  rendered('n1', 0.45),
  {
    id: 'n2',
    actualWorldPosition: { x: 1.55, y: 0, z: 0 },
    expectedWorldPosition: { x: 1.4, y: 0, z: 0 },
  },
];
const sceneMismatch = buildRenderedStructuralMotionEntry({
  sequence: 5,
  scheduler: { interactionId: 'interaction-3', generation: 0, final: true },
  interaction,
  receipt: { status: 'passed', eventEpoch: 3 },
  previousState,
  nextState,
  beforeRenderedNodes: [rendered('n0', 0.1), rendered('n1', 0.35), rendered('n2', 1.4)],
  afterRenderedNodes: sceneMismatchNodes,
});

assert.equal(sceneMismatch.status, 'failed');
assert.deepEqual(sceneMismatch.sceneMaterialMismatchNodeIds, ['n2']);
assert.equal(sceneMismatch.firstDivergence.reason, 'scene-material-position-mismatch');

const falseCleanTimeline = buildRenderedStructuralMotionTimeline({
  entries: [honest, unexplained],
  constructionErrors: [],
});
assert.equal(falseCleanTimeline.status, 'failed');
assert.equal(falseCleanTimeline.entryCount, 2);
assert.equal(falseCleanTimeline.failureCount, 1);
assert.equal(falseCleanTimeline.constructionErrorCount, 0);
assert.equal(falseCleanTimeline.errorCount, 1);
assert.deepEqual(falseCleanTimeline.failedSequences, [unexplained.sequence]);
assert.deepEqual(falseCleanTimeline.failedReasons, ['non-primary-rendered-motion']);

const cleanTimeline = buildRenderedStructuralMotionTimeline({
  entries: [honest, idempotentAbsoluteReplay],
  constructionErrors: [],
});
assert.equal(cleanTimeline.status, 'passed');
assert.equal(cleanTimeline.failureCount, 0);
assert.equal(cleanTimeline.errorCount, 0);

const counterfeitPassedTimeline = buildRenderedStructuralMotionTimeline({
  entries: [{ status: 'passed' }],
  constructionErrors: [],
});
assert.equal(counterfeitPassedTimeline.status, 'failed');
assert.equal(counterfeitPassedTimeline.failureCount, 0);
assert.equal(counterfeitPassedTimeline.malformedEntryCount, 1);
assert.equal(counterfeitPassedTimeline.errorCount, 1);
assert.deepEqual(counterfeitPassedTimeline.malformedEntrySequences, [null]);
assert.ok(counterfeitPassedTimeline.malformedEntryReasons.some(reason =>
  reason.sequence === null && reason.reasons.includes('schema-mismatch')
));

const shapedEmptyCounterfeitTimeline = buildRenderedStructuralMotionTimeline({
  entries: [{
    schema: 'kaminos.structural-material.rendered-motion-entry.v0',
    authority: STRUCTURAL_MATERIAL_3D_MOTION_AUDIT_AUTHORITY,
    status: 'passed',
    failurePhase: null,
    sequence: 101,
    scheduler: {},
    receipt: { status: 'passed' },
    interaction: {},
    primaryContactComponentLabel: 0,
    contact: { nodeId: 'ghost-contact' },
    contactAttachment: {
      authority: 'picked-rendered-contact-attachment-v0',
      status: 'following',
    },
    actualMovedComponentLabels: [],
    incrementalMaterialMovedComponentLabels: [],
    historicalDisplacedComponentLabels: [],
    nonPrimaryActualMovedNodeIds: [],
    sceneMaterialMismatchNodeIds: [],
    components: [],
    nodes: [],
    firstDivergence: null,
  }],
  constructionErrors: [],
});
assert.equal(shapedEmptyCounterfeitTimeline.status, 'failed');
assert.equal(shapedEmptyCounterfeitTimeline.malformedEntryCount, 1);
assert.equal(shapedEmptyCounterfeitTimeline.errorCount, 1);
assert.deepEqual(shapedEmptyCounterfeitTimeline.malformedEntrySequences, [101]);
const shapedEmptyReasons = shapedEmptyCounterfeitTimeline.malformedEntryReasons[0].reasons;
assert.ok(shapedEmptyReasons.includes('scheduler-interaction-id-missing'));
assert.ok(shapedEmptyReasons.includes('interaction-evidence-missing'));
assert.ok(shapedEmptyReasons.includes('nodes-empty'));
assert.ok(shapedEmptyReasons.includes('components-empty'));
assert.ok(shapedEmptyReasons.includes('contact-node-not-in-nodes'));
assert.ok(shapedEmptyReasons.includes('contact-attachment-node-ids-missing'));

const duplicateSequenceTimeline = buildRenderedStructuralMotionTimeline({
  entries: [honest, { ...honest }],
  constructionErrors: [],
});
assert.equal(duplicateSequenceTimeline.status, 'failed');
assert.equal(duplicateSequenceTimeline.malformedEntryCount, 2);
assert.equal(duplicateSequenceTimeline.errorCount, 2);
assert.deepEqual(duplicateSequenceTimeline.malformedEntrySequences, [honest.sequence, honest.sequence]);
assert.ok(duplicateSequenceTimeline.malformedEntryReasons.every(reason =>
  reason.reasons.includes('duplicate-sequence')
));

const constructionError = {
  sequence: 6,
  schedulerInteractionId: 'interaction-construction-error',
  message: 'rendered node identity mismatch',
};
const constructionFailureTimeline = buildRenderedStructuralMotionTimeline({
  entries: [honest],
  constructionErrors: [constructionError],
});
assert.equal(constructionFailureTimeline.status, 'failed');
assert.equal(constructionFailureTimeline.failureCount, 0);
assert.equal(constructionFailureTimeline.constructionErrorCount, 1);
assert.equal(constructionFailureTimeline.errorCount, 1);
assert.deepEqual(constructionFailureTimeline.constructionErrors, [constructionError]);
assert.deepEqual(constructionFailureTimeline.errors, [constructionError]);

const relabeledContinuity = assessStableNodeDisplacementContinuity({
  beforeNodes: [
    { id: 'n158', componentAfter: { label: 5 }, nextDisplacement: { x: 0.11373, y: 0, z: 0 } },
    { id: 'n4', componentAfter: { label: 4 }, nextDisplacement: { x: 0, y: 0, z: 0 } },
  ],
  afterNodes: [
    { id: 'n158', componentAfter: { label: 158 }, nextDisplacement: { x: 0.11669, y: 0, z: 0 } },
    { id: 'n4', componentAfter: { label: 4 }, nextDisplacement: { x: 0, y: 0, z: 0 } },
  ],
});
assert.equal(relabeledContinuity.status, 'passed');
assert.deepEqual(relabeledContinuity.regressedNodeIds, []);
assert.deepEqual(relabeledContinuity.missingNodeIds, []);
assert.deepEqual(relabeledContinuity.increasedNodeIds, ['n158']);
assert.deepEqual(relabeledContinuity.relabeledNodeIds, ['n158']);

console.log('structural-material-3d rendered motion audit contracts passed');

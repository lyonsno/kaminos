export const STRUCTURAL_MATERIAL_3D_MOTION_AUDIT_AUTHORITY =
  'accepted-interaction-material-to-rendered-node-motion-v0';

const RENDERED_MOTION_ENTRY_SCHEMA = 'kaminos.structural-material.rendered-motion-entry.v0';

const EPSILON = 1e-8;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`rendered motion audit requires finite ${label}`);
  return number;
}

function vector(value, label) {
  return {
    x: finite(value?.x, `${label}.x`),
    y: finite(value?.y, `${label}.y`),
    z: finite(value?.z, `${label}.z`),
  };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function interpolate(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function magnitude(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function round(value, digits = 9) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function roundedVector(value) {
  return { x: round(value.x), y: round(value.y), z: round(value.z) };
}

function componentLabel(componentId) {
  const match = String(componentId || '').match(/(\d+)$/);
  if (!match) throw new Error(`rendered motion audit cannot resolve component id ${componentId}`);
  return Number(match[1]);
}

function indexed(items, label) {
  if (!Array.isArray(items)) throw new Error(`rendered motion audit requires ${label}`);
  const result = new Map();
  for (const item of items) {
    if (typeof item?.id !== 'string' || item.id.length === 0) {
      throw new Error(`rendered motion audit ${label} contains a missing node id`);
    }
    if (result.has(item.id)) throw new Error(`rendered motion audit ${label} duplicates ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function bounds(nodes, selector) {
  const values = nodes.map(selector);
  return {
    x: [Math.min(...values.map(value => value.x)), Math.max(...values.map(value => value.x))].map(round),
    y: [Math.min(...values.map(value => value.y)), Math.max(...values.map(value => value.y))].map(round),
    z: [Math.min(...values.map(value => value.z)), Math.max(...values.map(value => value.z))].map(round),
  };
}

function labelsFor(nodes, predicate) {
  return [...new Set(nodes.filter(predicate).map(node => node.componentAfter.label))].sort((a, b) => a - b);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteVector(value) {
  return isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z);
}

function validateTimelineEntry(entry, duplicateSequences) {
  const reasons = [];
  const add = reason => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (!isRecord(entry)) {
    return ['entry-not-object'];
  }
  if (entry.schema !== RENDERED_MOTION_ENTRY_SCHEMA) add('schema-mismatch');
  if (entry.authority !== STRUCTURAL_MATERIAL_3D_MOTION_AUDIT_AUTHORITY) add('authority-mismatch');
  if (!Number.isInteger(entry.sequence) || entry.sequence <= 0) add('invalid-sequence');
  if (duplicateSequences.has(entry.sequence)) add('duplicate-sequence');
  if (entry.status !== 'passed' && entry.status !== 'failed') add('invalid-status');
  if (!isRecord(entry.scheduler)) {
    add('scheduler-missing');
  } else if (!isNonEmptyString(entry.scheduler.interactionId)) {
    add('scheduler-interaction-id-missing');
  }
  if (!isRecord(entry.receipt) || entry.receipt.status !== 'passed') add('accepted-receipt-missing');
  if (!isRecord(entry.interaction)) {
    add('interaction-missing');
  } else if (
    !isFiniteVector(entry.interaction.point) ||
    !isFiniteVector(entry.interaction.vector) ||
    !isFiniteNumber(entry.interaction.magnitude)
  ) {
    add('interaction-evidence-missing');
  }
  if (!Number.isInteger(entry.primaryContactComponentLabel)) add('primary-component-missing');
  if (!isRecord(entry.contact) || !isNonEmptyString(entry.contact.nodeId)) add('contact-missing');
  if (!isRecord(entry.contactAttachment)) {
    add('contact-attachment-missing');
  } else {
    if (entry.contactAttachment.authority !== 'picked-rendered-contact-attachment-v0') {
      add('contact-attachment-authority-mismatch');
    }
    if (!['following', 'immobilized'].includes(entry.contactAttachment.status)) {
      add('contact-attachment-status-invalid');
    }
    if (!Array.isArray(entry.contactAttachment.nodeIds) || entry.contactAttachment.nodeIds.length === 0) {
      add('contact-attachment-node-ids-missing');
    }
    if (
      !isFiniteVector(entry.contactAttachment.actualRenderedDelta) ||
      !isFiniteNumber(entry.contactAttachment.actualRenderedDeltaMagnitude) ||
      !isFiniteVector(entry.contactAttachment.currentGestureDelta) ||
      !isFiniteNumber(entry.contactAttachment.currentGestureDeltaMagnitude)
    ) {
      add('contact-attachment-motion-evidence-missing');
    }
  }
  for (const field of [
    'actualMovedComponentLabels',
    'incrementalMaterialMovedComponentLabels',
    'historicalDisplacedComponentLabels',
    'nonPrimaryActualMovedNodeIds',
    'sceneMaterialMismatchNodeIds',
    'components',
    'nodes',
  ]) {
    if (!Array.isArray(entry[field])) add(`${field}-missing`);
  }
  const nodes = Array.isArray(entry.nodes) ? entry.nodes : [];
  const components = Array.isArray(entry.components) ? entry.components : [];
  if (Array.isArray(entry.nodes) && nodes.length === 0) add('nodes-empty');
  if (Array.isArray(entry.components) && components.length === 0) add('components-empty');
  const nodeIds = new Set();
  let nodeEvidenceInvalid = false;
  for (const node of nodes) {
    if (
      !isRecord(node) ||
      !isNonEmptyString(node.id) ||
      nodeIds.has(node.id) ||
      !Number.isInteger(node.componentAfter?.label) ||
      !isFiniteVector(node.actualWorldPositionAfter) ||
      !isFiniteVector(node.actualRenderedDelta) ||
      !isFiniteNumber(node.actualRenderedDeltaMagnitude) ||
      !isFiniteVector(node.currentGestureMaterialDelta) ||
      !isFiniteNumber(node.currentGestureMaterialDeltaMagnitude)
    ) {
      nodeEvidenceInvalid = true;
      continue;
    }
    nodeIds.add(node.id);
  }
  if (nodeEvidenceInvalid) add('node-evidence-invalid');
  const componentLabels = new Set();
  let componentEvidenceInvalid = false;
  for (const component of components) {
    if (
      !isRecord(component) ||
      !Number.isInteger(component.label) ||
      componentLabels.has(component.label) ||
      !Number.isInteger(component.nodeCount) ||
      component.nodeCount <= 0 ||
      typeof component.includesContact !== 'boolean' ||
      !isFiniteNumber(component.maxActualRenderedDelta) ||
      !isFiniteNumber(component.maxCurrentGestureMaterialDelta)
    ) {
      componentEvidenceInvalid = true;
      continue;
    }
    componentLabels.add(component.label);
    const actualNodeCount = nodes.filter(node => node?.componentAfter?.label === component.label).length;
    if (actualNodeCount !== component.nodeCount) componentEvidenceInvalid = true;
  }
  if (componentEvidenceInvalid) add('component-evidence-invalid');
  if (isRecord(entry.contact) && isNonEmptyString(entry.contact.nodeId)) {
    if (!nodeIds.has(entry.contact.nodeId)) add('contact-node-not-in-nodes');
    if (entry.contact.componentAfter?.label !== entry.primaryContactComponentLabel) {
      add('contact-primary-component-mismatch');
    }
  }
  const primaryComponent = components.find(
    component => component?.label === entry.primaryContactComponentLabel,
  );
  if (!primaryComponent) {
    add('primary-component-not-in-components');
  } else if (primaryComponent.includesContact !== true) {
    add('primary-component-missing-contact');
  }
  if (Array.isArray(entry.contactAttachment?.nodeIds) && entry.contactAttachment.nodeIds.length > 0) {
    if (entry.contactAttachment.nodeIds.some(nodeId => !nodeIds.has(nodeId))) {
      add('contact-attachment-node-not-in-nodes');
    }
    if (
      isNonEmptyString(entry.contact?.nodeId) &&
      !entry.contactAttachment.nodeIds.includes(entry.contact.nodeId)
    ) {
      add('contact-attachment-misses-contact-node');
    }
    if (
      entry.contactAttachment.kind === 'node' &&
      (
        entry.contactAttachment.identityId !== entry.contact?.nodeId ||
        entry.contactAttachment.nodeIds.length !== 1
      )
    ) {
      add('node-contact-attachment-identity-mismatch');
    }
  }
  for (const field of [
    'actualMovedComponentLabels',
    'incrementalMaterialMovedComponentLabels',
    'historicalDisplacedComponentLabels',
  ]) {
    if (Array.isArray(entry[field]) && entry[field].some(label => !componentLabels.has(label))) {
      add(`${field}-unknown-component`);
    }
  }
  for (const field of ['nonPrimaryActualMovedNodeIds', 'sceneMaterialMismatchNodeIds']) {
    if (Array.isArray(entry[field]) && entry[field].some(nodeId => !nodeIds.has(nodeId))) {
      add(`${field}-unknown-node`);
    }
  }
  if (entry.status === 'passed') {
    if (entry.failurePhase !== null) add('passed-entry-has-failure-phase');
    if (entry.firstDivergence !== null) add('passed-entry-has-divergence');
    if (entry.contactAttachment?.status !== 'following') add('passed-entry-contact-not-following');
  }
  if (entry.status === 'failed') {
    if (typeof entry.failurePhase !== 'string' || entry.failurePhase.length === 0) {
      add('failed-entry-missing-failure-phase');
    }
    if (!isRecord(entry.firstDivergence) || typeof entry.firstDivergence.reason !== 'string') {
      add('failed-entry-missing-divergence');
    } else if (entry.firstDivergence.reason !== entry.failurePhase) {
      add('failed-entry-divergence-mismatch');
    }
  }
  return reasons;
}

export function buildRenderedStructuralMotionTimeline({
  entries = [],
  constructionErrors = [],
} = {}) {
  if (!Array.isArray(entries) || !Array.isArray(constructionErrors)) {
    throw new Error('rendered motion timeline requires entry and construction-error arrays');
  }
  const failedEntries = entries.filter(entry => entry?.status !== 'passed');
  const failedSequences = failedEntries.map(entry => entry?.sequence ?? null);
  const failedReasons = [...new Set(failedEntries.map(entry =>
    entry?.failurePhase || entry?.firstDivergence?.reason || 'unknown-semantic-failure'
  ))].sort();
  const sequenceCounts = new Map();
  for (const entry of entries) {
    if (!Number.isInteger(entry?.sequence) || entry.sequence <= 0) continue;
    sequenceCounts.set(entry.sequence, (sequenceCounts.get(entry.sequence) || 0) + 1);
  }
  const duplicateSequences = new Set([...sequenceCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([sequence]) => sequence));
  const malformedEntryReasons = entries
    .map(entry => ({
      sequence: Number.isInteger(entry?.sequence) && entry.sequence > 0 ? entry.sequence : null,
      reasons: validateTimelineEntry(entry, duplicateSequences),
    }))
    .filter(result => result.reasons.length > 0);
  const malformedEntrySequences = malformedEntryReasons.map(result => result.sequence);
  const failureCount = failedEntries.length;
  const malformedEntryCount = malformedEntryReasons.length;
  const constructionErrorCount = constructionErrors.length;
  const errorCount = failureCount + malformedEntryCount + constructionErrorCount;
  return {
    authority: STRUCTURAL_MATERIAL_3D_MOTION_AUDIT_AUTHORITY,
    status: errorCount === 0 ? 'passed' : 'failed',
    entryCount: entries.length,
    failureCount,
    failedSequences,
    failedReasons,
    malformedEntryCount,
    malformedEntrySequences,
    malformedEntryReasons,
    constructionErrorCount,
    errorCount,
    constructionErrors,
    errors: constructionErrors,
    entries,
  };
}

export function assessStableNodeDisplacementContinuity({
  beforeNodes,
  afterNodes,
  regressionEpsilon = 0.000001,
  increaseThreshold = 0.0001,
} = {}) {
  if (!Array.isArray(beforeNodes) || !Array.isArray(afterNodes)) {
    throw new Error('stable-node displacement continuity requires before and after node arrays');
  }
  const beforeById = indexed(beforeNodes, 'continuity before nodes');
  const afterById = indexed(afterNodes, 'continuity after nodes');
  const missingNodeIds = [];
  const regressedNodeIds = [];
  const increasedNodeIds = [];
  const relabeledNodeIds = [];
  let maxBeforeDisplacement = 0;
  let maxAfterDisplacement = 0;
  for (const [id, beforeNode] of beforeById) {
    const afterNode = afterById.get(id);
    if (!afterNode) {
      missingNodeIds.push(id);
      continue;
    }
    const beforeMagnitude = magnitude(vector(beforeNode.nextDisplacement, `${id}.beforeDisplacement`));
    const afterMagnitude = magnitude(vector(afterNode.nextDisplacement, `${id}.afterDisplacement`));
    maxBeforeDisplacement = Math.max(maxBeforeDisplacement, beforeMagnitude);
    maxAfterDisplacement = Math.max(maxAfterDisplacement, afterMagnitude);
    if (afterMagnitude < beforeMagnitude - regressionEpsilon) regressedNodeIds.push(id);
    if (afterMagnitude > beforeMagnitude + increaseThreshold) increasedNodeIds.push(id);
    if (beforeNode.componentAfter?.label !== afterNode.componentAfter?.label) relabeledNodeIds.push(id);
  }
  const status = missingNodeIds.length === 0 &&
    regressedNodeIds.length === 0 &&
    increasedNodeIds.length > 0
    ? 'passed'
    : 'failed';
  return {
    authority: 'stable-node-displacement-continuity-v0',
    status,
    beforeNodeCount: beforeNodes.length,
    afterNodeCount: afterNodes.length,
    comparedNodeCount: beforeNodes.length - missingNodeIds.length,
    missingNodeIds,
    regressedNodeIds,
    increasedNodeIds,
    relabeledNodeIds,
    maxBeforeDisplacement: round(maxBeforeDisplacement),
    maxAfterDisplacement: round(maxAfterDisplacement),
  };
}

export function buildRenderedStructuralMotionEntry({
  sequence,
  scheduler = {},
  interaction = {},
  receipt = {},
  previousState,
  nextState,
  beforeRenderedNodes,
  afterRenderedNodes,
} = {}) {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error('rendered motion audit requires a positive sequence');
  }
  if (!Array.isArray(previousState?.nodes) || !Array.isArray(nextState?.nodes)) {
    throw new Error('rendered motion audit requires previous and next material nodes');
  }
  if (receipt.status !== 'passed') throw new Error('rendered motion audit requires an accepted receipt');

  const previousById = indexed(previousState.nodes, 'previous material nodes');
  const nextById = indexed(nextState.nodes, 'next material nodes');
  const beforeById = indexed(beforeRenderedNodes, 'before rendered nodes');
  const afterById = indexed(afterRenderedNodes, 'after rendered nodes');
  const expectedIds = [...previousById.keys()].sort();
  for (const [label, values] of [
    ['next material nodes', nextById],
    ['before rendered nodes', beforeById],
    ['after rendered nodes', afterById],
  ]) {
    const ids = [...values.keys()].sort();
    if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
      throw new Error(`rendered motion audit ${label} node identity mismatch`);
    }
  }

  const contactNodeId = interaction.contactIdentity?.kind === 'node'
    ? interaction.contactIdentity.id
    : nextState.sympatheticTear?.contactResponse?.contactNodeIds?.[0] || null;
  if (!contactNodeId || !nextById.has(contactNodeId)) {
    throw new Error('rendered motion audit cannot resolve the stable contact node');
  }
  const primaryLabel = nextState.sympatheticTear?.contactResponse?.primaryContactComponentLabel;
  if (!Number.isInteger(primaryLabel)) {
    throw new Error('rendered motion audit requires a primary contact component label');
  }
  const baseline = nextState.visualDisplacementGesture?.baselineDisplacements;
  if (!Array.isArray(baseline) || baseline.length !== nextState.nodes.length) {
    throw new Error('rendered motion audit requires the accepted gesture baseline');
  }
  const nextIndexById = new Map(nextState.nodes.map((node, index) => [node.id, index]));

  const nodes = expectedIds.map(id => {
    const previousNode = previousById.get(id);
    const nextNode = nextById.get(id);
    const beforeRendered = beforeById.get(id);
    const afterRendered = afterById.get(id);
    const previousDisplacement = vector(previousNode.displacement, `${id}.previousDisplacement`);
    const nextDisplacement = vector(nextNode.displacement, `${id}.nextDisplacement`);
    const baselineDisplacement = vector(baseline[nextIndexById.get(id)], `${id}.baselineDisplacement`);
    const beforeActual = vector(beforeRendered.actualWorldPosition, `${id}.beforeActualWorldPosition`);
    const afterActual = vector(afterRendered.actualWorldPosition, `${id}.afterActualWorldPosition`);
    const beforeExpected = vector(beforeRendered.expectedWorldPosition, `${id}.beforeExpectedWorldPosition`);
    const afterExpected = vector(afterRendered.expectedWorldPosition, `${id}.afterExpectedWorldPosition`);
    const actualRenderedDelta = subtract(afterActual, beforeActual);
    const expectedRenderedDelta = subtract(afterExpected, beforeExpected);
    const incrementalMaterialDelta = subtract(nextDisplacement, previousDisplacement);
    const currentGestureMaterialDelta = subtract(nextDisplacement, baselineDisplacement);
    const sceneMaterialErrorBefore = subtract(beforeActual, beforeExpected);
    const sceneMaterialErrorAfter = subtract(afterActual, afterExpected);
    return {
      id,
      pinned: nextNode.pinned === true,
      restPoint: {
        x: finite(nextNode.x, `${id}.x`),
        y: finite(nextNode.y, `${id}.y`),
        z: finite(nextNode.z, `${id}.z`),
      },
      componentBefore: {
        id: previousNode.componentId,
        label: componentLabel(previousNode.componentId),
      },
      componentAfter: {
        id: nextNode.componentId,
        label: componentLabel(nextNode.componentId),
      },
      previousDisplacement: roundedVector(previousDisplacement),
      nextDisplacement: roundedVector(nextDisplacement),
      baselineDisplacement: roundedVector(baselineDisplacement),
      incrementalMaterialDelta: roundedVector(incrementalMaterialDelta),
      incrementalMaterialDeltaMagnitude: round(magnitude(incrementalMaterialDelta)),
      currentGestureMaterialDelta: roundedVector(currentGestureMaterialDelta),
      currentGestureMaterialDeltaMagnitude: round(magnitude(currentGestureMaterialDelta)),
      actualRenderedDelta: roundedVector(actualRenderedDelta),
      actualRenderedDeltaMagnitude: round(magnitude(actualRenderedDelta)),
      expectedRenderedDelta: roundedVector(expectedRenderedDelta),
      expectedRenderedDeltaMagnitude: round(magnitude(expectedRenderedDelta)),
      actualWorldPositionBefore: roundedVector(beforeActual),
      actualWorldPositionAfter: roundedVector(afterActual),
      expectedWorldPositionBefore: roundedVector(beforeExpected),
      expectedWorldPositionAfter: roundedVector(afterExpected),
      sceneMaterialErrorBefore: round(magnitude(sceneMaterialErrorBefore)),
      sceneMaterialErrorAfter: round(magnitude(sceneMaterialErrorAfter)),
      historicallyDisplaced: magnitude(nextDisplacement) > EPSILON,
      actuallyMoved: magnitude(actualRenderedDelta) > EPSILON,
      materialMovedIncrementally: magnitude(incrementalMaterialDelta) > EPSILON,
    };
  });

  const componentGroups = new Map();
  for (const nodeState of nodes) {
    const label = nodeState.componentAfter.label;
    if (!componentGroups.has(label)) componentGroups.set(label, []);
    componentGroups.get(label).push(nodeState);
  }
  const components = [...componentGroups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([label, componentNodes]) => ({
      id: `g${label}`,
      label,
      nodeCount: componentNodes.length,
      pinned: componentNodes.some(nodeState => nodeState.pinned),
      includesContact: componentNodes.some(nodeState => nodeState.id === contactNodeId),
      restBounds: bounds(componentNodes, nodeState => nodeState.restPoint),
      actualWorldBoundsAfter: bounds(componentNodes, nodeState => nodeState.actualWorldPositionAfter),
      actuallyMovedNodeCount: componentNodes.filter(nodeState => nodeState.actuallyMoved).length,
      maxActualRenderedDelta: round(Math.max(...componentNodes.map(nodeState => nodeState.actualRenderedDeltaMagnitude))),
      materialMovedIncrementallyNodeCount: componentNodes
        .filter(nodeState => nodeState.materialMovedIncrementally).length,
      maxIncrementalMaterialDelta: round(Math.max(...componentNodes
        .map(nodeState => nodeState.incrementalMaterialDeltaMagnitude))),
      currentGestureMovedNodeCount: componentNodes
        .filter(nodeState => nodeState.currentGestureMaterialDeltaMagnitude > EPSILON).length,
      maxCurrentGestureMaterialDelta: round(Math.max(...componentNodes
        .map(nodeState => nodeState.currentGestureMaterialDeltaMagnitude))),
      historicallyDisplacedNodeCount: componentNodes.filter(nodeState => nodeState.historicallyDisplaced).length,
      maxSceneMaterialError: round(Math.max(...componentNodes.map(nodeState => Math.max(
        nodeState.sceneMaterialErrorBefore,
        nodeState.sceneMaterialErrorAfter,
      )))),
    }));

  const sceneMaterialMismatchNodeIds = nodes
    .filter(nodeState => Math.max(nodeState.sceneMaterialErrorBefore, nodeState.sceneMaterialErrorAfter) > EPSILON)
    .map(nodeState => nodeState.id);
  const nonPrimaryActualMovedNodeIds = nodes
    .filter(nodeState => nodeState.actuallyMoved && nodeState.componentAfter.label !== primaryLabel)
    .map(nodeState => nodeState.id);
  const contactIdentity = interaction.contactIdentity;
  let contactAttachmentNodeIds;
  let contactAttachmentBefore;
  let contactAttachmentAfter;
  let contactAttachmentGestureDelta;
  let contactAttachmentAuthoredPinned;
  let contactAttachmentSegmentT = null;
  if (contactIdentity?.kind === 'bond') {
    const bond = nextState.bonds?.find(candidate => candidate.id === contactIdentity.id);
    if (!bond) throw new Error(`rendered motion audit cannot resolve contact bond ${contactIdentity.id}`);
    const a = nodes.find(nodeState => nodeState.id === bond.a);
    const b = nodes.find(nodeState => nodeState.id === bond.b);
    if (!a || !b) throw new Error(`rendered motion audit contact bond ${contactIdentity.id} has missing endpoints`);
    contactAttachmentSegmentT = Math.max(0, Math.min(1, finite(
      contactIdentity.segmentT ?? 0.5,
      'interaction.contactIdentity.segmentT',
    )));
    contactAttachmentNodeIds = [a.id, b.id];
    contactAttachmentBefore = interpolate(
      a.actualWorldPositionBefore,
      b.actualWorldPositionBefore,
      contactAttachmentSegmentT,
    );
    contactAttachmentAfter = interpolate(
      a.actualWorldPositionAfter,
      b.actualWorldPositionAfter,
      contactAttachmentSegmentT,
    );
    contactAttachmentGestureDelta = interpolate(
      a.currentGestureMaterialDelta,
      b.currentGestureMaterialDelta,
      contactAttachmentSegmentT,
    );
    contactAttachmentAuthoredPinned = a.pinned && b.pinned;
  } else {
    contactAttachmentNodeIds = [contactNodeId];
    const contactNodeState = nodes.find(nodeState => nodeState.id === contactNodeId);
    contactAttachmentBefore = contactNodeState.actualWorldPositionBefore;
    contactAttachmentAfter = contactNodeState.actualWorldPositionAfter;
    contactAttachmentGestureDelta = contactNodeState.currentGestureMaterialDelta;
    contactAttachmentAuthoredPinned = contactNodeState.pinned;
  }
  const contactAttachmentDelta = subtract(contactAttachmentAfter, contactAttachmentBefore);
  const contactAttachmentDeltaMagnitude = magnitude(contactAttachmentDelta);
  const contactAttachmentGestureDeltaMagnitude = magnitude(contactAttachmentGestureDelta);
  const directManipulationActive =
    interaction.kind === 'camera-relative-picked-layered-drag' &&
    finite(interaction.magnitude ?? 0, 'interaction.magnitude') > EPSILON;
  const contactAttachmentImmobilized = directManipulationActive &&
    contactAttachmentGestureDeltaMagnitude <= EPSILON;
  const contactAttachment = {
    authority: 'picked-rendered-contact-attachment-v0',
    status: contactAttachmentImmobilized ? 'immobilized' : 'following',
    kind: contactIdentity?.kind || 'node',
    identityId: contactIdentity?.id || contactNodeId,
    nodeIds: contactAttachmentNodeIds,
    segmentT: contactAttachmentSegmentT,
    authoredPinned: contactAttachmentAuthoredPinned,
    actualRenderedDelta: roundedVector(contactAttachmentDelta),
    actualRenderedDeltaMagnitude: round(contactAttachmentDeltaMagnitude),
    currentGestureDelta: roundedVector(contactAttachmentGestureDelta),
    currentGestureDeltaMagnitude: round(contactAttachmentGestureDeltaMagnitude),
  };
  const firstDivergence = sceneMaterialMismatchNodeIds.length > 0
    ? { reason: 'scene-material-position-mismatch', nodeId: sceneMaterialMismatchNodeIds[0] }
    : nonPrimaryActualMovedNodeIds.length > 0
      ? { reason: 'non-primary-rendered-motion', nodeId: nonPrimaryActualMovedNodeIds[0] }
      : contactAttachmentImmobilized
        ? {
            reason: contactAttachmentAuthoredPinned
              ? 'direct-manipulation-contact-immobilized-by-authored-pin'
              : 'direct-manipulation-contact-did-not-move',
            nodeId: contactAttachmentNodeIds[0],
          }
      : null;
  const contactNode = nodes.find(nodeState => nodeState.id === contactNodeId);

  return {
    schema: RENDERED_MOTION_ENTRY_SCHEMA,
    authority: STRUCTURAL_MATERIAL_3D_MOTION_AUDIT_AUTHORITY,
    status: firstDivergence ? 'failed' : 'passed',
    failurePhase: firstDivergence?.reason || null,
    sequence,
    scheduler: {
      interactionId: scheduler.interactionId || null,
      generation: scheduler.generation ?? null,
      final: scheduler.final === true,
    },
    receipt: {
      status: receipt.status,
      eventEpoch: receipt.eventEpoch ?? null,
      effectiveRoute: receipt.effectiveRoute || null,
      effectiveBackend: receipt.effectiveBackend || null,
    },
    interaction: {
      gestureId: interaction.gestureId || null,
      contactIdentity: interaction.contactIdentity || null,
      point: interaction.point ? vector(interaction.point, 'interaction.point') : null,
      vector: interaction.vector ? vector(interaction.vector, 'interaction.vector') : null,
      magnitude: Number.isFinite(Number(interaction.magnitude)) ? Number(interaction.magnitude) : null,
    },
    primaryContactComponentLabel: primaryLabel,
    contact: {
      nodeId: contactNodeId,
      componentBefore: contactNode.componentBefore,
      componentAfter: contactNode.componentAfter,
      restPoint: contactNode.restPoint,
      actualWorldPositionAfter: contactNode.actualWorldPositionAfter,
    },
    contactAttachment,
    actualMovedComponentLabels: labelsFor(nodes, nodeState => nodeState.actuallyMoved),
    incrementalMaterialMovedComponentLabels: labelsFor(nodes, nodeState => nodeState.materialMovedIncrementally),
    historicalDisplacedComponentLabels: labelsFor(nodes, nodeState => nodeState.historicallyDisplaced),
    nonPrimaryActualMovedNodeIds,
    sceneMaterialMismatchNodeIds,
    firstDivergence,
    components,
    nodes,
  };
}

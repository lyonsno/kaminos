import {
  MUSCLE_COMPARTMENT_RING_CAGE_SCHEMA,
  hashMuscleCompartmentRingCageCanonicalJson,
  measureMuscleCompartmentRingCageCurrentGeometry,
  verifyMuscleCompartmentRingCageIdentity,
} from './muscle-compartment-ring-cage-core.mjs';

export const MUSCLE_COMPARTMENT_RING_CAGE_ADMISSION_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-admission.v0';
export const MUSCLE_COMPARTMENT_RING_CAGE_SOLVER_CARRIER_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-solver-carrier.v0';

const ROUTE_ID = 'generic-ring-cage-contact-containment-intake.v0';
const DEFAULT_CONFIG = Object.freeze({
  surfaceCellRelativeTolerance: 1e-12,
  expectedDocumentSha256: null,
});

function clone(value) {
  return structuredClone(value);
}

function sameCanonicalValue(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return hashMuscleCompartmentRingCageCanonicalJson(left) ===
    hashMuscleCompartmentRingCageCanonicalJson(right);
}

function relativeDifference(left, right) {
  const scale = Math.max(Math.abs(left), Math.abs(right));
  if (!(scale > 0)) return left === right ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(left - right) / scale;
}

function validateRequestedConfig(requestedConfig) {
  if (requestedConfig === undefined) return clone(DEFAULT_CONFIG);
  if (!requestedConfig || typeof requestedConfig !== 'object' ||
      Array.isArray(requestedConfig)) {
    throw new Error('ring cage admission config must be an object');
  }
  const config = { ...DEFAULT_CONFIG, ...clone(requestedConfig) };
  if (Object.keys(config).some(key => !Object.hasOwn(DEFAULT_CONFIG, key))) {
    throw new Error('ring cage admission config contains an unsupported field');
  }
  if (!Number.isFinite(config.surfaceCellRelativeTolerance) ||
      !(config.surfaceCellRelativeTolerance > 0)) {
    throw new Error('surfaceCellRelativeTolerance must be positive and finite');
  }
  if (config.expectedDocumentSha256 !== null &&
      !/^[0-9a-f]{64}$/.test(config.expectedDocumentSha256)) {
    throw new Error('expectedDocumentSha256 must be null or a lowercase SHA-256 identity');
  }
  return config;
}

function routeReceipt() {
  return {
    requested: ROUTE_ID,
    effective: ROUTE_ID,
    fallbackUsed: false,
  };
}

function blocker(kind, cage, details = {}) {
  return {
    kind,
    constructionId: cage?.constructionId ?? null,
    cageId: cage?.id ?? null,
    ...details,
  };
}

function refusal({
  config,
  document,
  phase,
  blockers,
  lastTrustworthyEvidence,
}) {
  return {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_ADMISSION_SCHEMA,
    status: 'refused',
    phase,
    route: routeReceipt(),
    config: {
      requested: clone(config),
      effective: clone(config),
      fallbackUsed: false,
    },
    input: {
      schema: document?.schema ?? null,
      requestedSha256:
        config.expectedDocumentSha256 ?? document?.identity?.sha256 ?? null,
      effectiveSha256: null,
    },
    lastTrustworthyEvidence,
    blockingMechanisms: blockers,
    solverCarrier: null,
  };
}

function verifySemanticHash(generic, key, value, cage, blockers) {
  const recorded = generic?.semanticHashes?.[key];
  if (value === undefined) {
    blockers.push(blocker('generic-manifest-semantic-value-missing', cage, {
      field: key,
      recordedSha256: recorded ?? null,
    }));
    return;
  }
  const actual = hashMuscleCompartmentRingCageCanonicalJson(value);
  if (recorded !== actual) {
    blockers.push(blocker('generic-manifest-semantic-hash-mismatch', cage, {
      field: key,
      recordedSha256: recorded ?? null,
      actualSha256: actual,
    }));
  }
}

function validateFixedMasks(cage, generic, blockers) {
  const nodes = Array.isArray(generic?.nodes) ? generic.nodes : [];
  const masks = Array.isArray(generic?.constraints?.boundaryMasks)
    ? generic.constraints.boundaryMasks
    : [];
  if (masks.length !== nodes.length) {
    blockers.push(blocker('generic-manifest-boundary-mask-cardinality-mismatch', cage, {
      nodeCount: nodes.length,
      boundaryMaskCount: masks.length,
    }));
    return;
  }
  const expectedFixed = new Map();
  for (const boundary of cage.attachmentBoundaries || []) {
    expectedFixed.set(boundary.axisVertexId, boundary.attachmentId);
    for (const vertexId of boundary.vertexIds || []) {
      expectedFixed.set(vertexId, boundary.attachmentId);
    }
  }
  const maskById = new Map(masks.map(mask => [mask.nodeId, mask]));
  for (const node of nodes) {
    const mask = maskById.get(node.id);
    const expectedAttachmentId = expectedFixed.get(node.id) ?? null;
    if (!mask ||
        mask.fixed !== (expectedAttachmentId !== null) ||
        (mask.attachmentFrameId ?? null) !== expectedAttachmentId ||
        (node.attachmentFrameId ?? null) !== expectedAttachmentId) {
      blockers.push(blocker('generic-manifest-fixed-boundary-mismatch', cage, {
        nodeId: node.id,
        expectedAttachmentFrameId: expectedAttachmentId,
        recordedNodeAttachmentFrameId: node.attachmentFrameId ?? null,
        recordedMaskAttachmentFrameId: mask?.attachmentFrameId ?? null,
        recordedFixed: mask?.fixed ?? null,
      }));
    }
  }
}

function validateNodes(cage, generic, blockers) {
  const genericNodes = Array.isArray(generic?.nodes) ? generic.nodes : [];
  const cageNodes = (cage.sections || []).flatMap((section, index) => [
    cage.axisVertices?.[index],
    ...(section.vertices || []),
  ]).filter(Boolean);
  if (genericNodes.length !== cageNodes.length || genericNodes.length === 0) {
    blockers.push(blocker('generic-manifest-node-cardinality-mismatch', cage, {
      cageNodeCount: cageNodes.length,
      genericNodeCount: genericNodes.length,
    }));
  }
  const cageNodeById = new Map(cageNodes.map(node => [node.id, node]));
  const genericNodeIds = new Set();
  for (const node of genericNodes) {
    const sourceNode = cageNodeById.get(node.id);
    genericNodeIds.add(node.id);
    if (!sourceNode ||
        !sameCanonicalValue(node.restPosition, sourceNode.referencePosition) ||
        !sameCanonicalValue(node.currentPosition, sourceNode.currentPosition)) {
      blockers.push(blocker('generic-manifest-node-projection-mismatch', cage, {
        nodeId: node.id ?? null,
      }));
    }
  }
  return genericNodeIds;
}

function validateCells(cage, generic, genericNodeIds, blockers) {
  const genericCells = Array.isArray(generic?.cells) ? generic.cells : [];
  const cageCells = Array.isArray(cage?.cells) ? cage.cells : [];
  if (genericCells.length !== cageCells.length || genericCells.length === 0) {
    blockers.push(blocker('generic-manifest-cell-cardinality-mismatch', cage, {
      cageCellCount: cageCells.length,
      genericCellCount: genericCells.length,
    }));
    return null;
  }
  const cageCellById = new Map(cageCells.map(cell => [cell.id, cell]));
  let volume = 0;
  for (const cell of genericCells) {
    const sourceCell = cageCellById.get(cell.id);
    if (!sourceCell ||
        !sameCanonicalValue(cell.nodeIds, sourceCell.vertexIds) ||
        cell.restRawSignedVolume !== sourceCell.metrics.referenceRawSignedVolume ||
        cell.restOrientationParity !== sourceCell.metrics.referenceOrientationParity) {
      blockers.push(blocker('generic-manifest-cell-projection-mismatch', cage, {
        cellId: cell.id ?? null,
      }));
      continue;
    }
    if (cell.nodeIds.some(nodeId => !genericNodeIds.has(nodeId))) {
      blockers.push(blocker('generic-manifest-cell-node-missing', cage, {
        cellId: cell.id,
        missingNodeIds: cell.nodeIds.filter(nodeId => !genericNodeIds.has(nodeId)),
      }));
      continue;
    }
    if (!Number.isFinite(cell.restRawSignedVolume) ||
        !(cell.restRawSignedVolume * cell.restOrientationParity > 0)) {
      blockers.push(blocker('generic-manifest-nonpositive-cell', cage, {
        cellId: cell.id,
        restRawSignedVolume: cell.restRawSignedVolume,
        restOrientationParity: cell.restOrientationParity,
      }));
      continue;
    }
    volume += cell.restRawSignedVolume * cell.restOrientationParity;
  }
  return volume;
}

function validateEmbedding(cage, generic, genericNodeIds, blockers) {
  const entries = generic?.embedding?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    blockers.push(blocker('generic-manifest-embedding-missing', cage));
    return;
  }
  for (const entry of entries) {
    const weightSum = Array.isArray(entry.weights)
      ? entry.weights.reduce((sum, weight) => sum + weight, 0)
      : Number.NaN;
    if (!Array.isArray(entry.nodeIds) ||
        entry.nodeIds.length !== entry.weights?.length ||
        entry.nodeIds.some(nodeId => !genericNodeIds.has(nodeId)) ||
        !Number.isFinite(weightSum) || Math.abs(weightSum - 1) > 1e-12 ||
        entry.sourceGeometrySha256 !== generic.semanticHashes?.sourceGeometrySha256) {
      blockers.push(blocker('generic-manifest-embedding-invalid', cage, {
        sourcePointId: entry.sourcePointId ?? null,
      }));
    }
  }
}

function validateCage(cage, config) {
  const blockers = [];
  try {
    verifyMuscleCompartmentRingCageIdentity(cage);
  } catch (error) {
    return [blocker('cage-identity-mismatch', cage, { message: error.message })];
  }
  const generic = cage.genericManifest;
  if (!generic || typeof generic !== 'object' || Array.isArray(generic)) {
    return [blocker('generic-manifest-missing', cage)];
  }
  verifySemanticHash(generic, 'sourceGeometrySha256', generic.sourceGeometry, cage, blockers);
  verifySemanticHash(generic, 'topologySha256', generic.topology, cage, blockers);
  verifySemanticHash(generic, 'constraintsSha256', generic.constraints, cage, blockers);
  verifySemanticHash(generic, 'embeddingSha256', generic.embedding, cage, blockers);
  const genericNodeIds = validateNodes(cage, generic, blockers);
  validateFixedMasks(cage, generic, blockers);
  validateEmbedding(cage, generic, genericNodeIds, blockers);
  const genericCellVolume = validateCells(cage, generic, genericNodeIds, blockers);

  if (cage.topology?.closed !== true || cage.topology?.watertight !== true ||
      cage.topology?.openBoundaryEdgeCount !== 0 ||
      cage.topology?.orientationMismatchEdgeCount !== 0) {
    blockers.push(blocker('reference-surface-topology-invalid', cage, {
      closed: cage.topology?.closed ?? null,
      watertight: cage.topology?.watertight ?? null,
      openBoundaryEdgeCount: cage.topology?.openBoundaryEdgeCount ?? null,
      orientationMismatchEdgeCount:
        cage.topology?.orientationMismatchEdgeCount ?? null,
    }));
  }

  if (Number.isFinite(genericCellVolume) && genericCellVolume > 0 &&
      Number.isFinite(cage.topology?.referenceSignedVolume)) {
    const disagreement = relativeDifference(
      cage.topology.referenceSignedVolume,
      genericCellVolume,
    );
    if (disagreement > config.surfaceCellRelativeTolerance) {
      blockers.push(blocker('reference-surface-cell-volume-mismatch', cage, {
        surfaceVolume: cage.topology.referenceSignedVolume,
        cellVolume: genericCellVolume,
        relativeDisagreement: disagreement,
        allowedRelativeDisagreement: config.surfaceCellRelativeTolerance,
      }));
    }
  }

  try {
    const current = measureMuscleCompartmentRingCageCurrentGeometry(cage);
    const disagreement = relativeDifference(
      current.signedSurfaceVolume,
      current.cellVolume,
    );
    if (disagreement > config.surfaceCellRelativeTolerance) {
      blockers.push(blocker('current-surface-cell-volume-mismatch', cage, {
        surfaceVolume: current.signedSurfaceVolume,
        cellVolume: current.cellVolume,
        relativeDisagreement: disagreement,
        allowedRelativeDisagreement: config.surfaceCellRelativeTolerance,
      }));
    }
  } catch (error) {
    blockers.push(blocker('current-geometry-invalid', cage, { message: error.message }));
  }
  return blockers;
}

export function admitMuscleCompartmentRingCageDocument(
  document,
  requestedConfig = undefined,
) {
  const config = validateRequestedConfig(requestedConfig);
  const initialEvidence = {
    phase: 'document-received',
    schema: document?.schema ?? null,
    recordedSha256: document?.identity?.sha256 ?? null,
  };
  if (!document || typeof document !== 'object' || Array.isArray(document) ||
      !Array.isArray(document.cages) || document.cages.length === 0) {
    return refusal({
      config,
      document,
      phase: 'document-structure',
      blockers: [{ kind: 'ring-cage-document-incomplete' }],
      lastTrustworthyEvidence: initialEvidence,
    });
  }

  if (document.schema !== MUSCLE_COMPARTMENT_RING_CAGE_SCHEMA) {
    return refusal({
      config,
      document,
      phase: 'document-schema',
      blockers: [{
        kind: 'ring-cage-document-schema-mismatch',
        requested: MUSCLE_COMPARTMENT_RING_CAGE_SCHEMA,
        effective: document.schema ?? null,
      }],
      lastTrustworthyEvidence: initialEvidence,
    });
  }

  try {
    verifyMuscleCompartmentRingCageIdentity(document);
  } catch (error) {
    return refusal({
      config,
      document,
      phase: 'document-identity',
      blockers: [{ kind: 'ring-cage-document-identity-mismatch', message: error.message }],
      lastTrustworthyEvidence: initialEvidence,
    });
  }

  const verifiedEvidence = {
    phase: 'document-identity-verified',
    schema: document.schema,
    sha256: document.identity.sha256,
    orderedConstructionIds: clone(document.source?.orderedConstructionIds || []),
  };
  const blockers = [];
  if (config.expectedDocumentSha256 !== null &&
      config.expectedDocumentSha256 !== document.identity.sha256) {
    blockers.push({
      kind: 'carrier-document-request-mismatch',
      requestedSha256: config.expectedDocumentSha256,
      effectiveSha256: document.identity.sha256,
    });
  }
  if (document.config?.fallbackUsed !== false ||
      !sameCanonicalValue(document.config?.requested, document.config?.effective)) {
    blockers.push({
      kind: 'carrier-config-fallback-or-substitution',
      requested: clone(document.config?.requested ?? null),
      effective: clone(document.config?.effective ?? null),
      fallbackUsed: document.config?.fallbackUsed ?? null,
    });
  }
  const actualOrder = document.cages.map(cage => cage.constructionId);
  if (!sameCanonicalValue(actualOrder, document.source?.orderedConstructionIds || [])) {
    blockers.push({
      kind: 'carrier-construction-order-mismatch',
      requested: clone(document.source?.orderedConstructionIds || []),
      effective: actualOrder,
    });
  }
  for (const cage of document.cages) {
    try {
      blockers.push(...validateCage(cage, config));
    } catch (error) {
      blockers.push(blocker('carrier-validation-exception', cage, {
        message: error.message,
      }));
    }
  }
  if (blockers.length > 0) {
    return refusal({
      config,
      document,
      phase: 'carrier-admission',
      blockers,
      lastTrustworthyEvidence: verifiedEvidence,
    });
  }

  const solverCarrier = {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_SOLVER_CARRIER_SCHEMA,
    sourceDocument: {
      schema: document.schema,
      sha256: document.identity.sha256,
    },
    orderedConstructionIds: actualOrder,
    cages: document.cages.map(cage => ({
      cageId: cage.id,
      constructionId: cage.constructionId,
      sourceIdentity: clone(cage.sourceIdentity),
      manifest: clone(cage.genericManifest),
    })),
  };
  solverCarrier.identity = {
    domain: 'canonical-json-self-excluding-top-level-identity',
    sha256: hashMuscleCompartmentRingCageCanonicalJson(solverCarrier),
  };
  return {
    schema: MUSCLE_COMPARTMENT_RING_CAGE_ADMISSION_SCHEMA,
    status: 'admitted',
    phase: 'carrier-admission-complete',
    route: routeReceipt(),
    config: {
      requested: clone(config),
      effective: clone(config),
      fallbackUsed: false,
    },
    input: {
      schema: document.schema,
      requestedSha256: config.expectedDocumentSha256 ?? document.identity.sha256,
      effectiveSha256: document.identity.sha256,
    },
    lastTrustworthyEvidence: {
      phase: 'all-cages-verified',
      cageCount: document.cages.length,
      orderedConstructionIds: actualOrder,
    },
    blockingMechanisms: [],
    solverCarrier,
  };
}

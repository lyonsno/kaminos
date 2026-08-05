import { createHash } from 'node:crypto';

export const POSITIVE_VOLUME_CAGE_MANIFEST_SCHEMA =
  'kaminos.positive-volume-cage-manifest.v0';
export const POSITIVE_VOLUME_CAGE_PREFLIGHT_SCHEMA =
  'kaminos.positive-volume-cage-preflight.v0';

const NUMERIC_TOLERANCE = 1e-12;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function semanticHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
}

function assertPosition(value, label) {
  if (!Array.isArray(value) || value.length !== 3 ||
      value.some(component => !Number.isFinite(component))) {
    throw new Error(`${label} must be a finite three-vector`);
  }
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function distance(left, right) {
  return Math.hypot(...subtract(left, right));
}

function signedTetrahedronVolume(a, b, c, d) {
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function uniqueIdentifiers(records, label) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`${label} must be a nonempty array`);
  }
  const seen = new Set();
  for (const record of records) {
    assertObject(record, `${label} record`);
    assertIdentifier(record.id, `${label} id`);
    if (seen.has(record.id)) throw new Error(`${label} ids must be unique`);
    seen.add(record.id);
  }
  return seen;
}

function validateRouteIdentity(manifest) {
  assertIdentifier(manifest.requestedRoute, 'requested route');
  assertIdentifier(manifest.effectiveRoute, 'effective route');
  if (manifest.requestedRoute !== manifest.effectiveRoute) {
    throw new Error('requested and effective route identity mismatch');
  }
  if (manifest.fallbackUsed !== false) {
    throw new Error('positive-volume cage preflight forbids fallback');
  }
  assertObject(manifest.requestedConfig, 'requested config');
  assertObject(manifest.effectiveConfig, 'effective config');
  if (semanticHash(manifest.requestedConfig) !== semanticHash(manifest.effectiveConfig)) {
    throw new Error('requested and effective config identity mismatch');
  }
}

function validatePreGeometryConstraintSurface(manifest) {
  assertObject(manifest, 'cage manifest');
  if (manifest.schema !== POSITIVE_VOLUME_CAGE_MANIFEST_SCHEMA) {
    throw new Error('positive-volume cage manifest schema mismatch');
  }
  assertIdentifier(manifest.id, 'manifest id');
  assertObject(manifest.source, 'source identity');
  assertIdentifier(manifest.source.id, 'source id');
  validateRouteIdentity(manifest);

  const nodeIds = uniqueIdentifiers(manifest.nodes, 'node');
  const nodesById = new Map(manifest.nodes.map(node => {
    assertPosition(node.rest, `node ${node.id} rest position`);
    return [node.id, node];
  }));

  if (!Array.isArray(manifest.constraints)) {
    throw new Error('constraints must be an array');
  }
  for (const constraint of manifest.constraints) {
    assertObject(constraint, 'constraint');
    if (!nodeIds.has(constraint.nodeId)) {
      throw new Error(`constraint names unknown node ${constraint.nodeId}`);
    }
    assertIdentifier(constraint.authority, 'constraint authority');
    assertPosition(constraint.position, `constraint ${constraint.nodeId} position`);
  }

  return {
    ...structuredClone(manifest),
    semanticHashes: {
      topology: semanticHash({ nodes: manifest.nodes, cells: manifest.cells }),
      constraints: semanticHash(manifest.constraints),
      embedding: semanticHash(manifest.embedding),
      source: semanticHash(manifest.source),
    },
    nodesById,
  };
}

export function validatePositiveVolumeCageManifest(manifest) {
  const preGeometry = validatePreGeometryConstraintSurface(manifest);
  const nodeIds = new Set(preGeometry.nodes.map(node => node.id));
  const { nodesById } = preGeometry;

  uniqueIdentifiers(preGeometry.cells, 'cell');
  const cells = preGeometry.cells.map(cell => {
    if (!Array.isArray(cell.nodeIds) || cell.nodeIds.length !== 4 ||
        new Set(cell.nodeIds).size !== 4) {
      throw new Error(`cell ${cell.id} must name four distinct node ids`);
    }
    for (const nodeId of cell.nodeIds) {
      if (!nodeIds.has(nodeId)) throw new Error(`cell ${cell.id} names unknown node ${nodeId}`);
    }
    const [a, b, c, d] = cell.nodeIds.map(nodeId => nodesById.get(nodeId).rest);
    const restSignedVolume = signedTetrahedronVolume(a, b, c, d);
    if (!(restSignedVolume > NUMERIC_TOLERANCE)) {
      throw new Error(`cell ${cell.id} rest cell orientation must be positive`);
    }
    return { ...structuredClone(cell), restSignedVolume };
  });

  if (!Array.isArray(preGeometry.source.vertexIds)) {
    throw new Error('source vertexIds must be an array');
  }
  const sourceVertexIds = new Set(preGeometry.source.vertexIds);
  if (sourceVertexIds.size !== preGeometry.source.vertexIds.length) {
    throw new Error('source vertex ids must be unique');
  }
  if (!Array.isArray(preGeometry.source.vertexPositions) ||
      preGeometry.source.vertexPositions.length !== sourceVertexIds.size) {
    throw new Error(
      'source vertexPositions must cover every source vertex exactly once',
    );
  }
  const sourcePositionsById = new Map();
  for (const vertex of preGeometry.source.vertexPositions) {
    assertObject(vertex, 'source vertex position');
    assertIdentifier(vertex.id, 'source vertex position id');
    if (!sourceVertexIds.has(vertex.id)) {
      throw new Error(`source vertexPositions names unknown vertex ${vertex.id}`);
    }
    if (sourcePositionsById.has(vertex.id)) {
      throw new Error('source vertexPositions ids must be unique');
    }
    assertPosition(vertex.rest, `source vertex ${vertex.id} rest position`);
    sourcePositionsById.set(vertex.id, vertex.rest);
  }
  if (!Array.isArray(preGeometry.source.triangleIds)) {
    throw new Error('source triangleIds must be an array');
  }

  if (!Array.isArray(preGeometry.embedding) ||
      preGeometry.embedding.length !== sourceVertexIds.size) {
    throw new Error('embedding must cover every source surface vertex exactly once');
  }
  const embeddedVertexIds = new Set();
  const embedding = preGeometry.embedding.map(entry => {
    assertObject(entry, 'embedding entry');
    assertIdentifier(entry.surfaceVertexId, 'embedding surface vertex id');
    if (!sourceVertexIds.has(entry.surfaceVertexId)) {
      throw new Error(`embedding names unknown source vertex ${entry.surfaceVertexId}`);
    }
    if (embeddedVertexIds.has(entry.surfaceVertexId)) {
      throw new Error('embedding surface vertex ids must be unique');
    }
    embeddedVertexIds.add(entry.surfaceVertexId);
    if (!Array.isArray(entry.nodeIds) || !Array.isArray(entry.weights) ||
        entry.nodeIds.length === 0 || entry.nodeIds.length !== entry.weights.length) {
      throw new Error('embedding node ids and weights must be nonempty aligned arrays');
    }
    for (const nodeId of entry.nodeIds) {
      if (!nodeIds.has(nodeId)) throw new Error(`embedding names unknown node ${nodeId}`);
    }
    if (entry.weights.some(weight => !Number.isFinite(weight))) {
      throw new Error('embedding weights must be finite');
    }
    const weightSum = entry.weights.reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(weightSum - 1) > NUMERIC_TOLERANCE) {
      throw new Error('embedding weights must sum to one');
    }
    const reconstructedRest = [0, 0, 0];
    entry.nodeIds.forEach((nodeId, index) => {
      const rest = nodesById.get(nodeId).rest;
      for (let axis = 0; axis < 3; axis += 1) {
        reconstructedRest[axis] += rest[axis] * entry.weights[index];
      }
    });
    const restReconstructionError = distance(
      reconstructedRest,
      sourcePositionsById.get(entry.surfaceVertexId),
    );
    if (restReconstructionError > NUMERIC_TOLERANCE) {
      throw new Error(
        `embedding must reconstruct source rest position for ${entry.surfaceVertexId}`,
      );
    }
    return {
      ...structuredClone(entry),
      restReconstructionError,
    };
  });

  const { nodesById: ignoredNodesById, ...validated } = preGeometry;
  return {
    ...validated,
    cells,
    embedding,
  };
}

function manifestIdentity(validated) {
  return {
    schema: validated.schema,
    id: validated.id,
    sourceId: validated.source.id,
    semanticHashes: structuredClone(validated.semanticHashes),
  };
}

function findConstraintConflict(validated) {
  const byNode = new Map();
  for (const constraint of validated.constraints) {
    const prior = byNode.get(constraint.nodeId) ?? [];
    prior.push(constraint);
    byNode.set(constraint.nodeId, prior);
  }
  for (const [nodeId, constraints] of byNode) {
    const reference = constraints[0];
    const conflicting = constraints.find(candidate =>
      distance(reference.position, candidate.position) > NUMERIC_TOLERANCE
    );
    if (conflicting) {
      return {
        code: 'constraint-conflict',
        nodeId,
        authorities: [reference.authority, conflicting.authority],
        positions: [
          [...reference.position],
          [...conflicting.position],
        ],
      };
    }
  }
  return null;
}

function reportEnvelope(validated) {
  return {
    schema: POSITIVE_VOLUME_CAGE_PREFLIGHT_SCHEMA,
    requestedRoute: validated.requestedRoute,
    effectiveRoute: validated.effectiveRoute,
    fallbackUsed: validated.fallbackUsed,
    requestedConfig: structuredClone(validated.requestedConfig),
    effectiveConfig: structuredClone(validated.effectiveConfig),
    manifestIdentity: manifestIdentity(validated),
    primaryOutput: null,
  };
}

export function runPositiveVolumeCagePreflight(manifest) {
  const preGeometry = validatePreGeometryConstraintSurface(manifest);
  const conflict = findConstraintConflict(preGeometry);
  if (conflict) {
    return {
      ...reportEnvelope(preGeometry),
      status: 'failed',
      failurePhase: 'constraint-validation',
      lastTrustworthyEvidence:
        'manifest, route, node, and constraint identity validated; topology not evaluated',
      error: conflict,
    };
  }
  const validated = validatePositiveVolumeCageManifest(preGeometry);
  return {
    ...reportEnvelope(validated),
    status: 'admitted',
    failurePhase: null,
    lastTrustworthyEvidence: 'manifest identity, topology, embedding, route, and constraints validated',
    error: null,
    contractEvidence: {
      nodeCount: validated.nodes.length,
      cellCount: validated.cells.length,
      embeddedSurfaceVertexCount: validated.embedding.length,
      minimumRestSignedCellVolume: Math.min(
        ...validated.cells.map(cell => cell.restSignedVolume),
      ),
    },
  };
}

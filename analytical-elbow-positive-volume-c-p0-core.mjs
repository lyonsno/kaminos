import { createHash } from 'node:crypto';

import {
  createAnalyticalElbowWToP0Input,
  evaluateAnalyticalElbowP0GeometryState,
} from './analytical-elbow-positive-volume-w-to-p0-core.mjs';

export const ANALYTICAL_ELBOW_C_P0_INPUT_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-c-p0-input.v0';
export const ANALYTICAL_ELBOW_C_P0_REPORT_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-c-p0-report.v0';
export const ANALYTICAL_ELBOW_C_P0_BUNDLE_SCHEMA =
  'kaminos.analytical-elbow-positive-volume-c-p0-bundle.v0';

const ROUTE = 'analytical-elbow-positive-volume-c-p0';
const OUTPUT_ID = 'analytical-elbow-c-p0-v0';

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

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function dot(left, right) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function distance(left, right) {
  return Math.hypot(...subtract(left, right));
}

function signedTetrahedronVolume(a, b, c, d) {
  return dot(subtract(b, a), cross(subtract(c, a), subtract(d, a))) / 6;
}

function rotateAroundZ(point, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    point[0] * cosine - point[1] * sine,
    point[0] * sine + point[1] * cosine,
    point[2],
  ];
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function edgeKey(left, right) {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function createSolverGeometry() {
  const predecessor = createAnalyticalElbowWToP0Input();
  const manifest = predecessor.cageManifest;
  const restById = new Map(manifest.nodes.map(node => [node.id, node.rest]));
  const constrainedIds = new Set(manifest.constraints.map(record => record.nodeId));
  const freeCoordinates = [];
  manifest.nodes.forEach((node, nodeIndex) => {
    if (constrainedIds.has(node.id)) return;
    for (let axis = 0; axis < 3; axis += 1) freeCoordinates.push([nodeIndex, axis]);
  });
  const edges = new Map();
  for (const cell of manifest.cells) {
    for (let left = 0; left < cell.nodeIds.length; left += 1) {
      for (let right = left + 1; right < cell.nodeIds.length; right += 1) {
        const leftId = cell.nodeIds[left];
        const rightId = cell.nodeIds[right];
        const key = edgeKey(leftId, rightId);
        if (!edges.has(key)) {
          edges.set(key, {
            leftId,
            rightId,
            restLength: distance(restById.get(leftId), restById.get(rightId)),
          });
        }
      }
    }
  }
  const cells = manifest.cells.map(cell => ({
    nodeIds: cell.nodeIds,
    restVolume: signedTetrahedronVolume(
      ...cell.nodeIds.map(nodeId => restById.get(nodeId)),
    ),
  }));
  return { manifest, freeCoordinates, edges: [...edges.values()], cells };
}

function objectiveFor(posedNodes, solverGeometry, effectiveConfig) {
  const positions = new Map(posedNodes.map(node => [node.id, node.position]));
  let edgeEnergy = 0;
  for (const edge of solverGeometry.edges) {
    const posedLength = distance(
      positions.get(edge.leftId),
      positions.get(edge.rightId),
    );
    const strain = Math.log(posedLength / edge.restLength);
    edgeEnergy += strain * strain;
  }
  edgeEnergy /= solverGeometry.edges.length;

  const cellRatios = solverGeometry.cells.map(cell =>
    signedTetrahedronVolume(...cell.nodeIds.map(nodeId => positions.get(nodeId))) /
      cell.restVolume
  );
  let barrierEnergy = 0;
  for (const ratio of cellRatios) {
    const violation = Math.max(0, effectiveConfig.volumeBarrierFloor - ratio);
    barrierEnergy += violation * violation;
  }
  barrierEnergy = effectiveConfig.volumeBarrierWeight *
    barrierEnergy / solverGeometry.cells.length;
  return {
    total: edgeEnergy + barrierEnergy,
    edgeEnergy,
    barrierEnergy,
    minimumSignedCellVolumeRatio: Math.min(...cellRatios),
    negativeOrCollapsedCellCount: cellRatios.filter(ratio => !(ratio > 1e-6)).length,
  };
}

function applyEmbedding(entry, positions) {
  const point = [0, 0, 0];
  entry.nodeIds.forEach((nodeId, index) => {
    const node = positions.get(nodeId);
    for (let axis = 0; axis < 3; axis += 1) {
      point[axis] += node[axis] * entry.weights[index];
    }
  });
  return point;
}

function q95EdgeStrain(vertices, triangles, field) {
  const edges = new Set();
  for (const triangle of triangles) {
    for (let index = 0; index < 3; index += 1) {
      const left = triangle.vertexIndices[index];
      const right = triangle.vertexIndices[(index + 1) % 3];
      edges.add(left < right ? `${left}:${right}` : `${right}:${left}`);
    }
  }
  const strains = [...edges].map(key => {
    const [left, right] = key.split(':').map(Number);
    return Math.abs(Math.log(
      distance(vertices[left][field], vertices[right][field]) /
      distance(vertices[left].rest, vertices[right].rest)
    ));
  }).sort((left, right) => left - right);
  return strains[Math.min(strains.length - 1, Math.floor(0.95 * strains.length))];
}

function comparisonDiagnostics(posedNodes, solverGeometry) {
  const predecessor = createAnalyticalElbowWToP0Input();
  const rowWInput = predecessor.rowWInput;
  const positions = new Map(posedNodes.map(node => [node.id, node.position]));
  const embedding = new Map(
    solverGeometry.manifest.embedding.map(entry => [entry.surfaceVertexId, entry]),
  );
  const candidateVertices = rowWInput.source.vertices.map((vertex, index) => ({
    rest: vertex.rest,
    position: embedding.has(vertex.id)
      ? applyEmbedding(embedding.get(vertex.id), positions)
      : rowWInput.construction.posedVertices[index].position,
  }));
  const radians = 35 * Math.PI / 180;
  const controlVertices = rowWInput.source.vertices.map(vertex => ({
    rest: vertex.rest,
    position: rotateAroundZ(
      vertex.rest,
      radians * smoothstep((0.72 - vertex.axial) / 1.44),
    ),
  }));
  return {
    q95AbsoluteLogEdgeStrain: q95EdgeStrain(
      candidateVertices,
      rowWInput.source.triangles,
      'position',
    ),
    scalarControlQ95AbsoluteLogEdgeStrain: q95EdgeStrain(
      controlVertices,
      rowWInput.source.triangles,
      'position',
    ),
  };
}

function solveInitialization(initialization, effectiveConfig, solverGeometry) {
  let posedNodes = structuredClone(initialization.posedNodes);
  let objective = objectiveFor(posedNodes, solverGeometry, effectiveConfig);
  const initialGeometry = evaluateAnalyticalElbowP0GeometryState(posedNodes);
  const iterationHistory = [{
    iteration: 0,
    objective: objective.total,
    edgeEnergy: objective.edgeEnergy,
    barrierEnergy: objective.barrierEnergy,
    minimumSignedCellVolumeRatio: objective.minimumSignedCellVolumeRatio,
    acceptedStep: 0,
  }];
  let step = effectiveConfig.initialStep;

  for (let iteration = 1; iteration <= effectiveConfig.budget; iteration += 1) {
    const gradient = [];
    for (const [nodeIndex, axis] of solverGeometry.freeCoordinates) {
      const plus = structuredClone(posedNodes);
      const minus = structuredClone(posedNodes);
      plus[nodeIndex].position[axis] += effectiveConfig.finiteDifferenceStep;
      minus[nodeIndex].position[axis] -= effectiveConfig.finiteDifferenceStep;
      gradient.push((
        objectiveFor(plus, solverGeometry, effectiveConfig).total -
        objectiveFor(minus, solverGeometry, effectiveConfig).total
      ) / (2 * effectiveConfig.finiteDifferenceStep));
    }
    const gradientNorm = Math.hypot(...gradient);
    if (!(gradientNorm > 1e-10)) break;

    let accepted = false;
    let trialStep = step;
    let candidate;
    let candidateObjective;
    while (trialStep >= effectiveConfig.minimumStep) {
      candidate = structuredClone(posedNodes);
      solverGeometry.freeCoordinates.forEach(([nodeIndex, axis], index) => {
        candidate[nodeIndex].position[axis] -= trialStep * gradient[index];
      });
      candidateObjective = objectiveFor(candidate, solverGeometry, effectiveConfig);
      if (Number.isFinite(candidateObjective.total) &&
          candidateObjective.total < objective.total) {
        accepted = true;
        break;
      }
      trialStep *= 0.5;
    }
    if (!accepted) break;
    posedNodes = candidate;
    objective = candidateObjective;
    step = Math.min(effectiveConfig.initialStep, trialStep * 1.25);
    iterationHistory.push({
      iteration,
      objective: objective.total,
      edgeEnergy: objective.edgeEnergy,
      barrierEnergy: objective.barrierEnergy,
      minimumSignedCellVolumeRatio: objective.minimumSignedCellVolumeRatio,
      acceptedStep: trialStep,
    });
  }

  const finalGeometry = evaluateAnalyticalElbowP0GeometryState(posedNodes);
  const comparison = comparisonDiagnostics(posedNodes, solverGeometry);
  return {
    initialization: initialization.id,
    requestedConfigHash: semanticHash(effectiveConfig),
    effectiveConfigHash: semanticHash(effectiveConfig),
    initialObjective: iterationHistory[0].objective,
    finalObjective: objective.total,
    iterationHistory,
    initialCellOrientation: initialGeometry.cellOrientation,
    initialHardVetoes: initialGeometry.hardVetoes,
    hardVetoes: finalGeometry.hardVetoes,
    comparison,
    finalGeometry: finalGeometry.evaluationValid === true &&
      finalGeometry.allHardVetoesPass === true
      ? {
          posedNodes,
          projection: finalGeometry.projection,
          cellOrientation: finalGeometry.cellOrientation,
          surface: finalGeometry.surface,
        }
      : null,
  };
}

function config() {
  return {
    parameterization: 'P0',
    objective: 'rest-edge-log-strain-plus-signed-cell-volume-barrier',
    solver: 'deterministic-central-difference-backtracking-v0',
    budget: 80,
    finiteDifferenceStep: 1e-5,
    initialStep: 0.05,
    minimumStep: 1e-8,
    volumeBarrierFloor: 0.05,
    volumeBarrierWeight: 100,
  };
}

export function createAnalyticalElbowCP0Input() {
  const predecessor = createAnalyticalElbowWToP0Input();
  const effectiveConfig = config();
  const constraints = new Map(
    predecessor.cageManifest.constraints.map(record => [record.nodeId, record.position]),
  );
  const neutral = predecessor.cageManifest.nodes.map(node => ({
    id: node.id,
    position: [...(constraints.get(node.id) ?? node.rest)],
  }));
  return {
    schema: ANALYTICAL_ELBOW_C_P0_INPUT_SCHEMA,
    id: OUTPUT_ID,
    requestedRoute: ROUTE,
    effectiveRoute: ROUTE,
    fallbackUsed: false,
    requestedConfig: structuredClone(effectiveConfig),
    effectiveConfig: structuredClone(effectiveConfig),
    predecessorIdentity: {
      source: predecessor.cageManifest.source.id,
      projection: predecessor.projection.semanticHash,
      manifest: semanticHash(predecessor.cageManifest),
    },
    initializations: [
      { id: 'w-derived', posedNodes: structuredClone(predecessor.projection.posedNodes) },
      { id: 'neutral-boundary-applied', posedNodes: neutral },
    ],
  };
}

function invalidReport(input, message) {
  return {
    schema: ANALYTICAL_ELBOW_C_P0_REPORT_SCHEMA,
    status: 'C_P0_INVALID',
    requestedRoute: input?.requestedRoute ?? ROUTE,
    effectiveRoute: input?.effectiveRoute ?? null,
    fallbackUsed: input?.fallbackUsed ?? null,
    requestedConfig: structuredClone(input?.requestedConfig ?? null),
    effectiveConfig: structuredClone(input?.effectiveConfig ?? null),
    failurePhase: 'identity-validation',
    lastTrustworthyEvidence: message,
    configHash: null,
    runs: [],
    primaryOutput: null,
    error: { code: 'c-p0-identity-invalid' },
    claimCeiling: 'invalid C(P0) receipt; no solver or mechanism claim',
  };
}

export function evaluateAnalyticalElbowCP0(input) {
  const expected = createAnalyticalElbowCP0Input();
  if (!input || input.schema !== ANALYTICAL_ELBOW_C_P0_INPUT_SCHEMA ||
      input.id !== OUTPUT_ID || input.requestedRoute !== ROUTE ||
      input.effectiveRoute !== ROUTE || input.fallbackUsed !== false ||
      semanticHash(input.requestedConfig) !== semanticHash(expected.requestedConfig) ||
      semanticHash(input.effectiveConfig) !== semanticHash(expected.effectiveConfig) ||
      semanticHash(input.predecessorIdentity) !== semanticHash(expected.predecessorIdentity) ||
      semanticHash(input.initializations) !== semanticHash(expected.initializations)) {
    return invalidReport(input, 'C(P0) canonical route, config, predecessor, or initialization mismatch');
  }

  const solverGeometry = createSolverGeometry();
  const runs = input.initializations.map(initialization =>
    solveInitialization(initialization, input.effectiveConfig, solverGeometry)
  );
  const complete = runs.every(run => run.finalGeometry !== null);
  const improvementDelta = 1e-6;
  const candidateRuns = runs.filter(run =>
    run.finalGeometry !== null &&
    run.comparison.q95AbsoluteLogEdgeStrain <=
      run.comparison.scalarControlQ95AbsoluteLogEdgeStrain - improvementDelta
  ).map(run => run.initialization);
  return {
    schema: ANALYTICAL_ELBOW_C_P0_REPORT_SCHEMA,
    status: complete ? 'C_P0_COMPLETE' : 'C_P0_NO_LAWFUL_PAIR',
    requestedRoute: input.requestedRoute,
    effectiveRoute: input.effectiveRoute,
    fallbackUsed: input.fallbackUsed,
    requestedConfig: structuredClone(input.requestedConfig),
    effectiveConfig: structuredClone(input.effectiveConfig),
    failurePhase: complete ? null : 'final-hard-veto-evaluation',
    lastTrustworthyEvidence:
      'canonical matched initializations, deterministic solve history, and final hard vetoes evaluated',
    configHash: semanticHash(input.effectiveConfig),
    runs,
    controlComparison: {
      scalarControlQ95AbsoluteLogEdgeStrain:
        runs[0].comparison.scalarControlQ95AbsoluteLogEdgeStrain,
      improvementDelta,
      candidateRuns,
      status: candidateRuns.length > 0
        ? 'NUMERICAL_CANDIDATE'
        : 'NO_NUMERICAL_IMPROVEMENT',
    },
    primaryOutput: complete ? OUTPUT_ID : null,
    error: complete ? null : { code: 'c-p0-no-lawful-pair' },
    claimCeiling:
      'matched P0 solver basin evidence on one synthetic sleeve; no visual, transfer, anatomy, motion, or production claim',
  };
}

export function createAnalyticalElbowCP0Bundle() {
  const input = createAnalyticalElbowCP0Input();
  return {
    schema: ANALYTICAL_ELBOW_C_P0_BUNDLE_SCHEMA,
    status: 'complete',
    case: 'c-p0',
    input,
    report: evaluateAnalyticalElbowCP0(input),
  };
}

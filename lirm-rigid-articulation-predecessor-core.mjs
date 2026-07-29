import { createHash } from 'node:crypto';

export const RIGID_ARTICULATION_ASSAY_ROUTE =
  'kaminos/lirm-719024/rigid-articulation-predecessor-v0';
export const RIGID_ARTICULATION_SOURCE_HASH =
  'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
export const RIGID_ARTICULATION_ANNOTATION_HASH =
  'sha256:2440993b8a812eef99f4f6ebbae268297b967122e3fc806d324bc64d41008116';
export const RIGID_ARTICULATION_SUPPORT_ID = 'rear-left';

const EPSILON = 1e-12;

function assertPoint(value, label) {
  if (!Array.isArray(value)
      || value.length !== 3
      || value.some(component => !Number.isFinite(component))) {
    throw new Error(`${label} must be a finite three-component point`);
  }
  return value.map(Number);
}

function add(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function multiply(value, scale) {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value, label) {
  const magnitude = length(value);
  if (!(magnitude > EPSILON)) throw new Error(`${label} must be nonzero`);
  return multiply(value, 1 / magnitude);
}

function point(positions, vertex) {
  const offset = vertex * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function setPoint(positions, vertex, value) {
  const offset = vertex * 3;
  positions[offset] = value[0];
  positions[offset + 1] = value[1];
  positions[offset + 2] = value[2];
}

function rotateVector(value, axis, radians) {
  if (radians === 0) return [...value];
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return add(
    add(multiply(value, cosine), multiply(cross(axis, value), sine)),
    multiply(axis, dot(axis, value) * (1 - cosine)),
  );
}

function rotatePoint(value, center, axis, radians) {
  return add(center, rotateVector(subtract(value, center), axis, radians));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function hashIdentity(value) {
  const bytes = JSON.stringify(canonicalize(value));
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertPositions(positions) {
  if (!ArrayBuffer.isView(positions)
      || positions.length === 0
      || positions.length % 3 !== 0) {
    throw new Error('positions must be a nonempty packed numeric array');
  }
}

function assertRigidIndices(indices, vertexCount) {
  if (!Array.isArray(indices) || indices.length === 0) {
    throw new Error('rigidVertexIndices must be a nonempty array');
  }
  const unique = new Set();
  for (const vertex of indices) {
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
      throw new Error('rigidVertexIndices contains an out-of-range vertex');
    }
    if (unique.has(vertex)) throw new Error('rigidVertexIndices must be unique');
    unique.add(vertex);
  }
}

export function freezeRigidJointFrame({
  id,
  center,
  axis,
  positiveReference,
  sourceVertexWitnesses,
  authority,
} = {}) {
  if (typeof id !== 'string' || !id) throw new Error('joint frame requires an id');
  if (typeof authority !== 'string' || !authority) {
    throw new Error('joint frame requires authority');
  }
  if (!sourceVertexWitnesses || typeof sourceVertexWitnesses !== 'object') {
    throw new Error('joint frame requires source vertex witnesses');
  }
  for (const key of ['center', 'axisA', 'axisB']) {
    if (!Number.isInteger(sourceVertexWitnesses[key])
        || sourceVertexWitnesses[key] < 0) {
      throw new Error(`joint frame requires source vertex witness ${key}`);
    }
  }
  const frozenAxis = normalize(assertPoint(axis, 'joint frame axis'), 'joint frame axis');
  const rawReference = assertPoint(positiveReference, 'joint frame positive reference');
  const projectedReference = subtract(
    rawReference,
    multiply(frozenAxis, dot(rawReference, frozenAxis)),
  );
  const frozen = {
    id,
    center: assertPoint(center, 'joint frame center'),
    axis: frozenAxis,
    positiveReference: normalize(
      projectedReference,
      'joint frame positive reference projected onto the rotation plane',
    ),
    positiveSign: 1,
    sourceVertexWitnesses: {
      center: sourceVertexWitnesses.center,
      axisA: sourceVertexWitnesses.axisA,
      axisB: sourceVertexWitnesses.axisB,
    },
    authority,
  };
  return Object.freeze({
    ...frozen,
    sourceVertexWitnesses: Object.freeze(frozen.sourceVertexWitnesses),
    identity: hashIdentity(frozen),
  });
}

export function applyRigidChain({
  positions,
  rigidVertexIndices,
  rootFrame,
  distalFrame = null,
  rootRadians = 0,
  distalRadians = 0,
} = {}) {
  assertPositions(positions);
  assertRigidIndices(rigidVertexIndices, positions.length / 3);
  if (!rootFrame?.identity) throw new Error('rigid chain requires a frozen root frame');
  if (!Number.isFinite(rootRadians) || !Number.isFinite(distalRadians)) {
    throw new Error('rigid chain angles must be finite');
  }
  if (distalRadians !== 0 && !distalFrame?.identity) {
    throw new Error('nonzero distal rotation requires a frozen distal frame');
  }

  const output = Float64Array.from(positions);
  for (const vertex of rigidVertexIndices) {
    setPoint(
      output,
      vertex,
      rotatePoint(point(positions, vertex), rootFrame.center, rootFrame.axis, rootRadians),
    );
  }

  // The exact zero branch is load-bearing: J2(theta, 0) must be bitwise J1(theta).
  if (distalRadians === 0) return output;

  const transformedDistalCenter = rotatePoint(
    distalFrame.center,
    rootFrame.center,
    rootFrame.axis,
    rootRadians,
  );
  const transformedDistalAxis = rotateVector(
    distalFrame.axis,
    rootFrame.axis,
    rootRadians,
  );
  for (const vertex of rigidVertexIndices) {
    setPoint(
      output,
      vertex,
      rotatePoint(
        point(output, vertex),
        transformedDistalCenter,
        transformedDistalAxis,
        distalRadians,
      ),
    );
  }
  return output;
}

export function measureRigidSetClearance({
  positions,
  rigidVertexIndices,
  terrainPoint,
  terrainNormal,
  diameter,
  numericTolerance = 1e-9,
} = {}) {
  assertPositions(positions);
  assertRigidIndices(rigidVertexIndices, positions.length / 3);
  if (!(diameter > 0) || !Number.isFinite(diameter)) {
    throw new Error('clearance diameter must be finite and positive');
  }
  if (!(numericTolerance >= 0) || !Number.isFinite(numericTolerance)) {
    throw new Error('clearance numeric tolerance must be finite and nonnegative');
  }
  const origin = assertPoint(terrainPoint, 'terrain point');
  const normal = normalize(assertPoint(terrainNormal, 'terrain normal'), 'terrain normal');
  const values = rigidVertexIndices.map(vertex => (
    dot(subtract(point(positions, vertex), origin), normal)
  ));
  const minimum = Math.min(...values);
  const centroid = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    minimum,
    centroid,
    maximum: Math.max(...values),
    normalizedMinimum: minimum / diameter,
    numericTolerance,
    passes: minimum > numericTolerance,
    values,
  };
}

export function createSphereCollisionField({ identity, center, radius } = {}) {
  if (typeof identity !== 'string' || !identity) {
    throw new Error('collision field requires an identity');
  }
  const origin = assertPoint(center, 'collision sphere center');
  if (!(radius > 0) || !Number.isFinite(radius)) {
    throw new Error('collision sphere radius must be finite and positive');
  }
  return Object.freeze({
    identity,
    distance(value) {
      return length(subtract(assertPoint(value, 'collision sample'), origin)) - radius;
    },
  });
}

function squaredDistance(left, right) {
  const delta = subtract(left, right);
  return dot(delta, delta);
}

function pointSegmentDistanceSquared(sample, start, end) {
  const edge = subtract(end, start);
  const denominator = dot(edge, edge);
  if (denominator <= EPSILON) return squaredDistance(sample, start);
  const fraction = Math.max(
    0,
    Math.min(1, dot(subtract(sample, start), edge) / denominator),
  );
  return squaredDistance(sample, add(start, multiply(edge, fraction)));
}

// Closest-point regions from Real-Time Collision Detection, with a degenerate fallback.
function pointTriangleDistanceSquared(sample, a, b, c) {
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const ap = subtract(sample, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);

  const bp = subtract(sample, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const fraction = d1 / (d1 - d3);
    return squaredDistance(sample, add(a, multiply(ab, fraction)));
  }

  const cp = subtract(sample, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const fraction = d2 / (d2 - d6);
    return squaredDistance(sample, add(a, multiply(ac, fraction)));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = subtract(c, b);
    const fraction = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return squaredDistance(sample, add(b, multiply(edge, fraction)));
  }

  const denominator = va + vb + vc;
  if (Math.abs(denominator) <= EPSILON) {
    return Math.min(
      pointSegmentDistanceSquared(sample, a, b),
      pointSegmentDistanceSquared(sample, b, c),
      pointSegmentDistanceSquared(sample, c, a),
    );
  }
  const inverse = 1 / denominator;
  const v = vb * inverse;
  const w = vc * inverse;
  return squaredDistance(sample, add(a, add(multiply(ab, v), multiply(ac, w))));
}

function pointAabbDistanceSquared(sample, minimum, maximum) {
  let total = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    if (sample[axis] < minimum[axis]) {
      const delta = minimum[axis] - sample[axis];
      total += delta * delta;
    } else if (sample[axis] > maximum[axis]) {
      const delta = sample[axis] - maximum[axis];
      total += delta * delta;
    }
  }
  return total;
}

function mergeBounds(entries) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const entry of entries) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], entry.minimum[axis]);
      maximum[axis] = Math.max(maximum[axis], entry.maximum[axis]);
    }
  }
  return { minimum, maximum };
}

function buildTriangleBvh(entries, leafSize = 12) {
  const { minimum, maximum } = mergeBounds(entries);
  if (entries.length <= leafSize) {
    return { minimum, maximum, entries };
  }
  const extents = subtract(maximum, minimum);
  const axis = extents.indexOf(Math.max(...extents));
  entries.sort((left, right) => left.centroid[axis] - right.centroid[axis]);
  const midpoint = Math.floor(entries.length / 2);
  return {
    minimum,
    maximum,
    left: buildTriangleBvh(entries.slice(0, midpoint), leafSize),
    right: buildTriangleBvh(entries.slice(midpoint), leafSize),
  };
}

function nearestTriangleDistanceSquared(node, sample, best = Infinity) {
  if (pointAabbDistanceSquared(sample, node.minimum, node.maximum) >= best) return best;
  if (node.entries) {
    for (const triangle of node.entries) {
      best = Math.min(
        best,
        pointTriangleDistanceSquared(sample, triangle.a, triangle.b, triangle.c),
      );
    }
    return best;
  }
  const leftDistance = pointAabbDistanceSquared(
    sample,
    node.left.minimum,
    node.left.maximum,
  );
  const rightDistance = pointAabbDistanceSquared(
    sample,
    node.right.minimum,
    node.right.maximum,
  );
  const first = leftDistance <= rightDistance ? node.left : node.right;
  const second = first === node.left ? node.right : node.left;
  best = nearestTriangleDistanceSquared(first, sample, best);
  return nearestTriangleDistanceSquared(second, sample, best);
}

export function createTriangleCollisionField({
  identity,
  positions,
  indices,
  excludedVertexIndices = [],
} = {}) {
  if (typeof identity !== 'string' || !identity) {
    throw new Error('triangle collision field requires an identity');
  }
  assertPositions(positions);
  if (!ArrayBuffer.isView(indices) || indices.length < 3 || indices.length % 3 !== 0) {
    throw new Error('triangle collision field requires packed triangle indices');
  }
  const excluded = new Set(excludedVertexIndices);
  const triangles = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices = [indices[offset], indices[offset + 1], indices[offset + 2]];
    if (vertices.some(vertex => excluded.has(vertex))) continue;
    const points = vertices.map(vertex => point(positions, vertex));
    const minimum = [0, 1, 2].map(axis => Math.min(...points.map(value => value[axis])));
    const maximum = [0, 1, 2].map(axis => Math.max(...points.map(value => value[axis])));
    triangles.push({
      a: points[0],
      b: points[1],
      c: points[2],
      minimum,
      maximum,
      centroid: multiply(add(add(points[0], points[1]), points[2]), 1 / 3),
    });
  }
  if (triangles.length === 0) {
    throw new Error('triangle collision field has no body triangles after exclusion');
  }
  const bvh = buildTriangleBvh(triangles);
  return Object.freeze({
    identity,
    triangleCount: triangles.length,
    excludedVertexCount: excluded.size,
    distance(value) {
      const sample = assertPoint(value, 'triangle collision sample');
      return Math.sqrt(nearestTriangleDistanceSquared(bvh, sample));
    },
  });
}

function transformedFrameAfterRoot(frame, rootFrame, rootRadians) {
  return {
    center: rotatePoint(frame.center, rootFrame.center, rootFrame.axis, rootRadians),
    axis: rotateVector(frame.axis, rootFrame.axis, rootRadians),
  };
}

function maximumRadius(positions, rigidVertexIndices, center) {
  return Math.max(
    ...rigidVertexIndices.map(vertex => length(subtract(point(positions, vertex), center))),
  );
}

function collisionDistances(positions, rigidVertexIndices, collisionField) {
  return rigidVertexIndices.map(vertex => collisionField.distance(point(positions, vertex)));
}

function collisionPassesRelativeToSource({
  current,
  source,
  collisionTolerance,
}) {
  for (let index = 0; index < current.length; index += 1) {
    if (source[index] > collisionTolerance) {
      if (current[index] <= collisionTolerance) return false;
    } else if (current[index] < source[index] - collisionTolerance) {
      return false;
    }
  }
  return true;
}

export function evaluateSweptRigidCandidate({
  positions,
  rigidVertexIndices,
  rootFrame,
  distalFrame = null,
  rootRadians = 0,
  distalRadians = 0,
  terrainPoint,
  terrainNormal,
  diameter,
  collisionField,
  numericTolerance = 1e-9,
  collisionTolerance = 1e-6,
  maximumWitnessTravel,
} = {}) {
  assertPositions(positions);
  assertRigidIndices(rigidVertexIndices, positions.length / 3);
  if (!collisionField?.identity || typeof collisionField.distance !== 'function') {
    throw new Error('swept candidate requires an identified collision field');
  }
  if (!(maximumWitnessTravel > 0) || !Number.isFinite(maximumWitnessTravel)) {
    throw new Error('maximumWitnessTravel must be finite and positive');
  }
  const rootTravelBound =
    maximumRadius(positions, rigidVertexIndices, rootFrame.center) * Math.abs(rootRadians);
  let distalTravelBound = 0;
  if (distalFrame && distalRadians !== 0) {
    const transformed = transformedFrameAfterRoot(distalFrame, rootFrame, rootRadians);
    distalTravelBound =
      maximumRadius(positions, rigidVertexIndices, transformed.center) * Math.abs(distalRadians);
  }
  const totalTravelBound = rootTravelBound + distalTravelBound;
  const sequentialIndices = rigidVertexIndices.map((_, index) => index);
  const rigidSourcePositions = new Float64Array(rigidVertexIndices.length * 3);
  for (let index = 0; index < rigidVertexIndices.length; index += 1) {
    setPoint(rigidSourcePositions, index, point(positions, rigidVertexIndices[index]));
  }
  const sourceCollision = collisionDistances(
    rigidSourcePositions,
    sequentialIndices,
    collisionField,
  );
  const sourceClearance = measureRigidSetClearance({
    positions: rigidSourcePositions,
    rigidVertexIndices: sequentialIndices,
    terrainPoint,
    terrainNormal,
    diameter,
    numericTolerance,
  });
  let sweepCollisionMinimum = Infinity;
  let sweepClearanceMinimum = Infinity;
  let sweepCollisionPasses = true;
  let sweepTerrainPasses = true;
  const collisionThresholds = sourceCollision.map(distance => (
    distance > collisionTolerance
      ? collisionTolerance
      : distance - collisionTolerance
  ));

  function realizeState(fraction) {
    const realized = new Float64Array(rigidSourcePositions.length);
    const currentRootRadians = rootRadians * fraction;
    const currentDistalRadians = distalRadians * fraction;
    const transformedDistal = distalFrame && currentDistalRadians !== 0
      ? transformedFrameAfterRoot(distalFrame, rootFrame, currentRootRadians)
      : null;
    for (let index = 0; index < rigidVertexIndices.length; index += 1) {
      let value = rotatePoint(
        point(rigidSourcePositions, index),
        rootFrame.center,
        rootFrame.axis,
        currentRootRadians,
      );
      if (transformedDistal) {
        value = rotatePoint(
          value,
          transformedDistal.center,
          transformedDistal.axis,
          currentDistalRadians,
        );
      }
      setPoint(realized, index, value);
    }
    const currentCollision = collisionDistances(
      realized,
      sequentialIndices,
      collisionField,
    );
    const currentClearance = measureRigidSetClearance({
      positions: realized,
      rigidVertexIndices: sequentialIndices,
      terrainPoint,
      terrainNormal,
      diameter,
      numericTolerance,
    });
    sweepCollisionMinimum = Math.min(sweepCollisionMinimum, ...currentCollision);
    sweepClearanceMinimum = Math.min(sweepClearanceMinimum, currentClearance.minimum);
    if (!collisionPassesRelativeToSource({
      current: currentCollision,
      source: sourceCollision,
      collisionTolerance,
    })) {
      sweepCollisionPasses = false;
    }
    if (currentClearance.minimum < sourceClearance.minimum - numericTolerance) {
      sweepTerrainPasses = false;
    }
    const state = {
      fraction,
      positions: realized,
      collision: currentCollision,
      clearance: currentClearance,
    };
    return state;
  }

  function conservativeMargin(state) {
    const collisionMargin = Math.min(
      ...state.collision.map(
        (distance, index) => distance - collisionThresholds[index],
      ),
    );
    const terrainMargin =
      state.clearance.minimum - (sourceClearance.minimum - numericTolerance);
    return Math.min(collisionMargin, terrainMargin);
  }

  let state = realizeState(0);
  let conservativeCertified = true;
  let sampleCount = 1;
  if (totalTravelBound > 0) {
    while (state.fraction < 1) {
      const margin = conservativeMargin(state);
      if (!(margin > 0)) {
        conservativeCertified = false;
        break;
      }
      // Distance-to-geometry and signed plane distance are 1-Lipschitz.
      const certifiedTravel = Math.min(maximumWitnessTravel, margin / 2);
      const fractionStep = certifiedTravel / totalTravelBound;
      const nextFraction = Math.min(1, state.fraction + fractionStep);
      if (!(nextFraction > state.fraction)) {
        conservativeCertified = false;
        break;
      }
      state = realizeState(nextFraction);
      sampleCount += 1;
      if (!collisionPassesRelativeToSource({
        current: state.collision,
        source: sourceCollision,
        collisionTolerance,
      }) || state.clearance.minimum < sourceClearance.minimum - numericTolerance) {
        break;
      }
    }
  }

  const endpointPositions = applyRigidChain({
    positions,
    rigidVertexIndices,
    rootFrame,
    distalFrame,
    rootRadians,
    distalRadians,
  });
  const endpointClearance = measureRigidSetClearance({
    positions: endpointPositions,
    rigidVertexIndices,
    terrainPoint,
    terrainNormal,
    diameter,
    numericTolerance,
  });
  const endpointCollisionDistances = collisionDistances(
    endpointPositions,
    rigidVertexIndices,
    collisionField,
  );
  const endpointCollision = {
    minimum: Math.min(...endpointCollisionDistances),
    values: endpointCollisionDistances,
    passes: collisionPassesRelativeToSource({
      current: endpointCollisionDistances,
      source: sourceCollision,
      collisionTolerance,
    }),
  };
  return {
    passes:
      endpointClearance.passes
      && endpointCollision.passes
      && sweepCollisionPasses
      && sweepTerrainPasses
      && conservativeCertified
      && state.fraction === 1,
    endpoint: {
      clearance: endpointClearance,
      collision: endpointCollision,
      positions: endpointPositions,
    },
    sweep: {
      sampleCount,
      maximumWitnessTravel,
      conservativeCertified,
      terminalFraction: state.fraction,
      collision: {
        identity: collisionField.identity,
        minimum: sweepCollisionMinimum,
        passes:
          sweepCollisionPasses
          && conservativeCertified
          && state.fraction === 1,
      },
      terrain: {
        minimum: sweepClearanceMinimum,
        sourceMinimum: sourceClearance.minimum,
        passes:
          sweepTerrainPasses
          && conservativeCertified
          && state.fraction === 1,
      },
    },
  };
}

export function assertRigidArticulationReport(report) {
  if (!report || report.schema !== 'kaminos.lirm-rigid-articulation-predecessor-report.v0') {
    throw new Error('rigid articulation report schema mismatch');
  }
  if (report.status !== 'complete' && report.status !== 'failed') {
    throw new Error('rigid articulation report must name a terminal status');
  }
  if (report.requestedRoute !== RIGID_ARTICULATION_ASSAY_ROUTE
      || report.effectiveRoute !== report.requestedRoute) {
    throw new Error('rigid articulation report route identity mismatch');
  }
  if (report.sourceHash !== RIGID_ARTICULATION_SOURCE_HASH
      || report.actualSourceHash !== report.sourceHash) {
    throw new Error('rigid articulation report source identity mismatch');
  }
  if (report.annotationHash !== RIGID_ARTICULATION_ANNOTATION_HASH
      || report.actualAnnotationHash !== report.annotationHash) {
    throw new Error('rigid articulation report annotation identity mismatch');
  }
  if (report.supportId !== RIGID_ARTICULATION_SUPPORT_ID) {
    throw new Error('rigid articulation report support identity mismatch');
  }
  if (typeof report.collisionIdentity !== 'string' || !report.collisionIdentity) {
    throw new Error('rigid articulation report collision identity missing');
  }
  if (!Array.isArray(report.jointFrames)
      || report.jointFrames.length < 1
      || report.jointFrames.some(frame => !frame?.identity)) {
    throw new Error('rigid articulation report requires frozen joint frame identities');
  }
  if (report.nesting?.checked !== true
      || report.nesting.maximumAbsoluteDelta !== 0) {
    throw new Error('rigid articulation report nesting contract failed');
  }
  if (!Array.isArray(report.searches) || report.searches.length === 0) {
    throw new Error('rigid articulation report requires search accounting');
  }
  return report;
}

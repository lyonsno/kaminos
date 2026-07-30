export const CONSTRUCTIONAL_PACKING_SOURCE_SCHEMA =
  'kaminos.constructional-packing-source.v0';
export const CONSTRUCTIONAL_PACKING_RESULT_SCHEMA =
  'kaminos.constructional-packing-result.v0';
export const CONSTRUCTIONAL_SOURCE_AUTHORITY_KINDS = Object.freeze([
  'synthetic-proxy',
  'operator-authored',
  'reference-anchored',
]);
export const CONSTRUCTIONAL_ANATOMICAL_ADMISSION_KINDS = Object.freeze([
  'none',
  'operator-authored',
  'reference-anchored',
]);

const TWO_PI = Math.PI * 2;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value, digits = 9) {
  return Number(value.toFixed(digits));
}

function normalizeAngle(angle) {
  let normalized = angle % TWO_PI;
  if (normalized < 0) normalized += TWO_PI;
  return normalized;
}

function angularDistance(left, right) {
  const distance = Math.abs(normalizeAngle(left) - normalizeAngle(right));
  return Math.min(distance, TWO_PI - distance);
}

function gaussianAngularWeight(angle, center, width) {
  const normalizedDistance = angularDistance(angle, center) / width;
  return Math.exp(-0.5 * normalizedDistance * normalizedDistance);
}

function isFinitePoint(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(Number.isFinite)
  );
}

function isPositiveFinitePoint(value) {
  return isFinitePoint(value) && value.every(component => component > 0);
}

function ellipseRadiusAtAngle(envelope, angle) {
  const [radiusX, radiusY] = envelope.radii;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return 1 / Math.sqrt(
    (cosine * cosine) / (radiusX * radiusX) +
      (sine * sine) / (radiusY * radiusY),
  );
}

function minimumEllipseRadiusOnInterval(envelope, startAngle, endAngle) {
  const candidates = [
    ellipseRadiusAtAngle(envelope, startAngle),
    ellipseRadiusAtAngle(envelope, endAngle),
  ];
  const quarterTurn = Math.PI / 2;
  const firstCriticalIndex = Math.ceil(startAngle / quarterTurn);
  const lastCriticalIndex = Math.floor(endAngle / quarterTurn);
  for (
    let criticalIndex = firstCriticalIndex;
    criticalIndex <= lastCriticalIndex;
    criticalIndex += 1
  ) {
    candidates.push(
      ellipseRadiusAtAngle(envelope, criticalIndex * quarterTurn),
    );
  }
  return Math.min(...candidates);
}

function sampledRadialOffset(envelope, angle) {
  const offsets = envelope.radialOffsets;
  const samplePosition = (normalizeAngle(angle) / TWO_PI) * offsets.length;
  const lowerIndex = Math.floor(samplePosition) % offsets.length;
  const upperIndex = (lowerIndex + 1) % offsets.length;
  const mix = samplePosition - Math.floor(samplePosition);
  return offsets[lowerIndex] * (1 - mix) + offsets[upperIndex] * mix;
}

function pointInsideObstacle(point, obstacle) {
  if (obstacle.kind !== 'circle') {
    throw new Error(`unsupported constructional obstacle kind: ${obstacle.kind}`);
  }
  const dx = point[0] - obstacle.center[0];
  const dy = point[1] - obstacle.center[1];
  return dx * dx + dy * dy <= obstacle.radius * obstacle.radius;
}

function sampleEnvelopeRadiusUnchecked(source, angle) {
  return (
    ellipseRadiusAtAngle(source.envelope, angle) +
    sampledRadialOffset(source.envelope, angle)
  );
}

function pointInsideEnvelope(source, point) {
  const dx = point[0] - source.envelope.center[0];
  const dy = point[1] - source.envelope.center[1];
  const angle = Math.atan2(dy, dx);
  const radius = Math.hypot(dx, dy);
  return radius <= sampleEnvelopeRadiusUnchecked(source, angle);
}

function closestPointOnSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return {
      point: [...start],
      t: 0,
    };
  }
  const projected =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
    lengthSquared;
  const t = clamp(projected, 0, 1);
  return {
    point: [start[0] + dx * t, start[1] + dy * t],
    t,
  };
}

function closestPointOnCenterline(point, compartment) {
  let closest = null;
  const segmentCount = compartment.centerline.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const candidate = closestPointOnSegment(
      point,
      compartment.centerline[index],
      compartment.centerline[index + 1],
    );
    const dx = point[0] - candidate.point[0];
    const dy = point[1] - candidate.point[1];
    const distanceSquared = dx * dx + dy * dy;
    if (!closest || distanceSquared < closest.distanceSquared) {
      closest = {
        ...candidate,
        segmentIndex: index,
        distanceSquared,
      };
    }
  }
  return {
    ...closest,
    pathT: (closest.segmentIndex + closest.t) / segmentCount,
  };
}

function compartmentDistance(point, compartment) {
  const closest = closestPointOnCenterline(point, compartment);
  const dx = (point[0] - closest.point[0]) / compartment.fieldScale[0];
  const dy = (point[1] - closest.point[1]) / compartment.fieldScale[1];
  return dx * dx + dy * dy;
}

function materialCoordinate(point, compartment) {
  const closest = closestPointOnCenterline(point, compartment);
  const segmentStart = compartment.centerline[closest.segmentIndex];
  const segmentEnd = compartment.centerline[closest.segmentIndex + 1];
  const tangentX = segmentEnd[0] - segmentStart[0];
  const tangentY = segmentEnd[1] - segmentStart[1];
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  const normalX = -tangentY / tangentLength;
  const normalY = tangentX / tangentLength;
  const offsetX = point[0] - closest.point[0];
  const offsetY = point[1] - closest.point[1];
  const signedNormalDistance =
    (offsetX * normalX + offsetY * normalY) / compartment.fieldScale[1];
  return [rounded(closest.pathT, 6), rounded(signedNormalDistance, 6)];
}

function validateSource(source) {
  if (source?.schema !== CONSTRUCTIONAL_PACKING_SOURCE_SCHEMA) {
    throw new Error(
      `constructional packing source schema mismatch: ${source?.schema || 'missing'}`,
    );
  }
  if (source.dimension !== 2) {
    throw new Error(`constructional packing v0 expects dimension 2, got ${source.dimension}`);
  }
  if (typeof source.id !== 'string' || source.id.length === 0) {
    throw new Error('constructional source id must be a nonempty string');
  }
  if (!CONSTRUCTIONAL_SOURCE_AUTHORITY_KINDS.includes(source.authority?.kind)) {
    throw new Error(
      `constructional source authority kind must be one of ${CONSTRUCTIONAL_SOURCE_AUTHORITY_KINDS.join(', ')}`,
    );
  }
  if (
    !CONSTRUCTIONAL_ANATOMICAL_ADMISSION_KINDS.includes(
      source.authority?.anatomicalAdmission,
    )
  ) {
    throw new Error(
      `constructional anatomical admission must be one of ${CONSTRUCTIONAL_ANATOMICAL_ADMISSION_KINDS.join(', ')}`,
    );
  }
  if (
    !Number.isInteger(source.grid?.width) ||
    !Number.isInteger(source.grid?.height) ||
    source.grid.width <= 0 ||
    source.grid.height <= 0
  ) {
    throw new Error('constructional grid width and height must be positive integers');
  }
  const bounds = source.grid.bounds;
  if (
    !bounds ||
    ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite) ||
    bounds.maxX <= bounds.minX ||
    bounds.maxY <= bounds.minY
  ) {
    throw new Error('constructional grid bounds must be finite and ordered');
  }
  if (!isFinitePoint(source.envelope?.center)) {
    throw new Error('constructional envelope center must contain finite numbers');
  }
  if (!isPositiveFinitePoint(source.envelope?.radii)) {
    throw new Error('constructional envelope radii must contain positive finite numbers');
  }
  if (
    !Array.isArray(source.envelope.radialOffsets) ||
    source.envelope.radialOffsets.length < 3
  ) {
    throw new Error('constructional envelope requires at least three radialOffsets');
  }
  if (!source.envelope.radialOffsets.every(Number.isFinite)) {
    throw new Error('constructional envelope radialOffsets must contain finite numbers');
  }
  const envelopeSegmentAngle = TWO_PI / source.envelope.radialOffsets.length;
  for (
    let index = 0;
    index < source.envelope.radialOffsets.length;
    index += 1
  ) {
    const startAngle = index * envelopeSegmentAngle;
    const endAngle = (index + 1) * envelopeSegmentAngle;
    const minimumEllipseRadius = minimumEllipseRadiusOnInterval(
      source.envelope,
      startAngle,
      endAngle,
    );
    const minimumSegmentOffset = Math.min(
      source.envelope.radialOffsets[index],
      source.envelope.radialOffsets[
        (index + 1) % source.envelope.radialOffsets.length
      ],
    );
    const conservativeRadiusLowerBound =
      minimumEllipseRadius + minimumSegmentOffset;
    if (
      !Number.isFinite(conservativeRadiusLowerBound) ||
      conservativeRadiusLowerBound <= 0.05
    ) {
      throw new Error(
        `constructional effective envelope radius must remain above 0.05; segment ${index} lower bound is ${conservativeRadiusLowerBound}`,
      );
    }
  }
  if (!Array.isArray(source.obstacles)) {
    throw new Error('constructional source obstacles must be an array');
  }
  for (const obstacle of source.obstacles) {
    if (obstacle.kind !== 'circle') {
      throw new Error(`unsupported constructional obstacle kind: ${obstacle.kind}`);
    }
    if (!isFinitePoint(obstacle.center) || !Number.isFinite(obstacle.radius) || obstacle.radius <= 0) {
      throw new Error('constructional circle obstacle requires a finite center and positive radius');
    }
    if (!pointInsideEnvelope(source, obstacle.center)) {
      throw new Error(
        `constructional obstacle center must remain inside the fitted envelope: ${obstacle.id}`,
      );
    }
  }
  if (!Array.isArray(source.compartments) || source.compartments.length < 2) {
    throw new Error('constructional source requires at least two compartments');
  }
  const compartmentIds = new Set();
  for (const compartment of source.compartments) {
    if (
      typeof compartment.id !== 'string' ||
      compartment.id.length === 0 ||
      compartmentIds.has(compartment.id)
    ) {
      throw new Error(`constructional compartment ids must be unique nonempty strings: ${compartment.id}`);
    }
    compartmentIds.add(compartment.id);
    if (
      !Number.isFinite(compartment.targetShare) ||
      compartment.targetShare <= 0 ||
      compartment.targetShare >= 1
    ) {
      throw new Error(
        `constructional compartment ${compartment.id} targetShare must be finite and between 0 and 1`,
      );
    }
    if (!isPositiveFinitePoint(compartment.fieldScale)) {
      throw new Error(
        `constructional compartment ${compartment.id} fieldScale must contain positive finite numbers`,
      );
    }
    if (
      !Array.isArray(compartment.centerline) ||
      compartment.centerline.length < 2 ||
      !compartment.centerline.every(isFinitePoint)
    ) {
      throw new Error(
        `constructional compartment ${compartment.id} centerline requires at least two finite points`,
      );
    }
    const centerlineLength = compartment.centerline
      .slice(1)
      .reduce((length, point, index) => {
        const prior = compartment.centerline[index];
        return length + Math.hypot(point[0] - prior[0], point[1] - prior[1]);
      }, 0);
    if (centerlineLength <= 0) {
      throw new Error(
        `constructional compartment ${compartment.id} centerline must have nonzero length`,
      );
    }
    if (
      !Array.isArray(compartment.anchors) ||
      compartment.anchors.length === 0 ||
      !compartment.anchors.every(isFinitePoint)
    ) {
      throw new Error(
        `constructional compartment ${compartment.id} requires finite semantic anchors`,
      );
    }
  }
  const targetShareSum = source.compartments.reduce(
    (sum, compartment) => sum + compartment.targetShare,
    0,
  );
  if (Math.abs(targetShareSum - 1) > 1e-8) {
    throw new Error(`constructional compartment target shares must sum to 1, got ${targetShareSum}`);
  }
}

function enumerateActiveCells(source) {
  const { width, height, bounds } = source.grid;
  const stepX = (bounds.maxX - bounds.minX) / width;
  const stepY = (bounds.maxY - bounds.minY) / height;
  const cells = [];
  const obstacleCells = [];
  for (let iy = 0; iy < height; iy += 1) {
    const y = bounds.minY + (iy + 0.5) * stepY;
    for (let ix = 0; ix < width; ix += 1) {
      const x = bounds.minX + (ix + 0.5) * stepX;
      const point = [x, y];
      if (!pointInsideEnvelope(source, point)) continue;
      if (source.obstacles.some(obstacle => pointInsideObstacle(point, obstacle))) {
        obstacleCells.push({ ix, iy, x: rounded(x, 6), y: rounded(y, 6) });
        continue;
      }
      cells.push({
        ix,
        iy,
        x: rounded(x, 6),
        y: rounded(y, 6),
        point,
      });
    }
  }
  return {
    cells,
    obstacleCells,
    stepX,
    stepY,
  };
}

function anchorCellOwners(cells, compartments) {
  const forcedOwners = new Map();
  for (const compartment of compartments) {
    for (const anchor of compartment.anchors) {
      let nearest = null;
      for (const cell of cells) {
        const dx = cell.point[0] - anchor[0];
        const dy = cell.point[1] - anchor[1];
        const distanceSquared = dx * dx + dy * dy;
        if (!nearest || distanceSquared < nearest.distanceSquared) {
          nearest = { cell, distanceSquared };
        }
      }
      if (!nearest) throw new Error(`no active cell available for anchor ${compartment.id}`);
      const key = `${nearest.cell.ix}:${nearest.cell.iy}`;
      const existingOwner = forcedOwners.get(key);
      if (existingOwner && existingOwner !== compartment.id) {
        throw new Error(
          `constructional semantic anchor collision at ${key}: ${existingOwner} and ${compartment.id}`,
        );
      }
      forcedOwners.set(key, compartment.id);
    }
  }
  return forcedOwners;
}

function assignCells(cells, compartments, biases, forcedOwners) {
  const assignments = [];
  const counts = Object.fromEntries(compartments.map(compartment => [compartment.id, 0]));
  for (const cell of cells) {
    const forcedOwner = forcedOwners.get(`${cell.ix}:${cell.iy}`);
    let owner = forcedOwner || null;
    if (!owner) {
      let bestScore = Infinity;
      for (const compartment of compartments) {
        const score =
          compartmentDistance(cell.point, compartment) - biases[compartment.id];
        if (
          score < bestScore ||
          (score === bestScore && compartment.id.localeCompare(owner || '') < 0)
        ) {
          owner = compartment.id;
          bestScore = score;
        }
      }
    }
    counts[owner] += 1;
    assignments.push({
      cell,
      ownerId: owner,
    });
  }
  return { assignments, counts };
}

function fitCompartmentBiases(cells, compartments, forcedOwners) {
  const biases = Object.fromEntries(compartments.map(compartment => [compartment.id, 0]));
  const targetCounts = Object.fromEntries(
    compartments.map(compartment => [
      compartment.id,
      compartment.targetShare * cells.length,
    ]),
  );
  let assignment = null;
  for (let iteration = 0; iteration < 180; iteration += 1) {
    assignment = assignCells(cells, compartments, biases, forcedOwners);
    const learningRate = 1.2 * (1 - iteration / 240);
    for (const compartment of compartments) {
      const error =
        (targetCounts[compartment.id] - assignment.counts[compartment.id]) /
        cells.length;
      biases[compartment.id] += learningRate * error;
    }
    const meanBias =
      Object.values(biases).reduce((sum, value) => sum + value, 0) /
      compartments.length;
    for (const compartment of compartments) {
      biases[compartment.id] -= meanBias;
    }
  }
  return {
    biases,
    ...assignCells(cells, compartments, biases, forcedOwners),
  };
}

function appendProvenance(source, event) {
  const provenance = structuredClone(source.provenance || {
    schema: 'kaminos.constructional-packing-provenance.v0',
    events: [],
  });
  provenance.events.push(event);
  return provenance;
}

export function createSyntheticHipCrossSection() {
  return {
    schema: CONSTRUCTIONAL_PACKING_SOURCE_SCHEMA,
    id: 'synthetic-fitted-hip-cross-section-v0',
    authority: {
      kind: 'synthetic-proxy',
      anatomicalAdmission: 'none',
    },
    dimension: 2,
    grid: {
      width: 112,
      height: 84,
      bounds: {
        minX: -1.62,
        maxX: 1.62,
        minY: -1.14,
        maxY: 1.14,
      },
    },
    envelope: {
      center: [0, 0],
      radii: [1.46, 0.96],
      radialOffsets: Array(64).fill(0),
    },
    obstacles: [
      {
        id: 'hip-joint-clearance',
        kind: 'circle',
        center: [-0.26, -0.04],
        radius: 0.21,
        authority: 'synthetic-proxy',
      },
    ],
    compartments: [
      {
        id: 'dorsal-extensor',
        label: 'dorsal extensor compartment',
        targetShare: 0.34,
        anchors: [[-0.52, 0.46]],
        centerline: [
          [-1.08, 0.38],
          [-0.42, 0.5],
          [0.42, 0.48],
        ],
        fieldScale: [0.86, 0.26],
        authority: 'synthetic-proxy',
      },
      {
        id: 'posterior-power',
        label: 'posterior power compartment',
        targetShare: 0.25,
        anchors: [[0.67, 0.2]],
        centerline: [
          [0.18, 0.27],
          [0.72, 0.22],
          [1.18, 0.08],
        ],
        fieldScale: [0.62, 0.31],
        authority: 'synthetic-proxy',
      },
      {
        id: 'ventral-flexor',
        label: 'ventral flexor compartment',
        targetShare: 0.25,
        anchors: [[-0.16, -0.49]],
        centerline: [
          [-0.96, -0.46],
          [-0.18, -0.5],
          [0.66, -0.42],
        ],
        fieldScale: [0.92, 0.25],
        authority: 'synthetic-proxy',
      },
      {
        id: 'connective-envelope',
        label: 'passive connective envelope',
        targetShare: 0.16,
        anchors: [[0.93, -0.14]],
        centerline: [
          [-1.12, -0.05],
          [0, 0.02],
          [1.24, -0.1],
        ],
        fieldScale: [1.36, 0.7],
        authority: 'synthetic-proxy',
      },
    ],
    provenance: {
      schema: 'kaminos.constructional-packing-provenance.v0',
      events: [
        {
          id: 'synthetic-source',
          phase: 'source',
          authority: 'synthetic-proxy',
        },
      ],
    },
  };
}

export function solveConstructionalPacking(source) {
  validateSource(source);
  const active = enumerateActiveCells(source);
  if (active.cells.length === 0) {
    throw new Error('constructional source produced no active packing cells');
  }
  const forcedOwners = anchorCellOwners(active.cells, source.compartments);
  const packed = fitCompartmentBiases(
    active.cells,
    source.compartments,
    forcedOwners,
  );
  const compartmentById = new Map(
    source.compartments.map(compartment => [compartment.id, compartment]),
  );
  const cells = packed.assignments.map(({ cell, ownerId }) => {
    const compartment = compartmentById.get(ownerId);
    return {
      ix: cell.ix,
      iy: cell.iy,
      x: cell.x,
      y: cell.y,
      ownerId,
      material: materialCoordinate(cell.point, compartment),
    };
  });
  const compartments = {};
  let maxTargetShareError = 0;
  for (const compartment of source.compartments) {
    const cellCount = packed.counts[compartment.id];
    const actualShare = cellCount / cells.length;
    const targetShareError = Math.abs(actualShare - compartment.targetShare);
    maxTargetShareError = Math.max(maxTargetShareError, targetShareError);
    compartments[compartment.id] = {
      targetShare: compartment.targetShare,
      actualShare: rounded(actualShare, 6),
      targetShareError: rounded(targetShareError, 6),
      targetCount: rounded(compartment.targetShare * cells.length, 3),
      cellCount,
      bias: rounded(packed.biases[compartment.id], 6),
    };
  }
  const cellOwnerByKey = new Map(
    cells.map(cell => [`${cell.ix}:${cell.iy}`, cell.ownerId]),
  );
  const anchorViolations = [];
  for (const [key, ownerId] of forcedOwners) {
    if (cellOwnerByKey.get(key) !== ownerId) {
      anchorViolations.push({
        cell: key,
        expectedOwnerId: ownerId,
        actualOwnerId: cellOwnerByKey.get(key) || null,
      });
    }
  }
  const obstacleOwnedCellCount = packed.assignments.filter(({ cell }) =>
    source.obstacles.some(obstacle => pointInsideObstacle(cell.point, obstacle)),
  ).length;
  return {
    schema: CONSTRUCTIONAL_PACKING_RESULT_SCHEMA,
    sourceId: source.id,
    sourceSchema: source.schema,
    sourceAuthority: source.authority.kind,
    dimension: source.dimension,
    grid: structuredClone(source.grid),
    envelope: structuredClone(source.envelope),
    obstacles: structuredClone(source.obstacles),
    compartments: structuredClone(source.compartments),
    cells,
    metrics: {
      activeCellCount: cells.length,
      excludedObstacleCellCount: active.obstacleCells.length,
      unownedCellCount: cells.filter(cell => !cell.ownerId).length,
      multiOwnedCellCount: 0,
      obstacleOwnedCellCount,
      anchorViolations,
      maxTargetShareError: rounded(maxTargetShareError, 6),
      compartments,
    },
    provenance: structuredClone(source.provenance),
  };
}

export function relaxEnvelopeFromTargets({
  source,
  packing,
  targetEdits,
  pressureGain = 1.35,
  angularWidth = 0.52,
}) {
  validateSource(source);
  if (packing?.sourceId !== source.id) {
    throw new Error('pressure relaxation requires packing from the same source id');
  }
  const next = structuredClone(source);
  const compartmentById = new Map(
    next.compartments.map(compartment => [compartment.id, compartment]),
  );
  const inferredEnvelopeResponse = [];
  for (const edit of targetEdits) {
    const compartment = compartmentById.get(edit.compartmentId);
    if (!compartment) {
      throw new Error(`unknown constructional compartment: ${edit.compartmentId}`);
    }
    compartment.targetShare = rounded(compartment.targetShare + edit.deltaShare);
    if (edit.deltaShare <= 0) continue;
    const anchor = compartment.anchors[0];
    const center = next.envelope.center;
    const angle = Math.atan2(anchor[1] - center[1], anchor[0] - center[0]);
    const amplitude = edit.deltaShare * pressureGain;
    for (let index = 0; index < next.envelope.radialOffsets.length; index += 1) {
      const sampleAngle = (index / next.envelope.radialOffsets.length) * TWO_PI;
      next.envelope.radialOffsets[index] = rounded(
        next.envelope.radialOffsets[index] +
          amplitude * gaussianAngularWeight(sampleAngle, angle, angularWidth),
      );
    }
    inferredEnvelopeResponse.push({
      sourceEditId: edit.id,
      compartmentId: edit.compartmentId,
      angle: rounded(angle, 6),
      amplitude: rounded(amplitude, 6),
      angularWidth,
      authority: 'solver-inferred',
    });
  }
  const targetShareSum = next.compartments.reduce(
    (sum, compartment) => sum + compartment.targetShare,
    0,
  );
  if (Math.abs(targetShareSum - 1) > 1e-8) {
    throw new Error(
      `reciprocal target edits must preserve total share 1, got ${targetShareSum}`,
    );
  }
  const ledger = {
    schema: 'kaminos.constructional-pressure-ledger.v0',
    sourceId: source.id,
    packingSchema: packing.schema,
    edits: structuredClone(targetEdits),
    inferredEnvelopeResponse,
  };
  next.provenance = appendProvenance(source, {
    id: 'target-pressure-relaxation',
    phase: 'interior-to-envelope',
    authority: 'mixed',
    ledger,
  });
  return { source: next, ledger };
}

export function applyEnvelopeEdits({ source, edits }) {
  validateSource(source);
  const next = structuredClone(source);
  for (const edit of edits) {
    if (edit.kind !== 'radial-offset') {
      throw new Error(`unsupported constructional envelope edit kind: ${edit.kind}`);
    }
    for (let index = 0; index < next.envelope.radialOffsets.length; index += 1) {
      const sampleAngle = (index / next.envelope.radialOffsets.length) * TWO_PI;
      next.envelope.radialOffsets[index] = rounded(
        next.envelope.radialOffsets[index] +
          edit.amplitude *
            gaussianAngularWeight(sampleAngle, edit.angle, edit.angularWidth),
      );
    }
  }
  const ledger = {
    schema: 'kaminos.constructional-envelope-edit-ledger.v0',
    sourceId: source.id,
    edits: structuredClone(edits),
    inferredAction: 'repack-semantic-interior',
  };
  next.provenance = appendProvenance(source, {
    id: 'operator-envelope-edit',
    phase: 'envelope-to-interior',
    authority: 'operator-authored',
    ledger,
  });
  return { source: next, ledger };
}

export function sampleEnvelopeRadius(source, angle) {
  validateSource(source);
  if (!Number.isFinite(angle)) {
    throw new Error('constructional envelope sample angle must be finite');
  }
  return sampleEnvelopeRadiusUnchecked(source, angle);
}

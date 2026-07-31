import {
  createAnalyticalElbowDescriptor,
  solveAnalyticalElbowPose,
} from './analytical-elbow-core.mjs';

export const EXACT_ELBOW_PACKING_SOURCE_SCHEMA =
  'kaminos.exact-elbow-packing-source.v0';
export const EXACT_ELBOW_PACKING_RESULT_SCHEMA =
  'kaminos.exact-elbow-packing-result.v0';

const RESIDUAL_TISSUE_ID = 'residual-tissue';

function rounded(value, digits = 9) {
  return Number(value.toFixed(digits));
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function scale(vector, amount) {
  return vector.map(value => value * amount);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(vector) {
  return Math.hypot(...vector);
}

function distance(left, right) {
  return length(subtract(left, right));
}

function normalize(vector) {
  const magnitude = length(vector);
  if (magnitude <= 1e-12) {
    throw new Error('exact-elbow packing encountered a degenerate direction');
  }
  return scale(vector, 1 / magnitude);
}

function isFinitePoint(value) {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every(Number.isFinite);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function directionalGaussian(direction, centerDirection, angularWidth) {
  const angle = Math.acos(clamp(dot(direction, centerDirection), -1, 1));
  return Math.exp(-0.5 * (angle / angularWidth) ** 2);
}

function envelopeScaleAtDirection(domain, direction) {
  return (domain.surfaceLobes || []).reduce(
    (value, lobe) => value +
      lobe.amplitude * directionalGaussian(direction, lobe.direction, lobe.angularWidth),
    1,
  );
}

export function sampleExactElbowEnvelopeSurface(domain, direction) {
  if (!isFinitePoint(direction)) {
    throw new Error('exact-elbow envelope surface direction must be finite');
  }
  const unitDirection = normalize(direction);
  const radialScale = envelopeScaleAtDirection(domain, unitDirection);
  const point = domain.center.map(
    (value, index) => value + domain.radii[index] * unitDirection[index] * radialScale,
  );
  return {
    point: point.map(value => rounded(value, 9)),
    radialScale: rounded(radialScale, 9),
    distance: rounded(distance(point, domain.center), 9),
  };
}

function closestPointOnSegment(point, start, end) {
  const direction = subtract(end, start);
  const lengthSquared = dot(direction, direction);
  if (lengthSquared <= 1e-24) {
    return { point: [...start], t: 0, distance: distance(point, start) };
  }
  const t = Math.max(0, Math.min(1, dot(subtract(point, start), direction) / lengthSquared));
  const closest = add(start, scale(direction, t));
  return { point: closest, t, distance: distance(point, closest) };
}

function closestPointOnPath(point, path) {
  let closest = null;
  const segmentCount = path.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const candidate = closestPointOnSegment(point, start.position, end.position);
    if (!closest || candidate.distance < closest.distance) {
      const radius = start.radius * (1 - candidate.t) + end.radius * candidate.t;
      closest = {
        ...candidate,
        segmentIndex: index,
        pathT: (index + candidate.t) / segmentCount,
        radius,
        tangent: normalize(subtract(end.position, start.position)),
      };
    }
  }
  return closest;
}

function capsuleContains(point, start, end, radius) {
  return closestPointOnSegment(point, start, end).distance <= radius;
}

function pointInsideEnvelope(point, domain) {
  const normalized = point.map(
    (value, index) => (value - domain.center[index]) / domain.radii[index],
  );
  const radialDistance = length(normalized);
  if (radialDistance <= 1e-12) return true;
  return radialDistance <= envelopeScaleAtDirection(
    domain,
    scale(normalized, 1 / radialDistance),
  );
}

function createRigidStructures(pose) {
  const structures = [
    {
      id: pose.joint.id,
      kind: 'sphere',
      center: [...pose.joint.pivot],
      radius: pose.joint.protectedCoreRadius,
      sourceKind: 'joint-core',
    },
  ];
  for (const segment of pose.segments) {
    structures.push({
      id: `${segment.id}:bone`,
      kind: 'capsule',
      start: [...segment.bone.worldStart],
      end: [...segment.bone.worldEnd],
      radius: segment.bone.protectedCoreRadius,
      sourceKind: 'segment-bone',
      segmentId: segment.id,
    });
    for (const process of segment.processes) {
      structures.push({
        id: process.id,
        kind: 'capsule',
        start: [...process.worldStart],
        end: [...process.worldEnd],
        radius: process.radius,
        sourceKind: 'segment-process',
        segmentId: segment.id,
        attachmentId: process.attachmentId,
      });
    }
  }
  return structures;
}

function rigidOwner(point, structures, clearanceRadius = 0) {
  for (const structure of structures) {
    if (structure.kind === 'sphere') {
      if (distance(point, structure.center) <= structure.radius + clearanceRadius) return structure;
    } else if (capsuleContains(
      point,
      structure.start,
      structure.end,
      structure.radius + clearanceRadius,
    )) {
      return structure;
    }
  }
  return null;
}

function validateSource(source) {
  if (source?.schema !== EXACT_ELBOW_PACKING_SOURCE_SCHEMA) {
    throw new Error(`exact-elbow packing source schema mismatch: ${source?.schema || 'missing'}`);
  }
  if (source.dimension !== 3) {
    throw new Error(`exact-elbow packing expects dimension 3, got ${source.dimension}`);
  }
  if (typeof source.id !== 'string' || source.id.length === 0) {
    throw new Error('exact-elbow packing source id must be nonempty');
  }
  if (
    source.authority?.kind !== 'synthetic-proxy' ||
    source.authority?.anatomicalAdmission !== 'none'
  ) {
    throw new Error('exact-elbow packing source must retain synthetic-proxy authority with no anatomical admission');
  }
  if (!Number.isFinite(source.flexionDegrees)) {
    throw new Error('exact-elbow packing flexion must be finite');
  }
  if (
    !Number.isInteger(source.grid?.width) ||
    !Number.isInteger(source.grid?.height) ||
    !Number.isInteger(source.grid?.depth) ||
    source.grid.width <= 0 ||
    source.grid.height <= 0 ||
    source.grid.depth <= 0
  ) {
    throw new Error('exact-elbow packing grid dimensions must be positive integers');
  }
  const bounds = source.grid.bounds;
  if (
    !bounds ||
    ![
      bounds.minX, bounds.maxX,
      bounds.minY, bounds.maxY,
      bounds.minZ, bounds.maxZ,
    ].every(Number.isFinite) ||
    bounds.maxX <= bounds.minX ||
    bounds.maxY <= bounds.minY ||
    bounds.maxZ <= bounds.minZ
  ) {
    throw new Error('exact-elbow packing grid bounds must be finite and ordered');
  }
  if (
    !['ellipsoid', 'radial-ellipsoid'].includes(source.domain?.kind) ||
    typeof source.domain.id !== 'string' ||
    !isFinitePoint(source.domain.center) ||
    !isFinitePoint(source.domain.radii) ||
    !source.domain.radii.every(value => value > 0)
  ) {
    throw new Error('exact-elbow packing requires a finite positive ellipsoid domain');
  }
  if (source.domain.kind === 'radial-ellipsoid') {
    if (!Array.isArray(source.domain.surfaceLobes)) {
      throw new Error('exact-elbow radial ellipsoid requires surfaceLobes');
    }
    for (const lobe of source.domain.surfaceLobes) {
      if (
        typeof lobe.id !== 'string' ||
        !isFinitePoint(lobe.direction) ||
        Math.abs(length(lobe.direction) - 1) > 1e-6 ||
        !Number.isFinite(lobe.amplitude) ||
        lobe.amplitude < 0 ||
        !Number.isFinite(lobe.angularWidth) ||
        lobe.angularWidth <= 0
      ) {
        throw new Error('exact-elbow surface lobe must have normalized direction and finite positive shape');
      }
    }
  }
  if (
    source.grid.logicalIndexOffset !== undefined &&
    (
      !Array.isArray(source.grid.logicalIndexOffset) ||
      source.grid.logicalIndexOffset.length !== 3 ||
      !source.grid.logicalIndexOffset.every(Number.isInteger)
    )
  ) {
    throw new Error('exact-elbow logical grid offset must contain three integers');
  }
  if (!source.elbowDescriptor || !Array.isArray(source.elbowDescriptor.muscles)) {
    throw new Error('exact-elbow packing requires an analytical elbow descriptor');
  }
  const materialScales = source.materialScales || {};
  for (const muscle of source.elbowDescriptor.muscles) {
    if (!Number.isFinite(materialScales[muscle.id]) || materialScales[muscle.id] <= 0) {
      throw new Error(`exact-elbow packing requires a positive material scale for ${muscle.id}`);
    }
  }
}

function enumerateDomain(source, rigidStructures) {
  const { width, height, depth, bounds } = source.grid;
  const step = [
    (bounds.maxX - bounds.minX) / width,
    (bounds.maxY - bounds.minY) / height,
    (bounds.maxZ - bounds.minZ) / depth,
  ];
  const cellVolume = step[0] * step[1] * step[2];
  const cellBoundingRadius = Math.hypot(...step) / 2;
  const cells = [];
  const excluded = [];
  for (let iz = 0; iz < depth; iz += 1) {
    const z = bounds.minZ + (iz + 0.5) * step[2];
    for (let iy = 0; iy < height; iy += 1) {
      const y = bounds.minY + (iy + 0.5) * step[1];
      for (let ix = 0; ix < width; ix += 1) {
        const x = bounds.minX + (ix + 0.5) * step[0];
        const point = [x, y, z];
        if (!pointInsideEnvelope(point, source.domain)) continue;
        // A center is admitted only when the circumscribed sphere of its voxel
        // clears every rigid primitive. This conservatively excludes the full
        // finite cell, including its corners.
        const rigid = rigidOwner(point, rigidStructures, cellBoundingRadius);
        const logicalOffset = source.grid.logicalIndexOffset || [0, 0, 0];
        const logicalIndex = [
          ix - logicalOffset[0],
          iy - logicalOffset[1],
          iz - logicalOffset[2],
        ];
        const sourceCellId = `${source.domain.id}:${logicalIndex[0]}:${logicalIndex[1]}:${logicalIndex[2]}`;
        if (rigid) {
          excluded.push({ ix, iy, iz, sourceCellId, rigidId: rigid.id });
          continue;
        }
        cells.push({ ix, iy, iz, point, sourceCellId });
      }
    }
  }
  return { cells, excluded, step, cellVolume, cellBoundingRadius };
}

function attachmentList(pose) {
  return pose.segments.flatMap(segment => segment.attachments.map(attachment => ({
    id: attachment.id,
    segmentId: segment.id,
    worldPosition: [...attachment.worldPosition],
  })));
}

function forceAttachmentOwners(cells, pose) {
  const ownerByCell = new Map();
  const muscleByAttachment = new Map();
  for (const muscle of pose.muscles) {
    muscleByAttachment.set(muscle.originAttachmentId, muscle.id);
    muscleByAttachment.set(muscle.insertionAttachmentId, muscle.id);
  }
  for (const attachment of attachmentList(pose)) {
    const muscleId = muscleByAttachment.get(attachment.id);
    if (!muscleId) continue;
    const candidates = cells
      .map(cell => ({ cell, distance: distance(cell.point, attachment.worldPosition) }))
      .sort((left, right) =>
        left.distance - right.distance ||
        left.cell.sourceCellId.localeCompare(right.cell.sourceCellId),
      );
    const selected = candidates.find(candidate => {
      const owner = ownerByCell.get(candidate.cell.sourceCellId);
      return !owner || owner === muscleId;
    });
    if (!selected) {
      throw new Error(`exact-elbow packing could not anchor ${attachment.id}`);
    }
    ownerByCell.set(selected.cell.sourceCellId, muscleId);
  }
  return ownerByCell;
}

function radialFrame(tangent) {
  const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const normal = normalize(cross(tangent, reference));
  return { normal, binormal: normalize(cross(tangent, normal)) };
}

function muscleMaterial(point, nearest, materialScale) {
  const { normal, binormal } = radialFrame(nearest.tangent);
  const offset = subtract(point, nearest.point);
  return [
    rounded(nearest.pathT, 6),
    rounded(dot(offset, normal) / materialScale, 6),
    rounded(dot(offset, binormal) / materialScale, 6),
  ];
}

function residualMaterial(point, domain) {
  return point.map(
    (value, index) => rounded((value - domain.center[index]) / domain.radii[index], 6),
  );
}

function normalizedMixture(distanceByMuscle, muscles) {
  const entries = muscles.map(muscle => {
    const nearest = distanceByMuscle[muscle.id];
    const scaleValue = Math.max(nearest.radius * 1.75, 0.08);
    return [muscle.id, Math.exp(-0.5 * (nearest.distance / scaleValue) ** 2)];
  });
  entries.push([RESIDUAL_TISSUE_ID, 0.28]);
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  return Object.fromEntries(entries.map(([id, value]) => [id, rounded(value / total, 6)]));
}

function assignCells({ source, pose, active }) {
  const muscles = pose.muscles;
  const forcedOwners = forceAttachmentOwners(active.cells, pose);
  const targetCounts = {};
  let requestedMuscleCells = 0;
  for (const muscle of muscles) {
    const targetCount = Math.round(muscle.metrics.targetVolume / active.cellVolume);
    targetCounts[muscle.id] = targetCount;
    requestedMuscleCells += targetCount;
  }
  if (requestedMuscleCells >= active.cells.length) {
    throw new Error(
      `exact-elbow muscle targets exceed available soft-tissue volume: ${requestedMuscleCells} cells for ${active.cells.length}`,
    );
  }
  const distanceCache = new Map();
  const candidates = [];
  for (const cell of active.cells) {
    const distances = {};
    for (const muscle of muscles) {
      const nearest = closestPointOnPath(cell.point, muscle.path);
      distances[muscle.id] = nearest;
      candidates.push({
        sourceCellId: cell.sourceCellId,
        muscleId: muscle.id,
        score: nearest.distance / Math.max(nearest.radius, 0.04),
      });
    }
    distanceCache.set(cell.sourceCellId, distances);
  }
  candidates.sort((left, right) =>
    left.score - right.score ||
    left.muscleId.localeCompare(right.muscleId) ||
    left.sourceCellId.localeCompare(right.sourceCellId),
  );
  const owners = new Map(forcedOwners);
  const counts = Object.fromEntries(muscles.map(muscle => [muscle.id, 0]));
  for (const ownerId of forcedOwners.values()) counts[ownerId] += 1;
  for (const candidate of candidates) {
    if (owners.has(candidate.sourceCellId)) continue;
    if (counts[candidate.muscleId] >= targetCounts[candidate.muscleId]) continue;
    owners.set(candidate.sourceCellId, candidate.muscleId);
    counts[candidate.muscleId] += 1;
  }
  for (const muscle of muscles) {
    if (counts[muscle.id] !== targetCounts[muscle.id]) {
      throw new Error(`exact-elbow packing could not satisfy target volume for ${muscle.id}`);
    }
  }
  counts[RESIDUAL_TISSUE_ID] = active.cells.length - requestedMuscleCells;
  const muscleById = new Map(muscles.map(muscle => [muscle.id, muscle]));
  const cells = active.cells.map(cell => {
    const ownerId = owners.get(cell.sourceCellId) || RESIDUAL_TISSUE_ID;
    const distanceByMuscle = distanceCache.get(cell.sourceCellId);
    const material = ownerId === RESIDUAL_TISSUE_ID
      ? residualMaterial(cell.point, source.domain)
      : muscleMaterial(
        cell.point,
        distanceByMuscle[ownerId],
        source.materialScales[ownerId],
      );
    return {
      ix: cell.ix,
      iy: cell.iy,
      iz: cell.iz,
      x: rounded(cell.point[0], 6),
      y: rounded(cell.point[1], 6),
      z: rounded(cell.point[2], 6),
      sourceCellId: cell.sourceCellId,
      ownerId,
      material,
      mixture: normalizedMixture(distanceByMuscle, muscles),
      locality: Object.fromEntries(muscles.map(muscle => [
        muscle.id,
        rounded(distanceByMuscle[muscle.id].distance / source.materialScales[muscle.id], 6),
      ])),
    };
  });
  return { cells, counts, targetCounts, forcedOwners, muscleById };
}

export function createExactElbowPackingSource() {
  const elbowDescriptor = createAnalyticalElbowDescriptor();
  const flexionDegrees = 35;
  const baselinePose = solveAnalyticalElbowPose(elbowDescriptor, {
    flexionDegrees,
    pathSampleCount: 25,
    radialSegmentCount: 8,
  });
  const materialScales = Object.fromEntries(
    baselinePose.muscles.map(muscle => [muscle.id, rounded(muscle.metrics.maximumRadius, 6)]),
  );
  const domain = {
    id: `${elbowDescriptor.id}:shared-material-domain:35deg`,
    kind: 'ellipsoid',
    center: [0, 0.3, 0],
    radii: [0.78, 1.18, 0.52],
    authority: 'synthetic-proxy',
    anatomicalAdmission: 'none',
  };
  return {
    schema: EXACT_ELBOW_PACKING_SOURCE_SCHEMA,
    id: 'synthetic-exact-elbow-shared-material-v0',
    authority: {
      kind: 'synthetic-proxy',
      anatomicalAdmission: 'none',
    },
    dimension: 3,
    flexionDegrees,
    elbowDescriptor,
    materialScales,
    domain,
    grid: {
      width: 36,
      height: 54,
      depth: 28,
      bounds: {
        minX: domain.center[0] - domain.radii[0],
        maxX: domain.center[0] + domain.radii[0],
        minY: domain.center[1] - domain.radii[1],
        maxY: domain.center[1] + domain.radii[1],
        minZ: domain.center[2] - domain.radii[2],
        maxZ: domain.center[2] + domain.radii[2],
      },
    },
    provenance: {
      schema: 'kaminos.exact-elbow-packing-provenance.v0',
      events: [{
        id: 'derive-from-analytical-elbow',
        authority: 'solver-derived',
        sourceId: elbowDescriptor.id,
        flexionDegrees,
      }],
    },
  };
}

export function prepareExactElbowEnvelopeCouplingSource({
  source,
  paddingCells = [6, 6, 5],
}) {
  validateSource(source);
  if (
    !Array.isArray(paddingCells) ||
    paddingCells.length !== 3 ||
    !paddingCells.every(value => Number.isInteger(value) && value > 0)
  ) {
    throw new Error('exact-elbow envelope coupling padding must contain three positive integers');
  }
  const next = structuredClone(source);
  const { width, height, depth, bounds } = source.grid;
  const dimensions = [width, height, depth];
  const minimums = [bounds.minX, bounds.minY, bounds.minZ];
  const maximums = [bounds.maxX, bounds.maxY, bounds.maxZ];
  const step = dimensions.map((dimension, index) =>
    (maximums[index] - minimums[index]) / dimension,
  );
  const paddedMinimums = minimums.map(
    (value, index) => value - paddingCells[index] * step[index],
  );
  const paddedMaximums = maximums.map(
    (value, index) => value + paddingCells[index] * step[index],
  );
  next.domain.kind = 'radial-ellipsoid';
  next.domain.surfaceLobes = [];
  next.grid = {
    width: width + 2 * paddingCells[0],
    height: height + 2 * paddingCells[1],
    depth: depth + 2 * paddingCells[2],
    logicalIndexOffset: [...paddingCells],
    bounds: {
      minX: paddedMinimums[0],
      maxX: paddedMaximums[0],
      minY: paddedMinimums[1],
      maxY: paddedMaximums[1],
      minZ: paddedMinimums[2],
      maxZ: paddedMaximums[2],
    },
  };
  next.provenance.events.push({
    id: 'prepare-envelope-coupling-grid',
    authority: 'solver-derived',
    paddingCells: [...paddingCells],
    preservedStep: step.map(value => rounded(value, 12)),
    preservedLogicalLattice: true,
  });
  return next;
}

export function applyExactElbowMuscleVolumeEdit({ source, edit }) {
  validateSource(source);
  if (
    typeof edit?.id !== 'string' ||
    edit.id.length === 0 ||
    !Number.isFinite(edit.scale) ||
    edit.scale <= 0
  ) {
    throw new Error('exact-elbow muscle volume edit requires an id and positive finite scale');
  }
  const next = structuredClone(source);
  const muscle = next.elbowDescriptor.muscles.find(candidate => candidate.id === edit.muscleId);
  if (!muscle) {
    throw new Error(`unknown exact-elbow muscle: ${edit.muscleId}`);
  }
  const priorTargetVolume = muscle.targetVolume;
  muscle.targetVolume = rounded(priorTargetVolume * edit.scale, 9);
  next.parentSourceId = source.id;
  next.provenance.events.push({
    id: edit.id,
    authority: 'operator-requested-assay-edit',
    muscleId: muscle.id,
    priorTargetVolume,
    nextTargetVolume: muscle.targetVolume,
    scale: edit.scale,
  });
  return next;
}

export function solveExactElbowPacking(source) {
  validateSource(source);
  const pose = solveAnalyticalElbowPose(source.elbowDescriptor, {
    flexionDegrees: source.flexionDegrees,
    pathSampleCount: 25,
    radialSegmentCount: 8,
  });
  const rigidStructures = createRigidStructures(pose);
  const active = enumerateDomain(source, rigidStructures);
  if (active.cells.length === 0) {
    throw new Error('exact-elbow packing domain produced no soft-tissue cells');
  }
  const assignment = assignCells({ source, pose, active });
  const compartments = {};
  for (const muscle of pose.muscles) {
    const cellCount = assignment.counts[muscle.id];
    const realizedVolume = cellCount * active.cellVolume;
    compartments[muscle.id] = {
      role: muscle.role,
      targetVolume: muscle.metrics.targetVolume,
      realizedVolume: rounded(realizedVolume, 9),
      targetVolumeError: rounded(Math.abs(realizedVolume - muscle.metrics.targetVolume), 12),
      cellCount,
      originAttachmentId: muscle.originAttachmentId,
      insertionAttachmentId: muscle.insertionAttachmentId,
    };
  }
  const residualCellCount = assignment.counts[RESIDUAL_TISSUE_ID];
  const residualVolume = residualCellCount * active.cellVolume;
  compartments[RESIDUAL_TISSUE_ID] = {
    role: 'passive-residual-tissue',
    targetVolume: rounded(residualVolume, 9),
    realizedVolume: rounded(residualVolume, 9),
    targetVolumeError: 0,
    cellCount: residualCellCount,
  };
  const sourceCellIds = new Set(assignment.cells.map(cell => cell.sourceCellId));
  return {
    schema: EXACT_ELBOW_PACKING_RESULT_SCHEMA,
    sourceId: source.id,
    parentSourceId: source.parentSourceId || null,
    sourceSchema: source.schema,
    sourceAuthority: structuredClone(source.authority),
    dimension: 3,
    flexionDegrees: source.flexionDegrees,
    domain: structuredClone(source.domain),
    grid: {
      ...structuredClone(source.grid),
      step: active.step.map(value => rounded(value, 9)),
      cellVolume: rounded(active.cellVolume, 12),
      cellBoundingRadius: rounded(active.cellBoundingRadius, 12),
    },
    elbow: {
      sourceId: pose.sourceId,
      sourceSchema: pose.sourceSchema,
      attachments: attachmentList(pose),
      rigidStructures,
      muscles: pose.muscles.map(muscle => ({
        id: muscle.id,
        role: muscle.role,
        originAttachmentId: muscle.originAttachmentId,
        insertionAttachmentId: muscle.insertionAttachmentId,
        path: structuredClone(muscle.path),
      })),
    },
    compartments,
    cells: assignment.cells,
    excludedRigidCells: active.excluded,
    provenance: structuredClone(source.provenance),
    metrics: {
      activeCellCount: assignment.cells.length,
      excludedRigidCellCount: active.excluded.length,
      unownedCellCount: assignment.cells.filter(cell => !cell.ownerId).length,
      multiOwnedCellCount: 0,
      rigidOwnedCellCount: assignment.cells.filter(cell =>
        rigidOwner([cell.x, cell.y, cell.z], rigidStructures, active.cellBoundingRadius),
      ).length,
      finiteRigidOverlapCellCount: assignment.cells.filter(cell =>
        rigidOwner([cell.x, cell.y, cell.z], rigidStructures, active.cellBoundingRadius),
      ).length,
      anchorViolationCount: [...assignment.forcedOwners].filter(([cellId, ownerId]) => {
        const cell = assignment.cells.find(candidate => candidate.sourceCellId === cellId);
        return cell?.ownerId !== ownerId;
      }).length,
      duplicateSourceCellCount: assignment.cells.length - sourceCellIds.size,
    },
  };
}

function changedCellsForMuscle({ baseline, edited, muscleId }) {
  const baselineById = new Map(baseline.cells.map(cell => [cell.sourceCellId, cell]));
  return edited.cells.filter(cell => {
    const prior = baselineById.get(cell.sourceCellId);
    return prior && prior.ownerId !== muscleId && cell.ownerId === muscleId;
  });
}

function normalizedEnvelopeDirection(point, domain) {
  const normalized = point.map(
    (value, index) => (value - domain.center[index]) / domain.radii[index],
  );
  return normalize(normalized);
}

function domainWithPressureLobe(source, { direction, amplitude, angularWidth, muscleId }) {
  const next = structuredClone(source);
  next.domain.surfaceLobes = [{
    id: `${muscleId}:pressure-lobe`,
    muscleId,
    direction: direction.map(value => rounded(value, 12)),
    amplitude: rounded(amplitude, 12),
    angularWidth: rounded(angularWidth, 12),
    authority: 'solver-inferred-volume-coupling',
  }];
  return next;
}

function maximumCenteredLobeAmplitude(source, direction) {
  const surface = sampleExactElbowEnvelopeSurface(source.domain, direction).point;
  const bounds = source.grid.bounds;
  const minimums = [bounds.minX, bounds.minY, bounds.minZ];
  const maximums = [bounds.maxX, bounds.maxY, bounds.maxZ];
  let maximum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 3; index += 1) {
    const slope = source.domain.radii[index] * direction[index];
    if (Math.abs(slope) <= 1e-12) continue;
    const margin = slope > 0
      ? maximums[index] - surface[index]
      : surface[index] - minimums[index];
    maximum = Math.min(maximum, margin / Math.abs(slope));
  }
  if (!Number.isFinite(maximum) || maximum <= 0) {
    throw new Error('exact-elbow coupling grid provides no envelope expansion margin');
  }
  return maximum * 0.9;
}

export function coupleExactElbowEnvelopeFromMuscleEdit({
  source,
  baseline,
  fixedEnvelopeSource,
  fixedEnvelopeEdited,
  muscleId,
  angularWidth = 0.34,
}) {
  validateSource(source);
  validateSource(fixedEnvelopeSource);
  if (
    source.domain.kind !== 'radial-ellipsoid' ||
    source.domain.surfaceLobes.length !== 0 ||
    baseline?.sourceId !== source.id ||
    fixedEnvelopeEdited?.sourceId !== source.id ||
    fixedEnvelopeSource.id !== source.id ||
    !sameJson(baseline.grid, fixedEnvelopeEdited.grid) ||
    !sameJson(baseline.domain, source.domain) ||
    !sameJson(fixedEnvelopeEdited.domain, source.domain)
  ) {
    throw new Error('exact-elbow envelope coupling requires baseline and edit from the same prepared source');
  }
  if (!Number.isFinite(angularWidth) || angularWidth <= 0) {
    throw new Error('exact-elbow envelope coupling angular width must be positive and finite');
  }
  const baselineCompartment = baseline.compartments[muscleId];
  const editedCompartment = fixedEnvelopeEdited.compartments[muscleId];
  if (!baselineCompartment || !editedCompartment) {
    throw new Error(`unknown exact-elbow coupling muscle: ${muscleId}`);
  }
  const muscleCellDeficit = editedCompartment.cellCount - baselineCompartment.cellCount;
  if (muscleCellDeficit <= 0) {
    throw new Error('exact-elbow envelope coupling requires positive muscle growth');
  }
  const pressureCells = changedCellsForMuscle({
    baseline,
    edited: fixedEnvelopeEdited,
    muscleId,
  });
  if (pressureCells.length === 0) {
    throw new Error('exact-elbow envelope coupling found no changed muscle cells');
  }
  const normalizedCentroid = [0, 1, 2].map(index =>
    pressureCells.reduce(
      (sum, cell) => sum +
        ([cell.x, cell.y, cell.z][index] - source.domain.center[index]) /
          source.domain.radii[index],
      0,
    ) / pressureCells.length,
  );
  const pressureDirection = normalize(normalizedCentroid);
  const rigidStructures = baseline.elbow.rigidStructures;
  const targetActiveCellCount = baseline.metrics.activeCellCount + muscleCellDeficit;
  const maximumAmplitude = maximumCenteredLobeAmplitude(source, pressureDirection);
  const observations = [];
  const observe = amplitude => {
    const candidate = domainWithPressureLobe(source, {
      direction: pressureDirection,
      amplitude,
      angularWidth,
      muscleId,
    });
    const activeCellCount = enumerateDomain(candidate, rigidStructures).cells.length;
    const observation = {
      amplitude,
      activeCellCount,
      error: Math.abs(activeCellCount - targetActiveCellCount),
    };
    observations.push(observation);
    return observation;
  };
  let low = 0;
  let high = Math.min(0.01, maximumAmplitude);
  let highObservation = observe(high);
  while (highObservation.activeCellCount < targetActiveCellCount && high < maximumAmplitude) {
    low = high;
    high = Math.min(high * 2, maximumAmplitude);
    highObservation = observe(high);
  }
  if (highObservation.activeCellCount < targetActiveCellCount) {
    throw new Error('exact-elbow coupling padding cannot admit the requested muscle volume');
  }
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    const observation = observe(middle);
    if (observation.activeCellCount < targetActiveCellCount) low = middle;
    else high = middle;
  }
  observations.push({
    amplitude: 0,
    activeCellCount: baseline.metrics.activeCellCount,
    error: muscleCellDeficit,
  });
  observations.sort((left, right) =>
    left.error - right.error ||
    left.amplitude - right.amplitude,
  );
  const selected = observations[0];
  const next = domainWithPressureLobe(fixedEnvelopeSource, {
    direction: pressureDirection,
    amplitude: selected.amplitude,
    angularWidth,
    muscleId,
  });
  const ledger = {
    schema: 'kaminos.exact-elbow-envelope-pressure-ledger.v0',
    sourceId: source.id,
    muscleId,
    residualPolicy: 'preserve-baseline-volume',
    baselineActiveCellCount: baseline.metrics.activeCellCount,
    targetActiveCellCount,
    predictedActiveCellCount: selected.activeCellCount,
    muscleCellDeficit,
    pressureCellCount: pressureCells.length,
    pressureDirection: pressureDirection.map(value => rounded(value, 12)),
    angularWidth: rounded(angularWidth, 12),
    surfaceAmplitude: rounded(selected.amplitude, 12),
    authority: 'solver-inferred-volume-coupling',
  };
  next.provenance.events.push({
    id: 'couple-muscle-pressure-to-envelope',
    authority: 'solver-inferred-volume-coupling',
    ledger: structuredClone(ledger),
  });
  return { source: next, ledger };
}

export function compareExactElbowEnvelopeCoupling({
  baseline,
  fixedEnvelopeEdited,
  coupled,
  ledger,
}) {
  if (
    baseline?.schema !== EXACT_ELBOW_PACKING_RESULT_SCHEMA ||
    fixedEnvelopeEdited?.schema !== EXACT_ELBOW_PACKING_RESULT_SCHEMA ||
    coupled?.schema !== EXACT_ELBOW_PACKING_RESULT_SCHEMA ||
    ledger?.schema !== 'kaminos.exact-elbow-envelope-pressure-ledger.v0'
  ) {
    throw new Error('exact-elbow envelope comparison requires baseline, fixed edit, coupled result, and ledger');
  }
  const baselineById = new Map(baseline.cells.map(cell => [cell.sourceCellId, cell]));
  const coupledById = new Map(coupled.cells.map(cell => [cell.sourceCellId, cell]));
  const addedCells = coupled.cells.filter(cell => !baselineById.has(cell.sourceCellId));
  const lostSourceCellCount = baseline.cells.filter(
    cell => !coupledById.has(cell.sourceCellId),
  ).length;
  let sharedUnchangedMaterialIdentityViolationCount = 0;
  let unexpectedSharedOwnerTransitionCount = 0;
  for (const [cellId, baselineCell] of baselineById) {
    const nextCell = coupledById.get(cellId);
    if (!nextCell) continue;
    if (baselineCell.ownerId === nextCell.ownerId) {
      if (!sameJson(baselineCell.material, nextCell.material)) {
        sharedUnchangedMaterialIdentityViolationCount += 1;
      }
    } else if (
      !(
        baselineCell.ownerId === RESIDUAL_TISSUE_ID &&
        nextCell.ownerId === ledger.muscleId
      )
    ) {
      unexpectedSharedOwnerTransitionCount += 1;
    }
  }
  const localAddedCellCount = addedCells.filter(cell => {
    const direction = normalizedEnvelopeDirection(
      [cell.x, cell.y, cell.z],
      baseline.domain,
    );
    const angle = Math.acos(clamp(dot(direction, ledger.pressureDirection), -1, 1));
    return angle <= ledger.angularWidth * 3;
  }).length;
  const oppositeDirection = ledger.pressureDirection.map(value => -value);
  const baselineLocal = sampleExactElbowEnvelopeSurface(
    baseline.domain,
    ledger.pressureDirection,
  );
  const coupledLocal = sampleExactElbowEnvelopeSurface(
    coupled.domain,
    ledger.pressureDirection,
  );
  const baselineRemote = sampleExactElbowEnvelopeSurface(
    baseline.domain,
    oppositeDirection,
  );
  const coupledRemote = sampleExactElbowEnvelopeSurface(
    coupled.domain,
    oppositeDirection,
  );
  const compartmentDelta = id =>
    coupled.compartments[id].cellCount - baseline.compartments[id].cellCount;
  const addedActiveCellCount =
    coupled.metrics.activeCellCount - baseline.metrics.activeCellCount;
  return {
    muscleCellDeficit: ledger.muscleCellDeficit,
    addedActiveCellCount,
    addedSourceCellCount: addedCells.length,
    lostSourceCellCount,
    brachialisCellDelta: compartmentDelta('brachialis-like-flexor'),
    tricepsCellDelta: compartmentDelta('monoarticular-triceps-like-extensor'),
    residualCellDelta: compartmentDelta(RESIDUAL_TISSUE_ID),
    rigidIdentityViolationCount:
      sameJson(baseline.elbow.rigidStructures, coupled.elbow.rigidStructures) ? 0 : 1,
    attachmentIdentityViolationCount:
      sameJson(baseline.elbow.attachments, coupled.elbow.attachments) ? 0 : 1,
    gridIdentityViolationCount: sameJson(baseline.grid, coupled.grid) ? 0 : 1,
    sharedUnchangedMaterialIdentityViolationCount,
    unexpectedSharedOwnerTransitionCount,
    localAddedCellCount,
    localAddedCellFraction: addedCells.length === 0
      ? 0
      : rounded(localAddedCellCount / addedCells.length, 6),
    localSurfaceDisplacement: rounded(coupledLocal.distance - baselineLocal.distance, 9),
    remoteSurfaceDisplacement: rounded(coupledRemote.distance - baselineRemote.distance, 9),
    displacedVolume: rounded(addedActiveCellCount * baseline.grid.cellVolume, 12),
    requestedMuscleVolume: rounded(ledger.muscleCellDeficit * baseline.grid.cellVolume, 12),
    displacedVolumeError: rounded(
      Math.abs((addedActiveCellCount - ledger.muscleCellDeficit) * baseline.grid.cellVolume),
      12,
    ),
    fixedEnvelopeResidualCellDelta:
      fixedEnvelopeEdited.compartments[RESIDUAL_TISSUE_ID].cellCount -
        baseline.compartments[RESIDUAL_TISSUE_ID].cellCount,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compareExactElbowPackings({ baseline, edited }) {
  if (
    baseline?.schema !== EXACT_ELBOW_PACKING_RESULT_SCHEMA ||
    edited?.schema !== EXACT_ELBOW_PACKING_RESULT_SCHEMA
  ) {
    throw new Error('exact-elbow packing comparison requires two packing results');
  }
  if (baseline.sourceId !== edited.sourceId || !sameJson(baseline.domain, edited.domain)) {
    throw new Error('exact-elbow packing comparison requires the same source domain');
  }
  const baselineById = new Map(baseline.cells.map(cell => [cell.sourceCellId, cell]));
  const editedById = new Map(edited.cells.map(cell => [cell.sourceCellId, cell]));
  let changedOwnerCellCount = 0;
  let localChangedOwnerCellCount = 0;
  let unchangedMaterialIdentityViolationCount = 0;
  const ownerTransitionCounts = {};
  for (const [cellId, baselineCell] of baselineById) {
    const editedCell = editedById.get(cellId);
    if (!editedCell) continue;
    if (baselineCell.ownerId !== editedCell.ownerId) {
      changedOwnerCellCount += 1;
      const transition = `${baselineCell.ownerId}->${editedCell.ownerId}`;
      ownerTransitionCounts[transition] = (ownerTransitionCounts[transition] || 0) + 1;
      if (
        Math.min(
          baselineCell.locality['brachialis-like-flexor'],
          editedCell.locality['brachialis-like-flexor'],
        ) <= 2.25
      ) {
        localChangedOwnerCellCount += 1;
      }
    } else if (!sameJson(baselineCell.material, editedCell.material)) {
      unchangedMaterialIdentityViolationCount += 1;
    }
  }
  const compartmentDelta = id =>
    edited.compartments[id].cellCount - baseline.compartments[id].cellCount;
  const editEvent = [...(edited.provenance?.events || [])]
    .reverse()
    .find(event => typeof event.muscleId === 'string');
  const editedMuscleId = editEvent?.muscleId || null;
  const editedMuscleDelta = editedMuscleId && edited.compartments[editedMuscleId]
    ? compartmentDelta(editedMuscleId)
    : 0;
  const expectedTransition = editedMuscleId
    ? editedMuscleDelta >= 0
      ? `${RESIDUAL_TISSUE_ID}->${editedMuscleId}`
      : `${editedMuscleId}->${RESIDUAL_TISSUE_ID}`
    : null;
  const unexpectedOwnerTransitionCount = Object.entries(ownerTransitionCounts)
    .filter(([transition]) => transition !== expectedTransition)
    .reduce((sum, [, count]) => sum + count, 0);
  return {
    changedOwnerCellCount,
    ownerTransitionCounts,
    editedMuscleId,
    unexpectedOwnerTransitionCount,
    localChangedOwnerCellCount,
    localChangeFraction: changedOwnerCellCount === 0
      ? 0
      : rounded(localChangedOwnerCellCount / changedOwnerCellCount, 6),
    lostSourceCellCount: [...baselineById.keys()].filter(id => !editedById.has(id)).length,
    addedSourceCellCount: [...editedById.keys()].filter(id => !baselineById.has(id)).length,
    unchangedMaterialIdentityViolationCount,
    attachmentIdentityViolationCount:
      sameJson(baseline.elbow.attachments, edited.elbow.attachments) ? 0 : 1,
    rigidIdentityViolationCount:
      sameJson(baseline.elbow.rigidStructures, edited.elbow.rigidStructures) ? 0 : 1,
    gridIdentityViolationCount: sameJson(baseline.grid, edited.grid) ? 0 : 1,
    brachialisCellDelta: compartmentDelta('brachialis-like-flexor'),
    tricepsCellDelta: compartmentDelta('monoarticular-triceps-like-extensor'),
    residualCellDelta: compartmentDelta(RESIDUAL_TISSUE_ID),
  };
}

export const REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY = 'real-field-hierarchical-smoke-splat-producer-v0';
export const KAMINOS_FLUID_CHANNEL_ORDER = Object.freeze([
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier',
  'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront',
  'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
]);

const CHANNEL = Object.freeze(Object.fromEntries(KAMINOS_FLUID_CHANNEL_ORDER.map((name, index) => [name, index])));

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function positive(value, label) {
  const number = finite(value, label);
  if (number <= 0) throw new RangeError(`${label} must be positive`);
  return number;
}

function nonNegative(value, label) {
  const number = finite(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function identity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function integerBlockSize(value, grid, label) {
  const size = Math.floor(positive(value, label));
  if (size !== Number(value) || grid % size !== 0) {
    throw new RangeError(`${label} must be an integer divisor of grid ${grid}`);
  }
  return size;
}

function assertChannelOrder(channelOrder) {
  if (!Array.isArray(channelOrder) || channelOrder.length !== KAMINOS_FLUID_CHANNEL_ORDER.length) {
    throw new TypeError('fluid channel order must contain the exact 16-channel contract');
  }
  for (let index = 0; index < KAMINOS_FLUID_CHANNEL_ORDER.length; index += 1) {
    if (channelOrder[index] !== KAMINOS_FLUID_CHANNEL_ORDER[index]) {
      throw new Error(`fluid channel order mismatch at ${index}: expected ${KAMINOS_FLUID_CHANNEL_ORDER[index]}, got ${channelOrder[index]}`);
    }
  }
}

function makeAggregate(key, coordinates) {
  return {
    key,
    coordinates,
    extinctionMass: 0,
    geometryMass: 0,
    positionMass: [0, 0, 0],
    positionSecondMass: [0, 0, 0, 0, 0, 0],
    velocityMass: [0, 0, 0],
    temperatureMass: 0,
    densitySum: 0,
    densitySquareSum: 0,
    maxDensity: 0,
    detailSum: 0,
    microdetailSum: 0,
    interfaceShredSum: 0,
    sourceCellCount: 0,
    consolidatedSourceBinCount: 0,
    geometrySourceBinCount: 0,
    anchorExtinctionMass: 0,
    transferredTailExtinctionMass: 0,
  };
}

function accumulate(bin, sample) {
  const mass = sample.extinctionMass;
  bin.extinctionMass += mass;
  bin.geometryMass += mass;
  bin.temperatureMass += sample.temperature * mass;
  bin.densitySum += sample.density;
  bin.densitySquareSum += sample.density * sample.density;
  bin.maxDensity = Math.max(bin.maxDensity, sample.density);
  bin.detailSum += sample.detail;
  bin.microdetailSum += sample.microdetail;
  bin.interfaceShredSum += sample.interfaceShred;
  bin.sourceCellCount += 1;
  for (let axis = 0; axis < 3; axis += 1) {
    bin.positionMass[axis] += sample.position[axis] * mass;
    bin.velocityMass[axis] += sample.velocity[axis] * mass;
  }
  const [x, y, z] = sample.position;
  bin.positionSecondMass[0] += x * x * mass;
  bin.positionSecondMass[1] += x * y * mass;
  bin.positionSecondMass[2] += x * z * mass;
  bin.positionSecondMass[3] += y * y * mass;
  bin.positionSecondMass[4] += y * z * mass;
  bin.positionSecondMass[5] += z * z * mass;
}

function mergeFineIntoCoarse(coarse, fine, mass) {
  if (mass <= 0 || fine.extinctionMass <= 0) return;
  const ratio = mass / fine.extinctionMass;
  coarse.extinctionMass += mass;
  coarse.geometryMass += mass;
  coarse.temperatureMass += fine.temperatureMass * ratio;
  coarse.sourceCellCount += fine.sourceCellCount;
  coarse.densitySum += fine.densitySum;
  coarse.densitySquareSum += fine.densitySquareSum;
  coarse.maxDensity = Math.max(coarse.maxDensity, fine.maxDensity);
  coarse.detailSum += fine.detailSum;
  coarse.microdetailSum += fine.microdetailSum;
  coarse.interfaceShredSum += fine.interfaceShredSum;
  for (let axis = 0; axis < 3; axis += 1) {
    coarse.positionMass[axis] += fine.positionMass[axis] * ratio;
    coarse.velocityMass[axis] += fine.velocityMass[axis] * ratio;
  }
  for (let component = 0; component < 6; component += 1) {
    coarse.positionSecondMass[component] += fine.positionSecondMass[component] * ratio;
  }
}

function mergeAggregate(target, source, retainGeometry) {
  if (!(source.extinctionMass > 0)) return;
  target.extinctionMass += source.extinctionMass;
  target.temperatureMass += source.temperatureMass;
  target.sourceCellCount += source.sourceCellCount;
  target.densitySum += source.densitySum;
  target.densitySquareSum += source.densitySquareSum;
  target.maxDensity = Math.max(target.maxDensity, source.maxDensity);
  target.detailSum += source.detailSum;
  target.microdetailSum += source.microdetailSum;
  target.interfaceShredSum += source.interfaceShredSum;
  target.consolidatedSourceBinCount += 1;
  for (let axis = 0; axis < 3; axis += 1) {
    target.velocityMass[axis] += source.velocityMass[axis];
  }
  if (retainGeometry) {
    target.geometryMass += source.geometryMass;
    target.geometrySourceBinCount += 1;
    target.anchorExtinctionMass += source.extinctionMass;
    for (let axis = 0; axis < 3; axis += 1) {
      target.positionMass[axis] += source.positionMass[axis];
    }
    for (let component = 0; component < 6; component += 1) {
      target.positionSecondMass[component] += source.positionSecondMass[component];
    }
  } else {
    target.transferredTailExtinctionMass += source.extinctionMass;
  }
}

function normalizedAxis(velocity) {
  const speed = Math.hypot(...velocity);
  return speed > 1e-9 ? velocity.map(component => component / speed) : [0, 1, 0];
}

function dominantCovarianceAxis(covariance, fallback) {
  let axis = normalizedAxis(fallback);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const next = [
      covariance[0] * axis[0] + covariance[1] * axis[1] + covariance[2] * axis[2],
      covariance[1] * axis[0] + covariance[3] * axis[1] + covariance[4] * axis[2],
      covariance[2] * axis[0] + covariance[4] * axis[1] + covariance[5] * axis[2],
    ];
    const length = Math.hypot(...next);
    if (!(length > 1e-12)) break;
    axis = next.map(component => component / length);
  }
  return axis;
}

function aggregateWitness(bin) {
  const mass = bin.extinctionMass;
  const count = Math.max(1, bin.sourceCellCount);
  const densityMean = bin.densitySum / count;
  const densityVariance = Math.max(0, bin.densitySquareSum / count - densityMean * densityMean);
  const geometryMass = bin.geometryMass;
  const position = geometryMass > 0 ? bin.positionMass.map(component => component / geometryMass) : [0, 0, 0];
  const velocity = mass > 0 ? bin.velocityMass.map(component => component / mass) : [0, 0, 0];
  const second = geometryMass > 0
    ? bin.positionSecondMass.map(component => component / geometryMass)
    : [0, 0, 0, 0, 0, 0];
  const covariance = [
    Math.max(0, second[0] - position[0] * position[0]),
    second[1] - position[0] * position[1],
    second[2] - position[0] * position[2],
    Math.max(0, second[3] - position[1] * position[1]),
    second[4] - position[1] * position[2],
    Math.max(0, second[5] - position[2] * position[2]),
  ];
  return {
    position,
    velocity,
    temperature: mass > 0 ? bin.temperatureMass / mass : 0,
    densityMean,
    densityVariance,
    maxDensity: bin.maxDensity,
    detailMean: bin.detailSum / count,
    microdetailMean: bin.microdetailSum / count,
    interfaceShredMean: bin.interfaceShredSum / count,
    covariance,
  };
}

function articulationRow(bin, grid, fineBlockSize, frameId) {
  const witness = aggregateWitness(bin);
  const densityContrast = witness.maxDensity > 0
    ? Math.sqrt(witness.densityVariance) / Math.max(witness.maxDensity, 1e-8)
    : 0;
  const score = densityContrast * 0.58
    + witness.detailMean * 0.18
    + witness.microdetailMean * 0.12
    + witness.interfaceShredMean * 0.22;
  const binsPerAxis = grid / fineBlockSize;
  const [bx, by, bz] = bin.coordinates;
  return {
    frameId,
    spatialKey: `fine:${bx}:${by}:${bz}`,
    score,
    features: [
      Math.log1p(bin.extinctionMass),
      witness.densityMean,
      witness.densityVariance,
      witness.maxDensity,
      witness.detailMean,
      witness.microdetailMean,
      witness.interfaceShredMean,
      Math.hypot(...witness.velocity),
      (bx + 0.5) / binsPerAxis,
      (by + 0.5) / binsPerAxis,
      (bz + 0.5) / binsPerAxis,
    ],
  };
}

function makeSplat(bin, role, blockSize, cellWidth, slotIdentity, spatialKey, extinctionMass) {
  const witness = aggregateWitness(bin);
  const speed = Math.hypot(...witness.velocity);
  const baseRadius = blockSize * cellWidth * (role === 'transport-coarse' ? 0.64 : 0.38);
  const consolidated = role === 'transport-coarse' && bin.consolidatedSourceBinCount > 1;
  const principalAxis = consolidated
    ? dominantCovarianceAxis(witness.covariance, witness.velocity)
    : normalizedAxis(witness.velocity);
  const covarianceTrace = witness.covariance[0] + witness.covariance[3] + witness.covariance[5];
  const longitudinalVariance = Math.max(0,
    principalAxis[0] * (witness.covariance[0] * principalAxis[0] + witness.covariance[1] * principalAxis[1] + witness.covariance[2] * principalAxis[2])
    + principalAxis[1] * (witness.covariance[1] * principalAxis[0] + witness.covariance[3] * principalAxis[1] + witness.covariance[4] * principalAxis[2])
    + principalAxis[2] * (witness.covariance[2] * principalAxis[0] + witness.covariance[4] * principalAxis[1] + witness.covariance[5] * principalAxis[2]));
  const radialVariance = Math.max(0, (covarianceTrace - longitudinalVariance) * 0.5);
  const radialRadius = consolidated ? Math.max(baseRadius, Math.sqrt(radialVariance) * 2.35) : baseRadius;
  const longitudinalRadius = consolidated
    ? Math.max(baseRadius, Math.sqrt(longitudinalVariance) * 2.35)
    : baseRadius * (1.12 + Math.min(speed, 3) * 0.18);
  return {
    identity: `${role}:${slotIdentity.historySlot}:${slotIdentity.slotWriteTick}:${spatialKey}`,
    spatialIdentity: spatialKey,
    hierarchyRole: role,
    position: witness.position,
    principalAxis,
    radii: [radialRadius, longitudinalRadius, radialRadius],
    extinctionMass,
    densityWitness: witness.densityMean,
    temperatureWitness: witness.temperature,
    velocityWitness: witness.velocity,
    sourceCellCount: bin.sourceCellCount,
    consolidatedSourceBinCount: role === 'transport-coarse'
      ? Math.max(1, bin.consolidatedSourceBinCount)
      : 1,
    geometrySourceBinCount: role === 'transport-coarse'
      ? Math.max(1, bin.geometrySourceBinCount)
      : 1,
    anchorExtinctionMass: role === 'transport-coarse' ? bin.anchorExtinctionMass || extinctionMass : 0,
    transferredTailExtinctionMass: role === 'transport-coarse' ? bin.transferredTailExtinctionMass : 0,
  };
}

function consolidateCoarseBins(coarseBins, anchorMassRatio) {
  const sourceBins = [...coarseBins.values()]
    .filter(bin => bin.extinctionMass > 0)
    .sort((left, right) => left.key.localeCompare(right.key));
  if (sourceBins.length === 0) {
    return {
      bins: [],
      report: {
        identity: 'mass-preserving-anchor-voronoi-v1',
        spatialMomentAuthority: 'anchor-bin-only-tail-optical-transfer-v0',
        enabled: anchorMassRatio > 0,
        anchorMassRatio,
        anchorMassThreshold: 0,
        maximumSourceBinMass: 0,
        sourceCoarseBinCount: 0,
        consolidatedCoarseBinCount: 0,
        mergedSourceBinCount: 0,
        occupancyReductionFraction: 0,
        anchorSourceExtinctionMass: 0,
        transferredTailExtinctionMass: 0,
        representedCoarseExtinctionMass: 0,
      },
    };
  }
  const maximumSourceBinMass = Math.max(...sourceBins.map(bin => bin.extinctionMass));
  const anchorMassThreshold = maximumSourceBinMass * anchorMassRatio;
  const anchors = anchorMassRatio > 0
    ? sourceBins.filter(bin => bin.extinctionMass >= anchorMassThreshold)
    : sourceBins;
  const targets = new Map(anchors.map(anchor => [anchor.key, makeAggregate(anchor.key, [...anchor.coordinates])]));
  for (const anchor of anchors) mergeAggregate(targets.get(anchor.key), anchor, true);
  const anchorKeys = new Set(anchors.map(anchor => anchor.key));
  for (const source of sourceBins) {
    if (anchorKeys.has(source.key)) continue;
    let owner = anchors[0];
    let ownerDistance = Infinity;
    for (const anchor of anchors) {
      const distance = source.coordinates.reduce((sum, component, axis) => {
        const delta = component - anchor.coordinates[axis];
        return sum + delta * delta;
      }, 0);
      if (distance < ownerDistance || (distance === ownerDistance && anchor.key.localeCompare(owner.key) < 0)) {
        owner = anchor;
        ownerDistance = distance;
      }
    }
    mergeAggregate(targets.get(owner.key), source, false);
  }
  const bins = [...targets.values()].sort((left, right) => left.key.localeCompare(right.key));
  const anchorSourceExtinctionMass = bins.reduce((sum, bin) => sum + bin.anchorExtinctionMass, 0);
  const transferredTailExtinctionMass = bins.reduce((sum, bin) => sum + bin.transferredTailExtinctionMass, 0);
  return {
    bins,
    report: {
      identity: 'mass-preserving-anchor-voronoi-v1',
      spatialMomentAuthority: 'anchor-bin-only-tail-optical-transfer-v0',
      enabled: anchorMassRatio > 0,
      anchorMassRatio,
      anchorMassThreshold,
      maximumSourceBinMass,
      sourceCoarseBinCount: sourceBins.length,
      consolidatedCoarseBinCount: bins.length,
      mergedSourceBinCount: sourceBins.length - bins.length,
      occupancyReductionFraction: sourceBins.length > 0 ? 1 - bins.length / sourceBins.length : 0,
      anchorSourceExtinctionMass,
      transferredTailExtinctionMass,
      representedCoarseExtinctionMass: anchorSourceExtinctionMass + transferredTailExtinctionMass,
    },
  };
}

function configIdentity(config) {
  return [
    config.coarseBlockSize,
    config.fineBlockSize,
    Number(config.extinctionCoefficient).toPrecision(12),
    Number(config.fineMassFraction).toPrecision(12),
    Number(config.articulationThreshold).toPrecision(12),
    Number(config.coarseAnchorMassRatio).toPrecision(12),
    Number(config.fineOccupancyMassRatio).toPrecision(12),
    config.capacity === null ? 'uncapped' : config.capacity,
  ].join('|');
}

export function compileSmokeFieldHierarchy(request = {}) {
  const grid = Math.floor(positive(request.grid, 'grid'));
  if (grid !== Number(request.grid)) throw new RangeError('grid must be an integer');
  assertChannelOrder(request.channelOrder);
  if (!(request.field instanceof Float32Array)) throw new TypeError('field must be a Float32Array');
  const expectedLength = grid ** 3 * KAMINOS_FLUID_CHANNEL_ORDER.length;
  if (request.field.length !== expectedLength) {
    throw new Error(`field length ${request.field.length} does not match ${expectedLength}`);
  }
  const sourceIdentity = identity(request.sourceIdentity, 'sourceIdentity');
  const slotIdentity = request.slotIdentity;
  if (!slotIdentity || typeof slotIdentity !== 'object') throw new TypeError('slotIdentity is required');
  identity(slotIdentity.modelIdentity, 'slotIdentity.modelIdentity');
  finite(slotIdentity.historySlot, 'slotIdentity.historySlot');
  finite(slotIdentity.slotWriteTick, 'slotIdentity.slotWriteTick');
  finite(slotIdentity.simulatorGeneration, 'slotIdentity.simulatorGeneration');

  const coarseBlockSize = integerBlockSize(request.coarseBlockSize ?? 8, grid, 'coarseBlockSize');
  const fineBlockSize = integerBlockSize(request.fineBlockSize ?? Math.max(1, coarseBlockSize / 2), grid, 'fineBlockSize');
  if (coarseBlockSize % fineBlockSize !== 0) throw new RangeError('fineBlockSize must divide coarseBlockSize');
  const extinctionCoefficient = positive(request.extinctionCoefficient ?? 1.35, 'extinctionCoefficient');
  const fineMassFraction = nonNegative(request.fineMassFraction ?? 0.5, 'fineMassFraction');
  if (fineMassFraction > 1) throw new RangeError('fineMassFraction must not exceed 1');
  const articulationThreshold = nonNegative(request.articulationThreshold ?? 0.5, 'articulationThreshold');
  const coarseAnchorMassRatio = nonNegative(request.coarseAnchorMassRatio ?? 0, 'coarseAnchorMassRatio');
  if (coarseAnchorMassRatio > 1) throw new RangeError('coarseAnchorMassRatio must not exceed 1');
  const fineOccupancyMassRatio = nonNegative(request.fineOccupancyMassRatio ?? 0, 'fineOccupancyMassRatio');
  if (fineOccupancyMassRatio > 1) throw new RangeError('fineOccupancyMassRatio must not exceed 1');
  const capacity = request.capacity === undefined || request.capacity === null
    ? null
    : Math.floor(nonNegative(request.capacity, 'capacity'));
  const fineSelector = request.fineSelector;
  if (fineSelector !== undefined && typeof fineSelector !== 'function') throw new TypeError('fineSelector must be a function');

  const cellWidth = 2 / grid;
  const cellVolume = cellWidth ** 3;
  const fineBins = new Map();
  let sourceExtinctionMass = 0;
  for (let z = 0; z < grid; z += 1) {
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const cellIndex = x + y * grid + z * grid * grid;
        const offset = cellIndex * KAMINOS_FLUID_CHANNEL_ORDER.length;
        const density = request.field[offset + CHANNEL.smokeDensity];
        if (!Number.isFinite(density) || density < 0) throw new Error(`smoke density is invalid at cell ${cellIndex}`);
        if (density === 0) continue;
        const extinctionMass = density * cellVolume * extinctionCoefficient;
        sourceExtinctionMass += extinctionMass;
        const coordinates = [
          Math.floor(x / fineBlockSize),
          Math.floor(y / fineBlockSize),
          Math.floor(z / fineBlockSize),
        ];
        const key = coordinates.join(':');
        let bin = fineBins.get(key);
        if (!bin) {
          bin = makeAggregate(key, coordinates);
          fineBins.set(key, bin);
        }
        accumulate(bin, {
          position: [
            -1 + (x + 0.5) * cellWidth,
            -1 + (y + 0.5) * cellWidth,
            -1 + (z + 0.5) * cellWidth,
          ],
          velocity: [
            request.field[offset + CHANNEL.velocityX],
            request.field[offset + CHANNEL.velocityY],
            request.field[offset + CHANNEL.velocityZ],
          ],
          density,
          temperature: Math.max(0, request.field[offset + CHANNEL.heat]),
          detail: Math.max(0, request.field[offset + CHANNEL.detail]),
          microdetail: Math.max(0, request.field[offset + CHANNEL.microdetail]),
          interfaceShred: Math.max(0, request.field[offset + CHANNEL.interfaceShred]),
          extinctionMass,
        });
      }
    }
  }
  if (!(sourceExtinctionMass > 0)) throw new Error('blank smoke field has no positive extinction mass');
  let maximumFineBinMass = 0;
  for (const fine of fineBins.values()) {
    maximumFineBinMass = Math.max(maximumFineBinMass, fine.extinctionMass);
  }
  const fineOccupancyMassThreshold = maximumFineBinMass * fineOccupancyMassRatio;

  const frameId = `sim-step-${slotIdentity.slotWriteTick}`;
  const modelRows = [];
  const fineSplats = [];
  const coarseBins = new Map();
  let selectorSelectedFineBinCount = 0;
  let occupancyAcceptedSelectedFineBinCount = 0;
  let selectorSelectedSourceExtinctionMass = 0;
  let emittedFineSourceExtinctionMass = 0;
  let occupancyTransferredSourceExtinctionMass = 0;
  for (const fine of fineBins.values()) {
    const row = articulationRow(fine, grid, fineBlockSize, frameId);
    row.label = row.score >= articulationThreshold ? 1 : 0;
    modelRows.push(row);
    const selectorSelected = fineSelector ? Boolean(fineSelector(row)) : row.label === 1;
    if (selectorSelected) {
      selectorSelectedFineBinCount += 1;
      selectorSelectedSourceExtinctionMass += fine.extinctionMass;
    }
    const occupancySelected = fineOccupancyMassRatio === 0
      || fine.extinctionMass >= fineOccupancyMassThreshold;
    const selected = selectorSelected && occupancySelected;
    if (selected) {
      occupancyAcceptedSelectedFineBinCount += 1;
      emittedFineSourceExtinctionMass += fine.extinctionMass;
    }
    else if (selectorSelected) occupancyTransferredSourceExtinctionMass += fine.extinctionMass;
    const fineMass = selected ? fine.extinctionMass * fineMassFraction : 0;
    const coarseMass = fine.extinctionMass - fineMass;
    const ratio = coarseBlockSize / fineBlockSize;
    const coarseCoordinates = fine.coordinates.map(component => Math.floor(component / ratio));
    const coarseKey = coarseCoordinates.join(':');
    let coarse = coarseBins.get(coarseKey);
    if (!coarse) {
      coarse = makeAggregate(coarseKey, coarseCoordinates);
      coarseBins.set(coarseKey, coarse);
    }
    mergeFineIntoCoarse(coarse, fine, coarseMass);
    if (fineMass > 0) {
      fineSplats.push(makeSplat(
        fine,
        'articulation-fine',
        fineBlockSize,
        cellWidth,
        slotIdentity,
        row.spatialKey,
        fineMass,
      ));
    }
  }
  const consolidatedCoarse = consolidateCoarseBins(coarseBins, coarseAnchorMassRatio);
  const coarseSplats = [];
  for (const coarse of consolidatedCoarse.bins) {
    if (coarse.extinctionMass <= 0) continue;
    const spatialKey = `coarse:${coarse.coordinates.join(':')}`;
    coarseSplats.push(makeSplat(
      coarse,
      'transport-coarse',
      coarseBlockSize,
      cellWidth,
      slotIdentity,
      spatialKey,
      coarse.extinctionMass,
    ));
  }

  coarseSplats.sort((left, right) => left.spatialIdentity.localeCompare(right.spatialIdentity));
  fineSplats.sort((left, right) => left.spatialIdentity.localeCompare(right.spatialIdentity));
  modelRows.sort((left, right) => left.spatialKey.localeCompare(right.spatialKey));
  const splats = [...coarseSplats, ...fineSplats];
  const representedExtinctionMass = splats.reduce((sum, splat) => sum + splat.extinctionMass, 0);
  const rejected = sourceExtinctionMass - representedExtinctionMass;
  const overflowCount = capacity === null ? 0 : Math.max(0, splats.length - capacity);
  const normalizedConfig = {
    coarseBlockSize,
    fineBlockSize,
    extinctionCoefficient,
    fineMassFraction,
    articulationThreshold,
    coarseAnchorMassRatio,
    fineOccupancyMassRatio,
    capacity,
  };
  const decoderConfigIdentity = configIdentity(normalizedConfig);
  return {
    identity: [
      'smoke-splat-product',
      encodeURIComponent(sourceIdentity),
      encodeURIComponent(slotIdentity.modelIdentity),
      slotIdentity.simulatorGeneration,
      slotIdentity.historySlot,
      slotIdentity.slotWriteTick,
      encodeURIComponent(decoderConfigIdentity),
    ].join(':'),
    schema: 'kaminos-hierarchical-smoke-splats-v0',
    producerAuthority: REAL_FIELD_SMOKE_SPLAT_PRODUCER_AUTHORITY,
    producerKind: fineSelector ? 'learned-sparse-residual-plus-conserved-coarse' : 'real-field-hierarchical-target',
    slotIdentity: { ...slotIdentity },
    payloadIdentity: sourceIdentity,
    decoderConfigIdentity,
    ...normalizedConfig,
    coarseSplats,
    fineSplats,
    splats,
    requiredSplatCount: splats.length,
    hierarchyCounts: { coarse: coarseSplats.length, fine: fineSplats.length, total: splats.length },
    coarseConsolidation: consolidatedCoarse.report,
    fineOccupancy: {
      identity: 'mass-relative-fine-occupancy-v0',
      enabled: fineOccupancyMassRatio > 0,
      massRatio: fineOccupancyMassRatio,
      massThreshold: fineOccupancyMassThreshold,
      maximumFineBinMass,
      sourceOccupiedFineBinCount: fineBins.size,
      selectorSelectedFineBinCount,
      occupancyAcceptedSelectedFineBinCount,
      emittedFineBinCount: fineSplats.length,
      occupancyTransferredFineBinCount: selectorSelectedFineBinCount - occupancyAcceptedSelectedFineBinCount,
      selectorSelectedSourceExtinctionMass,
      emittedFineSourceExtinctionMass,
      occupancyTransferredSourceExtinctionMass,
      emittedFineExtinctionMass: emittedFineSourceExtinctionMass * fineMassFraction,
      occupancyTransferredFineAllocationMass: occupancyTransferredSourceExtinctionMass * fineMassFraction,
    },
    accounting: {
      identity: 'smoke-splat-extinction-accounting-v0',
      sourceExtinctionMass,
      representedExtinctionMass,
      rejectedExtinctionMass: Math.abs(rejected) < 1e-8 ? 0 : rejected,
      retentionRatio: representedExtinctionMass / sourceExtinctionMass,
    },
    sourceStatistics: {
      sourceCellCount: grid ** 3,
      occupiedFineBinCount: fineBins.size,
      sourceCoarseBinCount: consolidatedCoarse.report.sourceCoarseBinCount,
      articulationTargetCount: modelRows.reduce((sum, row) => sum + row.label, 0),
      articulationTargetFraction: modelRows.length
        ? modelRows.reduce((sum, row) => sum + row.label, 0) / modelRows.length
        : 0,
    },
    capacity: {
      requested: capacity,
      status: overflowCount > 0 ? 'capacity-overflow-untruncated' : 'within-capacity',
      overflowCount,
      outputWasTruncated: false,
    },
    diagnostics: overflowCount > 0 ? [{
      code: 'smoke-splat-capacity-overflow',
      severity: 'warning',
      requestedCapacity: capacity,
      requiredSplatCount: splats.length,
      overflowCount,
      behavior: 'untruncated',
    }] : [],
    temporalKeys: {
      coarse: coarseSplats.map(splat => splat.spatialIdentity),
      fine: fineSplats.map(splat => splat.spatialIdentity),
    },
    modelRows,
  };
}

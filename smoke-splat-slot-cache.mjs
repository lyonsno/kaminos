export const SMOKE_SPLAT_PRODUCER_AUTHORITY = 'deterministic-reference-smoke-splat-producer-v0';
export const SMOKE_SPLAT_SLOT_CACHE_IDENTITY = 'kaminos-smoke-splat-slot-cache-v0';

const DEFAULT_COARSE_CELL_SIZE = 1;
const DEFAULT_SPARSE_DENSITY_THRESHOLD = 0.02;
const DEFAULT_FINE_MASS_FRACTION = 0.5;

function requireFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function requireNonNegative(value, label) {
  const number = requireFinite(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function requirePositive(value, label) {
  const number = requireFinite(value, label);
  if (number <= 0) throw new RangeError(`${label} must be positive`);
  return number;
}

function requireIdentity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function requireVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} must be a three-element array`);
  return value.map((component, index) => requireFinite(component, `${label}[${index}]`));
}

function stableNumber(value) {
  return Number(value).toPrecision(12);
}

function slotKey(slotIdentity) {
  return [
    requireIdentity(slotIdentity.modelIdentity, 'slot modelIdentity'),
    requireFinite(slotIdentity.simulatorGeneration, 'slot simulatorGeneration'),
    requireFinite(slotIdentity.historySlot, 'slot historySlot'),
    requireFinite(slotIdentity.slotWriteTick, 'slot slotWriteTick'),
  ].join('|');
}

function productIdentity(slotIdentity, payloadIdentity, decoderConfigIdentity) {
  return [
    'smoke-splat-product',
    encodeURIComponent(slotKey(slotIdentity)),
    encodeURIComponent(payloadIdentity),
    encodeURIComponent(decoderConfigIdentity),
  ].join(':');
}

function normalizeDecodeConfig(request, capacity) {
  const sparseDensityThreshold = request.sparseDensityThreshold === undefined
    ? DEFAULT_SPARSE_DENSITY_THRESHOLD
    : requireNonNegative(request.sparseDensityThreshold, 'sparseDensityThreshold');
  const coarseCellSize = request.coarseCellSize === undefined
    ? DEFAULT_COARSE_CELL_SIZE
    : requirePositive(request.coarseCellSize, 'coarseCellSize');
  const fineMassFraction = request.fineMassFraction === undefined
    ? DEFAULT_FINE_MASS_FRACTION
    : requireNonNegative(request.fineMassFraction, 'fineMassFraction');
  if (fineMassFraction > 1) throw new RangeError('fineMassFraction must not exceed 1');
  const normalizedCapacity = capacity === undefined || capacity === null
    ? null
    : Math.floor(requireNonNegative(capacity, 'capacity'));
  return {
    sparseDensityThreshold,
    coarseCellSize,
    fineMassFraction,
    capacity: normalizedCapacity,
    identity: [
      stableNumber(sparseDensityThreshold),
      stableNumber(coarseCellSize),
      stableNumber(fineMassFraction),
      normalizedCapacity === null ? 'uncapped' : normalizedCapacity,
    ].join('|'),
  };
}

function makeFailure(message, report) {
  const error = new Error(message);
  error.name = 'SmokeSplatSlotError';
  error.report = {
    identity: 'smoke-splat-slot-failure-report-v0',
    status: 'failed',
    ...report,
  };
  return error;
}

export function makeSmokeSplatPhaseInstances({ instances, historyWriteTick } = {}) {
  if (!Array.isArray(instances)) throw new TypeError('instances must be an array');
  const effectiveHistoryWriteTick = requireFinite(historyWriteTick, 'historyWriteTick');
  return instances.map((instance, index) => {
    if (!instance || typeof instance !== 'object') throw new TypeError(`instance ${index} must be an object`);
    const historyOffsetSlots = requireNonNegative(
      instance.phaseHistoryOffsetSlots,
      `instance ${index} phaseHistoryOffsetSlots`,
    );
    if (instance.historyDepth !== undefined) {
      const historyDepth = Math.floor(requirePositive(instance.historyDepth, `instance ${index} historyDepth`));
      if (historyOffsetSlots >= historyDepth) {
        throw makeFailure(
          `phase slot ${instance.phaseHistorySlot} is outside retained smoke history depth ${historyDepth}`,
          {
            failurePhase: 'phase-retention-validation',
            historyWriteTick: effectiveHistoryWriteTick,
            historyOffsetSlots,
            historyDepth,
            historySlot: instance.phaseHistorySlot,
            instanceIndex: instance.index ?? index,
          },
        );
      }
      const historySlot = requireFinite(instance.phaseHistorySlot, `instance ${index} phaseHistorySlot`);
      const expectedHistorySlot = ((effectiveHistoryWriteTick - historyOffsetSlots) % historyDepth + historyDepth) % historyDepth;
      if (historySlot !== expectedHistorySlot) {
        throw makeFailure(
          `phase slot ${historySlot} does not match retained smoke epoch slot ${expectedHistorySlot}`,
          {
            failurePhase: 'phase-slot-epoch-validation',
            historyWriteTick: effectiveHistoryWriteTick,
            historyOffsetSlots,
            historyDepth,
            historySlot,
            expectedHistorySlot,
            instanceIndex: instance.index ?? index,
          },
        );
      }
    }
    const slotWriteTick = effectiveHistoryWriteTick - historyOffsetSlots;
    if (slotWriteTick < 0) {
      throw makeFailure(`phase slot ${instance.phaseHistorySlot} has no initialized smoke history epoch`, {
        failurePhase: 'phase-epoch-binding',
        historyWriteTick: effectiveHistoryWriteTick,
        historyOffsetSlots,
        historySlot: instance.phaseHistorySlot,
        instanceIndex: instance.index ?? index,
      });
    }
    return { ...instance, slotWriteTick };
  });
}

function normalizeCell(cell, index) {
  if (!cell || typeof cell !== 'object') throw new TypeError(`smoke cell ${index} must be an object`);
  const density = requireNonNegative(cell.density, `smoke cell ${index} density`);
  const cellVolume = cell.volume === undefined ? 1 : requirePositive(cell.volume, `smoke cell ${index} volume`);
  const extinctionCoefficient = cell.extinctionCoefficient === undefined
    ? 1
    : requireNonNegative(cell.extinctionCoefficient, `smoke cell ${index} extinctionCoefficient`);
  return {
    index,
    position: requireVector3(cell.position, `smoke cell ${index} position`),
    velocity: cell.velocity === undefined
      ? [0, 0, 0]
      : requireVector3(cell.velocity, `smoke cell ${index} velocity`),
    density,
    temperature: cell.temperature === undefined
      ? 0
      : requireNonNegative(cell.temperature, `smoke cell ${index} temperature`),
    extinctionMass: density * cellVolume * extinctionCoefficient,
  };
}

function coarseBinKey(position, coarseCellSize) {
  return position.map(component => Math.floor(component / coarseCellSize)).join(',');
}

function makeFineSplat(cell, extinctionMass, coarseCellSize, slotIdentity) {
  const speed = Math.hypot(...cell.velocity);
  const axis = speed > 1e-8
    ? cell.velocity.map(component => component / speed)
    : [0, 1, 0];
  return {
    identity: `smoke-fine:${slotIdentity.historySlot}:${slotIdentity.slotWriteTick}:${cell.index}`,
    hierarchyRole: 'articulation-fine',
    position: cell.position,
    principalAxis: axis,
    radii: [coarseCellSize * 0.22, coarseCellSize * (0.28 + Math.min(speed, 2) * 0.08), coarseCellSize * 0.22],
    extinctionMass,
    densityWitness: cell.density,
    temperatureWitness: cell.temperature,
  };
}

function makeCoarseSplat(bin, coarseCellSize, slotIdentity) {
  const mass = bin.extinctionMass;
  const weight = mass > 0 ? 1 / mass : 0;
  const velocity = bin.velocityMass.map(component => component * weight);
  const speed = Math.hypot(...velocity);
  const axis = speed > 1e-8
    ? velocity.map(component => component / speed)
    : [0, 1, 0];
  return {
    identity: `smoke-coarse:${slotIdentity.historySlot}:${slotIdentity.slotWriteTick}:${bin.key}`,
    hierarchyRole: 'transport-coarse',
    position: bin.positionMass.map(component => component * weight),
    principalAxis: axis,
    radii: [coarseCellSize * 0.62, coarseCellSize * (0.75 + Math.min(speed, 2) * 0.16), coarseCellSize * 0.62],
    extinctionMass: mass,
    sourceCellCount: bin.sourceCellCount,
  };
}

export function decodeReferenceSmokeHierarchy(request = {}) {
  const slotIdentity = request.slotIdentity;
  if (!slotIdentity || typeof slotIdentity !== 'object') throw new TypeError('slotIdentity is required');
  slotKey(slotIdentity);
  const payload = request.payload;
  if (!payload || typeof payload !== 'object') throw new TypeError('smoke payload is required');
  const payloadIdentity = requireIdentity(payload.identity, 'smoke payload identity');
  if (!Array.isArray(payload.cells)) throw new TypeError('smoke payload cells must be an array');

  const decodeConfig = normalizeDecodeConfig(request, request.capacity);
  const {
    sparseDensityThreshold,
    coarseCellSize,
    fineMassFraction,
    capacity,
  } = decodeConfig;

  const cells = payload.cells.map(normalizeCell);
  const bins = new Map();
  const fineSplats = [];
  let sourceExtinctionMass = 0;

  for (const cell of cells) {
    sourceExtinctionMass += cell.extinctionMass;
    const fineMass = cell.density >= sparseDensityThreshold
      ? cell.extinctionMass * fineMassFraction
      : 0;
    const coarseMass = cell.extinctionMass - fineMass;
    if (fineMass > 0) fineSplats.push(makeFineSplat(cell, fineMass, coarseCellSize, slotIdentity));
    if (coarseMass <= 0) continue;

    const key = coarseBinKey(cell.position, coarseCellSize);
    let bin = bins.get(key);
    if (!bin) {
      bin = {
        key,
        extinctionMass: 0,
        positionMass: [0, 0, 0],
        velocityMass: [0, 0, 0],
        sourceCellCount: 0,
      };
      bins.set(key, bin);
    }
    bin.extinctionMass += coarseMass;
    bin.sourceCellCount += 1;
    for (let axis = 0; axis < 3; axis += 1) {
      bin.positionMass[axis] += cell.position[axis] * coarseMass;
      bin.velocityMass[axis] += cell.velocity[axis] * coarseMass;
    }
  }

  const coarseSplats = Array.from(bins.values(), bin => makeCoarseSplat(bin, coarseCellSize, slotIdentity));
  const splats = [...coarseSplats, ...fineSplats];
  const representedExtinctionMass = splats.reduce((sum, splat) => sum + splat.extinctionMass, 0);
  const rejectedExtinctionMass = sourceExtinctionMass - representedExtinctionMass;
  const overflowCount = capacity === null ? 0 : Math.max(0, splats.length - capacity);
  const capacityStatus = overflowCount > 0 ? 'capacity-overflow-untruncated' : 'within-capacity';
  const diagnostics = overflowCount > 0
    ? [{
        code: 'smoke-splat-capacity-overflow',
        severity: 'warning',
        requestedCapacity: capacity,
        requiredSplatCount: splats.length,
        overflowCount,
        behavior: 'untruncated',
      }]
    : [];

  return {
    identity: productIdentity(slotIdentity, payloadIdentity, decodeConfig.identity),
    schema: 'kaminos-hierarchical-smoke-splats-v0',
    producerAuthority: SMOKE_SPLAT_PRODUCER_AUTHORITY,
    producerKind: 'deterministic-reference',
    slotIdentity: { ...slotIdentity },
    payloadIdentity,
    sparseDensityThreshold,
    coarseCellSize,
    fineMassFraction,
    decoderConfigIdentity: decodeConfig.identity,
    coarseSplats,
    fineSplats,
    splats,
    requiredSplatCount: splats.length,
    hierarchyCounts: {
      coarse: coarseSplats.length,
      fine: fineSplats.length,
      total: splats.length,
    },
    accounting: {
      identity: 'smoke-splat-extinction-accounting-v0',
      sourceExtinctionMass,
      representedExtinctionMass,
      rejectedExtinctionMass: Math.abs(rejectedExtinctionMass) < 1e-12 ? 0 : rejectedExtinctionMass,
      retentionRatio: sourceExtinctionMass > 0 ? representedExtinctionMass / sourceExtinctionMass : 1,
    },
    capacity: {
      requested: capacity,
      status: capacityStatus,
      overflowCount,
      outputWasTruncated: false,
    },
    diagnostics,
  };
}

export function createSmokeSplatSlotCache(options = {}) {
  if (typeof options.decodeSlot !== 'function') throw new TypeError('decodeSlot must be an explicit function');
  const producerAuthority = options.producerAuthority === undefined
    ? SMOKE_SPLAT_PRODUCER_AUTHORITY
    : requireIdentity(options.producerAuthority, 'producerAuthority');
  const cacheIdentity = `${SMOKE_SPLAT_SLOT_CACHE_IDENTITY}:${encodeURIComponent(producerAuthority)}`;
  const products = new Map();
  let activeIdentity = null;

  function clear() {
    products.clear();
    activeIdentity = null;
  }

  function resolve(request = {}) {
    if (!Array.isArray(request.instances)) throw new TypeError('instances must be an array');
    if (typeof request.payloadForSlot !== 'function') throw new TypeError('payloadForSlot must be a function');
    if (request.capacityForSlot !== undefined && typeof request.capacityForSlot !== 'function') {
      throw new TypeError('capacityForSlot must be a function when provided');
    }
    const simulatorGeneration = requireFinite(request.simulatorGeneration, 'simulatorGeneration');
    const modelIdentity = requireIdentity(request.modelIdentity, 'modelIdentity');
    const requestedProducerAuthority = request.requestedProducerAuthority ?? producerAuthority;
    if (requestedProducerAuthority !== producerAuthority) {
      throw makeFailure(`unsupported smoke producer authority ${requestedProducerAuthority}`, {
        failurePhase: 'producer-authority-resolution',
        requestedProducerAuthority,
        effectiveProducerAuthority: null,
      });
    }

    const nextIdentity = `${modelIdentity}|${stableNumber(simulatorGeneration)}`;
    const identityChanged = activeIdentity !== null && activeIdentity !== nextIdentity;
    if (activeIdentity !== nextIdentity) {
      products.clear();
      activeIdentity = nextIdentity;
    }

    const groups = new Map();
    for (const instance of request.instances) {
      if (!instance || typeof instance !== 'object') throw new TypeError('each instance descriptor must be an object');
      const slotIdentity = {
        historySlot: requireFinite(instance.phaseHistorySlot, 'instance phaseHistorySlot'),
        slotWriteTick: requireFinite(instance.slotWriteTick, 'instance slotWriteTick'),
        simulatorGeneration,
        modelIdentity,
      };
      const key = slotKey(slotIdentity);
      let group = groups.get(key);
      if (!group) {
        group = { key, slotIdentity, instances: [] };
        groups.set(key, group);
      }
      group.instances.push(instance);
    }

    const resolvedProducts = new Map();
    const decoderConfigIdentities = new Set();
    let decodeCount = 0;
    let cacheHitCount = 0;
    for (const group of groups.values()) {
      const payload = request.payloadForSlot(group.slotIdentity.historySlot, { ...group.slotIdentity });
      if (!payload) {
        throw makeFailure(`missing smoke payload for phase slot ${group.slotIdentity.historySlot}`, {
          failurePhase: 'phase-payload-resolution',
          requestedProducerAuthority,
          effectiveProducerAuthority: null,
          slotIdentity: { ...group.slotIdentity },
          lastTrustworthyEvidence: {
            instanceCount: request.instances.length,
            uniqueSlotCount: groups.size,
            decodedSlotCount: decodeCount,
          },
        });
      }
      const payloadIdentity = requireIdentity(payload.identity, 'smoke payload identity');
      const requestedCapacity = request.capacityForSlot?.(
        group.slotIdentity.historySlot,
        { ...group.slotIdentity },
      ) ?? request.capacity;
      const decodeConfig = normalizeDecodeConfig(request, requestedCapacity);
      decoderConfigIdentities.add(decodeConfig.identity);
      const productCacheIdentity = `${payloadIdentity}|${decodeConfig.identity}`;
      const cached = products.get(group.key);
      let product = cached?.cacheIdentity === productCacheIdentity ? cached.product : null;
      if (product) {
        cacheHitCount += 1;
      } else {
        product = options.decodeSlot({
          slotIdentity: { ...group.slotIdentity },
          payload,
          sparseDensityThreshold: decodeConfig.sparseDensityThreshold,
          coarseCellSize: decodeConfig.coarseCellSize,
          fineMassFraction: decodeConfig.fineMassFraction,
          capacity: decodeConfig.capacity,
        });
        if (!product || product.producerAuthority !== producerAuthority) {
          throw makeFailure(`smoke decoder returned invalid authority for phase slot ${group.slotIdentity.historySlot}`, {
            failurePhase: 'slot-decode-validation',
            requestedProducerAuthority,
            effectiveProducerAuthority: product?.producerAuthority ?? null,
            slotIdentity: { ...group.slotIdentity },
          });
        }
        products.set(group.key, { cacheIdentity: productCacheIdentity, product });
        decodeCount += 1;
      }
      resolvedProducts.set(group.key, product);
    }

    const instanceBindings = request.instances.map(instance => {
      const key = slotKey({
        historySlot: instance.phaseHistorySlot,
        slotWriteTick: instance.slotWriteTick,
        simulatorGeneration,
        modelIdentity,
      });
      const product = resolvedProducts.get(key);
      return {
        instanceIndex: instance.index,
        historySlot: instance.phaseHistorySlot,
        slotWriteTick: instance.slotWriteTick,
        productIdentity: product.identity,
        transform: instance.transform,
      };
    });

    const slotProducts = Array.from(resolvedProducts.values());
    return {
      identity: 'smoke-splat-slot-resolve-report-v0',
      status: 'resolved',
      cacheIdentity,
      requestedProducerAuthority,
      effectiveProducerAuthority: producerAuthority,
      simulatorGeneration,
      modelIdentity,
      decoderConfigIdentities: Array.from(decoderConfigIdentities).sort(),
      instanceCount: request.instances.length,
      uniqueSlotCount: groups.size,
      decodeCount,
      cacheHitCount,
      cachedProductCount: products.size,
      slotProducts,
      instanceBindings,
      hierarchyCounts: slotProducts.reduce((counts, product) => ({
        coarse: counts.coarse + product.hierarchyCounts.coarse,
        fine: counts.fine + product.hierarchyCounts.fine,
        total: counts.total + product.hierarchyCounts.total,
      }), { coarse: 0, fine: 0, total: 0 }),
      accounting: slotProducts.reduce((totals, product) => ({
        sourceExtinctionMass: totals.sourceExtinctionMass + product.accounting.sourceExtinctionMass,
        representedExtinctionMass: totals.representedExtinctionMass + product.accounting.representedExtinctionMass,
        rejectedExtinctionMass: totals.rejectedExtinctionMass + product.accounting.rejectedExtinctionMass,
      }), { sourceExtinctionMass: 0, representedExtinctionMass: 0, rejectedExtinctionMass: 0 }),
      invalidation: {
        identityChanged,
        identity: nextIdentity,
      },
      diagnostics: slotProducts.flatMap(product => product.diagnostics),
    };
  }

  return {
    identity: cacheIdentity,
    producerAuthority,
    resolve,
    clear,
    size() {
      return products.size;
    },
  };
}

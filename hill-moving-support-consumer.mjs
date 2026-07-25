import {
  measureFingerFluidLiveInletReleasePlan,
  planFingerFluidLiveInletEconomics,
} from './finger-fluid-webgpu-core.js';
import {
  createFingerFluidAnalyticImpactHandoffReceipt,
  createFingerFluidAnalyticJetDescriptor,
  measureFingerFluidAnalyticJetFirstImpact,
  validateFingerFluidAnalyticImpactHandoffReceipt,
} from './finger-fluid-analytic-impact-handoff.js';

export const HILL_MOVING_SUPPORT_CONSUMER_SCHEMA =
  'kaminos.hill-moving-support-consumer-exercise.v1';
export const HILL_SUPPORT_PACKAGE_COORDINATE =
  '@lerms/hill-of-hills-support/hill-of-hills/analytic-impact-support';
export const BIG_PAPA_MOVING_SUPPORT_REVISION =
  'f8e1f6db64fb3a505151d16f83d5131b588d2516';

const HILL_PACKAGE_REPORT_SCHEMA =
  'lerms.hill-of-hills.analytic-impact-package-witness.v1';
const WORLD_TIME_INTERVAL = Object.freeze({ min: 41.9, max: 42.4 });
const MAXIMUM_SPATIAL_LIPSCHITZ = 3;
const MAXIMUM_SIGNED_DISTANCE_RATE = 1.3;

function exactDigest(value, label) {
  if (!/^[0-9a-f]{64}$/i.test(String(value ?? ''))) {
    throw new Error(`${label} must be an exact SHA-256 digest`);
  }
  return String(value);
}

function exactRevision(value, label) {
  if (!/^[0-9a-f]{40}$/i.test(String(value ?? ''))) {
    throw new Error(`${label} must be an exact Git revision`);
  }
  return String(value);
}

function assertPackageReport(report) {
  if (
    report?.schema !== HILL_PACKAGE_REPORT_SCHEMA
    || report.ok !== true
    || report.primaryOutputWritten !== true
    || report.failurePhase !== null
  ) {
    throw new Error('Hill package report is missing or did not reach primary output');
  }
  if (
    report.effective?.packageCoordinate !== HILL_SUPPORT_PACKAGE_COORDINATE
    || report.effective?.exportSubpath
      !== './hill-of-hills/analytic-impact-support'
    || report.fallbackRoute !== null
  ) {
    throw new Error('Hill package report does not prove the requested non-fallback route');
  }
  if (report.artifactFreshness !== 'built_current_run') {
    throw new Error('Hill package report does not identify a current-run artifact');
  }
  exactRevision(report.requested?.sourceRevision, 'Hill package source revision');
  exactDigest(report.artifact?.sha256, 'Hill package artifact');
  if (
    typeof report.artifact?.integrity !== 'string'
    || !report.artifact.integrity.startsWith('sha512-')
  ) {
    throw new Error('Hill package report is missing artifact integrity');
  }
}

function sameRecord(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function captureFailure(operation) {
  try {
    operation();
  } catch (error) {
    return Object.freeze({
      rejected: true,
      code: error?.code ?? null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  throw new Error('false-provider witness unexpectedly succeeded');
}

function assertVectorParity(a, b, label) {
  if (
    !Array.isArray(a)
    || !Array.isArray(b)
    || a.length !== 3
    || b.length !== 3
    || a.some((value, index) => value !== b[index])
  ) {
    throw new Error(`${label} lost exact vector parity`);
  }
}

export function exerciseHillMovingSupportConsumer({
  hillSupportModule,
  hillTerrainModule,
  packageReport,
} = {}) {
  assertPackageReport(packageReport);
  if (
    typeof hillSupportModule?.createHillAnalyticImpactSupportQuery
      !== 'function'
    || typeof hillTerrainModule?.createHillOfHillsTerrain !== 'function'
    || !hillTerrainModule?.defaultHillOfHillsParams
  ) {
    throw new Error('Hill package modules are partial');
  }
  const {
    createHillAnalyticImpactSupportQuery,
    HILL_ANALYTIC_IMPACT_SUPPORT_ROUTE,
    HILL_ANALYTIC_IMPACT_SUPPORT_SCHEMA,
  } = hillSupportModule;
  const {
    createHillOfHillsTerrain,
    defaultHillOfHillsParams,
  } = hillTerrainModule;

  const identity = Object.freeze({
    schema: HILL_ANALYTIC_IMPACT_SUPPORT_SCHEMA,
    sourceId: [
      'hill-moving-support-consumer',
      packageReport.requested.sourceRevision.slice(0, 12),
    ].join('-'),
    providerRoute: HILL_ANALYTIC_IMPACT_SUPPORT_ROUTE,
    artifactSha256: packageReport.artifact.sha256,
    terrainId: 'hill-of-hills',
    terrainGeneration: 1,
    transformEpoch: 0,
    topologyEpoch: 42,
    supportEpoch: 1,
    remapEpoch: 0,
    stale: false,
    fallbackRoute: null,
  });
  const terrainParams = Object.freeze({
    ...defaultHillOfHillsParams,
    topologyPhaseIntensity: 1,
    topologyPhaseLimit: 4,
  });
  const frameCache = new Map();
  const createFrame = (worldTime, frameIdentity = identity) => ({
    terrain: createHillOfHillsTerrain(
      {
        ...terrainParams,
        topologyPhaseTimeMs: worldTime * 1_000,
      },
      {
        route: HILL_ANALYTIC_IMPACT_SUPPORT_ROUTE,
        frameId: `hill-moving-support-${worldTime.toFixed(9)}`,
        configId: 'hill-moving-support-consumer-v1',
        timestampMs: worldTime * 1_000,
        sampleAgeMs: 0,
      },
    ),
    identity: frameIdentity,
    worldTime,
  });
  const frameAt = (worldTime) => {
    const key = worldTime.toPrecision(17);
    let frame = frameCache.get(key);
    if (!frame) {
      frame = createFrame(worldTime);
      frameCache.set(key, frame);
    }
    return frame;
  };
  const initialFrame = frameAt(WORLD_TIME_INTERVAL.min);
  const finalFrame = frameAt(WORLD_TIME_INTERVAL.max);
  const sourceQuery = createHillAnalyticImpactSupportQuery(
    frameAt,
    initialFrame,
    {
      supportedWorldTime: WORLD_TIME_INTERVAL,
      validationFrames: [initialFrame, finalFrame],
      maximumSpatialLipschitz: MAXIMUM_SPATIAL_LIPSCHITZ,
      maximumSignedDistanceRate: MAXIMUM_SIGNED_DISTANCE_RATE,
    },
  );
  let sampleCount = 0;
  const retainedQuery = Object.freeze({
    identity: sourceQuery.identity,
    maximumSpatialLipschitz: sourceQuery.maximumSpatialLipschitz,
    maximumSignedDistanceRate: sourceQuery.maximumSignedDistanceRate,
    sampleSignedDistance(position, worldTime) {
      sampleCount += 1;
      return sourceQuery.sampleSignedDistance(position, worldTime);
    },
  });

  const packet = {
    packet_id: 'hill-moving-support-impact-a',
    route_identity: 'kaminos/tests/hill-moving-support-consumer-v1',
    artifact_sha256: 'a'.repeat(64),
    simulation_authority: 'live_simulation',
    authority: { simulation_safe: true, stale: false },
    emitters: [{
      id: 'index-finger',
      origin_world: [-2, 3, 0],
      aim_world: [0, -1, 0],
      radius: 0.055,
      strength: 1.4,
      active: true,
      emission_state: 'jet',
      source_flux_particles_per_second: 720,
      active_budget_particles: 720,
      lifetime_seconds: 2,
      residence_distance_world: 3,
    }],
  };
  const economics = planFingerFluidLiveInletEconomics(packet, 2_400);
  const releasePlan = measureFingerFluidLiveInletReleasePlan(packet, 2_400);
  const descriptor = createFingerFluidAnalyticJetDescriptor({
    packet,
    economics,
    releasePlan,
    publication: {
      generation: 7,
      packetId: economics.packetId,
      sourceRoute: economics.sourceRoute,
      artifactSha256: economics.artifactSha256,
    },
    sourceMechanicsRevision: BIG_PAPA_MOVING_SUPPORT_REVISION,
    handId: 'operator-right-hand',
    fingerId: 'index',
    inletId: 'index-finger',
    material: {
      id: 'juice-water-hill-consumer-a',
      density: 998.2,
      chemistry: [0.2, 0.6, 0.1, 0.1],
    },
    sourceTimeInterval: [
      WORLD_TIME_INTERVAL.min,
      WORLD_TIME_INTERVAL.max,
    ],
    gravity: [0, -9.81, 0],
    supportIdentity: retainedQuery.identity,
  });
  const impactOptions = Object.freeze({
    maximumFlightSeconds: 0.45,
    bracketStepSeconds: 1 / 120,
    timeToleranceSeconds: 1e-6,
    sourceEmissionTime: WORLD_TIME_INTERVAL.min,
  });
  const impact = measureFingerFluidAnalyticJetFirstImpact(
    descriptor,
    retainedQuery,
    impactOptions,
  );
  const measureSampleCount = sampleCount;
  const particleCount = 12;
  const transferDuration =
    particleCount / releasePlan.inlets[0].expectedParticleReleaseRate;
  const handoff = createFingerFluidAnalyticImpactHandoffReceipt({
    descriptor,
    impact,
    supportQuery: retainedQuery,
    transitionGeneration: 8,
    transitionInterval: [
      impact.sourceEmissionTime,
      impact.sourceEmissionTime + transferDuration,
    ],
    particleAllocation: {
      allocationId: 'hill-moving-support-pool/generation-8',
      particleIds: Array.from(
        { length: particleCount },
        (_, index) => 8_000 + index,
      ),
      particleVolume: releasePlan.particleVolume,
      velocities: Array.from(
        { length: particleCount },
        () => impact.incomingVelocity,
      ),
      material: descriptor.material,
    },
    expectedParticleCount: particleCount,
  });
  validateFingerFluidAnalyticImpactHandoffReceipt(handoff);
  const remeasurementSampleCount = sampleCount - measureSampleCount;
  if (remeasurementSampleCount <= 1) {
    throw new Error('Big Papa handoff did not remeasure the retained Hill query');
  }
  const directSample = retainedQuery.sampleSignedDistance(
    impact.carrierPosition,
    impact.worldTime,
  );
  assertVectorParity(directSample.point, impact.point, 'direct Hill/impact point');
  assertVectorParity(directSample.normal, impact.normal, 'direct Hill/impact normal');
  assertVectorParity(impact.point, handoff.impact.point, 'impact/handoff point');
  assertVectorParity(impact.normal, handoff.impact.normal, 'impact/handoff normal');

  const falseProviderFailures = {};
  falseProviderFailures.stale_identity = captureFailure(() =>
    measureFingerFluidAnalyticJetFirstImpact(
      descriptor,
      {
        ...retainedQuery,
        identity: { ...identity, stale: true },
      },
      impactOptions,
    ));
  falseProviderFailures.fallback_identity = captureFailure(() =>
    measureFingerFluidAnalyticJetFirstImpact(
      descriptor,
      {
        ...retainedQuery,
        identity: {
          ...identity,
          fallbackRoute: 'lerms/hill-of-hills/default',
        },
      },
      impactOptions,
    ));
  falseProviderFailures.partial_identity = captureFailure(() => {
    const partialIdentity = { ...identity };
    delete partialIdentity.stale;
    return measureFingerFluidAnalyticJetFirstImpact(
      descriptor,
      { ...retainedQuery, identity: partialIdentity },
      impactOptions,
    );
  });

  const shortEndTime = 41.95;
  const shortEndFrame = createFrame(shortEndTime);
  const shortQuery = createHillAnalyticImpactSupportQuery(
    frameAt,
    initialFrame,
    {
      supportedWorldTime: {
        min: WORLD_TIME_INTERVAL.min,
        max: shortEndTime,
      },
      validationFrames: [initialFrame, shortEndFrame],
      maximumSpatialLipschitz: MAXIMUM_SPATIAL_LIPSCHITZ,
      maximumSignedDistanceRate: MAXIMUM_SIGNED_DISTANCE_RATE,
    },
  );
  falseProviderFailures.unsupported_world_time = captureFailure(() =>
    measureFingerFluidAnalyticJetFirstImpact(
      descriptor,
      shortQuery,
      impactOptions,
    ));

  const driftIdentity = Object.freeze({
    ...identity,
    supportEpoch: identity.supportEpoch + 2,
  });
  const driftQuery = createHillAnalyticImpactSupportQuery(
    (worldTime) => (
      worldTime === WORLD_TIME_INTERVAL.min
        ? initialFrame
        : createFrame(worldTime, driftIdentity)
    ),
    initialFrame,
    {
      supportedWorldTime: WORLD_TIME_INTERVAL,
      validationFrames: [initialFrame, finalFrame],
      maximumSpatialLipschitz: MAXIMUM_SPATIAL_LIPSCHITZ,
      maximumSignedDistanceRate: MAXIMUM_SIGNED_DISTANCE_RATE,
    },
  );
  falseProviderFailures.skipped_support_epoch = captureFailure(() =>
    measureFingerFluidAnalyticJetFirstImpact(
      descriptor,
      driftQuery,
      impactOptions,
    ));

  const staleDefaultFrameQuery = createHillAnalyticImpactSupportQuery(
    () => initialFrame,
    initialFrame,
    {
      supportedWorldTime: WORLD_TIME_INTERVAL,
      validationFrames: [initialFrame, finalFrame],
      maximumSpatialLipschitz: MAXIMUM_SPATIAL_LIPSCHITZ,
      maximumSignedDistanceRate: MAXIMUM_SIGNED_DISTANCE_RATE,
    },
  );
  falseProviderFailures.stale_default_frame = captureFailure(() =>
    measureFingerFluidAnalyticJetFirstImpact(
      descriptor,
      staleDefaultFrameQuery,
      impactOptions,
    ));

  falseProviderFailures.understated_spatial_bound = captureFailure(() =>
    createHillAnalyticImpactSupportQuery(
      frameAt,
      initialFrame,
      {
        supportedWorldTime: WORLD_TIME_INTERVAL,
        validationFrames: [initialFrame, finalFrame],
        maximumSpatialLipschitz: 1,
        maximumSignedDistanceRate: MAXIMUM_SIGNED_DISTANCE_RATE,
      },
    ));
  falseProviderFailures.understated_temporal_bound = captureFailure(() =>
    createHillAnalyticImpactSupportQuery(
      frameAt,
      initialFrame,
      {
        supportedWorldTime: WORLD_TIME_INTERVAL,
        validationFrames: [initialFrame, finalFrame],
        maximumSpatialLipschitz: MAXIMUM_SPATIAL_LIPSCHITZ,
        maximumSignedDistanceRate: 0,
      },
    ));

  const identityExactAcrossQueryDescriptorImpactHandoff = [
    retainedQuery.identity,
    descriptor.supportIdentity,
    impact.supportIdentity,
    handoff.supportIdentity,
  ].every((candidate) => sameRecord(identity, candidate));
  if (!identityExactAcrossQueryDescriptorImpactHandoff) {
    throw new Error('support identity drifted across query, descriptor, impact, or handoff');
  }

  return Object.freeze({
    schema: HILL_MOVING_SUPPORT_CONSUMER_SCHEMA,
    status: 'passed',
    requested: Object.freeze({
      hillPackageCoordinate: HILL_SUPPORT_PACKAGE_COORDINATE,
      hillPackageSourceRevision: packageReport.requested.sourceRevision,
      hillPackageArtifactSha256: packageReport.artifact.sha256,
      bigPapaRevision: BIG_PAPA_MOVING_SUPPORT_REVISION,
      fallbackRoute: null,
    }),
    effective: Object.freeze({
      hillPackageCoordinate: HILL_SUPPORT_PACKAGE_COORDINATE,
      hillPackageSourceRevision: exactRevision(
        packageReport.requested.sourceRevision,
        'effective Hill package source revision',
      ),
      hillPackageArtifactSha256: exactDigest(
        packageReport.artifact.sha256,
        'effective Hill package artifact',
      ),
      bigPapaRevision: BIG_PAPA_MOVING_SUPPORT_REVISION,
      supportProviderRoute: retainedQuery.identity.providerRoute,
      fallbackRoute: null,
    }),
    retainedQuery: Object.freeze({
      sameObjectAcrossMeasureAndCreate: true,
      measureSampleCount,
      remeasurementSampleCount,
      totalSampleCount: sampleCount,
      exactFrameCacheEntries: frameCache.size,
    }),
    interval: sourceQuery.supportedWorldTime,
    bounds: impact.stepping,
    impact: Object.freeze({
      worldTime: impact.worldTime,
      flightSeconds: impact.flightSeconds,
      signedDistance: impact.signedDistance,
      resolution: impact.stepping.resolution,
    }),
    parity: Object.freeze({
      directHillPoint: directSample.point,
      directHillNormal: directSample.normal,
      bigPapaImpactPoint: impact.point,
      bigPapaImpactNormal: impact.normal,
      bigPapaHandoffPoint: handoff.impact.point,
      bigPapaHandoffNormal: handoff.impact.normal,
      identityExactAcrossQueryDescriptorImpactHandoff,
    }),
    handoff: Object.freeze({
      schema: handoff.schema,
      receiptId: handoff.receiptId,
      state: handoff.state,
      conservationValid: handoff.conservation.valid,
      carrierOwnsTransferredInterval:
        handoff.ownership.carrierOwnsTransferredInterval,
      particlesOwnTransferredInterval:
        handoff.ownership.particlesOwnTransferredInterval,
    }),
    falseProviderFailures: Object.freeze(falseProviderFailures),
  });
}

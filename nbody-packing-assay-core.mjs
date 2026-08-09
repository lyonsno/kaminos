import {
  MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
  hashMusclePackingCanonicalJson,
  measureMuscleCompartmentPacking,
} from './muscle-compartment-packing-core.mjs';

export const NBODY_PACKING_ASSAY_FIXTURE_SCHEMA =
  'kaminos.nbody-packing-assay-fixture.v0';
export const NBODY_PACKING_ASSAY_RESULT_SCHEMA =
  'kaminos.nbody-packing-counterfeit-assay-result.v0';

const MEMBER_ORDER = Object.freeze([
  'rosette-west',
  'rosette-center',
  'rosette-east',
  'rosette-north',
  'rosette-south',
]);
const PRESSURE_CHAIN = Object.freeze([
  'rosette-west',
  'rosette-center',
  'rosette-east',
]);
const BELT_KNOT_INDICES = Object.freeze([2, 3]);
const REQUIRED_COUNTERFEIT_CONFIG_KEYS = Object.freeze([
  'centerTranslation',
  'envelope',
  'pressureChain',
  'selectedPair',
  'update',
]);
const DEFAULT_COUNTERFEIT_CONFIG = Object.freeze({
  update:'selected-pair-center-translation',
  selectedPair:['rosette-west', 'rosette-center'],
  pressureChain:[...PRESSURE_CHAIN],
  centerTranslation:[0.08, 0, 0],
  envelope:'sine-zero-at-attachments',
});

function rounded(value, digits = 12) {
  const result = Number(value.toFixed(digits));
  return Object.is(result, -0) ? 0 : result;
}

function distance(left, right) {
  return Math.hypot(...left.map((value, axis) => value - right[axis]));
}

function carrierVolume(centerline) {
  let volume = 0;
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const left = centerline[index];
    const right = centerline[index + 1];
    const segmentLength = distance(left.position, right.position);
    volume += Math.PI * segmentLength / 3 * (
      left.radius ** 2 + left.radius * right.radius + right.radius ** 2
    );
  }
  return volume;
}

function restoreTargetVolume(muscle) {
  const realizedVolume = carrierVolume(muscle.centerline);
  if (!(realizedVolume > 0) || !(muscle.targetVolume > 0)) {
    throw new Error(`cannot restore nonpositive volume for ${muscle.id}`);
  }
  const radiusScale = Math.sqrt(muscle.targetVolume / realizedVolume);
  for (const knot of muscle.centerline) knot.radius *= radiusScale;
  return radiusScale;
}

function sourceWithIdentity(core) {
  const sha256 = hashMusclePackingCanonicalJson(core);
  const identity = { kind:'synthetic-fixture', id:core.id, sha256 };
  return {
    ...core,
    input: {
      requested:{ ...identity },
      effective:{ ...identity },
    },
  };
}

function createRosetteMuscle(id, crossSection, radii) {
  const yPositions = [-1.15, -0.75, -0.28, 0.28, 0.75, 1.15];
  const centerline = yPositions.map((y, index) => ({
    position:[crossSection[0], y, crossSection[1]],
    radius:radii[index],
  }));
  return {
    id,
    identity: {
      sourceId:`synthetic-known-feasible:${id}`,
      constructionId:`nbody-rosette:${id}`,
      lineageId:`nbody-rosette-lineage:${id}`,
      instanceId:`nbody-rosette-instance:${id}`,
    },
    authority: {
      kind:'synthetic-proxy',
      anatomicalAdmission:'none',
    },
    attachments: {
      origin: {
        id:`${id}:origin`,
        sourceAuthority:'synthetic-known-feasible',
        position:[...centerline[0].position],
      },
      insertion: {
        id:`${id}:insertion`,
        sourceAuthority:'synthetic-known-feasible',
        position:[...centerline.at(-1).position],
      },
    },
    centerline,
    targetVolume:carrierVolume(centerline),
    volumeAuthority:'synthetic-known-feasible-target',
  };
}

function createKnownFeasibleSource() {
  const centralRadii = [0.08, 0.105, 0.125, 0.125, 0.105, 0.08];
  const neighborRadii = [0.11, 0.2, 0.275, 0.275, 0.2, 0.11];
  return sourceWithIdentity({
    schema:MUSCLE_COMPARTMENT_PACKING_SOURCE_SCHEMA,
    id:'synthetic-known-feasible-five-body-rosette-v0',
    authority: {
      kind:'synthetic-proxy',
      anatomicalAdmission:'none',
    },
    dimension:3,
    formation: {
      centerlineSmoothingReference:'source-displacement',
    },
    compartment: {
      id:'asymmetric-rosette-compartment',
      kind:'box',
      minimum:[-0.78, -1.3, -0.78],
      maximum:[0.78, 1.3, 0.78],
      clearance:0.02,
    },
    obstacles:[{
      id:'rosette-bone-obstacle',
      kind:'capsule',
      start:[-0.68, -1.1, -0.38],
      end:[-0.68, 1.1, -0.38],
      radius:0.16,
      clearance:0.02,
      authority:'synthetic-known-feasible',
    }],
    muscles:[
      createRosetteMuscle('rosette-west', [-0.42, 0], neighborRadii),
      createRosetteMuscle('rosette-center', [0, 0], centralRadii),
      createRosetteMuscle('rosette-east', [0.42, 0], neighborRadii),
      createRosetteMuscle('rosette-north', [0, 0.42], neighborRadii),
      createRosetteMuscle('rosette-south', [0, -0.42], neighborRadii),
    ],
  });
}

function translateMuscleBelly(muscle, translation) {
  const lastIndex = muscle.centerline.length - 1;
  for (let index = 1; index < lastIndex; index += 1) {
    const envelope = Math.sin(Math.PI * index / lastIndex);
    muscle.centerline[index].position = muscle.centerline[index].position.map(
      (value, axis) => value + translation[axis] * envelope,
    );
  }
  return restoreTargetVolume(muscle);
}

function deriveCrowdedSource(knownFeasible) {
  const core = structuredClone(knownFeasible);
  delete core.input;
  core.id = 'synthetic-crowded-five-body-rosette-v0';
  core.derivation = {
    schema:'kaminos.nbody-rosette-crowding-continuation.v0',
    parent:structuredClone(knownFeasible.input.effective),
    driverMuscleId:'rosette-west',
    requestedTranslation:[0.12, 0, 0],
    effectiveTranslation:[0.12, 0, 0],
    envelope:'sine-zero-at-attachments',
    fallbackUsed:false,
  };
  const driver = core.muscles.find(muscle => muscle.id === core.derivation.driverMuscleId);
  core.derivation.radiusScale = rounded(
    translateMuscleBelly(driver, core.derivation.effectiveTranslation),
  );
  return sourceWithIdentity(core);
}

function beltPairRows(muscles) {
  const byId = new Map(muscles.map(muscle => [muscle.id, muscle]));
  const pairs = [];
  for (let leftIndex = 0; leftIndex < MEMBER_ORDER.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < MEMBER_ORDER.length; rightIndex += 1) {
      const leftId = MEMBER_ORDER[leftIndex];
      const rightId = MEMBER_ORDER[rightIndex];
      const left = byId.get(leftId);
      const right = byId.get(rightId);
      if (!left || !right) throw new Error(`rosette state missing member ${leftId} or ${rightId}`);
      const knotRows = BELT_KNOT_INDICES.map(knotIndex => {
        const leftKnot = left.centerline[knotIndex];
        const rightKnot = right.centerline[knotIndex];
        const signedGap = distance(leftKnot.position, rightKnot.position) -
          leftKnot.radius - rightKnot.radius;
        return {
          knotIndex,
          signedGap:rounded(signedGap),
          penetration:rounded(Math.max(0, -signedGap)),
        };
      });
      const controlling = knotRows.reduce((worst, row) =>
        row.signedGap < worst.signedGap ? row : worst);
      pairs.push({
        key:`${leftId}|${rightId}`,
        members:[leftId, rightId],
        signedGap:controlling.signedGap,
        penetration:controlling.penetration,
        controllingKnotIndex:controlling.knotIndex,
      });
    }
  }
  return pairs;
}

function measureBelt(muscles, contactGraph) {
  const pairs = beltPairRows(muscles);
  const byPair = Object.fromEntries(pairs.map(pair => [pair.key, structuredClone(pair)]));
  const declaredGaps = contactGraph.edges.map(edge => {
    const row = byPair[edge.key];
    if (!row) throw new Error(`contact graph edge has no belt row: ${edge.key}`);
    return row.signedGap;
  });
  return {
    sample:'paired-carrier-knots-2-and-3',
    pairs,
    byPair,
    totalPenetration:rounded(pairs.reduce((sum, pair) => sum + pair.penetration, 0)),
    maximumPenetration:rounded(Math.max(...pairs.map(pair => pair.penetration))),
    minimumDeclaredContactGap:rounded(Math.min(...declaredGaps)),
  };
}

function fixtureCoreWithoutIdentity(fixture) {
  const core = structuredClone(fixture);
  delete core.identity;
  delete core.input;
  return core;
}

function requireMatchingFixtureReceipt(label, recorded, effective) {
  if (JSON.stringify(recorded) !== JSON.stringify(effective)) {
    throw new Error(`N-body fixture ${label} receipt does not match recomputed geometry`);
  }
}

function requireKnownFeasibleState(metrics) {
  const tolerance = 1e-9;
  const residuals = [
    'pairwisePenetration',
    'skeletalPenetration',
    'compartmentEscape',
    'endpointDrift',
    'maximumRelativeVolumeError',
  ];
  const inadmissibleResiduals = residuals.filter(
    key => !Number.isFinite(metrics[key]) || metrics[key] > tolerance,
  );
  if (
    inadmissibleResiduals.length > 0 ||
    metrics.nonFiniteValueCount !== 0 ||
    metrics.nonPositiveRadiusCount !== 0
  ) {
    throw new Error(
      'N-body fixture known-feasible state is physically inadmissible: ' +
      `${inadmissibleResiduals.join(', ') || 'invalid carrier samples'}`,
    );
  }
}

export function validateNBodyPackingAssayFixture(fixture) {
  if (fixture?.schema !== NBODY_PACKING_ASSAY_FIXTURE_SCHEMA) {
    throw new Error(`N-body fixture schema mismatch: ${fixture?.schema || 'missing'}`);
  }
  const effectiveHash = hashMusclePackingCanonicalJson(fixtureCoreWithoutIdentity(fixture));
  if (
    fixture.identity?.sha256 !== effectiveHash ||
    fixture.input?.requested?.sha256 !== effectiveHash ||
    fixture.input?.effective?.sha256 !== effectiveHash ||
    fixture.input?.requested?.id !== fixture.id ||
    fixture.input?.effective?.id !== fixture.id
  ) {
    throw new Error(
      `N-body fixture identity mismatch: recorded ${fixture.identity?.sha256 || 'missing'}, ` +
      `effective ${effectiveHash}`,
    );
  }
  if (JSON.stringify(fixture.input.requested) !== JSON.stringify(fixture.input.effective)) {
    throw new Error('N-body fixture requested/effective identity mismatch');
  }
  const knownFeasibleMetrics = measureMuscleCompartmentPacking(fixture.knownFeasible);
  const crowdedMetrics = measureMuscleCompartmentPacking(fixture.crowded);
  const knownFeasibleBelt = measureBelt(
    fixture.knownFeasible.muscles,
    fixture.contactGraph,
  );
  const crowdedBelt = measureBelt(fixture.crowded.muscles, fixture.contactGraph);
  requireKnownFeasibleState(knownFeasibleMetrics);
  requireMatchingFixtureReceipt(
    'known-feasible metrics',
    fixture.metrics?.knownFeasible,
    knownFeasibleMetrics,
  );
  requireMatchingFixtureReceipt(
    'known-feasible belt',
    fixture.metrics?.knownFeasibleBelt,
    knownFeasibleBelt,
  );
  requireMatchingFixtureReceipt('crowded metrics', fixture.metrics?.crowded, crowdedMetrics);
  requireMatchingFixtureReceipt('crowded belt', fixture.metrics?.crowdedBelt, crowdedBelt);
}

export function createNBodyRosetteFixture() {
  const knownFeasible = createKnownFeasibleSource();
  const crowded = deriveCrowdedSource(knownFeasible);
  const contactGraph = {
    schema:'kaminos.nbody-contact-graph.v0',
    members:[...MEMBER_ORDER],
    edges:[
      { key:'rosette-west|rosette-center', members:['rosette-west', 'rosette-center'] },
      { key:'rosette-center|rosette-east', members:['rosette-center', 'rosette-east'] },
      { key:'rosette-center|rosette-north', members:['rosette-center', 'rosette-north'] },
      { key:'rosette-center|rosette-south', members:['rosette-center', 'rosette-south'] },
      { key:'rosette-west|rosette-north', members:['rosette-west', 'rosette-north'] },
      { key:'rosette-east|rosette-north', members:['rosette-east', 'rosette-north'] },
      { key:'rosette-east|rosette-south', members:['rosette-east', 'rosette-south'] },
      { key:'rosette-west|rosette-south', members:['rosette-west', 'rosette-south'] },
    ],
    requiredCycle:[
      'rosette-west',
      'rosette-north',
      'rosette-east',
      'rosette-south',
    ],
    proximityThreshold:0.06,
  };
  const core = {
    schema:NBODY_PACKING_ASSAY_FIXTURE_SCHEMA,
    id:'nbody-known-feasible-five-body-rosette-assay-v0',
    authority: {
      kind:'synthetic-known-feasible',
      anatomicalAdmission:'none',
      claimCeiling:'assay-discrimination-only',
    },
    dimension:3,
    pressureChain:[...PRESSURE_CHAIN],
    contactGraph,
    knownFeasible,
    crowded,
    metrics: {
      knownFeasible:measureMuscleCompartmentPacking(knownFeasible),
      knownFeasibleBelt:measureBelt(knownFeasible.muscles, contactGraph),
      crowded:measureMuscleCompartmentPacking(crowded),
      crowdedBelt:measureBelt(crowded.muscles, contactGraph),
    },
    derivation: {
      kind:'known-feasible-witness-then-deterministic-crowding',
      fallbackUsed:false,
    },
  };
  const sha256 = hashMusclePackingCanonicalJson(core);
  const identity = { kind:'synthetic-nbody-assay-fixture', id:core.id, sha256 };
  return {
    ...core,
    identity:{ sha256 },
    input: {
      requested:{ ...identity },
      effective:{ ...identity },
    },
  };
}

function validateCounterfeitConfig(config) {
  const keys = Object.keys(config || {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...REQUIRED_COUNTERFEIT_CONFIG_KEYS])) {
    throw new Error(
      `counterfeit config requires exact keys: ${REQUIRED_COUNTERFEIT_CONFIG_KEYS.join(', ')}`,
    );
  }
  if (config.update !== 'selected-pair-center-translation') {
    throw new Error('counterfeit update must be selected-pair-center-translation');
  }
  if (config.envelope !== 'sine-zero-at-attachments') {
    throw new Error('counterfeit envelope must be sine-zero-at-attachments');
  }
  if (JSON.stringify(config.pressureChain) !== JSON.stringify(PRESSURE_CHAIN)) {
    throw new Error('counterfeit pressureChain must match the exact rosette pressure chain');
  }
  if (JSON.stringify(config.selectedPair) !== JSON.stringify(PRESSURE_CHAIN.slice(0, 2))) {
    throw new Error('counterfeit selectedPair must be the first pressure-chain edge');
  }
  if (
    !Array.isArray(config.centerTranslation) ||
    config.centerTranslation.length !== 3 ||
    !config.centerTranslation.every(Number.isFinite) ||
    Math.hypot(...config.centerTranslation) <= 0
  ) {
    throw new Error('counterfeit centerTranslation must be a nonzero finite 3D vector');
  }
}

function stateRecord(id, source, muscles, contactGraph) {
  return {
    id,
    sourceId:source.id,
    muscles:structuredClone(muscles),
    metrics:measureMuscleCompartmentPacking(source, muscles),
    belt:measureBelt(muscles, contactGraph),
  };
}

export function runNBodyRosetteCounterfeitAssay({
  fixture = createNBodyRosetteFixture(),
  requestedConfig = structuredClone(DEFAULT_COUNTERFEIT_CONFIG),
} = {}) {
  validateNBodyPackingAssayFixture(fixture);
  validateCounterfeitConfig(requestedConfig);
  const effectiveConfig = structuredClone(requestedConfig);
  const counterfeitMuscles = structuredClone(fixture.crowded.muscles);
  const movedMuscle = counterfeitMuscles.find(
    muscle => muscle.id === effectiveConfig.selectedPair[1],
  );
  const radiusScale = rounded(
    translateMuscleBelly(movedMuscle, effectiveConfig.centerTranslation),
  );

  const states = {
    knownFeasible:stateRecord(
      'known-feasible',
      fixture.knownFeasible,
      fixture.knownFeasible.muscles,
      fixture.contactGraph,
    ),
    crowded:stateRecord(
      'crowded',
      fixture.crowded,
      fixture.crowded.muscles,
      fixture.contactGraph,
    ),
    sequentialCounterfeit:stateRecord(
      'sequential-counterfeit',
      fixture.crowded,
      counterfeitMuscles,
      fixture.contactGraph,
    ),
  };
  const selectedPairKey = effectiveConfig.selectedPair.join('|');
  const distalMembers = effectiveConfig.pressureChain.slice(1);
  const distalPairKey = distalMembers.join('|');
  const selectedBefore = states.crowded.belt.byPair[selectedPairKey].penetration;
  const selectedAfter = states.sequentialCounterfeit.belt.byPair[selectedPairKey].penetration;
  const distalBefore = states.crowded.belt.byPair[distalPairKey].penetration;
  const distalAfter = states.sequentialCounterfeit.belt.byPair[distalPairKey].penetration;
  const selectedPair = {
    members:[...effectiveConfig.selectedPair],
    beforePenetration:selectedBefore,
    afterPenetration:selectedAfter,
    improvement:rounded(selectedBefore - selectedAfter),
  };
  const exportedDebt = {
    members:distalMembers,
    beforePenetration:distalBefore,
    afterPenetration:distalAfter,
    increase:rounded(distalAfter - distalBefore),
  };
  const globalMetrics = states.sequentialCounterfeit.metrics;
  const admission = {
    localSelectedPairImproved:selectedPair.improvement > 0,
    aggregatePenetrationImproved:
      globalMetrics.pairwisePenetration < states.crowded.metrics.pairwisePenetration,
    distalDebtExported:exportedDebt.increase > 0,
    globallyAdmissible:
      globalMetrics.pairwisePenetration <= 1e-9 &&
      globalMetrics.skeletalPenetration <= 1e-9 &&
      globalMetrics.compartmentEscape <= 1e-9 &&
      globalMetrics.endpointDrift <= 1e-9 &&
      globalMetrics.maximumRelativeVolumeError <= 1e-9,
    rejectionReasons:[],
  };
  if (globalMetrics.pairwisePenetration > 1e-9) {
    admission.rejectionReasons.push('remaining-global-pairwise-penetration');
  }
  if (admission.distalDebtExported) {
    admission.rejectionReasons.push('distal-pressure-debt-exported');
  }
  const core = {
    schema:NBODY_PACKING_ASSAY_RESULT_SCHEMA,
    fixtureId:fixture.id,
    fixtureSchema:fixture.schema,
    input:structuredClone(fixture.input),
    config: {
      requested:structuredClone(requestedConfig),
      effective:effectiveConfig,
      fallbackUsed:false,
    },
    states,
    counterfeit: {
      kind:'deliberate-local-authority-counterfeit',
      selectedPair,
      exportedDebt,
      movedMuscleId:movedMuscle.id,
      radiusScale,
      pressureChain:[...effectiveConfig.pressureChain],
      claim:'local-and-aggregate-improvement-do-not-establish-global-closure',
    },
    admission,
    status:admission.globallyAdmissible
      ? 'counterfeit-unexpectedly-admissible'
      : 'counterfeit-rejected-global-debt',
  };
  return {
    ...core,
    identity: {
      sha256:hashMusclePackingCanonicalJson(core),
    },
  };
}

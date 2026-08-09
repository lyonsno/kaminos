import {
  hashMusclePackingCanonicalJson,
  measureMuscleCompartmentPacking,
} from './muscle-compartment-packing-core.mjs';
import {
  NBODY_PACKING_ASSAY_FIXTURE_SCHEMA,
  validateNBodyPackingAssayFixture,
} from './nbody-packing-assay-core.mjs';

export const NBODY_PACKING_SPARSE_GRAPH_PROBLEM_SCHEMA =
  'kaminos.nbody-packing-sparse-graph-problem.v0';
export const NBODY_PACKING_SPARSE_GRAPH_RESULT_SCHEMA =
  'kaminos.nbody-packing-sparse-graph-result.v0';

const ALGORITHM = 'synchronous-sparse-global-contact-projection-v0';
const TRANSLATION_BASIS = 'per-member-xz-sine-zero-at-attachments';
const CONFIG_KEYS = Object.freeze([
  'algorithm',
  'candidateEnumeration',
  'contactActivationMargin',
  'convergenceTolerance',
  'finiteDifferenceStep',
  'iterationBudget',
  'lineSearch',
  'projectionRelaxation',
  'translationBasis',
  'translationBounds',
]);

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
  const realized = carrierVolume(muscle.centerline);
  if (!(realized > 0) || !(muscle.targetVolume > 0)) {
    throw new Error(`sparse graph cannot restore nonpositive volume for ${muscle.id}`);
  }
  const scale = Math.sqrt(muscle.targetVolume / realized);
  for (const knot of muscle.centerline) knot.radius *= scale;
}

function validateRequestedConfig(requestedConfig) {
  if (!requestedConfig || Object.keys(requestedConfig).length === 0) {
    throw new Error('sparse graph requestedConfig must be an exact explicit contract');
  }
  if (JSON.stringify(Object.keys(requestedConfig).sort()) !== JSON.stringify(CONFIG_KEYS)) {
    throw new Error(`sparse graph requestedConfig requires exact keys: ${CONFIG_KEYS.join(', ')}`);
  }
  if (requestedConfig.algorithm !== ALGORITHM) {
    throw new Error(`sparse graph algorithm must be ${ALGORITHM}`);
  }
  if (requestedConfig.translationBasis !== TRANSLATION_BASIS) {
    throw new Error(`sparse graph translationBasis must be ${TRANSLATION_BASIS}`);
  }
  if (!['canonical', 'reverse'].includes(requestedConfig.candidateEnumeration)) {
    throw new Error('sparse graph candidateEnumeration must be canonical or reverse');
  }
  for (const key of [
    'contactActivationMargin',
    'convergenceTolerance',
    'finiteDifferenceStep',
    'projectionRelaxation',
  ]) {
    if (!Number.isFinite(requestedConfig[key]) || requestedConfig[key] <= 0) {
      throw new Error(`sparse graph ${key} must be positive and finite`);
    }
  }
  if (requestedConfig.projectionRelaxation > 1) {
    throw new Error('sparse graph projectionRelaxation cannot exceed one');
  }
  if (!Number.isInteger(requestedConfig.iterationBudget) || requestedConfig.iterationBudget <= 0) {
    throw new Error('sparse graph iterationBudget must be a positive integer');
  }
  if (
    !Array.isArray(requestedConfig.lineSearch) ||
    requestedConfig.lineSearch.length === 0 ||
    requestedConfig.lineSearch.some(value => !Number.isFinite(value) || value <= 0 || value > 1) ||
    requestedConfig.lineSearch.some(
      (value, index) => index > 0 && value >= requestedConfig.lineSearch[index - 1],
    )
  ) {
    throw new Error('sparse graph lineSearch must be a strictly decreasing positive array at most one');
  }
  if (
    !Array.isArray(requestedConfig.translationBounds) ||
    requestedConfig.translationBounds.length !== 2 ||
    !requestedConfig.translationBounds.every(Number.isFinite) ||
    requestedConfig.translationBounds[0] >= requestedConfig.translationBounds[1]
  ) {
    throw new Error('sparse graph translationBounds must be an ordered finite pair');
  }
}

function validateProblem(problem) {
  if (problem?.schema !== NBODY_PACKING_SPARSE_GRAPH_PROBLEM_SCHEMA) {
    throw new Error(`sparse graph problem schema mismatch: ${problem?.schema || 'missing'}`);
  }
  const core = structuredClone(problem);
  delete core.identity;
  if (problem.identity?.sha256 !== hashMusclePackingCanonicalJson(core)) {
    throw new Error('sparse graph problem identity mismatch');
  }
  if (!Array.isArray(problem.members) || problem.members.length < 2) {
    throw new Error('sparse graph problem requires at least two members');
  }
  const memberIds = problem.members.map(member => member.id);
  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error('sparse graph problem member ids must be unique');
  }
  if (!problem.graph?.edges?.length) throw new Error('sparse graph problem requires contact edges');
  for (const edge of problem.graph.edges) {
    if (
      !Array.isArray(edge.members) ||
      edge.members.length !== 2 ||
      edge.members.some(id => !memberIds.includes(id))
    ) {
      throw new Error(`sparse graph edge membership is invalid: ${edge?.key || 'missing'}`);
    }
  }
}

function instantiateState(problem, vector) {
  if (!Array.isArray(vector) || vector.length !== problem.variables.length) {
    throw new Error(`sparse graph vector must contain ${problem.variables.length} values`);
  }
  const muscles = structuredClone(problem.members);
  for (const [memberIndex, muscle] of muscles.entries()) {
    const translationX = vector[memberIndex * 2];
    const translationZ = vector[memberIndex * 2 + 1];
    const finalIndex = muscle.centerline.length - 1;
    for (let knotIndex = 1; knotIndex < finalIndex; knotIndex += 1) {
      const envelope = Math.sin(Math.PI * knotIndex / finalIndex);
      muscle.centerline[knotIndex].position[0] += translationX * envelope;
      muscle.centerline[knotIndex].position[2] += translationZ * envelope;
    }
    restoreTargetVolume(muscle);
  }
  return muscles;
}

function rawGraphRows(problem, muscles) {
  const byId = new Map(muscles.map(muscle => [muscle.id, muscle]));
  return problem.graph.edges.map(edge => {
    const left = byId.get(edge.members[0]);
    const right = byId.get(edge.members[1]);
    const samples = [2, 3].map(knotIndex => {
      const leftKnot = left.centerline[knotIndex];
      const rightKnot = right.centerline[knotIndex];
      const signedGap = distance(leftKnot.position, rightKnot.position) -
        leftKnot.radius - rightKnot.radius;
      return { knotIndex, signedGap };
    });
    const controlling = samples.reduce((minimum, sample) =>
      sample.signedGap < minimum.signedGap ? sample : minimum);
    return {
      key:edge.key,
      members:[...edge.members],
      signedGap:controlling.signedGap,
      penetration:Math.max(0, -controlling.signedGap),
      controllingKnotIndex:controlling.knotIndex,
    };
  });
}

function beltReceipt(problem, muscles) {
  const pairs = rawGraphRows(problem, muscles).map(row => ({
    ...row,
    signedGap:rounded(row.signedGap),
    penetration:rounded(row.penetration),
  }));
  return {
    sample:'declared-contact-graph-carrier-knots-2-and-3',
    pairs,
    byPair:Object.fromEntries(pairs.map(pair => [pair.key, structuredClone(pair)])),
    totalPenetration:rounded(pairs.reduce((sum, pair) => sum + pair.penetration, 0)),
    maximumPenetration:rounded(Math.max(0, ...pairs.map(pair => pair.penetration))),
  };
}

function maximumPhysicalResidual(metrics, belt) {
  return Math.max(
    metrics.pairwisePenetration,
    belt.maximumPenetration,
    metrics.skeletalPenetration,
    metrics.compartmentEscape,
    metrics.endpointDrift,
    metrics.maximumRelativeVolumeError,
  );
}

function deformationEnergy(vector) {
  return rounded(vector.reduce((sum, value) => sum + 0.5 * value ** 2, 0), 15);
}

function measureSnapshot(problem, vector) {
  const muscles = instantiateState(problem, vector);
  const metrics = measureMuscleCompartmentPacking(problem.crowdedSource, muscles);
  const belt = beltReceipt(problem, muscles);
  return {
    vector:[...vector],
    muscles,
    metrics,
    belt,
    deformationEnergy:deformationEnergy(vector),
    maximumPhysicalResidual:maximumPhysicalResidual(metrics, belt),
  };
}

function compareSnapshots(left, right) {
  const residual = left.maximumPhysicalResidual - right.maximumPhysicalResidual;
  if (Math.abs(residual) > 1e-15) return residual;
  const total = left.metrics.pairwisePenetration - right.metrics.pairwisePenetration;
  if (Math.abs(total) > 1e-15) return total;
  const graphTotal = left.belt.totalPenetration - right.belt.totalPenetration;
  if (Math.abs(graphTotal) > 1e-15) return graphTotal;
  const energy = left.deformationEnergy - right.deformationEnergy;
  if (Math.abs(energy) > 1e-15) return energy;
  return hashMusclePackingCanonicalJson(left.vector)
    .localeCompare(hashMusclePackingCanonicalJson(right.vector));
}

function finiteDifferenceEdgeGradient(problem, vector, edge, step) {
  const memberIndex = new Map(problem.members.map((member, index) => [member.id, index]));
  const axes = edge.members.flatMap(id => {
    const index = memberIndex.get(id);
    return [index * 2, index * 2 + 1];
  });
  const gradient = Array(vector.length).fill(0);
  for (const axis of axes) {
    const positive = [...vector];
    const negative = [...vector];
    positive[axis] += step;
    negative[axis] -= step;
    const positiveRow = rawGraphRows(problem, instantiateState(problem, positive))
      .find(row => row.key === edge.key);
    const negativeRow = rawGraphRows(problem, instantiateState(problem, negative))
      .find(row => row.key === edge.key);
    gradient[axis] = (positiveRow.signedGap - negativeRow.signedGap) / (2 * step);
  }
  return gradient;
}

function clampVector(vector, bounds) {
  return vector.map(value => rounded(Math.max(bounds[0], Math.min(bounds[1], value)), 15));
}

function displacementReceipt(problem, muscles) {
  const sourceById = new Map(problem.members.map(member => [member.id, member]));
  const rows = muscles.map(muscle => {
    const source = sourceById.get(muscle.id);
    let maximum = 0;
    let squared = 0;
    for (let index = 0; index < muscle.centerline.length; index += 1) {
      const value = distance(
        muscle.centerline[index].position,
        source.centerline[index].position,
      );
      maximum = Math.max(maximum, value);
      squared += value ** 2;
    }
    return {
      memberId:muscle.id,
      maximumDisplacement:rounded(maximum),
      rootMeanSquareDisplacement:rounded(Math.sqrt(squared / muscle.centerline.length)),
    };
  });
  return {
    rows,
    movedMemberCount:rows.filter(row => row.maximumDisplacement > 1e-8).length,
    maximumDisplacement:rounded(Math.max(...rows.map(row => row.maximumDisplacement))),
  };
}

export function createNBodySparseGraphConfig() {
  return {
    algorithm:ALGORITHM,
    candidateEnumeration:'canonical',
    contactActivationMargin:0.02,
    convergenceTolerance:1e-7,
    finiteDifferenceStep:1e-6,
    iterationBudget:4096,
    lineSearch:[1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625],
    projectionRelaxation:0.9,
    translationBasis:TRANSLATION_BASIS,
    translationBounds:[-0.3, 0.3],
  };
}

export function compileNBodySparseGraphProblem(fixture) {
  if (fixture?.schema !== NBODY_PACKING_ASSAY_FIXTURE_SCHEMA) {
    throw new Error(`sparse graph fixture schema mismatch: ${fixture?.schema || 'missing'}`);
  }
  validateNBodyPackingAssayFixture(fixture);
  if (
    !fixture.identity?.sha256 ||
    fixture.input?.requested?.sha256 !== fixture.identity.sha256 ||
    fixture.input?.effective?.sha256 !== fixture.identity.sha256
  ) {
    throw new Error('sparse graph fixture identity mismatch');
  }
  const crowdedMetrics = measureMuscleCompartmentPacking(fixture.crowded);
  if (hashMusclePackingCanonicalJson(crowdedMetrics) !==
      hashMusclePackingCanonicalJson(fixture.metrics?.crowded)) {
    throw new Error('sparse graph fixture crowded metrics receipt mismatch');
  }
  const members = structuredClone(fixture.crowded.muscles);
  const memberIds = new Set(members.map(member => member.id));
  const edges = fixture.contactGraph.edges.map(edge => {
    const edgeMembers = [...edge.members].sort();
    if (edgeMembers.some(id => !memberIds.has(id))) {
      throw new Error(`sparse graph fixture edge references unknown member: ${edge.key}`);
    }
    return { key:edgeMembers.join('|'), members:edgeMembers };
  }).sort((left, right) => left.key.localeCompare(right.key));
  if (new Set(edges.map(edge => edge.key)).size !== edges.length) {
    throw new Error('sparse graph fixture contains duplicate contact edges');
  }
  const degree = Object.fromEntries(members.map(member => [member.id, 0]));
  for (const edge of edges) for (const id of edge.members) degree[id] += 1;
  const variables = members.flatMap((member, memberIndex) => [
    { index:memberIndex * 2, memberId:member.id, axis:'x' },
    { index:memberIndex * 2 + 1, memberId:member.id, axis:'z' },
  ]);
  const core = {
    schema:NBODY_PACKING_SPARSE_GRAPH_PROBLEM_SCHEMA,
    source: {
      fixtureSha256:fixture.identity.sha256,
      crowdedStateSha256:fixture.crowded.identity?.sha256 ||
        hashMusclePackingCanonicalJson(fixture.crowded),
      contactGraphSchema:fixture.contactGraph.schema,
    },
    crowdedSource:structuredClone(fixture.crowded),
    members,
    variables,
    graph: {
      schema:fixture.contactGraph.schema,
      edges,
      edgeCount:edges.length,
      degree,
      maximumDegree:Math.max(...Object.values(degree)),
      requiredCycle:structuredClone(fixture.contactGraph.requiredCycle),
      proximityThreshold:fixture.contactGraph.proximityThreshold,
    },
    carrier: {
      translationBasis:TRANSLATION_BASIS,
      degreesOfFreedomPerMember:2,
      attachmentDisplacement:'exact-zero',
      volumePolicy:'restore-exact-target-after-every-state-instantiation',
    },
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

function solveSingleTraversal({ problem, requestedConfig }) {
  validateProblem(problem);
  validateRequestedConfig(requestedConfig);
  const config = structuredClone(requestedConfig);
  let vector = Array(problem.variables.length).fill(0);
  let current = measureSnapshot(problem, vector);
  let snapshots = 1;
  let constraintLinearizations = 0;
  let candidateEvaluations = 0;
  let status = null;
  let failure = null;
  const iterations = [];

  for (let iteration = 1; iteration <= config.iterationBudget; iteration += 1) {
    if (current.maximumPhysicalResidual <= config.convergenceTolerance) {
      status = 'converged-sparse-global-candidate';
      break;
    }
    let activeRows = rawGraphRows(problem, current.muscles)
      .filter(row => row.signedGap < config.contactActivationMargin);
    if (config.candidateEnumeration === 'reverse') activeRows.reverse();
    const contributions = [];
    for (const row of activeRows) {
      if (row.signedGap >= 0) continue;
      const edge = problem.graph.edges.find(candidate => candidate.key === row.key);
      const gradient = finiteDifferenceEdgeGradient(
        problem,
        vector,
        edge,
        config.finiteDifferenceStep,
      );
      constraintLinearizations += 1;
      const normSquared = gradient.reduce((sum, value) => sum + value ** 2, 0);
      if (!(normSquared > 1e-18)) {
        status = 'degenerate-contact-linearization';
        failure = {
          phase:'global-sparse-contact-projection',
          edgeKey:row.key,
          lastTrustworthyEvidence:'selected',
        };
        break;
      }
      const scale = config.projectionRelaxation * (-row.signedGap) / normSquared;
      contributions.push({
        edgeKey:row.key,
        vector:gradient.map(value => value * scale),
      });
    }
    if (failure) break;
    contributions.sort((left, right) => left.edgeKey.localeCompare(right.edgeKey));
    if (contributions.length === 0) {
      status = 'unmodeled-or-stalled-physical-residual';
      failure = {
        phase:'global-sparse-contact-projection',
        residual:rounded(current.maximumPhysicalResidual, 15),
        lastTrustworthyEvidence:'selected',
      };
      break;
    }
    const delta = Array(vector.length).fill(0);
    const contributionCounts = Array(vector.length).fill(0);
    for (const contribution of contributions) {
      for (let axis = 0; axis < delta.length; axis += 1) {
        if (contribution.vector[axis] === 0) continue;
        delta[axis] += contribution.vector[axis];
        contributionCounts[axis] += 1;
      }
    }
    for (let axis = 0; axis < delta.length; axis += 1) {
      if (contributionCounts[axis] > 1) delta[axis] /= contributionCounts[axis];
    }
    const candidates = config.lineSearch.map(lineScale => {
      const candidateVector = clampVector(
        vector.map((value, axis) => value + lineScale * delta[axis]),
        config.translationBounds,
      );
      const snapshot = measureSnapshot(problem, candidateVector);
      candidateEvaluations += 1;
      return { lineScale, snapshot };
    });
    candidates.sort((left, right) => compareSnapshots(left.snapshot, right.snapshot));
    const best = candidates[0];
    if (!best || compareSnapshots(best.snapshot, current) >= 0) {
      status = 'stalled-sparse-global-candidate';
      failure = {
        phase:'global-sparse-contact-projection',
        residual:rounded(current.maximumPhysicalResidual, 15),
        lastTrustworthyEvidence:'selected',
      };
      break;
    }
    vector = [...best.snapshot.vector];
    current = best.snapshot;
    snapshots += 1;
    iterations.push({
      iteration,
      activeEdgeKeys:contributions.map(contribution => contribution.edgeKey),
      simultaneousMemberCount:new Set(contributions.flatMap(contribution =>
        problem.graph.edges.find(edge => edge.key === contribution.edgeKey).members)).size,
      acceptedLineScale:best.lineScale,
      maximumPhysicalResidual:rounded(current.maximumPhysicalResidual, 15),
      totalPairwisePenetration:rounded(current.metrics.pairwisePenetration, 15),
      deformationEnergy:current.deformationEnergy,
    });
    if (current.maximumPhysicalResidual <= config.convergenceTolerance) {
      status = 'converged-sparse-global-candidate';
      break;
    }
  }

  if (!status) {
    status = 'iteration-budget-exhausted';
    failure = {
      phase:'global-sparse-contact-projection',
      residual:rounded(current.maximumPhysicalResidual, 15),
      lastTrustworthyEvidence:'selected',
    };
  }
  const metricsSha256 = hashMusclePackingCanonicalJson(current.metrics);
  const beltSha256 = hashMusclePackingCanonicalJson(current.belt);
  const physicalStateSha256 = hashMusclePackingCanonicalJson({
    muscles:current.muscles,
    metrics:current.metrics,
    belt:current.belt,
  });
  const selected = {
    vector:[...current.vector],
    muscles:structuredClone(current.muscles),
    metrics:structuredClone(current.metrics),
    metricsSha256,
    belt:structuredClone(current.belt),
    beltSha256,
    physicalStateSha256,
    maximumPhysicalResidual:rounded(current.maximumPhysicalResidual, 15),
    deformationEnergy:current.deformationEnergy,
    displacement:displacementReceipt(problem, current.muscles),
  };
  const core = {
    schema:NBODY_PACKING_SPARSE_GRAPH_RESULT_SCHEMA,
    status,
    route:{ requested:ALGORITHM, effective:ALGORITHM, fallbackUsed:false },
    source: {
      problemSha256:problem.identity.sha256,
      fixtureSha256:problem.source.fixtureSha256,
      crowdedStateSha256:problem.source.crowdedStateSha256,
    },
    config:{ requested:structuredClone(requestedConfig), effective:structuredClone(config) },
    mechanism: {
      updateMode:'one-global-snapshot-one-simultaneous-apply',
      pairwiseClosureAuthority:false,
      oracleTargetCoordinatesConsumed:false,
      arbitraryDegreeGraph:true,
      traversal:config.candidateEnumeration,
      accumulation:'canonical-edge-key-before-simultaneous-apply',
      graphEdgeCount:problem.graph.edgeCount,
      maximumDegree:problem.graph.maximumDegree,
    },
    work: {
      iterations:iterations.length,
      snapshots,
      constraintLinearizations,
      candidateEvaluations,
      rows:iterations,
    },
    selected,
    failure,
  };
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

function traversalRow(result) {
  return {
    requestedEnumeration:result.config.requested.candidateEnumeration,
    effectiveEnumeration:result.config.effective.candidateEnumeration,
    status:result.status,
    fallbackUsed:result.route.fallbackUsed,
    selectedVector:[...result.selected.vector],
    selectedPhysicalStateSha256:result.selected.physicalStateSha256,
    selectedMetricsSha256:result.selected.metricsSha256,
    selectedBeltSha256:result.selected.beltSha256,
    workSha256:hashMusclePackingCanonicalJson(result.work),
  };
}

export function solveNBodySparseGraphCandidate({ problem, requestedConfig } = {}) {
  validateProblem(problem);
  validateRequestedConfig(requestedConfig);
  const primary = solveSingleTraversal({ problem, requestedConfig });
  const alternateConfig = {
    ...structuredClone(requestedConfig),
    candidateEnumeration:requestedConfig.candidateEnumeration === 'canonical'
      ? 'reverse'
      : 'canonical',
  };
  const alternate = solveSingleTraversal({ problem, requestedConfig:alternateConfig });
  const primaryRow = traversalRow(primary);
  const alternateRow = traversalRow(alternate);
  const comparison = {
    statusEqual:primaryRow.status === alternateRow.status,
    selectedVectorEqual:JSON.stringify(primaryRow.selectedVector) ===
      JSON.stringify(alternateRow.selectedVector),
    selectedPhysicalStateEqual:primaryRow.selectedPhysicalStateSha256 ===
      alternateRow.selectedPhysicalStateSha256,
    selectedMetricsEqual:primaryRow.selectedMetricsSha256 === alternateRow.selectedMetricsSha256,
    selectedBeltEqual:primaryRow.selectedBeltSha256 === alternateRow.selectedBeltSha256,
    workEqual:primaryRow.workSha256 === alternateRow.workSha256,
  };
  const passed = Object.values(comparison).every(Boolean);
  const core = structuredClone(primary);
  delete core.identity;
  core.status = passed ? primary.status : 'candidate-enumeration-order-dependent';
  core.invariance = {
    candidateEnumeration:passed ? 'passed' : 'failed-order-dependent',
    mechanism:'paired-full-solve-traversal-comparison',
    rows:[primaryRow, alternateRow],
    comparison,
  };
  if (!passed) {
    core.failure = {
      phase:'paired-traversal-invariance',
      lastTrustworthyEvidence:'invariance.rows',
      primaryStatus:primary.status,
      alternateStatus:alternate.status,
    };
  }
  return { ...core, identity:{ sha256:hashMusclePackingCanonicalJson(core) } };
}

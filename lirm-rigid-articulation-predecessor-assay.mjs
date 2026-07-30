#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  evaluateSmoothFittedProxyRigPhase,
} from './lirm-reference-fitted-armature-core.mjs';
import {
  locateEditablePrimitive,
  normalizePositions,
  parseGlb,
  readAccessor,
} from './lirm-smooth-fitted-proxy-rig-assay.mjs';
import {
  createSupportPlacedFittedRig,
  createSupportRootFrame,
} from './lirm-stationary-hill-contact-core.mjs';
import {
  applyRigidChain,
  assertRigidArticulationReport,
  classifyRigidPredecessorLocality,
  createIndexedOwnershipLocality,
  createTriangleCollisionField,
  evaluateSweptRigidCandidate,
  freezeRigidJointFrame,
  measureRigidSetClearance,
  RIGID_ARTICULATION_ANNOTATION_HASH,
  RIGID_ARTICULATION_ASSAY_ROUTE,
  RIGID_ARTICULATION_SOURCE_HASH,
  RIGID_ARTICULATION_SUPPORT_ID,
} from './lirm-rigid-articulation-predecessor-core.mjs';

const DEFAULT_INPUTS = Object.freeze({
  source: 'artifacts/motion-ready-719024/creature.glb',
  registration: 'artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json',
  contactAtlas: 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json',
  phaseReport: 'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/report.json',
  handshake:
    'artifacts/lirm-719024-motion-contact-probe-handshake-v0/stationary-hill-request-response.json',
  axialRegistration: 'artifacts/motion-ready-719024/registration.json',
  constraints: 'artifacts/motion-ready-719024/stationary-contact-constraints/constraints.json',
  annotation:
    'artifacts/lirm-719024-rigid-articulation-predecessor-v0/inputs/oracle-stencil.json',
  swingClearanceReport:
    'artifacts/lirm-719024-swing-clearance-assay-v0/report.json',
});

const EXPECTED_HASHES = Object.freeze({
  source: RIGID_ARTICULATION_SOURCE_HASH,
  registration: 'sha256:a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9',
  contactAtlas: 'sha256:e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
  phaseReport: 'sha256:97abeb1cdacb802ecf26e2aba6e27ae9d96508e6f85836853b9c3bdd993583ff',
  handshake: 'sha256:a84bfcae1ad03f71961bcfc4c9040980648f4c579b1bccc3ba15d82a25a6210a',
  axialRegistration:
    'sha256:cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
  constraints: 'sha256:77a8e0f795791956ceb34a17da397865ea0a7504f98542de1e6b0529e66f72fb',
  annotation: RIGID_ARTICULATION_ANNOTATION_HASH,
  swingClearanceReport:
    'sha256:768a100a20fc7d9ec47e985efeabcbef296cb860540a990e025285d49a7a0617',
});

const ROOT_BOUND_RADIANS = Math.PI / 2;
const DISTAL_BOUND_RADIANS = Math.PI / 2;
const BOUNDED_STEP_RADIANS = Math.PI / 24;
const COMPLETE_STEP_RADIANS = Math.PI / 12;

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function writeAtomic(path, bytes) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

async function writeJsonAtomic(path, value) {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function clearRigidArticulationDerivedOutputs(outDir) {
  await rm(resolve(outDir, 'accepted-rigid-K-positions.f32'), { force: true });
}

async function loadExact(path, expectedHash, parseJson = true) {
  const bytes = await readFile(path);
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    throw new Error(`exact input hash mismatch for ${path}: ${actualHash} != ${expectedHash}`);
  }
  return {
    bytes,
    sha256: actualHash,
    value: parseJson ? JSON.parse(bytes) : null,
  };
}

function point(positions, vertex) {
  const offset = vertex * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
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
  if (!(magnitude > 1e-12)) throw new Error(`${label} must be nonzero`);
  return multiply(value, 1 / magnitude);
}

function nearestVertex(positions, target) {
  let selected = -1;
  let minimumSquaredDistance = Infinity;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const delta = subtract(point(positions, vertex), target);
    const squaredDistance = dot(delta, delta);
    if (squaredDistance < minimumSquaredDistance) {
      selected = vertex;
      minimumSquaredDistance = squaredDistance;
    }
  }
  return {
    vertex: selected,
    squaredDistance: minimumSquaredDistance,
    distance: Math.sqrt(minimumSquaredDistance),
  };
}

function maximumAbsoluteDelta(left, right) {
  if (left.length !== right.length) return Infinity;
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}

function geometryDiameter(positions) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], positions[offset + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[offset + axis]);
    }
  }
  return length(subtract(maximum, minimum));
}

function medianEdgeLength(positions, indices) {
  const values = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices = [indices[offset], indices[offset + 1], indices[offset + 2]];
    values.push(
      length(subtract(point(positions, vertices[0]), point(positions, vertices[1]))),
      length(subtract(point(positions, vertices[1]), point(positions, vertices[2]))),
      length(subtract(point(positions, vertices[2]), point(positions, vertices[0]))),
    );
  }
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

function angleRange(minimum, maximum, step, includeZero = true) {
  const values = [];
  const count = Math.round((maximum - minimum) / step);
  for (let index = 0; index <= count; index += 1) {
    const value = minimum + index * step;
    if (includeZero || Math.abs(value) > 1e-12) values.push(value);
  }
  return values;
}

function periodicAngles(step) {
  const values = [];
  for (let value = -Math.PI; value < Math.PI - 1e-12; value += step) {
    values.push(value);
  }
  return values;
}

function collisionSummary({
  positions,
  rigidVertexIndices,
  collisionField,
  sourceValues,
  collisionTolerance,
}) {
  const values = rigidVertexIndices.map(vertex => collisionField.distance(point(positions, vertex)));
  let passes = true;
  for (let index = 0; index < values.length; index += 1) {
    if (sourceValues[index] > collisionTolerance) {
      if (values[index] <= collisionTolerance) passes = false;
    } else if (values[index] < sourceValues[index] - collisionTolerance) {
      passes = false;
    }
  }
  return {
    minimum: Math.min(...values),
    passes,
    values,
  };
}

function stripCandidate(candidate) {
  if (!candidate) return null;
  return {
    rootRadians: candidate.rootRadians,
    distalRadians: candidate.distalRadians,
    normalizedMinimumClearance: candidate.clearance.normalizedMinimum,
    minimumClearance: candidate.clearance.minimum,
    minimumCollisionDistance: candidate.collision.minimum,
    endpointPasses: candidate.endpointPasses,
    sweptPasses: candidate.swept?.passes ?? null,
    sweep: candidate.swept ? {
      sampleCount: candidate.swept.sweep.sampleCount,
      terminalFraction: candidate.swept.sweep.terminalFraction,
      conservativeCertified: candidate.swept.sweep.conservativeCertified,
      minimumCollisionDistance: candidate.swept.sweep.collision.minimum,
      collisionPasses: candidate.swept.sweep.collision.passes,
      minimumTerrainClearance: candidate.swept.sweep.terrain.minimum,
      terrainPasses: candidate.swept.sweep.terrain.passes,
      limitingWitness: candidate.swept.sweep.limitingWitness
        ? structuredClone(candidate.swept.sweep.limitingWitness)
        : null,
      rejectionReason: candidate.swept.passes
        ? null
        : (
          !candidate.swept.sweep.conservativeCertified
            ? 'uncertifiable-next-interval'
            : !candidate.swept.sweep.collision.passes
              ? 'body-collision'
              : 'terrain-clearance'
        ),
    } : null,
  };
}

function buildEndpointCandidate({
  sourcePositions,
  rigidVertexIndices,
  rootFrame,
  distalFrame,
  rootRadians,
  distalRadians,
  terrain,
  diameter,
  numericTolerance,
  collisionField,
  sourceCollisionValues,
  collisionTolerance,
}) {
  const positions = applyRigidChain({
    positions: sourcePositions,
    rigidVertexIndices,
    rootFrame,
    distalFrame,
    rootRadians,
    distalRadians,
  });
  const clearance = measureRigidSetClearance({
    positions,
    rigidVertexIndices,
    terrainPoint: terrain.point,
    terrainNormal: terrain.normal,
    diameter,
    numericTolerance,
  });
  const collision = collisionSummary({
    positions,
    rigidVertexIndices,
    collisionField,
    sourceValues: sourceCollisionValues,
    collisionTolerance,
  });
  return {
    positions,
    rootRadians,
    distalRadians,
    clearance,
    collision,
    endpointPasses: clearance.passes && collision.passes,
  };
}

function rankCandidates(left, right) {
  const leftEffort = Math.abs(left.rootRadians) + Math.abs(left.distalRadians);
  const rightEffort = Math.abs(right.rootRadians) + Math.abs(right.distalRadians);
  if (leftEffort !== rightEffort) return leftEffort - rightEffort;
  return right.clearance.normalizedMinimum - left.clearance.normalizedMinimum;
}

function createJointFrames({ annotation, normalizedPositions, worldPositions }) {
  const chain = annotation.regions.find(region => (
    region.id === 'appendage-chain-appendage-2-1'
  ));
  if (!chain || chain.points.length !== 3) {
    throw new Error('operator annotation lacks the exact rear-left three-point chain');
  }
  const witnesses = chain.points.map(target => nearestVertex(normalizedPositions, target));
  if (new Set(witnesses.map(entry => entry.vertex)).size !== 3) {
    throw new Error('rear-left chain points collapsed onto duplicate source witnesses');
  }
  const [root, distal, foot] = witnesses.map(entry => point(worldPositions, entry.vertex));
  let axis = normalize(
    cross(subtract(distal, root), subtract(foot, distal)),
    'rear-left semantic bend axis',
  );
  const rootReference = normalize(subtract(distal, root), 'rear-left root reference');
  const distalReference = normalize(subtract(foot, distal), 'rear-left distal reference');
  const sourceAxisHint = annotation.regions.find(region => region.id === 'body-axis');
  if (sourceAxisHint) {
    const hint = normalize(
      subtract(sourceAxisHint.points[1], sourceAxisHint.points[0]),
      'body-axis sign hint',
    );
    if (dot(axis, hint) < 0) axis = multiply(axis, -1);
  }
  const authority = `${annotation.authoring.authority}:${annotation.authoring.sessionId}`;
  return {
    rootFrame: freezeRigidJointFrame({
      id: 'rear-left-root',
      center: root,
      axis,
      positiveReference: rootReference,
      sourceVertexWitnesses: {
        center: witnesses[0].vertex,
        axisA: witnesses[1].vertex,
        axisB: witnesses[2].vertex,
      },
      authority,
    }),
    distalFrame: freezeRigidJointFrame({
      id: 'rear-left-distal',
      center: distal,
      axis,
      positiveReference: distalReference,
      sourceVertexWitnesses: {
        center: witnesses[1].vertex,
        axisA: witnesses[0].vertex,
        axisB: witnesses[2].vertex,
      },
      authority,
    }),
    chain,
    witnesses,
  };
}

async function searchFamily({
  family,
  rootAngles,
  distalAngles,
  context,
}) {
  const endpointCandidates = [];
  let evaluatedCount = 0;
  for (const rootRadians of rootAngles) {
    for (const distalRadians of distalAngles) {
      evaluatedCount += 1;
      const candidate = buildEndpointCandidate({
        ...context,
        rootRadians,
        distalRadians,
      });
      if (candidate.endpointPasses) endpointCandidates.push(candidate);
    }
  }
  endpointCandidates.sort(rankCandidates);
  let accepted = null;
  let sweptCandidateCount = 0;
  const sweptRejections = [];
  for (const candidate of endpointCandidates) {
    sweptCandidateCount += 1;
    candidate.swept = evaluateSweptRigidCandidate({
      positions: context.sourcePositions,
      rigidVertexIndices: context.rigidVertexIndices,
      rootFrame: context.rootFrame,
      distalFrame: context.distalFrame,
      rootRadians: candidate.rootRadians,
      distalRadians: candidate.distalRadians,
      terrainPoint: context.terrain.point,
      terrainNormal: context.terrain.normal,
      diameter: context.diameter,
      collisionField: context.collisionField,
      numericTolerance: context.numericTolerance,
      collisionTolerance: context.collisionTolerance,
      maximumWitnessTravel: context.maximumWitnessTravel,
    });
    if (candidate.swept.passes) {
      accepted = candidate;
      break;
    }
    sweptRejections.push(stripCandidate(candidate));
  }
  const rejectionCounts = Object.create(null);
  for (const candidate of sweptRejections) {
    const reason = candidate.sweep.rejectionReason;
    rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
  }
  return {
    family,
    status: accepted ? 'passed' : 'failed',
    evaluatedCount,
    endpointPassingCount: endpointCandidates.length,
    sweptCandidateCount,
    rejectionCounts,
    sweptRejections,
    bestEndpoint: stripCandidate(endpointCandidates[0]),
    accepted: stripCandidate(accepted),
    acceptedCandidate: accepted,
  };
}

export async function runRigidArticulationPredecessorAssay({
  root = process.cwd(),
  outDir = 'artifacts/lirm-719024-rigid-articulation-predecessor-v0',
  inputs = DEFAULT_INPUTS,
} = {}) {
  const absoluteRoot = resolve(root);
  const absoluteOutDir = resolve(absoluteRoot, outDir);
  const reportPath = resolve(absoluteOutDir, 'report.json');
  await mkdir(absoluteOutDir, { recursive: true });
  await clearRigidArticulationDerivedOutputs(absoluteOutDir);
  let failurePhase = 'input-admission';
  let lastTrustworthyEvidence = null;
  const startedAt = performance.now();
  try {
    const absoluteInputs = Object.fromEntries(
      Object.entries(inputs).map(([key, path]) => [key, resolve(absoluteRoot, path)]),
    );
    const loaded = Object.fromEntries(await Promise.all(
      Object.entries(absoluteInputs).map(async ([key, path]) => [
        key,
        await loadExact(path, EXPECTED_HASHES[key], key !== 'source'),
      ]),
    ));
    const priorSwingClearance = loaded.swingClearanceReport.value;
    if (
      priorSwingClearance.requestedRoute
        !== 'kaminos/lirm-719024/swing-clearance-static-operator-assay-v0'
      || priorSwingClearance.effectiveRoute !== priorSwingClearance.requestedRoute
      || priorSwingClearance.sourceHash !== RIGID_ARTICULATION_SOURCE_HASH
      || priorSwingClearance.actualSourceHash !== priorSwingClearance.sourceHash
      || priorSwingClearance.supportId !== RIGID_ARTICULATION_SUPPORT_ID
    ) {
      throw new Error('prior swing-clearance collar route/source/support identity mismatch');
    }
    lastTrustworthyEvidence = 'all exact cast, registration, terrain, and annotation inputs admitted';

    failurePhase = 'source-geometry';
    const { json, binary } = parseGlb(loaded.source.bytes);
    const primitive = locateEditablePrimitive(json);
    const sourcePositions = readAccessor(
      json,
      binary,
      primitive.attributes.POSITION,
      'VEC3',
    ).values;
    const indices = Uint32Array.from(
      readAccessor(json, binary, primitive.indices, 'SCALAR').values,
    );
    const normalization = normalizePositions(sourcePositions);
    const admittedNormalization = loaded.handshake.value.normalization;
    if (normalization.center.some(
      (value, axis) => Math.abs(value - admittedNormalization.center[axis]) > 1e-12,
    ) || Math.abs(normalization.scale - admittedNormalization.scale) > 1e-12) {
      throw new Error('source normalization diverged from frozen handshake');
    }
    lastTrustworthyEvidence = 'exact source geometry and frozen normalization agree';

    failurePhase = 'frozen-phase-realization';
    const prepass = loaded.handshake.value.prepass;
    const placedRig = createSupportPlacedFittedRig({
      normalizedPositions: normalization.values,
      registration: loaded.registration.value,
      normalization,
      bodyScale: prepass.body.scale,
      contactAtlas: loaded.contactAtlas.value,
      contactAtlasSha256: loaded.contactAtlas.sha256,
      sampleCount: loaded.phaseReport.value.effectiveConfig.curveSampleCount,
    });
    const supportRootFrame = createSupportRootFrame({
      prepass,
      contactPlaneY: loaded.axialRegistration.value.contactPlaneY,
    });
    const constraintPhase = loaded.constraints.value.phase;
    const phase = ((constraintPhase / (Math.PI * 2)) % 1 + 1) % 1;
    const baseline = evaluateSmoothFittedProxyRigPhase({
      binding: placedRig.binding,
      probeBinding: placedRig.probeBinding,
      phase,
      amplitude: loaded.phaseReport.value.effectiveConfig.amplitude,
      rootFrame: supportRootFrame,
    });
    const probe = placedRig.probeBinding.probes.find(
      entry => entry.id === RIGID_ARTICULATION_SUPPORT_ID,
    );
    const constraint = loaded.constraints.value.patches.find(
      entry => entry.id === RIGID_ARTICULATION_SUPPORT_ID,
    );
    if (!probe || !constraint) throw new Error('frozen rear-left support is missing');
    const rigidVertexIndices = Array.from(probe.vertexIndices);
    lastTrustworthyEvidence = 'frozen exact phase and rear-left rigid support K realized';

    failurePhase = 'joint-frame-freeze';
    const frames = createJointFrames({
      annotation: loaded.annotation.value,
      normalizedPositions: normalization.values,
      worldPositions: baseline.worldPositions,
    });
    const nestingAngles = angleRange(
      -ROOT_BOUND_RADIANS,
      ROOT_BOUND_RADIANS,
      BOUNDED_STEP_RADIANS,
    );
    let maximumNestingDelta = 0;
    for (const rootRadians of nestingAngles) {
      const oneJoint = applyRigidChain({
        positions: baseline.worldPositions,
        rigidVertexIndices,
        rootFrame: frames.rootFrame,
        rootRadians,
      });
      const twoJoint = applyRigidChain({
        positions: baseline.worldPositions,
        rigidVertexIndices,
        rootFrame: frames.rootFrame,
        distalFrame: frames.distalFrame,
        rootRadians,
        distalRadians: 0,
      });
      maximumNestingDelta = Math.max(
        maximumNestingDelta,
        maximumAbsoluteDelta(oneJoint, twoJoint),
      );
    }
    if (maximumNestingDelta !== 0) {
      throw new Error(`J2(theta, 0) nesting failed with delta ${maximumNestingDelta}`);
    }
    lastTrustworthyEvidence = 'operator chain frozen to source witnesses with exact J2 nesting';

    failurePhase = 'collision-field';
    const collisionIdentity = `triangle-field:${sha256(Buffer.from(indices.buffer))}:exclude-K-${sha256(
      Buffer.from(Uint32Array.from(rigidVertexIndices).buffer),
    )}`;
    const collisionField = createTriangleCollisionField({
      identity: collisionIdentity,
      positions: baseline.worldPositions,
      indices,
      excludedVertexIndices: rigidVertexIndices,
    });
    const sourceCollisionValues = rigidVertexIndices.map(
      vertex => collisionField.distance(point(baseline.worldPositions, vertex)),
    );
    lastTrustworthyEvidence = 'exact source triangle field built with moved support K excluded';

    failurePhase = 'search';
    const diameter = geometryDiameter(baseline.worldPositions);
    const measuredMedianEdgeLength = medianEdgeLength(baseline.worldPositions, indices);
    const numericTolerance = diameter * 1e-9;
    const collisionTolerance = diameter * 1e-6;
    const maximumWitnessTravel = measuredMedianEdgeLength / 2;
    const terrain = {
      point: constraint.terrainPoint,
      normal: constraint.terrainNormal,
    };
    const sourceClearance = measureRigidSetClearance({
      positions: baseline.worldPositions,
      rigidVertexIndices,
      terrainPoint: terrain.point,
      terrainNormal: terrain.normal,
      diameter,
      numericTolerance,
    });
    const sourceCollisionMinimum = Math.min(...sourceCollisionValues);
    const context = {
      sourcePositions: baseline.worldPositions,
      rigidVertexIndices,
      rootFrame: frames.rootFrame,
      distalFrame: frames.distalFrame,
      terrain,
      diameter,
      numericTolerance,
      collisionField,
      sourceCollisionValues,
      collisionTolerance,
      maximumWitnessTravel,
    };
    const searches = [];
    const j1 = await searchFamily({
      family: 'J1-bounded',
      rootAngles: nestingAngles,
      distalAngles: [0],
      context,
    });
    searches.push(j1);
    let accepted = j1.acceptedCandidate;
    if (!accepted) {
      const j2 = await searchFamily({
        family: 'J2-bounded',
        rootAngles: nestingAngles,
        distalAngles: angleRange(
          -DISTAL_BOUND_RADIANS,
          DISTAL_BOUND_RADIANS,
          BOUNDED_STEP_RADIANS,
          false,
        ),
        context,
      });
      searches.push(j2);
      accepted = j2.acceptedCandidate;
    }
    if (!accepted) {
      const complete = await searchFamily({
        family: 'J2-complete-orientation-diagnostic',
        rootAngles: periodicAngles(COMPLETE_STEP_RADIANS),
        distalAngles: periodicAngles(COMPLETE_STEP_RADIANS),
        context,
      });
      searches.push(complete);
      accepted = complete.acceptedCandidate;
    }
    const rejectionRows = searches.flatMap(search => search.sweptRejections);
    const priorCollarVertexIndices = [...new Set([
      ...priorSwingClearance.masks.attachmentVertexIndices,
      ...priorSwingClearance.bodySideSet.pairs.map(pair => pair.bodyVertex),
    ])].sort((left, right) => left - right);
    const transitionRadius = Math.max(...frames.chain.radii);
    if (transitionRadius !== 0.04) {
      throw new Error(`frozen operator transition radius changed: ${transitionRadius}`);
    }
    const indexedLocality = createIndexedOwnershipLocality({
      positions: normalization.values,
      indices,
      rigidVertexIndices,
      priorCollarVertexIndices,
    });
    for (const row of rejectionRows) {
      const witness = row.sweep?.limitingWitness;
      if (
        !witness
        || !Number.isInteger(witness.movedVertexIndex)
        || !Array.isArray(witness.retainedTriangleVertexIndices)
      ) {
        continue;
      }
      witness.locality = {
        movedVertex: indexedLocality.describeMovedVertex(witness.movedVertexIndex),
        retainedTriangleVertices: witness.retainedTriangleVertexIndices.map(
          vertex => indexedLocality.describeRetainedVertex(vertex),
        ),
      };
    }
    const locality = {
      ...classifyRigidPredecessorLocality({
        rows: rejectionRows,
        transitionRadius,
      }),
      topology: indexedLocality.topology,
      ownershipBoundaryVertexCount:
        indexedLocality.ownershipBoundaryVertexIndices.length,
      ownershipBoundaryVertexIndices:
        indexedLocality.ownershipBoundaryVertexIndices,
      priorCollarSourceReport:
        'artifacts/lirm-719024-swing-clearance-assay-v0/report.json',
      priorCollarSourceHash: loaded.swingClearanceReport.sha256,
      priorAttachmentVertexCount:
        priorSwingClearance.masks.attachmentVertexCount,
      priorAttachmentToRetainedBodyPairCount:
        priorSwingClearance.bodySideSet.pairs.length,
      priorCollarVertexCount: priorCollarVertexIndices.length,
      classificationPredicate:
        'boundary-local iff every moved witness and every retained triangle vertex is reachable within the frozen transition radius from B_K; any farther or unreachable witness is deep-core; missing identity is underinstrumented',
    };
    if (locality.classification === 'underinstrumented') {
      throw new Error(
        `exact locality rerun remained underinstrumented for ${locality.missingWitnessCount} rows`,
      );
    }
    lastTrustworthyEvidence = accepted
      ? 'source-relative swept rigid candidate admitted'
      : 'complete-orientation axis-oracle diagnostic found no admitted candidate';

    failurePhase = 'outputs';
    const outputInventory = ['report.json'];
    let acceptedPositionsFile = null;
    if (accepted) {
      acceptedPositionsFile = 'accepted-rigid-K-positions.f32';
      await writeAtomic(
        resolve(absoluteOutDir, acceptedPositionsFile),
        Buffer.from(Float32Array.from(accepted.swept.endpoint.positions).buffer),
      );
      outputInventory.push(acceptedPositionsFile);
    }
    const report = {
      schema: 'kaminos.lirm-rigid-articulation-predecessor-report.v0',
      status: 'complete',
      requestedRoute: RIGID_ARTICULATION_ASSAY_ROUTE,
      effectiveRoute: RIGID_ARTICULATION_ASSAY_ROUTE,
      sourceHash: RIGID_ARTICULATION_SOURCE_HASH,
      actualSourceHash: loaded.source.sha256,
      annotationHash: RIGID_ARTICULATION_ANNOTATION_HASH,
      actualAnnotationHash: loaded.annotation.sha256,
      supportId: RIGID_ARTICULATION_SUPPORT_ID,
      collisionIdentity,
      jointFrames: [frames.rootFrame, frames.distalFrame],
      annotationWitness: {
        regionId: frames.chain.id,
        label: frames.chain.label,
        sourceVertexWitnesses: frames.witnesses,
      },
      nesting: {
        checked: true,
        rootAngleCount: nestingAngles.length,
        maximumAbsoluteDelta: maximumNestingDelta,
      },
      phase: {
        radians: constraintPhase,
        normalized: phase,
        poseId: loaded.constraints.value.poseId,
      },
      terrain,
      rigidSet: {
        id: 'K',
        supportVertexCount: rigidVertexIndices.length,
        supportVertexIndices: rigidVertexIndices,
        excludesLaterFullSupportSetS: true,
      },
      sourceState: {
        minimumTerrainClearance: sourceClearance.minimum,
        normalizedMinimumTerrainClearance: sourceClearance.normalizedMinimum,
        minimumBodyCollisionDistance: sourceCollisionMinimum,
      },
      tolerances: {
        diameter,
        numericTolerance,
        collisionTolerance,
        medianEdgeLength: measuredMedianEdgeLength,
        maximumWitnessTravel,
        positiveClearancePredicate: 'minimum(K signed distance) > numericTolerance',
        normalizedClearanceMetric: 'minimum(K signed distance) / diameter',
      },
      collisionField: {
        identity: collisionField.identity,
        triangleCount: collisionField.triangleCount,
        excludedVertexCount: collisionField.excludedVertexCount,
        predicate:
          'no new body collision and no worsened preexisting proximity over the swept path',
      },
      locality,
      searches: searches.map(({ acceptedCandidate, ...search }) => search),
      accepted: stripCandidate(accepted),
      acceptedPositionsFile,
      result: accepted
        ? 'rigid-kinematic-reach-observed'
        : 'rigid-kinematic-reach-not-observed-for-frozen-axis-oracle',
      authority: {
        claim:
          'kinematic rigid reach of K under the frozen operator-authored axis oracle only',
        doesNotClaim: [
          'attachment continuity',
          'full support set S motion',
          'collar validity',
          'animation quality',
          'locomotion',
          'weight bearing',
          'automatic joint-frame inference',
          'general riggability',
          'visual admission',
        ],
        continuation: accepted
          ? 'A later slice may test attachment semantics without changing this rigid result.'
          : 'A different operator annotation or explicit technical disagreement is required.',
      },
      inputs: Object.fromEntries(
        Object.entries(absoluteInputs).map(([key, path]) => [
          key,
          relative(absoluteRoot, path).replaceAll('\\', '/'),
        ]),
      ),
      inputHashes: Object.fromEntries(
        Object.entries(loaded).map(([key, entry]) => [key, entry.sha256]),
      ),
      outputInventory,
      failurePhase: null,
      lastTrustworthyEvidence,
      timing: { elapsedMilliseconds: performance.now() - startedAt },
    };
    assertRigidArticulationReport(report);
    await writeJsonAtomic(reportPath, report);
    return { report, reportPath };
  } catch (error) {
    const failure = {
      schema: 'kaminos.lirm-rigid-articulation-predecessor-report.v0',
      status: 'failed',
      requestedRoute: RIGID_ARTICULATION_ASSAY_ROUTE,
      effectiveRoute: null,
      sourceHash: RIGID_ARTICULATION_SOURCE_HASH,
      annotationHash: RIGID_ARTICULATION_ANNOTATION_HASH,
      supportId: RIGID_ARTICULATION_SUPPORT_ID,
      failurePhase,
      lastTrustworthyEvidence,
      error: String(error?.stack || error),
      timing: { elapsedMilliseconds: performance.now() - startedAt },
    };
    await writeJsonAtomic(reportPath, failure);
    throw error;
  }
}

function parseArguments(argv) {
  const values = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') values.root = argv[++index];
    else if (argv[index] === '--out-dir') values.outDir = argv[++index];
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  return values;
}

if (process.argv[1]
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runRigidArticulationPredecessorAssay(parseArguments(process.argv.slice(2)))
    .then(({ reportPath, report }) => {
      process.stdout.write(`${JSON.stringify({
        status: report.status,
        route: report.effectiveRoute,
        supportId: report.supportId,
        result: report.result,
        report: relative(process.cwd(), reportPath),
      })}\n`);
    })
    .catch(error => {
      process.stderr.write(`${String(error?.stack || error)}\n`);
      process.exitCode = 1;
    });
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  applyRouteRestorationTowardRest,
  parseGlbTriangleSoup,
  signedEnvelopeDistance,
} from '../k4-envelope-fit-core.mjs';
import {
  measureMuscleCompartmentRingCageContactState,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const ATTRIBUTION_SCHEMA = 'kaminos.k4-source-route-containment-assay.v0';
const RESULT_SCHEMA = 'kaminos.k4-coupled-envelope-contact-frontier-result.v0';
const REPORT_SCHEMA = 'kaminos.k4-coupled-envelope-contact-frontier-run-report.v0';
const STEP_CONSTRAINT_ID = 's8-envelope-signed-distance-must-not-increase';
const CUSTODY_MARKER = '.kaminos-k4-coupled-envelope-contact-frontier-output';
const CUSTODY_SCHEMA =
  'kaminos.k4-coupled-envelope-contact-frontier-output-custody.v0';
const CUSTODY_BYTES = Buffer.from(`${CUSTODY_SCHEMA}\n`);
const STATE_DIRECTORY = 'states';
const OWNED_PATHS = Object.freeze(['frontier-result.json', STATE_DIRECTORY]);
const SOLVER_BASE = Object.freeze({
  convergenceTolerance: 0.0001,
  curvatureRegularization: 12,
  maximumLocalTurningAngleChange: 0.25,
  maximumRelativeVolumeError: 0.015,
  maximumTotalTurningAngleChange: 1.25,
  relaxationStep: 0.32,
});

function parseArguments(argv) {
  const flags = new Map([
    ['--frame-receipt', 'frameReceipt'],
    ['--envelope', 'envelope'],
    ['--attribution', 'attribution'],
    ['--carrier', 'carrier'],
    ['--source', 'source'],
    ['--blends', 'blends'],
    ['--solver-iterations', 'solverIterations'],
    ['--output', 'output'],
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = flags.get(argv[index]);
    if (!key) throw new Error(`unsupported argument ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argv[index]} requires a value`);
    parsed[key] = value;
    index += 1;
  }
  for (const key of [
    'frameReceipt', 'envelope', 'attribution', 'carrier', 'source',
    'blends', 'solverIterations', 'output',
  ]) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  parsed.output = path.resolve(parsed.output);
  parsed.blends = parsed.blends.split(',').map(Number);
  if (parsed.blends.length === 0 ||
      parsed.blends.some(value => !Number.isFinite(value) ||
        !(value > 0 && value < 1)) ||
      new Set(parsed.blends).size !== parsed.blends.length) {
    throw new Error('--blends requires unique fractions in (0, 1)');
  }
  parsed.solverIterations = Number(parsed.solverIterations);
  if (!Number.isInteger(parsed.solverIterations) || parsed.solverIterations <= 0) {
    throw new Error('--solver-iterations must be a positive integer');
  }
  return parsed;
}

function preScanOutputDirectory(argv) {
  const index = argv.indexOf('--output');
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? path.resolve(value) : null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasOutputCustody(outputDirectory) {
  try {
    return (await readFile(path.join(outputDirectory, CUSTODY_MARKER)))
      .equals(CUSTODY_BYTES);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function clearOwnedOutput(outputDirectory) {
  await Promise.all(OWNED_PATHS.map(relative =>
    rm(path.join(outputDirectory, relative), { recursive: true, force: true })));
}

async function claimOutputCustody(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  if (await hasOutputCustody(outputDirectory)) return;
  const occupied = [];
  for (const relative of [...OWNED_PATHS, 'run-report.json']) {
    if (await exists(path.join(outputDirectory, relative))) occupied.push(relative);
  }
  if (occupied.length > 0) {
    throw new Error(`refusing to claim unowned output containing ${occupied.join(', ')}`);
  }
  await writeAtomic(path.join(outputDirectory, CUSTODY_MARKER), CUSTODY_BYTES);
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

function blendToken(blend) {
  return String(Math.round(blend * 100)).padStart(3, '0');
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let args = null;
let phase = 'parse-arguments';
let inputReceipts = null;
let reportPath = preScannedOutputDirectory
  ? path.join(preScannedOutputDirectory, 'run-report.json')
  : null;

try {
  args = parseArguments(rawArguments);
  reportPath = path.join(args.output, 'run-report.json');
  phase = 'claim-output-custody';
  await claimOutputCustody(args.output);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.output);
  phase = 'read-inputs';
  const inputPaths = {};
  const inputBytes = {};
  for (const key of ['frameReceipt', 'envelope', 'attribution', 'carrier', 'source']) {
    inputPaths[key] = await realpath(path.resolve(args[key]));
    inputBytes[key] = await readFile(inputPaths[key]);
  }
  inputReceipts = Object.fromEntries(Object.keys(inputPaths).map(key => [key, {
    requestedPath: receiptPath(path.resolve(args[key])),
    effectivePath: receiptPath(inputPaths[key]),
    sha256: sha256(inputBytes[key]),
  }]));
  const frameReceipt = JSON.parse(inputBytes.frameReceipt);
  const attribution = JSON.parse(inputBytes.attribution);
  const solverCarrier = JSON.parse(inputBytes.carrier);
  const source = JSON.parse(inputBytes.source);
  phase = 'verify-inputs';
  if (frameReceipt?.inputs?.envelopeFileSha256 !== inputReceipts.envelope.sha256) {
    throw new Error('coupled frontier envelope does not match the frame receipt identity');
  }
  if (attribution?.schema !== ATTRIBUTION_SCHEMA) {
    throw new Error('coupled frontier requires the route-containment attribution');
  }
  const packingInduced = attribution.returnedEscapeRows
    .filter(row => row.classification === 'packing-induced-route-escape');
  if (packingInduced.length !== 1) {
    throw new Error('coupled frontier expects exactly one packing-induced escape');
  }
  const escape = packingInduced[0];
  phase = 'parse-envelope';
  const envelopeMesh = parseGlbTriangleSoup(inputBytes.envelope);
  const transform = frameReceipt.sourceToEnvelope.transform;
  const toEnvelope = point => {
    const scaled = point.map(value => value * transform.scale);
    return [0, 1, 2].map(row =>
      transform.rotation[row][0] * scaled[0] +
      transform.rotation[row][1] * scaled[1] +
      transform.rotation[row][2] * scaled[2] +
      transform.translation[row]);
  };
  const s8AxisDistance = carrier => {
    const cage = carrier.cages.find(
      row => row.constructionId === escape.constructionId,
    );
    const axis = cage.manifest.nodes.find(
      node => node.id === `${escape.sectionId}:axis`,
    );
    return signedEnvelopeDistance(toEnvelope(axis.currentPosition), envelopeMesh)
      .signedDistance;
  };
  const stateMetrics = carrier => {
    const measurement = measureMuscleCompartmentRingCageContactState(carrier, source);
    return {
      pairwiseMovableTotalPenetration: measurement.pairwise.movableTotalPenetration,
      pairwiseMovableMaximumPenetration: measurement.pairwise.movableMaximumPenetration,
      pairwiseFixedTotalPenetration: measurement.pairwise.fixedTotalPenetration,
      pairwiseFixedMaximumPenetration: measurement.pairwise.fixedMaximumPenetration,
      skeletalTotalPenetration: measurement.skeletal.totalPenetration,
      compartmentMaximumEscape: measurement.compartment.maximumEscape,
      maximumRelativeVolumeError: Math.max(
        ...measurement.cages.map(cage => cage.relativeVolumeError),
      ),
      s8AxisSignedDistance: s8AxisDistance(carrier),
    };
  };
  phase = 'evaluate-states';
  const states = [];
  const pushState = async (id, role, carrier, extras = {}) => {
    const carrierBytes = jsonBytes(carrier);
    const relative = `${STATE_DIRECTORY}/${id}-carrier.json`;
    await writeAtomic(path.join(args.output, relative), carrierBytes);
    states.push({
      id,
      role,
      metrics: stateMetrics(carrier),
      carrier: { path: relative, sha256: sha256(carrierBytes) },
      ...extras,
    });
  };
  await pushState('endpoint-collision-relieved', 'endpoint', solverCarrier);
  const fullRollback = applyRouteRestorationTowardRest({
    frameReceipt,
    envelopeMesh,
    solverCarrier,
    config: {
      constructionId: escape.constructionId,
      sectionId: escape.sectionId,
      containmentMargin: 0.05,
      maximumBlend: 1,
    },
  });
  await pushState('endpoint-contained-rollback', 'endpoint',
    fullRollback.outputCarrier, {
      restoration: { appliedBlend: fullRollback.appliedBlend },
    });
  for (const blend of args.blends) {
    const partial = applyRouteRestorationTowardRest({
      frameReceipt,
      envelopeMesh,
      solverCarrier,
      config: {
        constructionId: escape.constructionId,
        sectionId: escape.sectionId,
        containmentMargin: 0.05,
        maximumBlend: 1,
        exactBlend: blend,
      },
    });
    const startDistance = s8AxisDistance(partial.outputCarrier);
    const stepConstraint = candidate =>
      s8AxisDistance(candidate) > startDistance + 1e-9
        ? STEP_CONSTRAINT_ID
        : null;
    const solve = solveMuscleCompartmentRingCageContact(
      partial.outputCarrier,
      source,
      { ...SOLVER_BASE, maxIterations: args.solverIterations },
      { stepConstraint },
    );
    const { packedCarrier, metrics: _metrics, iterationHistory,
      lineSearchHistory: _lineSearchHistory, ...solveReceipt } = solve;
    await pushState(`blend-${blendToken(blend)}-solved`, 'candidate',
      packedCarrier, {
        restoration: {
          appliedBlend: partial.appliedBlend,
          startAxisSignedDistance: startDistance,
        },
        solve: {
          ...solveReceipt,
          acceptedIterations: solve.iterations,
          iterationCount: iterationHistory.length,
          stepConstraint: STEP_CONSTRAINT_ID,
          outputCarrierSha256: packedCarrier.identity.sha256,
        },
      });
  }
  phase = 'classify-frontier';
  const keys = [
    'pairwiseMovableTotalPenetration',
    'pairwiseMovableMaximumPenetration',
    'pairwiseFixedTotalPenetration',
    'pairwiseFixedMaximumPenetration',
    'skeletalTotalPenetration',
    's8AxisSignedDistance',
  ];
  const dominates = (left, right) =>
    keys.every(key => left[key] <= right[key]) &&
    keys.some(key => left[key] < right[key]);
  const nondominatedStateIds = states
    .filter(state => !states.some(other =>
      other.id !== state.id && dominates(other.metrics, state.metrics)))
    .map(state => state.id);
  const result = {
    schema: RESULT_SCHEMA,
    status: 'completed-provisional',
    claimCeiling: frameReceipt.claimCeiling,
    heldClaims: [
      ...attribution.heldClaims,
      'biological-priority',
      'final-objective-weighting',
    ],
    inputs: inputReceipts,
    escapeSectionId: escape.sectionId,
    frontierAxes: keys,
    states,
    nondominatedStateIds,
  };
  phase = 'write-frontier-result';
  const resultBytes = jsonBytes(result);
  await writeAtomic(path.join(args.output, 'frontier-result.json'), resultBytes);
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    claimCeiling: result.claimCeiling,
    inputs: inputReceipts,
    outputs: {
      frontierResult: { path: 'frontier-result.json', sha256: sha256(resultBytes) },
    },
    lastTrustworthyEvidence: {
      phase: 'frontier-result-written',
      frontierResultSha256: sha256(resultBytes),
      stateIds: states.map(state => state.id),
      nondominatedStateIds,
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    states: states.map(state => ({
      id: state.id,
      s8: state.metrics.s8AxisSignedDistance,
      movTot: state.metrics.pairwiseMovableTotalPenetration,
      movMax: state.metrics.pairwiseMovableMaximumPenetration,
      skel: state.metrics.skeletalTotalPenetration,
      iterations: state.solve?.acceptedIterations ?? null,
    })),
    nondominatedStateIds,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.output || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    const outputCustodyVerified = await hasOutputCustody(outputDirectory);
    if (outputCustodyVerified) await clearOwnedOutput(outputDirectory);
    await writeAtomic(reportPath, jsonBytes({
      schema: REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      inputs: inputReceipts,
      outputCustodyVerified,
      staleEvidenceCleared: outputCustodyVerified,
      outputs: null,
      lastTrustworthyEvidence: {
        phase: inputReceipts ? 'inputs-read-and-hashed' : 'raw-arguments-captured',
        inputs: inputReceipts,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

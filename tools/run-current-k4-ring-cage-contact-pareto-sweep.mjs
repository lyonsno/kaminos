#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const MATRIX_SCHEMA = 'kaminos.current-k4-ring-cage-contact-pareto-matrix.v0';
const RESULT_SCHEMA = 'kaminos.current-k4-ring-cage-contact-pareto-result.v0';
const REPORT_SCHEMA = 'kaminos.current-k4-ring-cage-contact-pareto-run-report.v0';
const OWNED_FILES = Object.freeze(['sweep-result.json']);
const CANDIDATE_DIRECTORY = 'candidates';

function parseArguments(argv) {
  const supported = new Set(['--solver-carrier', '--source', '--matrix', '--output']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['solver-carrier', 'source', 'matrix', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  return {
    requestedSolverCarrierPath: parsed['solver-carrier'],
    requestedSourcePath: parsed.source,
    requestedMatrixPath: parsed.matrix,
    outputDirectory: path.resolve(parsed.output),
  };
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

async function clearOwnedOutput(outputDirectory) {
  for (const relative of OWNED_FILES) {
    await unlink(path.join(outputDirectory, relative)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  await rm(path.join(outputDirectory, CANDIDATE_DIRECTORY), {
    recursive: true,
    force: true,
  });
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

async function assertInputsDoNotAliasOutputs(args) {
  const outputDirectory = await realpath(args.outputDirectory);
  const inputs = [
    await realpath(path.resolve(args.requestedSolverCarrierPath)),
    await realpath(path.resolve(args.requestedSourcePath)),
    await realpath(path.resolve(args.requestedMatrixPath)),
  ];
  for (const relative of [...OWNED_FILES, 'run-report.json']) {
    const target = path.join(outputDirectory, relative);
    let effectiveTarget = target;
    try {
      effectiveTarget = await realpath(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (inputs.includes(effectiveTarget)) {
      throw new Error(`output path aliases an input: ${relative}`);
    }
  }
  const candidateRoot = path.join(outputDirectory, CANDIDATE_DIRECTORY);
  for (const input of inputs) {
    const relative = path.relative(candidateRoot, input);
    if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
      throw new Error(`candidate output directory contains an input: ${input}`);
    }
  }
}

function validateMatrix(matrix) {
  if (matrix?.schema !== MATRIX_SCHEMA) {
    throw new Error(`Pareto matrix schema must be ${MATRIX_SCHEMA}`);
  }
  if (!Array.isArray(matrix.candidates) || matrix.candidates.length === 0) {
    throw new Error('Pareto matrix requires at least one candidate');
  }
  const ids = new Set();
  for (const [index, candidate] of matrix.candidates.entries()) {
    if (!candidate || typeof candidate !== 'object' ||
        typeof candidate.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(candidate.id)) {
      throw new Error(`Pareto candidate ${index} requires a filesystem-safe id`);
    }
    if (ids.has(candidate.id)) throw new Error(`duplicate Pareto candidate id ${candidate.id}`);
    ids.add(candidate.id);
    if (!candidate.config || typeof candidate.config !== 'object' ||
        Array.isArray(candidate.config)) {
      throw new Error(`Pareto candidate ${candidate.id} requires an explicit config`);
    }
  }
}

function shapeChangeMetrics(result) {
  let maximumLocalTurningAngleChange = 0;
  let maximumTotalTurningAngleChange = 0;
  for (let cageIndex = 0; cageIndex < result.metrics.packed.cages.length; cageIndex += 1) {
    const initial = result.metrics.initial.cages[cageIndex].centerline.turningAngles;
    const packed = result.metrics.packed.cages[cageIndex].centerline.turningAngles;
    const changes = packed.map((angle, index) => Math.abs(angle - initial[index]));
    maximumLocalTurningAngleChange = Math.max(
      maximumLocalTurningAngleChange,
      ...changes,
    );
    maximumTotalTurningAngleChange = Math.max(
      maximumTotalTurningAngleChange,
      changes.reduce((sum, value) => sum + value, 0),
    );
  }
  return { maximumLocalTurningAngleChange, maximumTotalTurningAngleChange };
}

function summarizeCandidate(candidate, result, packedCarrierEntry) {
  const shape = shapeChangeMetrics(result);
  const maximumRelativeVolumeError = Math.max(
    ...result.metrics.packed.cages.map(cage => cage.relativeVolumeError),
  );
  const nonPositiveCellCount = result.metrics.packed.cages.reduce(
    (sum, cage) => sum + cage.nonPositiveCellCount,
    0,
  );
  const metrics = {
    pairwiseMovableTotalPenetration:
      result.metrics.packed.pairwise.movableTotalPenetration,
    pairwiseMovableMaximumPenetration:
      result.metrics.packed.pairwise.movableMaximumPenetration,
    skeletalMovableTotalPenetration:
      result.metrics.packed.skeletal.movableTotalPenetration,
    skeletalMovableMaximumPenetration:
      result.metrics.packed.skeletal.movableMaximumPenetration,
    maximumRelativeVolumeError,
    maximumLocalTurningAngleChange: shape.maximumLocalTurningAngleChange,
    maximumTotalTurningAngleChange: shape.maximumTotalTurningAngleChange,
    compartmentMaximumEscape: result.metrics.packed.compartment.maximumEscape,
    nonPositiveCellCount,
  };
  const feasible = result.fixedNodeMaximumDrift === 0 &&
    metrics.compartmentMaximumEscape <= candidate.config.convergenceTolerance &&
    metrics.nonPositiveCellCount === 0 &&
    metrics.maximumRelativeVolumeError <= candidate.config.maximumRelativeVolumeError &&
    metrics.maximumLocalTurningAngleChange <= candidate.config.maximumLocalTurningAngleChange &&
    metrics.maximumTotalTurningAngleChange <= candidate.config.maximumTotalTurningAngleChange;
  return {
    id: candidate.id,
    status: result.status,
    config: result.config,
    iterations: result.iterations,
    fixedNodeMaximumDrift: result.fixedNodeMaximumDrift,
    feasible,
    objectives: {
      contactResidual:
        metrics.pairwiseMovableTotalPenetration + metrics.skeletalMovableTotalPenetration,
      maximumLocalTurningAngleChange: metrics.maximumLocalTurningAngleChange,
    },
    metrics,
    packedCarrier: packedCarrierEntry,
  };
}

function dominates(left, right) {
  if (!left.feasible) return false;
  if (!right.feasible) return true;
  const leftValues = Object.values(left.objectives);
  const rightValues = Object.values(right.objectives);
  return leftValues.every((value, index) => value <= rightValues[index]) &&
    leftValues.some((value, index) => value < rightValues[index]);
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let args;
let phase = 'parse-arguments';
let reportPath = null;
let effectiveSolverCarrierPath = null;
let effectiveSourcePath = null;
let effectiveMatrixPath = null;
let solverCarrierFileSha256 = null;
let sourceFileSha256 = null;
let matrixFileSha256 = null;
let requestedCandidateCount = null;

try {
  args = parseArguments(rawArguments);
  await mkdir(args.outputDirectory, { recursive: true });
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  phase = 'validate-path-custody';
  await assertInputsDoNotAliasOutputs(args);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.outputDirectory);

  phase = 'read-inputs';
  effectiveSolverCarrierPath = await realpath(path.resolve(args.requestedSolverCarrierPath));
  effectiveSourcePath = await realpath(path.resolve(args.requestedSourcePath));
  effectiveMatrixPath = await realpath(path.resolve(args.requestedMatrixPath));
  const [solverCarrierBytes, sourceBytes, matrixBytes] = await Promise.all([
    readFile(effectiveSolverCarrierPath),
    readFile(effectiveSourcePath),
    readFile(effectiveMatrixPath),
  ]);
  solverCarrierFileSha256 = sha256(solverCarrierBytes);
  sourceFileSha256 = sha256(sourceBytes);
  matrixFileSha256 = sha256(matrixBytes);
  const solverCarrier = JSON.parse(solverCarrierBytes);
  const source = JSON.parse(sourceBytes);
  const matrix = JSON.parse(matrixBytes);

  phase = 'validate-matrix';
  validateMatrix(matrix);
  requestedCandidateCount = matrix.candidates.length;

  phase = 'solve-candidates';
  const candidates = [];
  for (const candidate of matrix.candidates) {
    const result = solveMuscleCompartmentRingCageContact(
      solverCarrier,
      source,
      candidate.config,
    );
    const configRelative = `${CANDIDATE_DIRECTORY}/${candidate.id}/config.json`;
    const configBytes = jsonBytes(candidate.config);
    await writeAtomic(path.join(args.outputDirectory, configRelative), configBytes);
    const relative = `${CANDIDATE_DIRECTORY}/${candidate.id}/packed-carrier.json`;
    const packedBytes = jsonBytes(result.packedCarrier);
    await writeAtomic(path.join(args.outputDirectory, relative), packedBytes);
    const summary = summarizeCandidate(candidate, result, {
      path: relative,
      sha256: sha256(packedBytes),
      identitySha256: result.packedCarrier.identity.sha256,
    });
    summary.configArtifact = {
      path: configRelative,
      sha256: sha256(configBytes),
    };
    candidates.push(summary);
  }

  phase = 'classify-pareto-frontier';
  const paretoCandidateIds = candidates
    .filter(candidate => !candidates.some(other =>
      other.id !== candidate.id && dominates(other, candidate)))
    .map(candidate => candidate.id);
  const sweepResult = {
    schema: RESULT_SCHEMA,
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: 'cage-contact-mechanism-selection-only',
    inputs: {
      solverCarrier: {
        requestedPath: args.requestedSolverCarrierPath,
        effectivePath: receiptPath(effectiveSolverCarrierPath),
        fileSha256: solverCarrierFileSha256,
        identitySha256: solverCarrier.identity.sha256,
      },
      source: {
        requestedPath: args.requestedSourcePath,
        effectivePath: receiptPath(effectiveSourcePath),
        fileSha256: sourceFileSha256,
        inputSha256: source.input.effective.sha256,
      },
      matrix: {
        requestedPath: args.requestedMatrixPath,
        effectivePath: receiptPath(effectiveMatrixPath),
        fileSha256: matrixFileSha256,
        schema: matrix.schema,
      },
    },
    requestedCandidateCount,
    effectiveCandidateCount: candidates.length,
    candidateCapApplied: false,
    objectives: ['contactResidual', 'maximumLocalTurningAngleChange'],
    candidates,
    paretoCandidateIds,
    visualStatus: 'pending-agent-inspection',
  };
  const sweepResultBytes = jsonBytes(sweepResult);
  phase = 'write-primary-artifacts';
  await writeAtomic(path.join(args.outputDirectory, 'sweep-result.json'), sweepResultBytes);
  const outputs = {
    sweepResult: { path: 'sweep-result.json', sha256: sha256(sweepResultBytes) },
  };
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    evidenceTrack: sweepResult.evidenceTrack,
    claimCeiling: sweepResult.claimCeiling,
    requestedSolverCarrierPath: args.requestedSolverCarrierPath,
    effectiveSolverCarrierPath: receiptPath(effectiveSolverCarrierPath),
    solverCarrierFileSha256,
    solverCarrierIdentitySha256: solverCarrier.identity.sha256,
    requestedSourcePath: args.requestedSourcePath,
    effectiveSourcePath: receiptPath(effectiveSourcePath),
    sourceFileSha256,
    sourceInputSha256: source.input.effective.sha256,
    requestedMatrixPath: args.requestedMatrixPath,
    effectiveMatrixPath: receiptPath(effectiveMatrixPath),
    matrixFileSha256,
    requestedCandidateCount,
    effectiveCandidateCount: candidates.length,
    candidateCapApplied: false,
    paretoCandidateIds,
    outputs,
    visualStatus: sweepResult.visualStatus,
    lastTrustworthyEvidence: {
      phase: 'sweep-result-written',
      effectiveCandidateCount: candidates.length,
      paretoCandidateIds,
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    effectiveCandidateCount: report.effectiveCandidateCount,
    paretoCandidateIds,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.outputDirectory || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    await clearOwnedOutput(outputDirectory);
    await writeAtomic(reportPath, jsonBytes({
      schema: REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      requestedSolverCarrierPath: args?.requestedSolverCarrierPath || null,
      effectiveSolverCarrierPath: effectiveSolverCarrierPath
        ? receiptPath(effectiveSolverCarrierPath)
        : null,
      solverCarrierFileSha256,
      requestedSourcePath: args?.requestedSourcePath || null,
      effectiveSourcePath: effectiveSourcePath ? receiptPath(effectiveSourcePath) : null,
      sourceFileSha256,
      requestedMatrixPath: args?.requestedMatrixPath || null,
      effectiveMatrixPath: effectiveMatrixPath ? receiptPath(effectiveMatrixPath) : null,
      matrixFileSha256,
      requestedCandidateCount,
      effectiveCandidateCount: null,
      candidateCapApplied: false,
      outputs: null,
      visualStatus: null,
      lastTrustworthyEvidence: {
        phase: solverCarrierFileSha256 && sourceFileSha256 && matrixFileSha256
          ? 'inputs-read-and-hashed'
          : 'raw-arguments-captured',
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

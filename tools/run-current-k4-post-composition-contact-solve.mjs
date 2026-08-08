#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const CONFIG_SCHEMA =
  'kaminos.current-k4-post-composition-contact-solve-config.v0';
const FRONTIER_SCHEMA =
  'kaminos.current-k4-ring-cage-contact-normal-ramp-frontier-result.v0';
const RESULT_SCHEMA =
  'kaminos.current-k4-post-composition-contact-solve-result.v0';
const REPORT_SCHEMA =
  'kaminos.current-k4-post-composition-contact-solve-run-report.v0';
const CUSTODY_MARKER =
  '.kaminos-current-k4-post-composition-contact-solve-output';
const CUSTODY_SCHEMA =
  'kaminos.current-k4-post-composition-contact-solve-output-custody.v0';
const CUSTODY_BYTES = Buffer.from(`${CUSTODY_SCHEMA}\n`);
const CANDIDATE_DIRECTORY = 'candidates';
const OWNED_PATHS = Object.freeze(['solve-result.json', CANDIDATE_DIRECTORY]);
const CLAIM_CEILING =
  'agent-authored provisional current-graph K4 mechanism selection only';

function parseArguments(argv) {
  const supported = new Set(['--frontier', '--source', '--config', '--output']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['frontier', 'source', 'config', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  return {
    requestedFrontierPath: parsed.frontier,
    requestedSourcePath: parsed.source,
    requestedConfigPath: parsed.config,
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
    return (await readFile(path.join(outputDirectory, CUSTODY_MARKER))).equals(
      CUSTODY_BYTES,
    );
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

function resolveRecordedPath(recorded, baseDirectory) {
  if (typeof recorded !== 'string') throw new Error('recorded path is missing');
  if (recorded.startsWith('repo://')) {
    return path.resolve(process.cwd(), recorded.slice('repo://'.length));
  }
  return path.resolve(baseDirectory, recorded);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateConfig(config) {
  if (config?.schema !== CONFIG_SCHEMA ||
      !exactKeys(config, ['includeReferenceControl', 'schema', 'solver'])) {
    throw new Error(`post-composition solve requires exact ${CONFIG_SCHEMA}`);
  }
  if (typeof config.includeReferenceControl !== 'boolean') {
    throw new Error('post-composition solve includeReferenceControl must be boolean');
  }
  if (!exactKeys(config.solver, [
    'convergenceTolerance',
    'curvatureRegularization',
    'maxIterations',
    'maximumLocalTurningAngleChange',
    'maximumRelativeVolumeError',
    'maximumTotalTurningAngleChange',
    'relaxationStep',
  ]) || !Number.isInteger(config.solver.maxIterations) ||
      config.solver.maxIterations <= 0 ||
      [
        'convergenceTolerance',
        'curvatureRegularization',
        'maximumLocalTurningAngleChange',
        'maximumRelativeVolumeError',
        'maximumTotalTurningAngleChange',
        'relaxationStep',
      ].some(key => !Number.isFinite(config.solver[key]) ||
        !(config.solver[key] > 0))) {
    throw new Error('post-composition solve solver config is invalid');
  }
}

function maximumVolumeError(measurement) {
  return Math.max(...measurement.cages.map(cage => cage.relativeVolumeError));
}

function nonPositiveCellCount(measurement) {
  return measurement.cages.reduce((sum, cage) => sum + cage.nonPositiveCellCount, 0);
}

function metricVector(measurement) {
  return {
    pairwiseMovableTotalPenetration: measurement.pairwise.movableTotalPenetration,
    pairwiseMovableMaximumPenetration: measurement.pairwise.movableMaximumPenetration,
    pairwiseFixedTotalPenetration: measurement.pairwise.fixedTotalPenetration,
    pairwiseFixedMaximumPenetration: measurement.pairwise.fixedMaximumPenetration,
    skeletalTotalPenetration: measurement.skeletal.totalPenetration,
    maximumRelativeVolumeError: maximumVolumeError(measurement),
  };
}

function dominates(left, right) {
  const keys = [
    'pairwiseMovableTotalPenetration',
    'pairwiseMovableMaximumPenetration',
    'pairwiseFixedTotalPenetration',
    'pairwiseFixedMaximumPenetration',
    'skeletalTotalPenetration',
  ];
  return keys.every(key => left[key] <= right[key]) &&
    keys.some(key => left[key] < right[key]);
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
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  phase = 'claim-output-custody';
  await claimOutputCustody(args.outputDirectory);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.outputDirectory);
  const frontierPath = await realpath(path.resolve(args.requestedFrontierPath));
  const sourcePath = await realpath(path.resolve(args.requestedSourcePath));
  const configPath = await realpath(path.resolve(args.requestedConfigPath));
  phase = 'read-inputs';
  const [frontierBytes, sourceBytes, configBytes] = await Promise.all([
    readFile(frontierPath),
    readFile(sourcePath),
    readFile(configPath),
  ]);
  inputReceipts = {
    frontier: {
      requestedPath: receiptPath(path.resolve(args.requestedFrontierPath)),
      effectivePath: receiptPath(frontierPath),
      sha256: sha256(frontierBytes),
    },
    source: {
      requestedPath: receiptPath(path.resolve(args.requestedSourcePath)),
      effectivePath: receiptPath(sourcePath),
      sha256: sha256(sourceBytes),
    },
    config: {
      requestedPath: receiptPath(path.resolve(args.requestedConfigPath)),
      effectivePath: receiptPath(configPath),
      sha256: sha256(configBytes),
    },
  };
  const frontier = JSON.parse(frontierBytes);
  const source = JSON.parse(sourceBytes);
  const config = JSON.parse(configBytes);
  phase = 'validate-config';
  validateConfig(config);
  phase = 'verify-frontier-input';
  if (frontier?.schema !== FRONTIER_SCHEMA || frontier.status !== 'completed') {
    throw new Error(`post-composition solve requires completed ${FRONTIER_SCHEMA}`);
  }
  if (frontier.inputs.source.sha256 !== inputReceipts.source.sha256) {
    throw new Error('post-composition solve source identity mismatch');
  }
  phase = 'resolve-seed-carriers';
  const seeds = [];
  for (const candidateId of frontier.nondominatedCandidateIds) {
    const candidate = frontier.candidates.find(row =>
      row.id === candidateId && row.packedCarrier);
    if (!candidate) {
      throw new Error(`post-composition solve lacks retained candidate ${candidateId}`);
    }
    const carrierPath = await realpath(path.resolve(
      path.dirname(frontierPath),
      candidate.packedCarrier.path,
    ));
    const carrierBytes = await readFile(carrierPath);
    if (sha256(carrierBytes) !== candidate.packedCarrier.sha256) {
      throw new Error(
        `post-composition solve seed ${candidateId} file identity mismatch`,
      );
    }
    seeds.push({
      id: `solve-${candidate.id}`,
      seedCandidateId: candidate.id,
      requested: {
        seedCandidateId: candidate.id,
        compressionSections: structuredClone(candidate.requested.compressionSections),
        repaymentSectionIds: structuredClone(candidate.requested.repaymentSectionIds),
        anisotropyPeakScale: candidate.requested.anisotropyPeakScale,
        anisotropyShoulderScale: candidate.requested.anisotropyShoulderScale,
      },
      carrier: JSON.parse(carrierBytes),
    });
  }
  const selectedCarrierPath = await realpath(resolveRecordedPath(
    frontier.inputs.selectedCarrier.effectivePath,
    path.dirname(frontierPath),
  ));
  const selectedCarrierBytes = await readFile(selectedCarrierPath);
  if (sha256(selectedCarrierBytes) !== frontier.inputs.selectedCarrier.sha256) {
    throw new Error('post-composition solve reference carrier file identity mismatch');
  }
  const selectedCarrier = JSON.parse(selectedCarrierBytes);
  if (selectedCarrier.identity.sha256 !== frontier.selectedReference.carrierSha256) {
    throw new Error('post-composition solve reference semantic identity mismatch');
  }
  if (config.includeReferenceControl) {
    seeds.push({
      id: 'solve-reference-control',
      seedCandidateId: null,
      requested: {
        seedCandidateId: null,
        compressionSections: [],
        repaymentSectionIds: [],
        anisotropyPeakScale: null,
        anisotropyShoulderScale: null,
      },
      carrier: selectedCarrier,
    });
  }
  phase = 'measure-reference';
  const referenceMeasurement = measureMuscleCompartmentRingCageContactState(
    selectedCarrier,
    source,
  );
  const referenceMetrics = metricVector(referenceMeasurement);
  const requestedCandidateCount = seeds.length;
  const candidates = [];
  phase = 'evaluate-candidates';
  for (const seed of seeds) {
    try {
      const solve = solveMuscleCompartmentRingCageContact(
        seed.carrier,
        source,
        config.solver,
      );
      const measurement = solve.metrics.packed;
      const ledger = measureMuscleCompartmentRingCageContactResidualLedger(
        solve.packedCarrier,
        source,
      );
      const seedMetrics = metricVector(solve.metrics.initial);
      const metrics = {
        ...metricVector(measurement),
        nonPositiveCellCount: nonPositiveCellCount(measurement),
        compartmentMaximumEscape: measurement.compartment.maximumEscape,
        fixedNodeMaximumDrift: solve.fixedNodeMaximumDrift,
        iterationsAccepted: solve.iterations,
        terminationReason: solve.termination.reason,
        solveStatus: solve.status,
        skeletalPenetrationIncrease:
          measurement.skeletal.totalPenetration -
          referenceMeasurement.skeletal.totalPenetration,
      };
      const refusalReasons = [];
      if (metrics.fixedNodeMaximumDrift !== 0) refusalReasons.push('fixed-node-drift');
      if (metrics.nonPositiveCellCount !== 0) refusalReasons.push('non-positive-cell');
      if (metrics.maximumRelativeVolumeError >
          config.solver.maximumRelativeVolumeError) {
        refusalReasons.push('volume-ceiling');
      }
      const carrierRelative =
        `${CANDIDATE_DIRECTORY}/${seed.id}-packed-carrier.json`;
      const ledgerRelative =
        `${CANDIDATE_DIRECTORY}/${seed.id}-residual-ledger.json`;
      const receiptRelative =
        `${CANDIDATE_DIRECTORY}/${seed.id}-solve-application.json`;
      const carrierBytes = jsonBytes(solve.packedCarrier);
      const ledgerBytes = jsonBytes(ledger);
      const { packedCarrier: _packedCarrier, ...solveReceipt } = solve;
      const receiptBytes = jsonBytes({
        ...solveReceipt,
        outputCarrierSha256: solve.packedCarrier.identity.sha256,
        seedMetrics,
      });
      await writeAtomic(path.join(args.outputDirectory, carrierRelative), carrierBytes);
      await writeAtomic(path.join(args.outputDirectory, ledgerRelative), ledgerBytes);
      await writeAtomic(path.join(args.outputDirectory, receiptRelative), receiptBytes);
      candidates.push({
        id: seed.id,
        status: refusalReasons.length === 0 ? 'admissible' : 'measured-refused',
        requested: seed.requested,
        seedMetrics,
        metrics,
        packedCarrier: { path: carrierRelative, sha256: sha256(carrierBytes) },
        residualLedger: { path: ledgerRelative, sha256: sha256(ledgerBytes) },
        solveApplication: { path: receiptRelative, sha256: sha256(receiptBytes) },
        refusalReasons,
        error: null,
      });
    } catch (error) {
      candidates.push({
        id: seed.id,
        status: 'application-refused',
        requested: seed.requested,
        seedMetrics: null,
        metrics: null,
        packedCarrier: null,
        residualLedger: null,
        solveApplication: null,
        refusalReasons: [],
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  }
  const admissible = candidates.filter(candidate => candidate.status === 'admissible');
  const nondominatedCandidateIds = admissible
    .filter(candidate => !admissible.some(other =>
      other.id !== candidate.id && dominates(other.metrics, candidate.metrics)))
    .map(candidate => candidate.id);
  const solveResult = {
    schema: RESULT_SCHEMA,
    status: 'completed',
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: CLAIM_CEILING,
    inputs: {
      ...inputReceipts,
      selectedCarrier: structuredClone(frontier.inputs.selectedCarrier),
      source: structuredClone(frontier.inputs.source),
    },
    requestedCandidateIds: candidates.map(candidate => candidate.id),
    selectedReference: {
      carrierSha256: selectedCarrier.identity.sha256,
      metrics: referenceMetrics,
    },
    solverContract: structuredClone(config.solver),
    anisotropyContract: structuredClone(frontier.anisotropyContract),
    candidates,
    nondominatedCandidateIds,
    visual: {
      status: 'pending-agent-inspection',
      requiredView: 'identity-bound-contact-region-close',
      candidateIds: candidates
        .filter(candidate => candidate.packedCarrier)
        .map(candidate => candidate.id),
      nondominatedCandidateIds,
    },
  };
  phase = 'write-solve-result';
  const solveResultBytes = jsonBytes(solveResult);
  await writeAtomic(
    path.join(args.outputDirectory, 'solve-result.json'),
    solveResultBytes,
  );
  const outputs = {
    solveResult: { path: 'solve-result.json', sha256: sha256(solveResultBytes) },
  };
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    evidenceTrack: solveResult.evidenceTrack,
    claimCeiling: CLAIM_CEILING,
    inputs: {
      ...inputReceipts,
      config: {
        ...inputReceipts.config,
        requested: config,
        effective: config,
        fallbackUsed: false,
      },
    },
    requestedCandidateCount,
    effectiveCandidateCount: candidates.length,
    candidateCapApplied: false,
    outputs,
    visual: solveResult.visual,
    lastTrustworthyEvidence: {
      phase: 'solve-result-written',
      solveResultSha256: outputs.solveResult.sha256,
      candidateIds: candidates.map(candidate => candidate.id),
      nondominatedCandidateIds,
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    requestedCandidateCount,
    admissibleCandidateCount: admissible.length,
    nondominatedCandidateIds,
    iterations: Object.fromEntries(candidates.map(candidate =>
      [candidate.id, candidate.metrics?.iterationsAccepted ?? null])),
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.outputDirectory || preScannedOutputDirectory;
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
      visual: null,
      lastTrustworthyEvidence: {
        phase: inputReceipts ? 'inputs-read-and-hashed' : 'raw-arguments-captured',
        inputs: inputReceipts,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

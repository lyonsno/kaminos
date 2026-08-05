#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  applyConstantAreaRingCageSectionAnisotropy,
  derivePressureAlignedRingCageSectionAnisotropy,
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const CONFIG_SCHEMA = 'kaminos.current-k4-anisotropy-frontier-config.v0';
const RESULT_SCHEMA = 'kaminos.current-k4-ring-cage-anisotropy-sweep-result.v0';
const REPORT_SCHEMA = 'kaminos.current-k4-ring-cage-anisotropy-sweep-run-report.v0';
const CLAIM_CEILING = 'agent-authored provisional current-graph K4 mechanism selection only';
const CANDIDATE_DIRECTORY = 'candidates';
const CHECKPOINT_DIRECTORY = 'checkpoints';
const OWNED_FILES = Object.freeze(['sweep-result.json']);
const CUSTODY_MARKER = '.kaminos-current-k4-anisotropy-sweep-output';
const CUSTODY_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-sweep-output-custody.v0';
const CUSTODY_BYTES = Buffer.from(`${CUSTODY_SCHEMA}\n`);

function parseArguments(argv) {
  const supported = new Set([
    '--solver-carrier',
    '--selected-carrier',
    '--source',
    '--config',
    '--output',
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['solver-carrier', 'selected-carrier', 'source', 'config', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  return {
    requestedSolverCarrierPath: parsed['solver-carrier'],
    requestedSelectedCarrierPath: parsed['selected-carrier'],
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

async function clearOwnedOutput(outputDirectory) {
  for (const relative of OWNED_FILES) {
    await unlink(path.join(outputDirectory, relative)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  await Promise.all([CANDIDATE_DIRECTORY, CHECKPOINT_DIRECTORY].map(relative =>
    rm(path.join(outputDirectory, relative), { recursive: true, force: true })));
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
    const bytes = await readFile(path.join(outputDirectory, CUSTODY_MARKER));
    return bytes.equals(CUSTODY_BYTES);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function claimOutputCustody(outputDirectory) {
  if (await hasOutputCustody(outputDirectory)) return;
  const lookalikePaths = [
    ...OWNED_FILES,
    'run-report.json',
    CANDIDATE_DIRECTORY,
    CHECKPOINT_DIRECTORY,
  ];
  const occupied = [];
  for (const relative of lookalikePaths) {
    if (await exists(path.join(outputDirectory, relative))) occupied.push(relative);
  }
  if (occupied.length > 0) {
    throw new Error(
      `refusing to claim unowned output containing ${occupied.join(', ')}`,
    );
  }
  await writeAtomic(path.join(outputDirectory, CUSTODY_MARKER), CUSTODY_BYTES);
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

function validateUniqueOrderedNumbers(values, label, predicate) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} requires at least one value`);
  }
  const seen = new Set();
  for (const value of values) {
    if (!Number.isFinite(value) || !predicate(value)) {
      throw new Error(`${label} contains invalid value ${value}`);
    }
    if (seen.has(value)) throw new Error(`${label} contains duplicate value ${value}`);
    seen.add(value);
  }
}

function validateConfig(config) {
  const keys = ['anisotropy', 'centerline', 'centerlineCheckpoints', 'compressionScales', 'schema'];
  if (config?.schema !== CONFIG_SCHEMA ||
      JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(keys)) {
    throw new Error(`anisotropy sweep requires exact ${CONFIG_SCHEMA}`);
  }
  if (!config.centerline || typeof config.centerline !== 'object' ||
      Array.isArray(config.centerline) || Object.hasOwn(config.centerline, 'maxIterations')) {
    throw new Error('anisotropy sweep centerline config must omit maxIterations');
  }
  if (!config.anisotropy || typeof config.anisotropy !== 'object' ||
      Array.isArray(config.anisotropy) ||
      JSON.stringify(Object.keys(config.anisotropy).sort()) !==
        JSON.stringify(['obstacleConstructionId', 'subjectConstructionId'])) {
    throw new Error('anisotropy sweep requires exact subject and obstacle construction ids');
  }
  validateUniqueOrderedNumbers(
    config.centerlineCheckpoints,
    'centerlineCheckpoints',
    value => Number.isInteger(value) && value > 0,
  );
  validateUniqueOrderedNumbers(
    config.compressionScales,
    'compressionScales',
    value => value > 0 && value <= 1,
  );
}

async function assertInputOutputSeparation(args) {
  await mkdir(args.outputDirectory, { recursive: true });
  const outputDirectory = await realpath(args.outputDirectory);
  const inputs = await Promise.all([
    args.requestedSolverCarrierPath,
    args.requestedSelectedCarrierPath,
    args.requestedSourcePath,
    args.requestedConfigPath,
  ].map(value => realpath(path.resolve(value))));
  for (const input of inputs) {
    const relative = path.relative(outputDirectory, input);
    if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
      throw new Error(`output directory contains input ${input}`);
    }
  }
  for (const relative of [...OWNED_FILES, 'run-report.json']) {
    const target = path.join(outputDirectory, relative);
    let effectiveTarget = target;
    try {
      effectiveTarget = await realpath(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (inputs.includes(effectiveTarget)) throw new Error(`output path aliases input ${relative}`);
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
    skeletalTotalPenetration: measurement.skeletal.totalPenetration,
  };
}

function dominates(left, right) {
  const keys = [
    'pairwiseMovableTotalPenetration',
    'pairwiseMovableMaximumPenetration',
    'pairwiseFixedTotalPenetration',
    'skeletalTotalPenetration',
  ];
  return keys.every(key => left[key] <= right[key]) && keys.some(key => left[key] < right[key]);
}

function scaleToken(scale) {
  return String(Math.round(scale * 100)).padStart(3, '0');
}

function candidateId(curvature, checkpoint, scale) {
  return `c${curvature}-i${String(checkpoint).padStart(3, '0')}-s${scaleToken(scale)}`;
}

function admissionFailures({ application, measurement, centerlineConfig }) {
  const maximumSectionAreaRelativeError = Math.max(
    ...application.sectionReceipts.map(receipt => receipt.relativeAreaError),
  );
  const values = {
    fixedNodeMaximumDrift: application.fixedNodeMaximumDrift,
    centerlineMaximumDrift: application.centerlineMaximumDrift,
    maximumSectionAreaRelativeError,
    nonPositiveCellCount: nonPositiveCellCount(measurement),
    maximumRelativeVolumeError: maximumVolumeError(measurement),
    compartmentMaximumEscape: measurement.compartment.maximumEscape,
  };
  const failures = [];
  if (values.fixedNodeMaximumDrift !== 0) failures.push('fixed-node-drift');
  if (values.centerlineMaximumDrift !== 0) failures.push('centerline-drift');
  if (values.maximumSectionAreaRelativeError > 1e-12) failures.push('section-area-error');
  if (values.nonPositiveCellCount !== 0) failures.push('nonpositive-cell');
  if (values.maximumRelativeVolumeError > centerlineConfig.maximumRelativeVolumeError) {
    failures.push('relative-volume-error');
  }
  if (values.compartmentMaximumEscape > centerlineConfig.convergenceTolerance) {
    failures.push('compartment-escape');
  }
  return { values, failures };
}

function inputReceipt(requestedPath, effectivePath, bytes, identity = {}) {
  return {
    requestedPath,
    effectivePath: receiptPath(effectivePath),
    fileSha256: sha256(bytes),
    ...identity,
  };
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let phase = 'parse-arguments';
let args;
let reportPath = null;
let inputReceipts = null;
let requestedCandidateCount = null;

try {
  args = parseArguments(rawArguments);
  await mkdir(args.outputDirectory, { recursive: true });
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  phase = 'validate-path-custody';
  await assertInputOutputSeparation(args);
  phase = 'claim-output-custody';
  await claimOutputCustody(args.outputDirectory);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.outputDirectory);

  phase = 'read-inputs';
  const paths = {
    solverCarrier: await realpath(path.resolve(args.requestedSolverCarrierPath)),
    selectedCarrier: await realpath(path.resolve(args.requestedSelectedCarrierPath)),
    source: await realpath(path.resolve(args.requestedSourcePath)),
    config: await realpath(path.resolve(args.requestedConfigPath)),
  };
  const bytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(
    async ([key, value]) => [key, await readFile(value)],
  )));
  const solverCarrier = JSON.parse(bytes.solverCarrier);
  const selectedCarrier = JSON.parse(bytes.selectedCarrier);
  const source = JSON.parse(bytes.source);
  const config = JSON.parse(bytes.config);
  inputReceipts = {
    solverCarrier: inputReceipt(
      args.requestedSolverCarrierPath,
      paths.solverCarrier,
      bytes.solverCarrier,
      { identitySha256: solverCarrier.identity.sha256 },
    ),
    selectedCarrier: inputReceipt(
      args.requestedSelectedCarrierPath,
      paths.selectedCarrier,
      bytes.selectedCarrier,
      { identitySha256: selectedCarrier.identity.sha256 },
    ),
    source: inputReceipt(
      args.requestedSourcePath,
      paths.source,
      bytes.source,
      { inputSha256: source.input.effective.sha256 },
    ),
    config: {
      ...inputReceipt(args.requestedConfigPath, paths.config, bytes.config),
      requested: config,
      effective: config,
      fallbackUsed: false,
    },
  };

  phase = 'validate-config';
  validateConfig(config);
  requestedCandidateCount = config.centerlineCheckpoints.length *
    config.compressionScales.length;
  const selectedMeasurement = measureMuscleCompartmentRingCageContactState(
    selectedCarrier,
    source,
  );
  const selectedMetrics = metricVector(selectedMeasurement);
  const checkpoints = [];
  const candidates = [];

  phase = 'solve-centerline-checkpoints';
  for (const checkpoint of config.centerlineCheckpoints) {
    const centerlineConfig = { ...config.centerline, maxIterations: checkpoint };
    const centerlineResult = solveMuscleCompartmentRingCageContact(
      solverCarrier,
      source,
      centerlineConfig,
    );
    if (centerlineResult.iterations !== checkpoint ||
        centerlineResult.termination.reason !== 'iteration-limit') {
      throw new Error(
        `centerline checkpoint ${checkpoint} stopped at ` +
        `${centerlineResult.iterations} (${centerlineResult.termination.reason})`,
      );
    }
    const checkpointLedger = measureMuscleCompartmentRingCageContactResidualLedger(
      centerlineResult.packedCarrier,
      source,
    );
    const checkpointDirectory = `${CHECKPOINT_DIRECTORY}/i${String(checkpoint).padStart(3, '0')}`;
    const carrierRelative = `${checkpointDirectory}/carrier.json`;
    const ledgerRelative = `${checkpointDirectory}/residual-ledger.json`;
    const carrierBytes = jsonBytes(centerlineResult.packedCarrier);
    const ledgerBytes = jsonBytes(checkpointLedger);
    await writeAtomic(path.join(args.outputDirectory, carrierRelative), carrierBytes);
    await writeAtomic(path.join(args.outputDirectory, ledgerRelative), ledgerBytes);
    checkpoints.push({
      iterations: checkpoint,
      config: centerlineResult.config,
      termination: centerlineResult.termination,
      metrics: {
        ...metricVector(centerlineResult.metrics.packed),
        maximumRelativeVolumeError: maximumVolumeError(centerlineResult.metrics.packed),
      },
      carrier: {
        path: carrierRelative,
        sha256: sha256(carrierBytes),
        identitySha256: centerlineResult.packedCarrier.identity.sha256,
      },
      residualLedger: { path: ledgerRelative, sha256: sha256(ledgerBytes) },
    });

    phase = `evaluate-anisotropy-checkpoint-${checkpoint}`;
    for (const compressionScale of config.compressionScales) {
      const id = candidateId(config.centerline.curvatureRegularization, checkpoint, compressionScale);
      const anisotropyConfig = { ...config.anisotropy, compressionScale };
      const selection = derivePressureAlignedRingCageSectionAnisotropy(
        centerlineResult.packedCarrier,
        checkpointLedger,
        anisotropyConfig,
      );
      const application = applyConstantAreaRingCageSectionAnisotropy(
        centerlineResult.packedCarrier,
        selection.adjustments,
      );
      const measurement = measureMuscleCompartmentRingCageContactState(
        application.outputCarrier,
        source,
      );
      const residualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
        application.outputCarrier,
        source,
      );
      const admission = admissionFailures({ application, measurement, centerlineConfig });
      const status = admission.failures.length === 0 ? 'admissible' : 'refused';
      const relativeRoot = `${CANDIDATE_DIRECTORY}/${id}`;
      const selectionBytes = jsonBytes(selection);
      const applicationBytes = jsonBytes({ ...application, outputCarrier: undefined });
      const ledgerBytesForCandidate = jsonBytes(residualLedger);
      await Promise.all([
        writeAtomic(path.join(args.outputDirectory, relativeRoot, 'selection.json'), selectionBytes),
        writeAtomic(path.join(args.outputDirectory, relativeRoot, 'application.json'), applicationBytes),
        writeAtomic(
          path.join(args.outputDirectory, relativeRoot, 'residual-ledger.json'),
          ledgerBytesForCandidate,
        ),
      ]);
      let packedCarrier = null;
      if (status === 'admissible') {
        const packedBytes = jsonBytes(application.outputCarrier);
        const relative = `${relativeRoot}/packed-carrier.json`;
        await writeAtomic(path.join(args.outputDirectory, relative), packedBytes);
        packedCarrier = {
          path: relative,
          sha256: sha256(packedBytes),
          identitySha256: application.outputCarrier.identity.sha256,
        };
      }
      const residualMetrics = metricVector(measurement);
      candidates.push({
        id,
        status,
        refusalReasons: admission.failures,
        centerlineCheckpoint: checkpoint,
        compressionScale,
        requested: { centerline: centerlineConfig, anisotropy: anisotropyConfig },
        effective: { centerline: centerlineResult.config, anisotropy: selection.effective },
        fallbackUsed: false,
        checkpointCarrierIdentitySha256: centerlineResult.packedCarrier.identity.sha256,
        selection: {
          path: `${relativeRoot}/selection.json`,
          sha256: sha256(selectionBytes),
          contactCount: selection.contactCount,
          sectionCount: selection.adjustments.length,
        },
        application: {
          path: `${relativeRoot}/application.json`,
          sha256: sha256(applicationBytes),
        },
        residualLedger: {
          path: `${relativeRoot}/residual-ledger.json`,
          sha256: sha256(ledgerBytesForCandidate),
        },
        packedCarrier,
        metrics: { ...residualMetrics, ...admission.values },
        comparisonToSelected: {
          improvedMovableTotal:
            residualMetrics.pairwiseMovableTotalPenetration <
              selectedMetrics.pairwiseMovableTotalPenetration,
          didNotWorsenMovableMaximum:
            residualMetrics.pairwiseMovableMaximumPenetration <=
              selectedMetrics.pairwiseMovableMaximumPenetration,
          didNotWorsenFixed:
            residualMetrics.pairwiseFixedTotalPenetration <=
              selectedMetrics.pairwiseFixedTotalPenetration,
          didNotWorsenSkeletal:
            residualMetrics.skeletalTotalPenetration <=
              selectedMetrics.skeletalTotalPenetration,
          didNotWorsenMaximumRelativeVolumeError:
            admission.values.maximumRelativeVolumeError <=
              maximumVolumeError(selectedMeasurement),
        },
      });
    }
  }

  phase = 'classify-frontier';
  const admissible = candidates.filter(candidate => candidate.status === 'admissible');
  const candidateCapApplied = candidates.length !== requestedCandidateCount;
  if (candidateCapApplied) {
    throw new Error(
      `effective candidate count ${candidates.length} did not preserve requested ` +
      `${requestedCandidateCount}`,
    );
  }
  const nondominatedCandidateIds = admissible
    .filter(candidate => !dominates(selectedMetrics, candidate.metrics) &&
      !admissible.some(other => other.id !== candidate.id && dominates(other.metrics, candidate.metrics)))
    .map(candidate => candidate.id);
  const sweepResult = {
    schema: RESULT_SCHEMA,
    status: 'completed',
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: CLAIM_CEILING,
    inputs: inputReceipts,
    requestedGrid: {
      centerlineCheckpoints: config.centerlineCheckpoints,
      compressionScales: config.compressionScales,
    },
    requestedCandidateCount,
    effectiveCandidateCount: candidates.length,
    candidateCapApplied,
    selectedReference: {
      carrierIdentitySha256: selectedCarrier.identity.sha256,
      metrics: {
        ...selectedMetrics,
        maximumRelativeVolumeError: maximumVolumeError(selectedMeasurement),
        nonPositiveCellCount: nonPositiveCellCount(selectedMeasurement),
        compartmentMaximumEscape: selectedMeasurement.compartment.maximumEscape,
      },
    },
    checkpoints,
    candidates,
    nondominatedCandidateIds,
    visual: {
      status: 'pending-agent-inspection',
      requestedCandidateIds: nondominatedCandidateIds,
      route: {
        requested: 'current-k4-ring-cage-anisotropy-frontier-contact-sheet-v0',
        effective: null,
        fallbackUsed: null,
      },
    },
  };
  const resultBytes = jsonBytes(sweepResult);
  phase = 'write-primary-artifacts';
  await writeAtomic(path.join(args.outputDirectory, 'sweep-result.json'), resultBytes);
  const outputs = {
    sweepResult: { path: 'sweep-result.json', sha256: sha256(resultBytes) },
  };
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    evidenceTrack: sweepResult.evidenceTrack,
    claimCeiling: CLAIM_CEILING,
    inputs: inputReceipts,
    requestedCandidateCount,
    effectiveCandidateCount: candidates.length,
    candidateCapApplied,
    admissibleCandidateCount: admissible.length,
    refusedCandidateCount: candidates.length - admissible.length,
    nondominatedCandidateIds,
    outputs,
    visual: sweepResult.visual,
    lastTrustworthyEvidence: {
      phase: 'sweep-result-written',
      sweepResultSha256: outputs.sweepResult.sha256,
      nondominatedCandidateIds,
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    requestedCandidateCount,
    effectiveCandidateCount: candidates.length,
    admissibleCandidateCount: report.admissibleCandidateCount,
    refusedCandidateCount: report.refusedCandidateCount,
    nondominatedCandidateIds,
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
      requestedCandidateCount,
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

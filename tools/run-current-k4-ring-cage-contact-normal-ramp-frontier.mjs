#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  applyConstantAreaRingCageSectionAnisotropy,
  applyLongitudinalRingCageSectionVolumeRamp,
  derivePressureAlignedRingCageSectionAnisotropy,
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const CONFIG_SCHEMA =
  'kaminos.current-k4-contact-normal-ramp-frontier-config.v0';
const RESULT_SCHEMA =
  'kaminos.current-k4-ring-cage-contact-normal-ramp-frontier-result.v0';
const REPORT_SCHEMA =
  'kaminos.current-k4-ring-cage-contact-normal-ramp-frontier-run-report.v0';
const COMPOSITION_SCHEMA =
  'kaminos.current-k4-contact-normal-composition-application.v0';
const CUSTODY_MARKER =
  '.kaminos-current-k4-contact-normal-ramp-frontier-output';
const CUSTODY_SCHEMA =
  'kaminos.current-k4-contact-normal-ramp-frontier-output-custody.v0';
const CUSTODY_BYTES = Buffer.from(`${CUSTODY_SCHEMA}\n`);
const CANDIDATE_DIRECTORY = 'candidates';
const OWNED_PATHS = Object.freeze(['frontier-result.json', CANDIDATE_DIRECTORY]);
const CLAIM_CEILING =
  'agent-authored provisional current-graph K4 mechanism selection only';

function parseArguments(argv) {
  const supported = new Set([
    '--selected-carrier', '--source', '--config', '--output',
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
  for (const key of ['selected-carrier', 'source', 'config', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  return {
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

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function scaleToken(scale) {
  return String(Math.round(scale * 100)).padStart(3, '0');
}

function shoulderScaleFor(peakScale) {
  return 1 - (1 - peakScale) / 2;
}

function validateConfig(config) {
  if (config?.schema !== CONFIG_SCHEMA ||
      !exactKeys(config, ['anisotropy', 'ramps', 'schema', 'shared'])) {
    throw new Error(`contact-normal ramp frontier requires exact ${CONFIG_SCHEMA}`);
  }
  if (!exactKeys(config.shared, [
    'constructionId',
    'maximumAdjacentAreaScaleDelta',
    'maximumRepaymentAreaScale',
    'maximumSectionAreaRelativeError',
    'maximumSkeletalPenetrationIncrease',
    'volumeRelativeTolerance',
  ]) || typeof config.shared.constructionId !== 'string' ||
      !Number.isFinite(config.shared.maximumRepaymentAreaScale) ||
      !(config.shared.maximumRepaymentAreaScale > 1) ||
      !Number.isFinite(config.shared.maximumAdjacentAreaScaleDelta) ||
      !(config.shared.maximumAdjacentAreaScaleDelta > 0) ||
      !Number.isFinite(config.shared.volumeRelativeTolerance) ||
      !(config.shared.volumeRelativeTolerance > 0) ||
      !Number.isFinite(config.shared.maximumSkeletalPenetrationIncrease) ||
      !(config.shared.maximumSkeletalPenetrationIncrease >= 0) ||
      !Number.isFinite(config.shared.maximumSectionAreaRelativeError) ||
      !(config.shared.maximumSectionAreaRelativeError > 0)) {
    throw new Error('contact-normal ramp frontier shared contract is invalid');
  }
  if (!exactKeys(config.anisotropy, [
    'obstacleConstructionId',
    'peakCompressionScales',
    'peakSectionId',
    'shoulderSectionId',
  ]) || typeof config.anisotropy.obstacleConstructionId !== 'string' ||
      typeof config.anisotropy.peakSectionId !== 'string' ||
      typeof config.anisotropy.shoulderSectionId !== 'string' ||
      config.anisotropy.peakSectionId === config.anisotropy.shoulderSectionId ||
      config.anisotropy.obstacleConstructionId === config.shared.constructionId) {
    throw new Error('contact-normal ramp frontier anisotropy contract is invalid');
  }
  const scales = config.anisotropy.peakCompressionScales;
  if (!Array.isArray(scales) || scales.length === 0 ||
      scales.some(scale => !Number.isFinite(scale) || !(scale > 0 && scale < 1)) ||
      new Set(scales).size !== scales.length) {
    throw new Error(
      'contact-normal ramp frontier requires unique peak compression scales in (0, 1)',
    );
  }
  if (!Array.isArray(config.ramps) || config.ramps.length === 0) {
    throw new Error('contact-normal ramp frontier requires ramps');
  }
  const seenIds = new Set();
  for (const ramp of config.ramps) {
    if (!exactKeys(ramp, ['compressionSections', 'id', 'repaymentSectionIds']) ||
        typeof ramp.id !== 'string' || ramp.id.length === 0 ||
        !/^[a-z0-9-]+$/.test(ramp.id) || seenIds.has(ramp.id) ||
        !Array.isArray(ramp.compressionSections) ||
        ramp.compressionSections.length === 0 ||
        !Array.isArray(ramp.repaymentSectionIds) ||
        ramp.repaymentSectionIds.length === 0) {
      throw new Error('contact-normal ramp frontier ramp shape or identity is invalid');
    }
    seenIds.add(ramp.id);
    const compressionIds = new Set();
    for (const row of ramp.compressionSections) {
      if (!exactKeys(row, ['areaScale', 'sectionId']) ||
          typeof row.sectionId !== 'string' || compressionIds.has(row.sectionId) ||
          !Number.isFinite(row.areaScale) || !(row.areaScale > 0 && row.areaScale < 1)) {
        throw new Error(`contact-normal ramp frontier ramp ${ramp.id} compression is invalid`);
      }
      compressionIds.add(row.sectionId);
    }
    if (!ramp.repaymentSectionIds.every(id => typeof id === 'string') ||
        new Set(ramp.repaymentSectionIds).size !== ramp.repaymentSectionIds.length ||
        ramp.repaymentSectionIds.some(id => compressionIds.has(id))) {
      throw new Error(`contact-normal ramp frontier ramp ${ramp.id} repayment is invalid`);
    }
  }
}

async function assertInputOutputSeparation(args) {
  await mkdir(args.outputDirectory, { recursive: true });
  const outputDirectory = await realpath(args.outputDirectory);
  const inputs = await Promise.all([
    args.requestedSelectedCarrierPath,
    args.requestedSourcePath,
    args.requestedConfigPath,
  ].map(value => realpath(path.resolve(value))));
  for (const input of inputs) {
    const relative = path.relative(outputDirectory, input);
    if (!path.isAbsolute(relative) && relative !== '..' &&
        !relative.startsWith(`..${path.sep}`)) {
      throw new Error(`output directory contains input ${input}`);
    }
  }
  return inputs;
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
  phase = 'assert-input-output-separation';
  const inputPaths = await assertInputOutputSeparation(args);
  phase = 'claim-output-custody';
  await claimOutputCustody(args.outputDirectory);
  phase = 'clear-stale-evidence';
  await clearOwnedOutput(args.outputDirectory);
  const [selectedCarrierPath, sourcePath, configPath] = inputPaths;
  phase = 'read-inputs';
  const [selectedCarrierBytes, sourceBytes, configBytes] = await Promise.all([
    readFile(selectedCarrierPath),
    readFile(sourcePath),
    readFile(configPath),
  ]);
  inputReceipts = {
    selectedCarrier: {
      requestedPath: receiptPath(path.resolve(args.requestedSelectedCarrierPath)),
      effectivePath: receiptPath(selectedCarrierPath),
      sha256: sha256(selectedCarrierBytes),
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
  const selectedCarrier = JSON.parse(selectedCarrierBytes);
  const source = JSON.parse(sourceBytes);
  const config = JSON.parse(configBytes);
  phase = 'validate-config';
  validateConfig(config);
  phase = 'measure-reference';
  const referenceMeasurement = measureMuscleCompartmentRingCageContactState(
    selectedCarrier,
    source,
  );
  const referenceMetrics = metricVector(referenceMeasurement);
  const requestedCompositions = config.ramps.flatMap(ramp =>
    config.anisotropy.peakCompressionScales.map(peakScale => ({ ramp, peakScale })));
  const requestedCandidateCount = requestedCompositions.length;
  const candidates = [];
  phase = 'evaluate-candidates';
  for (const { ramp, peakScale } of requestedCompositions) {
    const candidateIdentifier = `${ramp.id}-cn${scaleToken(peakScale)}`;
    const shoulderScale = shoulderScaleFor(peakScale);
    const requested = {
      rampId: ramp.id,
      compressionSections: structuredClone(ramp.compressionSections),
      repaymentSectionIds: structuredClone(ramp.repaymentSectionIds),
      anisotropyPeakScale: peakScale,
      anisotropyShoulderScale: shoulderScale,
      peakSectionId: config.anisotropy.peakSectionId,
      shoulderSectionId: config.anisotropy.shoulderSectionId,
      obstacleConstructionId: config.anisotropy.obstacleConstructionId,
    };
    try {
      const rampApplication = applyLongitudinalRingCageSectionVolumeRamp(
        selectedCarrier,
        {
          constructionId: config.shared.constructionId,
          compressionSections: ramp.compressionSections,
          repaymentSectionIds: ramp.repaymentSectionIds,
          maximumRepaymentAreaScale: config.shared.maximumRepaymentAreaScale,
          maximumAdjacentAreaScaleDelta: config.shared.maximumAdjacentAreaScaleDelta,
          volumeRelativeTolerance: config.shared.volumeRelativeTolerance,
        },
      );
      const rampLedger = measureMuscleCompartmentRingCageContactResidualLedger(
        rampApplication.outputCarrier,
        source,
      );
      const selection = derivePressureAlignedRingCageSectionAnisotropy(
        rampApplication.outputCarrier,
        rampLedger,
        {
          subjectConstructionId: config.shared.constructionId,
          obstacleConstructionId: config.anisotropy.obstacleConstructionId,
          compressionScale: peakScale,
        },
      );
      const derivedPeak = selection.adjustments.find(
        adjustment => adjustment.sectionId === config.anisotropy.peakSectionId,
      );
      if (!derivedPeak) {
        throw new Error(
          `contact-normal selection lacks peak section ` +
          `${config.anisotropy.peakSectionId}`,
        );
      }
      const anisotropyApplication = applyConstantAreaRingCageSectionAnisotropy(
        rampApplication.outputCarrier,
        [
          {
            constructionId: config.shared.constructionId,
            sectionId: config.anisotropy.peakSectionId,
            pressureDirection: derivedPeak.pressureDirection,
            compressionScale: peakScale,
          },
          {
            constructionId: config.shared.constructionId,
            sectionId: config.anisotropy.shoulderSectionId,
            pressureDirection: derivedPeak.pressureDirection,
            compressionScale: shoulderScale,
          },
        ],
      );
      const measurement = measureMuscleCompartmentRingCageContactState(
        anisotropyApplication.outputCarrier,
        source,
      );
      const ledger = measureMuscleCompartmentRingCageContactResidualLedger(
        anisotropyApplication.outputCarrier,
        source,
      );
      const maximumSectionAreaRelativeError = Math.max(
        ...anisotropyApplication.sectionReceipts.map(
          receipt => receipt.relativeAreaError,
        ),
      );
      const metrics = {
        ...metricVector(measurement),
        nonPositiveCellCount: nonPositiveCellCount(measurement),
        compartmentMaximumEscape: measurement.compartment.maximumEscape,
        fixedNodeMaximumDrift: Math.max(
          rampApplication.fixedNodeMaximumDrift,
          anisotropyApplication.fixedNodeMaximumDrift,
        ),
        centerlineMaximumDrift: Math.max(
          rampApplication.centerlineMaximumDrift,
          anisotropyApplication.centerlineMaximumDrift,
        ),
        transferVolumeRelativeError: rampApplication.finalVolumeRelativeError,
        repaymentAreaScale: rampApplication.effective.repaymentAreaScale,
        maximumAdjacentAreaScaleDelta: rampApplication.maximumAdjacentAreaScaleDelta,
        maximumSectionAreaRelativeError,
        skeletalPenetrationIncrease:
          measurement.skeletal.totalPenetration -
          referenceMeasurement.skeletal.totalPenetration,
      };
      const refusalReasons = [];
      if (metrics.fixedNodeMaximumDrift !== 0) refusalReasons.push('fixed-node-drift');
      if (metrics.centerlineMaximumDrift !== 0) refusalReasons.push('centerline-drift');
      if (metrics.nonPositiveCellCount !== 0) refusalReasons.push('non-positive-cell');
      if (metrics.compartmentMaximumEscape !== 0) refusalReasons.push('compartment-escape');
      if (metrics.transferVolumeRelativeError > config.shared.volumeRelativeTolerance) {
        refusalReasons.push('volume-tolerance');
      }
      if (metrics.maximumSectionAreaRelativeError >
          config.shared.maximumSectionAreaRelativeError) {
        refusalReasons.push('section-area-error');
      }
      if (metrics.skeletalPenetrationIncrease >
          config.shared.maximumSkeletalPenetrationIncrease) {
        refusalReasons.push('skeletal-penetration-increase');
      }
      const carrierRelative =
        `${CANDIDATE_DIRECTORY}/${candidateIdentifier}-packed-carrier.json`;
      const ledgerRelative =
        `${CANDIDATE_DIRECTORY}/${candidateIdentifier}-residual-ledger.json`;
      const compositionRelative =
        `${CANDIDATE_DIRECTORY}/${candidateIdentifier}-composition-application.json`;
      const carrierBytes = jsonBytes(anisotropyApplication.outputCarrier);
      const ledgerBytes = jsonBytes(ledger);
      const { outputCarrier: _rampCarrier, ...rampReceipt } = rampApplication;
      const {
        outputCarrier: _anisotropyCarrier,
        ...anisotropyReceipt
      } = anisotropyApplication;
      const compositionBytes = jsonBytes({
        schema: COMPOSITION_SCHEMA,
        candidateId: candidateIdentifier,
        ramp: rampReceipt,
        rampLedgerSourceCarrierSha256: rampLedger.sourceCarrierSha256,
        anisotropySelection: selection,
        anisotropyApplication: anisotropyReceipt,
      });
      await writeAtomic(path.join(args.outputDirectory, carrierRelative), carrierBytes);
      await writeAtomic(path.join(args.outputDirectory, ledgerRelative), ledgerBytes);
      await writeAtomic(
        path.join(args.outputDirectory, compositionRelative),
        compositionBytes,
      );
      candidates.push({
        id: candidateIdentifier,
        status: refusalReasons.length === 0 ? 'admissible' : 'measured-refused',
        requested,
        metrics,
        packedCarrier: { path: carrierRelative, sha256: sha256(carrierBytes) },
        residualLedger: { path: ledgerRelative, sha256: sha256(ledgerBytes) },
        compositionApplication: {
          path: compositionRelative,
          sha256: sha256(compositionBytes),
        },
        refusalReasons,
        error: null,
      });
    } catch (error) {
      candidates.push({
        id: candidateIdentifier,
        status: 'application-refused',
        requested,
        metrics: null,
        packedCarrier: null,
        residualLedger: null,
        compositionApplication: null,
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
  const frontier = {
    schema: RESULT_SCHEMA,
    status: 'completed',
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: CLAIM_CEILING,
    inputs: inputReceipts,
    requestedCandidateIds: candidates.map(candidate => candidate.id),
    selectedReference: {
      carrierSha256: selectedCarrier.identity.sha256,
      metrics: referenceMetrics,
    },
    sharedContract: structuredClone(config.shared),
    anisotropyContract: structuredClone(config.anisotropy),
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
  phase = 'write-frontier-result';
  const frontierBytes = jsonBytes(frontier);
  await writeAtomic(path.join(args.outputDirectory, 'frontier-result.json'), frontierBytes);
  const outputs = {
    frontierResult: { path: 'frontier-result.json', sha256: sha256(frontierBytes) },
  };
  const report = {
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    evidenceTrack: frontier.evidenceTrack,
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
    visual: frontier.visual,
    lastTrustworthyEvidence: {
      phase: 'frontier-result-written',
      frontierResultSha256: outputs.frontierResult.sha256,
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

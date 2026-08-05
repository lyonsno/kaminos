#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  applyConstantAreaRingCageSectionAnisotropy,
  derivePressureAlignedRingCageSectionAnisotropy,
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';

const RUN_REPORT_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-assay-run-report.v0';
const ASSAY_RESULT_SCHEMA =
  'kaminos.current-k4-ring-cage-anisotropy-assay-result.v0';
const CONFIG_SCHEMA =
  'kaminos.current-k4-anisotropy-budget-allocation-config.v0';
const VISUAL_BUNDLE_SCHEMA =
  'kaminos.current-k4-ring-cage-contact-visual-bundle.v0';
const VISUAL_ROUTE = 'current-k4-ring-cage-contact-orbitable-v0';
const PRIMARY_PATHS = Object.freeze([
  'assay-result.json',
  'comparison.json',
  'checkpoint-carrier.json',
  'checkpoint-residual-ledger.json',
  'anisotropy-selection.json',
  'anisotropy-receipt.json',
  'selected-carrier.json',
  'packed-carrier.json',
  'residual-ledger.json',
  'index.html',
]);
const VISUAL_PATHS = Object.freeze([
  'source-crowded.png',
  'contact-relieved.png',
  'source-crowded-side.png',
  'contact-relieved-side.png',
  'source-crowded-capture-report.json',
  'contact-relieved-capture-report.json',
  'source-crowded-side-capture-report.json',
  'contact-relieved-side-capture-report.json',
  'capture-route-verification.json',
  'visual-inspection.json',
  'interpretation.md',
]);
const OWNED_PATHS = Object.freeze([...PRIMARY_PATHS, ...VISUAL_PATHS]);

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

async function clearOwnedPaths(outputDirectory) {
  for (const relative of OWNED_PATHS) {
    await unlink(path.join(outputDirectory, relative)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

function outputEntry(relative, bytes) {
  return { path: relative, sha256: sha256(bytes) };
}

function routeReceipt() {
  return { requested: VISUAL_ROUTE, effective: VISUAL_ROUTE, fallbackUsed: false };
}

function visualBundleIdentity(selectedCarrier, packedCarrier, source, residualLedgerSha256) {
  const domain = {
    schema: VISUAL_BUNDLE_SCHEMA,
    route: VISUAL_ROUTE,
    sourceCarrierSha256: selectedCarrier.identity.sha256,
    packedCarrierSha256: packedCarrier.identity.sha256,
    sourceInputSha256: source.input.effective.sha256,
    residualLedgerSha256,
  };
  return { ...domain, sha256: sha256(Buffer.from(JSON.stringify(domain))) };
}

function identityBoundCaptureUrls(bundleIdentity) {
  const base = new URLSearchParams({
    bundle: bundleIdentity.sha256,
    source: bundleIdentity.sourceCarrierSha256,
    packed: bundleIdentity.packedCarrierSha256,
    ledger: bundleIdentity.residualLedgerSha256,
    routeRequested: VISUAL_ROUTE,
    routeEffective: VISUAL_ROUTE,
  });
  return [
    ['before', null],
    ['packed', null],
    ['before', 'side'],
    ['packed', 'side'],
  ].map(([state, view]) => {
    const query = new URLSearchParams(base);
    query.set('state', state);
    if (view) query.set('view', view);
    return `index.html?${query}`;
  });
}

function maximumVolumeError(measurement) {
  return Math.max(...measurement.cages.map(cage => cage.relativeVolumeError));
}

function nonPositiveCellCount(measurement) {
  return measurement.cages.reduce((sum, cage) => sum + cage.nonPositiveCellCount, 0);
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
  for (const relative of [...OWNED_PATHS, 'run-report.json']) {
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
}

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let phase = 'parse-arguments';
let args;
let reportPath = null;
let inputReceipts = null;

try {
  args = parseArguments(rawArguments);
  await mkdir(args.outputDirectory, { recursive: true });
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  phase = 'validate-path-custody';
  await assertInputOutputSeparation(args);
  phase = 'clear-stale-evidence';
  await clearOwnedPaths(args.outputDirectory);

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
  inputReceipts = Object.fromEntries(Object.entries(bytes).map(
    ([key, value]) => [key, { path: receiptPath(paths[key]), sha256: sha256(value) }],
  ));
  const initialCarrier = JSON.parse(bytes.solverCarrier);
  const selectedCarrier = JSON.parse(bytes.selectedCarrier);
  const source = JSON.parse(bytes.source);
  const config = JSON.parse(bytes.config);
  if (config?.schema !== CONFIG_SCHEMA ||
      JSON.stringify(Object.keys(config).sort()) !==
        JSON.stringify(['anisotropy', 'centerline', 'schema'])) {
    throw new Error(`anisotropy assay requires ${CONFIG_SCHEMA} with centerline and anisotropy`);
  }

  phase = 'measure-selected-reference';
  const selectedMeasurement = measureMuscleCompartmentRingCageContactState(
    selectedCarrier,
    source,
  );
  phase = 'solve-centerline-checkpoint';
  const centerlineResult = solveMuscleCompartmentRingCageContact(
    initialCarrier,
    source,
    config.centerline,
  );
  if (centerlineResult.iterations !== config.centerline.maxIterations ||
      centerlineResult.termination.reason !== 'iteration-limit') {
    throw new Error(
      `centerline checkpoint did not reach the requested iteration horizon: ` +
      `${centerlineResult.iterations}/${config.centerline.maxIterations} ` +
      `${centerlineResult.termination.reason}`,
    );
  }
  const checkpointLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    centerlineResult.packedCarrier,
    source,
  );

  phase = 'derive-pressure-anisotropy';
  const selection = derivePressureAlignedRingCageSectionAnisotropy(
    centerlineResult.packedCarrier,
    checkpointLedger,
    config.anisotropy,
  );
  const anisotropy = applyConstantAreaRingCageSectionAnisotropy(
    centerlineResult.packedCarrier,
    selection.adjustments,
  );
  phase = 'measure-coupled-proposal';
  const packedMeasurement = measureMuscleCompartmentRingCageContactState(
    anisotropy.outputCarrier,
    source,
  );
  const residualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    anisotropy.outputCarrier,
    source,
  );
  const maximumPackedVolumeError = maximumVolumeError(packedMeasurement);
  if (anisotropy.fixedNodeMaximumDrift !== 0 ||
      anisotropy.centerlineMaximumDrift !== 0 ||
      anisotropy.sectionReceipts.some(receipt => receipt.relativeAreaError > 1e-12) ||
      nonPositiveCellCount(packedMeasurement) !== 0 ||
      maximumPackedVolumeError > config.centerline.maximumRelativeVolumeError ||
      packedMeasurement.compartment.maximumEscape > config.centerline.convergenceTolerance) {
    throw new Error('coupled anisotropy proposal violated a carrier admission predicate');
  }
  const improvedMovable = packedMeasurement.pairwise.movableTotalPenetration <
    selectedMeasurement.pairwise.movableTotalPenetration;
  const didNotWorsenMovableMaximum =
    packedMeasurement.pairwise.movableMaximumPenetration <=
      selectedMeasurement.pairwise.movableMaximumPenetration;
  const didNotWorsenFixed = packedMeasurement.pairwise.fixedTotalPenetration <=
    selectedMeasurement.pairwise.fixedTotalPenetration;
  const didNotWorsenSkeletal = packedMeasurement.skeletal.totalPenetration <=
    selectedMeasurement.skeletal.totalPenetration;
  const comparison = {
    schema: 'kaminos.current-k4-ring-cage-anisotropy-comparison.v0',
    status: 'completed',
    selected: {
      carrierSha256: selectedCarrier.identity.sha256,
      pairwiseMovableTotalPenetration:
        selectedMeasurement.pairwise.movableTotalPenetration,
      pairwiseMovableMaximumPenetration:
        selectedMeasurement.pairwise.movableMaximumPenetration,
      pairwiseFixedTotalPenetration: selectedMeasurement.pairwise.fixedTotalPenetration,
      skeletalTotalPenetration: selectedMeasurement.skeletal.totalPenetration,
      maximumRelativeVolumeError: maximumVolumeError(selectedMeasurement),
    },
    checkpoint: {
      carrierSha256: centerlineResult.packedCarrier.identity.sha256,
      iterations: centerlineResult.iterations,
      pairwiseMovableTotalPenetration:
        centerlineResult.metrics.packed.pairwise.movableTotalPenetration,
      maximumRelativeVolumeError: maximumVolumeError(centerlineResult.metrics.packed),
    },
    coupled: {
      carrierSha256: anisotropy.outputCarrier.identity.sha256,
      pairwiseMovableTotalPenetration: packedMeasurement.pairwise.movableTotalPenetration,
      pairwiseMovableMaximumPenetration: packedMeasurement.pairwise.movableMaximumPenetration,
      pairwiseFixedTotalPenetration: packedMeasurement.pairwise.fixedTotalPenetration,
      skeletalTotalPenetration: packedMeasurement.skeletal.totalPenetration,
      maximumRelativeVolumeError: maximumPackedVolumeError,
      nonPositiveCellCount: nonPositiveCellCount(packedMeasurement),
      compartmentMaximumEscape: packedMeasurement.compartment.maximumEscape,
      fixedNodeMaximumDrift: anisotropy.fixedNodeMaximumDrift,
      centerlineMaximumDrift: anisotropy.centerlineMaximumDrift,
      maximumSectionAreaRelativeError: Math.max(
        ...anisotropy.sectionReceipts.map(receipt => receipt.relativeAreaError),
      ),
    },
    decision: {
      classification: improvedMovable && didNotWorsenMovableMaximum &&
        didNotWorsenFixed && didNotWorsenSkeletal
        ? 'coupled-anisotropy-scalar-advance-pending-visual-admission'
        : improvedMovable && didNotWorsenFixed && didNotWorsenSkeletal
          ? 'coupled-anisotropy-nondominated-pending-visual-admission'
          : 'coupled-anisotropy-mechanism-rejected',
      improvedMovable,
      didNotWorsenMovableMaximum,
      didNotWorsenFixed,
      didNotWorsenSkeletal,
      claimCeiling: 'agent-authored provisional current-graph K4 mechanism selection only',
    },
  };

  phase = 'prepare-primary-artifacts';
  const checkpointLedgerBytes = jsonBytes(checkpointLedger);
  const residualLedgerBytes = jsonBytes(residualLedger);
  const route = routeReceipt();
  const bundleIdentity = visualBundleIdentity(
    selectedCarrier,
    anisotropy.outputCarrier,
    source,
    sha256(residualLedgerBytes),
  );
  const captureUrls = identityBoundCaptureUrls(bundleIdentity);
  const witnessResult = {
    status: comparison.decision.classification,
    fixedNodeMaximumDrift: anisotropy.fixedNodeMaximumDrift,
    termination: { reason: 'coupled-centerline-anisotropy-budget-selection' },
    metrics: { initial: selectedMeasurement, packed: packedMeasurement },
    packedCarrier: anisotropy.outputCarrier,
  };
  const artifacts = {
    assayResult: ['assay-result.json', jsonBytes({
      schema: ASSAY_RESULT_SCHEMA,
      status: 'completed',
      evidenceTrack: 'agent-authored-provisional',
      claimCeiling: comparison.decision.claimCeiling,
      inputs: inputReceipts,
      config: { requested: config, effective: config, fallbackUsed: false },
      centerline: {
        iterations: centerlineResult.iterations,
        termination: centerlineResult.termination,
        config: centerlineResult.config,
      },
      anisotropy: {
        selectionSchema: selection.schema,
        applicationSchema: anisotropy.schema,
        sectionCount: selection.adjustments.length,
      },
      comparison,
      visual: {
        route,
        status: 'pending-agent-inspection',
        bundleIdentity,
        captureUrls,
      },
    })],
    comparison: ['comparison.json', jsonBytes(comparison)],
    checkpointCarrier: ['checkpoint-carrier.json', jsonBytes(centerlineResult.packedCarrier)],
    checkpointResidualLedger: ['checkpoint-residual-ledger.json', checkpointLedgerBytes],
    anisotropySelection: ['anisotropy-selection.json', jsonBytes(selection)],
    anisotropyReceipt: ['anisotropy-receipt.json', jsonBytes({
      ...anisotropy,
      outputCarrier: undefined,
    })],
    selectedCarrier: ['selected-carrier.json', jsonBytes(selectedCarrier)],
    packedCarrier: ['packed-carrier.json', jsonBytes(anisotropy.outputCarrier)],
    residualLedger: ['residual-ledger.json', residualLedgerBytes],
    viewer: ['index.html', Buffer.from(renderMuscleCompartmentRingCageContactHtml({
      sourceCarrier: selectedCarrier,
      result: witnessResult,
      source,
      route,
      bundleIdentity,
      residualLedger,
    }))],
  };

  phase = 'write-primary-artifacts';
  for (const [, [relative, value]] of Object.entries(artifacts)) {
    await writeAtomic(path.join(args.outputDirectory, relative), value);
  }
  const outputs = Object.fromEntries(Object.entries(artifacts).map(
    ([key, [relative, value]]) => [key, outputEntry(relative, value)],
  ));
  const report = {
    schema: RUN_REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: comparison.decision.claimCeiling,
    inputs: inputReceipts,
    config: { requested: config, effective: config, fallbackUsed: false },
    resultStatus: comparison.decision.classification,
    outputs,
    comparison,
    visual: {
      route,
      status: 'pending-agent-inspection',
      viewer: outputs.viewer,
      bundleIdentity,
      captureUrls,
      expectedCaptures: VISUAL_PATHS.filter(relative => relative.endsWith('.png')),
      stateLabels: {
        source: 'Curvature-12 selected reference',
        proposal: 'Iteration-72 plus constant-area anisotropy proposal',
      },
    },
    lastTrustworthyEvidence: {
      phase: 'primary-artifacts-written',
      selectedCarrierSha256: selectedCarrier.identity.sha256,
      checkpointCarrierSha256: centerlineResult.packedCarrier.identity.sha256,
      packedCarrierSha256: anisotropy.outputCarrier.identity.sha256,
      residualLedgerSha256: outputs.residualLedger.sha256,
      decision: comparison.decision,
    },
  };
  phase = 'write-report';
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    resultStatus: report.resultStatus,
    route,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.outputDirectory || preScannedOutputDirectory;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    reportPath ||= path.join(outputDirectory, 'run-report.json');
    await clearOwnedPaths(outputDirectory);
    await writeAtomic(reportPath, jsonBytes({
      schema: RUN_REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      inputs: inputReceipts,
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

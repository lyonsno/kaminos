#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  applyLongitudinalRingCageSectionVolumeRedistribution,
  derivePressureDirectedLongitudinalRingCageVolumeRedistribution,
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';

const REPORT_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-assay-run-report.v0';
const CONFIG_SCHEMA =
  'kaminos.current-k4-longitudinal-volume-first-point-config.v0';
const COMPARISON_SCHEMA =
  'kaminos.current-k4-ring-cage-longitudinal-volume-comparison.v0';
const VISUAL_BUNDLE_SCHEMA = 'kaminos.current-k4-ring-cage-contact-visual-bundle.v0';
const VISUAL_ROUTE = 'current-k4-ring-cage-longitudinal-volume-orbitable-v0';
const CUSTODY_MARKER = '.kaminos-current-k4-longitudinal-volume-assay-output';
const CUSTODY_SCHEMA = 'kaminos.current-k4-longitudinal-volume-assay-output-custody.v0';
const OWNED_PATHS = Object.freeze([
  'comparison.json',
  'pressure-selection.json',
  'redistribution-receipt.json',
  'selected-carrier.json',
  'packed-carrier.json',
  'residual-ledger.json',
  'index.html',
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
]);

function parseArguments(argv) {
  const supported = new Set([
    '--selected-carrier', '--residual-ledger', '--source', '--config', '--output',
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!supported.has(key) || !value || value.startsWith('--')) {
      throw new Error(`invalid argument pair ${key || 'missing'} ${value || 'missing'}`);
    }
    values.set(key.slice(2), value);
  }
  for (const key of ['selected-carrier', 'residual-ledger', 'source', 'config', 'output']) {
    if (!values.has(key)) throw new Error(`--${key} is required`);
  }
  return {
    requestedSelectedCarrierPath: values.get('selected-carrier'),
    requestedResidualLedgerPath: values.get('residual-ledger'),
    requestedSourcePath: values.get('source'),
    requestedConfigPath: values.get('config'),
    outputDirectory: path.resolve(values.get('output')),
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
    return (await readFile(path.join(outputDirectory, CUSTODY_MARKER), 'utf8')) ===
      `${CUSTODY_SCHEMA}\n`;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
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
  await writeAtomic(
    path.join(outputDirectory, CUSTODY_MARKER),
    Buffer.from(`${CUSTODY_SCHEMA}\n`),
  );
}

async function clearOwnedPaths(outputDirectory) {
  await Promise.all(OWNED_PATHS.map(relative =>
    rm(path.join(outputDirectory, relative), { recursive: true, force: true })));
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)) {
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

function bundleIdentity(selectedCarrier, packedCarrier, source, residualLedgerSha256) {
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

function captureUrls(identity) {
  const base = new URLSearchParams({
    bundle: identity.sha256,
    source: identity.sourceCarrierSha256,
    packed: identity.packedCarrierSha256,
    ledger: identity.residualLedgerSha256,
    routeRequested: VISUAL_ROUTE,
    routeEffective: VISUAL_ROUTE,
  });
  return [['before', null], ['packed', null], ['before', 'side'], ['packed', 'side']]
    .map(([state, view]) => {
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

const rawArguments = process.argv.slice(2);
const preScannedOutputDirectory = preScanOutputDirectory(rawArguments);
let args = null;
let phase = 'parse-arguments';
let reportPath = null;
let inputReceipts = null;

try {
  args = parseArguments(rawArguments);
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  phase = 'claim-output-custody';
  await claimOutputCustody(args.outputDirectory);
  phase = 'clear-stale-evidence';
  await clearOwnedPaths(args.outputDirectory);
  const paths = {
    selectedCarrier: await realpath(path.resolve(args.requestedSelectedCarrierPath)),
    residualLedger: await realpath(path.resolve(args.requestedResidualLedgerPath)),
    source: await realpath(path.resolve(args.requestedSourcePath)),
    config: await realpath(path.resolve(args.requestedConfigPath)),
  };
  phase = 'read-inputs';
  const bytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(
    async ([key, value]) => [key, await readFile(value)],
  )));
  inputReceipts = Object.fromEntries(Object.entries(bytes).map(
    ([key, value]) => [key, { path: receiptPath(paths[key]), sha256: sha256(value) }],
  ));
  const selectedCarrier = JSON.parse(bytes.selectedCarrier);
  const sourceLedger = JSON.parse(bytes.residualLedger);
  const source = JSON.parse(bytes.source);
  const config = JSON.parse(bytes.config);
  phase = 'validate-config';
  if (config?.schema !== CONFIG_SCHEMA ||
      JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(['schema', 'selection'])) {
    throw new Error(`longitudinal volume assay requires ${CONFIG_SCHEMA}`);
  }

  phase = 'measure-selected-reference';
  const selectedMeasurement = measureMuscleCompartmentRingCageContactState(
    selectedCarrier,
    source,
  );
  phase = 'derive-pressure-selection';
  const selection = derivePressureDirectedLongitudinalRingCageVolumeRedistribution(
    selectedCarrier,
    sourceLedger,
    config.selection,
  );
  phase = 'apply-longitudinal-redistribution';
  const redistribution = applyLongitudinalRingCageSectionVolumeRedistribution(
    selectedCarrier,
    selection.operatorRequest,
  );
  phase = 'measure-proposal';
  const packedMeasurement = measureMuscleCompartmentRingCageContactState(
    redistribution.outputCarrier,
    source,
  );
  const residualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    redistribution.outputCarrier,
    source,
  );
  if (redistribution.fixedNodeMaximumDrift !== 0 ||
      redistribution.centerlineMaximumDrift !== 0 ||
      redistribution.finalVolumeRelativeError > config.selection.volumeRelativeTolerance ||
      nonPositiveCellCount(packedMeasurement) !== 0 ||
      packedMeasurement.compartment.maximumEscape !== 0) {
    throw new Error('longitudinal volume proposal violated a carrier predicate');
  }
  const improvedMovableMaximum =
    packedMeasurement.pairwise.movableMaximumPenetration <
      selectedMeasurement.pairwise.movableMaximumPenetration;
  const improvedMovableTotal = packedMeasurement.pairwise.movableTotalPenetration <
    selectedMeasurement.pairwise.movableTotalPenetration;
  const improvedFixedTotal = packedMeasurement.pairwise.fixedTotalPenetration <
    selectedMeasurement.pairwise.fixedTotalPenetration;
  const didNotWorsenSkeletal = packedMeasurement.skeletal.totalPenetration <=
    selectedMeasurement.skeletal.totalPenetration;
  const classification = improvedMovableMaximum && improvedFixedTotal &&
    didNotWorsenSkeletal
    ? improvedMovableTotal
      ? 'longitudinal-volume-scalar-advance-pending-visual-admission'
      : 'longitudinal-volume-nondominated-pending-visual-admission'
    : 'longitudinal-volume-mechanism-rejected';
  const comparison = {
    schema: COMPARISON_SCHEMA,
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
    proposal: {
      carrierSha256: redistribution.outputCarrier.identity.sha256,
      pairwiseMovableTotalPenetration: packedMeasurement.pairwise.movableTotalPenetration,
      pairwiseMovableMaximumPenetration:
        packedMeasurement.pairwise.movableMaximumPenetration,
      pairwiseFixedTotalPenetration: packedMeasurement.pairwise.fixedTotalPenetration,
      skeletalTotalPenetration: packedMeasurement.skeletal.totalPenetration,
      maximumRelativeVolumeError: maximumVolumeError(packedMeasurement),
      nonPositiveCellCount: nonPositiveCellCount(packedMeasurement),
      compartmentMaximumEscape: packedMeasurement.compartment.maximumEscape,
      fixedNodeMaximumDrift: redistribution.fixedNodeMaximumDrift,
      centerlineMaximumDrift: redistribution.centerlineMaximumDrift,
      transferVolumeRelativeError: redistribution.finalVolumeRelativeError,
      repaymentAreaScale: redistribution.effective.repaymentAreaScale,
    },
    decision: {
      classification,
      improvedMovableMaximum,
      improvedMovableTotal,
      improvedFixedTotal,
      didNotWorsenSkeletal,
      claimCeiling: 'agent-authored provisional current-graph K4 mechanism selection only',
    },
  };

  phase = 'prepare-primary-artifacts';
  const residualLedgerBytes = jsonBytes(residualLedger);
  const route = routeReceipt();
  const visualBundle = bundleIdentity(
    selectedCarrier,
    redistribution.outputCarrier,
    source,
    sha256(residualLedgerBytes),
  );
  const identityBoundCaptureUrls = captureUrls(visualBundle);
  const witnessResult = {
    status: classification,
    fixedNodeMaximumDrift: redistribution.fixedNodeMaximumDrift,
    termination: { reason: 'pressure-directed-longitudinal-volume-transfer' },
    metrics: { initial: selectedMeasurement, packed: packedMeasurement },
    packedCarrier: redistribution.outputCarrier,
  };
  const artifacts = {
    comparison: ['comparison.json', jsonBytes(comparison)],
    pressureSelection: ['pressure-selection.json', jsonBytes(selection)],
    redistributionReceipt: ['redistribution-receipt.json', jsonBytes({
      ...redistribution,
      outputCarrier: undefined,
    })],
    selectedCarrier: ['selected-carrier.json', jsonBytes(selectedCarrier)],
    packedCarrier: ['packed-carrier.json', jsonBytes(redistribution.outputCarrier)],
    residualLedger: ['residual-ledger.json', residualLedgerBytes],
    viewer: ['index.html', Buffer.from(renderMuscleCompartmentRingCageContactHtml({
      sourceCarrier: selectedCarrier,
      result: witnessResult,
      source,
      route,
      bundleIdentity: visualBundle,
      residualLedger,
      presentation: {
        title: 'Current-K4 longitudinal volume transfer',
        explanation: 'The reference is the selected curvature-12 carrier. The proposal ' +
          'compresses the pressure-selected M45 section and repays the same construction ' +
          'volume into adjacent low-pressure sections. The lower local maximum and higher ' +
          'aggregate movable overlap remain a visual trade, not packing admission.',
        sourceLabel: 'Curvature-12 selected reference',
        proposalLabel: 'Longitudinal volume-transfer proposal',
      },
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
    schema: REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: comparison.decision.claimCeiling,
    inputs: inputReceipts,
    config: { requested: config, effective: config, fallbackUsed: false },
    resultStatus: classification,
    outputs,
    comparison,
    visual: {
      route,
      status: 'pending-agent-inspection',
      viewer: outputs.viewer,
      bundleIdentity: visualBundle,
      captureUrls: identityBoundCaptureUrls,
      expectedCaptures: [
        'source-crowded.png', 'contact-relieved.png',
        'source-crowded-side.png', 'contact-relieved-side.png',
      ],
      stateLabels: {
        source: 'Curvature-12 selected reference',
        proposal: 'Pressure-directed longitudinal volume transfer',
      },
    },
    lastTrustworthyEvidence: {
      phase: 'primary-artifacts-written',
      selectedCarrierSha256: selectedCarrier.identity.sha256,
      packedCarrierSha256: redistribution.outputCarrier.identity.sha256,
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
    const outputCustodyVerified = await hasOutputCustody(outputDirectory);
    if (outputCustodyVerified) await clearOwnedPaths(outputDirectory);
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

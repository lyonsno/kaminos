#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SCHEMA = 'kaminos.current-k4-curvature-challenger-comparison.v0';

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--selected', '--challenger', '--output'].includes(key) || !value || value.startsWith('--')) {
      throw new Error(`invalid argument pair ${key || 'missing'} ${value || 'missing'}`);
    }
    values.set(key.slice(2), value);
  }
  if (!values.get('selected') || !values.get('challenger') || !values.get('output')) {
    throw new Error('--selected, --challenger, and --output are required');
  }
  return {
    selectedDirectory: path.resolve(values.get('selected')),
    challengerDirectory: path.resolve(values.get('challenger')),
    outputPath: path.resolve(values.get('output')),
  };
}

function preScanOutputPath(argv) {
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === '--output' && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      return path.resolve(argv[index + 1]);
    }
  }
  return null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, jsonBytes(value));
  await rename(temporary, target);
}

async function readReceipt(directory, name) {
  const bytes = await readFile(path.join(directory, name));
  return { value: JSON.parse(bytes), sha256: sha256(bytes), name };
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function configWithoutRegularization(config) {
  const {
    curvatureRegularization: requestedRegularization,
    ...requested
  } = config.requested;
  const {
    curvatureRegularization: effectiveRegularization,
    ...effective
  } = config.effective;
  requireCondition(requestedRegularization === effectiveRegularization,
    'requested and effective curvature regularization differ');
  return {
    curvatureRegularization: effectiveRegularization,
    rest: { requested, effective, fallbackUsed: config.fallbackUsed },
  };
}

function aggregateDirectedContacts(ledger, fixed) {
  const groups = new Map();
  for (const contact of ledger.pairwise.contacts.filter(entry => entry.fixed === fixed)) {
    const pair = `${contact.subjectConstructionId}->${contact.obstacleConstructionId}`;
    const group = groups.get(pair) || { pair, count: 0, totalPenetration: 0, maximumPenetration: 0 };
    group.count += 1;
    group.totalPenetration += contact.penetration;
    group.maximumPenetration = Math.max(group.maximumPenetration, contact.penetration);
    groups.set(pair, group);
  }
  return [...groups.values()].sort((left, right) =>
    right.totalPenetration - left.totalPenetration || left.pair.localeCompare(right.pair));
}

function topologySummary(ledger) {
  const movableDirectedPairs = aggregateDirectedContacts(ledger, false);
  const fixedDirectedPairs = aggregateDirectedContacts(ledger, true);
  return {
    dominantMovableDirectedPair: movableDirectedPairs[0] || null,
    dominantFixedDirectedPair: fixedDirectedPairs[0] || null,
    movableDirectedPairs,
    fixedDirectedPairs,
    skeletalContactCount: ledger.skeletal.contacts.length,
  };
}

function validateInspection(routeVerification, inspection, label) {
  requireCondition(typeof inspection.status === 'string' && /inspected/i.test(inspection.status),
    `${label} visual inspection is missing or incomplete`);
  const verifiedHashes = routeVerification.captures.map(capture => capture.sha256);
  const inspectedHashes = inspection.captures.map(capture => capture.sha256);
  requireCondition(JSON.stringify(verifiedHashes) === JSON.stringify(inspectedHashes),
    `${label} visual inspection does not bind the verified capture set`);
}

function assaySummary(run, runHash, ledgerHash, visualHash) {
  return {
    curvatureRegularization: run.config.effective.curvatureRegularization,
    runReportSha256: runHash,
    residualLedgerSha256: ledgerHash,
    visualVerificationSha256: visualHash,
    iterations: run.iterations,
    termination: run.termination,
    movablePairwiseTotal: run.metrics.packed.pairwise.movableTotalPenetration,
    movablePairwiseMaximum: run.metrics.packed.pairwise.movableMaximumPenetration,
    fixedPairwiseTotal: run.metrics.packed.pairwise.fixedTotalPenetration,
    skeletalTotal: run.metrics.packed.skeletal.movableTotalPenetration,
    skeletalMaximum: run.metrics.packed.skeletal.movableMaximumPenetration,
    maximumRelativeVolumeError: Math.max(...run.metrics.packed.cages.map(
      cage => cage.relativeVolumeError)),
    nonPositiveCellCount: run.metrics.packed.cages.reduce(
      (sum, cage) => sum + cage.nonPositiveCellCount, 0),
    compartmentMaximumEscape: run.metrics.packed.compartment.maximumEscape,
    fixedNodeMaximumDrift: run.fixedNodeMaximumDrift,
  };
}

const rawArguments = process.argv.slice(2);
let outputPath = preScanOutputPath(rawArguments);
let phase = 'parse-arguments';

try {
  const args = parseArguments(rawArguments);
  outputPath = args.outputPath;
  phase = 'read-exact-receipts';
  const [selectedRun, selectedLedger, selectedVisual, selectedInspection,
    challengerRun, challengerLedger, challengerVisual, challengerInspection] = await Promise.all([
    readReceipt(args.selectedDirectory, 'run-report.json'),
    readReceipt(args.selectedDirectory, 'residual-ledger.json'),
    readReceipt(args.selectedDirectory, 'capture-route-verification.json'),
    readReceipt(args.selectedDirectory, 'visual-inspection.json'),
    readReceipt(args.challengerDirectory, 'run-report.json'),
    readReceipt(args.challengerDirectory, 'residual-ledger.json'),
    readReceipt(args.challengerDirectory, 'capture-route-verification.json'),
    readReceipt(args.challengerDirectory, 'visual-inspection.json'),
  ]);

  phase = 'validate-comparison-class';
  requireCondition(selectedRun.value.status === 'completed' && challengerRun.value.status === 'completed',
    'both assay runs must be completed');
  requireCondition(selectedVisual.value.status === 'verified' && challengerVisual.value.status === 'verified',
    'both visual routes must be independently verified');
  validateInspection(selectedVisual.value, selectedInspection.value, 'selected');
  validateInspection(challengerVisual.value, challengerInspection.value, 'challenger');
  requireCondition(selectedRun.value.sourceInputSha256 === challengerRun.value.sourceInputSha256,
    'source input identity differs across the comparison');
  requireCondition(JSON.stringify(selectedRun.value.effectiveConstructionIds) ===
    JSON.stringify(challengerRun.value.effectiveConstructionIds),
  'construction order differs across the comparison');
  const selectedConfig = configWithoutRegularization(selectedRun.value.config);
  const challengerConfig = configWithoutRegularization(challengerRun.value.config);
  requireCondition(JSON.stringify(selectedConfig.rest) === JSON.stringify(challengerConfig.rest),
    'comparison changed more than curvature regularization');

  phase = 'classify-topology';
  const selectedTopology = topologySummary(selectedLedger.value);
  const challengerTopology = topologySummary(challengerLedger.value);
  const residualFamily = {
    selected: selectedTopology,
    challenger: challengerTopology,
    sameDominantMovableDirectedPair:
      selectedTopology.dominantMovableDirectedPair?.pair ===
        challengerTopology.dominantMovableDirectedPair?.pair,
    sameDominantFixedDirectedPair:
      selectedTopology.dominantFixedDirectedPair?.pair ===
        challengerTopology.dominantFixedDirectedPair?.pair,
    sameSkeletalContactCount:
      selectedTopology.skeletalContactCount === challengerTopology.skeletalContactCount,
  };
  const dominantResidualFamilyPersists = residualFamily.sameDominantMovableDirectedPair &&
    residualFamily.sameDominantFixedDirectedPair && residualFamily.sameSkeletalContactCount;

  phase = 'write-comparison';
  const result = {
    schema: SCHEMA,
    status: 'completed',
    failurePhase: null,
    comparisonClass: {
      onlyRegularizationChanged: true,
      sameSourceInputIdentity: true,
      sameConstructionOrder: true,
      sourceInputSha256: selectedRun.value.sourceInputSha256,
      effectiveConstructionIds: selectedRun.value.effectiveConstructionIds,
      sharedConfig: selectedConfig.rest,
    },
    selected: assaySummary(selectedRun.value, selectedRun.sha256, selectedLedger.sha256,
      selectedVisual.sha256),
    challenger: assaySummary(challengerRun.value, challengerRun.sha256, challengerLedger.sha256,
      challengerVisual.sha256),
    residualFamily,
    visual: {
      selected: {
        routeVerificationStatus: selectedVisual.value.status,
        routeVerificationSha256: selectedVisual.sha256,
        inspectionStatus: selectedInspection.value.status,
        inspectionSha256: selectedInspection.sha256,
        bundleIdentity: selectedVisual.value.bundleIdentity.sha256,
        captureHashes: selectedVisual.value.captures.map(capture => capture.sha256),
      },
      challenger: {
        routeVerificationStatus: challengerVisual.value.status,
        routeVerificationSha256: challengerVisual.sha256,
        inspectionStatus: challengerInspection.value.status,
        inspectionSha256: challengerInspection.sha256,
        bundleIdentity: challengerVisual.value.bundleIdentity.sha256,
        captureHashes: challengerVisual.value.captures.map(capture => capture.sha256),
      },
    },
    decision: {
      classification: dominantResidualFamilyPersists
        ? 'dominant-residual-family-persists-under-curvature-challenger'
        : 'dominant-residual-family-changes-under-curvature-challenger',
      nextAssay: dominantResidualFamilyPersists
        ? 'constant-area-cross-section-anisotropy'
        : 'curvature-regularization-mechanism-refinement',
      claimCeiling: 'agent-authored provisional current-graph K4 mechanism selection only',
    },
  };
  await writeAtomic(outputPath, result);
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    outputPath,
    classification: result.decision.classification,
    nextAssay: result.decision.nextAssay,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (outputPath) {
    await writeAtomic(outputPath, {
      schema: SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      rawArguments,
      lastTrustworthyEvidence: phase,
    });
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  measureMuscleCompartmentRingCageContactResidualLedger,
  solveMuscleCompartmentRingCageContact,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.current-k4-ring-cage-contact-assay-run-report.v0';
const ASSAY_RESULT_SCHEMA = 'kaminos.current-k4-ring-cage-contact-assay-result.v0';
const VISUAL_BUNDLE_SCHEMA = 'kaminos.current-k4-ring-cage-contact-visual-bundle.v0';
const VISUAL_ROUTE = 'current-k4-ring-cage-contact-orbitable-v0';
const OWNED_RELATIVE_PATHS = Object.freeze([
  'assay-result.json',
  'residual-ledger.json',
  'source-carrier.json',
  'packed-carrier.json',
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
  'interpretation.md',
]);

function parseArguments(argv) {
  const supported = new Set(['--solver-carrier', '--source', '--config', '--output']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['solver-carrier', 'source', 'config', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  return {
    requestedSolverCarrierPath: parsed['solver-carrier'],
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

async function clearPaths(outputDirectory) {
  for (const relative of OWNED_RELATIVE_PATHS) {
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

function routeReceipt() {
  return { requested: VISUAL_ROUTE, effective: VISUAL_ROUTE, fallbackUsed: false };
}

function outputEntry(relative, bytes) {
  return { path: relative, sha256: sha256(bytes) };
}

function visualBundleIdentity(solverCarrier, packedCarrier, source, residualLedgerSha256) {
  const domain = {
    schema: VISUAL_BUNDLE_SCHEMA,
    route: VISUAL_ROUTE,
    sourceCarrierSha256: solverCarrier.identity.sha256,
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

async function assertInputsDoNotAliasOutputs(args) {
  const outputDirectory = await realpath(args.outputDirectory);
  const inputs = [
    await realpath(path.resolve(args.requestedSolverCarrierPath)),
    await realpath(path.resolve(args.requestedSourcePath)),
    await realpath(path.resolve(args.requestedConfigPath)),
  ];
  for (const relative of [...OWNED_RELATIVE_PATHS, 'run-report.json']) {
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
let effectiveSolverCarrierPath = null;
let effectiveSourcePath = null;
let effectiveConfigPath = null;
let solverCarrierFileSha256 = null;
let sourceFileSha256 = null;
let configFileSha256 = null;

try {
  args = parseArguments(rawArguments);
  await mkdir(args.outputDirectory, { recursive: true });
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  phase = 'validate-path-custody';
  await assertInputsDoNotAliasOutputs(args);
  phase = 'clear-stale-evidence';
  await clearPaths(args.outputDirectory);

  phase = 'read-inputs';
  effectiveSolverCarrierPath = await realpath(path.resolve(args.requestedSolverCarrierPath));
  effectiveSourcePath = await realpath(path.resolve(args.requestedSourcePath));
  effectiveConfigPath = await realpath(path.resolve(args.requestedConfigPath));
  const [solverCarrierBytes, sourceBytes, configBytes] = await Promise.all([
    readFile(effectiveSolverCarrierPath),
    readFile(effectiveSourcePath),
    readFile(effectiveConfigPath),
  ]);
  solverCarrierFileSha256 = sha256(solverCarrierBytes);
  sourceFileSha256 = sha256(sourceBytes);
  configFileSha256 = sha256(configBytes);
  const solverCarrier = JSON.parse(solverCarrierBytes);
  const source = JSON.parse(sourceBytes);
  const requestedConfig = JSON.parse(configBytes);

  phase = 'solve-contact';
  const result = solveMuscleCompartmentRingCageContact(
    solverCarrier,
    source,
    requestedConfig,
  );
  if (result.status !== 'residual-constraint') {
    throw new Error(`exact K4 assay requires an explicit residual proposal, got ${result.status}`);
  }
  if (result.fixedNodeMaximumDrift !== 0 ||
      result.metrics.packed.cages.some(row => row.nonPositiveCellCount !== 0)) {
    throw new Error('ring-cage contact proposal violated fixed-node or positive-cell custody');
  }
  const residualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    result.packedCarrier,
    source,
  );
  const residualLedgerBytes = jsonBytes(residualLedger);

  phase = 'prepare-primary-artifacts';
  const route = routeReceipt();
  const bundleIdentity = visualBundleIdentity(
    solverCarrier,
    result.packedCarrier,
    source,
    sha256(residualLedgerBytes),
  );
  const captureUrls = identityBoundCaptureUrls(bundleIdentity);
  const viewerBytes = Buffer.from(renderMuscleCompartmentRingCageContactHtml({
    sourceCarrier: solverCarrier,
    result,
    source,
    route,
    bundleIdentity,
    residualLedger,
  }));
  const sourceCarrierBytes = jsonBytes(solverCarrier);
  const packedCarrierBytes = jsonBytes(result.packedCarrier);
  const assayResult = {
    schema: ASSAY_RESULT_SCHEMA,
    evidenceTrack: 'agent-authored-provisional',
    claimCeiling: 'cage-contact-mechanism-selection-only',
    status: result.status,
    requestedConstructionIds: [...solverCarrier.orderedConstructionIds],
    effectiveConstructionIds: [...result.metrics.packed.orderedConstructionIds],
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
      config: {
        requestedPath: args.requestedConfigPath,
        effectivePath: receiptPath(effectiveConfigPath),
        fileSha256: configFileSha256,
      },
    },
    config: result.config,
    iterations: result.iterations,
    termination: result.termination,
    lineSearchHistory: result.lineSearchHistory,
    fixedNodeMaximumDrift: result.fixedNodeMaximumDrift,
    metrics: result.metrics,
    iterationHistory: result.iterationHistory,
    packedCarrierIdentity: result.packedCarrier.identity,
    visual: {
      route,
      status: 'pending-agent-inspection',
      bundleIdentity,
      captureUrls,
    },
  };
  const assayResultBytes = jsonBytes(assayResult);
  const artifacts = {
    assayResult: ['assay-result.json', assayResultBytes],
    residualLedger: ['residual-ledger.json', residualLedgerBytes],
    sourceCarrier: ['source-carrier.json', sourceCarrierBytes],
    packedCarrier: ['packed-carrier.json', packedCarrierBytes],
    viewer: ['index.html', viewerBytes],
  };

  phase = 'write-primary-artifacts';
  for (const [, [relative, bytes]] of Object.entries(artifacts)) {
    await writeAtomic(path.join(args.outputDirectory, relative), bytes);
  }
  const outputs = Object.fromEntries(
    Object.entries(artifacts).map(([key, [relative, bytes]]) => [key, outputEntry(relative, bytes)]),
  );
  const report = {
    schema: RUN_REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    evidenceTrack: assayResult.evidenceTrack,
    claimCeiling: assayResult.claimCeiling,
    resultStatus: result.status,
    requestedConstructionIds: assayResult.requestedConstructionIds,
    effectiveConstructionIds: assayResult.effectiveConstructionIds,
    requestedSolverCarrierPath: args.requestedSolverCarrierPath,
    effectiveSolverCarrierPath: receiptPath(effectiveSolverCarrierPath),
    solverCarrierFileSha256,
    solverCarrierIdentitySha256: solverCarrier.identity.sha256,
    requestedSourcePath: args.requestedSourcePath,
    effectiveSourcePath: receiptPath(effectiveSourcePath),
    sourceFileSha256,
    sourceInputSha256: source.input.effective.sha256,
    requestedConfigPath: args.requestedConfigPath,
    effectiveConfigPath: receiptPath(effectiveConfigPath),
    configFileSha256,
    config: result.config,
    iterations: result.iterations,
    termination: result.termination,
    lineSearchHistory: result.lineSearchHistory,
    fixedNodeMaximumDrift: result.fixedNodeMaximumDrift,
    metrics: result.metrics,
    outputs,
    residualLedger: outputs.residualLedger,
    visual: {
      route,
      status: 'pending-agent-inspection',
      viewer: outputs.viewer,
      bundleIdentity,
      captureUrls,
      expectedCaptures: [
        'source-crowded.png',
        'contact-relieved.png',
        'source-crowded-side.png',
        'contact-relieved-side.png',
      ],
      stateLabels: {
        source: 'Source crowded input',
        proposal: 'Curvature-bearing proposal · residual remains',
      },
    },
    lastTrustworthyEvidence: {
      phase: 'primary-artifacts-written',
      resultStatus: result.status,
      iterations: result.iterations,
      termination: result.termination,
      packedCarrierIdentitySha256: result.packedCarrier.identity.sha256,
      residualLedgerSha256: outputs.residualLedger.sha256,
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
    const fallbackReportPath = path.join(outputDirectory, 'run-report.json');
    reportPath ||= fallbackReportPath;
    await clearPaths(outputDirectory);
    await writeAtomic(reportPath, jsonBytes({
      schema: RUN_REPORT_SCHEMA,
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
      requestedConfigPath: args?.requestedConfigPath || null,
      effectiveConfigPath: effectiveConfigPath ? receiptPath(effectiveConfigPath) : null,
      configFileSha256,
      outputs: null,
      visual: null,
      lastTrustworthyEvidence: {
        phase: solverCarrierFileSha256 && sourceFileSha256 && configFileSha256
          ? 'inputs-read-and-hashed'
          : 'raw-arguments-captured',
        solverCarrierFileSha256,
        sourceFileSha256,
        configFileSha256,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  runAuthoredPackingTrajectoryAssay,
  validateAuthoredPackingSweepManifest,
} from '../authored-packing-sweep-core.mjs';
import {
  measureMuscleCompartmentRingCageContactResidualLedger,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.authored-packing-trajectory-run-report.v0';
const ASSAY_RESULT_SCHEMA = 'kaminos.authored-packing-trajectory-result.v0';
const VISUAL_BUNDLE_SCHEMA = 'kaminos.authored-packing-trajectory-visual-bundle.v1';
const VISUAL_ROUTE = 'authored-packing-trajectory-orbitable-v1';
const OWNED_PATHS = Object.freeze([
  'assay-result.json',
  'authority-profile.json',
  'exact-contact.json',
  'observed-carrier.json',
  'initialized-carrier.json',
  'source-carrier.json',
  'packed-carrier.json',
  'residual-ledger.json',
  'index.html',
  'run-report.json',
  'capture-route-verification.json',
  'visual-inspection.json',
  'source-crowded.png',
  'source-crowded-report.json',
  'source-crowded-capture-report.json',
  'source-crowded-side.png',
  'source-crowded-side-report.json',
  'source-crowded-side-capture-report.json',
  'contact-relieved.png',
  'contact-relieved-report.json',
  'contact-relieved-capture-report.json',
  'contact-relieved-side.png',
  'contact-relieved-side-report.json',
  'contact-relieved-side-capture-report.json',
]);

function parseArguments(argv) {
  const supported = new Set([
    '--manifest', '--output', '--observed-role', '--intent-role', '--policy', '--iterations',
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!supported.has(key)) throw new Error(`unsupported argument ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    parsed[key.slice(2)] = value;
    index += 1;
  }
  if (!parsed.manifest) throw new Error('--manifest is required');
  if (!parsed.output) throw new Error('--output is required');
  return {
    requestedManifestPath:parsed.manifest,
    outputDirectory:path.resolve(parsed.output),
    observedRole:parsed['observed-role'] || 'mild-interpenetration',
    intentRole:parsed['intent-role'] || 'clean-reference',
    policy:parsed.policy || 'restoration-to-reference',
    maximumIterations:Number(parsed.iterations || 8),
  };
}

function preScanOutput(argv) {
  const index = argv.indexOf('--output');
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')
    ? path.resolve(argv[index + 1])
    : null;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(path.dirname(target), { recursive:true });
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

async function clearOwned(outputDirectory) {
  for (const relative of OWNED_PATHS) {
    await unlink(path.join(outputDirectory, relative)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    ? `repo://${relative.split(path.sep).join('/')}`
    : target;
}

function variantByRole(manifest, role) {
  const matches = Object.values(manifest.variants).filter(variant => variant.role === role);
  if (matches.length !== 1) throw new Error(`manifest requires exactly one ${role} variant`);
  return matches[0];
}

function visualBundleIdentity(
  observedCarrier,
  initializedCarrier,
  packedCarrier,
  source,
  residualLedgerBytes,
  generation,
) {
  const domain = {
    schema:VISUAL_BUNDLE_SCHEMA,
    route:VISUAL_ROUTE,
    generation,
    observedCarrierSha256:observedCarrier.identity.sha256,
    initializedCarrierSha256:initializedCarrier.identity.sha256,
    packedCarrierSha256:packedCarrier.identity.sha256,
    sourceInputSha256:source.input.effective.sha256,
    residualLedgerSha256:sha256(residualLedgerBytes),
  };
  return { ...domain, sha256:sha256(Buffer.from(JSON.stringify(domain))) };
}

function captureUrls(bundle) {
  const base = new URLSearchParams({
    bundle:bundle.sha256,
    observed:bundle.observedCarrierSha256,
    initialized:bundle.initializedCarrierSha256,
    packed:bundle.packedCarrierSha256,
    ledger:bundle.residualLedgerSha256,
    routeRequested:VISUAL_ROUTE,
    routeEffective:VISUAL_ROUTE,
  });
  return [
    ['observed', null, null],
    ['initialized', null, null],
    ['packed', null, null],
    ['observed', 'side', null],
    ['initialized', 'side', null],
    ['packed', 'side', null],
    ['packed', null, 'wireframe,source-ghost,displacement,contacts'],
    ['observed', 'contact', 'contacts'],
    ['initialized', 'contact', 'contacts'],
    ['packed', 'contact', 'contacts'],
  ].map(([state, view, diagnostics]) => {
      const query = new URLSearchParams(base);
      query.set('state', state);
      if (view) query.set('view', view);
      if (diagnostics) query.set('diagnostics', diagnostics);
      return `index.html?${query}`;
    });
}

function outputEntry(relative, bytes) {
  return { path:relative, sha256:sha256(bytes) };
}

const rawArguments = process.argv.slice(2);
const generation = sha256(Buffer.from(JSON.stringify({
  rawArguments,
  processId:process.pid,
  startedAt:new Date().toISOString(),
})));
const preScannedOutput = preScanOutput(rawArguments);
let phase = 'parse-arguments';
let args;
let effectiveManifestPath = null;
let manifestFileSha256 = null;

try {
  args = parseArguments(rawArguments);
  await mkdir(args.outputDirectory, { recursive:true });
  await clearOwned(args.outputDirectory);
  phase = 'read-manifest';
  effectiveManifestPath = await realpath(path.resolve(args.requestedManifestPath));
  const manifestBytes = await readFile(effectiveManifestPath);
  manifestFileSha256 = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes);
  validateAuthoredPackingSweepManifest(manifest);
  const observed = variantByRole(manifest, args.observedRole);
  const intent = variantByRole(manifest, args.intentRole);

  phase = 'solve-bounded-trajectory';
  const assay = runAuthoredPackingTrajectoryAssay({
    manifest,
    observedVariantId:observed.id,
    intentVariantId:intent.id,
    policy:args.policy,
    maximumIterations:args.maximumIterations,
  });
  if (assay.result.iterations <= 0 ||
      assay.result.iterations > args.maximumIterations ||
      assay.result.fixedNodeMaximumDrift !== 0 ||
      assay.result.metrics.packed.cages.some(row => row.nonPositiveCellCount !== 0)) {
    throw new Error('authored trajectory did not produce a bounded fixed-safe positive-cell path');
  }
  if (!(assay.exact.packed.summary.maximumPairwisePenetration <
      assay.exact.initial.summary.maximumPairwisePenetration)) {
    throw new Error('authored trajectory did not reduce exact pairwise penetration');
  }
  if (assay.exact.packed.summary.maximumSkeletalPenetration >
      assay.exact.initial.summary.maximumSkeletalPenetration + assay.gates.exactBoneTolerance) {
    throw new Error('authored trajectory increased exact skeletal penetration');
  }

  phase = 'prepare-artifacts';
  const residualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    assay.result.packedCarrier,
    assay.bridge.source,
  );
  const residualLedgerBytes = jsonBytes(residualLedger);
  const bundleIdentity = visualBundleIdentity(
    assay.bridge.observedCarrier,
    assay.bridge.solverCarrier,
    assay.result.packedCarrier,
    assay.bridge.source,
    residualLedgerBytes,
    generation,
  );
  const route = { requested:VISUAL_ROUTE, effective:VISUAL_ROUTE, fallbackUsed:false };
  const viewerBytes = Buffer.from(renderMuscleCompartmentRingCageContactHtml({
    observedCarrier:assay.bridge.observedCarrier,
    initializedCarrier:assay.bridge.solverCarrier,
    result:assay.result,
    source:assay.bridge.source,
    route,
    bundleIdentity,
    residualLedger,
    presentation: {
      title:`Operator-authored six-body packing · ${assay.result.iterations}-step trajectory`,
      authorityLabel:'Operator-authored fixture · provisional packing assay · no anatomical admission',
      explanation:'The authored pathology is the source state. The proposal is a bounded simultaneous six-body contact trajectory under fixed attachments, positive cells, a non-increasing inherited maximum volume-debt ceiling, and an exact authored-bone non-worsening gate.',
      observedLabel:`Exact authored ${args.observedRole}`,
      sourceLabel:'Solver initialization · intent endpoints',
      proposalLabel:`${assay.result.iterations} global N-body steps`,
      authoredBone: {
        positions:observed.bone.mesh.vertices,
        faces:observed.bone.mesh.polygons,
      },
      exactContact:assay.exact,
    },
  }));
  const volumeDebt = assay.bridge.solverCarrier.orderedConstructionIds.map((constructionId, index) => ({
    constructionId,
    initial:assay.result.metrics.initial.cages[index].relativeVolumeError,
    packed:assay.result.metrics.packed.cages[index].relativeVolumeError,
    delta:assay.result.metrics.packed.cages[index].relativeVolumeError -
      assay.result.metrics.initial.cages[index].relativeVolumeError,
  }));
  const assayResult = {
    schema:ASSAY_RESULT_SCHEMA,
    status:'completed-bounded-trajectory-residual-remains',
    generation,
    evidenceTrack:'operator-authored-fixture-provisional-packing',
    claimCeiling:'bounded-trajectory-mechanism-and-visual-assay-only-no-anatomical-admission',
    source: {
      requestedManifestPath:args.requestedManifestPath,
      effectiveManifestPath:receiptPath(effectiveManifestPath),
      manifestFileSha256,
      manifestIdentitySha256:manifest.identity.sha256,
      observedVariantId:observed.id,
      observedRole:observed.role,
      intentVariantId:intent.id,
      intentRole:intent.role,
      policy:args.policy,
      maximumIterations:args.maximumIterations,
    },
    route:assay.bridge.route,
    config:{ requested:assay.config, effective:assay.result.config.effective, fallbackUsed:false },
    gates:assay.gates,
    result: {
      status:assay.result.status,
      iterations:assay.result.iterations,
      termination:assay.result.termination,
      fixedNodeMaximumDrift:assay.result.fixedNodeMaximumDrift,
      metrics:assay.result.metrics,
      iterationHistory:assay.result.iterationHistory,
      lineSearchHistory:assay.result.lineSearchHistory,
    },
    exactContact:assay.exact,
    volumeDebt,
    visual:{ route, bundleIdentity, captureUrls:captureUrls(bundleIdentity) },
  };
  const artifacts = {
    assayResult:['assay-result.json', jsonBytes(assayResult)],
    authorityProfile:['authority-profile.json', jsonBytes(assay.authorityProfile)],
    exactContact:['exact-contact.json', jsonBytes(assay.exact)],
    observedCarrier:['observed-carrier.json', jsonBytes(assay.bridge.observedCarrier)],
    initializedCarrier:['initialized-carrier.json', jsonBytes(assay.bridge.solverCarrier)],
    sourceCarrier:['source-carrier.json', jsonBytes(assay.bridge.solverCarrier)],
    packedCarrier:['packed-carrier.json', jsonBytes(assay.result.packedCarrier)],
    residualLedger:['residual-ledger.json', residualLedgerBytes],
    viewer:['index.html', viewerBytes],
  };

  phase = 'write-primary-artifacts';
  for (const [, [relative, bytes]] of Object.entries(artifacts)) {
    await writeAtomic(path.join(args.outputDirectory, relative), bytes);
  }
  const outputs = Object.fromEntries(Object.entries(artifacts).map(
    ([key, [relative, bytes]]) => [key, outputEntry(relative, bytes)],
  ));
  const report = {
    schema:RUN_REPORT_SCHEMA,
    status:'completed',
    generation,
    failurePhase:null,
    requestedManifestPath:args.requestedManifestPath,
    effectiveManifestPath:receiptPath(effectiveManifestPath),
    manifestFileSha256,
    manifestIdentitySha256:manifest.identity.sha256,
    observedRole:args.observedRole,
    intentRole:args.intentRole,
    policy:args.policy,
    maximumIterations:args.maximumIterations,
    resultStatus:assayResult.status,
    route,
    outputs,
    visual:{
      route,
      viewer:outputs.viewer,
      bundleIdentity,
      captureUrls:assayResult.visual.captureUrls,
      status:'pending-agent-inspection',
    },
    lastTrustworthyEvidence: {
      phase:'primary-artifacts-written',
      exactPairwiseInitial:assay.exact.initial.summary.maximumPairwisePenetration,
      exactPairwisePacked:assay.exact.packed.summary.maximumPairwisePenetration,
      exactBoneInitial:assay.exact.initial.summary.maximumSkeletalPenetration,
      exactBonePacked:assay.exact.packed.summary.maximumSkeletalPenetration,
      fixedNodeMaximumDrift:assay.result.fixedNodeMaximumDrift,
    },
  };
  await writeAtomic(path.join(args.outputDirectory, 'run-report.json'), jsonBytes(report));
  process.stdout.write(`${JSON.stringify({ status:report.status, outputDirectory:args.outputDirectory, route, outputs })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const outputDirectory = args?.outputDirectory || preScannedOutput;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive:true });
    await clearOwned(outputDirectory);
    await writeAtomic(path.join(outputDirectory, 'run-report.json'), jsonBytes({
      schema:RUN_REPORT_SCHEMA,
      status:'failed',
      generation,
      failurePhase:phase,
      error:message,
      rawArguments,
      requestedManifestPath:args?.requestedManifestPath || null,
      effectiveManifestPath:effectiveManifestPath ? receiptPath(effectiveManifestPath) : null,
      manifestFileSha256,
      outputs:null,
      lastTrustworthyEvidence:{ phase, manifestFileSha256 },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

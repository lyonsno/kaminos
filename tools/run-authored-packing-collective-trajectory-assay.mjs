#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  runAuthoredPackingCollectiveTrajectoryAssay,
  validateAuthoredPackingSweepManifest,
} from '../authored-packing-sweep-core.mjs';
import {
  measureMuscleCompartmentRingCageContactResidualLedger,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  renderAuthoredPackingCollectiveTrajectoryHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.authored-packing-collective-trajectory-run-report.v0';
const FRONTIER_SCHEMA = 'kaminos.authored-packing-collective-trajectory-frontier.v0';
const BUNDLE_SCHEMA = 'kaminos.authored-packing-collective-trajectory-visual-bundle.v0';
const VISUAL_ROUTE = 'authored-packing-collective-trajectory-orbitable-v0';

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
  const maximumIterations = Number(parsed.iterations || 8);
  if (!Number.isInteger(maximumIterations) || maximumIterations < 1) {
    throw new Error('--iterations requires a positive integer');
  }
  return {
    requestedManifestPath:parsed.manifest,
    outputDirectory:path.resolve(parsed.output),
    observedRole:parsed['observed-role'] || 'mild-interpenetration',
    intentRole:parsed['intent-role'] || 'clean-reference',
    policy:parsed.policy || 'restoration-to-reference',
    maximumIterations,
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

function semanticLabel(semanticId) {
  return semanticId.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function outputEntry(relativePath, bytes) {
  return { path:relativePath, sha256:sha256(bytes) };
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
let stagingDirectory = null;

try {
  args = parseArguments(rawArguments);
  await mkdir(args.outputDirectory, { recursive:true });
  phase = 'publish-generation';
  await writeAtomic(path.join(args.outputDirectory, 'run-report.json'), jsonBytes({
    schema:RUN_REPORT_SCHEMA,
    status:'in-progress',
    generation,
    failurePhase:null,
    rawArguments,
    requestedManifestPath:receiptPath(path.resolve(args.requestedManifestPath)),
    effectiveManifestPath:null,
    manifestFileSha256:null,
    publishedGeneration:null,
    outputs:null,
    lastTrustworthyEvidence:{ phase:'generation-published-before-compute' },
  }));

  phase = 'read-manifest';
  effectiveManifestPath = await realpath(path.resolve(args.requestedManifestPath));
  const manifestBytes = await readFile(effectiveManifestPath);
  manifestFileSha256 = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes);
  validateAuthoredPackingSweepManifest(manifest);
  const observed = variantByRole(manifest, args.observedRole);
  const intent = variantByRole(manifest, args.intentRole);

  phase = 'run-shared-solver-frontier';
  const assay = runAuthoredPackingCollectiveTrajectoryAssay({
    manifest,
    observedVariantId:observed.id,
    intentVariantId:intent.id,
    policy:args.policy,
    maximumIterations:args.maximumIterations,
  });
  const completedRows = [assay.directStart, ...assay.candidates]
    .filter(row => row.status === 'completed');
  const arms = completedRows.map(row => ({
    semanticId:row.semanticId,
    label:semanticLabel(row.semanticId),
    status:row.status,
    trajectory:row.trajectory,
    residualLedger:measureMuscleCompartmentRingCageContactResidualLedger(
      row.trajectory.result.packedCarrier,
      assay.bridge.source,
    ),
  }));
  const armArtifactBytes = new Map(arms.map(arm => [arm.semanticId, {
    trajectory:jsonBytes(arm.trajectory),
    residualLedger:jsonBytes(arm.residualLedger),
  }]));
  const route = { requested:VISUAL_ROUTE, effective:VISUAL_ROUTE, fallbackUsed:false };
  const armIdentities = arms.map(arm => ({
    semanticId:arm.semanticId,
    initialCarrierSha256:arm.trajectory.exact.initial.source.solverCarrierSha256,
    packedCarrierSha256:arm.trajectory.result.packedCarrier.identity.sha256,
    residualLedgerSha256:sha256(armArtifactBytes.get(arm.semanticId).residualLedger),
  }));
  const bundleDomain = {
    schema:BUNDLE_SCHEMA,
    route:VISUAL_ROUTE,
    generation,
    manifestFileSha256,
    familySha256:assay.family.identity.sha256,
    sourceCarrierSha256:assay.bridge.observedCarrier.identity.sha256,
    armIdentities,
  };
  const bundleIdentity = {
    ...bundleDomain,
    sha256:sha256(Buffer.from(JSON.stringify(bundleDomain))),
  };
  const captureBase = new URLSearchParams({
    bundle:bundleIdentity.sha256,
    family:bundleIdentity.familySha256,
    source:bundleIdentity.sourceCarrierSha256,
    routeRequested:VISUAL_ROUTE,
    routeEffective:VISUAL_ROUTE,
  });
  const captureUrls = arms.flatMap(arm => ['initial', 'packed'].map(phaseName => {
    const query = new URLSearchParams(captureBase);
    query.set('arm', arm.semanticId);
    query.set('phase', phaseName);
    return `index.html?${query}`;
  }));
  const viewerBytes = Buffer.from(renderAuthoredPackingCollectiveTrajectoryHtml({
    assay,
    arms,
    source:assay.bridge.source,
    route,
    bundleIdentity,
    presentation: {
      authoredBone:{ positions:observed.bone.mesh.vertices, faces:observed.bone.mesh.polygons },
    },
  }));
  const frontier = {
    schema:FRONTIER_SCHEMA,
    status:'completed-raw-frontier-selection-not-performed',
    generation,
    claimCeiling:'shared-solver-origin-and-trajectory-comparison-only-no-benefit-convergence-anatomy-or-architecture-selection',
    source: {
      requestedManifestPath:receiptPath(path.resolve(args.requestedManifestPath)),
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
    route:assay.route,
    solverContract:assay.solverContract,
    population:assay.population,
    arms:[assay.directStart, ...assay.candidates].map(row => ({
      semanticId:row.semanticId,
      role:row.role,
      status:row.status,
      originSha256:row.originSha256,
      initialCarrierSha256:row.initialCarrierSha256,
      trajectoryPath:row.status === 'completed' ? `arms/${row.semanticId}/trajectory.json` : null,
      residualLedgerPath:row.status === 'completed'
        ? `arms/${row.semanticId}/residual-ledger.json`
        : null,
      rejection:row.rejection,
      failure:row.failure,
    })),
    selection:assay.selection,
    visual:{ route, bundleIdentity, captureUrls },
  };

  phase = 'write-staged-generation';
  stagingDirectory = path.join(args.outputDirectory, `.staging-${generation}`);
  await rm(stagingDirectory, { recursive:true, force:true });
  await mkdir(stagingDirectory, { recursive:true });
  const primaryArtifacts = {
    frontier:['frontier-result.json', jsonBytes(frontier)],
    family:['family.json', jsonBytes(assay.family)],
    authorityProfile:['authority-profile.json', jsonBytes(assay.authorityProfile)],
    sourceCarrier:['source-carrier.json', jsonBytes(assay.bridge.observedCarrier)],
    viewer:['index.html', viewerBytes],
  };
  for (const [, [relativePath, bytes]] of Object.entries(primaryArtifacts)) {
    await writeAtomic(path.join(stagingDirectory, relativePath), bytes);
  }
  for (const arm of arms) {
    const bytes = armArtifactBytes.get(arm.semanticId);
    await writeAtomic(
      path.join(stagingDirectory, 'arms', arm.semanticId, 'trajectory.json'),
      bytes.trajectory,
    );
    await writeAtomic(
      path.join(stagingDirectory, 'arms', arm.semanticId, 'residual-ledger.json'),
      bytes.residualLedger,
    );
  }

  phase = 'publish-generation';
  const generationRelativePath = path.join('generations', generation);
  const publishedDirectory = path.join(args.outputDirectory, generationRelativePath);
  await mkdir(path.dirname(publishedDirectory), { recursive:true });
  await rename(stagingDirectory, publishedDirectory);
  stagingDirectory = null;
  const outputs = Object.fromEntries(Object.entries(primaryArtifacts).map(
    ([key, [relativePath, bytes]]) => [key, outputEntry(
      path.join(generationRelativePath, relativePath).split(path.sep).join('/'),
      bytes,
    )],
  ));
  for (const arm of arms) {
    const bytes = armArtifactBytes.get(arm.semanticId);
    outputs[`arm:${arm.semanticId}:trajectory`] = outputEntry(
      path.join(generationRelativePath, 'arms', arm.semanticId, 'trajectory.json')
        .split(path.sep).join('/'),
      bytes.trajectory,
    );
    outputs[`arm:${arm.semanticId}:residualLedger`] = outputEntry(
      path.join(generationRelativePath, 'arms', arm.semanticId, 'residual-ledger.json')
        .split(path.sep).join('/'),
      bytes.residualLedger,
    );
  }
  const report = {
    schema:RUN_REPORT_SCHEMA,
    status:'completed',
    generation,
    failurePhase:null,
    requestedManifestPath:receiptPath(path.resolve(args.requestedManifestPath)),
    effectiveManifestPath:receiptPath(effectiveManifestPath),
    manifestFileSha256,
    manifestIdentitySha256:manifest.identity.sha256,
    publishedGeneration:generationRelativePath.split(path.sep).join('/'),
    route,
    population:assay.population,
    selection:assay.selection,
    outputs,
    visual:{
      status:'pending-agent-inspection',
      route,
      bundleIdentity,
      viewer:outputs.viewer,
      captureUrls:captureUrls.map(url =>
        `${generationRelativePath.split(path.sep).join('/')}/${url}`
      ),
    },
    lastTrustworthyEvidence: {
      phase:'immutable-generation-published',
      completedArmIds:arms.map(arm => arm.semanticId),
      sourceRejectedArmIds:assay.candidates
        .filter(row => row.status === 'source-rejected')
        .map(row => row.semanticId),
      solverFailedArmIds:assay.candidates
        .filter(row => row.status === 'solver-failed')
        .map(row => row.semanticId),
    },
  };
  await writeAtomic(path.join(args.outputDirectory, 'run-report.json'), jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status:report.status,
    outputDirectory:args.outputDirectory,
    generation:report.publishedGeneration,
    viewer:report.visual.viewer,
    route,
    population:report.population,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (stagingDirectory) await rm(stagingDirectory, { recursive:true, force:true }).catch(() => {});
  const outputDirectory = args?.outputDirectory || preScannedOutput;
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive:true });
    await writeAtomic(path.join(outputDirectory, 'run-report.json'), jsonBytes({
      schema:RUN_REPORT_SCHEMA,
      status:'failed',
      generation,
      failurePhase:phase,
      error:message,
      rawArguments,
      requestedManifestPath:args?.requestedManifestPath
        ? receiptPath(path.resolve(args.requestedManifestPath))
        : null,
      effectiveManifestPath:effectiveManifestPath ? receiptPath(effectiveManifestPath) : null,
      manifestFileSha256,
      publishedGeneration:null,
      outputs:null,
      lastTrustworthyEvidence:{ phase, manifestFileSha256 },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

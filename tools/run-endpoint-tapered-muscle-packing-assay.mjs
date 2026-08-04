#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  createSourceShapedPackingPerturbationSeries,
  deriveEndpointTaperedPackingSource,
  solveMuscleCompartmentPacking,
} from '../muscle-compartment-packing-core.mjs';
import { renderMuscleCompartmentPackingHtml } from '../muscle-compartment-packing-witness.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.endpoint-tapered-muscle-packing-assay-run-report.v0';
const VISUAL_ROUTE = 'endpoint-tapered-current-k4-orbitable-v0';
const SOURCE_COMPILER_LEVELS = Object.freeze([
  { id: 'baseline', crowdingFraction: 0 },
  { id: 'compiler-contract-sentinel', crowdingFraction: 0.001 },
]);

function parseArguments(argv) {
  const parsed = {};
  const supported = new Set([
    '--parent-atlas',
    '--routes',
    '--output',
    '--endpoint-radius-multiplier',
    '--transition-fraction',
    '--max-iterations',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!supported.has(argument)) throw new Error(`unsupported argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of [
    'parent-atlas',
    'routes',
    'output',
    'endpoint-radius-multiplier',
    'transition-fraction',
  ]) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  const requestedConstructionIds = parsed.routes.split(',').map(value => value.trim()).filter(Boolean);
  if (requestedConstructionIds.length === 0) throw new Error('--routes must name construction ids');
  const endpointRadiusMultiplier = Number(parsed['endpoint-radius-multiplier']);
  const transitionFraction = Number(parsed['transition-fraction']);
  if (!Number.isFinite(endpointRadiusMultiplier)) {
    throw new Error('--endpoint-radius-multiplier must be finite');
  }
  if (!Number.isFinite(transitionFraction)) throw new Error('--transition-fraction must be finite');
  const requestedSolverConfig = {};
  if (parsed['max-iterations'] !== undefined) {
    const maxIterations = Number(parsed['max-iterations']);
    if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
      throw new Error('--max-iterations must be a positive integer');
    }
    requestedSolverConfig.maxIterations = maxIterations;
  }
  return {
    requestedParentAtlasPath: parsed['parent-atlas'],
    requestedConstructionIds,
    outputDirectory: path.resolve(parsed.output),
    requestedTaper: {
      endpointRadiusMultiplier,
      transitionFraction,
      profile: 'smoothstep-arc-length',
      volumeCompensation: 'global-radius',
    },
    requestedSolverConfig,
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function receiptPath(target) {
  const relative = path.relative(process.cwd(), target);
  if (relative === '') return 'repo://.';
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
    return `repo://${relative.split(path.sep).join('/')}`;
  }
  return target;
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function routeReceipt() {
  return { requested: VISUAL_ROUTE, effective: VISUAL_ROUTE, fallbackUsed: false };
}

function presentation(kind, result) {
  if (kind === 'parent') {
    return {
      title: 'Current-graph K4 · authenticated constant-radius source',
      authorityLabel: 'Authenticated construction identities · provisional cross-sections and environment',
      explanation:
        'The source compiler preserves its measured constant-radius carrier exactly. Red endpoint ' +
        'wireframes identify fixed-attachment cross-sections that make this representation infeasible.',
      beforeLabel: 'Authenticated constant-radius source',
      packedLabel: 'Refused unchanged source',
      solveStatus: result.status,
      hint: 'Drag to orbit · wheel to zoom · this source is unchanged by the refused preflight',
    };
  }
  return {
    title: 'Current-graph K4 · endpoint-taper mechanism assay',
    authorityLabel: 'Derived diagnostic cross-sections · no anatomical admission',
    explanation:
      'Endpoint taper changes only the provisional cross-section carrier, preserves fixed attachments ' +
      'and target volume, then exposes what the current packing projection does with the opened space.',
    beforeLabel: 'Endpoint-tapered source',
    packedLabel: 'Packed candidate',
    solveStatus: result.status,
    hint: 'Drag to orbit · wheel to zoom · faint lines show source centerlines and displacement',
  };
}

function renderPortfolio() {
  const cards = [
    ['Authenticated constant-radius source', 'parent/?state=before'],
    ['Endpoint-tapered source', 'tapered/?state=before'],
    ['Packed candidate', 'tapered/?state=packed'],
  ].map(([label, source]) => (
    `<section><h2>${label}</h2><iframe title="${label}" src="${source}"></iframe></section>`
  )).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current-graph K4 endpoint-taper mechanism assay</title><style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}body{margin:0;padding:24px;background:#07090d;color:#f4eee3}header{max-width:1100px;margin:0 auto 20px}h1{font-size:24px;margin:0 0 8px}header p{color:#aeb9c6;line-height:1.45}main{display:grid;grid-template-columns:repeat(3,minmax(320px,1fr));gap:16px}section{min-width:0;padding:12px;border:1px solid #ffffff24;border-radius:14px;background:#0b1017}h2{font:650 13px/1.3 ui-monospace,monospace;margin:0 0 10px}iframe{width:100%;height:620px;border:0;border-radius:10px;background:#07090d}@media(max-width:1050px){main{grid-template-columns:1fr}}</style></head><body><header><h1>Current-graph K4 endpoint-taper mechanism assay</h1><p>One identity-bound baseline shown as authenticated source, volume-preserving tapered derivation, and the current projection result. This is mechanism evidence, not anatomical admission.</p></header><main>${cards}</main></body></html>`;
}

function outputEntry(relativePath, bytes) {
  return { path: relativePath, sha256: sha256(bytes) };
}

let phase = 'parse-arguments';
let args;
let reportPath = '';
let outputPaths = [];
let parentAtlasFileSha256 = null;
let effectiveParentAtlasPath = null;
let parentAtlasId = null;

try {
  args = parseArguments(process.argv.slice(2));
  await mkdir(args.outputDirectory, { recursive: true });
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  outputPaths = [
    'authenticated-source.json',
    'parent-preflight-result.json',
    'derived-source.json',
    'derivation-receipt.json',
    'packing-result.json',
    'parent/index.html',
    'tapered/index.html',
    'index.html',
  ].map(relative => path.join(args.outputDirectory, relative));
  for (const target of outputPaths) {
    await unlink(target).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  phase = 'read-parent-atlas';
  effectiveParentAtlasPath = await realpath(path.resolve(args.requestedParentAtlasPath));
  const parentAtlasBytes = await readFile(effectiveParentAtlasPath);
  parentAtlasFileSha256 = sha256(parentAtlasBytes);
  const parentAtlas = JSON.parse(parentAtlasBytes);
  parentAtlasId = parentAtlas.id || null;

  phase = 'compile-authenticated-source';
  const series = createSourceShapedPackingPerturbationSeries({
    parentAtlas,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    levels: SOURCE_COMPILER_LEVELS,
  });
  const authenticatedSource = series.conditions[0].source;
  const effectiveConstructionIds = authenticatedSource.muscles.map(muscle => muscle.id);
  const parentResult = solveMuscleCompartmentPacking(authenticatedSource, { maxIterations: 1 });

  phase = 'derive-source';
  const derivation = deriveEndpointTaperedPackingSource(authenticatedSource, args.requestedTaper);

  phase = 'solve-derived-source';
  const startedAtMs = Date.now();
  const result = solveMuscleCompartmentPacking(derivation.source, args.requestedSolverConfig);
  const elapsedMilliseconds = Date.now() - startedAtMs;

  phase = 'prepare-artifacts';
  const route = routeReceipt();
  const artifacts = new Map([
    ['authenticated-source.json', jsonBytes(authenticatedSource)],
    ['parent-preflight-result.json', jsonBytes(parentResult)],
    ['derived-source.json', jsonBytes(derivation.source)],
    ['derivation-receipt.json', jsonBytes(derivation.receipt)],
    ['packing-result.json', jsonBytes(result)],
    ['parent/index.html', Buffer.from(renderMuscleCompartmentPackingHtml({
      source: authenticatedSource,
      result: parentResult,
      report: { route },
      presentation: presentation('parent', parentResult),
    }))],
    ['tapered/index.html', Buffer.from(renderMuscleCompartmentPackingHtml({
      source: derivation.source,
      result,
      report: { route },
      presentation: presentation('tapered', result),
    }))],
    ['index.html', Buffer.from(renderPortfolio())],
  ]);

  phase = 'write-primary-artifacts';
  for (const [relative, bytes] of artifacts) {
    await writeAtomic(path.join(args.outputDirectory, relative), bytes);
  }

  phase = 'write-report';
  const report = {
    schema: RUN_REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    requestedParentAtlasPath: args.requestedParentAtlasPath,
    effectiveParentAtlasPath: receiptPath(effectiveParentAtlasPath),
    parentAtlasId,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    effectiveConstructionIds,
    requestedSolverConfig: args.requestedSolverConfig,
    effectiveSolverConfig: result.config,
    elapsedMilliseconds,
    taper: {
      requested: derivation.receipt.requested,
      effective: derivation.receipt.effective,
      fallbackUsed: derivation.receipt.fallbackUsed,
      parentSource: derivation.receipt.parentSource,
      derivedSource: derivation.receipt.derivedSource,
    },
    result: {
      status: result.status,
      iterations: result.iterations,
      initial: result.metrics.initial,
      packed: result.metrics.packed,
      failure: result.failure || null,
    },
    outputs: {
      authenticatedSource: outputEntry('authenticated-source.json', artifacts.get('authenticated-source.json')),
      parentPreflightResult: outputEntry('parent-preflight-result.json', artifacts.get('parent-preflight-result.json')),
      derivedSource: outputEntry('derived-source.json', artifacts.get('derived-source.json')),
      derivationReceipt: outputEntry('derivation-receipt.json', artifacts.get('derivation-receipt.json')),
      packingResult: outputEntry('packing-result.json', artifacts.get('packing-result.json')),
    },
    visual: {
      route,
      status: 'pending-agent-inspection',
      portfolio: outputEntry('index.html', artifacts.get('index.html')),
      parentViewer: outputEntry('parent/index.html', artifacts.get('parent/index.html')),
      taperedViewer: outputEntry('tapered/index.html', artifacts.get('tapered/index.html')),
    },
    lastTrustworthyEvidence: {
      phase: 'primary-artifacts-written',
      derivedSourceSha256: derivation.receipt.derivedSource.sha256,
      resultStatus: result.status,
      resultIterations: result.iterations,
    },
  };
  await writeAtomic(reportPath, jsonBytes(report));
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    resultStatus: result.status,
    iterations: result.iterations,
    elapsedMilliseconds,
    initialPairwisePenetration: result.metrics.initial.pairwisePenetration,
    packedPairwisePenetration: result.metrics.packed.pairwisePenetration,
    curvatureReversals: result.metrics.packed.sourceCurvatureReversalCount,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (args?.outputDirectory) {
    await mkdir(args.outputDirectory, { recursive: true });
    reportPath ||= path.join(args.outputDirectory, 'run-report.json');
    for (const target of outputPaths) {
      await unlink(target).catch(unlinkError => {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      });
    }
    await writeAtomic(reportPath, jsonBytes({
      schema: RUN_REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      requestedParentAtlasPath: args.requestedParentAtlasPath,
      effectiveParentAtlasPath: effectiveParentAtlasPath
        ? receiptPath(effectiveParentAtlasPath)
        : null,
      parentAtlasId,
      parentAtlasFileSha256,
      requestedConstructionIds: args.requestedConstructionIds,
      requestedTaper: args.requestedTaper,
      requestedSolverConfig: args.requestedSolverConfig,
      outputs: null,
      visual: null,
      lastTrustworthyEvidence: {
        phase: parentAtlasFileSha256 ? 'parent-atlas-read-and-hashed' : 'arguments-resolved',
        parentAtlasFileSha256,
      },
    }));
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  runSourceShapedPackingPerturbationSeries,
} from '../muscle-compartment-packing-core.mjs';
import {
  renderMuscleCompartmentPackingHtml,
} from '../muscle-compartment-packing-witness.mjs';

const RUN_REPORT_SCHEMA = 'kaminos.source-shaped-muscle-packing-assay-run-report.v0';
const VISUAL_ROUTE = 'source-shaped-muscle-packing-preflight-orbitable-v0';
const LEVELS = Object.freeze([
  { id: 'baseline', crowdingFraction: 0 },
  { id: 'mild', crowdingFraction: 0.12 },
  { id: 'moderate', crowdingFraction: 0.24 },
]);

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!['--parent-atlas', '--routes', '--output'].includes(argument)) {
      throw new Error(`unsupported argument ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  for (const key of ['parent-atlas', 'routes', 'output']) {
    if (!parsed[key]) throw new Error(`--${key} is required`);
  }
  const requestedConstructionIds = parsed.routes.split(',').map(value => value.trim()).filter(Boolean);
  if (requestedConstructionIds.length === 0) throw new Error('--routes must name construction ids');
  return {
    requestedParentAtlasPath: parsed['parent-atlas'],
    requestedConstructionIds,
    outputDirectory: path.resolve(parsed.output),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function receiptPath(target) {
  const relativePath = path.relative(process.cwd(), target);
  if (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath))
  ) {
    return relativePath === ''
      ? 'repo://.'
      : `repo://${relativePath.split(path.sep).join('/')}`;
  }
  return target;
}

async function writeJson(target, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, 'utf8');
  await rename(temporary, target);
  return Buffer.from(bytes);
}

async function writeText(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function conditionVisualPresentation(condition) {
  const blockerCount = condition.result.failure?.blockingMechanisms?.length || 0;
  return {
    title: `Current-graph K4 · ${condition.id}`,
    authorityLabel: 'Experimental source-shaped candidate geometry · no anatomical admission',
    explanation:
      `Current Packer refused this condition before iteration because ${blockerCount} fixed-attachment ` +
      `cross-section pairs penetrate. The source and refused output are intentionally identical; ` +
      `red wireframes mark the blocking attachments.`,
    beforeLabel: 'Candidate source',
    packedLabel: 'Refused unchanged source',
    solveStatus: condition.result.status,
    hint: 'Drag to orbit · wheel to zoom · red wireframes are exact preflight blockers',
  };
}

function renderVisualPortfolio(conditions) {
  const cards = conditions.map(condition => {
    const root = condition.relativeRoot;
    return `<section><h2>${escapeHtml(condition.id)} · ${escapeHtml(condition.status)}</h2>` +
      `<p>${condition.blockerCount} fixed-attachment blockers · max penetration ` +
      `${condition.maximumFixedAttachmentPenetration.toFixed(6)}</p>` +
      `<div class="states"><a href="${root}/?state=before">Candidate source</a>` +
      `<a href="${root}/?state=packed">Refused unchanged source</a></div>` +
      `<iframe title="${escapeHtml(condition.id)} current-graph K4 diagnostic" src="${root}/?state=packed"></iframe>` +
      `</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current-graph K4 fixed-attachment preflight</title><style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}body{margin:0;padding:24px;background:#07090d;color:#f4eee3}header{max-width:980px;margin:0 auto 20px}h1{font-size:24px;margin:0 0 8px}header p,section p{color:#aeb9c6}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:18px}section{min-width:0;padding:14px;border:1px solid #ffffff24;border-radius:14px;background:#0b1017}h2{font:650 15px/1.2 ui-monospace,monospace;margin:0}.states{display:flex;gap:8px;margin:10px 0}.states a{padding:7px 9px;border-radius:8px;background:#172231;color:#e7d1a8;text-decoration:none;font:600 11px ui-monospace,monospace}iframe{width:100%;height:500px;border:0;border-radius:10px;background:#07090d}</style></head><body><header><h1>Current-graph K4 fixed-attachment preflight</h1><p>Exact M34/M13/M12/M45 candidate sources. All three rungs are refused unchanged before iteration; red endpoint wireframes identify the blocking cross-sections. Diagnostic evidence only, not anatomical admission.</p></header><main>${cards}</main></body></html>`;
}

function prepareVisualArtifacts(result, outputDirectory) {
  const route = { requested: VISUAL_ROUTE, effective: VISUAL_ROUTE, fallbackUsed: false };
  const artifacts = [];
  const conditions = result.conditions.map(condition => {
    const relativeRoot = `conditions/${condition.id}`;
    const root = path.join(outputDirectory, relativeRoot);
    const sourceBytes = Buffer.from(`${JSON.stringify(condition.source, null, 2)}\n`);
    const resultBytes = Buffer.from(`${JSON.stringify(condition.result, null, 2)}\n`);
    const htmlBytes = Buffer.from(renderMuscleCompartmentPackingHtml({
      source: condition.source,
      result: condition.result,
      report: { route },
      presentation: conditionVisualPresentation(condition),
    }));
    artifacts.push(
      { path: path.join(root, 'source.json'), bytes: sourceBytes },
      { path: path.join(root, 'result.json'), bytes: resultBytes },
      { path: path.join(root, 'index.html'), bytes: htmlBytes },
    );
    const fixedBlockers = (condition.result.failure?.blockingMechanisms || []).filter(
      mechanism => mechanism.kind === 'pairwise-fixed-attachment-penetration',
    );
    return {
      id: condition.id,
      status: condition.result.status,
      role: 'diagnostic-not-admission',
      relativeRoot,
      blockerCount: fixedBlockers.length,
      maximumFixedAttachmentPenetration: Math.max(
        0,
        ...fixedBlockers.map(mechanism => mechanism.penetration),
      ),
      sourceJsonSha256: sha256(sourceBytes),
      resultJsonSha256: sha256(resultBytes),
      indexHtmlSha256: sha256(htmlBytes),
    };
  });
  const portfolioBytes = Buffer.from(renderVisualPortfolio(conditions));
  artifacts.push({ path: path.join(outputDirectory, 'index.html'), bytes: portfolioBytes });
  return {
    route,
    status: 'pending-agent-inspection',
    portfolio: 'index.html',
    portfolioSha256: sha256(portfolioBytes),
    conditions,
    artifacts,
  };
}

async function effectiveDestination(target) {
  const absolutePath = path.resolve(target);
  try {
    return await realpath(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const effectiveParent = await realpath(path.dirname(absolutePath));
    return path.resolve(effectiveParent, path.basename(absolutePath));
  }
}

function compactCondition(condition) {
  return {
    id: condition.id,
    crowdingFraction: condition.crowdingFraction,
    sourceInput: condition.source.input,
    perturbation: condition.source.assayProvenance.perturbation,
    assumptions: condition.source.assayProvenance.assumptions,
    status: condition.result.status,
    iterations: condition.result.iterations,
    initial: condition.result.metrics.initial,
    packed: condition.result.metrics.packed,
    response: condition.response,
  };
}

let phase = 'parse-arguments';
let args;
let effectiveParentAtlasPath = '';
let parentAtlasFileSha256 = '';
let parentAtlasId = '';
let parentAtlasSha256 = '';
let primaryPath = '';
let reportPath = '';
let primaryPathIsSafe = false;
let reportPathIsSafe = false;
let visualArtifactPaths = [];

try {
  args = parseArguments(process.argv.slice(2));
  phase = 'resolve-destinations';
  const requestedParentAtlasPath = path.resolve(args.requestedParentAtlasPath);
  effectiveParentAtlasPath = await realpath(requestedParentAtlasPath);
  await mkdir(args.outputDirectory, { recursive: true });
  const effectiveOutputDirectory = await realpath(args.outputDirectory);
  primaryPath = path.join(args.outputDirectory, 'perturbation-result.json');
  reportPath = path.join(args.outputDirectory, 'run-report.json');
  const effectivePrimaryPath = await effectiveDestination(
    path.join(effectiveOutputDirectory, 'perturbation-result.json'),
  );
  const effectiveReportPath = await effectiveDestination(
    path.join(effectiveOutputDirectory, 'run-report.json'),
  );
  const protectedParentPaths = new Set([requestedParentAtlasPath, effectiveParentAtlasPath]);
  if (protectedParentPaths.has(effectiveReportPath)) {
    reportPath = path.join(
      args.outputDirectory,
      'run-report.json.source-shaped-packing-assay-failure.json',
    );
    reportPathIsSafe = true;
    throw new Error('report path must not alias the parent atlas');
  }
  reportPathIsSafe = true;
  if (protectedParentPaths.has(effectivePrimaryPath)) {
    throw new Error('primary output path must not alias the parent atlas');
  }
  primaryPathIsSafe = true;
  await unlink(primaryPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });

  phase = 'read-parent-atlas';
  const parentAtlasBytes = await readFile(effectiveParentAtlasPath);
  parentAtlasFileSha256 = sha256(parentAtlasBytes);
  const parentAtlas = JSON.parse(parentAtlasBytes);
  parentAtlasId = parentAtlas.id || '';
  parentAtlasSha256 = parentAtlas.atlasSha256 || '';

  phase = 'build-and-solve';
  const result = runSourceShapedPackingPerturbationSeries({
    parentAtlas,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    levels: LEVELS,
  });
  const visual = prepareVisualArtifacts(result, args.outputDirectory);
  visualArtifactPaths = visual.artifacts.map(artifact => artifact.path);

  phase = 'write-primary';
  const primaryBytes = await writeJson(primaryPath, result);
  const outputSha256 = sha256(primaryBytes);

  phase = 'write-visual-artifacts';
  for (const artifact of visual.artifacts) {
    await mkdir(path.dirname(artifact.path), { recursive: true });
    await writeText(artifact.path, artifact.bytes);
  }

  phase = 'write-report';
  const report = {
    schema: RUN_REPORT_SCHEMA,
    status: 'completed',
    failurePhase: null,
    requestedParentAtlasPath: args.requestedParentAtlasPath,
    effectiveParentAtlasPath: receiptPath(effectiveParentAtlasPath),
    parentAtlasId,
    parentAtlasSha256,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    effectiveConstructionIds: result.effectiveConstructionIds,
    evidenceTrack: result.evidenceTrack,
    claimCeiling: result.claimCeiling,
    mechanism: result.mechanism,
    interpretationChecks: result.interpretationChecks,
    conditions: result.conditions.map((condition, index) => ({
      ...compactCondition(condition),
      visual: visual.conditions[index],
    })),
    visual: {
      route: visual.route,
      status: visual.status,
      portfolio: visual.portfolio,
      portfolioSha256: visual.portfolioSha256,
    },
    primaryOutput: 'perturbation-result.json',
    outputSha256,
    lastTrustworthyEvidence: {
      phase: 'primary-output-written',
      parentAtlasFileSha256,
      effectiveConstructionIds: result.effectiveConstructionIds,
    },
  };
  await writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    reportPath,
    primaryPath,
    outputSha256,
    interpretationChecks: result.interpretationChecks,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (args?.outputDirectory) {
    await mkdir(args.outputDirectory, { recursive: true });
    primaryPath ||= path.join(args.outputDirectory, 'perturbation-result.json');
    reportPath ||= path.join(args.outputDirectory, 'run-report.json');
    if (primaryPathIsSafe) {
      await unlink(primaryPath).catch(unlinkError => {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      });
    }
    for (const visualPath of visualArtifactPaths) {
      await unlink(visualPath).catch(unlinkError => {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      });
    }
    if (reportPathIsSafe) await writeJson(reportPath, {
      schema: RUN_REPORT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      requestedParentAtlasPath: args.requestedParentAtlasPath,
      effectiveParentAtlasPath: effectiveParentAtlasPath
        ? receiptPath(effectiveParentAtlasPath)
        : null,
      requestedConstructionIds: args.requestedConstructionIds,
      effectiveConstructionIds: [],
      primaryOutput: null,
      outputSha256: null,
      lastTrustworthyEvidence: {
        phase: parentAtlasFileSha256 ? 'parent-atlas-read-and-hashed' : 'arguments-resolved',
        parentAtlasId: parentAtlasId || null,
        parentAtlasSha256: parentAtlasSha256 || null,
        parentAtlasFileSha256: parentAtlasFileSha256 || null,
        requestedConstructionIds: args.requestedConstructionIds,
      },
    });
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

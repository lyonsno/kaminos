#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const FOOTPRINT_ORACLE_SCHEMA = 'kaminos.boundary-splat-footprint-oracle.v0';
export const RADIANCE_TRAINING_SCHEMA = 'kaminos.boundary-splat-radiance-training.v0';
export const CORPUS_SCHEMA = 'kaminos-boundary-splat-supervision-corpus-v0';
export const CORPUS_AUTHORITY = 'live-simulator-frozen-state-candidate-raymarch-v0';
export const TARGET_DECOMPOSITION = 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0';
export const BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER = Object.freeze([
  'position.x', 'position.y', 'position.z',
  'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
  'material.density', 'material.heat', 'material.fuel', 'material.detail',
  'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
  'micro.x', 'micro.y', 'micro.z', 'micro.w',
]);

export const FOOTPRINT_PATH = Object.freeze({
  authority: 'current-boundary-splat-footprint-path-map-v0',
  candidateBaseRadius: 'cellWidth * (0.60 + sidecar.footprint * 2.65 + sidecar.ridge * 0.48)',
  learnedRadiusUnits: 'dimensionless radiusScale.x/y from the attribute head',
  globalRadiusUnits: 'dimensionless billboard scale applied in the raster vertex stage',
  sharpnessUnits: 'dimensionless Gaussian exponent multiplier applied in the fragment kernel',
  opacityUnits: 'per-splat colorOpacity.a before Gaussian kernel and energy compensation',
  radiusMultiplicationOrder: 'candidate base radius -> learned radiusScale.x/y -> global radius billboard scale; fragment alpha then applies Gaussian sharpness and energy compensation',
  energyCompensation: 'sqrt((sharpness / 3.4) / max(globalRadius^2, 0.1225)) clamped to 0.5..2.5',
  absoluteRadiusSubstitution: 'rejected',
});

const FAMILY_AUTHORITIES = Object.freeze({
  global: 'best-global-radius-sharpness-grid-v0',
  conditioned: 'least-expressive-conditioned-footprint-family-v0',
  'per-splat-table-oracle': 'strongest-current-per-splat-footprint-oracle-v0',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactArray(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} order mismatch`);
  }
}

function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be positive and finite`);
  return number;
}

function finiteVector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || value.some(item => !Number.isFinite(Number(item)))) {
    throw new Error(`${label} must contain ${length} finite values`);
  }
  return value.map(Number);
}

function resolveArtifactPath(manifestPath, artifact) {
  if (!artifact || typeof artifact.path !== 'string' || artifact.path.length === 0) {
    throw new Error('artifact path is missing');
  }
  return isAbsolute(artifact.path) ? artifact.path : resolve(dirname(manifestPath), artifact.path);
}

async function readVerifiedArtifact(manifestPath, artifact, label) {
  const path = resolveArtifactPath(manifestPath, artifact);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`${label} artifact is blank`);
  if (artifact.bytes !== bytes.length) {
    throw new Error(`${label} byte length mismatch: declared ${artifact.bytes}, actual ${bytes.length}`);
  }
  const digest = sha256(bytes);
  if (artifact.sha256 !== digest) {
    throw new Error(`${label} sha256 mismatch: declared ${artifact.sha256}, actual ${digest}`);
  }
  return { path, bytes, sha256: digest };
}

export async function loadFootprintOracleCorpus(corpusPathValue, options = {}) {
  const corpusPath = resolve(corpusPathValue);
  const manifestBytes = await readFile(corpusPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== CORPUS_SCHEMA) throw new Error(`corpus schema must be ${CORPUS_SCHEMA}`);
  if (manifest.authority !== CORPUS_AUTHORITY) throw new Error(`corpus authority must be ${CORPUS_AUTHORITY}`);
  exactArray(manifest.candidateOrder, BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER, 'candidate');
  const frames = [];
  for (const [index, frame] of (manifest.frames || []).entries()) {
    const label = `frame ${index}`;
    if (!frame.id || !frame.sameStateCaptureId) throw new Error(`${label} frame and same-state identities are required`);
    const candidateArtifact = await readVerifiedArtifact(corpusPath, frame.candidates, `${label} candidates`);
    if (frame.candidates.dtype !== 'float32-le') throw new Error(`${label} candidate dtype must be float32-le`);
    if (frame.candidates.strideFloats !== BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER.length) {
      throw new Error(`${label} candidate stride must equal ${BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER.length}`);
    }
    if (!Number.isInteger(frame.candidates.count) || frame.candidates.count <= 0) {
      throw new Error(`${label} candidate count must be a positive integer`);
    }
    const expectedCandidateBytes = frame.candidates.count * frame.candidates.strideFloats * 4;
    if (candidateArtifact.bytes.length !== expectedCandidateBytes) {
      throw new Error(`${label} candidate payload is partial: expected ${expectedCandidateBytes} bytes, got ${candidateArtifact.bytes.length}`);
    }
    const targetArtifact = await readVerifiedArtifact(corpusPath, frame.target, `${label} target`);
    if (frame.target.authority !== 'gpu-rgba8-raymarch-readback-frozen-sim-state') {
      throw new Error(`${label} target authority is not the frozen-state GPU readback`);
    }
    if (frame.target.decomposition !== TARGET_DECOMPOSITION) {
      throw new Error(`${label} target decomposition must be ${TARGET_DECOMPOSITION}`);
    }
    if (options.expectedRaySteps != null) {
      const expectedRaySteps = Number(options.expectedRaySteps);
      if (frame.target.requestedRaySteps !== expectedRaySteps) {
        throw new Error(`${label} target requested ray steps must equal ${expectedRaySteps}`);
      }
      if (frame.target.effectiveRaySteps !== expectedRaySteps) {
        throw new Error(`${label} target effective ray steps must equal ${expectedRaySteps}`);
      }
    }
    if (options.expectedRenderScale != null) {
      const expectedRenderScale = Number(options.expectedRenderScale);
      if (Math.abs(Number(frame.target.renderScale) - expectedRenderScale) > 0.001) {
        throw new Error(`${label} target render scale must equal ${expectedRenderScale}`);
      }
    }
    const camera = frame.camera || {};
    finiteVector(camera.viewProjection, 16, `${label} camera.viewProjection`);
    finiteVector(camera.cameraRight, 3, `${label} camera.cameraRight`);
    finiteVector(camera.cameraUp, 3, `${label} camera.cameraUp`);
    finiteVector(camera.viewport, 2, `${label} camera.viewport`);
    const splatControls = frame.splatControls || {};
    finitePositive(splatControls.radius, `${label} splatControls.radius`);
    finitePositive(splatControls.sharpness, `${label} splatControls.sharpness`);
    frames.push({
      id: frame.id,
      sameStateCaptureId: frame.sameStateCaptureId,
      candidateCount: frame.candidates.count,
      candidateArtifact: { ...frame.candidates, path: candidateArtifact.path },
      targetArtifact: { ...frame.target, path: targetArtifact.path },
      requestedRoute: frame.requestedRoute ?? null,
      effectiveRoute: frame.effectiveRoute ?? null,
      rendererIdentity: frame.rendererIdentity ?? null,
      sourceAuthority: frame.sourceAuthority ?? null,
      fallbackReason: frame.fallbackReason ?? null,
    });
  }
  if (frames.length === 0) throw new Error('corpus must contain at least one frame');
  return {
    path: corpusPath,
    identity: `sha256:${sha256(manifestBytes)}`,
    manifest,
    frames,
    frameCount: frames.length,
    candidateCount: frames.reduce((total, frame) => total + frame.candidateCount, 0),
  };
}

function artifactKey(frame, artifactName) {
  const artifact = frame[artifactName] || {};
  return JSON.stringify({
    path: artifact.path,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    dtype: artifact.dtype,
    count: artifact.count,
    strideFloats: artifact.strideFloats,
    decomposition: artifact.decomposition,
    requestedRaySteps: artifact.requestedRaySteps,
    effectiveRaySteps: artifact.effectiveRaySteps,
    renderScale: artifact.renderScale,
  });
}

export function assertCandidatePayloadPreserved(baseManifest, variantManifest) {
  const baseFrames = baseManifest.frames || [];
  const variantFrames = variantManifest.frames || [];
  if (baseFrames.length !== variantFrames.length) throw new Error('candidate payload changed: frame count changed');
  for (let index = 0; index < baseFrames.length; index += 1) {
    const base = baseFrames[index];
    const variant = variantFrames[index];
    if (base.id !== variant.id || base.sameStateCaptureId !== variant.sameStateCaptureId) {
      throw new Error(`candidate payload changed: frame identity changed at ${index}`);
    }
    if (artifactKey(base, 'candidates') !== artifactKey(variant, 'candidates')) {
      throw new Error(`candidate payload changed: candidates changed at ${base.id}`);
    }
    if (artifactKey(base, 'target') !== artifactKey(variant, 'target')) {
      throw new Error(`target payload changed while creating footprint variant at ${base.id}`);
    }
    if (JSON.stringify(base.camera) !== JSON.stringify(variant.camera)) {
      throw new Error(`candidate payload changed: camera changed at ${base.id}`);
    }
  }
}

function cloneWithAbsoluteArtifactPaths(sourceCorpus) {
  const manifest = structuredClone(sourceCorpus.manifest);
  for (const [index, frame] of manifest.frames.entries()) {
    frame.candidates.path = sourceCorpus.frames[index].candidateArtifact.path;
    frame.target.path = sourceCorpus.frames[index].targetArtifact.path;
    if (frame.flowDebug && sourceCorpus.frames[index].flowDebugArtifact) {
      frame.flowDebug.path = sourceCorpus.frames[index].flowDebugArtifact.path;
    }
  }
  return manifest;
}

export async function writeGlobalFootprintVariant({ sourceCorpus, outDir, radius, sharpness }) {
  const effectiveRadius = finitePositive(radius, 'global radius');
  const effectiveSharpness = finitePositive(sharpness, 'global sharpness');
  await mkdir(outDir, { recursive: true });
  const manifest = cloneWithAbsoluteArtifactPaths(sourceCorpus);
  for (const frame of manifest.frames) {
    frame.splatControls = {
      ...(frame.splatControls || {}),
      radius: effectiveRadius,
      sharpness: effectiveSharpness,
    };
    frame.footprintVariant = {
      authority: FAMILY_AUTHORITIES.global,
      requestedRadius: effectiveRadius,
      effectiveRadius,
      requestedSharpness: effectiveSharpness,
      effectiveSharpness,
      footprintSemantics: FOOTPRINT_PATH,
    };
  }
  assertCandidatePayloadPreserved(sourceCorpus.manifest, manifest);
  const manifestPath = join(outDir, `corpus-r${String(effectiveRadius).replaceAll('.', 'p')}-s${String(effectiveSharpness).replaceAll('.', 'p')}.json`);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return {
    path: manifestPath,
    manifest,
    authority: FAMILY_AUTHORITIES.global,
    radius: effectiveRadius,
    sharpness: effectiveSharpness,
    footprintSemantics: {
      radiusUnits: 'global-billboard-scale-times-learned-radius-scale',
      sharpnessUnits: FOOTPRINT_PATH.sharpnessUnits,
      absoluteRadiusSubstitution: 'rejected',
      multiplicationOrder: FOOTPRINT_PATH.radiusMultiplicationOrder,
    },
  };
}

export async function summarizeTrainingReport(reportPathValue, context = {}) {
  const reportPath = resolve(reportPathValue);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (report.schema !== RADIANCE_TRAINING_SCHEMA) {
    throw new Error(`training report schema must be ${RADIANCE_TRAINING_SCHEMA}`);
  }
  if (report.status === 'failed') {
    throw new Error(`training report failed during ${report.failurePhase || 'unknown'}: ${report.error || 'unknown error'}`);
  }
  if (!['trained', 'probe-only'].includes(report.status)) {
    throw new Error(`training report status is not complete: ${report.status || 'missing'}`);
  }
  const training = report.training || {};
  const modelArtifact = report.modelArtifact || {};
  const evaluationFrames = report.evaluationFrames || [];
  const acceptedFrameAuthorities = new Set([
    'explicit-disjoint-frame-holdout-v0',
    'explicit-single-frame-memorization-oracle-v0',
    'explicit-single-frame-per-candidate-table-oracle-v0',
  ]);
  if (!acceptedFrameAuthorities.has(training.frameSplitAuthority)) {
    throw new Error(`training report lacks explicit frame custody: ${training.frameSplitAuthority || 'missing'}`);
  }
  if (training.frameSplitAuthority === 'explicit-disjoint-frame-holdout-v0' && training.evaluationLossAuthority !== 'held-out-frame-mean-v0') {
    throw new Error('held-out frame split did not preserve held-out evaluation loss authority');
  }
  if (training.frameSplitAuthority === 'explicit-single-frame-per-candidate-table-oracle-v0' && training.evaluationLossAuthority !== 'same-frame-per-candidate-table-oracle-v0') {
    throw new Error('per-candidate table oracle did not preserve same-frame evaluation loss authority');
  }
  if (!evaluationFrames.length) throw new Error('training report contains no evaluation frame rows');
  const trainedLoss = Number(training.trainedLoss);
  const initialLoss = Number(training.initialLoss);
  if (!Number.isFinite(trainedLoss) || !Number.isFinite(initialLoss)) {
    throw new Error('training report loss values are missing or non-finite');
  }
  return {
    family: context.family || training.modelAuthority || modelArtifact.authority || 'unknown',
    familyAuthority: FAMILY_AUTHORITIES[context.family] || null,
    reportPath,
    status: report.status,
    backend: report.backend || null,
    device: report.device || null,
    requestedRadius: context.requestedRadius ?? null,
    requestedSharpness: context.requestedSharpness ?? null,
    effectiveRadius: context.effectiveRadius ?? context.requestedRadius ?? null,
    effectiveSharpness: context.effectiveSharpness ?? context.requestedSharpness ?? null,
    modelAuthority: training.modelAuthority || modelArtifact.authority || null,
    modelArtifactAuthority: modelArtifact.authority || null,
    modelSchema: modelArtifact.schema || null,
    deployable: modelArtifact.deployable ?? null,
    frameSplitAuthority: training.frameSplitAuthority,
    evaluationLossAuthority: training.evaluationLossAuthority,
    trainFrameIds: training.trainFrameIds || [],
    evaluationFrameIds: training.evaluationFrameIds || [],
    requestedSteps: training.requestedSteps ?? null,
    effectiveSteps: training.steps ?? null,
    initialLoss,
    trainedLoss,
    initialPixelLoss: training.initialPixelLoss ?? null,
    trainedPixelLoss: training.trainedPixelLoss ?? null,
    initialEdgeLoss: training.initialEdgeLoss ?? null,
    trainedEdgeLoss: training.trainedEdgeLoss ?? null,
    evaluationFrames,
  };
}

export function rankOracleRows(rows) {
  return [...rows]
    .sort((left, right) => {
      const leftLoss = Number.isFinite(Number(left.trainedLoss)) ? Number(left.trainedLoss) : Number.POSITIVE_INFINITY;
      const rightLoss = Number.isFinite(Number(right.trainedLoss)) ? Number(right.trainedLoss) : Number.POSITIVE_INFINITY;
      return leftLoss - rightLoss;
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildFootprintOracleReport({ sourceCorpus, rows, requestedFamilies, commandReceipts }) {
  const rankedRows = rankOracleRows(rows || []);
  const bestGlobal = rankedRows.find(row => row.family === 'global') || null;
  const bestOverall = rankedRows[0] || null;
  return {
    schema: FOOTPRINT_ORACLE_SCHEMA,
    status: rankedRows.length ? 'complete' : 'planned',
    authority: 'frozen-state-footprint-covariance-opacity-oracle-v0',
    sourceCorpus: {
      path: sourceCorpus.path,
      identity: sourceCorpus.identity,
      frameCount: sourceCorpus.frameCount,
      candidateCount: sourceCorpus.candidateCount,
      frameIds: sourceCorpus.frames.map(frame => frame.id),
      sameStateCaptureIds: sourceCorpus.frames.map(frame => frame.sameStateCaptureId),
    },
    target: {
      decomposition: TARGET_DECOMPOSITION,
      routeIdentityPreserved: true,
    },
    footprintPath: FOOTPRINT_PATH,
    familyAuthorities: FAMILY_AUTHORITIES,
    requestedFamilies,
    commandReceipts,
    rows: rankedRows,
    decisionInputs: {
      bestGlobal,
      bestOverall,
      majorityOfRemainingErrorBaseline: bestGlobal ? 'best-global-radius-sharpness-grid-v0' : null,
      heldOutResidualRequired: true,
      trainingViewOnlyClosureAllowed: false,
    },
  };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument ${token}`);
    if (token === '--execute' || token === '--allow-train-eval-all') {
      args.set(token, true);
      continue;
    }
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${token} requires a value`);
    args.set(token, value);
    index += 1;
  }
  return args;
}

function parseNumberList(value, label) {
  if (value == null || String(value).trim() === '') throw new Error(`${label} is required`);
  return String(value).split(',').map(part => finitePositive(part.trim(), label));
}

function parseList(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  return String(value).split(',').map(part => part.trim()).filter(Boolean);
}

function radianceCommand({ python, script, corpusPath, outDir, args, family }) {
  const command = [
    python,
    script,
    '--corpus', corpusPath,
    '--out-dir', outDir,
    '--expected-ray-steps', String(args.expectedRaySteps),
    '--expected-render-scale', String(args.expectedRenderScale),
    '--train-frame-indices', args.trainFrameIndices,
    '--eval-frame-indices', args.evalFrameIndices,
    '--render-width', String(args.renderWidth),
    '--edge-weight', String(args.edgeWeight),
    '--depth-bins', String(args.depthBins),
  ];
  if (family === 'global') {
    command.push('--steps', '0', '--probe-only');
  } else {
    command.push('--steps', String(args.steps));
  }
  if (family === 'conditioned') {
    command.push('--context-mode', args.conditionedContextMode);
  }
  if (family === 'per-splat-table-oracle') {
    command.push('--candidate-table-oracle');
  }
  return command;
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const corpusPath = argv.get('--corpus');
  const outDir = argv.get('--out-dir');
  if (!corpusPath || !outDir) throw new Error('--corpus and --out-dir are required');
  const families = parseList(argv.get('--families'), ['global']);
  for (const family of families) {
    if (!FAMILY_AUTHORITIES[family]) throw new Error(`unsupported oracle family ${family}`);
  }
  const executionArgs = {
    expectedRaySteps: Number(argv.get('--expected-ray-steps') || 160),
    expectedRenderScale: Number(argv.get('--expected-render-scale') || 1),
    trainFrameIndices: argv.get('--train-frame-indices') || null,
    evalFrameIndices: argv.get('--eval-frame-indices') || null,
    renderWidth: Number(argv.get('--render-width') || 320),
    edgeWeight: Number(argv.get('--edge-weight') || 0),
    depthBins: Number(argv.get('--depth-bins') || 1),
    steps: Number(argv.get('--steps') || 160),
    conditionedContextMode: argv.get('--conditioned-context-mode') || 'world-fourier',
  };
  if ((!executionArgs.trainFrameIndices || !executionArgs.evalFrameIndices) && !argv.get('--allow-train-eval-all')) {
    throw new Error('explicit --train-frame-indices and --eval-frame-indices are required unless --allow-train-eval-all is set');
  }
  const sourceCorpus = await loadFootprintOracleCorpus(corpusPath, {
    expectedRaySteps: executionArgs.expectedRaySteps,
    expectedRenderScale: executionArgs.expectedRenderScale,
  });
  const python = argv.get('--python') || 'python3';
  const script = resolve(argv.get('--radiance-script') || join(dirname(fileURLToPath(import.meta.url)), 'boundary-splat-radiance-mlx.py'));
  if (!existsSync(script)) throw new Error(`radiance script not found: ${script}`);
  await mkdir(outDir, { recursive: true });
  const rows = [];
  const commandReceipts = [];
  const execute = Boolean(argv.get('--execute'));
  const radii = families.includes('global') ? parseNumberList(argv.get('--global-radius-values'), '--global-radius-values') : [];
  const sharpnesses = families.includes('global') ? parseNumberList(argv.get('--global-sharpness-values'), '--global-sharpness-values') : [];
  for (const radius of radii) {
    for (const sharpness of sharpnesses) {
      const variant = await writeGlobalFootprintVariant({
        sourceCorpus,
        outDir: join(outDir, 'global-variants'),
        radius,
        sharpness,
      });
      const runDir = join(outDir, 'runs', `global-r${String(radius).replaceAll('.', 'p')}-s${String(sharpness).replaceAll('.', 'p')}`);
      const command = radianceCommand({ python, script, corpusPath: variant.path, outDir: runDir, args: executionArgs, family: 'global' });
      const receipt = { family: 'global', authority: FAMILY_AUTHORITIES.global, radius, sharpness, command, executed: execute };
      if (execute) {
        await mkdir(runDir, { recursive: true });
        const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
        receipt.exitCode = result.status;
        receipt.stdout = result.stdout;
        receipt.stderr = result.stderr;
        if (result.status !== 0) throw new Error(`global oracle command failed for radius ${radius}, sharpness ${sharpness}: ${result.stderr || result.stdout}`);
        rows.push(await summarizeTrainingReport(join(runDir, 'training-report.json'), {
          family: 'global',
          requestedRadius: radius,
          requestedSharpness: sharpness,
        }));
      }
      commandReceipts.push(receipt);
    }
  }
  for (const family of families.filter(item => item !== 'global')) {
    const runDir = join(outDir, 'runs', family);
    const command = radianceCommand({ python, script, corpusPath: sourceCorpus.path, outDir: runDir, args: executionArgs, family });
    const receipt = { family, authority: FAMILY_AUTHORITIES[family], command, executed: execute };
    if (execute) {
      await mkdir(runDir, { recursive: true });
      const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
      receipt.exitCode = result.status;
      receipt.stdout = result.stdout;
      receipt.stderr = result.stderr;
      if (result.status !== 0) throw new Error(`${family} oracle command failed: ${result.stderr || result.stdout}`);
      rows.push(await summarizeTrainingReport(join(runDir, 'training-report.json'), { family }));
    }
    commandReceipts.push(receipt);
  }
  const report = buildFootprintOracleReport({ sourceCorpus, rows, requestedFamilies: families, commandReceipts });
  const reportPath = join(outDir, 'footprint-oracle-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ status: report.status, report: reportPath, commandCount: commandReceipts.length, rowCount: report.rows.length }) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

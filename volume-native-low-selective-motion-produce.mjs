#!/usr/bin/env node
import { createHash, randomInt } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCHEMA = 'kaminos.volume.native-low-selective-motion-producer.v0';
const IDENTITY = 'streamed-native-low-zero-shot-selective-motion-production-v0';
const INPUT_AUTHORITY = 'native-low-simulator-state-no-synthetic-downsample-v0';
const TEMPORAL_AUTHORITY = 'consecutive-native-low-simulator-states-frozen-model-application-v0';
const BASE_ROLES = ['nativeLowControl', 'nativeLowSelectivePredicted'];
const args = parseArgs(process.argv.slice(2));
const scriptRoot = dirname(new URL(import.meta.url).pathname);
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-native-low-selective-motion'));
const manifestPath = resolve(String(args.get('--manifest') || join(outDir, 'producer-manifest.json')));
let failurePhase = 'argument-validation';
let activeManifest = null;
let frameManifestPaths = [];
let deletionReceipts = [];
let sharedBrowserPid = null;

try {
  mkdirSync(outDir, { recursive: true });
  const sourceCapturePath = requiredPath('--source-capture');
  const targetOrigin = required('--target-origin');
  const startStep = requiredInteger('--start-step', 0);
  const frameCount = requiredInteger('--frame-count', 1);
  const planOnly = args.has('--plan-only');
  const modelManifestPath = resolve(String(args.get('--model-manifest') || join(
    scriptRoot, 'models/selective-head-live/exact-basin-160-to-128-v0/manifest.json',
  )));
  const viewportSize = String(args.get('--viewport-size') || '1200,1000');
  const renderCanvasSize = String(args.get('--render-canvas-size') || '1000,1000');
  const renderComposition = String(args.get('--render-composition') || 'splat-only-v0');
  const deployedChannels = String(args.get('--channels') || 'fuel,visibleFireCarrier,fireLick,frontTopology')
    .split(',').map(value => value.trim()).filter(Boolean);
  const residualScale = Number(args.get('--residual-scale') ?? 1);
  const materializationMode = String(args.get('--materialization-mode') || 'normalized-nearest-cell-low-to-output-grid-v0');
  const includeMaterializedControl = args.has('--include-materialized-control');
  const roles = includeMaterializedControl
    ? ['nativeLowControl', 'deterministicMaterializedControl', 'nativeLowSelectivePredicted']
    : BASE_ROLES;
  const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
  const userDataDir = resolve(String(args.get('--user-data-dir') || join(outDir, '.chrome-profile')));
  if (!existsSync(modelManifestPath)) throw new Error(`model manifest does not exist: ${modelManifestPath}`);
  if (!/^\d+,\d+$/.test(viewportSize) || !/^\d+,\d+$/.test(renderCanvasSize)) {
    throw new Error('viewport and render canvas sizes must be WIDTH,HEIGHT');
  }
  if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) throw new Error(`invalid debug port: ${debugPort}`);
  if (!['splat-only-v0', 'raymarch-only-v0'].includes(renderComposition)) throw new Error(`unsupported render composition: ${renderComposition}`);
  if (!Number.isFinite(residualScale) || residualScale < 0) throw new Error(`invalid residual scale: ${residualScale}`);
  const target = new URL(targetOrigin);
  if (target.pathname !== '/' || target.search || target.hash) throw new Error('--target-origin must contain only origin');

  failurePhase = 'source-capture-validation';
  const sourceCaptureRaw = readFileSync(sourceCapturePath);
  const sourceCapture = JSON.parse(sourceCaptureRaw);
  if (sourceCapture.schema !== 'kaminos.operator-exact-live-splat-basin-capture.v1') {
    throw new Error('source capture schema mismatch');
  }
  const replayRoute = new URL(String(sourceCapture.replayRoute || sourceCapture.sourceReplayRoute || ''));
  const routeGrid = Number(replayRoute.searchParams.get('volume_resolution'));
  const controlGrid = Number(sourceCapture.controls?.volume_resolution || sourceCapture.controls?.volumeResolution || routeGrid);
  const expectedNativeGrid = Number(args.get('--expected-native-grid') || 128);
  if (!Number.isInteger(expectedNativeGrid) || expectedNativeGrid < 2 || routeGrid !== expectedNativeGrid || controlGrid !== expectedNativeGrid) {
    throw new Error(`native-low motion witness grid mismatch, expected=${expectedNativeGrid} route=${routeGrid} controls=${controlGrid}`);
  }

  failurePhase = 'model-validation';
  const modelRaw = readFileSync(modelManifestPath);
  const model = JSON.parse(modelRaw);
  const trainedLowGrid = Number(model.source?.lowGrid);
  const predictedGrid = Number(model.source?.highGrid);
  if (!model.identity || model.status !== 'captured' || model.failurePhase !== null
    || !Number.isInteger(trainedLowGrid) || !Number.isInteger(predictedGrid) || predictedGrid <= trainedLowGrid) {
    throw new Error('frozen model identity/status mismatch');
  }
  const crossGridApplication = expectedNativeGrid !== trainedLowGrid;
  if (crossGridApplication && !args.has('--allow-cross-grid-native-input')) {
    throw new Error(`model trained grid ${trainedLowGrid} differs from native grid ${expectedNativeGrid}; explicit cross-grid admission required`);
  }
  const modelArtifactPath = resolveArtifact(String(model.packed?.path || ''), modelManifestPath);
  if (!existsSync(modelArtifactPath)) throw new Error(`frozen model artifact is missing: ${modelArtifactPath}`);
  const modelSha256 = sha256(readFileSync(modelArtifactPath));
  if (modelSha256 !== model.packed?.sha256) throw new Error('frozen model checksum mismatch');

  const sourceCaptureSha256 = sha256(sourceCaptureRaw);
  const sequenceIdentity = `native-low-${sourceCaptureSha256.slice(0, 12)}-steps-${startStep}-${startStep + frameCount - 1}`;
  const frames = Array.from({ length: frameCount }, (_, frameIndex) => buildFramePlan({
    frameIndex,
    simulationStep: startStep + frameIndex,
    sourceCapturePath,
    targetOrigin: target.origin,
    modelManifestPath,
    viewportSize,
    renderCanvasSize,
    renderComposition,
    deployedChannels,
    residualScale,
    materializationMode,
    includeMaterializedControl,
    roles,
    crossGridApplication,
    debugPort,
    userDataDir,
  }));
  const baseManifest = {
    schema: SCHEMA,
    identity: IDENTITY,
    status: planOnly ? 'planned' : 'running',
    failurePhase: null,
    executionAuthority: planOnly ? 'plan-only-no-gpu-work-performed-v0' : 'browser-gpu-execution-in-progress-v0',
    inputAuthority: INPUT_AUTHORITY,
    temporalAuthority: TEMPORAL_AUTHORITY,
    runtimeTruthAvailable: false,
    recurrentPrediction: false,
    sourceCapture: {
      path: sourceCapturePath,
      sha256: sourceCaptureSha256,
      payloadSha256: sourceCapture.payloadSha256 || null,
    },
    model: {
      identity: model.identity,
      manifestPath: modelManifestPath,
      manifestSha256: sha256(modelRaw),
      modelArtifactPath,
      modelSha256,
    },
    sequenceIdentity,
    nativeGrid: expectedNativeGrid,
    predictedGrid,
    simulationSteps: frames.map(frame => frame.simulationStep),
    frameCount,
    roles,
    renderCompositionRequested: renderComposition,
    deployment: {
      channels: deployedChannels,
      residualScale,
      materializationMode,
      trainedLowGrid,
      applicationLowGrid: expectedNativeGrid,
      crossGridApplication,
    },
    viewportSize,
    renderCanvasSize,
    browserSession: {
      identity: 'producer-owned-shared-cdp-browser-v0',
      debugPort,
      userDataDir,
      reuseBrowser: true,
      keepBrowserOpenDuringProduction: true,
    },
    retention: {
      identity: 'stream-one-native-state-retain-paired-images-and-receipts-v0',
      ephemeralFieldArtifactsDeletedAfterFrameReceipt: true,
      deleteOnFailure: false,
      retainedArtifacts: 'paired-images-frame-receipts-and-sequence-witness',
    },
    frames,
  };
  activeManifest = baseManifest;
  writeJson(manifestPath, baseManifest);

  if (planOnly) {
    console.log(JSON.stringify({ status: 'planned', manifest: manifestPath }, null, 2));
  } else {
    frameManifestPaths = [];
    deletionReceipts = [];
    for (const frame of frames) {
      failurePhase = `frame-${frame.frameIndex}-execution`;
      const captured = executeFrame(frame, {
        sourceCaptureSha256,
        sequenceIdentity,
        modelSha256,
        nativeGrid: expectedNativeGrid,
        renderComposition,
        includeMaterializedControl,
        roles,
      });
      if (!sharedBrowserPid && captured.browserPid) sharedBrowserPid = captured.browserPid;
      frameManifestPaths.push(captured.frameManifestPath);
      deletionReceipts.push(captured.deletionReceipt);
      activeManifest = {
        ...baseManifest,
        status: 'running',
        capturedFrameCount: frameManifestPaths.length,
        frameManifests: frameManifestPaths,
        deletionReceipts,
      };
      writeJson(manifestPath, activeManifest);
    }
    failurePhase = 'witness-assembly';
    const witness = assembleWitness(frames, sequenceIdentity, renderComposition, expectedNativeGrid, predictedGrid, roles);
    activeManifest = {
      ...baseManifest,
      status: 'captured',
      executionAuthority: 'browser-gpu-consecutive-native-low-frame-production-v0',
      frameManifests: frameManifestPaths,
      deletionReceipts,
      witness,
    };
    writeJson(manifestPath, activeManifest);
    console.log(JSON.stringify({ status: 'captured', manifest: manifestPath, witness }, null, 2));
  }
} catch (error) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeJson(manifestPath, {
    ...(activeManifest || {}),
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    frameManifests: frameManifestPaths,
    deletionReceipts,
  });
  console.error(error?.stack || String(error));
  process.exitCode = 1;
} finally {
  if (sharedBrowserPid) {
    try { process.kill(sharedBrowserPid, 'SIGTERM'); } catch {}
  }
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else { values.set(key, next); index += 1; }
  }
  return values;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

function requiredPath(name) {
  const path = resolve(required(name));
  if (!existsSync(path)) throw new Error(`${name} does not exist: ${path}`);
  return path;
}

function requiredInteger(name, minimum) {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}

function resolveArtifact(path, manifestPathValue) {
  if (!path) return '';
  return path.startsWith('/') ? resolve(path) : resolve(dirname(manifestPathValue), path);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function quote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=,+-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function commandString(command, commandArgs) {
  return [command, ...commandArgs].map(quote).join(' ');
}

function run(command, commandArgs, phase) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${phase} failed (${result.status}): ${commandString(command, commandArgs)}\n${result.stderr || result.stdout}`);
  }
  return result;
}

function buildFramePlan(context) {
  const tag = `frame-${String(context.frameIndex).padStart(4, '0')}-step-${context.simulationStep}`;
  const scratchRoot = join(outDir, '.work', tag);
  const captureRoot = join(outDir, 'captures');
  const nativeDir = join(scratchRoot, 'native');
  const predictedDir = join(scratchRoot, 'predicted');
  const renderDir = join(scratchRoot, 'render');
  const materializedControlDir = join(scratchRoot, 'materialized-control');
  const materializedControlRenderDir = join(scratchRoot, 'materialized-control-render');
  const nativeArgs = [
    join(scriptRoot, 'volume-full-grid-field-export.mjs'),
    '--source-capture', context.sourceCapturePath,
    '--target-origin', context.targetOrigin,
    '--out-dir', nativeDir,
    '--manifest', join(nativeDir, 'manifest.json'),
    '--export-scope', 'fluid-front-only-v0',
    '--deterministic-replay-steps', String(context.simulationStep),
    '--chunk-floats', '262144',
    '--debug-port', String(context.debugPort),
    '--user-data-dir', context.userDataDir,
    '--reuse-browser',
    '--keep-browser-open',
  ];
  const composeArgs = [
    join(scriptRoot, 'volume-native-low-selective-compose.py'),
    '--native-manifest', join(nativeDir, 'manifest.json'),
    '--model-manifest', context.modelManifestPath,
    '--out-dir', predictedDir,
    '--manifest', join(predictedDir, 'manifest.json'),
    '--channels', context.deployedChannels.join(','),
    '--residual-scale', String(context.residualScale),
    '--materialization-mode', context.materializationMode,
  ];
  if (context.crossGridApplication) composeArgs.push('--allow-cross-grid-native-input');
  const materializedControlComposeArgs = context.includeMaterializedControl
    ? composeArgs.map((value, index, values) => {
      if (value === predictedDir) return materializedControlDir;
      if (value === join(predictedDir, 'manifest.json')) return join(materializedControlDir, 'manifest.json');
      if (index > 0 && values[index - 1] === '--residual-scale') return '0';
      return value;
    })
    : null;
  const renderArgs = [
    join(scriptRoot, 'volume-native-low-selective-witness.mjs'),
    '--native-manifest', join(nativeDir, 'manifest.json'),
    '--predicted-manifest', join(predictedDir, 'manifest.json'),
    '--source-capture', context.sourceCapturePath,
    '--target-origin', context.targetOrigin,
    '--out-dir', renderDir,
    '--manifest', join(renderDir, 'manifest.json'),
    '--viewport-size', context.viewportSize,
    '--render-canvas-size', context.renderCanvasSize,
    '--render-composition', context.renderComposition,
    '--debug-port', String(context.debugPort),
    '--user-data-dir', context.userDataDir,
    '--reuse-browser',
    '--keep-browser-open',
  ];
  const materializedControlRenderArgs = context.includeMaterializedControl ? [
    join(scriptRoot, 'volume-native-low-selective-witness.mjs'),
    '--native-manifest', join(nativeDir, 'manifest.json'),
    '--predicted-manifest', join(materializedControlDir, 'manifest.json'),
    '--source-capture', context.sourceCapturePath,
    '--target-origin', context.targetOrigin,
    '--out-dir', materializedControlRenderDir,
    '--manifest', join(materializedControlRenderDir, 'manifest.json'),
    '--viewport-size', context.viewportSize,
    '--render-canvas-size', context.renderCanvasSize,
    '--render-composition', context.renderComposition,
    '--debug-port', String(context.debugPort),
    '--user-data-dir', context.userDataDir,
    '--reuse-browser',
    '--keep-browser-open',
  ] : null;
  return {
    frameIndex: context.frameIndex,
    simulationStep: context.simulationStep,
    roles: context.roles,
    paths: {
      scratchRoot, captureRoot, nativeDir, predictedDir, renderDir, materializedControlDir, materializedControlRenderDir,
    },
    commands: {
      nativeExport: commandString(process.execPath, nativeArgs),
      compose: commandString('python3', composeArgs),
      render: commandString(process.execPath, renderArgs),
      ...(context.includeMaterializedControl ? {
        composeMaterializedControl: commandString('python3', materializedControlComposeArgs),
        renderMaterializedControl: commandString(process.execPath, materializedControlRenderArgs),
      } : {}),
    },
    argv: {
      nativeExport: nativeArgs,
      compose: composeArgs,
      render: renderArgs,
      materializedControlCompose: materializedControlComposeArgs,
      materializedControlRender: materializedControlRenderArgs,
    },
  };
}

function executeFrame(frame, identity) {
  mkdirSync(frame.paths.scratchRoot, { recursive: true });
  mkdirSync(frame.paths.captureRoot, { recursive: true });
  run(process.execPath, frame.argv.nativeExport, `native-export-frame-${frame.frameIndex}`);
  run('python3', frame.argv.compose, `native-compose-frame-${frame.frameIndex}`);
  run(process.execPath, frame.argv.render, `native-render-frame-${frame.frameIndex}`);
  if (identity.includeMaterializedControl) {
    run('python3', frame.argv.materializedControlCompose, `materialized-control-compose-frame-${frame.frameIndex}`);
    run(process.execPath, frame.argv.materializedControlRender, `materialized-control-render-frame-${frame.frameIndex}`);
  }

  const nativeManifestPath = join(frame.paths.nativeDir, 'manifest.json');
  const predictedManifestPath = join(frame.paths.predictedDir, 'manifest.json');
  const renderManifestPath = join(frame.paths.renderDir, 'manifest.json');
  const native = readJson(nativeManifestPath);
  const predicted = readJson(predictedManifestPath);
  const rendered = readJson(renderManifestPath);
  const materializedControlManifestPath = join(frame.paths.materializedControlDir, 'manifest.json');
  const materializedControlRenderManifestPath = join(frame.paths.materializedControlRenderDir, 'manifest.json');
  const materializedControl = identity.includeMaterializedControl ? readJson(materializedControlManifestPath) : null;
  const materializedControlRendered = identity.includeMaterializedControl ? readJson(materializedControlRenderManifestPath) : null;
  if (native.status !== 'captured' || native.failurePhase !== null || native.grid !== identity.nativeGrid) {
    throw new Error('native frame export authority mismatch');
  }
  const browserPid = native.browserSession?.mode === 'launched-shared'
    ? Number(native.browserSession.pid) || null
    : null;
  if (predicted.status !== 'captured' || predicted.failurePhase !== null
    || predicted.inputAuthority !== INPUT_AUTHORITY || predicted.runtimeTruthAvailable !== false) {
    throw new Error('native frame prediction authority mismatch');
  }
  if (rendered.status !== 'captured' || rendered.failurePhase !== null
    || rendered.sameNativeStateIdentity !== predicted.sameNativeStateIdentity
    || rendered.renderer?.requested !== identity.renderComposition
    || rendered.renderer?.controlEffective !== identity.renderComposition
    || rendered.renderer?.treatmentEffective !== identity.renderComposition
    || rendered.renderer?.raymarchExcludedFromDiscriminant !== (identity.renderComposition === 'splat-only-v0')) {
    throw new Error('native frame render route or state identity mismatch');
  }
  if (identity.includeMaterializedControl && (
    materializedControl.status !== 'captured' || materializedControl.failurePhase !== null
    || materializedControl.inputAuthority !== INPUT_AUTHORITY
    || materializedControl.runtimeTruthAvailable !== false
    || materializedControl.deployment?.residualScale !== 0
    || materializedControl.sameNativeStateIdentity !== predicted.sameNativeStateIdentity
    || materializedControlRendered.status !== 'captured' || materializedControlRendered.failurePhase !== null
    || materializedControlRendered.sameNativeStateIdentity !== predicted.sameNativeStateIdentity
    || materializedControlRendered.renderer?.requested !== identity.renderComposition
    || materializedControlRendered.renderer?.controlEffective !== identity.renderComposition
    || materializedControlRendered.renderer?.treatmentEffective !== identity.renderComposition
  )) {
    throw new Error('deterministic materialized control authority, route, or state identity mismatch');
  }

  const retainedRoles = {};
  for (const role of identity.roles) {
    const sourceRole = role === 'deterministicMaterializedControl' ? 'nativeLowSelectivePredicted' : role;
    const sourceRendered = role === 'deterministicMaterializedControl' ? materializedControlRendered : rendered;
    const sourceImage = resolve(String(sourceRendered.roles?.[sourceRole]?.image?.path || ''));
    if (!existsSync(sourceImage)) throw new Error(`${role} image is missing: ${sourceImage}`);
    const retainedPath = join(frame.paths.captureRoot, `${String(frame.frameIndex).padStart(4, '0')}-${role}.png`);
    copyFileSync(sourceImage, retainedPath);
    const bytes = readFileSync(retainedPath);
    const imageSha256 = sha256(bytes);
    if (imageSha256 !== sourceRendered.roles[sourceRole].image.sha256) throw new Error(`${role} retained image checksum mismatch`);
    retainedRoles[role] = {
      ...sourceRendered.roles[sourceRole],
      role,
      image: { ...sourceRendered.roles[sourceRole].image, path: retainedPath, sha256: imageSha256, byteLength: bytes.byteLength },
    };
  }

  const frameManifestPath = join(outDir, 'frame-manifests', `frame-${String(frame.frameIndex).padStart(4, '0')}.json`);
  const frameManifest = {
    schema: 'kaminos.volume.native-low-selective-motion-frame.v0',
    identity: 'matched-native-low-control-materialized-control-selective-predicted-frame-v0',
    status: 'captured',
    failurePhase: null,
    sequenceIdentity: identity.sequenceIdentity,
    frameIndex: frame.frameIndex,
    simulationStep: frame.simulationStep,
    inputAuthority: INPUT_AUTHORITY,
    temporalAuthority: TEMPORAL_AUTHORITY,
    runtimeTruthAvailable: false,
    sameNativeStateIdentity: predicted.sameNativeStateIdentity,
    modelIdentity: predicted.model?.identity,
    modelSha256: predicted.model?.modelSha256,
    nativeControlsSignature: native.deterministicReplay?.controlsSignature,
    nativeRoute: native.effectiveRoute,
    nativeBackend: native.backend,
    support: {
      threshold: predicted.support?.threshold,
      predictedPositiveCount: predicted.support?.predictedPositiveCount,
      predictedPrevalence: predicted.support?.predictedPrevalence,
    },
    renderer: rendered.renderer,
    roles: retainedRoles,
    ephemeralEvidence: {
      nativeManifestSha256: sha256(readFileSync(nativeManifestPath)),
      predictedManifestSha256: sha256(readFileSync(predictedManifestPath)),
      renderManifestSha256: sha256(readFileSync(renderManifestPath)),
      nativeFluidSha256: native.sidecars?.fluid?.sha256,
      nativeFrontSha256: native.sidecars?.front?.sha256,
      predictedFluidSha256: predicted.receiver?.fluid?.sha256,
      predictedFrontSha256: predicted.receiver?.front?.sha256,
      materializedControlManifestSha256: materializedControl ? sha256(readFileSync(materializedControlManifestPath)) : null,
      materializedControlRenderManifestSha256: materializedControlRendered ? sha256(readFileSync(materializedControlRenderManifestPath)) : null,
      materializedControlFluidSha256: materializedControl?.receiver?.fluid?.sha256 || null,
      materializedControlFrontSha256: materializedControl?.receiver?.front?.sha256 || null,
    },
    retention: {
      identity: 'checksums-and-images-retained-field-binaries-deleted-v0',
      ephemeralRoot: frame.paths.scratchRoot,
      deleteAfterFrameManifest: true,
    },
  };
  writeJson(frameManifestPath, frameManifest);
  const frameManifestSha256 = sha256(readFileSync(frameManifestPath));
  const deletionReceipt = {
    identity: 'tool-owned-ephemeral-field-artifact-deletion-v0',
    frameIndex: frame.frameIndex,
    root: frame.paths.scratchRoot,
    frameManifestPath,
    frameManifestSha256,
    deleted: true,
  };
  rmSync(frame.paths.scratchRoot, { recursive: true, force: true });
  return { frameManifestPath, deletionReceipt, browserPid };
}

function assembleWitness(frames, sequenceIdentity, renderComposition, nativeGrid, predictedGrid, roles) {
  const records = frameManifestPaths.map(readJson);
  if (records.length !== frames.length) throw new Error('frame receipt count mismatch');
  for (let index = 0; index < records.length; index += 1) {
    if (records[index].frameIndex !== index || records[index].simulationStep !== frames[index].simulationStep) {
      throw new Error(`non-consecutive frame receipt at index ${index}`);
    }
  }
  const witnessDir = join(outDir, 'witness');
  mkdirSync(witnessDir, { recursive: true });
  const htmlPath = join(witnessDir, 'index.html');
  writeFileSync(htmlPath, htmlPage(records, sequenceIdentity, renderComposition, nativeGrid, predictedGrid, roles));
  return {
    identity: 'synchronized-native-low-control-treatment-playback-v0',
    indexPath: htmlPath,
    frameCount: records.length,
    simulationSteps: records.map(record => record.simulationStep),
    roles,
    requestedComposition: renderComposition,
    effectiveComposition: renderComposition,
    raymarchExcludedFromDiscriminant: renderComposition === 'splat-only-v0',
  };
}

function htmlPage(records, sequenceIdentity, renderComposition, nativeGrid, predictedGrid, roles) {
  const relative = path => `../captures/${path.split('/').pop()}`;
  const frames = records.map(record => ({
    index: record.frameIndex,
    step: record.simulationStep,
    control: relative(record.roles.nativeLowControl.image.path),
    materialized: record.roles.deterministicMaterializedControl
      ? relative(record.roles.deterministicMaterializedControl.image.path)
      : null,
    treatment: relative(record.roles.nativeLowSelectivePredicted.image.path),
    prevalence: record.support.predictedPrevalence,
  }));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native-low temporal transfer</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#07090a;color:#eef2f3}*{box-sizing:border-box}body{margin:0;background:#07090a}header{min-height:58px;padding:10px 16px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #30383a;background:#111516}h1{font-size:16px;margin:0;white-space:nowrap}.controls{display:flex;align-items:center;gap:8px;margin-left:auto}button,select,input{accent-color:#e06c43}button,select{height:34px;border:1px solid #414b4e;background:#1b2224;color:#edf2f3;padding:0 11px}button{cursor:pointer}.readout{font:12px ui-monospace,monospace;color:#acb8bb;min-width:180px}.grid{height:calc(100vh - 58px);display:grid;grid-template-columns:repeat(${roles.length},minmax(0,1fr));gap:2px;background:#30383a}.panel{min-width:0;min-height:0;background:#000;display:grid;grid-template-rows:48px 1fr}.label{padding:8px 12px;background:#101415}.label strong{font-size:14px}.label span{display:block;font-size:10px;color:#9daaad;margin-top:2px}.image-wrap{min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}.image-wrap img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;image-rendering:auto}@media(max-width:850px){header{height:auto;flex-wrap:wrap}.controls{margin-left:0}.grid{height:auto;grid-template-columns:1fr}.panel{height:70vh}}
</style></head><body><header><h1>Native ${nativeGrid} non-phasal front residual</h1><div class="readout" id="readout"></div><div class="controls"><button id="play" type="button">Pause</button><label>Speed <select id="speed"><option value="16.6667">1x</option><option value="33.3333" selected>0.5x</option><option value="66.6667">0.25x</option></select></label><input id="scrub" type="range" min="0" max="${records.length - 1}" value="0" step="1"></div></header><main class="grid"><section class="panel"><div class="label"><strong>Native ${nativeGrid} control</strong><span>Untouched native state at native resolution</span></div><div class="image-wrap"><img id="control" alt="Native-low control"></div></section>${roles.includes('deterministicMaterializedControl') ? `<section class="panel"><div class="label"><strong>Deterministic ${predictedGrid} control</strong><span>Same native state materialized to ${predictedGrid}^3, zero residual</span></div><div class="image-wrap"><img id="materialized" alt="Deterministic materialized control"></div></section>` : ''}<section class="panel"><div class="label"><strong>Learned ${predictedGrid} treatment</strong><span>Only the frozen front residual differs from deterministic control</span></div><div class="image-wrap"><img id="treatment" alt="Native-low selective predicted"></div></section></main><script>
const frames=${JSON.stringify(frames)};const sequence=${JSON.stringify(sequenceIdentity)};const composition=${JSON.stringify(renderComposition)};let index=0,playing=true,timer=null;const control=document.querySelector('#control'),materialized=document.querySelector('#materialized'),treatment=document.querySelector('#treatment'),readout=document.querySelector('#readout'),scrub=document.querySelector('#scrub'),play=document.querySelector('#play'),speed=document.querySelector('#speed');function show(next){index=(next+frames.length)%frames.length;const frame=frames[index];control.src=frame.control;if(materialized)materialized.src=frame.materialized;treatment.src=frame.treatment;scrub.value=String(index);readout.textContent='frame '+(index+1)+'/'+frames.length+' | step '+frame.step+' | support '+(100*frame.prevalence).toFixed(2)+'%';}function schedule(){clearInterval(timer);if(playing)timer=setInterval(()=>show(index+1),Number(speed.value));}play.addEventListener('click',()=>{playing=!playing;play.textContent=playing?'Pause':'Play';schedule();});speed.addEventListener('change',schedule);scrub.addEventListener('input',()=>show(Number(scrub.value)));show(0);schedule();console.info({sequence,frameCount:frames.length,roles:${JSON.stringify(roles)},composition,raymarchApplied:composition==='raymarch-only-v0'});
</script></body></html>`;
}

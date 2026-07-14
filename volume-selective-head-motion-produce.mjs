#!/usr/bin/env node
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCHEMA = 'kaminos.volume.selective-head-motion-producer.v0';
const TEMPORAL_AUTHORITY = 'consecutive-phase-aligned-per-frame-frozen-model-application-v0';
const TRANSFER_MODE = 'consecutive-phase-aligned-sequence-v0';
const PAIR_AUTHORITY = 'downsampled-same-high-history-input-to-exact-high-target';
const RENDER_COMPOSITION = 'raymarch-under-splats-v0';
const PARTIAL_DEBUG_AUTHORITY = 'render-only-control-override-v0';
const ROLES = ['truthHigh', 'lowPhaseAligned', 'selectiveFullResidual', 'selectiveCalibratedResidual'];
const BEAUTY_OVERRIDES = {
  fireRenderMode: 'off', fire: 0, radiance: 0, glow: 0, shellAmount: 0,
  density: 0.25, smoke: 0.25, flowDebug: 0,
};

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-selective-head-motion-production'));
const manifestPath = resolve(String(args.get('--manifest') || join(outDir, 'producer-manifest.json')));
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};
let sharedBrowserPid = null;

process.on('SIGINT', () => {
  writeJson(manifestPath, {
    schema: SCHEMA,
    identity: 'streamed-phase-aligned-selective-head-motion-production-v0',
    status: 'failed',
    failurePhase: 'interrupted',
    error: 'operator interrupted producer execution',
    lastTrustworthyEvidence,
  });
  if (sharedBrowserPid) {
    try { process.kill(sharedBrowserPid, 'SIGTERM'); } catch {}
  }
  process.exit(130);
});

try {
  mkdirSync(outDir, { recursive: true });
  const sourceCapturePath = requiredPath('--source-capture');
  const supportProbePath = requiredPath('--support-probe-manifest');
  const targetOrigin = required('--target-origin');
  const startStep = requiredInteger('--start-step', 0);
  const frameCount = requiredInteger('--frame-count', 1);
  const sequenceFrameCount = args.has('--sequence-frame-count')
    ? requiredInteger('--sequence-frame-count', 1)
    : frameCount;
  const targetFrameIndex = args.has('--target-frame-index')
    ? requiredInteger('--target-frame-index', 0)
    : null;
  const supportThreshold = requiredNumber('--support-threshold');
  const calibratedResidualScale = requiredNumber('--calibrated-residual-scale');
  const partialFlowDebugMix = Number(args.get('--partial-flow-debug-mix') || 0.625);
  const planOnly = args.has('--plan-only');
  const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
  const userDataDir = resolve(String(args.get('--user-data-dir') || join(outDir, '.chrome-profile')));
  const renderWarmupCount = Number(args.get('--render-warmup-count') || 2);
  const windowSize = String(args.get('--window-size') || '1240,720');
  const viewportSize = String(args.get('--viewport-size') || '1620,633');

  if (!Number.isFinite(partialFlowDebugMix) || partialFlowDebugMix < 0.5 || partialFlowDebugMix > 0.75) {
    failurePhase = 'render-contract-validation';
    throw new Error(`partial debug mix must be within 0.50-0.75: ${partialFlowDebugMix}`);
  }
  if (!(supportThreshold > 0 && supportThreshold < 1)) throw new Error('support threshold must be between zero and one');
  if (!(calibratedResidualScale > 0 && calibratedResidualScale < 1)) throw new Error('calibrated residual scale must be between zero and one');
  if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) throw new Error(`invalid debug port: ${debugPort}`);
  if (!Number.isInteger(renderWarmupCount) || renderWarmupCount < 0) throw new Error(`invalid render warmup count: ${renderWarmupCount}`);
  if (!/^\d+,\d+$/.test(viewportSize)) throw new Error('--viewport-size must be WIDTH,HEIGHT');
  if (targetFrameIndex !== null && frameCount !== 1) {
    throw new Error('--target-frame-index requires --frame-count 1');
  }
  if (targetFrameIndex !== null && targetFrameIndex >= sequenceFrameCount) {
    throw new Error('--target-frame-index must be less than --sequence-frame-count');
  }
  const target = new URL(targetOrigin);
  if (target.pathname !== '/' || target.search || target.hash) throw new Error('--target-origin must contain only origin');

  failurePhase = 'checkpoint-validation';
  const sourceCapture = readJson(sourceCapturePath);
  const sourceCaptureSha = String(sourceCapture.payloadSha256 || '');
  if (sourceCapture.schema !== 'kaminos.operator-exact-live-splat-basin-capture.v1' || !/^[a-f0-9]{64}$/i.test(sourceCaptureSha)) {
    throw new Error('source capture schema or payload SHA-256 mismatch');
  }
  const supportProbeRaw = readFileSync(supportProbePath);
  const supportProbe = JSON.parse(supportProbeRaw);
  if (supportProbe.schema !== 'kaminos.volume.exact-basin-support-probe.v0' || supportProbe.status !== 'captured' || supportProbe.failurePhase !== null) {
    throw new Error('support probe is not captured');
  }
  const trainingPairPath = resolve(String(supportProbe.inputs?.pairManifest?.path || ''));
  const trainingPairRaw = readFileSync(trainingPairPath);
  const trainingPairSha = sha256(trainingPairRaw);
  if (trainingPairSha !== supportProbe.inputs?.pairManifest?.sha256) throw new Error('support probe training pair SHA-256 mismatch');
  const trainingPair = JSON.parse(trainingPairRaw);
  if (trainingPair.schema !== 'kaminos.volume.full-grid-field-pair.v0' || trainingPair.status !== 'captured' || trainingPair.authority !== PAIR_AUTHORITY) {
    throw new Error('support probe training pair authority mismatch');
  }
  if (trainingPair.source?.exactBasinSourceCaptureSha256 !== sourceCaptureSha) throw new Error('source capture differs from support probe training basin');
  const trainingStep = Number(trainingPair.source?.deterministicReplay?.completedSteps);
  const lowGrid = Number(trainingPair.lowGrid);
  const highGrid = Number(trainingPair.highGrid);
  if (!Number.isInteger(trainingStep) || !Number.isInteger(lowGrid) || !Number.isInteger(highGrid) || highGrid <= lowGrid) {
    throw new Error('training pair grid or step identity is invalid');
  }
  failurePhase = 'sequence-validation';
  if (startStep !== trainingStep + 1) throw new Error(`sequence must begin immediately after training step ${trainingStep}: ${startStep}`);

  const cadenceMs = Number(trainingPair.source?.deterministicReplay?.timeStepMs || 1000 / 60);
  const controlsSignature = String(trainingPair.source?.deterministicReplay?.controlsSignature || '');
  if (!controlsSignature) throw new Error('training pair omitted replay controls signature');
  const modelIdentity = `sha256:${sha256(supportProbeRaw)}`;
  const sequenceIdentity = `selective-head-${sourceCaptureSha.slice(0, 12)}-steps-${startStep}-${startStep + sequenceFrameCount - 1}`;
  const context = {
    sourceCapturePath, supportProbePath, targetOrigin: target.origin, startStep, frameCount, sequenceFrameCount,
    supportThreshold, calibratedResidualScale, partialFlowDebugMix, debugPort, userDataDir,
    renderWarmupCount, windowSize, viewportSize, lowGrid, highGrid,
  };
  const frameIndexes = targetFrameIndex === null
    ? Array.from({ length: frameCount }, (_, frameIndex) => frameIndex)
    : [targetFrameIndex];
  const frames = frameIndexes.map(frameIndex => buildFramePlan(context, frameIndex));
  const baseManifest = {
    schema: SCHEMA,
    identity: 'streamed-phase-aligned-selective-head-motion-production-v0',
    status: planOnly ? 'planned' : 'running',
    failurePhase: null,
    executionAuthority: planOnly ? 'plan-only-no-gpu-work-performed-v0' : 'gpu-browser-execution-in-progress-v0',
    temporalAuthority: TEMPORAL_AUTHORITY,
    recurrentPrediction: false,
    staticSidecarOverMovingMaterial: false,
    sourceCapture: { path: sourceCapturePath, payloadSha256: sourceCaptureSha },
    supportProbe: { path: supportProbePath, sha256: sha256(supportProbeRaw) },
    trainingPair: { path: trainingPairPath, sha256: trainingPairSha },
    trainingStep,
    sequenceIdentity,
    sequenceFrameCount,
    targetedRegeneration: targetFrameIndex === null ? null : {
      identity: 'targeted-sequence-frame-regeneration-v0',
      frameIndex: targetFrameIndex,
      simulationStep: startStep + targetFrameIndex,
    },
    simulationSteps: frames.map(frame => frame.simulationStep),
    cadenceMs,
    lowGrid,
    highGrid,
    supportThreshold,
    calibratedResidualScale,
    partialFlowDebugMix,
    renderComposition: RENDER_COMPOSITION,
    roles: ROLES,
    retention: {
      identity: 'stream-one-frame-retain-images-and-receipts-v0',
      ephemeralFieldArtifactsDeletedAfterFrameReceipt: true,
      deleteOnFailure: false,
    },
    frames,
  };
  writeJson(manifestPath, baseManifest);
  lastTrustworthyEvidence = {
    planManifest: manifestPath,
    sourceCaptureSha256: sourceCaptureSha,
    supportProbeSha256: sha256(supportProbeRaw),
    simulationSteps: baseManifest.simulationSteps,
  };
  if (planOnly) {
    console.log(JSON.stringify({ ok: true, status: 'planned', manifest: manifestPath }, null, 2));
  } else {
    const capturedFramePaths = [];
    const deletionReceipts = [];
    for (const frame of frames) {
      failurePhase = `frame-${frame.frameIndex}-execution`;
      const captured = executeFrame(frame, context, {
        sequenceIdentity, cadenceMs, controlsSignature, sourceCaptureSha, modelIdentity,
      });
      capturedFramePaths.push(captured.frameManifestPath);
      deletionReceipts.push(captured.deletionReceipt);
      if (!sharedBrowserPid && captured.browserPid) sharedBrowserPid = captured.browserPid;
      lastTrustworthyEvidence = { ...lastTrustworthyEvidence, capturedFrameCount: capturedFramePaths.length, lastCapturedFrameManifest: captured.frameManifestPath };
    }
    let capturedManifest;
    if (targetFrameIndex !== null) {
      capturedManifest = {
        ...baseManifest,
        status: 'captured',
        executionAuthority: 'browser-gpu-targeted-sequence-frame-regeneration-v0',
        frameManifests: capturedFramePaths,
        deletionReceipts,
        witness: null,
      };
    } else {
      failurePhase = 'witness-assembly';
      const witnessDir = join(outDir, 'witness');
      const assemble = [
        join(dirname(new URL(import.meta.url).pathname), 'volume-selective-head-motion-witness.mjs'),
        ...capturedFramePaths.flatMap(path => ['--frame-manifest', path]),
        '--out-dir', witnessDir,
        '--expected-frame-count', String(frameCount),
        '--partial-debug-mix', String(partialFlowDebugMix),
      ];
      runCommand(process.execPath, assemble, failurePhase);
      const witnessManifestPath = join(witnessDir, 'manifest.json');
      const witness = readJson(witnessManifestPath);
      if (witness.status !== 'captured' || witness.frameCount !== frameCount) throw new Error('assembled witness did not capture every requested frame');
      capturedManifest = {
        ...baseManifest,
        status: 'captured',
        executionAuthority: 'browser-gpu-consecutive-frame-production-v0',
        frameManifests: capturedFramePaths,
        deletionReceipts,
        witness: {
          manifestPath: witnessManifestPath,
          manifestSha256: sha256(readFileSync(witnessManifestPath)),
          indexPath: join(witnessDir, 'index.html'),
        },
      };
    }
    writeJson(manifestPath, capturedManifest);
    console.log(JSON.stringify({ ok: true, status: 'captured', manifest: manifestPath, witness: capturedManifest.witness }, null, 2));
  }
} catch (error) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeJson(manifestPath, {
    schema: SCHEMA,
    identity: 'streamed-phase-aligned-selective-head-motion-production-v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
  });
  console.error(JSON.stringify({ ok: false, manifest: manifestPath, failurePhase, error: error?.message || String(error) }, null, 2));
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
    else {
      values.set(key, next);
      index += 1;
    }
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

function requiredNumber(name) {
  const value = Number(required(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function quote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=,+-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function commandString(command, commandArgs) {
  return [command, ...commandArgs].map(quote).join(' ');
}

function buildFramePlan(context, frameIndex) {
  const scriptRoot = dirname(new URL(import.meta.url).pathname);
  const simulationStep = context.startStep + frameIndex;
  const frameRoot = join(outDir, '.work', `frame-${String(frameIndex).padStart(4, '0')}-step-${simulationStep}`);
  const captureRoot = join(outDir, 'captures', `frame-${String(frameIndex).padStart(4, '0')}-step-${simulationStep}`);
  const highDir = join(frameRoot, 'high');
  const pairDir = join(frameRoot, 'pair');
  const fullDir = join(frameRoot, 'selective-full');
  const calibratedDir = join(frameRoot, 'selective-calibrated');
  const commonBrowser = [
    '--source-capture', context.sourceCapturePath,
    '--target-origin', context.targetOrigin,
    '--debug-port', String(context.debugPort),
    '--user-data-dir', context.userDataDir,
    '--reuse-browser',
    '--keep-browser-open',
    '--window-size', context.windowSize,
    '--viewport-size', context.viewportSize,
    '--chunk-floats', '262144',
  ];
  const highArgs = [
    join(scriptRoot, 'volume-full-grid-field-export.mjs'),
    ...commonBrowser,
    '--export-scope', 'fluid-front-only-v0',
    '--out-dir', highDir,
    '--deterministic-replay-steps', String(simulationStep),
  ];
  const pairArgs = [
    join(scriptRoot, 'volume-phase-aligned-field-pair.py'),
    '--high-manifest', join(highDir, 'manifest.json'),
    '--low-grid', String(context.lowGrid),
    '--out-dir', pairDir,
  ];
  const composeArgs = scale => [
    join(scriptRoot, 'volume-exact-basin-selective-compose.py'),
    '--pair-manifest', join(pairDir, 'pair-manifest.json'),
    '--support-probe-manifest', context.supportProbePath,
    '--out-dir', scale === 1 ? fullDir : calibratedDir,
    '--support-threshold', String(context.supportThreshold),
    '--residual-scale', String(scale),
    '--checkpoint-transfer-mode', TRANSFER_MODE,
    '--sequence-start-step', String(context.startStep),
    '--sequence-frame-index', String(frameIndex),
  ];
  const roleManifests = {
    truthHigh: join(pairDir, 'truth-high-held-manifest.json'),
    lowPhaseAligned: join(pairDir, 'low-phase-aligned-held-manifest.json'),
    selectiveFullResidual: join(fullDir, 'manifest.json'),
    selectiveCalibratedResidual: join(calibratedDir, 'manifest.json'),
  };
  const partialOverrides = { ...BEAUTY_OVERRIDES, flowDebug: context.partialFlowDebugMix };
  const renderArgs = role => [
    join(scriptRoot, 'volume-full-grid-field-export.mjs'),
    ...commonBrowser,
    '--out-dir', join(frameRoot, `render-${role}`),
    '--initial-field-manifest', roleManifests[role],
    '--advance-imported-steps', '0',
    '--render-only',
    '--render-warmup-count', String(context.renderWarmupCount),
    '--render-composition', RENDER_COMPOSITION,
    '--render-png', join(captureRoot, `${role}-beauty.png`),
    '--render-control-overrides-json', JSON.stringify(BEAUTY_OVERRIDES),
    '--secondary-render-png', join(captureRoot, `${role}-partial-flow.png`),
    '--secondary-render-control-overrides-json', JSON.stringify(partialOverrides),
  ];
  return {
    frameIndex,
    simulationStep,
    roles: ROLES,
    paths: { frameRoot, captureRoot, highDir, pairDir, fullDir, calibratedDir, roleManifests },
    argv: {
      highExport: highArgs,
      pair: pairArgs,
      selectiveFullResidual: composeArgs(1),
      selectiveCalibratedResidual: composeArgs(context.calibratedResidualScale),
      renders: Object.fromEntries(ROLES.map(role => [role, renderArgs(role)])),
    },
    commands: {
      highExport: commandString(process.execPath, highArgs),
      pair: commandString('python3', pairArgs),
      selectiveFullResidual: commandString('python3', composeArgs(1)),
      selectiveCalibratedResidual: commandString('python3', composeArgs(context.calibratedResidualScale)),
      renders: Object.fromEntries(ROLES.map(role => [role, commandString(process.execPath, renderArgs(role))])),
    },
  };
}

function runCommand(command, commandArgs, phase) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${phase} failed (${result.status}): ${commandString(command, commandArgs)}\n${result.stderr || result.stdout}`);
  }
  return result;
}

function executeFrame(frame, context, identity) {
  mkdirSync(frame.paths.frameRoot, { recursive: true });
  mkdirSync(frame.paths.captureRoot, { recursive: true });
  runCommand(process.execPath, frame.argv.highExport, `high-export-frame-${frame.frameIndex}`);
  const highManifestPath = join(frame.paths.highDir, 'manifest.json');
  const highManifest = readJson(highManifestPath);
  const browserPid = Number(highManifest.browserSession?.pid) || null;
  runCommand('python3', frame.argv.pair, `pair-frame-${frame.frameIndex}`);
  runCommand('python3', frame.argv.selectiveFullResidual, `full-compose-frame-${frame.frameIndex}`);
  runCommand('python3', frame.argv.selectiveCalibratedResidual, `calibrated-compose-frame-${frame.frameIndex}`);

  const captures = {};
  let cropIdentity = null;
  for (const role of ROLES) {
    runCommand(process.execPath, frame.argv.renders[role], `render-${role}-frame-${frame.frameIndex}`);
    const renderManifestPath = join(frame.paths.frameRoot, `render-${role}`, 'manifest.json');
    const renderManifest = readJson(renderManifestPath);
    if (renderManifest.status !== 'captured' || renderManifest.failurePhase !== null) throw new Error(`${role} render was not captured`);
    const beauty = renderManifest.importedRender;
    const partial = renderManifest.importedSecondaryRender;
    if (!beauty || !partial) throw new Error(`${role} omitted a same-state beauty or partial-debug render`);
    if (beauty.controlOverrides?.flowDebug !== 0 || partial.controlOverrides?.flowDebug !== context.partialFlowDebugMix) {
      throw new Error(`${role} render controls do not match beauty/partial-debug contract`);
    }
    if (beauty.simStepCount !== partial.simStepCount || beauty.baseSimStepCount !== partial.baseSimStepCount) {
      throw new Error(`${role} beauty and partial-debug views are not the same frozen field state`);
    }
    const effectiveCrop = sha256(Buffer.from(JSON.stringify({
      rect: beauty.canvasCssRect,
      intrinsicWidth: beauty.canvasMount?.intrinsicWidth,
      intrinsicHeight: beauty.canvasMount?.intrinsicHeight,
    })));
    if (cropIdentity && cropIdentity !== effectiveCrop) throw new Error(`camera/crop drift at ${role}`);
    cropIdentity = effectiveCrop;
    captures[role] = {
      role,
      beauty: imageDescriptor(beauty),
      partialFlowDebug: {
        ...imageDescriptor(partial),
        requestedMix: context.partialFlowDebugMix,
        effectiveMix: partial.controlOverrides.flowDebug,
        applicationAuthority: PARTIAL_DEBUG_AUTHORITY,
      },
      renderReceipt: {
        effectiveRoute: beauty.effectiveRoute,
        backend: beauty.backend,
        composition: beauty.boundarySplatCompositionEffective,
        learnedDecoder: beauty.boundarySplatRendererIdentity,
        learnedDecoderModel: beauty.boundarySplatAttributeModelIdentity,
        fallback: beauty.boundarySplatFallbackReason ?? null,
        viewportContract: renderManifest.viewportContract,
        canvas: {
          cssRect: beauty.canvasCssRect,
          intrinsicWidth: beauty.canvasMount?.intrinsicWidth,
          intrinsicHeight: beauty.canvasMount?.intrinsicHeight,
        },
        boundarySplatCandidateCount: beauty.boundarySplatCandidateCount,
        boundarySplatInstanceCount: beauty.boundarySplatInstanceCount,
        boundarySplatOverflowCount: beauty.boundarySplatOverflowCount,
      },
    };
  }

  const pairManifestPath = join(frame.paths.pairDir, 'pair-manifest.json');
  const fullManifestPath = join(frame.paths.fullDir, 'manifest.json');
  const calibratedManifestPath = join(frame.paths.calibratedDir, 'manifest.json');
  const fieldEvidence = {
    highExport: manifestEvidence(highManifestPath),
    pair: manifestEvidence(pairManifestPath),
    selectiveFullResidual: manifestEvidence(fullManifestPath, ['metrics', 'checkpointTransfer', 'supportGate', 'residualBlend']),
    selectiveCalibratedResidual: manifestEvidence(calibratedManifestPath, ['metrics', 'checkpointTransfer', 'supportGate', 'residualBlend']),
  };
  const frameManifestPath = join(outDir, 'frame-manifests', `frame-${String(frame.frameIndex).padStart(4, '0')}.json`);
  const frameManifest = {
    schema: 'kaminos.volume.selective-head-motion-frame.v0',
    identity: 'per-frame-frozen-selective-checkpoint-hybrid-render-v0',
    status: 'captured',
    failurePhase: null,
    sequenceIdentity: identity.sequenceIdentity,
    frameIndex: frame.frameIndex,
    simulationStep: frame.simulationStep,
    simulationTimeMs: frame.simulationStep * identity.cadenceMs,
    cadenceMs: identity.cadenceMs,
    cameraIdentity: `source-controls:${identity.sourceCaptureSha}:${sha256(Buffer.from(identity.controlsSignature))}`,
    cropIdentity: `canvas:${cropIdentity}`,
    sourceCaptureSha256: identity.sourceCaptureSha,
    phaseAlignedPairAuthority: PAIR_AUTHORITY,
    selectiveModelIdentity: identity.modelIdentity,
    supportThreshold: context.supportThreshold,
    calibratedResidualScale: context.calibratedResidualScale,
    captures,
    fieldEvidence,
    retention: {
      identity: 'checksums-and-metrics-retained-binaries-deleted-v0',
      ephemeralRoot: frame.paths.frameRoot,
      deleteAfterFrameManifest: true,
    },
  };
  writeJson(frameManifestPath, frameManifest);
  const deletionReceipt = {
    identity: 'ephemeral-field-artifact-deletion-v0',
    frameIndex: frame.frameIndex,
    root: frame.paths.frameRoot,
    frameManifestPath,
    frameManifestSha256: sha256(readFileSync(frameManifestPath)),
    deleted: true,
  };
  rmSync(frame.paths.frameRoot, { recursive: true, force: true });
  return { frameManifestPath, deletionReceipt, browserPid };
}

function imageDescriptor(receipt) {
  const path = resolve(String(receipt.path || ''));
  if (!existsSync(path)) throw new Error(`render image is missing: ${path}`);
  const bytes = readFileSync(path);
  const actualSha = sha256(bytes);
  if (actualSha !== receipt.sha256) throw new Error(`render image SHA-256 mismatch: ${path}`);
  return { path, sha256: actualSha, byteLength: bytes.byteLength };
}

function manifestEvidence(path, keys = []) {
  const bytes = readFileSync(path);
  const manifest = JSON.parse(bytes);
  const evidence = {
    path,
    sha256: sha256(bytes),
    schema: manifest.schema,
    identity: manifest.identity,
    status: manifest.status,
    failurePhase: manifest.failurePhase,
  };
  for (const key of keys) evidence[key] = manifest[key] ?? null;
  return evidence;
}

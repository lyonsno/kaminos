#!/usr/bin/env node
import { createHash, randomInt } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const MANIFEST_SCHEMA = 'kaminos.volume.full-grid-field-export.v0';
const EXPORT_IDENTITY = 'full-grid-fluid-front-boundary-sidecars-v0';
const COARSE_RECEIVER_SCHEMA = 'kaminos.volume.coarse-receiver-initial.v0';
const COARSE_RECEIVER_AUTHORITY = 'receiver-initialized-from-filtered-high-t-v0';
const COARSE_RECEIVER_FILTER = 'volume-overlap-box-filter-high-to-receiver-v0';
const SELECTIVE_COMPOSITION_SCHEMA = 'kaminos.volume.exact-basin-selective-composition.v0';
const SELECTIVE_COMPOSITION_AUTHORITY = 'learned-selective-head-composition-not-filtered-high-truth-v0';
const SELECTIVE_COMPOSITION_APPLICATION = 'learned-selective-head-application-v0';
const DIAGNOSTIC_VELOCITY_ORACLE_AUTHORITY = 'offline-high-truth-diagnostic-velocity-oracle-v0';
const DIAGNOSTIC_VELOCITY_ORACLE_APPLICATION = 'offline-diagnostic-velocity-oracle-application-v0';
const FIRE_FLOW_COMPOSITION_SCHEMA = 'kaminos.volume.fire-flow-carrier-composition.v0';
const FIRE_FLOW_COMPOSITION_AUTHORITY = 'frozen-fire-flow-carrier-fire-lick-composition-v0';
const FIRE_FLOW_COMPOSITION_APPLICATION = 'positive-carrier-residual-to-fire-lick-application-v0';
const SCALAR_ACTIVITY_CUE_SCHEMA = 'kaminos.volume.exact-basin-support-probe.v0';
const FROZEN_TRANSFER_CUE_SCHEMA = 'kaminos.volume.fire-flow-carrier-frozen-transfer.v0';
const SCALAR_ACTIVITY_CUE_APPLICATION = 'learned-fire-flow-visibility-carrier-v0';
const BOUNDARY_SPLAT_DISPLACEMENT_SCHEMA = 'kaminos.volume.boundary-splat-displacement-probe.v0';
const BOUNDARY_SPLAT_DISPLACEMENT_AUTHORITY = 'validation-selected-vacancy-gated-offset-class-grid-v0';
const BOUNDARY_SPLAT_DISPLACEMENT_APPLICATION = 'render-only-vacancy-gated-one-cell-splat-displacement-v0';
const SCALAR_ACTIVITY_CUE_AUTHORITIES = new Set([
  'exact-high-field-renderer-coupled-derived-target-v0',
  'native-low-derived-then-nearest-upsampled-control-v0',
  'full-low-state-spatial-mlp-derived-carrier-v0',
  'support-probability-weighted-derived-carrier-v0',
  'validation-selected-residual-gate-derived-carrier-v0',
  'accepted-splat-support-gated-derived-carrier-v0',
  'frozen-earlier-replay-ridge-derived-carrier-v0',
  'frozen-earlier-replay-ungated-derived-carrier-v0',
  'frozen-earlier-replay-source-selected-gate-derived-carrier-v0',
  'frozen-earlier-replay-constant-residual-scale-derived-carrier-v0',
]);
const FIELD_LAYOUT_IDENTITY = 'x-fastest-zyx-c-interleaved-v0';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) args.set(key, true);
  else {
    args.set(key, next);
    i += 1;
  }
}

const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-full-grid-field-export'));
const manifestPath = resolve(String(args.get('--manifest') || join(outDir, 'manifest.json')));
const requestedUrl = String(args.get('--url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1');
const sourceCapturePath = args.has('--source-capture') ? resolve(String(args.get('--source-capture'))) : null;
const initialFieldManifestPath = args.has('--initial-field-manifest') ? resolve(String(args.get('--initial-field-manifest'))) : null;
const scalarActivityCueManifestPath = args.has('--scalar-activity-cue-manifest') ? resolve(String(args.get('--scalar-activity-cue-manifest'))) : null;
const scalarActivityCueRole = args.has('--scalar-activity-cue-role') ? String(args.get('--scalar-activity-cue-role')) : null;
const boundarySplatDisplacementManifestPath = args.has('--boundary-splat-displacement-manifest')
  ? resolve(String(args.get('--boundary-splat-displacement-manifest')))
  : null;
const renderPngPath = args.has('--render-png') ? resolve(String(args.get('--render-png'))) : null;
const renderOnly = args.has('--render-only');
const renderWarmupCount = Math.max(0, Math.floor(Number(args.get('--render-warmup-count') || 0)));
const renderCompositionExplicit = args.has('--render-composition');
const renderComposition = String(args.get('--render-composition') || 'splat-only-v0');
const targetOrigin = args.has('--target-origin') ? String(args.get('--target-origin')) : null;
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const reuseBrowser = args.has('--reuse-browser');
const keepBrowserOpen = args.has('--keep-browser-open');
const userDataDir = String(args.get('--user-data-dir') || mkdtempSync('/tmp/kaminos-full-grid-field-export-profile-'));
const settleMs = Number(args.get('--settle-ms') || 1500);
const windowSize = String(args.get('--window-size') || '960,720');
const chunkFloats = Math.max(1, Math.floor(Number(args.get('--chunk-floats') || 262144)));
const deterministicReplaySteps = Number(args.get('--deterministic-replay-steps') || 0);
const deterministicReplayRequested = Number.isFinite(deterministicReplaySteps) && deterministicReplaySteps > 0;
const deterministicReplayTimeStepMs = Number(args.get('--deterministic-replay-time-step-ms') || (1000 / 60));
const deterministicReplayStartTimeMs = Number(args.get('--deterministic-replay-start-ms') || 1000);
const advanceImportedSteps = Math.max(0, Math.floor(Number(args.get('--advance-imported-steps') || 0)));

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeManifest(payload) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function resolveInitialFieldManifest() {
  if (!initialFieldManifestPath) return null;
  if (deterministicReplayRequested) {
    throw new Error('--initial-field-manifest and --deterministic-replay-steps are mutually exclusive');
  }
  const raw = readFileSync(initialFieldManifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.status !== 'captured') throw new Error(`unsupported initial field status: ${manifest.status || '(missing)'}`);
  if (manifest.failurePhase !== null) throw new Error('initial field manifest carries a failure phase');
  const isCoarseReceiver = manifest.schema === COARSE_RECEIVER_SCHEMA;
  const isSelectiveComposition = manifest.schema === SELECTIVE_COMPOSITION_SCHEMA;
  const isFireFlowComposition = manifest.schema === FIRE_FLOW_COMPOSITION_SCHEMA;
  if (!isCoarseReceiver && !isSelectiveComposition && !isFireFlowComposition) {
    throw new Error(`unsupported initial field manifest: ${manifest.schema || '(missing)'}/${manifest.status || '(missing)'}`);
  }
  if (isCoarseReceiver && manifest.initializationAuthority !== COARSE_RECEIVER_AUTHORITY) {
    throw new Error(`unsupported initialization authority: ${manifest.initializationAuthority || '(missing)'}`);
  }
  if (isCoarseReceiver && manifest.filterIdentity !== COARSE_RECEIVER_FILTER) {
    throw new Error(`unsupported receiver filter: ${manifest.filterIdentity || '(missing)'}`);
  }
  const isVelocityOracle = isSelectiveComposition
    && manifest.compositionAuthority === DIAGNOSTIC_VELOCITY_ORACLE_AUTHORITY;
  const isLearnedSelectiveComposition = isSelectiveComposition
    && manifest.compositionAuthority === SELECTIVE_COMPOSITION_AUTHORITY;
  if (isSelectiveComposition) {
    if ((!isLearnedSelectiveComposition && !isVelocityOracle) || manifest.runtimeTruthAvailable !== false) {
      throw new Error('selective composition authority or runtime truth contract mismatch');
    }
    if (manifest.consumptionContract?.requiresExplicitSchemaAdmission !== true
      || !String(manifest.consumptionContract?.mustNotBeAcceptedAs || '').includes('coarse-receiver-initial')) {
      throw new Error('selective composition mustNotBeAcceptedAs filtered-high receiver state');
    }
    if (isVelocityOracle
      && (manifest.diagnosticVelocity?.identity !== 'exact-high-velocity-transplant-oracle-v0'
        || manifest.diagnosticVelocity?.highTruthReadAtApplication !== true
        || manifest.diagnosticVelocity?.deployable !== false
        || !String(manifest.consumptionContract?.mustNotBePromotedAs || '').match(/prediction|runtime/i))) {
      throw new Error('diagnostic velocity oracle identity or non-promotion contract mismatch');
    }
  }
  if (isFireFlowComposition) {
    if (manifest.compositionAuthority !== FIRE_FLOW_COMPOSITION_AUTHORITY
      || manifest.runtimeTruthAvailable !== false
      || manifest.policy?.identity !== 'positive-carrier-residual-to-fire-lick-v0'
      || manifest.policy?.channel !== 'fireLick'
      || Number(manifest.policy?.channelIndex) !== 14
      || manifest.policy?.subtractiveResidualApplied !== false
      || manifest.policy?.clippingApplied !== false) {
      throw new Error('fire-flow composition authority or fireLick policy mismatch');
    }
    if (manifest.verification?.unchangedFluidChannelCount !== 15
      || manifest.verification?.unchangedFluidMismatchCount !== 0
      || manifest.verification?.frontByteIdenticalToLowUpsampled !== true
      || manifest.verification?.frontMismatchCount !== 0) {
      throw new Error('fire-flow composition unchanged-field verification mismatch');
    }
    if (manifest.consumptionContract?.requiresExplicitSchemaAdmission !== true
      || !String(manifest.consumptionContract?.mustNotBeAcceptedAs || '').includes('coarse-receiver-initial')
      || manifest.consumptionContract?.heldOnly !== true
      || manifest.consumptionContract?.smokeChannelsPredicted !== false
      || manifest.consumptionContract?.physicalTruth !== false
      || !String(manifest.consumptionContract?.mustNotBePromotedAs || '').match(/smoke|native-low|simulation-force/i)) {
      throw new Error('fire-flow composition held-only or non-promotion contract mismatch');
    }
    if (manifest.source?.carrierRole === 'frozenConstant'
      && (manifest.source?.targetDataUsedForTraining !== false
        || manifest.source?.targetDataUsedForCalibration !== false
        || manifest.source?.targetLabelsUsedForModelSelection !== false)) {
      throw new Error('frozen fire-flow composition target exclusion contract mismatch');
    }
  }
  const layoutIdentity = isCoarseReceiver || isFireFlowComposition ? manifest.layoutIdentity : FIELD_LAYOUT_IDENTITY;
  if (layoutIdentity !== FIELD_LAYOUT_IDENTITY) throw new Error(`unsupported receiver layout: ${layoutIdentity || '(missing)'}`);
  const grid = Number(manifest.receiver?.grid);
  const fluid = manifest.receiver?.fluid;
  const front = manifest.receiver?.front;
  const fluidChannels = [
    'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
    'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
  ];
  const validateArtifact = (artifact, label, shape, channelOrder) => {
    if (!artifact || JSON.stringify(artifact.shape) !== JSON.stringify(shape)) throw new Error(`${label} shape mismatch`);
    if (JSON.stringify(artifact.channelOrder) !== JSON.stringify(channelOrder)) throw new Error(`${label} channel order mismatch`);
    const path = resolve(String(artifact.path || ''));
    if (statSync(path).size !== Number(artifact.byteLength)) throw new Error(`${label} byte length mismatch`);
    const actualSha256 = sha256File(path);
    if (actualSha256 !== artifact.sha256) throw new Error(`${label} SHA-256 mismatch: ${actualSha256} != ${artifact.sha256}`);
    return { ...artifact, path, actualSha256 };
  };
  if (!Number.isInteger(grid) || grid < 1) throw new Error('initial receiver grid is invalid');
  return {
    manifest,
    manifestPath: initialFieldManifestPath,
    manifestSha256: sha256(raw),
    grid,
    initializationAuthority: isVelocityOracle
      ? DIAGNOSTIC_VELOCITY_ORACLE_AUTHORITY
      : isFireFlowComposition
        ? FIRE_FLOW_COMPOSITION_AUTHORITY
      : isSelectiveComposition
        ? SELECTIVE_COMPOSITION_AUTHORITY
        : COARSE_RECEIVER_AUTHORITY,
    filterIdentity: isVelocityOracle
      ? DIAGNOSTIC_VELOCITY_ORACLE_APPLICATION
      : isFireFlowComposition
        ? FIRE_FLOW_COMPOSITION_APPLICATION
      : isSelectiveComposition
        ? SELECTIVE_COMPOSITION_APPLICATION
        : COARSE_RECEIVER_FILTER,
    layoutIdentity,
    source: manifest.source || null,
    receiverInitialSimStepCount: Number(manifest.receiver?.initialSimStepCount || 0),
    heldOnly: isSelectiveComposition || isFireFlowComposition,
    oracleOnly: isVelocityOracle,
    fluid: validateArtifact(fluid, 'initial fluid', [grid, grid, grid, 16], fluidChannels),
    front: validateArtifact(front, 'initial front', [grid, grid, grid, 1], ['frontTopology']),
  };
}

function resolveScalarActivityCueManifest() {
  if (!scalarActivityCueManifestPath) {
    if (scalarActivityCueRole) throw new Error('--scalar-activity-cue-role requires --scalar-activity-cue-manifest');
    return null;
  }
  if (!scalarActivityCueRole) throw new Error('--scalar-activity-cue-manifest requires --scalar-activity-cue-role');
  const raw = readFileSync(scalarActivityCueManifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const isSupportProbe = manifest.schema === SCALAR_ACTIVITY_CUE_SCHEMA;
  const isFrozenTransfer = manifest.schema === FROZEN_TRANSFER_CUE_SCHEMA;
  if ((!isSupportProbe && !isFrozenTransfer) || manifest.status !== 'captured' || manifest.failurePhase !== null) {
    throw new Error(`unsupported scalar activity cue manifest: ${manifest.schema || '(missing)'}/${manifest.status || '(missing)'}`);
  }
  if (isFrozenTransfer
    && (manifest.transfer?.distinctReplay !== true
      || manifest.transfer?.targetDataUsedForTraining !== false
      || manifest.transfer?.targetDataUsedForCalibration !== false
      || manifest.transfer?.targetLabelsUsedForModelSelection !== false)) {
    throw new Error('frozen scalar activity cue does not prove distinct replay and target-blind model selection');
  }
  const target = isFrozenTransfer
    ? manifest.derivedTarget?.contract
    : manifest.derivedTargets?.fireFlowVisibilityCarrier;
  if (target?.identity !== 'fire-flow-visibility-carrier-v0'
    || target.authority !== 'exact-high-field-renderer-coupled-derived-target-v0'
    || target.physicalTruth !== false) {
    throw new Error('scalar activity cue target identity or physical-truth contract mismatch');
  }
  const artifact = manifest.denseDerivedTargets?.fireFlowVisibilityCarrier?.[scalarActivityCueRole];
  if (!artifact) throw new Error(`scalar activity cue role is absent: ${scalarActivityCueRole}`);
  const shape = artifact.shape;
  const grid = Number(shape?.[0]);
  if (!Number.isInteger(grid) || JSON.stringify(shape) !== JSON.stringify([grid, grid, grid, 1])) {
    throw new Error(`scalar activity cue shape mismatch: ${JSON.stringify(shape)}`);
  }
  if (JSON.stringify(artifact.channelOrder) !== JSON.stringify(['fireFlowVisibilityCarrier'])) {
    throw new Error('scalar activity cue channel order mismatch');
  }
  if (!SCALAR_ACTIVITY_CUE_AUTHORITIES.has(artifact.authority)) {
    throw new Error(`unsupported scalar activity cue authority: ${artifact.authority || '(missing)'}`);
  }
  const path = resolve(String(artifact.path || ''));
  const expectedByteLength = grid * grid * grid * Float32Array.BYTES_PER_ELEMENT;
  if (Number(artifact.byteLength) !== expectedByteLength || statSync(path).size !== expectedByteLength) {
    throw new Error(`scalar activity cue byte length mismatch: ${artifact.byteLength}/${statSync(path).size}/${expectedByteLength}`);
  }
  const actualSha256 = sha256File(path);
  if (actualSha256 !== artifact.sha256) {
    throw new Error(`scalar activity cue SHA-256 mismatch: ${actualSha256} != ${artifact.sha256}`);
  }
  return {
    applicationIdentity: SCALAR_ACTIVITY_CUE_APPLICATION,
    manifestPath: scalarActivityCueManifestPath,
    manifestSha256: sha256(raw),
    role: scalarActivityCueRole,
    grid,
    path,
    sha256: artifact.sha256,
    actualSha256,
    byteLength: expectedByteLength,
    channelOrder: artifact.channelOrder,
    cueAuthority: artifact.authority,
  };
}

function resolveBoundarySplatDisplacementManifest() {
  if (!boundarySplatDisplacementManifestPath) return null;
  if (scalarActivityCueManifestPath || scalarActivityCueRole) {
    throw new Error('--boundary-splat-displacement-manifest cannot be combined with scalar activity cue arguments');
  }
  const raw = readFileSync(boundarySplatDisplacementManifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.schema !== BOUNDARY_SPLAT_DISPLACEMENT_SCHEMA
    || manifest.status !== 'captured'
    || manifest.failurePhase !== null) {
    throw new Error(`unsupported boundary splat displacement manifest: ${manifest.schema || '(missing)'}/${manifest.status || '(missing)'}`);
  }
  if (manifest.checkpoint?.replay?.status !== 'verified'
    || manifest.checkpoint?.replay?.classParity !== true
    || manifest.checkpoint?.replay?.globalGateDuplicateDestinationCount !== 0) {
    throw new Error('boundary splat displacement checkpoint replay contract mismatch');
  }
  const artifact = manifest.denseOutputs?.boundarySplatOffsetClass;
  const shape = artifact?.shape;
  const grid = Number(shape?.[0]);
  if (!Number.isInteger(grid) || JSON.stringify(shape) !== JSON.stringify([grid, grid, grid, 1])) {
    throw new Error(`boundary splat displacement shape mismatch: ${JSON.stringify(shape)}`);
  }
  if (JSON.stringify(artifact.channelOrder) !== JSON.stringify(['boundarySplatOffsetClassNormalized'])) {
    throw new Error('boundary splat displacement channel order mismatch');
  }
  if (artifact.authority !== BOUNDARY_SPLAT_DISPLACEMENT_AUTHORITY) {
    throw new Error(`unsupported boundary splat displacement authority: ${artifact.authority || '(missing)'}`);
  }
  const path = resolve(String(artifact.path || ''));
  const expectedByteLength = grid * grid * grid * Float32Array.BYTES_PER_ELEMENT;
  if (Number(artifact.byteLength) !== expectedByteLength || statSync(path).size !== expectedByteLength) {
    throw new Error(`boundary splat displacement byte length mismatch: ${artifact.byteLength}/${statSync(path).size}/${expectedByteLength}`);
  }
  const actualSha256 = sha256File(path);
  if (actualSha256 !== artifact.sha256 || manifest.checkpoint.replay.outputSha256 !== artifact.sha256) {
    throw new Error(`boundary splat displacement SHA-256 mismatch: ${actualSha256}/${artifact.sha256}/${manifest.checkpoint.replay.outputSha256}`);
  }
  return {
    applicationIdentity: BOUNDARY_SPLAT_DISPLACEMENT_APPLICATION,
    manifestPath: boundarySplatDisplacementManifestPath,
    manifestSha256: sha256(raw),
    role: 'globalVacancyGatedOffsetClass',
    grid,
    path,
    sha256: artifact.sha256,
    actualSha256,
    byteLength: expectedByteLength,
    channelOrder: artifact.channelOrder,
    cueAuthority: artifact.authority,
  };
}

function resolveSourceCapture() {
  if (!sourceCapturePath) {
    if (targetOrigin) throw new Error('--target-origin requires --source-capture');
    return { url: requestedUrl, sourceCapture: null };
  }
  if (args.has('--url')) throw new Error('--source-capture and --url are mutually exclusive');
  const raw = readFileSync(sourceCapturePath, 'utf8');
  const capture = JSON.parse(raw);
  if (capture.schema !== 'kaminos.operator-exact-live-splat-basin-capture.v1') {
    throw new Error(`unsupported source capture schema: ${capture.schema || '(missing)'}`);
  }
  if (typeof capture.replayRoute !== 'string' || !capture.replayRoute) {
    throw new Error('source capture omitted replayRoute');
  }
  if (typeof capture.payloadSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(capture.payloadSha256)) {
    throw new Error('source capture omitted a valid payloadSha256');
  }
  const { payloadSha256, hashAuthority, ...payload } = capture;
  const actualPayloadSha256 = sha256(JSON.stringify(payload, null, 2));
  if (actualPayloadSha256 !== payloadSha256) {
    throw new Error(`source capture payload SHA-256 mismatch: ${actualPayloadSha256} != ${payloadSha256}`);
  }
  const route = new URL(capture.replayRoute);
  let rebind = null;
  if (targetOrigin) {
    const target = new URL(targetOrigin);
    if (target.pathname !== '/' || target.search || target.hash) {
      throw new Error('--target-origin must contain only scheme, host, and optional port');
    }
    const sourceOrigin = route.origin;
    route.protocol = target.protocol;
    route.host = target.host;
    rebind = {
      identity: 'origin-only-replay-route-rebind-v0',
      sourceOrigin,
      targetOrigin: target.origin,
      queryPreserved: true,
    };
  }
  return {
    url: route.href,
    sourceCapture: {
      path: sourceCapturePath,
      schema: capture.schema,
      identity: capture.identity || null,
      savedAt: capture.savedAt || null,
      payloadSha256,
      actualPayloadSha256,
      hashAuthority: hashAuthority || null,
      hashMatches: true,
      controlCount: Number(capture.controlCount || Object.keys(capture.controls || {}).length),
      sourceReplayRoute: capture.replayRoute,
      effectiveReplayRoute: route.href,
      routeRebind: rebind,
    },
  };
}

async function cdpFetch(path, options) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function cdpAvailable() {
  try {
    await cdpFetch('/json/version');
    return true;
  } catch {
    return false;
  }
}

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function attachOrLaunchBrowser(url) {
  if (reuseBrowser && await cdpAvailable()) {
    return {
      identity: 'attach-or-launch-shared-cdp-browser-v0',
      mode: 'attached-existing',
      port,
      userDataDir,
      keepBrowserOpen,
      process: null,
    };
  }
  const process = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });
  return {
    identity: reuseBrowser ? 'attach-or-launch-shared-cdp-browser-v0' : 'per-capture-chrome-process-v0',
    mode: reuseBrowser ? 'launched-shared' : 'launched-per-capture',
    port,
    userDataDir,
    keepBrowserOpen,
    process,
  };
}

function browserReceipt(browserSession) {
  if (!browserSession) return null;
  return {
    identity: browserSession.identity,
    mode: browserSession.mode,
    port: browserSession.port,
    userDataDir: browserSession.userDataDir,
    keepBrowserOpen: browserSession.keepBrowserOpen,
    pid: browserSession.process?.pid || null,
  };
}

function closeBrowserSession(browserSession) {
  if (browserSession?.keepBrowserOpen) return;
  browserSession?.process?.kill('SIGTERM');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluateByValue(ws, expression, phase) {
  const evaluated = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) throw new Error(`${phase}: ${JSON.stringify(evaluated.exceptionDetails)}`);
  if (evaluated.result?.subtype === 'error') throw new Error(`${phase}: ${JSON.stringify(evaluated.result)}`);
  return evaluated.result.value;
}

async function drainSidecar(ws, session, kind, outputPath, descriptorOverride = null) {
  const descriptor = descriptorOverride || session[kind];
  const expectedFloats = Number(descriptor?.floatCount);
  const expectedBytes = Number(descriptor?.byteLength);
  if (!Number.isFinite(expectedFloats) || expectedFloats < 1 || !Number.isFinite(expectedBytes)) {
    throw new Error(`invalid ${kind} descriptor: ${JSON.stringify(descriptor)}`);
  }
  writeFileSync(outputPath, Buffer.alloc(0));
  const hash = createHash('sha256');
  let startFloat = 0;
  let chunkCount = 0;
  while (startFloat < expectedFloats) {
    const floatCount = Math.min(chunkFloats, expectedFloats - startFloat);
    const chunk = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.readDebugFullFieldExportChunk(${JSON.stringify({
        sessionId: session.sessionId,
        kind,
        startFloat,
        floatCount,
      })})`,
      `chunk-${kind}`,
    );
    if (chunk?.ok !== true || chunk.kind !== kind || Number(chunk.startFloat) !== startFloat) {
      throw new Error(`bad ${kind} chunk at ${startFloat}: ${JSON.stringify(chunk)}`);
    }
    const buffer = Buffer.from(chunk.base64 || '', 'base64');
    if (buffer.byteLength !== Number(chunk.byteLength)) {
      throw new Error(`bad ${kind} chunk byte length at ${startFloat}: ${buffer.byteLength}/${chunk.byteLength}`);
    }
    appendFileSync(outputPath, buffer);
    hash.update(buffer);
    startFloat += Number(chunk.floatCount);
    chunkCount += 1;
  }
  const actualBytes = statSync(outputPath).size;
  if (actualBytes !== expectedBytes) throw new Error(`${kind} sidecar byte mismatch: ${actualBytes}/${expectedBytes}`);
  return {
    ...descriptor,
    path: outputPath,
    sha256: hash.digest('hex'),
    chunkCount,
    chunkFloats,
  };
}

async function uploadInitialArtifact(ws, sessionId, kind, artifact) {
  const bytes = readFileSync(artifact.path);
  const chunkBytes = chunkFloats * Float32Array.BYTES_PER_ELEMENT;
  let byteOffset = 0;
  let chunkCount = 0;
  while (byteOffset < bytes.byteLength) {
    const chunk = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + chunkBytes));
    const receipt = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.writeDebugFullFieldImportChunk(${JSON.stringify({
        sessionId,
        kind,
        byteOffset,
        base64: chunk.toString('base64'),
      })})`,
      `initial-field-${kind}-chunk`,
    );
    if (receipt?.ok !== true || receipt.kind !== kind || Number(receipt.byteOffset) !== byteOffset) {
      throw new Error(`bad initial ${kind} chunk at ${byteOffset}: ${JSON.stringify(receipt)}`);
    }
    byteOffset += chunk.byteLength;
    chunkCount += 1;
  }
  return { kind, byteLength: bytes.byteLength, sha256: artifact.sha256, chunkCount, chunkFloats };
}

async function uploadScalarActivityCue(ws, cue) {
  const begin = await evaluateByValue(
    ws,
    `window.__kaminosVolumePrototype.beginDebugScalarActivityCueImport(${JSON.stringify({
      grid: cue.grid,
      byteLength: cue.byteLength,
      sha256: cue.sha256,
      channelOrder: cue.channelOrder,
      cueAuthority: cue.cueAuthority,
      applicationIdentity: cue.applicationIdentity,
      sourceManifestPath: cue.manifestPath,
      sourceManifestSha256: cue.manifestSha256,
      sourceRole: cue.role,
    })})`,
    'begin-scalar-activity-cue-import',
  );
  if (begin?.ok !== true) throw new Error(`scalar activity cue import did not begin cleanly: ${JSON.stringify(begin)}`);
  const bytes = readFileSync(cue.path);
  const chunkBytes = chunkFloats * Float32Array.BYTES_PER_ELEMENT;
  let byteOffset = 0;
  let chunkCount = 0;
  while (byteOffset < bytes.byteLength) {
    const chunk = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + chunkBytes));
    const receipt = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.writeDebugScalarActivityCueImportChunk(${JSON.stringify({
        sessionId: begin.sessionId,
        byteOffset,
        base64: chunk.toString('base64'),
      })})`,
      'scalar-activity-cue-chunk',
    );
    if (receipt?.ok !== true || Number(receipt.byteOffset) !== byteOffset) {
      throw new Error(`bad scalar activity cue chunk at ${byteOffset}: ${JSON.stringify(receipt)}`);
    }
    byteOffset += chunk.byteLength;
    chunkCount += 1;
  }
  const finish = await evaluateByValue(
    ws,
    `window.__kaminosVolumePrototype.finishDebugScalarActivityCueImport(${JSON.stringify({ sessionId: begin.sessionId })})`,
    'finish-scalar-activity-cue-import',
  );
  if (finish?.ok !== true || finish.status !== 'applied') {
    throw new Error(`scalar activity cue import did not apply cleanly: ${JSON.stringify(finish)}`);
  }
  if (finish.cueAuthority !== cue.cueAuthority || finish.sha256 !== cue.sha256 || finish.sourceRole !== cue.role) {
    throw new Error(`scalar activity cue effective identity mismatch: ${JSON.stringify(finish)}`);
  }
  return {
    requested: cue,
    upload: { byteLength: bytes.byteLength, chunkCount, chunkFloats },
    effective: finish,
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  let phase = 'source-capture-validation';
  let url = requestedUrl;
  let sourceCapture = null;
  let initialField = null;
  let initialFieldImport = null;
  let importedAdvance = null;
  let importedRender = null;
  let scalarActivityCue = null;
  let scalarActivityCueImport = null;
  let boundarySplatDisplacement = null;
  const renderWarmups = [];
  let renderControlOverrides = {};
  let browserSession = null;
  let ws = null;
  let begin = null;
  let lastDebugState = null;
  let pageDiagnostics = null;
  const runtimeEvents = [];
  try {
    phase = 'render-option-validation';
    if (!['splat-only-v0', 'raymarch-under-splats-v0', 'raymarch-only-v0'].includes(renderComposition)) {
      throw new Error(`unsupported --render-composition: ${renderComposition}`);
    }
    renderControlOverrides = args.has('--render-control-overrides-json')
      ? JSON.parse(String(args.get('--render-control-overrides-json')))
      : {};
    if (!renderControlOverrides || typeof renderControlOverrides !== 'object' || Array.isArray(renderControlOverrides)) {
      throw new Error('--render-control-overrides-json must decode to an object');
    }
    phase = 'source-capture-validation';
    initialField = resolveInitialFieldManifest();
    boundarySplatDisplacement = resolveBoundarySplatDisplacementManifest();
    scalarActivityCue = boundarySplatDisplacement || resolveScalarActivityCueManifest();
    if (initialField && !args.has('--advance-imported-steps')) {
      throw new Error('--initial-field-manifest requires explicit --advance-imported-steps, including 0 for a held control');
    }
    if (initialField?.heldOnly && advanceImportedSteps > 0) {
      throw new Error('selective-composition-held-only: --advance-imported-steps must be 0');
    }
    if (initialField?.oracleOnly && !renderOnly) {
      throw new Error('diagnostic-velocity-oracle-render-only: --render-only is required');
    }
    if (renderPngPath && !initialField) throw new Error('--render-png requires --initial-field-manifest');
    if (renderOnly && (!initialField || !renderPngPath)) {
      throw new Error('--render-only requires --initial-field-manifest and --render-png');
    }
    if (boundarySplatDisplacement) {
      if (!renderOnly || !initialField || advanceImportedSteps !== 0) {
        throw new Error('boundary splat displacement assay requires --render-only, --initial-field-manifest, and --advance-imported-steps 0');
      }
      if (renderComposition === 'raymarch-only-v0') {
        throw new Error('boundary splat displacement assay requires a splat render composition');
      }
      renderControlOverrides = {
        ...renderControlOverrides,
        oracleActivityCue: 0,
        oracleActivityDisplay: 0,
        oracleActivityCurlNoise: 0,
        oracleActivityVorticity: 0,
        oracleActivityMaterial: 0,
        oracleActivityFireDetail: 0,
        oracleActivitySplatOpacity: 0,
        oracleActivitySplatRadiusConcentration: 0,
        oracleActivitySplatDisplacement: 1,
      };
    } else if (scalarActivityCue) {
      if (!renderOnly || !initialField || advanceImportedSteps !== 0) {
        throw new Error('scalar activity cue assay requires --render-only, --initial-field-manifest, and --advance-imported-steps 0');
      }
      for (const key of ['oracleActivityCue', 'oracleActivityCurlNoise', 'oracleActivityVorticity', 'oracleActivityMaterial']) {
        if (Number(renderControlOverrides[key] || 0) !== 0) {
          throw new Error(`scalar activity cue display forbids force/material injection: ${key}`);
        }
      }
      const oracleActivityDisplay = Object.hasOwn(renderControlOverrides, 'oracleActivityDisplay')
        ? renderControlOverrides.oracleActivityDisplay
        : 1;
      const oracleActivityFireDetail = Object.hasOwn(renderControlOverrides, 'oracleActivityFireDetail')
        ? Number(renderControlOverrides.oracleActivityFireDetail)
        : 0;
      const oracleActivitySplatOpacity = Object.hasOwn(renderControlOverrides, 'oracleActivitySplatOpacity')
        ? Number(renderControlOverrides.oracleActivitySplatOpacity)
        : 0;
      const oracleActivitySplatRadiusConcentration = Object.hasOwn(renderControlOverrides, 'oracleActivitySplatRadiusConcentration')
        ? Number(renderControlOverrides.oracleActivitySplatRadiusConcentration)
        : 0;
      if (!Number.isFinite(oracleActivityFireDetail) || oracleActivityFireDetail < -2 || oracleActivityFireDetail > 2) {
        throw new Error(`scalar activity cue fire-detail gain is outside [-2, 2]: ${renderControlOverrides.oracleActivityFireDetail}`);
      }
      if (!Number.isFinite(oracleActivitySplatOpacity) || oracleActivitySplatOpacity < -2 || oracleActivitySplatOpacity > 2) {
        throw new Error(`scalar activity cue splat-opacity gain is outside [-2, 2]: ${renderControlOverrides.oracleActivitySplatOpacity}`);
      }
      if (!Number.isFinite(oracleActivitySplatRadiusConcentration) || oracleActivitySplatRadiusConcentration < -2 || oracleActivitySplatRadiusConcentration > 2) {
        throw new Error(`scalar activity cue splat-radius concentration is outside [-2, 2]: ${renderControlOverrides.oracleActivitySplatRadiusConcentration}`);
      }
      if (oracleActivitySplatOpacity !== 0 && renderComposition === 'raymarch-only-v0') {
        throw new Error('scalar activity cue splat-opacity assay requires a splat render composition');
      }
      if (oracleActivitySplatRadiusConcentration !== 0 && renderComposition === 'raymarch-only-v0') {
        throw new Error('scalar activity cue splat-radius concentration assay requires a splat render composition');
      }
      renderControlOverrides = {
        ...renderControlOverrides,
        oracleActivityCue: 0,
        oracleActivityDisplay,
        oracleActivityCurlNoise: 0,
        oracleActivityVorticity: 0,
        oracleActivityMaterial: 0,
        oracleActivityFireDetail,
        oracleActivitySplatOpacity,
        oracleActivitySplatRadiusConcentration,
      };
    }
    const resolved = resolveSourceCapture();
    url = resolved.url;
    sourceCapture = resolved.sourceCapture;
    if (initialField) {
      const receiverRoute = new URL(url);
      receiverRoute.searchParams.set('volume_resolution', String(initialField.grid));
      receiverRoute.searchParams.set('volume_look_freeze', '0');
      url = receiverRoute.href;
    }

    phase = 'launch';
    browserSession = await attachOrLaunchBrowser(url);
    await waitForCdp();
    phase = 'target';
    const targets = await cdpFetch('/json/list');
    const page = targets.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1'))
      || targets.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    ws.addEventListener('message', event => {
      try {
        const message = JSON.parse(String(event.data));
        if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) {
          runtimeEvents.push({ method: message.method, params: message.params });
        }
      } catch {}
    });
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Log.enable');
    await wsRequest(ws, 'Page.enable');

    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await delay(settleMs);

    phase = 'identity';
    for (let i = 0; i < 80; i += 1) {
      lastDebugState = await evaluateByValue(ws, 'window.__kaminosVolumePrototype?.debugState?.()', 'debug-state');
      if (lastDebugState?.active === true && lastDebugState?.frameCount > 3) break;
      await delay(250);
    }
    pageDiagnostics = await evaluateByValue(ws, `({
      readyState: document.readyState,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 4000) || '',
      moduleScripts: Array.from(document.querySelectorAll('script[type="module"]')).map(script => script.src || script.textContent?.slice(0, 120)),
      hasNavigatorGpu: Boolean(navigator.gpu),
      hasVolumePrototype: Boolean(window.__kaminosVolumePrototype),
    })`, 'page-diagnostics');
    if (lastDebugState?.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') {
      throw new Error(`wrong effective route: ${lastDebugState?.effectiveRoute || '(missing)'}`);
    }
    if (lastDebugState?.prototypeIdentity !== 'kaminos-volume-prototype-v0') {
      throw new Error(`wrong prototype identity: ${lastDebugState?.prototypeIdentity || '(missing)'}`);
    }

    if (initialField) {
      phase = 'begin-initial-field-import';
      const importBegin = await evaluateByValue(
        ws,
        `window.__kaminosVolumePrototype.beginDebugFullFieldImport(${JSON.stringify({
          grid: initialField.grid,
          initializationAuthority: initialField.initializationAuthority,
          filterIdentity: initialField.filterIdentity,
          layoutIdentity: initialField.layoutIdentity,
          sourceManifestPath: initialField.manifestPath,
          sourceManifestSha256: initialField.manifestSha256,
          source: initialField.source,
          receiverInitialSimStepCount: initialField.receiverInitialSimStepCount,
          fluid: initialField.fluid,
          front: initialField.front,
        })})`,
        phase,
      );
      if (importBegin?.ok !== true) throw new Error(`initial field import did not begin cleanly: ${JSON.stringify(importBegin)}`);
      phase = 'upload-initial-fluid';
      const fluidUpload = await uploadInitialArtifact(ws, importBegin.sessionId, 'fluid', initialField.fluid);
      phase = 'upload-initial-front';
      const frontUpload = await uploadInitialArtifact(ws, importBegin.sessionId, 'front', initialField.front);
      phase = 'finish-initial-field-import';
      const importFinish = await evaluateByValue(
        ws,
        `window.__kaminosVolumePrototype.finishDebugFullFieldImport(${JSON.stringify({ sessionId: importBegin.sessionId })})`,
        phase,
      );
      if (importFinish?.ok !== true || importFinish.status !== 'applied') {
        throw new Error(`initial field import did not apply cleanly: ${JSON.stringify(importFinish)}`);
      }
      initialFieldImport = {
        requested: {
          manifestPath: initialField.manifestPath,
          manifestSha256: initialField.manifestSha256,
          grid: initialField.grid,
          advanceImportedSteps,
        },
        uploads: { fluid: fluidUpload, front: frontUpload },
        effective: importFinish,
      };
      phase = 'advance-imported-field';
      importedAdvance = await evaluateByValue(
        ws,
        `window.__kaminosVolumePrototype.advanceDebugImportedFieldSteps(${JSON.stringify({
          sessionId: importFinish.sessionId,
          steps: advanceImportedSteps,
          timeStepMs: deterministicReplayTimeStepMs,
          startTimeMs: deterministicReplayStartTimeMs,
        })})`,
        phase,
      );
      if (importedAdvance?.ok !== true || importedAdvance.completedSteps !== advanceImportedSteps) {
        throw new Error(`imported receiver advance failed: ${JSON.stringify(importedAdvance)}`);
      }
      if (scalarActivityCue) {
        phase = 'scalar-activity-cue-import';
        scalarActivityCueImport = await uploadScalarActivityCue(ws, scalarActivityCue);
      }
      if (renderPngPath) {
        phase = 'mount-imported-render-canvas';
        const canvasMount = await evaluateByValue(ws, `(() => {
          const canvas = window.__kaminosVolumePrototype?.canvasElement?.();
          if (!canvas) return { ok: false, reason: 'renderer-canvas-missing' };
          const height = Math.max(64, Math.min(700, window.innerHeight));
          const width = Math.max(64, Math.min(window.innerWidth, height * canvas.width / Math.max(1, canvas.height)));
          document.body.appendChild(canvas);
          canvas.style.setProperty('position', 'fixed', 'important');
          canvas.style.setProperty('left', '0px', 'important');
          canvas.style.setProperty('top', '0px', 'important');
          canvas.style.setProperty('width', width + 'px', 'important');
          canvas.style.setProperty('height', height + 'px', 'important');
          canvas.style.setProperty('display', 'block', 'important');
          canvas.style.setProperty('visibility', 'visible', 'important');
          canvas.style.setProperty('opacity', '1', 'important');
          canvas.style.setProperty('transform', 'none', 'important');
          canvas.style.setProperty('z-index', '2147483647', 'important');
          canvas.style.setProperty('pointer-events', 'none', 'important');
          const rect = canvas.getBoundingClientRect();
          return {
            ok: true,
            identity: 'witness-mounted-imported-canvas-v0',
            connected: canvas.isConnected,
            intrinsicWidth: canvas.width,
            intrinsicHeight: canvas.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          };
        })()`, phase);
        const mountedRect = canvasMount?.rect;
        if (canvasMount?.ok !== true
          || !canvasMount.connected
          || !mountedRect
          || mountedRect.x < 0
          || mountedRect.y < 0
          || mountedRect.width < 64
          || mountedRect.height < 64
          || mountedRect.x + mountedRect.width > canvasMount.viewportWidth + 0.5
          || mountedRect.y + mountedRect.height > canvasMount.viewportHeight + 0.5) {
          throw new Error(`canvas-clip-offscreen: ${JSON.stringify(canvasMount)}`);
        }
        for (let warmupIndex = 0; warmupIndex < renderWarmupCount; warmupIndex += 1) {
          phase = `render-imported-field-warmup-${warmupIndex + 1}`;
          const warmupReceipt = await evaluateByValue(
            ws,
            `window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
              fullFieldImportSessionId: importFinish.sessionId,
              renderScale: 1,
              now: deterministicReplayStartTimeMs + advanceImportedSteps * deterministicReplayTimeStepMs,
              sameStateCaptureId: `imported-receiver-render-capacity-warmup-${warmupIndex + 1}`,
            })})`,
            phase,
          );
          if (warmupReceipt?.ok !== true || warmupReceipt?.imageAuthority !== 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state') {
            throw new Error(`imported receiver warmup render failed: ${JSON.stringify(warmupReceipt)}`);
          }
          renderWarmups.push({
            identity: 'frozen-same-state-capacity-settle-v0',
            index: warmupIndex + 1,
            sameStateCaptureId: warmupReceipt.sameStateCaptureId,
            baseFrameCount: warmupReceipt.baseFrameCount,
            baseSimStepCount: warmupReceipt.baseSimStepCount,
            frameCount: warmupReceipt.frameCount,
            simStepCount: warmupReceipt.simStepCount,
            boundarySplatInstanceCount: warmupReceipt.boundarySplatInstanceCount,
            boundarySplatCandidateCount: warmupReceipt.boundarySplatCandidateCount,
            boundarySplatOverflowCount: warmupReceipt.boundarySplatOverflowCount,
          });
          await delay(100);
        }
        phase = 'render-imported-field';
        const renderReceipt = await evaluateByValue(
          ws,
          `window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
            fullFieldImportSessionId: importFinish.sessionId,
            renderScale: 1,
            boundarySplatComposition: renderComposition,
            controlOverrides: renderControlOverrides,
            now: deterministicReplayStartTimeMs + advanceImportedSteps * deterministicReplayTimeStepMs,
            sameStateCaptureId: `imported-receiver-render-step-${advanceImportedSteps}`,
          })})`,
          phase,
        );
        if (renderReceipt?.ok !== true || renderReceipt?.imageAuthority !== 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state') {
          throw new Error(`imported receiver render failed: ${JSON.stringify(renderReceipt)}`);
        }
        if (renderCompositionExplicit && renderReceipt.boundarySplatCompositionEffective !== renderComposition) {
          throw new Error(`requested render composition was not effective: ${renderComposition} != ${renderReceipt.boundarySplatCompositionEffective || '(missing)'}`);
        }
        if (
          renderReceipt.boundarySplatCompositionEffective !== 'raymarch-only-v0'
          && (
            renderReceipt.boundarySplatEvidenceComplete !== true
            || renderReceipt.boundarySplatOverflowCount !== 0
          )
        ) {
          throw new Error(`boundary-splat-evidence-incomplete: ${JSON.stringify({
            boundarySplatEvidenceComplete: renderReceipt.boundarySplatEvidenceComplete,
            boundarySplatCapacityPassCount: renderReceipt.boundarySplatCapacityPassCount,
            boundarySplatCapacity: renderReceipt.boundarySplatCapacity,
            boundarySplatCandidateCount: renderReceipt.boundarySplatCandidateCount,
            boundarySplatOverflowCount: renderReceipt.boundarySplatOverflowCount,
          })}`);
        }
        if (scalarActivityCue) {
          const requestedFireDetail = Number(renderControlOverrides.oracleActivityFireDetail || 0);
          if (
            renderReceipt.oracleActivityFireDetailRequested !== requestedFireDetail
            || renderReceipt.oracleActivityFireDetailEffective !== requestedFireDetail
          ) {
            throw new Error(`scalar-activity-fire-detail-gain-mismatch: requested=${requestedFireDetail} receipt=${JSON.stringify({
              oracleActivityFireDetailRequested: renderReceipt.oracleActivityFireDetailRequested,
              oracleActivityFireDetailEffective: renderReceipt.oracleActivityFireDetailEffective,
            })}`);
          }
          const requestedSplatOpacity = Number(renderControlOverrides.oracleActivitySplatOpacity || 0);
          if (
            renderReceipt.oracleActivitySplatOpacityRequested !== requestedSplatOpacity
            || renderReceipt.oracleActivitySplatOpacityEffective !== requestedSplatOpacity
          ) {
            throw new Error(`scalar-activity-splat-opacity-gain-mismatch: requested=${requestedSplatOpacity} receipt=${JSON.stringify({
              oracleActivitySplatOpacityRequested: renderReceipt.oracleActivitySplatOpacityRequested,
              oracleActivitySplatOpacityEffective: renderReceipt.oracleActivitySplatOpacityEffective,
            })}`);
          }
          const requestedSplatRadiusConcentration = Number(renderControlOverrides.oracleActivitySplatRadiusConcentration || 0);
          if (
            renderReceipt.oracleActivitySplatRadiusConcentrationRequested !== requestedSplatRadiusConcentration
            || renderReceipt.oracleActivitySplatRadiusConcentrationEffective !== requestedSplatRadiusConcentration
          ) {
            throw new Error(`scalar-activity-splat-radius-concentration-gain-mismatch: requested=${requestedSplatRadiusConcentration} receipt=${JSON.stringify({
              oracleActivitySplatRadiusConcentrationRequested: renderReceipt.oracleActivitySplatRadiusConcentrationRequested,
              oracleActivitySplatRadiusConcentrationEffective: renderReceipt.oracleActivitySplatRadiusConcentrationEffective,
            })}`);
          }
          if (boundarySplatDisplacement) {
            const requestedDisplacement = Number(renderControlOverrides.oracleActivitySplatDisplacement || 0);
            if (
              renderReceipt.oracleActivitySplatDisplacementRequested !== requestedDisplacement
              || renderReceipt.oracleActivitySplatDisplacementEffective !== requestedDisplacement
              || renderReceipt.oracleActivitySplatDisplacementApplicationIdentity !== BOUNDARY_SPLAT_DISPLACEMENT_APPLICATION
            ) {
              throw new Error(`boundary-splat-displacement-gain-mismatch: requested=${requestedDisplacement} receipt=${JSON.stringify({
                oracleActivitySplatDisplacementRequested: renderReceipt.oracleActivitySplatDisplacementRequested,
                oracleActivitySplatDisplacementEffective: renderReceipt.oracleActivitySplatDisplacementEffective,
                oracleActivitySplatDisplacementApplicationIdentity: renderReceipt.oracleActivitySplatDisplacementApplicationIdentity,
              })}`);
            }
          }
        }
        phase = 'post-render-canvas-geometry';
        const postRenderCanvasMount = await evaluateByValue(ws, `(() => {
          const canvas = window.__kaminosVolumePrototype?.canvasElement?.();
          if (!canvas) return { ok: false, reason: 'renderer-canvas-missing' };
          const intrinsicAspect = canvas.width / Math.max(1, canvas.height);
          const maxHeight = Math.max(64, Math.min(700, window.innerHeight));
          const maxWidth = Math.max(64, window.innerWidth);
          const widthFromHeight = maxHeight * intrinsicAspect;
          const width = Math.min(maxWidth, widthFromHeight);
          const height = width / Math.max(0.0001, intrinsicAspect);
          canvas.style.setProperty('width', width + 'px', 'important');
          canvas.style.setProperty('height', height + 'px', 'important');
          const rect = canvas.getBoundingClientRect();
          return {
            ok: true,
            identity: 'post-render-canvas-geometry-v0',
            connected: canvas.isConnected,
            intrinsicWidth: canvas.width,
            intrinsicHeight: canvas.height,
            intrinsicAspect,
            cssAspect: rect.width / Math.max(1, rect.height),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          };
        })()`, phase);
        const aspectError = Math.abs(
          Number(postRenderCanvasMount?.cssAspect) - Number(postRenderCanvasMount?.intrinsicAspect),
        ) / Math.max(0.0001, Number(postRenderCanvasMount?.intrinsicAspect));
        if (postRenderCanvasMount?.ok !== true || !postRenderCanvasMount.connected || !Number.isFinite(aspectError) || aspectError > 0.002) {
          throw new Error(`post-render-canvas-geometry-mismatch: ${JSON.stringify(postRenderCanvasMount)}`);
        }
        renderReceipt.canvasCssRect = postRenderCanvasMount.rect;
        const rect = postRenderCanvasMount.rect;
        if (rect.x < 0 || rect.y < 0 || rect.width < 64 || rect.height < 64) {
          throw new Error(`canvas-clip-offscreen: ${JSON.stringify(rect)}`);
        }
        await delay(100);
        phase = 'capture-imported-render';
        const screenshot = await wsRequest(ws, 'Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
        });
        const png = Buffer.from(screenshot.data, 'base64');
        mkdirSync(dirname(renderPngPath), { recursive: true });
        writeFileSync(renderPngPath, png);
        importedRender = {
          ...renderReceipt,
          initialCanvasMount: canvasMount,
          canvasMount: postRenderCanvasMount,
          path: renderPngPath,
          byteLength: png.byteLength,
          sha256: sha256(png),
          importedFieldManifestPath: initialField.manifestPath,
          importedFieldManifestSha256: initialField.manifestSha256,
          importedAdvanceIdentity: importedAdvance.identity,
          importedAdvanceCompletedSteps: importedAdvance.completedSteps,
          scalarActivityCueImport,
        };
      }
    }

    if (renderOnly) {
      const manifest = {
        schema: 'kaminos.volume.held-field-render.v0',
        identity: 'held-imported-field-neural-splat-render-v0',
        status: 'captured',
        failurePhase: null,
        completeFieldCoverage: false,
        fieldExportSkipped: {
          identity: 'caller-requested-render-only-v0',
          skipped: true,
          reason: 'visual assay does not require duplicating the imported full-grid field',
        },
        url,
        sourceCapture,
        browserSession: browserReceipt(browserSession),
        lastDebugState,
        pageDiagnostics,
        runtimeEvents,
        initialFieldImport,
        importedAdvance,
        scalarActivityCueImport,
        renderWarmups,
        importedRender,
        routeIdentity: importedRender?.routeIdentity || initialFieldImport?.effective?.routeIdentity || null,
        effectiveRoute: importedRender?.effectiveRoute || initialFieldImport?.effective?.effectiveRoute || null,
        prototypeIdentity: initialFieldImport?.effective?.prototypeIdentity || null,
        backend: importedRender?.backend || initialFieldImport?.effective?.backend || null,
      };
      writeManifest(manifest);
      console.log(JSON.stringify({
        ok: true,
        manifest: manifestPath,
        render: importedRender,
        fieldExportSkipped: manifest.fieldExportSkipped,
      }, null, 2));
      return;
    }

    phase = 'begin-full-grid-export';
    begin = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.beginDebugFullFieldExport(${JSON.stringify({
        ...(deterministicReplayRequested ? {
          deterministicReplay: {
            steps: deterministicReplaySteps,
            timeStepMs: deterministicReplayTimeStepMs,
            startTimeMs: deterministicReplayStartTimeMs,
          },
        } : {}),
      })})`,
      phase,
    );
    if (begin?.ok !== true || begin.schema !== 'kaminos.volume.full-field-export.v0') {
      throw new Error(`full-grid export did not begin cleanly: ${JSON.stringify(begin)}`);
    }

    phase = 'drain-fluid';
    const fluid = await drainSidecar(ws, begin, 'fluid', join(outDir, 'fluid.f32'));
    phase = 'drain-front';
    const front = await drainSidecar(ws, begin, 'front', join(outDir, 'front.f32'));
    phase = 'drain-boundary-sidecar';
    const boundary = await drainSidecar(
      ws,
      begin,
      'boundary',
      join(outDir, 'boundary-sidecar.f32'),
      begin.boundarySidecar?.sidecars?.boundary,
    );
    const boundarySidecar = {
      ...begin.boundarySidecar,
      sidecars: { boundary },
    };
    phase = 'drain-boundary-splats';
    const boundarySplats = await drainSidecar(
      ws,
      begin,
      'boundarySplat',
      join(outDir, 'boundary-splats.f32'),
      begin.boundarySplats?.sidecars?.boundarySplats,
    );
    const boundarySplatOutput = {
      ...begin.boundarySplats,
      sidecars: { boundarySplats },
    };

    phase = 'release';
    const release = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.releaseDebugFullFieldExport(${JSON.stringify({ sessionId: begin.sessionId })})`,
      phase,
    );

    const manifest = {
      schema: MANIFEST_SCHEMA,
      identity: EXPORT_IDENTITY,
      status: 'captured',
      failurePhase: null,
      completeFieldCoverage: true,
      url,
      sourceCapture,
      browserSession: browserReceipt(browserSession),
      lastDebugState,
      pageDiagnostics,
      runtimeEvents,
      chunkFloats,
      sessionId: begin.sessionId,
      routeIdentity: begin.routeIdentity,
      effectiveRoute: begin.effectiveRoute,
      prototypeIdentity: begin.prototypeIdentity,
      backend: begin.backend,
      grid: begin.grid,
      cellCount: begin.cellCount,
      simGridLabel: begin.simGridLabel,
      deterministicReplay: begin.deterministicReplay,
      initialFieldImport,
      importedAdvance,
      scalarActivityCueImport,
      renderWarmups,
      importedRender,
      fluidComponents: begin.fluidComponents,
      fluidChannelOrder: begin.fluidChannelOrder,
      frontChannelOrder: begin.frontChannelOrder,
      sidecars: { fluid, front },
      boundarySidecar,
      boundarySplats: boundarySplatOutput,
      release,
    };
    writeManifest(manifest);
    console.log(JSON.stringify({
      ok: true,
      manifest: manifestPath,
      grid: begin.grid,
      sourceCaptureSha256: sourceCapture?.payloadSha256 || null,
      sidecars: {
        fluid: { path: fluid.path, sha256: fluid.sha256, byteLength: fluid.byteLength },
        front: { path: front.path, sha256: front.sha256, byteLength: front.byteLength },
        boundary: { path: boundary.path, sha256: boundary.sha256, byteLength: boundary.byteLength },
        boundarySplats: { path: boundarySplats.path, sha256: boundarySplats.sha256, byteLength: boundarySplats.byteLength },
      },
    }, null, 2));
  } catch (error) {
    writeManifest({
      schema: MANIFEST_SCHEMA,
      identity: EXPORT_IDENTITY,
      status: 'failed',
      failurePhase: phase,
      completeFieldCoverage: false,
      url,
      sourceCapture,
      requestedSourceCapture: sourceCapturePath,
      requestedInitialFieldManifest: initialFieldManifestPath,
      requestedScalarActivityCueManifest: scalarActivityCueManifestPath,
      requestedScalarActivityCueRole: scalarActivityCueRole,
      requestedBoundarySplatDisplacementManifest: boundarySplatDisplacementManifestPath,
      initialFieldImport,
      importedAdvance,
      scalarActivityCueImport,
      renderWarmups,
      importedRender,
      targetOrigin,
      browserSession: browserReceipt(browserSession),
      lastDebugState,
      pageDiagnostics,
      runtimeEvents,
      chunkFloats,
      begin,
      error: error?.message || String(error),
    });
    throw error;
  } finally {
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
    closeBrowserSession(browserSession);
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

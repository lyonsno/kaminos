#!/usr/bin/env node
import { createHash, randomInt } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const MANIFEST_SCHEMA = 'kaminos.volume.full-grid-field-export.v0';
const EXPORT_IDENTITY = 'full-grid-fluid-front-boundary-sidecars-v0';
const FLUID_FRONT_EXPORT_IDENTITY = 'full-grid-fluid-front-only-v0';
const FULL_EXPORT_SCOPE = 'full-field-with-boundary-v0';
const FLUID_FRONT_EXPORT_SCOPE = 'fluid-front-only-v0';
const COARSE_RECEIVER_SCHEMA = 'kaminos.volume.coarse-receiver-initial.v0';
const COARSE_RECEIVER_AUTHORITY = 'receiver-initialized-from-filtered-high-t-v0';
const COARSE_RECEIVER_FILTER = 'volume-overlap-box-filter-high-to-receiver-v0';
const SELECTIVE_COMPOSITION_SCHEMA = 'kaminos.volume.exact-basin-selective-composition.v0';
const SELECTIVE_COMPOSITION_AUTHORITY = 'learned-selective-head-composition-not-filtered-high-truth-v0';
const SELECTIVE_COMPOSITION_APPLICATION = 'learned-selective-head-application-v0';
const PHASE_ALIGNED_HELD_SCHEMA = 'kaminos.volume.phase-aligned-held-field.v0';
const PHASE_ALIGNED_HELD_APPLICATION = 'phase-aligned-held-render-application-v0';
const PHASE_ALIGNED_HELD_ROLES = {
  truthHigh: { authority: 'offline-high-truth-held-render-only-v0', runtimeTruthAvailable: true },
  lowPhaseAligned: { authority: 'downsampled-same-high-history-held-control-v0', runtimeTruthAvailable: false },
};
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
const renderPngPath = args.has('--render-png') ? resolve(String(args.get('--render-png'))) : null;
const secondaryRenderPngPath = args.has('--secondary-render-png') ? resolve(String(args.get('--secondary-render-png'))) : null;
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
const viewportSize = args.has('--viewport-size')
  ? parseDimensions(String(args.get('--viewport-size')), '--viewport-size')
  : null;
const viewportDeviceScaleFactor = Number(args.get('--viewport-device-scale-factor') || 2);
const renderCanvasSize = args.has('--render-canvas-size')
  ? parseDimensions(String(args.get('--render-canvas-size')), '--render-canvas-size')
  : null;
const chunkFloats = Math.max(1, Math.floor(Number(args.get('--chunk-floats') || 262144)));
const exportScope = String(args.get('--export-scope') || FULL_EXPORT_SCOPE);
const exportIdentity = exportScope === FLUID_FRONT_EXPORT_SCOPE ? FLUID_FRONT_EXPORT_IDENTITY : EXPORT_IDENTITY;
const deterministicReplaySteps = Number(args.get('--deterministic-replay-steps') || 0);
const deterministicReplayRequested = Number.isFinite(deterministicReplaySteps) && deterministicReplaySteps > 0;
const deterministicReplayTimeStepMs = Number(args.get('--deterministic-replay-time-step-ms') || (1000 / 60));
const deterministicReplayStartTimeMs = Number(args.get('--deterministic-replay-start-ms') || 1000);
const advanceImportedSteps = Math.max(0, Math.floor(Number(args.get('--advance-imported-steps') || 0)));

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function parseDimensions(value, label) {
  const match = /^(\d+),(\d+)$/.exec(value);
  if (!match) throw new Error(`${label} must be WIDTH,HEIGHT`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64) {
    throw new Error(`${label} dimensions must be integers >= 64`);
  }
  return { width, height };
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
  const isPhaseAlignedHeld = manifest.schema === PHASE_ALIGNED_HELD_SCHEMA;
  if (!isCoarseReceiver && !isSelectiveComposition && !isPhaseAlignedHeld) {
    throw new Error(`unsupported initial field manifest: ${manifest.schema || '(missing)'}/${manifest.status || '(missing)'}`);
  }
  if (isCoarseReceiver && manifest.initializationAuthority !== COARSE_RECEIVER_AUTHORITY) {
    throw new Error(`unsupported initialization authority: ${manifest.initializationAuthority || '(missing)'}`);
  }
  if (isCoarseReceiver && manifest.filterIdentity !== COARSE_RECEIVER_FILTER) {
    throw new Error(`unsupported receiver filter: ${manifest.filterIdentity || '(missing)'}`);
  }
  if (isSelectiveComposition) {
    if (manifest.compositionAuthority !== SELECTIVE_COMPOSITION_AUTHORITY || manifest.runtimeTruthAvailable !== false) {
      throw new Error('selective composition authority or runtime truth contract mismatch');
    }
    if (manifest.consumptionContract?.requiresExplicitSchemaAdmission !== true
      || !String(manifest.consumptionContract?.mustNotBeAcceptedAs || '').includes('coarse-receiver-initial')) {
      throw new Error('selective composition mustNotBeAcceptedAs filtered-high receiver state');
    }
  }
  const heldRole = isPhaseAlignedHeld ? PHASE_ALIGNED_HELD_ROLES[manifest.role] : null;
  if (isPhaseAlignedHeld && (
    !heldRole
    || manifest.initializationAuthority !== heldRole.authority
    || manifest.runtimeTruthAvailable !== heldRole.runtimeTruthAvailable
    || manifest.renderOnly !== true
  )) {
    throw new Error(`phase-aligned held role authority mismatch: ${manifest.role || '(missing)'}`);
  }
  const layoutIdentity = isCoarseReceiver || isPhaseAlignedHeld ? manifest.layoutIdentity : FIELD_LAYOUT_IDENTITY;
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
    initializationAuthority: isSelectiveComposition
      ? SELECTIVE_COMPOSITION_AUTHORITY
      : isPhaseAlignedHeld
        ? heldRole.authority
        : COARSE_RECEIVER_AUTHORITY,
    filterIdentity: isSelectiveComposition || isPhaseAlignedHeld
      ? isPhaseAlignedHeld ? PHASE_ALIGNED_HELD_APPLICATION : SELECTIVE_COMPOSITION_APPLICATION
      : COARSE_RECEIVER_FILTER,
    layoutIdentity,
    source: manifest.source || null,
    receiverInitialSimStepCount: Number(manifest.receiver?.initialSimStepCount || 0),
    heldOnly: isSelectiveComposition || isPhaseAlignedHeld,
    fluid: validateArtifact(fluid, 'initial fluid', [grid, grid, grid, 16], fluidChannels),
    front: validateArtifact(front, 'initial front', [grid, grid, grid, 1], ['frontTopology']),
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
  if (keepBrowserOpen) process.unref();
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
    const cleanup = () => {
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      cleanup();
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    const onClose = () => {
      cleanup();
      rejectRequest(new Error(`${method}: CDP WebSocket closed before response`));
    };
    const onError = () => {
      cleanup();
      rejectRequest(new Error(`${method}: CDP WebSocket error before response`));
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose, { once: true });
    ws.addEventListener('error', onError, { once: true });
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

async function mountImportedRenderCanvas(ws, phase) {
  const canvasMount = await evaluateByValue(ws, `(() => {
    const canvas = window.__kaminosVolumePrototype?.canvasElement?.();
    if (!canvas) return { ok: false, reason: 'renderer-canvas-missing' };
    const requestedSize = ${JSON.stringify(renderCanvasSize)};
    const height = requestedSize?.height ?? Math.max(64, Math.min(700, window.innerHeight));
    const width = requestedSize?.width ?? Math.max(64, Math.min(window.innerWidth, height * canvas.width / Math.max(1, canvas.height)));
    if (width > window.innerWidth || height > window.innerHeight) {
      return { ok: false, reason: 'requested-canvas-exceeds-viewport', width, height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    }
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
  const rect = canvasMount?.rect;
  if (canvasMount?.ok !== true
    || !canvasMount.connected
    || !rect
    || rect.x < 0
    || rect.y < 0
    || rect.width < 64
    || rect.height < 64
    || rect.x + rect.width > canvasMount.viewportWidth + 0.5
    || rect.y + rect.height > canvasMount.viewportHeight + 0.5) {
    throw new Error(`canvas-clip-offscreen: ${JSON.stringify(canvasMount)}`);
  }
  if (renderCanvasSize && (rect.width !== renderCanvasSize.width || rect.height !== renderCanvasSize.height)) {
    throw new Error(`effective renderer canvas does not match requested geometry: ${JSON.stringify(canvasMount)}`);
  }
  return canvasMount;
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
  let importedSecondaryRender = null;
  const renderWarmups = [];
  let renderControlOverrides = {};
  let secondaryRenderControlOverrides = {};
  let browserSession = null;
  let ws = null;
  let begin = null;
  let lastDebugState = null;
  let pageDiagnostics = null;
  const viewportContract = {
    identity: viewportSize ? 'cdp-emulation-fixed-device-metrics-v0' : 'browser-window-derived-v0',
    requested: viewportSize ? { ...viewportSize, deviceScaleFactor: viewportDeviceScaleFactor } : null,
    effective: null,
  };
  const renderCanvasContract = {
    identity: renderCanvasSize ? 'explicit-pre-render-canvas-css-geometry-v0' : 'pre-render-intrinsic-aspect-derived-v0',
    requested: renderCanvasSize,
    effective: null,
  };
  const runtimeEvents = [];
  try {
    phase = 'render-option-validation';
    if (!Number.isFinite(viewportDeviceScaleFactor) || viewportDeviceScaleFactor <= 0) {
      throw new Error('--viewport-device-scale-factor must be finite and greater than zero');
    }
    if (![FULL_EXPORT_SCOPE, FLUID_FRONT_EXPORT_SCOPE].includes(exportScope)) {
      throw new Error(`unsupported --export-scope: ${exportScope}`);
    }
    if (renderOnly && exportScope !== FULL_EXPORT_SCOPE) {
      throw new Error('--render-only does not accept a narrowed --export-scope');
    }
    if (!['splat-only-v0', 'raymarch-under-splats-v0'].includes(renderComposition)) {
      throw new Error(`unsupported --render-composition: ${renderComposition}`);
    }
    renderControlOverrides = args.has('--render-control-overrides-json')
      ? JSON.parse(String(args.get('--render-control-overrides-json')))
      : {};
    if (!renderControlOverrides || typeof renderControlOverrides !== 'object' || Array.isArray(renderControlOverrides)) {
      throw new Error('--render-control-overrides-json must decode to an object');
    }
    secondaryRenderControlOverrides = args.has('--secondary-render-control-overrides-json')
      ? JSON.parse(String(args.get('--secondary-render-control-overrides-json')))
      : {};
    if (!secondaryRenderControlOverrides || typeof secondaryRenderControlOverrides !== 'object' || Array.isArray(secondaryRenderControlOverrides)) {
      throw new Error('--secondary-render-control-overrides-json must decode to an object');
    }
    if (secondaryRenderPngPath && !renderPngPath) {
      throw new Error('--secondary-render-png requires --render-png so both same-state views retain ordered custody');
    }
    phase = 'source-capture-validation';
    initialField = resolveInitialFieldManifest();
    if (initialField && !args.has('--advance-imported-steps')) {
      throw new Error('--initial-field-manifest requires explicit --advance-imported-steps, including 0 for a held control');
    }
    if (initialField?.heldOnly && advanceImportedSteps > 0) {
      throw new Error('selective-composition-held-only: --advance-imported-steps must be 0');
    }
    if (renderPngPath && !initialField) throw new Error('--render-png requires --initial-field-manifest');
    if (renderOnly && (!initialField || !renderPngPath)) {
      throw new Error('--render-only requires --initial-field-manifest and --render-png');
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

    if (viewportSize) {
      phase = 'viewport-override';
      await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
        width: viewportSize.width,
        height: viewportSize.height,
        deviceScaleFactor: viewportDeviceScaleFactor,
        mobile: false,
        screenWidth: viewportSize.width,
        screenHeight: viewportSize.height,
      });
    }

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
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    })`, 'page-diagnostics');
    viewportContract.effective = {
      width: Number(pageDiagnostics?.innerWidth),
      height: Number(pageDiagnostics?.innerHeight),
      deviceScaleFactor: Number(pageDiagnostics?.devicePixelRatio),
    };
    if (viewportSize && (
      viewportContract.effective.width !== viewportSize.width
      || viewportContract.effective.height !== viewportSize.height
      || Math.abs(viewportContract.effective.deviceScaleFactor - viewportDeviceScaleFactor) > 1e-6
    )) {
      phase = 'viewport-validation';
      throw new Error(`effective viewport does not match requested viewport: ${JSON.stringify(viewportContract)}`);
    }
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
      if (renderPngPath) {
        phase = 'mount-imported-render-canvas';
        let canvasMount = await mountImportedRenderCanvas(ws, phase);
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
        phase = 'remount-imported-render-canvas';
        canvasMount = await mountImportedRenderCanvas(ws, phase);
        renderCanvasContract.effective = {
          cssWidth: canvasMount.rect.width,
          cssHeight: canvasMount.rect.height,
          intrinsicWidthBeforeRender: canvasMount.intrinsicWidth,
          intrinsicHeightBeforeRender: canvasMount.intrinsicHeight,
        };
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
        const rect = renderReceipt.canvasCssRect;
        if (rect.x < 0
          || rect.y < 0
          || rect.width < 64
          || rect.height < 64
          || rect.x + rect.width > viewportContract.effective.width + 0.5
          || rect.y + rect.height > viewportContract.effective.height + 0.5) {
          throw new Error(`canvas-clip-offscreen: ${JSON.stringify(rect)}`);
        }
        if (renderCanvasSize && (rect.width !== renderCanvasSize.width || rect.height !== renderCanvasSize.height)) {
          throw new Error(`post-render-canvas-geometry-drift: ${JSON.stringify({ requested: renderCanvasSize, effective: rect })}`);
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
          canvasMount,
          path: renderPngPath,
          byteLength: png.byteLength,
          sha256: sha256(png),
          importedFieldManifestPath: initialField.manifestPath,
          importedFieldManifestSha256: initialField.manifestSha256,
          importedAdvanceIdentity: importedAdvance.identity,
          importedAdvanceCompletedSteps: importedAdvance.completedSteps,
        };
        if (secondaryRenderPngPath) {
          phase = 'render-imported-field-secondary';
          const secondaryReceipt = await evaluateByValue(
            ws,
            `window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
              fullFieldImportSessionId: importFinish.sessionId,
              renderScale: 1,
              boundarySplatComposition: renderComposition,
              controlOverrides: secondaryRenderControlOverrides,
              now: deterministicReplayStartTimeMs + advanceImportedSteps * deterministicReplayTimeStepMs,
              sameStateCaptureId: `imported-receiver-render-secondary-step-${advanceImportedSteps}`,
            })})`,
            phase,
          );
          if (secondaryReceipt?.ok !== true || secondaryReceipt?.imageAuthority !== 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state') {
            throw new Error(`secondary imported receiver render failed: ${JSON.stringify(secondaryReceipt)}`);
          }
          if (renderCompositionExplicit && secondaryReceipt.boundarySplatCompositionEffective !== renderComposition) {
            throw new Error(`requested secondary render composition was not effective: ${renderComposition} != ${secondaryReceipt.boundarySplatCompositionEffective || '(missing)'}`);
          }
          const secondaryRect = secondaryReceipt.canvasCssRect;
          if (secondaryRect.x < 0
            || secondaryRect.y < 0
            || secondaryRect.width < 64
            || secondaryRect.height < 64
            || secondaryRect.x + secondaryRect.width > viewportContract.effective.width + 0.5
            || secondaryRect.y + secondaryRect.height > viewportContract.effective.height + 0.5) {
            throw new Error(`canvas-clip-offscreen: ${JSON.stringify(secondaryRect)}`);
          }
          if (renderCanvasSize && (secondaryRect.width !== renderCanvasSize.width || secondaryRect.height !== renderCanvasSize.height)) {
            throw new Error(`post-render-canvas-geometry-drift: ${JSON.stringify({ requested: renderCanvasSize, effective: secondaryRect })}`);
          }
          await delay(100);
          phase = 'capture-imported-render-secondary';
          const secondaryScreenshot = await wsRequest(ws, 'Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            clip: { x: secondaryRect.x, y: secondaryRect.y, width: secondaryRect.width, height: secondaryRect.height, scale: 1 },
          });
          const secondaryPng = Buffer.from(secondaryScreenshot.data, 'base64');
          mkdirSync(dirname(secondaryRenderPngPath), { recursive: true });
          writeFileSync(secondaryRenderPngPath, secondaryPng);
          importedSecondaryRender = {
            ...secondaryReceipt,
            canvasMount,
            path: secondaryRenderPngPath,
            byteLength: secondaryPng.byteLength,
            sha256: sha256(secondaryPng),
            importedFieldManifestPath: initialField.manifestPath,
            importedFieldManifestSha256: initialField.manifestSha256,
            importedAdvanceIdentity: importedAdvance.identity,
            importedAdvanceCompletedSteps: importedAdvance.completedSteps,
          };
        }
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
        viewportContract,
        renderCanvasContract,
        runtimeEvents,
        initialFieldImport,
        importedAdvance,
        renderWarmups,
        importedRender,
        importedSecondaryRender,
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
    phase = 'drain-majorant';
    const majorant = await drainSidecar(ws, begin, 'majorant', join(outDir, 'majorant.f32'));
    let boundary = null;
    let boundarySidecar = null;
    let boundarySplats = null;
    let boundarySplatOutput = null;
    if (exportScope === 'full-field-with-boundary-v0') {
      phase = 'drain-boundary-sidecar';
      boundary = await drainSidecar(
        ws,
        begin,
        'boundary',
        join(outDir, 'boundary-sidecar.f32'),
        begin.boundarySidecar?.sidecars?.boundary,
      );
      boundarySidecar = {
        ...begin.boundarySidecar,
        sidecars: { boundary },
      };
      phase = 'drain-boundary-splats';
      boundarySplats = await drainSidecar(
        ws,
        begin,
        'boundarySplat',
        join(outDir, 'boundary-splats.f32'),
        begin.boundarySplats?.sidecars?.boundarySplats,
      );
      boundarySplatOutput = {
        ...begin.boundarySplats,
        sidecars: { boundarySplats },
      };
    }

    phase = 'release';
    const release = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.releaseDebugFullFieldExport(${JSON.stringify({ sessionId: begin.sessionId })})`,
      phase,
    );

    const manifest = {
      schema: MANIFEST_SCHEMA,
      identity: exportIdentity,
      status: 'captured',
      failurePhase: null,
      completeFieldCoverage: true,
      exportScope,
      derivedBoundaryCoverage: exportScope === FULL_EXPORT_SCOPE ? 'included-v0' : 'omitted-by-caller-v0',
      url,
      sourceCapture,
      browserSession: browserReceipt(browserSession),
      lastDebugState,
      pageDiagnostics,
      viewportContract,
      renderCanvasContract,
      runtimeEvents,
      chunkFloats,
      sessionId: begin.sessionId,
      routeIdentity: begin.routeIdentity,
      effectiveRoute: begin.effectiveRoute,
      prototypeIdentity: begin.prototypeIdentity,
      backend: begin.backend,
      grid: begin.grid,
      majorantGrid: begin.majorantGrid,
      cellCount: begin.cellCount,
      simGridLabel: begin.simGridLabel,
      deterministicReplay: begin.deterministicReplay,
      initialFieldImport,
      importedAdvance,
      renderWarmups,
      importedRender,
      importedSecondaryRender,
      fluidComponents: begin.fluidComponents,
      fluidChannelOrder: begin.fluidChannelOrder,
      frontChannelOrder: begin.frontChannelOrder,
      sidecars: { fluid, front, majorant },
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
        majorant: { path: majorant.path, sha256: majorant.sha256, byteLength: majorant.byteLength },
        ...(boundary ? { boundary: { path: boundary.path, sha256: boundary.sha256, byteLength: boundary.byteLength } } : {}),
        ...(boundarySplats ? { boundarySplats: { path: boundarySplats.path, sha256: boundarySplats.sha256, byteLength: boundarySplats.byteLength } } : {}),
      },
    }, null, 2));
  } catch (error) {
    writeManifest({
      schema: MANIFEST_SCHEMA,
      identity: exportIdentity,
      status: 'failed',
      failurePhase: phase,
      completeFieldCoverage: false,
      url,
      sourceCapture,
      requestedSourceCapture: sourceCapturePath,
      requestedInitialFieldManifest: initialFieldManifestPath,
      initialFieldImport,
      importedAdvance,
      renderWarmups,
      importedRender,
      importedSecondaryRender,
      targetOrigin,
      browserSession: browserReceipt(browserSession),
      lastDebugState,
      pageDiagnostics,
      viewportContract,
      renderCanvasContract,
      runtimeEvents,
      chunkFloats,
      exportScope,
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

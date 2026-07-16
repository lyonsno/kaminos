#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  CAUSAL_CONTROL_ORDER,
  CAUSAL_CONTROL_RANGES,
  CURRENT16_ORDER,
  SOURCE_BASIS_CAPTURE_AUTHORITY,
  SOURCE_BASIS_CAPTURE_SCHEMA,
  SOURCE_BASIS_CAPTURE_SEED,
  SOURCE_BASIS_GPU_ROW_FLOATS,
  SOURCE_BASIS_ORDER,
  SOURCE_BASIS_SETTING_COUNT,
  TARGET_ORDER,
  buildFullGridWorldPositions,
  buildVivisectorControlDesign,
} from './volume-nonridge-source-basis-capture.mjs';

const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-nonridge-source-basis-capture'));
const artifactsDir = join(outDir, 'artifacts');
const capturesManifestPath = resolve(String(args.get('--captures-manifest') || join(outDir, 'captures-manifest.json')));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'capture-report.json')));
const corpusOutDir = resolve(String(args.get('--corpus-out-dir') || join(outDir, 'corpus')));
const selectedSettingIndex = args.has('--setting-index') ? Number(args.get('--setting-index')) : null;
const heldOutSetting = String(args.get('--held-out-setting') || 'setting-p');
const timeoutMs = Number(args.get('--timeout-ms') || 600000);
const settleMs = Number(args.get('--settle-ms') || 2500);
const viewportWidth = Number(args.get('--viewport-width') || 1280);
const viewportHeight = Number(args.get('--viewport-height') || 960);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-nonridge-source-basis-profile-');
const packerPath = resolve(import.meta.dirname, 'volume-nonridge-source-basis-corpus.py');
const design = buildVivisectorControlDesign();
const selectedSettings = selectedSettingIndex === null
  ? design.map((controls, index) => ({ controls, index }))
  : [{ controls: design[selectedSettingIndex], index: selectedSettingIndex }];

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = { designSeed: SOURCE_BASIS_CAPTURE_SEED, settingCount: SOURCE_BASIS_SETTING_COUNT };
const completedSettings = [];

mkdirSync(artifactsDir, { recursive: true });
mkdirSync(dirname(capturesManifestPath), { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

class CdpSocket {
  constructor(url, timeout) {
    this.url = url;
    this.timeout = timeout;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) {
            this.browserEvents.push(message);
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.socket?.close();
  }
}

class ArtifactSink {
  constructor(fileName, semanticRole, shape) {
    this.path = join(artifactsDir, fileName);
    this.semanticRole = semanticRole;
    this.shape = shape;
    this.handle = openSync(this.path, 'w');
    this.hash = createHash('sha256');
    this.bytes = 0;
  }

  write(bytes) {
    writeSync(this.handle, bytes);
    this.hash.update(bytes);
    this.bytes += bytes.byteLength;
  }

  close() {
    closeSync(this.handle);
    return {
      path: relative(dirname(capturesManifestPath), this.path),
      bytes: this.bytes,
      sha256: this.hash.digest('hex'),
      dtype: 'float32-le',
      semanticRole: this.semanticRole,
      shape: this.shape,
    };
  }
}

try {
  assert.ok(selectedSettings.every(setting => setting.controls && Number.isInteger(setting.index)), 'requested setting index is outside the deterministic design');
  assert.ok(Number.isInteger(viewportWidth) && viewportWidth >= 128, 'viewport width must be at least 128');
  assert.ok(Number.isInteger(viewportHeight) && viewportHeight >= 128, 'viewport height must be at least 128');
  const route = new URL(requestedUrl);
  assert.equal(route.hostname, '127.0.0.1', 'witness route must be caller-owned localhost');

  failurePhase = 'browser-launch';
  browser = spawn(chrome, [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${viewportWidth},${viewportHeight}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const target = await waitForTarget(debugPort, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-admission';
  const admitted = await waitForRuntime(socket, timeoutMs);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, admitted };
  await delay(settleMs);

  failurePhase = 'freeze-authority';
  const frozenRuntime = await evaluate(socket, `(async () => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
    if (!prototype?.applyDebugNonRidgeCausalControls
      || !prototype?.beginDebugNonRidgeSourceBasisCapture
      || !prototype?.readDebugNonRidgeSourceBasisCaptureChunk
      || !prototype?.releaseDebugNonRidgeSourceBasisCapture
      || !prototype?.beginDebugFullFieldExport) {
      throw new Error('nonridge-source-basis-capture-api-missing');
    }
    prototype.setControls({ raySteps: 160, adaptiveRays: 0, temporalAccum: 0, temporalJitter: 0 });
    prototype.setRaymarchSmokePresentationMode('off');
    prototype.setSelectiveHeadLiveCapturePaused(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    prototype.setActive(false);
    const state = prototype.debugState();
    const camera = basinWindow.kaminosCameraDebugState?.() || null;
    return {
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      grid: state.simGrid,
      controls: state.controls,
      camera,
      renderWidth: state.renderWidth,
      renderHeight: state.renderHeight,
      displayWidth: state.displayWidth,
      displayHeight: state.displayHeight,
      requestedRoute: state.requestedRoute,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
      prototypeIdentity: state.prototypeIdentity,
      smokeRequested: state.raymarchSmokePresentationModeRequested,
      smokeEffective: state.raymarchSmokePresentationModeEffective,
      captureTimeMs: performance.now(),
    };
  })()`);
  assert.equal(frozenRuntime.grid, 128, 'first source-basis corpus requires the exact 128^3 source grid');
  assert.equal(frozenRuntime.controls.raySteps, 160, 'requested ray steps were substituted');
  assert.equal(frozenRuntime.controls.adaptiveRays, 0, 'adaptive rays were not disabled');
  assert.equal(frozenRuntime.controls.temporalAccum, 0, 'temporal accumulation was not disabled');
  assert.equal(frozenRuntime.controls.temporalJitter, 0, 'temporal jitter was not disabled');
  assert.equal(frozenRuntime.smokeEffective, 'off', 'smoke presentation did not become off');

  failurePhase = 'frozen-state-export';
  const frozenStateArtifact = await captureFrozenState(socket, frozenRuntime);
  const shape = [frozenRuntime.grid, frozenRuntime.grid, frozenRuntime.grid];
  const origin = [-1, -1, -1];
  const spacing = shape.map(size => 2 / size);
  const worldPosition = writeWorldPositionArtifact(shape, origin, spacing);
  const generation = 0;
  const generationHash = sha256(Buffer.from(canonicalJson({ stateHash: frozenStateArtifact.sha256, generation })));
  const simStepHash = sha256(Buffer.from(canonicalJson({ generationHash, simStepCount: frozenRuntime.simStepCount })));
  const frozenAuthority = {
    presetId: route.searchParams.get('preset') || 'unaddressed-live-preset',
    stateIdentity: 'checksum-bound-frozen-live-field-v0',
    stateHash: frozenStateArtifact.sha256,
    generation,
    generationHash,
    simStepCount: frozenRuntime.simStepCount,
    simStepHash,
    gridShape: shape,
    gridHash: worldPosition.sha256,
    gridOrigin: origin,
    gridSpacing: spacing,
    gridAxisOrder: 'x-fastest-y-then-z-v0',
    cameraIdentity: `sha256:${sha256(Buffer.from(canonicalJson(frozenRuntime.camera)))}`,
    viewportIdentity: `${frozenRuntime.renderWidth}x${frozenRuntime.renderHeight}@1-v0`,
    smokeState: `authored-${frozenRuntime.controls.smoke}-presentation-${frozenRuntime.smokeEffective}-v0`,
    requestedRaySteps: 160,
    effectiveRaySteps: frozenRuntime.controls.raySteps,
    adaptiveIdentity: 'adaptive-rays-disabled-v0',
    temporalIdentity: 'temporal-accumulation-and-jitter-disabled-v0',
    requestedRoute: 'native-3d-compute-fluid-raymarch-v0',
    effectiveRoute: frozenRuntime.effectiveRoute,
    backend: frozenRuntime.backend,
    rendererIdentity: frozenRuntime.prototypeIdentity || 'native-3d-compute-fluid-raymarch-v0',
    splatRadius: Number(frozenRuntime.controls.boundarySplatRadius || 0),
    splatSharpness: Number(frozenRuntime.controls.boundarySplatSharpness || 0),
    covarianceIdentity: String(frozenRuntime.controls.boundarySplatCovariance || 'not-applied-full-grid-raymarch-source-capture-v0'),
    depthPolicy: String(frozenRuntime.controls.boundarySplatDepthPolicy || 'not-applied-full-grid-raymarch-source-capture-v0'),
    fallbackReason: null,
  };
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, frozenAuthority, frozenStateArtifact, worldPosition };

  for (const setting of selectedSettings) {
    const settingId = settingIdFor(setting.index);
    const startedAt = performance.now();
    failurePhase = `${settingId}-control-application`;
    const application = await evaluate(socket, `(() => {
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
      return prototype.applyDebugNonRidgeCausalControls(${JSON.stringify(setting.controls)});
    })()`);
    assert.equal(application.ok, true, `${settingId} control application failed: ${JSON.stringify(application)}`);
    assert.deepEqual(application.controlSubstitutions, [], `${settingId} silently substituted controls`);
    assert.deepEqual(application.gpuControlSubstitutions, [], `${settingId} silently substituted shader uniforms`);
    assert.equal(application.boundaryControlUniformAuthority, 'nonridge-source-basis-capture-controls-v0', `${settingId} did not own the boundary-control uniforms`);
    assert.equal(application.fallbackReason, null, `${settingId} reported fallback`);

    failurePhase = `${settingId}-full-grid-capture`;
    const capture = await evaluate(socket, `(async () => {
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
      return prototype.beginDebugNonRidgeSourceBasisCapture({ captureTimeMs: ${JSON.stringify(frozenRuntime.captureTimeMs)} });
    })()`);
    assert.equal(capture.ok, true, `${settingId} capture failed: ${JSON.stringify(capture)}`);
    assert.deepEqual(capture.gridShape, shape, `${settingId} grid shape drifted`);
    assert.equal(capture.rowCount, shape[0] * shape[1] * shape[2], `${settingId} did not retain every grid row`);
    assert.equal(capture.strideFloats, SOURCE_BASIS_GPU_ROW_FLOATS, `${settingId} source row ABI drifted`);
    assert.equal(capture.rendererPassReceipt?.fullGridApplied, true, `${settingId} full-grid pass was not applied`);
    assert.equal(capture.rendererPassReceipt?.fallbackReason, null, `${settingId} full-grid pass fell back`);

    failurePhase = `${settingId}-artifact-drain`;
    const drained = await drainSettingArtifacts(socket, settingId, capture, worldPosition);

    failurePhase = `${settingId}-preview`;
    const preview = await capturePreview(socket, frozenRuntime.captureTimeMs, settingId);
    const previewName = `${settingId}-nonridge.png`;
    const previewPath = join(artifactsDir, previewName);
    writeFileSync(previewPath, decodePngDataUrl(preview.pngDataUrl));

    const release = await evaluate(socket, `(() => {
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
      return prototype.releaseDebugNonRidgeSourceBasisCapture(${JSON.stringify({ sessionId: capture.sessionId })});
    })()`);
    assert.equal(release.ok, true, `${settingId} capture release failed`);

    const negativeControl = drained.targetSummary.allTargetsZero;
    completedSettings.push({
      id: settingId,
      requestedControls: application.requestedControls,
      effectiveControls: application.effectiveControls,
      gpuEffectiveControls: application.gpuEffectiveControls,
      controlSubstitutions: application.controlSubstitutions,
      gpuControlSubstitutions: application.gpuControlSubstitutions,
      boundaryControlUniformAuthority: application.boundaryControlUniformAuthority,
      negativeControl,
      negativeControlPredicate: negativeControl ? 'all-targets-zero-v0' : null,
      source: {
        ...frozenAuthority,
        controlsHash: sha256(Buffer.from(canonicalJson(application.effectiveControls))),
      },
      rows: drained.rows,
      targetSummary: drained.targetSummary,
      rendererPassReceipt: capture.rendererPassReceipt,
      preview: {
        path: relative(dirname(capturesManifestPath), previewPath),
        width: preview.width,
        height: preview.height,
        litPixels: preview.litPixels,
        meanLuma: preview.meanLuma,
      },
      measuredWallMs: performance.now() - startedAt,
    });
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, completedSettingIds: completedSettings.map(row => row.id) };
  }

  failurePhase = 'frozen-authority-verification';
  const after = await evaluate(socket, `(() => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
    const state = prototype.debugState();
    return { frameCount: state.frameCount, simStepCount: state.simStepCount, camera: basinWindow.kaminosCameraDebugState?.() || null };
  })()`);
  assert.equal(after.frameCount, frozenRuntime.frameCount, 'capture campaign advanced the frozen frame');
  assert.equal(after.simStepCount, frozenRuntime.simStepCount, 'capture campaign advanced the frozen simulation');
  assert.deepEqual(after.camera, frozenRuntime.camera, 'capture campaign changed the camera');

  const expectedSettingIds = design.map((_, index) => settingIdFor(index));
  const capturesManifest = {
    schema: 'kaminos.volume.nonridge-source-setting-captures.v0',
    authority: 'integration-positive-nonridge-randomized-source-captures-v0',
    positivePartitionIdentity: 'nonnegative-ridge-owned-plus-non-ridge-complete-flame-v0',
    completeFlameIdentity: 'smoke-off-complete-flame-local-emission-extinction-v0',
    nonRidgeTargetIdentity: 'positive-nonridge-local-emission-extinction-v0',
    cohort: 'full-grid',
    worldPositionIdentity: 'grid-cell-center-world-position-v0',
    frozenAuthority,
    frozenStateArtifact,
    featureViews: {
      current16: {
        order: CURRENT16_ORDER,
        provenance: Object.fromEntries(CURRENT16_ORDER.map(channel => [channel, 'candidate-source-current16'])),
      },
      sourceComplete: {
        sourceBasisIdentity: 'nonridge-minimal-independent-source-basis-v0',
        order: [...CURRENT16_ORDER, ...SOURCE_BASIS_ORDER],
        provenance: Object.fromEntries([...CURRENT16_ORDER, ...SOURCE_BASIS_ORDER].map(channel => [
          channel,
          CURRENT16_ORDER.includes(channel) ? 'candidate-source-current16' : 'candidate-source-independent',
        ])),
      },
    },
    targets: { order: TARGET_ORDER },
    design: {
      identity: 'deterministic-space-filling-randomized-controls-v0',
      generatorIdentity: 'deterministic-latin-hypercube-boundary-v0',
      seed: SOURCE_BASIS_CAPTURE_SEED,
      sampledControls: CAUSAL_CONTROL_ORDER,
      controlRanges: CAUSAL_CONTROL_RANGES,
      expectedSettingIds: selectedSettingIndex === null ? expectedSettingIds : completedSettings.map(setting => setting.id),
      admittedSettingIds: completedSettings.map(setting => setting.id),
      rejectedSettings: [],
      retentionPolicy: 'retain-all-admitted-settings-and-rows-uncapped-v0',
      campaignStatus: selectedSettingIndex === null
        ? 'capture-tranche-complete-awaiting-verdict-v0'
        : 'explicit-diagnostic-subset-not-packer-authority-v0',
    },
    settings: completedSettings,
  };
  writeFileSync(capturesManifestPath, `${JSON.stringify(capturesManifest, null, 2)}\n`);
  const capturesManifestSha256 = sha256(readFileSync(capturesManifestPath));

  let packerReceipt = null;
  if (selectedSettingIndex === null) {
    failurePhase = 'vivisector-packer-validation';
    mkdirSync(corpusOutDir, { recursive: true });
    const result = spawnSync('python3', [
      packerPath,
      '--captures-manifest', capturesManifestPath,
      '--out-dir', corpusOutDir,
      '--held-out-setting', heldOutSetting,
    ], { cwd: import.meta.dirname, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, `volume-nonridge-source-basis-corpus.py rejected captures:\n${result.stdout}\n${result.stderr}`);
    const corpusManifestPath = join(corpusOutDir, 'corpus-manifest.json');
    const corpus = JSON.parse(readFileSync(corpusManifestPath, 'utf8'));
    packerReceipt = {
      command: ['python3', basename(packerPath), '--captures-manifest', capturesManifestPath, '--out-dir', corpusOutDir, '--held-out-setting', heldOutSetting],
      status: result.status,
      corpusManifestPath,
      corpusManifestSha256: sha256(readFileSync(corpusManifestPath)),
      corpusIdentity: corpus.identity,
      retainedSettingCount: corpus.cohort.retainedSettingCount,
      retainedRowCount: corpus.cohort.totalRows,
      droppedRowCount: corpus.cohort.droppedRowCount,
    };
  }

  const report = {
    schema: 'kaminos.volume.nonridge-source-basis-capture-witness.v0',
    status: selectedSettingIndex === null ? 'captured-and-packer-validated' : 'captured-explicit-diagnostic-subset',
    failurePhase: null,
    lastTrustworthyEvidence: {
      capturesManifestPath,
      capturesManifestSha256,
      frozenStateSha256: frozenStateArtifact.sha256,
      completedSettingIds: completedSettings.map(setting => setting.id),
    },
    requestedUrl,
    admitted,
    frozenRuntime,
    frozenAuthority,
    capturesManifestPath,
    capturesManifestSha256,
    packerReceipt,
    visualInspectionRequired: completedSettings.map(setting => setting.preview),
    browserEvents: socket.browserEvents.map(summarizeBrowserEvent),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, capturesManifestPath, status: report.status, packerReceipt }, null, 2));
} catch (error) {
  const failure = {
    schema: 'kaminos.volume.nonridge-source-basis-capture-witness.v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl,
    completedSettingIds: completedSettings.map(setting => setting.id),
    lastTrustworthyEvidence,
    browserEvents: socket?.browserEvents?.map(summarizeBrowserEvent) || [],
  };
  writeFileSync(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
}

async function captureFrozenState(cdp, runtime) {
  const capture = await evaluate(cdp, `(async () => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
    return prototype.beginDebugFullFieldExport({});
  })()`);
  assert.equal(capture.ok, true, `frozen full-field export failed: ${JSON.stringify(capture)}`);
  const filePath = join(artifactsDir, 'frozen-simulator-state.bin');
  const handle = openSync(filePath, 'w');
  const hash = createHash('sha256');
  let bytesWritten = 0;
  const descriptor = Buffer.from(`${JSON.stringify({ runtime, capture })}\n`);
  const descriptorLength = Buffer.alloc(4);
  descriptorLength.writeUInt32LE(descriptor.byteLength);
  for (const bytes of [descriptorLength, descriptor]) {
    writeSync(handle, bytes);
    hash.update(bytes);
    bytesWritten += bytes.byteLength;
  }
  try {
    for (const kind of ['fluid', 'front', 'boundary', 'boundarySplat']) {
      let startFloat = 0;
      while (true) {
        const chunk = await evaluate(cdp, `(() => {
          const basinWindow = document.querySelector('#basin')?.contentWindow || window;
          const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
          return prototype.readDebugFullFieldExportChunk(${JSON.stringify({ sessionId: capture.sessionId, kind, startFloat, floatCount: 262144 })});
        })()`);
        assert.equal(chunk.ok, true, `frozen state ${kind} chunk failed`);
        assert.equal(chunk.startFloat, startFloat, `frozen state ${kind} chunk offset drifted`);
        const bytes = Buffer.from(chunk.base64, 'base64');
        writeSync(handle, bytes);
        hash.update(bytes);
        bytesWritten += bytes.byteLength;
        startFloat += chunk.floatCount;
        if (chunk.isFinal) break;
      }
    }
  } finally {
    closeSync(handle);
  }
  const release = await evaluate(cdp, `(() => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
    return prototype.releaseDebugFullFieldExport(${JSON.stringify({ sessionId: capture.sessionId })});
  })()`);
  assert.equal(release.ok, true, 'frozen state export release failed');
  return {
    path: relative(dirname(capturesManifestPath), filePath),
    bytes: bytesWritten,
    sha256: hash.digest('hex'),
    semanticRole: 'frozen-simulator-state',
    packIdentity: 'length-prefixed-json-descriptor-plus-fluid-front-boundary-and-splat-f32-v0',
  };
}

function writeWorldPositionArtifact(shape, origin, spacing) {
  const values = buildFullGridWorldPositions({ shape, origin, spacing });
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const filePath = join(artifactsDir, 'frozen-world-position.f32');
  writeFileSync(filePath, bytes);
  return {
    path: relative(dirname(capturesManifestPath), filePath),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    dtype: 'float32-le',
    semanticRole: 'grid-cell-center-world-position',
    shape: [shape[0] * shape[1] * shape[2], 3],
  };
}

async function drainSettingArtifacts(cdp, settingId, capture, worldPosition) {
  const rowCount = capture.rowCount;
  const sinks = {
    current16: new ArtifactSink(`${settingId}-current16.f32`, 'candidate-features-current16', [rowCount, CURRENT16_ORDER.length]),
    sourceComplete: new ArtifactSink(`${settingId}-source-complete.f32`, 'candidate-features-source-complete', [rowCount, CURRENT16_ORDER.length + SOURCE_BASIS_ORDER.length]),
    targets: new ArtifactSink(`${settingId}-targets.f32`, 'supervision-targets-positive-nonridge', [rowCount, TARGET_ORDER.length]),
    sourceBasis: Object.fromEntries(SOURCE_BASIS_ORDER.map(channel => [
      channel,
      new ArtifactSink(`${settingId}-${channel.replaceAll('.', '-')}.f32`, `candidate-source-field:${channel}`, [rowCount, 1]),
    ])),
  };
  let startFloat = 0;
  let drainedRows = 0;
  let positiveMembershipRows = 0;
  let negativeMembershipRows = 0;
  let positiveOpticalRows = 0;
  let allTargetsZero = true;
  while (true) {
    const chunk = await evaluate(cdp, `(() => {
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
      return prototype.readDebugNonRidgeSourceBasisCaptureChunk(${JSON.stringify({
        sessionId: capture.sessionId,
        startFloat: '__START_FLOAT__',
        floatCount: SOURCE_BASIS_GPU_ROW_FLOATS * 8192,
      }).replace('"__START_FLOAT__"', String(startFloat))});
    })()`);
    assert.equal(chunk.ok, true, `${settingId} row chunk failed`);
    assert.equal(chunk.startFloat, startFloat, `${settingId} row chunk offset drifted`);
    assert.equal(chunk.floatCount % SOURCE_BASIS_GPU_ROW_FLOATS, 0, `${settingId} row chunk split a row`);
    const bytes = Buffer.from(chunk.base64, 'base64');
    const source = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const rows = source.length / SOURCE_BASIS_GPU_ROW_FLOATS;
    const current = new Float32Array(rows * CURRENT16_ORDER.length);
    const complete = new Float32Array(rows * (CURRENT16_ORDER.length + SOURCE_BASIS_ORDER.length));
    const targets = new Float32Array(rows * TARGET_ORDER.length);
    const basis = SOURCE_BASIS_ORDER.map(() => new Float32Array(rows));
    for (let row = 0; row < rows; row += 1) {
      const sourceOffset = row * SOURCE_BASIS_GPU_ROW_FLOATS;
      const currentOffset = row * CURRENT16_ORDER.length;
      const completeOffset = row * (CURRENT16_ORDER.length + SOURCE_BASIS_ORDER.length);
      const targetOffset = row * TARGET_ORDER.length;
      const currentRow = source.subarray(sourceOffset, sourceOffset + CURRENT16_ORDER.length);
      current.set(currentRow, currentOffset);
      complete.set(currentRow, completeOffset);
      for (let channel = 0; channel < SOURCE_BASIS_ORDER.length; channel += 1) {
        const value = source[sourceOffset + CURRENT16_ORDER.length + channel];
        complete[completeOffset + CURRENT16_ORDER.length + channel] = value;
        basis[channel][row] = value;
      }
      const targetStart = sourceOffset + CURRENT16_ORDER.length + SOURCE_BASIS_ORDER.length;
      const targetRow = source.subarray(targetStart, targetStart + TARGET_ORDER.length);
      targets.set(targetRow, targetOffset);
      positiveMembershipRows += targetRow[0] > 0 ? 1 : 0;
      negativeMembershipRows += targetRow[0] === 0 ? 1 : 0;
      const positiveOptical = targetRow[1] > 0 || targetRow[2] > 0 || targetRow[3] > 0 || targetRow[4] > 0;
      positiveOpticalRows += positiveOptical ? 1 : 0;
      allTargetsZero = allTargetsZero && !positiveOptical && targetRow[0] === 0;
    }
    sinks.current16.write(f32Bytes(current));
    sinks.sourceComplete.write(f32Bytes(complete));
    sinks.targets.write(f32Bytes(targets));
    basis.forEach((values, channel) => sinks.sourceBasis[SOURCE_BASIS_ORDER[channel]].write(f32Bytes(values)));
    drainedRows += rows;
    startFloat += chunk.floatCount;
    if (chunk.isFinal) break;
  }
  assert.equal(drainedRows, rowCount, `${settingId} drained a partial full-grid cohort`);
  return {
    rows: {
      count: rowCount,
      worldPosition,
      current16: sinks.current16.close(),
      sourceComplete: sinks.sourceComplete.close(),
      sourceBasis: Object.fromEntries(SOURCE_BASIS_ORDER.map(channel => [channel, sinks.sourceBasis[channel].close()])),
      targets: sinks.targets.close(),
    },
    targetSummary: { positiveMembershipRows, negativeMembershipRows, positiveOpticalRows, allTargetsZero },
  };
}

async function capturePreview(cdp, captureTimeMs, settingId) {
  return evaluate(cdp, `(async () => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype;
    const prior = prototype.debugState().appearanceDecompositionRequestedRaw || 'off';
    await prototype.setActive(true);
    prototype.setAppearanceDecompositionMode('non-ridge-emission');
    const sample = await prototype.sampleFrame({ advanceSim: false, includeRgba: true, now: ${JSON.stringify(captureTimeMs)}, sameStateCaptureId: ${JSON.stringify(settingId)} });
    prototype.setAppearanceDecompositionMode(prior);
    prototype.setActive(false);
    if (!sample.ok || !sample.image?.rgba?.length) throw new Error('nonridge-source-basis-preview-failed:' + (sample.reason || 'missing-rgba'));
    const canvas = document.createElement('canvas');
    canvas.width = sample.image.width;
    canvas.height = sample.image.height;
    canvas.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(sample.image.rgba), sample.image.width, sample.image.height), 0, 0);
    let litPixels = 0;
    let lumaSum = 0;
    for (let index = 0; index < sample.image.rgba.length; index += 4) {
      const luma = 0.2126 * sample.image.rgba[index] + 0.7152 * sample.image.rgba[index + 1] + 0.0722 * sample.image.rgba[index + 2];
      litPixels += luma > 8 ? 1 : 0;
      lumaSum += luma;
    }
    return { pngDataUrl: canvas.toDataURL('image/png'), width: sample.image.width, height: sample.image.height, litPixels, meanLuma: lumaSum / Math.max(1, sample.image.rgba.length / 4) };
  })()`);
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    parsed.set(key, value);
    if (value !== true) index += 1;
  }
  return parsed;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`${name} is required`);
  return String(value);
}

function settingIdFor(index) {
  return `setting-${String.fromCharCode(97 + index)}`;
}

function f32Bytes(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(value || ''));
  if (!match) throw new Error('capture did not return a PNG data URL');
  return Buffer.from(match[1], 'base64');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function waitForTarget(port, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(candidate => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for Chrome DevTools target');
}

async function waitForRuntime(cdp, timeout) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeout) {
    last = await evaluate(cdp, `(() => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const wrapper = operator?.debugState?.() || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const state = (window.__kaminosVolumePrototype || basinWindow.__kaminosVolumePrototype)?.debugState?.();
      return {
        wrapperStatus: wrapper?.status || null,
        wrapperError: wrapper?.error || null,
        effectiveRole: wrapper?.effectiveRole || state?.selectiveHeadLiveEffectiveRole || null,
        effectiveComposition: wrapper?.effectiveComposition || state?.selectiveHeadLiveCompositionEffective || null,
        active: state?.active === true,
        backend: state?.backend || null,
        error: state?.error || null,
        wrapperRequestedRoute: state?.requestedRoute || null,
        rendererEffectiveRoute: state?.effectiveRoute || null,
      };
    })()`);
    if (last?.wrapperStatus === 'failed') throw new Error(`operator wrapper admission failed: ${last.wrapperError || 'missing-wrapper-error'}`);
    if (last?.active && last?.backend?.startsWith('WebGPU') && last?.effectiveRole === 'truthHigh' && last?.effectiveComposition === 'raymarch-only-v0') return last;
    if (last?.error) throw new Error(`renderer route failed: ${last.error}`);
    await delay(250);
  }
  throw new Error(`timed out waiting for admitted volume runtime: ${JSON.stringify(last)}`);
}

function summarizeBrowserEvent(event) {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params?.exceptionDetails || {};
    return { method: event.method, text: details.exception?.description || details.text || null, url: details.url || null };
  }
  if (event.method === 'Log.entryAdded') {
    return { method: event.method, level: event.params?.entry?.level || null, text: event.params?.entry?.text || null, url: event.params?.entry?.url || null };
  }
  return { method: event.method, type: event.params?.type || null, args: (event.params?.args || []).map(argument => argument.value ?? argument.description ?? null) };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}

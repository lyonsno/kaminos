#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  CAUSAL_CONTROL_FIELDS,
  SOURCE_BASIS_GPU_ROW_FLOATS,
} from './volume-nonridge-source-basis-capture.mjs';
import {
  ANALYTICAL_ADMISSION_AUTHORITY,
  ANALYTICAL_ADMISSION_IDENTITY,
  ANALYTICAL_ADMISSION_ORDER,
  COEFFICIENT_ORDER,
  POST_ADMISSION_FEATURE_ORDER,
  selectAnalyticalLayerRows,
} from './volume-layer-analytical-admission.mjs';
import {
  FLOW_KERNEL_DESCRIPTOR_ORDER,
  FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
  FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
} from './flow-kernel-descriptor-socket.mjs';
import {
  buildGrid96SourceComponentProducer,
  validateGrid96SourceComponentAuthority,
} from './volume-grid96-source-component-manifest.mjs';
import {
  assertLayerCoefficientPopulation,
  emptyLayerCoefficientPopulation,
  mergeLayerCoefficientPopulation,
  summarizeLayerCoefficientPopulation,
} from './volume-layer-coefficient-population.mjs';
const WITNESS_IDENTITY = 'exact-grid96-source-support-coefficient-descriptor-capture-v0';
const PRODUCER_SCHEMA = 'kaminos.volume.grid96-coefficient-source-capture.v0';
const STATE_ID = 'coefficient-state-120';
const REPLAY_IDENTITY = 'deterministic-replay-same-route-controls-fixed-step-v0';
const REVIEWED_DESCRIPTOR_SOCKET_IDENTITY = 'flow-kernel-local-descriptor-socket-v0';
const LIVE_REPLAY_AUTHORITY = 'checksum-addressed-live-replay-resume-v0';
const LIVE_REPLAY_FILTER = 'exact-field-live-replay-application-v0';
const FIELD_LAYOUT_IDENTITY = 'fluid-front-grid-x-fastest-y-then-z-f32-v0';
const DESCRIPTOR_KERNEL_IDENTITY = 'flow-tangent-positive-symmetric-trilinear-v0';
const DESCRIPTOR_CONTROLS = Object.freeze({ strength: 0.6, radiusWorld: 0.018, coherence: 0.7 });
const VOLUME_PROTOTYPE_EXPRESSION = `(window.__kaminosVolumePrototype || document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype)`;
const TIGER_RUNTIME_COMMIT = 'ddc8c65c06c84b8bbb79a6698d1ae3744534a73a';
const IMPORTED_MODULE_SHA256 = Object.freeze({
  sourceBasis: 'c59a3fed7991e5cfd33171a9b55871a9a3213b1fbf154c81f736df826abe608a',
  analyticalAdmission: '9441a75648f204e7513d330591219345c3ae1d4116c170351085c7d04c6621e6',
  descriptorSocket: 'cda9fa4e22f502de13834ff68d86891442475415488572a79effc12ec55aa150',
});

const args = parseArgs(process.argv.slice(2));
const requestedUrl = args.get('--url') && args.get('--url') !== true ? String(args.get('--url')) : null;
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-layer-coefficient-corpus'));
const artifactsDir = join(outDir, 'artifacts');
const reportPath = resolve(String(args.get('--report') || join(outDir, 'capture-report.json')));
const producerManifestPath = resolve(String(args.get('--producer-manifest') || join(outDir, 'grid96-source-component-producer.json')));
const sourceManifestPath = resolve(String(args.get('--source-manifest') || ''));
const equivalenceManifestPath = resolve(String(args.get('--equivalence-manifest') || ''));
const stateSteps = 120;
const motionCapture = false;
const timeoutMs = Number(args.get('--timeout-ms') || 900000);
const settleMs = Number(args.get('--settle-ms') || 2500);
const viewportWidth = Number(args.get('--viewport-width') || 1280);
const viewportHeight = Number(args.get('--viewport-height') || 960);
const chunkRows = Number(args.get('--chunk-rows') || 8192);
const chunkFloats = Number(args.get('--chunk-floats') || 262144);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-layer-coefficient-profile-');
const descriptorSocketPath = resolve(import.meta.dirname, 'flow-kernel-descriptor-socket.mjs');
const importedModulePaths = Object.freeze({
  sourceBasis: resolve(import.meta.dirname, 'volume-nonridge-source-basis-capture.mjs'),
  analyticalAdmission: resolve(import.meta.dirname, 'volume-layer-analytical-admission.mjs'),
  descriptorSocket: descriptorSocketPath,
});

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = { witnessIdentity: WITNESS_IDENTITY };
let runtimeIdentity = { requestedRoute: requestedUrl, effectiveRoute: null, prototypeIdentity: null, backend: null };

mkdirSync(artifactsDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(producerManifestPath), { recursive: true });
try {
  unlinkSync(producerManifestPath);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

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
  constructor(path, { dtype, semanticRole }) {
    this.path = path;
    this.dtype = dtype;
    this.semanticRole = semanticRole;
    this.handle = openSync(path, 'w');
    this.hash = createHash('sha256');
    this.bytes = 0;
    this.closed = false;
  }

  write(bytes) {
    assert.equal(this.closed, false, `artifact sink already closed: ${this.path}`);
    writeSync(this.handle, bytes);
    this.hash.update(bytes);
    this.bytes += bytes.byteLength;
  }

  close(shape, extra = {}) {
    assert.equal(this.closed, false, `artifact sink already closed: ${this.path}`);
    closeSync(this.handle);
    this.closed = true;
    return {
      path: this.path,
      bytes: this.bytes,
      sha256: this.hash.digest('hex'),
      dtype: this.dtype,
      shape,
      semanticRole: this.semanticRole,
      ...extra,
    };
  }
}

try {
  validateArguments();
  validateImportedModuleBytes();
  failurePhase = 'source-authority-admission';
  const authoritativeSource = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
  const equivalence = JSON.parse(readFileSync(equivalenceManifestPath, 'utf8'));
  validateGrid96SourceComponentAuthority(authoritativeSource, equivalence);
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    authoritativeSourceIdentity: authoritativeSource.identity,
    sourceEquivalenceIdentity: equivalence.identity,
    sourceManifestPath,
    sourceManifestSha256: sha256(readFileSync(sourceManifestPath)),
    equivalenceManifestPath,
    equivalenceManifestSha256: sha256(readFileSync(equivalenceManifestPath)),
  };

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
  runtimeIdentity = await waitForRuntime(socket, timeoutMs);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, runtimeIdentity };
  assert.equal(runtimeIdentity.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'wrong effective route');
  assert.equal(runtimeIdentity.prototypeIdentity, 'kaminos-volume-prototype-v0', 'wrong prototype identity');
  assert.ok(String(runtimeIdentity.backend).startsWith('WebGPU'), 'wrong renderer backend');
  assert.equal(runtimeIdentity.grid, 96, 'runtime is not native Grid96');
  await delay(settleMs);
  let browserEventCursor = assertNoBrowserFailures(0, 'route admission');

  const state = await captureState({ stateId: STATE_ID, steps: stateSteps });
  browserEventCursor = assertNoBrowserFailures(browserEventCursor, STATE_ID);
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    completedStateIds: [state.id],
    retainedRows: state.rows.count,
  };

  failurePhase = 'producer-manifest';
  const producer = buildGrid96SourceComponentProducer({
    authoritativeSource,
    equivalence,
    requestedUrl,
    runtimeIdentity,
    replay: state.replay,
    sourceHashes: state.sourceHashes,
    rows: state.rows,
    causalControlIdentity: state.causalControlIdentity,
    producerProvenance: {
      tigerRuntimeCommit: TIGER_RUNTIME_COMMIT,
      importedModuleSha256: { ...IMPORTED_MODULE_SHA256 },
      targetCaptureStarted: false,
      trainingStarted: false,
      learnerInvoked: false,
    },
  });
  writeFileSync(producerManifestPath, `${JSON.stringify(producer, null, 2)}\n`);
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    producerManifestPath,
    producerManifestSha256: sha256(readFileSync(producerManifestPath)),
  };

  failurePhase = 'complete';
  writeReport({
    status: 'captured',
    failurePhase: null,
    lastTrustworthyEvidence,
    effectiveRoute: runtimeIdentity.effectiveRoute,
    prototypeIdentity: runtimeIdentity.prototypeIdentity,
    backend: runtimeIdentity.backend,
    stateCount: 1,
    retainedRowCount: state.rows.count,
    sampleCap: null,
    droppedRowCount: 0,
    targetCaptureStarted: false,
    trainingStarted: false,
    learnerInvoked: false,
  });
  console.log(JSON.stringify({
    status: 'captured',
    reportPath,
    producerManifestPath,
    stateCount: 1,
    retainedRowCount: state.rows.count,
  }, null, 2));
} catch (error) {
  writeFileSync(producerManifestPath, `${JSON.stringify({
    schema: PRODUCER_SCHEMA,
    status: 'failed',
    failurePhase,
    authority: WITNESS_IDENTITY,
    reason: error?.message || String(error),
    requestedRoute: requestedUrl,
    effectiveRoute: runtimeIdentity.effectiveRoute,
    backend: runtimeIdentity.backend,
    targetCaptureStarted: false,
    trainingStarted: false,
    learnerInvoked: false,
  }, null, 2)}\n`);
  writeReport({
    status: 'failed',
    failurePhase,
    reason: error?.message || String(error),
    lastTrustworthyEvidence,
    effectiveRoute: runtimeIdentity.effectiveRoute,
    prototypeIdentity: runtimeIdentity.prototypeIdentity,
    backend: runtimeIdentity.backend,
  });
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  socket?.close();
  browser?.kill('SIGTERM');
}

async function captureState({ stateId, steps }) {
  failurePhase = `${stateId}:coefficient-render-authority`;
  const coefficientRenderAuthority = await evaluate(
    socket,
    `${VOLUME_PROTOTYPE_EXPRESSION}.setSelectiveHeadLiveRenderComposition('raymarch-only-v0')`,
  );
  assert.equal(coefficientRenderAuthority?.requestedComposition, 'raymarch-only-v0', `${stateId} coefficient render request drifted`);
  assert.equal(coefficientRenderAuthority?.compositionFallbackReason ?? null, null, `${stateId} coefficient render composition fell back`);

  failurePhase = `${stateId}:deterministic-replay`;
  const replayStartTimeMs = 1000;
  const exactStateTimeMs = replayStartTimeMs + steps * (1000 / 60);
  const replay = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.sampleDeterministicReplayFrame(${JSON.stringify({
    steps,
    timeStepMs: 1000 / 60,
    startTimeMs: replayStartTimeMs,
    restoreControls: true,
  })})`);
  assert.equal(replay?.ok, true, `${stateId} replay failed: ${JSON.stringify(replay)}`);
  assert.equal(replay.completedSteps, steps, `${stateId} replay step count drifted`);
  assert.equal(replay.grid, runtimeIdentity.grid, `${stateId} replay grid drifted`);

  failurePhase = `${stateId}:freeze`;
  const frozen = await evaluate(socket, `(() => {
    const prototype = ${VOLUME_PROTOTYPE_EXPRESSION};
    prototype.setSelectiveHeadLiveCapturePaused(true);
    const state = prototype.debugState();
    return {
      active: state.active,
      capturePaused: state.selectiveHeadLiveCapturePaused,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      grid: state.simGrid,
      controls: state.controls,
      captureTimeMs: performance.now(),
      requestedRoute: state.requestedRoute,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
      selectiveHeadLiveCompositionRequested: state.selectiveHeadLiveCompositionRequested,
      selectiveHeadLiveCompositionEffective: state.selectiveHeadLiveCompositionEffective,
      selectiveHeadLiveCompositionAuthority: state.selectiveHeadLiveCompositionAuthority,
      selectiveHeadLiveCompositionFallbackReason: state.selectiveHeadLiveCompositionFallbackReason,
    };
  })()`);
  assert.equal(frozen.active, true, `${stateId} renderer became unavailable while freezing`);
  assert.equal(frozen.capturePaused, true, `${stateId} renderer loop did not pause`);
  assert.equal(frozen.selectiveHeadLiveCompositionRequested, 'raymarch-only-v0', `${stateId} frozen coefficient composition drifted`);
  assert.equal(frozen.selectiveHeadLiveCompositionEffective, 'raymarch-only-v0', `${stateId} frozen coefficient composition was not effective`);
  assert.equal(frozen.selectiveHeadLiveCompositionAuthority, 'diagnostic-raymarch-full-selected-field-authority-v0', `${stateId} frozen coefficient composition lacks full-fire authority`);
  assert.equal(frozen.selectiveHeadLiveCompositionFallbackReason ?? null, null, `${stateId} frozen coefficient composition used fallback`);
  const effectiveControls = causalControlsFromRuntime(frozen.controls);
  const controlIdentity = `sha256:${sha256(Buffer.from(canonicalJson(effectiveControls)))}`;

  failurePhase = `${stateId}:causal-controls`;
  const controlApplication = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.applyDebugNonRidgeCausalControls(${JSON.stringify(effectiveControls)})`);
  assert.equal(controlApplication?.ok, true, `${stateId} causal controls were substituted: ${JSON.stringify(controlApplication)}`);

  failurePhase = `${stateId}:source-basis-begin`;
  const sourceBasis = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.beginDebugNonRidgeSourceBasisCapture(${JSON.stringify({
    captureTimeMs: frozen.captureTimeMs,
  })})`);
  assert.equal(sourceBasis?.ok, true, `${stateId} source-basis capture failed: ${JSON.stringify(sourceBasis)}`);
  assert.equal(sourceBasis.rowCount, runtimeIdentity.grid ** 3, `${stateId} source-basis row count drifted`);
  assert.equal(sourceBasis.overflowCount, 0, `${stateId} source-basis capture overflowed`);

  const rows = await drainAnalyticalRows({ stateId, sourceBasis, effectiveControls });
  const coefficientRenderAuthorityReceipt = {
    requestedComposition: coefficientRenderAuthority.requestedComposition,
    effectiveComposition: frozen.selectiveHeadLiveCompositionEffective,
    compositionAuthority: frozen.selectiveHeadLiveCompositionAuthority,
    compositionFallbackReason: frozen.selectiveHeadLiveCompositionFallbackReason ?? null,
    routeIdentity: coefficientRenderAuthority.routeIdentity,
  };
  failurePhase = `${stateId}:source-basis-release`;
  const sourceRelease = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.releaseDebugNonRidgeSourceBasisCapture(${JSON.stringify({
    sessionId: sourceBasis.sessionId,
  })})`);
  assert.equal(sourceRelease?.ok, true, `${stateId} source-basis release failed`);

  failurePhase = `${stateId}:full-field-export-begin`;
  const fullField = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.beginDebugFullFieldExport({})`);
  assert.equal(fullField?.ok, true, `${stateId} full-field export failed: ${JSON.stringify(fullField)}`);
  assert.equal(fullField.completeFieldCoverage, true, `${stateId} full-field export is partial`);
  assert.equal(fullField.grid, runtimeIdentity.grid, `${stateId} full-field grid drifted`);
  const sourceFieldManifest = await drainFullField({ stateId, fullField });

  failurePhase = `${stateId}:full-field-import-begin`;
  const importBegin = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.beginDebugFullFieldImport(${JSON.stringify({
    grid: sourceFieldManifest.grid,
    initializationAuthority: LIVE_REPLAY_AUTHORITY,
    filterIdentity: LIVE_REPLAY_FILTER,
    layoutIdentity: FIELD_LAYOUT_IDENTITY,
    sourceManifestPath: sourceFieldManifest.artifact.path,
    sourceManifestSha256: sourceFieldManifest.artifact.sha256,
    source: { identity: stateId, authority: 'same-state-coefficient-descriptor-capture-v0' },
    receiverInitialSimStepCount: frozen.simStepCount,
    fluid: sourceFieldManifest.sidecars.fluid,
    front: sourceFieldManifest.sidecars.front,
  })})`);
  assert.equal(importBegin?.ok, true, `${stateId} full-field import failed to begin: ${JSON.stringify(importBegin)}`);
  await uploadField(importBegin.sessionId, 'fluid', sourceFieldManifest.sidecars.fluid);
  await uploadField(importBegin.sessionId, 'front', sourceFieldManifest.sidecars.front);
  failurePhase = `${stateId}:full-field-import-finish`;
  const importFinish = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.finishDebugFullFieldImport(${JSON.stringify({
    sessionId: importBegin.sessionId,
  })})`);
  assert.equal(importFinish?.ok, true, `${stateId} full-field import failed: ${JSON.stringify(importFinish)}`);
  assert.equal(importFinish.status, 'applied', `${stateId} full-field import was not applied`);
  assert.equal(importFinish.fluidSha256, sourceFieldManifest.sidecars.fluid.sha256, `${stateId} fluid checksum drifted on import`);
  assert.equal(importFinish.frontSha256, sourceFieldManifest.sidecars.front.sha256, `${stateId} front checksum drifted on import`);

  failurePhase = `${stateId}:descriptor-index-upload`;
  const indexReceipt = await uploadDescriptorIndices(rows.nativeCellIndices, runtimeIdentity.grid);

  failurePhase = `${stateId}:descriptor-render`;
  const descriptorRender = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.renderFrozenScaleToCanvas(${JSON.stringify({
    fullFieldImportSessionId: importFinish.sessionId,
    renderScale: 1,
    boundarySplatComposition: 'splat-only-v0',
    controlOverrides: {
      boundarySplatMode: 'learned',
      flowKernelDescriptorCapture: true,
      flowKernelStrength: DESCRIPTOR_CONTROLS.strength,
      flowKernelRadius: DESCRIPTOR_CONTROLS.radiusWorld,
      flowKernelCoherence: DESCRIPTOR_CONTROLS.coherence,
    },
    now: exactStateTimeMs,
    sameStateCaptureId: stateId,
  })})`);
  assert.equal(descriptorRender?.ok, true, `${stateId} descriptor render failed: ${JSON.stringify(descriptorRender)}`);
  assert.equal(descriptorRender.flowKernelDescriptorCaptureRequested, true, `${stateId} descriptor capture was not requested effectively`);
  assert.ok(descriptorRender.flowKernelDescriptorCapture, `${stateId} descriptor capture is missing`);
  const kernelDescriptors = await drainDescriptorCapture({
    stateId,
    capture: descriptorRender.flowKernelDescriptorCapture,
    rows,
    sourceFieldManifest,
    indexReceipt,
  });

  failurePhase = `${stateId}:live-resume`;
  const resume = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.resumeDebugImportedFieldLive(${JSON.stringify({
    sessionId: importFinish.sessionId,
  })})`);
  assert.equal(resume?.ok, true, `${stateId} imported field did not resume: ${JSON.stringify(resume)}`);
  await delay(100);

  return {
    id: stateId,
    sameStateCaptureId: stateId,
    sourceFieldManifest: sourceFieldManifest.artifact,
    sourceHashes: {
      fluidSha256: sourceFieldManifest.sidecars.fluid.sha256,
      frontSha256: sourceFieldManifest.sidecars.front.sha256,
      boundarySidecarSha256: sourceFieldManifest.boundarySidecar.sidecars.boundary.sha256,
      majorantSha256: sourceFieldManifest.sidecars.majorant.sha256,
    },
    causalControlIdentity: controlIdentity,
    replay,
    rows: {
      count: rows.count,
      sourceRowCount: rows.sourceRowCount,
      sampleCap: null,
      droppedRowCount: 0,
      overflowCount: sourceBasis.overflowCount,
      features: rows.features,
      admission: rows.admission,
      nativeCellIndices: rows.nativeCellIndices,
      coefficients: rows.coefficients,
      kernelDescriptors,
      coefficientRenderAuthority: coefficientRenderAuthorityReceipt,
    },
  };
}

async function drainAnalyticalRows({ stateId, sourceBasis, effectiveControls }) {
  const sinks = {
    features: new ArtifactSink(join(artifactsDir, `${stateId}-features.f32`), {
      dtype: 'float32-le', semanticRole: 'post-admission-local-features',
    }),
    admission: new ArtifactSink(join(artifactsDir, `${stateId}-admission.f32`), {
      dtype: 'float32-le', semanticRole: 'analytical-ridge-or-nonridge-admission',
    }),
    nativeCellIndices: new ArtifactSink(join(artifactsDir, `${stateId}-native-cell-indices.u32`), {
      dtype: 'uint32-le', semanticRole: 'analytical-admission-native-cell-indices',
    }),
    coefficients: new ArtifactSink(join(artifactsDir, `${stateId}-coefficients.f32`), {
      dtype: 'float32-le', semanticRole: 'exact-local-layer-emission-extinction',
    }),
  };
  let startFloat = 0;
  let sourceRowCount = 0;
  let retainedCount = 0;
  const coefficientPopulation = emptyLayerCoefficientPopulation();
  while (startFloat < sourceBasis.rowCount * SOURCE_BASIS_GPU_ROW_FLOATS) {
    const requestedFloatCount = Math.min(
      chunkRows * SOURCE_BASIS_GPU_ROW_FLOATS,
      sourceBasis.rowCount * SOURCE_BASIS_GPU_ROW_FLOATS - startFloat,
    );
    const chunk = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.readDebugNonRidgeSourceBasisCaptureChunk(${JSON.stringify({
      sessionId: sourceBasis.sessionId,
      startFloat,
      floatCount: requestedFloatCount,
    })})`);
    assert.equal(chunk?.ok, true, `${stateId} source-basis chunk failed at ${startFloat}`);
    assert.equal(chunk.startFloat, startFloat, `${stateId} source-basis chunk offset drifted`);
    assert.equal(chunk.floatCount % SOURCE_BASIS_GPU_ROW_FLOATS, 0, `${stateId} source-basis chunk split a row`);
    const bytes = Buffer.from(chunk.base64, 'base64');
    assert.equal(bytes.byteLength, chunk.floatCount * Float32Array.BYTES_PER_ELEMENT, `${stateId} source-basis chunk byte length drifted`);
    const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
    const selected = selectAnalyticalLayerRows({
      fullGridRows: values,
      effectiveControls,
      nativeCellIndexOffset: startFloat / SOURCE_BASIS_GPU_ROW_FLOATS,
    });
    mergeLayerCoefficientPopulation(coefficientPopulation, summarizeLayerCoefficientPopulation({
      coefficients: selected.coefficients,
      admission: selected.admission,
    }));
    sinks.features.write(f32Bytes(selected.features));
    sinks.admission.write(f32Bytes(selected.admission));
    sinks.nativeCellIndices.write(u32Bytes(selected.nativeCellIndices));
    sinks.coefficients.write(f32Bytes(selected.coefficients));
    sourceRowCount += selected.sourceRowCount;
    retainedCount += selected.count;
    startFloat += chunk.floatCount;
  }
  assert.equal(sourceRowCount, sourceBasis.rowCount, `${stateId} did not drain the full source grid`);
  assert.ok(retainedCount > 0, `${stateId} analytical admission retained zero rows`);
  assertLayerCoefficientPopulation(coefficientPopulation);
  const nativeCellIndices = sinks.nativeCellIndices.close([retainedCount]);
  return {
    count: retainedCount,
    sourceRowCount,
    sampleCap: null,
    droppedRowCount: 0,
    features: sinks.features.close([retainedCount, POST_ADMISSION_FEATURE_ORDER.length]),
    admission: sinks.admission.close([retainedCount, ANALYTICAL_ADMISSION_ORDER.length]),
    nativeCellIndices,
    coefficients: sinks.coefficients.close([retainedCount, COEFFICIENT_ORDER.length], {
      nativeCellIndexSha256: nativeCellIndices.sha256,
      rowOrderIdentity: 'caller-ordered-native-cell-index-v0',
      coefficientPopulation,
    }),
  };
}

async function drainFullField({ stateId, fullField }) {
  const descriptors = {
    fluid: fullField.fluid,
    front: fullField.front,
    boundary: fullField.boundarySidecar?.sidecars?.boundary,
    majorant: fullField.majorant,
  };
  const sidecars = {};
  for (const [kind, descriptor] of Object.entries(descriptors)) {
    assert.ok(descriptor?.floatCount > 0 && descriptor?.byteLength > 0, `${stateId} ${kind} descriptor is missing`);
    const sink = new ArtifactSink(join(artifactsDir, `${stateId}-${kind}.f32`), {
      dtype: 'float32', semanticRole: `full-field-${kind}`,
    });
    for (let startFloat = 0; startFloat < descriptor.floatCount; startFloat += chunkFloats) {
      const floatCount = Math.min(chunkFloats, descriptor.floatCount - startFloat);
      const chunk = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.readDebugFullFieldExportChunk(${JSON.stringify({
        sessionId: fullField.sessionId,
        kind,
        startFloat,
        floatCount,
      })})`);
      assert.equal(chunk?.ok, true, `${stateId} ${kind} chunk failed at ${startFloat}`);
      assert.equal(chunk.startFloat, startFloat, `${stateId} ${kind} chunk offset drifted`);
      const bytes = Buffer.from(chunk.base64, 'base64');
      assert.equal(bytes.byteLength, floatCount * Float32Array.BYTES_PER_ELEMENT, `${stateId} ${kind} chunk byte length drifted`);
      sink.write(bytes);
    }
    sidecars[kind] = sink.close(descriptor.shape, {
      byteLength: descriptor.byteLength,
      floatCount: descriptor.floatCount,
      byteOrder: descriptor.byteOrder,
      channelOrder: descriptor.channelOrder,
    });
    assert.equal(sidecars[kind].bytes, descriptor.byteLength, `${stateId} ${kind} artifact is partial`);
  }
  const release = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.releaseDebugFullFieldExport(${JSON.stringify({
    sessionId: fullField.sessionId,
  })})`);
  assert.equal(release?.ok, true, `${stateId} full-field export release failed`);

  const manifest = {
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'full-grid-fluid-front-boundary-sidecars-v0',
    status: 'captured',
    failurePhase: null,
    completeFieldCoverage: true,
    routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
    effectiveRoute: fullField.effectiveRoute,
    prototypeIdentity: fullField.prototypeIdentity,
    backend: fullField.backend,
    grid: fullField.grid,
    cellCount: fullField.cellCount,
    majorantGrid: fullField.majorantGrid,
    fluidComponents: fullField.fluidComponents,
    fluidChannelOrder: fullField.fluidChannelOrder,
    frontChannelOrder: fullField.frontChannelOrder,
    deterministicReplay: fullField.deterministicReplay,
    sidecars: {
      fluid: sidecars.fluid,
      front: sidecars.front,
      majorant: sidecars.majorant,
    },
    boundarySidecar: { sidecars: { boundary: sidecars.boundary } },
  };
  const path = join(artifactsDir, `${stateId}-source-field-manifest.json`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.artifact = {
    path,
    bytes: statSync(path).size,
    sha256: sha256(readFileSync(path)),
  };
  return manifest;
}

async function uploadField(sessionId, kind, artifact) {
  failurePhase = `${sessionId}:upload-${kind}`;
  const bytes = readFileSync(artifact.path);
  const chunkBytes = chunkFloats * Float32Array.BYTES_PER_ELEMENT;
  let byteOffset = 0;
  while (byteOffset < bytes.byteLength) {
    const chunk = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + chunkBytes));
    const receipt = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.writeDebugFullFieldImportChunk(${JSON.stringify({
      sessionId,
      kind,
      byteOffset,
      base64: chunk.toString('base64'),
    })})`);
    assert.equal(receipt?.ok, true, `${kind} import chunk failed at ${byteOffset}`);
    assert.equal(receipt.byteOffset, byteOffset, `${kind} import chunk offset drifted`);
    byteOffset += chunk.byteLength;
  }
}

async function uploadDescriptorIndices(artifact, grid) {
  const bytes = readFileSync(artifact.path);
  const begin = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.beginFlowKernelDescriptorIndexUpload(${JSON.stringify({
    grid,
    count: artifact.shape[0],
    byteLength: bytes.byteLength,
    indexSha256: artifact.sha256,
    duplicatePolicy: 'forbidden',
    orderIdentity: 'caller-ordered',
  })})`);
  assert.equal(begin?.ok, true, `descriptor index upload did not begin: ${JSON.stringify(begin)}`);
  let byteOffset = 0;
  const chunkBytes = chunkFloats * Uint32Array.BYTES_PER_ELEMENT;
  while (byteOffset < bytes.byteLength) {
    const chunk = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + chunkBytes));
    const receipt = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.writeFlowKernelDescriptorIndexUploadChunk(${JSON.stringify({
      sessionId: begin.sessionId,
      byteOffset,
      base64: chunk.toString('base64'),
    })})`);
    assert.equal(receipt?.ok, true, `descriptor index chunk failed at ${byteOffset}`);
    assert.equal(receipt.byteOffset, byteOffset, 'descriptor index chunk offset drifted');
    byteOffset += chunk.byteLength;
  }
  const finish = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.finishFlowKernelDescriptorIndexUpload(${JSON.stringify({
    sessionId: begin.sessionId,
  })})`);
  assert.equal(finish?.ok, true, `descriptor index upload failed: ${JSON.stringify(finish)}`);
  assert.equal(finish.status, 'applied', 'descriptor index upload was not applied');
  assert.equal(finish.indexSha256, artifact.sha256, 'descriptor index checksum drifted');
  assert.equal(finish.count, artifact.shape[0], 'descriptor index count drifted');
  return finish;
}

async function drainDescriptorCapture({ stateId, capture, rows, sourceFieldManifest, indexReceipt }) {
  assert.equal(capture.identity, FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY, `${stateId} descriptor socket identity drifted`);
  assert.equal(capture.rowCount, rows.count, `${stateId} descriptor row count differs from analytical admission`);
  assert.equal(capture.strideFloats, FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS, `${stateId} descriptor stride drifted`);
  assert.deepEqual(capture.descriptorOrder, [...FLOW_KERNEL_DESCRIPTOR_ORDER], `${stateId} descriptor order drifted`);
  const expectedHashes = {
    fluidSha256: sourceFieldManifest.sidecars.fluid.sha256,
    frontSha256: sourceFieldManifest.sidecars.front.sha256,
    boundarySidecarSha256: sourceFieldManifest.boundarySidecar.sidecars.boundary.sha256,
    majorantSha256: sourceFieldManifest.sidecars.majorant.sha256,
  };
  assert.deepEqual(capture.sourceHashes, expectedHashes, `${stateId} descriptor source hashes differ from coefficient state`);
  const session = capture.exportSession;
  assert.equal(session?.identity, 'session-bound-float32-chunk-export-v0', `${stateId} descriptor export session is missing`);
  if (motionCapture) {
    assert.equal(session.projectionChunkApi, 'readFlowKernelDescriptorCaptureProjectionChunk', `${stateId} compact descriptor projection API is missing`);
    const sink = new ArtifactSink(join(artifactsDir, `${stateId}-kernel-descriptor-projection.f32`), {
      dtype: 'float32-le', semanticRole: 'camera-independent-flow-kernel-descriptor-projection',
    });
    const indexBytes = readFileSync(rows.nativeCellIndices.path);
    const expectedIndices = new Uint32Array(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength / Uint32Array.BYTES_PER_ELEMENT);
    for (let startRow = 0; startRow < rows.count; startRow += chunkRows) {
      const rowCount = Math.min(chunkRows, rows.count - startRow);
      const chunk = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.readFlowKernelDescriptorCaptureProjectionChunk(${JSON.stringify({
        sessionId: session.sessionId,
        startRow,
        rowCount,
        columns: MOTION_DESCRIPTOR_COLUMNS,
      })})`);
      assert.equal(chunk?.ok, true, `${stateId} descriptor projection failed at row ${startRow}`);
      assert.equal(chunk.startRow, startRow, `${stateId} descriptor projection row offset drifted`);
      assert.equal(chunk.rowCount, rowCount, `${stateId} descriptor projection row count drifted`);
      assert.deepEqual(chunk.columns, [...MOTION_DESCRIPTOR_COLUMNS], `${stateId} descriptor projection columns drifted`);
      assert.deepEqual(chunk.columnNames, [...MOTION_DESCRIPTOR_ORDER], `${stateId} descriptor projection names drifted`);
      assert.equal(chunk.descriptorSha256, capture.descriptorSha256, `${stateId} descriptor projection source hash drifted`);
      const bytes = Buffer.from(chunk.base64, 'base64');
      assert.equal(bytes.byteLength, rowCount * MOTION_DESCRIPTOR_COLUMNS.length * Float32Array.BYTES_PER_ELEMENT, `${stateId} descriptor projection byte length drifted`);
      const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
      for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
        assert.equal(Math.round(values[rowOffset * MOTION_DESCRIPTOR_COLUMNS.length + 3]), expectedIndices[startRow + rowOffset], `${stateId} projected native identity drifted at row ${startRow + rowOffset}`);
      }
      sink.write(bytes);
    }
    const artifact = sink.close([rows.count, MOTION_DESCRIPTOR_COLUMNS.length], {
      socketIdentity: FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
      sourceDescriptorSha256: capture.descriptorSha256,
      sourceStrideFloats: FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
      projectionIdentity: 'session-bound-float32-column-projection-chunk-export-v0',
      projectionColumns: [...MOTION_DESCRIPTOR_COLUMNS],
      descriptorOrder: [...MOTION_DESCRIPTOR_ORDER],
      kernelIdentity: DESCRIPTOR_KERNEL_IDENTITY,
      requestedControls: { ...DESCRIPTOR_CONTROLS },
      effectiveControls: { ...DESCRIPTOR_CONTROLS },
      sourceHashes: expectedHashes,
      candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
      admissionIndexSha256: rows.nativeCellIndices.sha256,
      admissionIdentity: ANALYTICAL_ADMISSION_IDENTITY,
    });
    const release = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.releaseFlowKernelDescriptorCapture(${JSON.stringify({
      sessionId: session.sessionId,
    })})`);
    assert.equal(release?.ok, true, `${stateId} descriptor projection release failed`);
    assert.equal(release.descriptorSha256, capture.descriptorSha256, `${stateId} descriptor projection release hash drifted`);
    return artifact;
  }
  const sink = new ArtifactSink(join(artifactsDir, `${stateId}-kernel-descriptors.f32`), {
    dtype: 'float32-le', semanticRole: 'camera-independent-flow-kernel-descriptors',
  });
  for (let startFloat = 0; startFloat < session.floatCount; startFloat += chunkFloats) {
    const floatCount = Math.min(chunkFloats, session.floatCount - startFloat);
    const chunk = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.readFlowKernelDescriptorCaptureChunk(${JSON.stringify({
      sessionId: session.sessionId,
      startFloat,
      floatCount,
    })})`);
    assert.equal(chunk?.ok, true, `${stateId} descriptor chunk failed at ${startFloat}`);
    assert.equal(chunk.startFloat, startFloat, `${stateId} descriptor chunk offset drifted`);
    const bytes = Buffer.from(chunk.base64, 'base64');
    assert.equal(bytes.byteLength, floatCount * Float32Array.BYTES_PER_ELEMENT, `${stateId} descriptor chunk byte length drifted`);
    sink.write(bytes);
  }
  const artifact = sink.close([rows.count, FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS], {
    socketIdentity: FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
    strideFloats: FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
    descriptorOrder: [...FLOW_KERNEL_DESCRIPTOR_ORDER],
    kernelIdentity: DESCRIPTOR_KERNEL_IDENTITY,
    requestedControls: { ...DESCRIPTOR_CONTROLS },
    effectiveControls: { ...DESCRIPTOR_CONTROLS },
    sourceHashes: expectedHashes,
    sourceManifestSha256: sourceFieldManifest.artifact.sha256,
    candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
    admissionIndexAuthority: {
      identity: 'external-native-cell-index-list-v0',
      indexSha256: rows.nativeCellIndices.sha256,
      count: rows.count,
      byteLength: rows.nativeCellIndices.bytes,
      duplicatePolicy: 'forbidden',
      orderIdentity: 'caller-ordered',
      runtimeReceipt: indexReceipt,
    },
    admissionIdentity: ANALYTICAL_ADMISSION_IDENTITY,
    admissionArtifactSha256: rows.admission.sha256,
  });
  assert.equal(artifact.sha256, capture.descriptorSha256, `${stateId} descriptor checksum drifted`);
  const release = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.releaseFlowKernelDescriptorCapture(${JSON.stringify({
    sessionId: session.sessionId,
  })})`);
  assert.equal(release?.ok, true, `${stateId} descriptor export release failed`);
  assert.equal(release.descriptorSha256, artifact.sha256, `${stateId} descriptor release checksum drifted`);
  return artifact;
}

function releaseTransientSourceFields(sourceFieldManifest) {
  const paths = [
    sourceFieldManifest.sidecars.fluid.path,
    sourceFieldManifest.sidecars.front.path,
    sourceFieldManifest.sidecars.majorant.path,
    sourceFieldManifest.boundarySidecar.sidecars.boundary.path,
    sourceFieldManifest.artifact.path,
  ];
  for (const path of paths) unlinkSync(path);
  return {
    identity: 'checksum-bound-transient-full-field-deletion-v0',
    deleted: true,
    deletedArtifactCount: paths.length,
    sourceManifestSha256: sourceFieldManifest.artifact.sha256,
    sourceHashes: {
      fluidSha256: sourceFieldManifest.sidecars.fluid.sha256,
      frontSha256: sourceFieldManifest.sidecars.front.sha256,
      boundarySidecarSha256: sourceFieldManifest.boundarySidecar.sidecars.boundary.sha256,
      majorantSha256: sourceFieldManifest.sidecars.majorant.sha256,
    },
  };
}

function buildTrainingManifest({ states, sourceAppearanceCorpus }) {
  const descriptorSocketBytes = readFileSync(descriptorSocketPath);
  const retainedRowCount = states.reduce((total, state) => total + state.rows.count, 0);
  const body = {
    schema: TRAINING_SCHEMA,
    status: 'complete',
    authority: 'analytical-ridge-or-nonridge-admission-plus-exact-local-coefficients-v0',
    sourceAppearanceCorpus: sourceAppearanceCorpus.receipt,
    route: {
      requested: requestedUrl,
      effective: runtimeIdentity.effectiveRoute,
      prototypeIdentity: runtimeIdentity.prototypeIdentity,
      backend: runtimeIdentity.backend,
      fallbackReason: null,
    },
    cohort: {
      identity: 'layer-coefficient-cohort-v0',
      retainedStateCount: states.length,
      retainedRowCount,
      droppedRowCount: 0,
      sampleCap: null,
    },
    featureView: {
      identity: 'post-admission-source-complete-local-features-v0',
      order: [...POST_ADMISSION_FEATURE_ORDER],
    },
    admission: {
      identity: ANALYTICAL_ADMISSION_IDENTITY,
      authority: ANALYTICAL_ADMISSION_AUTHORITY,
      order: [...ANALYTICAL_ADMISSION_ORDER],
      rowPolicy: 'only-analytically-admitted-candidates-v0',
    },
    coefficientTargets: {
      identity: 'separate-nonnegative-ridge-and-nonridge-local-coefficients-v0',
      coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
      order: [...COEFFICIENT_ORDER],
      outputTransform: 'softplus-nonnegative-output-v0',
    },
    footprint: {
      identity: 'support-gradient-oriented-tangent-plane-diagonal-covariance-v0',
      authority: 'analytical-view-independent-post-admission-footprint-v0',
      learnedByCoefficientModel: false,
    },
    descriptorComparison: {
      identity: 'matched-capacity-post-admission-kernel-descriptor-ablation-v0',
      selectionPolicy: 'forward-causal-ablation-smallest-held-gain-subset-v0',
      capacityMatch: {
        identity: 'equal-trainable-parameter-count-v0',
        baselineTrainableParameters: 8192,
        treatmentTrainableParameters: 8192,
      },
      producer: {
        identity: FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
        socketModule: {
          path: descriptorSocketPath,
          bytes: descriptorSocketBytes.byteLength,
          sha256: sha256(descriptorSocketBytes),
        },
        strideFloats: FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
        descriptorOrder: [...FLOW_KERNEL_DESCRIPTOR_ORDER],
        kernelIdentity: DESCRIPTOR_KERNEL_IDENTITY,
        candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
        requestedRoute: requestedUrl,
        effectiveRoute: runtimeIdentity.effectiveRoute,
        prototypeIdentity: runtimeIdentity.prototypeIdentity,
        backend: runtimeIdentity.backend,
        grid: runtimeIdentity.grid,
        fallbackReason: null,
        requestedControls: { ...DESCRIPTOR_CONTROLS },
        effectiveControls: { ...DESCRIPTOR_CONTROLS },
        cameraIndependent: true,
        literalTapsExposed: false,
        strengthZeroIdentity: 'raw-source-field-identity-v0',
        validityPolicy: 'conservative-support-validity-majorant-v0',
      },
      baseline: {
        identity: 'current-features-plus-analytical-world-covariance-v0',
        featureViewIdentity: 'post-admission-source-complete-local-features-v0',
        footprintIdentity: 'support-gradient-oriented-tangent-plane-diagonal-covariance-v0',
      },
      treatment: {
        identity: 'current-features-plus-smallest-causal-kernel-descriptor-subset-v0',
        descriptorAuthority: 'camera-independent-flow-kernel-descriptors-v0',
        order: [...DESCRIPTOR_TREATMENT_ORDER],
        supportPredicted: false,
        footprintPredicted: false,
        cameraConditioned: false,
        beautyConditioned: false,
      },
      analyticalGeometryArm: {
        identity: 'kernel-moment-analytical-geometry-v0',
        status: 'gated-on-held-descriptor-signal',
        learnedGeometry: false,
        promotionGate: 'arm-two-held-post-admission-gain-v0',
      },
    },
    transportEvaluation: {
      identity: 'one-shared-total-transmittance-v0',
      orderPolicy: 'global-order-one-stream-v0',
      contributionPolicy: 'separate-premultiplied-layer-contributions-under-shared-transmittance-v0',
      independentlyRenderedToneMappedImageAdditivity: false,
    },
    splits: {
      identity: SPLIT_IDENTITY,
      train: { stateIds: states.filter(state => state.splitRole === 'train').map(state => state.id) },
      heldOut: { stateIds: states.filter(state => state.splitRole === 'heldOut').map(state => state.id) },
    },
    states,
  };
  return { ...body, identity: `sha256:${sha256(Buffer.from(canonicalJson(body)))}` };
}

function buildMotionManifest({ states, fixedCameraPose }) {
  const controlIdentities = new Set(states.map(state => state.requestedControlIdentity));
  assert.equal(controlIdentities.size, 1, 'motion sequence changed causal controls between exact states');
  const [trajectoryControlIdentity] = controlIdentities;
  const body = {
    schema: 'kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0',
    status: 'complete',
    authority: 'single-browser-multi-state-exact-bilinear-motion-v0',
    route: {
      requested: requestedUrl,
      effective: runtimeIdentity.effectiveRoute,
      prototypeIdentity: runtimeIdentity.prototypeIdentity,
      backend: runtimeIdentity.backend,
      fallbackReason: null,
    },
    sequence: {
      identity: 'single-browser-multi-state-exact-bilinear-motion-v0',
      trajectoryAuthority: 'adjacent-exact-state-one-trajectory-v0',
      replayStartTimeMs: 1000,
      stateSteps: [...stateSteps],
      stateCount: states.length,
      targetMode: MOTION_TARGET_MODE,
      targetIdentity: MOTION_TARGET_IDENTITY,
      targetRaySteps,
      fixedCameraAuthority: 'fixed-held-camera-across-consecutive-states-v0',
      fixedCameraPose,
      fixedCameraPoseSha256: sha256(Buffer.from(canonicalJson(fixedCameraPose))),
      trajectoryControlIdentity,
      sampleCap: null,
      droppedRowCount: 0,
    },
    featureView: {
      identity: 'post-admission-source-complete-local-features-v0',
      order: [...POST_ADMISSION_FEATURE_ORDER],
    },
    coefficientTargets: {
      identity: 'separate-nonnegative-ridge-and-nonridge-local-coefficients-v0',
      order: [...COEFFICIENT_ORDER],
    },
    descriptorProjection: {
      identity: 'session-bound-float32-column-projection-chunk-export-v0',
      sourceSocketIdentity: FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
      sourceStrideFloats: FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
      columns: [...MOTION_DESCRIPTOR_COLUMNS],
      order: [...MOTION_DESCRIPTOR_ORDER],
      kernelIdentity: DESCRIPTOR_KERNEL_IDENTITY,
    },
    transportEvaluation: {
      identity: 'one-shared-total-transmittance-v0',
      depthBins: 96,
      footprint: 'five-tap-flow-tangent-bilinear-v0',
      globalPathScale: 'fit-on-final-designated-state-once-v0',
      perStateRefit: false,
    },
    states,
  };
  return { ...body, identity: `sha256:${sha256(Buffer.from(canonicalJson(body)))}` };
}

function readSourceAppearanceCorpus() {
  const bytes = readFileSync(sourceAppearanceCorpusPath);
  const corpus = JSON.parse(bytes.toString('utf8'));
  assert.equal(corpus.schema, 'kaminos-boundary-splat-appearance-coefficient-corpus-v1', 'source appearance corpus schema drifted');
  assert.equal(
    corpus.authority,
    'live-simulator-frozen-state-multi-camera-positive-full-flame-coefficients-with-signed-comparator-v1',
    'source appearance corpus authority drifted',
  );
  assert.equal(corpus.fallbackReason, null, 'source appearance corpus used fallback evidence');
  assert.ok(Number.isInteger(corpus.grid) && corpus.grid > 0, 'source appearance corpus grid is missing');
  return {
    corpus,
    receipt: {
      path: sourceAppearanceCorpusPath,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      schema: corpus.schema,
      authority: corpus.authority,
      expectedGrid: corpus.grid,
      expectedRaySteps: 160,
      expectedRenderScale: 1,
    },
  };
}

function causalControlsFromRuntime(controls) {
  return Object.fromEntries(CAUSAL_CONTROL_FIELDS.map(field => {
    const nested = field.nested.reduce((value, key) => value?.[key], controls);
    const value = Number(nested ?? controls?.[field.key]);
    assert.ok(Number.isFinite(value), `runtime omitted causal control ${field.name}`);
    return [field.name, value];
  }));
}

function validateArguments() {
  assert.ok(requestedUrl, '--url is required');
  const route = new URL(requestedUrl);
  assert.equal(route.hostname, '127.0.0.1', 'witness route must be caller-owned localhost');
  assert.equal(stateSteps, 120, 'source component producer must capture exact state 120');
  assert.ok(sourceManifestPath, '--source-manifest is required');
  assert.ok(equivalenceManifestPath, '--equivalence-manifest is required');
  assert.ok(statSync(sourceManifestPath).isFile(), 'source manifest is missing');
  assert.ok(statSync(equivalenceManifestPath).isFile(), 'equivalence manifest is missing');
  assert.ok(Number.isInteger(chunkRows) && chunkRows > 0, 'chunk rows must be a positive integer');
  assert.ok(Number.isInteger(chunkFloats) && chunkFloats > 0, 'chunk floats must be a positive integer');
  assert.ok(Number.isInteger(viewportWidth) && viewportWidth >= 128, 'viewport width must be at least 128');
  assert.ok(Number.isInteger(viewportHeight) && viewportHeight >= 128, 'viewport height must be at least 128');
  assert.equal(
    FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
    REVIEWED_DESCRIPTOR_SOCKET_IDENTITY,
    'descriptor socket module differs from the reviewed ABI identity',
  );
}

function validateImportedModuleBytes() {
  for (const [role, path] of Object.entries(importedModulePaths)) {
    assert.equal(sha256(readFileSync(path)), IMPORTED_MODULE_SHA256[role], `${role} imported module bytes drifted`);
  }
}

function assertNoBrowserFailures(startIndex, label) {
  const events = socket?.browserEvents || [];
  const failures = events.slice(startIndex).filter(event => {
    if (event.method === 'Runtime.exceptionThrown') return true;
    if (event.method === 'Log.entryAdded') return ['error', 'assert'].includes(event.params?.entry?.level);
    if (event.method === 'Runtime.consoleAPICalled') return ['error', 'assert'].includes(event.params?.type);
    return false;
  });
  assert.equal(
    failures.length,
    0,
    `${label} emitted browser failures: ${JSON.stringify(failures.map(summarizeBrowserEvent))}`,
  );
  return events.length;
}

function writeReport(payload) {
  writeFileSync(reportPath, `${JSON.stringify({
    schema: 'kaminos.volume.grid96-source-component-capture-report.v0',
    identity: WITNESS_IDENTITY,
    requestedRoute: requestedUrl,
    ...payload,
    browserEvents: (socket?.browserEvents || []).slice(-40).map(summarizeBrowserEvent),
  }, null, 2)}\n`);
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

function f32Bytes(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function u32Bytes(values) {
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
      const prototype = ${VOLUME_PROTOTYPE_EXPRESSION};
      const state = prototype?.debugState?.();
      return {
        active: state?.active === true,
        requestedRoute: state?.requestedRoute || null,
        effectiveRoute: state?.effectiveRoute || null,
        prototypeIdentity: state?.prototypeIdentity || null,
        backend: state?.backend || null,
        grid: state?.simGrid || null,
        frameCount: state?.frameCount || 0,
        error: state?.error || null,
        requiredApis: Boolean(
          prototype?.sampleDeterministicReplayFrame
          && prototype?.applyDebugNonRidgeCausalControls
          && prototype?.beginDebugNonRidgeSourceBasisCapture
          && prototype?.beginDebugFullFieldExport
          && prototype?.beginDebugFullFieldImport
          && prototype?.beginFlowKernelDescriptorIndexUpload
          && prototype?.renderFrozenScaleToCanvas
          && prototype?.resumeDebugImportedFieldLive
        ),
      };
    })()`);
    if (last?.error) throw new Error(`renderer route failed: ${last.error}`);
    if (last?.active && last?.requiredApis && String(last.backend).startsWith('WebGPU') && last.frameCount > 3) return last;
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
  return {
    method: event.method,
    type: event.params?.type || null,
    args: (event.params?.args || []).map(argument => argument.value ?? argument.description ?? null),
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}

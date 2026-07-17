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
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

const WITNESS_IDENTITY = 'single-browser-multi-state-layer-coefficient-capture-v0';
const TRAINING_SCHEMA = 'kaminos.volume.layer-coefficient-training-manifest.v0';
const SPLIT_IDENTITY = 'whole-simulator-state-holdout-v0';
const REVIEWED_DESCRIPTOR_SOCKET_IDENTITY = 'flow-kernel-local-descriptor-socket-v0';
const LIVE_REPLAY_AUTHORITY = 'checksum-addressed-live-replay-resume-v0';
const LIVE_REPLAY_FILTER = 'exact-field-live-replay-application-v0';
const FIELD_LAYOUT_IDENTITY = 'fluid-front-grid-x-fastest-y-then-z-f32-v0';
const DESCRIPTOR_KERNEL_IDENTITY = 'flow-tangent-positive-symmetric-trilinear-v0';
const DESCRIPTOR_CONTROLS = Object.freeze({ strength: 0.6, radiusWorld: 0.018, coherence: 0.7 });
const DESCRIPTOR_TREATMENT_ORDER = Object.freeze([
  'flow.coherence',
  'flow.curlMagnitude',
  'flow.divergence',
  'flow.curlActivity',
  'validity.conservativeMajorant',
  'majorant.fire',
  'majorant.extinction',
]);
const DEFAULT_APPEARANCE_CORPUS = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-positive-full-flame-appearance-r11-streamed/appearance-corpus.json';
const VOLUME_PROTOTYPE_EXPRESSION = `(window.__kaminosVolumePrototype || document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype)`;

const args = parseArgs(process.argv.slice(2));
const requestedUrl = args.get('--url') && args.get('--url') !== true ? String(args.get('--url')) : null;
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-layer-coefficient-corpus'));
const artifactsDir = join(outDir, 'artifacts');
const reportPath = resolve(String(args.get('--report') || join(outDir, 'capture-report.json')));
const trainingManifestPath = resolve(String(args.get('--training-manifest') || join(outDir, 'training-manifest.json')));
const probeReportPath = resolve(String(args.get('--probe-report') || join(outDir, 'probe-report.json')));
const sourceAppearanceCorpusPath = resolve(String(args.get('--source-appearance-corpus') || DEFAULT_APPEARANCE_CORPUS));
const stateSteps = String(args.get('--state-steps') || '80,120').split(',').map(value => Number(value.trim()));
const timeoutMs = Number(args.get('--timeout-ms') || 900000);
const settleMs = Number(args.get('--settle-ms') || 2500);
const viewportWidth = Number(args.get('--viewport-width') || 1280);
const viewportHeight = Number(args.get('--viewport-height') || 960);
const chunkRows = Number(args.get('--chunk-rows') || 8192);
const chunkFloats = Number(args.get('--chunk-floats') || 262144);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-layer-coefficient-profile-');
const learnerPath = resolve(import.meta.dirname, 'volume-layer-coefficient-learner-mlx.py');
const descriptorSocketPath = resolve(import.meta.dirname, 'flow-kernel-descriptor-socket.mjs');

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = { witnessIdentity: WITNESS_IDENTITY };
let runtimeIdentity = { requestedRoute: requestedUrl, effectiveRoute: null, prototypeIdentity: null, backend: null };

mkdirSync(artifactsDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(trainingManifestPath), { recursive: true });
mkdirSync(dirname(probeReportPath), { recursive: true });

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
  const sourceAppearanceCorpus = readSourceAppearanceCorpus();

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
  assert.equal(runtimeIdentity.grid, sourceAppearanceCorpus.receipt.expectedGrid, 'source appearance corpus grid differs from runtime grid');
  await delay(settleMs);

  const states = [];
  for (let stateIndex = 0; stateIndex < stateSteps.length; stateIndex += 1) {
    const steps = stateSteps[stateIndex];
    const stateId = `coefficient-state-${String(steps).padStart(3, '0')}`;
    const splitRole = stateIndex === stateSteps.length - 1 ? 'heldOut' : 'train';
    states.push(await captureState({ stateId, splitRole, steps, stateIndex }));
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      completedStateIds: states.map(state => state.id),
      retainedRows: states.reduce((total, state) => total + state.rows.count, 0),
    };
  }

  failurePhase = 'training-manifest';
  const manifest = buildTrainingManifest({ states, sourceAppearanceCorpus });
  writeFileSync(trainingManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    trainingManifestPath,
    trainingManifestSha256: sha256(readFileSync(trainingManifestPath)),
  };

  failurePhase = 'probe-only-airlock';
  const probe = spawnSync('python3', [
    learnerPath,
    '--input', trainingManifestPath,
    '--report', probeReportPath,
    '--probe-only',
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(probe.stderr || probe.stdout || `probe exited ${probe.status}`);
  const probeReport = JSON.parse(readFileSync(probeReportPath, 'utf8'));
  assert.equal(probeReport.status, 'contract-valid', 'learner probe did not validate the corpus');
  assert.equal(probeReport.trainingStarted, false, 'probe-only airlock started training');

  failurePhase = 'complete';
  writeReport({
    status: 'captured',
    failurePhase: null,
    lastTrustworthyEvidence: {
      ...lastTrustworthyEvidence,
      probeReportPath,
      probeReportSha256: sha256(readFileSync(probeReportPath)),
    },
    effectiveRoute: runtimeIdentity.effectiveRoute,
    prototypeIdentity: runtimeIdentity.prototypeIdentity,
    backend: runtimeIdentity.backend,
    stateCount: states.length,
    retainedRowCount: states.reduce((total, state) => total + state.rows.count, 0),
    sampleCap: null,
    droppedRowCount: 0,
  });
  console.log(JSON.stringify({
    status: 'captured',
    reportPath,
    trainingManifestPath,
    probeReportPath,
    stateCount: states.length,
    retainedRowCount: states.reduce((total, state) => total + state.rows.count, 0),
  }, null, 2));
} catch (error) {
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

async function captureState({ stateId, splitRole, steps, stateIndex }) {
  failurePhase = `${stateId}:deterministic-replay`;
  const replay = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.sampleDeterministicReplayFrame(${JSON.stringify({
    steps,
    timeStepMs: 1000 / 60,
    startTimeMs: 1000 + stateIndex * 10000,
    restoreControls: true,
  })})`);
  assert.equal(replay?.ok, true, `${stateId} replay failed: ${JSON.stringify(replay)}`);
  assert.equal(replay.completedSteps, steps, `${stateId} replay step count drifted`);
  assert.equal(replay.grid, runtimeIdentity.grid, `${stateId} replay grid drifted`);

  failurePhase = `${stateId}:freeze`;
  const frozen = await evaluate(socket, `(() => {
    const prototype = ${VOLUME_PROTOTYPE_EXPRESSION};
    prototype.setSelectiveHeadLiveCapturePaused(true);
    prototype.setActive(false);
    const state = prototype.debugState();
    return {
      active: state.active,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      grid: state.simGrid,
      controls: state.controls,
      captureTimeMs: performance.now(),
      requestedRoute: state.requestedRoute,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      backend: state.backend,
    };
  })()`);
  assert.equal(frozen.active, false, `${stateId} renderer did not freeze`);
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
    now: 1000 + stateIndex * 10000 + steps * (1000 / 60),
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
    splitRole,
    sameStateCaptureId: stateId,
    sourceFieldManifest: sourceFieldManifest.artifact,
    requestedControlIdentity: controlIdentity,
    effectiveControlIdentity: controlIdentity,
    replay,
    rows: {
      count: rows.count,
      features: rows.features,
      admission: rows.admission,
      nativeCellIndices: rows.nativeCellIndices,
      coefficients: rows.coefficients,
      kernelDescriptors,
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
  return {
    count: retainedCount,
    sourceRowCount,
    sampleCap: null,
    droppedRowCount: 0,
    features: sinks.features.close([retainedCount, POST_ADMISSION_FEATURE_ORDER.length]),
    admission: sinks.admission.close([retainedCount, ANALYTICAL_ADMISSION_ORDER.length]),
    nativeCellIndices: sinks.nativeCellIndices.close([retainedCount]),
    coefficients: sinks.coefficients.close([retainedCount, COEFFICIENT_ORDER.length]),
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
  assert.ok(stateSteps.length >= 2, 'coefficient corpus requires at least one train state and one held state');
  assert.ok(stateSteps.every(value => Number.isInteger(value) && value > 0), 'state steps must be positive integers');
  assert.equal(new Set(stateSteps).size, stateSteps.length, 'state steps must identify distinct simulator states');
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

function writeReport(payload) {
  writeFileSync(reportPath, `${JSON.stringify({
    schema: 'kaminos.volume.layer-coefficient-corpus-witness-report.v0',
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

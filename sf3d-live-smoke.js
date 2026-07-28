import {
  SF3D_LIVE_SMOKE_CANONICAL_GLB_SHA256,
  SF3D_LIVE_SMOKE_OPTIONS,
  SF3D_LIVE_SMOKE_ROUTE_ID,
  buildSf3dCompletedOutputReceipt,
  buildSf3dFailureEvidence,
  canFireSf3dLiveSmoke,
  createSf3dGpuTopologyReceipt,
  createSf3dRenderCadenceGate,
  createSf3dRendererOptions,
  freezeSf3dRouteEvidence,
  progressFromSf3dMessage,
  resolveSf3dDinoRequest,
  resolveSf3dGpuTopologyRequest,
  resolveSf3dPostProcessorRequest,
  resolveSf3dRenderTargetFps,
  summarizeSf3dFrameGaps,
  validateSf3dLiveSmokeConfig,
} from './sf3d-live-smoke-core.js';

export { createSf3dRenderCadenceGate, createSf3dRendererOptions };

export function isSf3dLiveSmokeRoute(params = new URLSearchParams(location.search)) {
  return params.get('sf3d_live_smoke') === '1';
}

export async function prepareSf3dLiveSmokeDevice(params = new URLSearchParams(location.search)) {
  if (!isSf3dLiveSmokeRoute(params)) return null;
  const requestedTopology = resolveSf3dGpuTopologyRequest(params);
  const dino = resolveSf3dDinoRequest(params);
  const postProcessor = resolveSf3dPostProcessorRequest(params);
  const renderTargetFps = resolveSf3dRenderTargetFps(params, requestedTopology);
  const response = await fetch('/api/sf3d-live-smoke-config', { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  const config = validateSf3dLiveSmokeConfig(payload);
  const gpuModule = await import(`${config.origin}/src/lib/gpu.js`);
  const gpu = await gpuModule.initGPU();
  const deviceLoss = {
    lost: false,
    info: null,
    promise: null,
  };
  deviceLoss.promise = gpu.device.lost.then(info => {
    deviceLoss.lost = true;
    deviceLoss.info = {
      reason: info.reason || null,
      message: info.message || null,
    };
    return deviceLoss.info;
  });
  return Object.freeze({
    config,
    adapter: gpu.adapter,
    device: gpu.device,
    deviceLoss,
    requestedTopology,
    dino,
    postProcessor,
    renderTargetFps,
  });
}

export function bindSf3dLiveSmokeRenderer(prepared, renderer, renderCadence) {
  if (!prepared) return null;
  if (!renderCadence?.snapshot) throw new Error('SF3D live smoke render cadence is unverified');
  const rendererDevice = renderer?.backend?.device;
  const gpuTopology = createSf3dGpuTopologyReceipt({
    requestedTopology: prepared.requestedTopology,
    inferenceDevice: prepared.device,
    rendererDevice,
  });
  return Object.freeze({ ...prepared, gpuTopology, renderCadence });
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setProgress(percent, label) {
  const fill = document.getElementById('sf3d-live-smoke-progress-fill');
  if (fill && Number.isFinite(percent)) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (label) setText('sf3d-live-smoke-phase', label);
}

function formatMs(value, digits = 0) {
  return Number.isFinite(value) ? `${value.toFixed(digits)} ms` : 'pending';
}

async function sha256(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loadImage(url) {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`SF3D input image failed to load: ${url}`));
    image.src = url;
  });
}

function createCrossOriginModuleWorker(moduleUrl) {
  const bootstrap = URL.createObjectURL(new Blob([`import ${JSON.stringify(moduleUrl)};`], { type: 'text/javascript' }));
  const worker = new Worker(bootstrap, { type: 'module' });
  return {
    worker,
    terminate() {
      worker.terminate();
      URL.revokeObjectURL(bootstrap);
    },
  };
}

async function persistReport(report) {
  try {
    const response = await fetch('/api/sf3d-live-smoke-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    const result = await response.json();
    return response.ok ? result : { error: result.error || `report write failed: ${response.status}` };
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

async function persistCompletedGlb(glb, {
  outputSha256,
  expectedSha256,
  sourceRevision,
}) {
  const response = await fetch('/api/sf3d-live-smoke-artifact', {
    method: 'POST',
    headers: {
      'Content-Type': 'model/gltf-binary',
      'X-SF3D-Output-SHA256': outputSha256,
      'X-SF3D-Expected-SHA256': expectedSha256,
      'X-SF3D-Source-Revision': sourceRevision,
    },
    body: glb,
  });
  const receipt = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(receipt?.error || `SF3D candidate artifact write failed: HTTP ${response.status}`);
  }
  if (
    receipt?.schema !== 'kaminos.sf3d-live-smoke-artifact.v0'
    || receipt.ok !== true
    || receipt.sha256 !== outputSha256
    || receipt.expectedSha256 !== expectedSha256
    || receipt.sourceRevision !== sourceRevision
    || receipt.bytes !== glb.byteLength
  ) {
    throw new Error('SF3D candidate artifact receipt identity mismatch');
  }
  return receipt;
}

async function probeDevice(device, {
  size = 4,
  mappedAtCreation = false,
} = {}) {
  let errorScopeOpen = false;
  try {
    device.pushErrorScope('validation');
    errorScopeOpen = true;
    const buffer = device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST,
      mappedAtCreation,
    });
    if (mappedAtCreation) {
      buffer.getMappedRange(0, Math.min(size, 4));
      buffer.unmap();
    }
    buffer.destroy();
    const validationError = await device.popErrorScope();
    errorScopeOpen = false;
    return {
      usable: validationError === null,
      size,
      mappedAtCreation,
      error: validationError?.message || null,
    };
  } catch (error) {
    let validationError = null;
    if (errorScopeOpen) {
      try {
        validationError = await device.popErrorScope();
      } catch {
        // The synchronous exception remains the strongest available evidence.
      }
    }
    return {
      usable: false,
      size,
      mappedAtCreation,
      error: error.message || validationError?.message || String(error),
    };
  }
}

function renderFinalMetrics(report) {
  const frame = report.renderer;
  setText('sf3d-live-smoke-wall', `${(report.totalWallMs / 1000).toFixed(1)} s`);
  setText('sf3d-live-smoke-p95', formatMs(frame.p95Ms, 1));
  setText('sf3d-live-smoke-p99', formatMs(frame.p99Ms, 1));
  setText('sf3d-live-smoke-max', formatMs(frame.maxMs, 1));
  setText(
    'sf3d-live-smoke-hitches',
    `${frame.thresholdCounts.over50Ms} / ${frame.thresholdCounts.over100Ms} / ${frame.thresholdCounts.over250Ms}`,
  );
  const stageHost = document.getElementById('sf3d-live-smoke-stages');
  if (stageHost) {
    stageHost.innerHTML = report.stages
      .map(stage => `<div><span>${stage.name}</span><span>${(stage.wallMs / 1000).toFixed(1)}s · max ${stage.maxGapMs.toFixed(1)}ms</span></div>`)
      .join('');
  }
}

export async function createSf3dLiveSmokeController({ prepared, onOutput }) {
  if (!prepared) return null;
  if (!prepared.gpuTopology) throw new Error('SF3D live smoke renderer topology is unverified');
  const panel = document.getElementById('sf3d-live-smoke-panel');
  if (!panel) throw new Error('SF3D live smoke panel is missing');
  panel.hidden = false;
  panel.dataset.status = 'loading';
  setText('sf3d-live-smoke-revision', prepared.config.effectiveRevision.slice(0, 10));
  setText('sf3d-live-smoke-route', SF3D_LIVE_SMOKE_ROUTE_ID);
  setText('sf3d-live-smoke-topology', prepared.gpuTopology.effective);
  setText('sf3d-live-smoke-status', 'Loading model');
  const effectiveOptions = Object.freeze({
    ...SF3D_LIVE_SMOKE_OPTIONS,
    cooperativeDino: prepared.dino.cooperativeDino,
    dinoSchedulingMode: prepared.dino.dinoSchedulingMode,
    dinoChunkBlocks: prepared.dino.dinoChunkBlocks,
    cooperativePostProcessor: prepared.postProcessor.cooperativePostProcessor,
    postProcessorSchedulingMode: prepared.postProcessor.postProcessorSchedulingMode,
    postProcessorDutyGranularity: prepared.postProcessor.postProcessorDutyGranularity,
  });

  const [weightsModule, inferenceModule, pipelineModule] = await Promise.all([
    import(`${prepared.config.origin}/src/lib/weights.js`),
    import(`${prepared.config.origin}/src/lib/inference.js`),
    import(`${prepared.config.origin}/src/lib/full_pipeline.js`),
  ]);
  const weights = await weightsModule.loadWeights(
    prepared.device,
    prepared.config.weightsUrl,
    (received, total) => {
      const progress = total > 0 ? received / total : 0;
      setProgress(progress * 100, total > 0
        ? `Model ${(received / 1024 / 1024).toFixed(0)} / ${(total / 1024 / 1024).toFixed(0)} MB`
        : `Model ${(received / 1024 / 1024).toFixed(0)} MB`);
    },
  );
  const pipelines = inferenceModule.initPipelines(prepared.device);
  const inputImage = await loadImage(prepared.config.imageUrl);
  const fireButton = document.getElementById('sf3d-live-smoke-fire');
  const downloadButton = document.getElementById('sf3d-live-smoke-download');
  let outputUrl = null;
  let running = false;
  let attempted = false;
  let frameTimes = [];
  let frameCpuTimes = [];
  let lastReport = null;
  let lastProgress = { percent: 0, label: 'Model loaded', message: null };

  const controller = {
    get active() {
      return running;
    },
    get report() {
      return lastReport;
    },
    debugState() {
      return {
        routeId: SF3D_LIVE_SMOKE_ROUTE_ID,
        revision: prepared.config.effectiveRevision,
        gpuTopology: prepared.gpuTopology.effective,
        gpuTopologyReceipt: prepared.gpuTopology,
        renderCadence: prepared.renderCadence.snapshot(),
        dino: prepared.dino,
        postProcessor: prepared.postProcessor,
        options: effectiveOptions,
        running,
        attempted,
        deviceLoss: prepared.deviceLoss.info,
      };
    },
    async probeInferenceDevice(options) {
      if (running || attempted) {
        return {
          usable: false,
          refused: true,
          error: 'Inference-device probes are only valid before the one-shot firing',
        };
      }
      return await probeDevice(prepared.device, options);
    },
    noteRenderedFrame(timestamp, cpuMs) {
      if (!running) return;
      frameTimes.push(timestamp);
      if (Number.isFinite(cpuMs)) frameCpuTimes.push(cpuMs);
      const gaps = [];
      for (let index = 1; index < frameTimes.length; index++) gaps.push(frameTimes[index] - frameTimes[index - 1]);
      const live = summarizeSf3dFrameGaps(gaps);
      setText('sf3d-live-smoke-p99', formatMs(live.p99Ms, 1));
      setText('sf3d-live-smoke-max', formatMs(live.maxMs, 1));
      setText(
        'sf3d-live-smoke-hitches',
        `${live.thresholdCounts.over50Ms} / ${live.thresholdCounts.over100Ms} / ${live.thresholdCounts.over250Ms}`,
      );
    },
    async fire() {
      if (!canFireSf3dLiveSmoke({
        running,
        attempted,
        deviceLost: prepared.deviceLoss.lost,
      })) {
        setText('sf3d-live-smoke-status', 'Refresh required before another firing');
        return null;
      }
      attempted = true;
      running = true;
      frameTimes = [];
      frameCpuTimes = [];
      lastReport = null;
      panel.dataset.status = 'running';
      fireButton.disabled = true;
      if (downloadButton) downloadButton.disabled = true;
      setProgress(0, 'Starting exact SF3D route');
      setText('sf3d-live-smoke-status', 'Running');
      setText('sf3d-live-smoke-wall', 'running');
      setText('sf3d-live-smoke-p95', 'sampling');
      setText('sf3d-live-smoke-p99', 'sampling');
      setText('sf3d-live-smoke-max', 'sampling');
      setText('sf3d-live-smoke-hitches', '0 / 0 / 0');
      lastProgress = { percent: 0, label: 'Starting exact SF3D route', message: null };
      const startedAt = performance.now();
      const workerHandle = createCrossOriginModuleWorker(`${prepared.config.origin}/src/lib/materialize_worker.js`);
      let phase = 'route-execution';
      let completedOutput = null;
      let outputArtifact = null;
      try {
        const output = await pipelineModule.runFullPipelineToGlb(
          prepared.device,
          pipelines,
          weights,
          inputImage,
          {
            cooperativeDino: effectiveOptions.cooperativeDino,
            dinoSchedulingMode: effectiveOptions.dinoSchedulingMode,
            dinoChunkBlocks: effectiveOptions.dinoChunkBlocks,
            cooperativePostProcessor: effectiveOptions.cooperativePostProcessor,
            postProcessorSchedulingMode: effectiveOptions.postProcessorSchedulingMode,
            postProcessorDutyGranularity: effectiveOptions.postProcessorDutyGranularity,
            cooperativeBake: effectiveOptions.cooperativeBake,
            bakeSchedulingMode: effectiveOptions.bakeSchedulingMode,
            bakeBatchTexels: effectiveOptions.bakeBatchTexels,
            decoderArena: effectiveOptions.decoderArena,
            materializeWorker: workerHandle.worker,
          },
          message => {
            const progress = progressFromSf3dMessage(message);
            lastProgress = { ...progress, message };
            setProgress(progress.percent, progress.label);
          },
        );
        const routeEvidence = freezeSf3dRouteEvidence({
          startedAt,
          completedAt: performance.now(),
          frameTimes,
          frameCpuTimes,
        });
        running = false;
        phase = 'output-evidence';
        const outputSha256 = await sha256(output.glb);
        completedOutput = buildSf3dCompletedOutputReceipt({
          output,
          outputSha256,
          expectedSha256: SF3D_LIVE_SMOKE_CANONICAL_GLB_SHA256,
          routeWallMs: routeEvidence.routeWallMs,
          frameTimes: routeEvidence.frameTimes,
          frameCpuTimes: routeEvidence.frameCpuTimes,
        });
        if (!completedOutput.output.canonical) {
          const mismatch = `SF3D GLB identity mismatch: ${outputSha256}`;
          phase = 'output-artifact';
          try {
            outputArtifact = await persistCompletedGlb(output.glb, {
              outputSha256,
              expectedSha256: SF3D_LIVE_SMOKE_CANONICAL_GLB_SHA256,
              sourceRevision: prepared.config.effectiveRevision,
            });
          } catch (error) {
            throw new Error(`${mismatch}; candidate artifact preservation failed: ${error.message || String(error)}`);
          }
          phase = 'output-identity';
          throw new Error(mismatch);
        }
        lastReport = {
          schema: 'kaminos.sf3d-live-contention-report.v0',
          ok: true,
          requestedRouteId: SF3D_LIVE_SMOKE_ROUTE_ID,
          effectiveRouteId: SF3D_LIVE_SMOKE_ROUTE_ID,
          requestedRevision: prepared.config.requestedRevision,
          effectiveRevision: prepared.config.effectiveRevision,
          sourceClean: prepared.config.clean,
          gpuTopology: prepared.gpuTopology.effective,
          gpuTopologyReceipt: prepared.gpuTopology,
          renderCadence: prepared.renderCadence.snapshot(),
          dino: prepared.dino,
          postProcessor: prepared.postProcessor,
          options: effectiveOptions,
          ...completedOutput,
          lastProgress,
          deviceLoss: prepared.deviceLoss.info,
        };
        const persisted = await persistReport(lastReport);
        lastReport.reportPath = persisted.path || null;
        lastReport.reportWriteError = persisted.error || null;
        window.kaminosSf3dLiveSmokeLastReport = lastReport;
        renderFinalMetrics(lastReport);
        setProgress(100, 'Complete');
        setText('sf3d-live-smoke-status', 'Canonical GLB produced');
        setText('sf3d-live-smoke-report', persisted.path || persisted.error || 'report not written');
        panel.dataset.status = 'complete';
        if (outputUrl) URL.revokeObjectURL(outputUrl);
        outputUrl = URL.createObjectURL(new Blob([output.glb], { type: 'model/gltf-binary' }));
        if (downloadButton) {
          downloadButton.disabled = false;
          downloadButton.onclick = () => {
            const anchor = document.createElement('a');
            anchor.href = outputUrl;
            anchor.download = 'sf3d-live-smoke.glb';
            anchor.click();
          };
        }
        await onOutput?.(new File([output.glb], 'sf3d-live-smoke.glb', { type: 'model/gltf-binary' }));
        return lastReport;
      } catch (error) {
        running = false;
        await Promise.race([
          prepared.deviceLoss.promise,
          new Promise(resolve => setTimeout(resolve, 100)),
        ]);
        const deviceProbe = await probeDevice(prepared.device);
        const completedEvidence = buildSf3dFailureEvidence(completedOutput);
        lastReport = {
          schema: 'kaminos.sf3d-live-contention-report.v0',
          ok: false,
          failurePhase: phase,
          error: error.message || String(error),
          requestedRouteId: SF3D_LIVE_SMOKE_ROUTE_ID,
          effectiveRouteId: SF3D_LIVE_SMOKE_ROUTE_ID,
          requestedRevision: prepared.config.requestedRevision,
          effectiveRevision: prepared.config.effectiveRevision,
          sourceClean: prepared.config.clean,
          gpuTopology: prepared.gpuTopology.effective,
          gpuTopologyReceipt: prepared.gpuTopology,
          renderCadence: prepared.renderCadence.snapshot(),
          dino: prepared.dino,
          postProcessor: prepared.postProcessor,
          options: effectiveOptions,
          elapsedMs: completedOutput?.totalWallMs ?? performance.now() - startedAt,
          output: completedEvidence.output,
          outputArtifact,
          lastProgress,
          deviceLoss: prepared.deviceLoss.info,
          deviceProbe,
          renderer: completedEvidence.renderer
            ?? summarizeSf3dFrameGaps(frameTimes.slice(1).map((time, index) => time - frameTimes[index])),
          stages: completedEvidence.stages,
          cooperativeReports: completedEvidence.cooperativeReports,
          arenaSnapshot: completedEvidence.arenaSnapshot,
          evidenceWarnings: completedEvidence.evidenceWarnings,
        };
        const persisted = await persistReport(lastReport);
        window.kaminosSf3dLiveSmokeLastReport = lastReport;
        setText('sf3d-live-smoke-status', `Failed: ${lastReport.error}`);
        setText('sf3d-live-smoke-report', persisted.path || persisted.error || 'report not written');
        panel.dataset.status = 'failed';
        throw error;
      } finally {
        workerHandle.terminate();
        fireButton.disabled = true;
      }
    },
  };

  fireButton.disabled = false;
  fireButton.addEventListener('click', () => controller.fire().catch(error => console.error('SF3D live smoke failed:', error)));
  setProgress(0, 'Model loaded');
  setText('sf3d-live-smoke-status', 'Armed');
  panel.dataset.status = 'armed';
  return controller;
}

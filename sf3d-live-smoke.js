import {
  SF3D_LIVE_SMOKE_CANONICAL_GLB_SHA256,
  SF3D_LIVE_SMOKE_OPTIONS,
  SF3D_LIVE_SMOKE_ROUTE_ID,
  frameGapsWithinStage,
  progressFromSf3dMessage,
  summarizeSf3dFrameGaps,
  validateSf3dLiveSmokeConfig,
} from './sf3d-live-smoke-core.js';

export function isSf3dLiveSmokeRoute(params = new URLSearchParams(location.search)) {
  return params.get('sf3d_live_smoke') === '1';
}

export async function prepareSf3dLiveSmokeDevice() {
  if (!isSf3dLiveSmokeRoute()) return null;
  const response = await fetch('/api/sf3d-live-smoke-config', { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  const config = validateSf3dLiveSmokeConfig(payload);
  const gpuModule = await import(`${config.origin}/src/lib/gpu.js`);
  const gpu = await gpuModule.initGPU();
  return Object.freeze({ config, adapter: gpu.adapter, device: gpu.device });
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

function stageRows(stageSpans, frameTimes) {
  return (stageSpans || []).map(stage => {
    const summary = summarizeSf3dFrameGaps(frameGapsWithinStage(frameTimes, stage));
    return {
      name: stage.name,
      wallMs: stage.end - stage.start,
      maxGapMs: summary.maxMs,
      p99Ms: summary.p99Ms,
    };
  });
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
  const panel = document.getElementById('sf3d-live-smoke-panel');
  if (!panel) throw new Error('SF3D live smoke panel is missing');
  panel.hidden = false;
  panel.dataset.status = 'loading';
  setText('sf3d-live-smoke-revision', prepared.config.effectiveRevision.slice(0, 10));
  setText('sf3d-live-smoke-route', SF3D_LIVE_SMOKE_ROUTE_ID);
  setText('sf3d-live-smoke-status', 'Loading model');

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
  let frameTimes = [];
  let frameCpuTimes = [];
  let lastReport = null;

  const controller = {
    get active() {
      return running;
    },
    get report() {
      return lastReport;
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
      if (running) return null;
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
      const startedAt = performance.now();
      const workerHandle = createCrossOriginModuleWorker(`${prepared.config.origin}/src/lib/materialize_worker.js`);
      let phase = 'route-execution';
      try {
        const output = await pipelineModule.runFullPipelineToGlb(
          prepared.device,
          pipelines,
          weights,
          inputImage,
          {
            cooperativeDino: SF3D_LIVE_SMOKE_OPTIONS.cooperativeDino,
            cooperativeBake: SF3D_LIVE_SMOKE_OPTIONS.cooperativeBake,
            bakeSchedulingMode: SF3D_LIVE_SMOKE_OPTIONS.bakeSchedulingMode,
            bakeBatchTexels: SF3D_LIVE_SMOKE_OPTIONS.bakeBatchTexels,
            decoderArena: SF3D_LIVE_SMOKE_OPTIONS.decoderArena,
            materializeWorker: workerHandle.worker,
          },
          message => {
            const progress = progressFromSf3dMessage(message);
            setProgress(progress.percent, progress.label);
          },
        );
        phase = 'output-identity';
        const outputSha256 = await sha256(output.glb);
        if (outputSha256 !== SF3D_LIVE_SMOKE_CANONICAL_GLB_SHA256) {
          throw new Error(`SF3D GLB identity mismatch: ${outputSha256}`);
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        running = false;
        const gaps = [];
        for (let index = 1; index < frameTimes.length; index++) gaps.push(frameTimes[index] - frameTimes[index - 1]);
        const totalWallMs = performance.now() - startedAt;
        lastReport = {
          schema: 'kaminos.sf3d-live-contention-report.v0',
          ok: true,
          requestedRouteId: SF3D_LIVE_SMOKE_ROUTE_ID,
          effectiveRouteId: SF3D_LIVE_SMOKE_ROUTE_ID,
          requestedRevision: prepared.config.requestedRevision,
          effectiveRevision: prepared.config.effectiveRevision,
          sourceClean: prepared.config.clean,
          options: SF3D_LIVE_SMOKE_OPTIONS,
          totalWallMs,
          output: {
            sha256: outputSha256,
            bytes: output.glb.byteLength,
            canonical: true,
            numVertices: output.numVertices,
            numFaces: output.numFaces,
          },
          renderer: {
            ...summarizeSf3dFrameGaps(gaps),
            renderedFrames: frameTimes.length,
            cpuFrameP99Ms: summarizeSf3dFrameGaps(frameCpuTimes).p99Ms,
          },
          stages: stageRows(output.stageSpans, frameTimes),
          cooperativeReports: output.cooperativeReports || {},
          arenaSnapshot: output.arenaSnapshot || null,
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
          options: SF3D_LIVE_SMOKE_OPTIONS,
          elapsedMs: performance.now() - startedAt,
          renderer: summarizeSf3dFrameGaps(frameTimes.slice(1).map((time, index) => time - frameTimes[index])),
        };
        const persisted = await persistReport(lastReport);
        window.kaminosSf3dLiveSmokeLastReport = lastReport;
        setText('sf3d-live-smoke-status', `Failed: ${lastReport.error}`);
        setText('sf3d-live-smoke-report', persisted.path || persisted.error || 'report not written');
        panel.dataset.status = 'failed';
        throw error;
      } finally {
        workerHandle.terminate();
        fireButton.disabled = false;
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

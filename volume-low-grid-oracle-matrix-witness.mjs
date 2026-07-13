#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const SCHEMA = 'kaminos.volume.low-grid-oracle-matrix-witness.v0';
const ROUTE_IDENTITY = 'continuous-low-grid-oracle-splat-matrix-v0';
const SPLAT_RENDERER_IDENTITY = 'live-boundary-sidecar-learned-attribute-splats-v0';
const PLAYBACK_AUTHORITY = 'consecutive-sim-steps-fixed-playback-v0';
const CONTROL_ROUTES = [
  {
    id: 'untouched_low', sourceMode: 'none', viewport: 'low',
    title: 'Untouched low control',
    summary: 'The low-grid receiver steps normally. Nothing is injected.',
    cueSource: 'Cue source: none',
    runtimeAuthority: 'Runtime authority: product-valid control',
    comparisonRole: 'Comparison role: low-grid baseline',
  },
  {
    id: 'low_self', sourceMode: 'lowSelf', viewport: 'low',
    title: 'Low self-forcing',
    summary: 'Current low-grid scalar activity is reinjected into the same low-grid receiver every step.',
    cueSource: 'Cue source: current low-grid scalar activity',
    runtimeAuthority: 'Runtime authority: available from low-grid state',
    comparisonRole: 'Comparison role: self-derived forcing control',
  },
  {
    id: 'high_projected_oracle', sourceMode: 'highProjected', viewport: 'low',
    title: 'High-truth oracle forcing',
    summary: 'Current high-grid truth activity is projected down and injected into the low-grid receiver every step.',
    cueSource: 'Cue source: current high-grid truth scalar activity',
    runtimeAuthority: 'Runtime authority: offline oracle only',
    comparisonRole: 'Comparison role: learnable forcing ceiling',
  },
  {
    id: 'high_reference', sourceMode: 'highProjected', viewport: 'high',
    title: 'Actual high-grid reference',
    summary: 'The high-grid simulation is rendered directly. It is not a forced low-grid receiver.',
    cueSource: 'Cue source: none; direct high-grid render',
    runtimeAuthority: 'Runtime authority: high-grid reference only',
    comparisonRole: 'Comparison role: visual target',
  },
];
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const baseUrl = args.get('--url') || 'http://127.0.0.1:8099/volume-low-grid-oracle-matrix.html';
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-low-grid-oracle-matrix');
const reportPath = resolve(args.get('--report') || join(outDir, 'manifest.json'));
const operatorIndexPath = join(outDir, 'operator-index.html');
const operatorIndexReportPath = resolve(args.get('--index-report') || join(outDir, 'operator-index.report.json'));
const indexOnly = args.has('--index-only');
const lowGrid = Number(args.get('--low-grid') || 64);
const highGrid = Number(args.get('--high-grid') || 128);
const framesPerRoute = Math.max(2, Number(args.get('--frames') || 30));
const playbackFps = Math.max(1, Number(args.get('--fps') || 12));
const stepDeltaMs = Math.max(1, Number(args.get('--step-delta-ms') || 80));
const vorticity = Number(args.get('--vorticity') || 0.20);
const curlNoise = Number(args.get('--curl-noise') || 0.00);
const material = Number(args.get('--material') || 0.00);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const timeoutMs = Math.max(15_000, Number(args.get('--timeout-ms') || 90_000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || mkdtempSync('/tmp/kaminos-low-grid-oracle-profile-');
const keepBrowserOpen = args.has('--keep-browser-open');

function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }
function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function writeReport(payload) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`);
}
function routeUrl(sourceMode) {
  const url = new URL(baseUrl);
  url.searchParams.set('low_grid', String(lowGrid));
  url.searchParams.set('high_grid', String(highGrid));
  url.searchParams.set('source_mode', sourceMode);
  url.searchParams.set('cadence', '1');
  url.searchParams.set('vorticity', String(vorticity));
  url.searchParams.set('curl_noise', String(curlNoise));
  url.searchParams.set('material', String(material));
  url.searchParams.set('controlled', '1');
  return url.href;
}
async function cdpJson(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} returned ${response.status}`);
  return response.json();
}
async function waitForCdp() {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try { await cdpJson('/json/version'); return; } catch { await delay(120); }
  }
  throw new Error('Chrome DevTools endpoint did not open');
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
async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  return result.result.value;
}
async function waitForMatrix(ws, sourceMode) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < timeoutMs) {
    state = await evaluate(ws, 'window.__kaminosLowGridOracleMatrix?.debugState?.()');
    if (state?.status === 'failed') throw new Error(`${state.failurePhase || 'matrix-failed'}: ${state.error || 'unknown error'}`);
    if (state?.routeIdentity === ROUTE_IDENTITY
      && state?.status === 'running'
      && state?.sourceMode === sourceMode
      && Number(state?.lowGrid) === lowGrid
      && Number(state?.highGrid) === highGrid
      && state?.effectiveBoundarySplatRendererIdentity === SPLAT_RENDERER_IDENTITY
      && state?.boundarySplatAttributeModelIdentity) return state;
    await delay(150);
  }
  throw new Error(`matrix did not reach requested effective route: ${JSON.stringify(state)}`);
}
async function viewportClip(ws, viewport) {
  const rect = await evaluate(ws, `(() => { const node = document.getElementById('${viewport}-view'); const r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);
  if (!rect || rect.width < 16 || rect.height < 16) throw new Error(`missing ${viewport} viewport clip`);
  return rect;
}
async function capturePng(ws, path, clip) {
  const result = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...clip, scale: 1 } });
  const bytes = Buffer.from(result.data, 'base64');
  if (bytes.length < 1024) throw new Error(`partial or blank-looking screenshot payload for ${path}`);
  writeFileSync(path, bytes);
  return { path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
function encodeVideo(frameDir, videoPath) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(playbackFps),
    '-i', join(frameDir, 'frame-%04d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '24', '-b:v', '0', videoPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${videoPath}: ${result.stderr || result.stdout || `status ${result.status}`}`);
  return { path: videoPath, byteLength: readFileSync(videoPath).length, sha256: sha256(videoPath), codec: 'vp9-webm', fps: playbackFps };
}
function writeOperatorIndex(routeReports, config = {}) {
  const effectiveLowGrid = Number(config.lowGrid ?? lowGrid);
  const effectiveHighGrid = Number(config.highGrid ?? highGrid);
  const effectiveFrames = Number(config.framesPerRoute ?? framesPerRoute);
  const effectiveFps = Number(config.playbackFps ?? playbackFps);
  const effectivePlaybackAuthority = config.playbackAuthority || PLAYBACK_AUTHORITY;
  const effectiveControls = config.controls || { vorticity, curlNoise, material, cadence: 1 };
  const cells = routeReports.map(route => {
    const routeContract = CONTROL_ROUTES.find(candidate => candidate.id === route.id);
    assert.ok(routeContract, `operator index received unknown route ${route.id}`);
    return `
    <figure>
      <video controls loop muted autoplay playsinline src="${basename(route.video.path)}"></video>
      <figcaption>
        <div class="route-heading"><strong>${routeContract.title}</strong><code>${route.id}</code></div>
        <p>${routeContract.summary}</p>
        <dl>
          <div><dt>Cue</dt><dd>${routeContract.cueSource}</dd></div>
          <div><dt>Learned forcing</dt><dd>No</dd></div>
          <div><dt>Authority</dt><dd>${routeContract.runtimeAuthority}</dd></div>
          <div><dt>Role</dt><dd>${routeContract.comparisonRole}</dd></div>
        </dl>
      </figcaption>
    </figure>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kaminos Low-Grid Oracle Matrix</title><style>
    :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#090b0c;color:#edf2f4}*{box-sizing:border-box}body{margin:0;padding:18px;max-width:1500px;margin-inline:auto}h1{font-size:20px;margin:0 0 6px;letter-spacing:0}.lede{margin:0 0 10px;color:#aab7bc;font-size:13px}.warning{margin:0 0 16px;padding:10px 12px;border-left:3px solid #efb35f;background:#19150f;color:#f6d7aa;font-size:13px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}figure{margin:0;background:#050607;border:1px solid #2b363b}video{width:100%;display:block;aspect-ratio:1/1;object-fit:contain;background:#000}figcaption{padding:10px 12px 12px;background:#111619}.route-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.route-heading strong{font-size:14px}.route-heading code{color:#8fa2aa;font-size:10px}figcaption>p{margin:5px 0 9px;color:#d4dde0;font-size:12px;line-height:1.35}dl{margin:0;display:grid;gap:4px;font-size:10px}dl div{display:grid;grid-template-columns:94px 1fr;gap:8px}dt{color:#82939a;text-transform:uppercase}dd{margin:0;color:#bcc8cc}@media(max-width:780px){body{padding:10px}.grid{grid-template-columns:1fr}.route-heading{align-items:flex-start;flex-direction:column;gap:3px}}</style></head><body>
    <h1>Low-Grid Oracle Forcing Matrix · ${effectiveHighGrid}<sup>3</sup> source / ${effectiveLowGrid}<sup>3</sup> receiver</h1>
    <p class="lede">${effectivePlaybackAuthority}; learned-splat renderer; ${effectiveFrames} consecutive controlled steps at ${effectiveFps} fps; receiver gains vorticity ${effectiveControls.vorticity}, curl ${effectiveControls.curlNoise}, material ${effectiveControls.material}.</p>
    <p class="warning"><strong>No learned forcing predictor generates any cue in this assay.</strong> The learned model is the splat renderer shared by all four routes. Only the third route uses high-grid truth, as an offline oracle ceiling.</p>
    <main class="grid">${cells}</main></body></html>`;
  writeFileSync(operatorIndexPath, html);
}

function refreshOperatorIndexFromReport() {
  let sourceReport = null;
  let failurePhase = 'index-only-report-read';
  try {
    sourceReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(sourceReport.status, 'captured', 'index-only source report is not a completed capture');
    assert.deepEqual(sourceReport.routes.map(route => route.id), CONTROL_ROUTES.map(route => route.id), 'index-only source report route order mismatch');
    failurePhase = 'index-only-video-validation';
    const localRoutes = sourceReport.routes.map(route => {
      const localVideoPath = join(outDir, basename(route.video.path));
      assert.ok(existsSync(localVideoPath), `index-only video is missing: ${localVideoPath}`);
      assert.equal(sha256(localVideoPath), route.video.sha256, `index-only video checksum mismatch: ${route.id}`);
      return { ...route, video: { ...route.video, path: localVideoPath } };
    });
    failurePhase = 'index-only-render';
    writeOperatorIndex(localRoutes, sourceReport);
    const operatorIndex = { path: operatorIndexPath, byteLength: readFileSync(operatorIndexPath).length, sha256: sha256(operatorIndexPath) };
    writeFileSync(reportPath, `${JSON.stringify({ ...sourceReport, operatorIndex }, null, 2)}\n`);
    writeFileSync(operatorIndexReportPath, `${JSON.stringify({
      schema: 'kaminos.volume.low-grid-oracle-operator-index-refresh.v0', status: 'written', failurePhase: null,
      sourceReport: reportPath, operatorIndex, routeOrder: localRoutes.map(route => route.id),
    }, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, report: operatorIndexReportPath, operatorIndex: operatorIndexPath }, null, 2));
  } catch (error) {
    writeFileSync(operatorIndexReportPath, `${JSON.stringify({
      schema: 'kaminos.volume.low-grid-oracle-operator-index-refresh.v0', status: 'failed', failurePhase,
      sourceReport: reportPath, reason: error?.message || String(error),
    }, null, 2)}\n`);
    console.error(JSON.stringify({ ok: false, report: operatorIndexReportPath, failurePhase, reason: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  if (indexOnly) {
    refreshOperatorIndexFromReport();
    return;
  }
  let failurePhase = 'launch';
  let ws = null;
  const browserProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--no-first-run',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1440,900', routeUrl('none'),
  ], { stdio: 'ignore' });
  const reportBase = {
    schema: SCHEMA, status: 'running', failurePhase, requestedBaseUrl: baseUrl, lowGrid, highGrid,
    framesPerRoute, playbackFps, stepDeltaMs, playbackAuthority: PLAYBACK_AUTHORITY,
    expectedRouteIdentity: ROUTE_IDENTITY, expectedBoundarySplatRendererIdentity: SPLAT_RENDERER_IDENTITY,
    controls: { vorticity, curlNoise, material, cadence: 1 }, routes: [], partialRoute: null, lastObservedState: null,
  };
  let partialRoute = null;
  let lastObservedState = null;
  writeReport(reportBase);
  try {
    failurePhase = 'cdp'; writeReport({ ...reportBase, failurePhase });
    await waitForCdp();
    const targets = await cdpJson('/json/list');
    const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!page) throw new Error('no debuggable page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    const routeReports = [];
    for (const route of CONTROL_ROUTES) {
      failurePhase = `route-${route.id}-navigate`;
      const url = routeUrl(route.sourceMode);
      await wsRequest(ws, 'Page.navigate', { url });
      const initial = await waitForMatrix(ws, route.sourceMode);
      lastObservedState = initial;
      partialRoute = { id: route.id, sourceMode: route.sourceMode, viewport: route.viewport, completedFrames: 0 };
      assert.equal(initial.playbackAuthority, PLAYBACK_AUTHORITY, `${route.id} playback authority mismatch`);
      const clip = await viewportClip(ws, route.viewport);
      const frameDir = join(outDir, `${route.id}-frames`);
      mkdirSync(frameDir, { recursive: true });
      let finalState = initial;
      const frames = [];
      for (let frameIndex = 0; frameIndex < framesPerRoute; frameIndex += 1) {
        failurePhase = `route-${route.id}-step-${frameIndex}`;
        const step = await evaluate(ws, `window.__kaminosLowGridOracleMatrix.controlledStep(${JSON.stringify({ frameIndex, startNow: 0, stepDeltaMs })})`);
        assert.equal(step?.ok, true, `${route.id} controlled step ${frameIndex} failed`);
        const framePath = join(frameDir, `frame-${String(frameIndex + 1).padStart(4, '0')}.png`);
        frames.push(await capturePng(ws, framePath, clip));
        partialRoute.completedFrames = frames.length;
        if (frameIndex === 0 || frameIndex === framesPerRoute - 1 || frameIndex % 5 === 0) {
          lastObservedState = await evaluate(ws, 'window.__kaminosLowGridOracleMatrix.debugState()');
          writeReport({ ...reportBase, status: 'running', failurePhase, routes: routeReports, partialRoute, lastObservedState });
        }
      }
      finalState = await evaluate(ws, 'window.__kaminosLowGridOracleMatrix.debugState()');
      lastObservedState = finalState;
      assert.equal(finalState.status, 'running', `${route.id} did not remain running`);
      assert.equal(finalState.effectiveBoundarySplatRendererIdentity, SPLAT_RENDERER_IDENTITY, `${route.id} fell off learned splats`);
      assert.ok(finalState.boundarySplatAttributeModelIdentity, `${route.id} lost learned splat model identity`);
      assert.ok(String(finalState.low?.backend || '').startsWith('WebGPU:'), `${route.id} low route is not WebGPU`);
      assert.ok(String(finalState.high?.backend || '').startsWith('WebGPU:'), `${route.id} high route is not WebGPU`);
      assert.ok(Number(finalState.receiverSimStepAdvance) >= framesPerRoute - 1, `${route.id} receiver did not advance consecutively`);
      assert.ok(Number(finalState.sourceSimStepAdvance) >= framesPerRoute - 1, `${route.id} source did not advance consecutively`);
      if (route.sourceMode !== 'none') {
        assert.ok(Number(finalState.cueUpdateCount) >= framesPerRoute, `${route.id} did not upload a cue for every captured step`);
        assert.ok(Number(finalState.maxCueAgeFrames) <= 1, `${route.id} cue became stale`);
      }
      const videoPath = join(outDir, `${route.id}.webm`);
      const video = encodeVideo(frameDir, videoPath);
      routeReports.push({
        id: route.id, sourceMode: route.sourceMode, viewport: route.viewport, requestedUrl: url,
        effectiveRouteIdentity: finalState.routeIdentity,
        effectiveBoundarySplatRendererIdentity: finalState.effectiveBoundarySplatRendererIdentity,
        boundarySplatAttributeModelIdentity: finalState.boundarySplatAttributeModelIdentity,
        cueAuthority: finalState.cueAuthority, cueUpdateCount: finalState.cueUpdateCount,
        maxCueAgeFrames: finalState.maxCueAgeFrames, sourceSimStepAdvance: finalState.sourceSimStepAdvance,
        receiverSimStepAdvance: finalState.receiverSimStepAdvance, projectionIdentity: finalState.projectionIdentity,
        cueTemporalMode: finalState.cueTemporalMode, lowBackend: finalState.low?.backend, highBackend: finalState.high?.backend,
        boundarySplatFallbackReason: route.viewport === 'low' ? finalState.low?.boundarySplatFallbackReason : finalState.high?.boundarySplatFallbackReason,
        boundarySplatOverflowCount: route.viewport === 'low' ? finalState.low?.boundarySplatOverflowCount : finalState.high?.boundarySplatOverflowCount,
        firstFrame: frames[0], lastFrame: frames.at(-1), video,
      });
      reportBase.routes = routeReports;
      partialRoute = null;
      writeReport({ ...reportBase, status: 'running', failurePhase: null, routes: routeReports, partialRoute, lastObservedState });
    }
    failurePhase = 'operator-index';
    writeOperatorIndex(routeReports);
    const report = {
      ...reportBase, status: 'captured', failurePhase: null, routes: routeReports,
      operatorIndex: { path: operatorIndexPath, byteLength: readFileSync(operatorIndexPath).length, sha256: sha256(operatorIndexPath) },
    };
    writeReport(report);
    console.log(JSON.stringify({ ok: true, report: reportPath, operatorIndex: operatorIndexPath, routes: routeReports.map(route => route.id) }, null, 2));
  } catch (error) {
    writeReport({ ...reportBase, status: 'failed', failurePhase, reason: error?.message || String(error), partialRoute, lastObservedState });
    console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, reason: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch {}
    if (!keepBrowserOpen) browserProcess.kill('SIGTERM');
  }
}

main();

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertNonBlankCanvasScreenshot, inspectPng } from './diagnostic-png-inspector.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const repoRoot = resolve(args.get('--repo-root') || process.cwd());
const scenePath = resolve(args.get('--scene') || `${repoRoot}/scenes/sinter-forked-timber-combustion.kaminos.json`);
const outDir = resolve(args.get('--out-dir') || `${repoRoot}/artifacts/sinter-authored-mesh-smoke-0923/diagnostic-r3`);
const origin = args.get('--origin') || 'http://127.0.0.1:8094';
const chromePath = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const modes = ['exposure', 'material'];
const reportPath = `${outDir}/report.json`;
const report = {
  schema: 'kaminos.saved-mesh-combustion-diagnostic-capture.v1',
  status: 'running',
  phase: 'preflight',
  repoRoot,
  gitHead: '',
  gitStatus: '',
  origin,
  scenePath,
  sceneSha256: '',
  expectedObjectId: 'sinter-forked-timber-trestle',
  expectedAssetIdentity: 'sha256:1270054ee62bd3c5c688b13e7334f9ae99280f5868b2121fd317b4dffe5d2b84',
  requestedModes: modes,
  captures: [],
  lastTrustedEvidence: null,
  errors: [],
};

function saveReport() {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function cdpRequest(ws, method, params = {}) {
  const id = ws.nextId = (ws.nextId || 0) + 1;
  return new Promise((resolveRequest, rejectRequest) => {
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function cdpValue(ws, expression) {
  const result = await cdpRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitFor(predicate, label, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await predicate();
    if (last) return last;
    await delay(250);
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

const runtimeSnapshotExpression = `(() => {
  const prototype = window.__kaminosVolumePrototype;
  if (!prototype?.debugState) return { prototypeAvailable: Boolean(prototype) };
  try {
    const state = prototype.debugState();
    const assembly = state.gpuStructuralCombustionAssembly;
    const source = state.combustibleObjectSource;
    return {
      prototypeAvailable: true,
      backend: state.backend,
      active: state.active,
      error: state.error,
      routeIdentity: state.routeIdentity,
      effectiveRoute: state.effectiveRoute,
      volumeScene: state.volumeScene,
      simGrid: state.simGrid,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      assembly: assembly ? {
        schema: assembly.schema,
        status: assembly.status,
        presentationDebugMode: assembly.presentationDebugMode,
        dispatchCount: assembly.dispatchCount,
        presentationCount: assembly.presentationCount,
        runtimeReadbackCount: assembly.runtimeReadbackCount,
        structureCount: assembly.structureCount,
        meshTriangleCount: assembly.meshTriangleCount,
        meshAssetIdentities: assembly.meshAssetIdentities,
        emittingObjectId: assembly.emittingObjectId,
      } : null,
      source: source ? {
        schema: source.schema,
        routeIdentity: source.routeIdentity,
        status: source.status,
        gridSize: source.gridSize,
        sourceFrameId: source.sourceFrameId,
        sourceCount: source.sourceCount,
        sameDevice: source.sameDevice,
        dispatchCount: source.dispatchCount,
      } : null,
    };
  } catch (error) {
    return { prototypeAvailable: true, stateError: String(error?.stack || error) };
  }
})()`;

async function main() {
  mkdirSync(outDir, { recursive: true });
  const sceneBytes = readFileSync(scenePath);
  const scene = JSON.parse(sceneBytes.toString('utf8'));
  const record = scene.objects?.find(object => object.id === report.expectedObjectId);
  assert.ok(record?.combustionBinding, 'saved scene is missing the named trestle combustion binding');
  assert.equal(record.combustionBinding.assetIdentity, report.expectedAssetIdentity, 'scene asset identity changed');
  report.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  report.gitStatus = execFileSync('git', ['status', '--short'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  report.sceneSha256 = sha256(sceneBytes);
  report.assetPath = resolve(repoRoot, record.source);
  report.assetSha256 = sha256(readFileSync(report.assetPath));
  report.phase = 'browser-launch';
  saveReport();

  const debugPort = 43000 + Math.floor(Math.random() * 18000);
  const profile = mkdtempSync('/tmp/kaminos-sinter-diagnostic-profile-');
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1600,1100',
    `${origin}/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_pressure_strategy=spatial_tiers&volume_pressure_iterations=3&volume_resolution=96&volume_majorant_grid=48&volume_structural_combustion_view=exposure`,
  ], { stdio: 'ignore' });
  report.browser = { chromePath, profile, debugPort, pid: chrome.pid };
  let ws;
  const pageErrors = [];
  const assetResponses = [];
  let lastRuntimeState = null;
  let lastSceneStatus = null;
  try {
    await waitFor(async () => {
      try { return await fetch(`http://127.0.0.1:${debugPort}/json/version`); } catch { return null; }
    }, 'Chrome DevTools endpoint');
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = targets.find(target => target.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'Chrome did not expose a page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      ws.addEventListener('open', resolveOpen, { once: true });
      ws.addEventListener('error', () => rejectOpen(new Error('Chrome DevTools websocket did not open')), { once: true });
    });
    await cdpRequest(ws, 'Runtime.enable');
    await cdpRequest(ws, 'Page.enable');
    await cdpRequest(ws, 'Network.enable');
    await cdpRequest(ws, 'Log.enable');
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.text);
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') pageErrors.push(message.params.entry.text);
      if (message.method === 'Network.responseReceived') {
        assetResponses.push({ url: message.params.response.url, status: message.params.response.status });
      }
      if (message.method === 'Network.loadingFailed') {
        pageErrors.push(`network ${message.params.errorText}: ${message.params.requestId}`);
      }
    });

    const sceneLiteral = JSON.stringify(scene);
    for (const mode of modes) {
      report.phase = `load-scene-${mode}`;
      const route = new URL(`${origin}/`);
      route.searchParams.set('kaminos_volume_smoke', '1');
      route.searchParams.set('volume_scene', 'tall_plume');
      route.searchParams.set('volume_pressure_strategy', 'spatial_tiers');
      route.searchParams.set('volume_pressure_iterations', '3');
      route.searchParams.set('volume_resolution', '96');
      route.searchParams.set('volume_majorant_grid', '48');
      route.searchParams.set('volume_structural_combustion_view', mode);
      await cdpRequest(ws, 'Page.navigate', { url: route.toString() });
      await waitFor(async () => (await cdpValue(ws, 'document.readyState')) === 'complete', `${mode} page load`);
      report.phase = `wait-runtime-${mode}`;
      const readyState = await waitFor(async () => {
        lastRuntimeState = await cdpValue(ws, runtimeSnapshotExpression);
        if (lastRuntimeState?.error || lastRuntimeState?.stateError || lastRuntimeState?.backend === 'unavailable') {
          throw new Error(`volume initialization failed: ${JSON.stringify(lastRuntimeState)}`);
        }
        return lastRuntimeState?.active === true
          && lastRuntimeState.backend === 'WebGPU:apple'
          && lastRuntimeState.effectiveRoute === 'native-3d-compute-fluid-raymarch-v0'
          && Number(lastRuntimeState.simGrid) === 96
          && lastRuntimeState.simStepCount > 0
          ? lastRuntimeState
          : null;
      }, `${mode} live 96-cubed Apple WebGPU volume initialization`, 180000);
      assert.equal(new URL(route.toString()).searchParams.get('volume_structural_combustion_view'), mode, `${mode} route was not requested`);
      assert.equal(readyState.backend, 'WebGPU:apple', `${mode} volume renderer did not initialize on Apple WebGPU`);
      report.lastTrustedEvidence = {
        mode,
        stage: 'live-volume-ready-before-scene-load',
        effectivePageRoute: route.toString(),
        backend: readyState.backend,
        effectiveRoute: readyState.effectiveRoute,
        simGrid: readyState.simGrid,
        simStepCount: readyState.simStepCount,
      };
      saveReport();
      const loaded = await cdpValue(ws, `(() => {
        const input = document.getElementById('scene-file-input');
        if (!input) throw new Error('saved scene file input is unavailable');
        const documentData = ${sceneLiteral};
        const file = new File([JSON.stringify(documentData)], 'sinter-forked-timber-combustion.kaminos.json', { type: 'application/json' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        const selectedFileName = input.files[0]?.name || null;
        const selectedFileCount = input.files.length;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          route: location.href,
          fileName: selectedFileName,
          fileCount: selectedFileCount,
        };
      })()`);
      assert.equal(new URL(loaded.route).searchParams.get('volume_structural_combustion_view'), mode, `${mode} route was not effective`);
      assert.equal(loaded.fileName, 'sinter-forked-timber-combustion.kaminos.json', 'the named saved scene was not selected');
      assert.equal(loaded.fileCount, 1, 'scene-file input contains an unexpected number of documents');
      report.lastTrustedEvidence = {
        mode,
        effectivePageRoute: loaded.route,
        selectedSceneFile: loaded.fileName,
        selectedSceneSha256: report.sceneSha256,
        expectedObjectId: report.expectedObjectId,
        expectedAssetIdentity: report.expectedAssetIdentity,
      };
      saveReport();

      report.phase = `simulate-${mode}`;
      const state = await waitFor(async () => {
        lastRuntimeState = await cdpValue(ws, runtimeSnapshotExpression);
        lastSceneStatus = await cdpValue(ws, 'document.getElementById("info-bar")?.textContent || null');
        const currentAssembly = lastRuntimeState?.assembly;
        const currentSource = lastRuntimeState?.source;
        return lastRuntimeState?.active === true
          && lastRuntimeState?.backend === 'WebGPU:apple'
          && lastRuntimeState?.effectiveRoute === 'native-3d-compute-fluid-raymarch-v0'
          && Number(lastRuntimeState?.simGrid) === 96
          && lastSceneStatus?.startsWith('Scene loaded: 1 object')
          && currentSource?.status === 'bound'
          && currentSource?.sameDevice === true
          && currentAssembly?.dispatchCount >= 120
          && currentAssembly?.presentationCount >= 120
          && currentAssembly?.meshTriangleCount === 864
          && currentAssembly?.meshAssetIdentities?.includes(report.expectedAssetIdentity)
          && currentAssembly?.presentationDebugMode === mode
          ? lastRuntimeState
          : null;
      }, `${mode} dispatches from the exact saved trestle assembly`);
      const assembly = state.assembly;
      const assetUrl = new URL(record.source, `${origin}/`).toString();
      const assetResponse = assetResponses.find(response => response.url === assetUrl);
      const canvasRect = await cdpValue(ws, `(() => {
        const canvas = window.__kaminosVolumePrototype?.canvasElement?.();
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, devicePixelRatio };
      })()`);
      assert.ok(canvasRect?.width > 0 && canvasRect?.height > 0, 'the volume canvas has no visible presentation area');
      const screenshot = await cdpRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
      const imageBytes = Buffer.from(screenshot.data, 'base64');
      const imagePath = `${outDir}/${mode}.png`;
      writeFileSync(imagePath, imageBytes);
      const canvasScreenshot = await cdpRequest(ws, 'Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: canvasRect.x, y: canvasRect.y, width: canvasRect.width, height: canvasRect.height, scale: 1 },
      });
      const canvasImageBytes = Buffer.from(canvasScreenshot.data, 'base64');
      const canvasImagePath = `${outDir}/${mode}-canvas.png`;
      writeFileSync(canvasImagePath, canvasImageBytes);
      const canvasPixels = assertNonBlankCanvasScreenshot(inspectPng(canvasImageBytes));
      const capture = {
        mode,
        requestedRoute: route.toString(),
        effectiveRoute: state.effectiveRoute,
        backend: state.backend,
        simGrid: state.simGrid,
        object: { id: report.expectedObjectId, type: record.type, source: record.source, assetIdentity: record.combustionBinding.assetIdentity },
        assembly,
        source: state.source,
        simulation: {
          frameCount: state.frameCount,
          simStepCount: state.simStepCount,
        },
        sceneStatus: lastSceneStatus,
        assetResponse,
        dispatchCount: assembly.dispatchCount,
        screenshot: {
          path: imagePath,
          sha256: sha256(imageBytes),
          bytes: imageBytes.byteLength,
          width: imageBytes.readUInt32BE(16),
          height: imageBytes.readUInt32BE(20),
        },
        canvasScreenshot: {
          path: canvasImagePath,
          sha256: sha256(canvasImageBytes),
          bytes: canvasImageBytes.byteLength,
          ...canvasPixels,
        },
        canvasRect,
        pageErrors: [...pageErrors],
      };
      report.captures.push(capture);
      saveReport();

      assert.equal(state.backend, 'WebGPU:apple', 'capture used an unexpected renderer backend');
      assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'volume route identity changed');
      assert.equal(Number(state.simGrid), 96, 'Pyro grid did not remain 96 cubed');
      assert.equal(assembly.presentationDebugMode, mode, 'shader presentation mode did not match the requested route');
      assert.equal(assembly.meshTriangleCount, 864, 'capture no longer presents the authored trestle geometry');
      assert.equal(assembly.structureCount, 1, 'capture must contain only the named bound trestle');
      assert.ok(assembly.meshAssetIdentities?.includes(report.expectedAssetIdentity), 'GPU assembly is not bound to the exact authored trestle asset');
      assert.equal(assembly.runtimeReadbackCount, 0, 'GPU diagnostic introduced host material readback');
      assert.equal(assetResponse?.status, 200, 'the exact authored trestle asset did not load over the effective route');
      assert.ok(capture.screenshot.width > 0 && capture.screenshot.height > 0, 'screenshot is empty');
      assert.ok(capture.canvasScreenshot.bytes > 1024, 'canvas screenshot is too small to be a credible visual frame');
      assert.deepEqual(pageErrors, [], 'browser reported an exception or console error');
    }
    report.status = 'passed';
    report.phase = 'complete';
  } catch (error) {
    report.status = 'failed';
    report.errors.push(String(error?.stack || error));
    report.failureContext = {
      phase: report.phase,
      lastRuntimeState,
      sceneStatus: lastSceneStatus,
      pageErrors: [...pageErrors],
      recentAssetResponses: assetResponses.slice(-30),
    };
  } finally {
    report.finishedAt = new Date().toISOString();
    try { ws?.close(); } catch {}
    try { chrome.kill('SIGTERM'); } catch {}
    saveReport();
  }
  process.stdout.write(`${JSON.stringify({ status: report.status, phase: report.phase, reportPath, captures: report.captures.map(({ mode, screenshot }) => ({ mode, ...screenshot })) })}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch(error => {
  report.status = 'failed';
  report.phase = report.phase || 'bootstrap';
  report.errors.push(String(error?.stack || error));
  report.finishedAt = new Date().toISOString();
  saveReport();
  process.stderr.write(`${report.phase}: ${error?.message || error}\n`);
  process.exitCode = 1;
});

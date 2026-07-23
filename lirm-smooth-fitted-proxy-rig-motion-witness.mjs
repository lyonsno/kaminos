#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  assertUsefulPngEvidence,
  inspectPngEvidence,
} from './artifacts/lirm-trellis-multisource-sparse-guidance-v1/evidence-admission.mjs';

const EXPECTED_ROUTE = 'kaminos/fitted-proxy-rig/exact-glb-smooth-curve-stress-v0';
const EXPECTED_SOURCE_HASH = '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e';
const EXPECTED_REGISTRATION_HASH = 'a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9';
const EXPECTED_AMPLITUDE = 0.18;
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWS = Object.freeze([
  { id: 'profile', queryView: 'side' },
  { id: 'three-quarter', queryView: 'three-quarter' },
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  return options;
}

async function writeReport(path, report) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, path);
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: accept, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else accept(message.result ?? {});
  };
  const opened = new Promise((accept, reject) => {
    socket.onopen = accept;
    socket.onerror = () => reject(new Error('Chrome DevTools websocket failed to open'));
  });
  return {
    opened,
    close: () => socket.close(),
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      const response = new Promise((accept, reject) => pending.set(id, { resolve: accept, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
  };
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(accept => setTimeout(accept, 100));
  }
  throw new Error(`Chrome DevTools endpoint did not appear: ${lastError?.message ?? 'timeout'}`);
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'browser evaluation failed');
  return result.result?.value;
}

async function waitForInspector(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate(cdp, 'window.__LIRM_INSPECTOR_STATE__ ?? null');
    if (state?.status === 'error') throw new Error(`inspector failed: ${state.error}`);
    if (state?.status === 'loaded') return state;
    await new Promise(accept => setTimeout(accept, 100));
  }
  throw new Error(`inspector did not settle: ${JSON.stringify(state)}`);
}

export function assertInspectorIdentity(state) {
  if (state.effectiveRoute !== EXPECTED_ROUTE) throw new Error(`effective route mismatch: ${state.effectiveRoute}`);
  if (state.sourceHash !== EXPECTED_SOURCE_HASH) throw new Error(`source hash mismatch: ${state.sourceHash}`);
  if (state.registrationHash !== EXPECTED_REGISTRATION_HASH) {
    throw new Error(`registration hash mismatch: ${state.registrationHash}`);
  }
  if (state.effectiveAmplitude !== EXPECTED_AMPLITUDE) {
    throw new Error(`effective amplitude mismatch: ${state.effectiveAmplitude}`);
  }
  if (state.denseMotion?.status !== 'mounted') throw new Error('dense motion did not mount');
}

export function assertCapturedFrameSet(capturedFrames, view, frameCount) {
  const capturedForView = capturedFrames.filter(frame => frame.view === view);
  if (capturedForView.length !== frameCount) {
    throw new Error(`captured frame count mismatch for ${view}: ${capturedForView.length} != ${frameCount}`);
  }
  return capturedForView;
}

export function verifyPng(bytes, frameId, options = {}) {
  if (bytes.length < 4096) throw new Error(`screenshot is too small for ${frameId}: ${bytes.length}`);
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`screenshot is not PNG for ${frameId}`);
  const evidence = inspectPngEvidence(bytes);
  assertUsefulPngEvidence(evidence, {
    minWidth: options.minWidth ?? 256,
    minHeight: options.minHeight ?? 256,
    minLuminanceStdDev: options.minLuminanceStdDev ?? 8,
    minEdgeRatio: options.minEdgeRatio ?? 0.0015,
    minActivePixelRatio: options.minActivePixelRatio ?? 0.015,
    minActiveBoundsRatio: options.minActiveBoundsRatio ?? 0.04,
  }, frameId);
  return evidence;
}

export async function prepareFrameDirectory(frameRoot) {
  await rm(frameRoot, { recursive: true, force: true });
  await mkdir(frameRoot, { recursive: true });
}

async function fileIdentity(path, root = null) {
  const bytes = await readFile(path);
  return {
    path: root ? relative(root, path) : path,
    bytes: (await stat(path)).size,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

function encodeVideo(frameDir, outputPath, frameRate) {
  const result = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(frameRate),
    '-i', resolve(frameDir, 'frame-%03d.png'),
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr || result.stdout}`);
}

function encodeContactSheet(frameDir, outputPath, frameRate, frameCount) {
  const sampleStep = Math.max(1, Math.floor(frameCount / 18));
  const result = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(frameRate),
    '-i', resolve(frameDir, 'frame-%03d.png'),
    '-vf', `select='not(mod(n,${sampleStep}))',scale=320:200,tile=6x3`,
    '-frames:v', '1', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`contact sheet generation failed: ${result.stderr || result.stdout}`);
}

export async function runDenseMotionWitness({
  url,
  outDir,
  chromePath = DEFAULT_CHROME,
  frameCount = 72,
  frameRate = 12,
} = {}) {
  if (!url || !outDir) throw new Error('dense motion witness requires url and outDir');
  if (!Number.isInteger(frameCount) || frameCount < 24) throw new Error('dense motion witness requires at least 24 frames');
  const outputRoot = resolve(outDir);
  const reportPath = resolve(outputRoot, 'capture-report.json');
  const profileRoot = resolve(outputRoot, 'profile');
  const chromeRoot = resolve(outputRoot, '.chrome-profile');
  await mkdir(profileRoot, { recursive: true });
  await rm(chromeRoot, { recursive: true, force: true });
  const port = 44000 + Math.floor(Math.random() * 12000);
  const startedAt = new Date().toISOString();
  const report = {
    schema: 'kaminos.lirm-smooth-fitted-proxy-rig-dense-motion-witness.v0',
    status: 'running',
    failurePhase: null,
    requestedRoute: EXPECTED_ROUTE,
    effectiveRoute: null,
    requestedConfig: { url, views: VIEWS.map(view => view.id), frameCount, frameRate },
    effectiveConfig: null,
    sourceHash: null,
    registrationHash: null,
    effectiveAmplitude: null,
    outputs: {},
    capturedFrames: [],
    lastTrustworthyEvidence: 'invocation recorded; browser not started',
    timing: { startedAt, finishedAt: null },
  };
  await writeReport(reportPath, report);
  let failurePhase = 'browser-launch';
  let chrome = null;
  let cdp = null;
  try {
    chrome = spawn(chromePath, [
      '--headless=new', '--hide-scrollbars', '--window-size=1280,800', '--force-device-scale-factor=1',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
      '--disable-background-networking', '--disable-component-update', '--disable-background-timer-throttling',
      `--remote-debugging-port=${port}`, `--user-data-dir=${chromeRoot}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const page = pages.find(item => item.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome exposed no inspectable page');
    cdp = createCdpClient(page.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    report.lastTrustworthyEvidence = 'isolated Chrome launched and CDP attached';
    await writeReport(reportPath, report);

    for (const view of VIEWS) {
      failurePhase = `load-${view.id}`;
      const target = new URL(url);
      target.searchParams.set('motion', '1');
      target.searchParams.set('paused', '1');
      target.searchParams.set('phase', '0');
      target.searchParams.set('view', view.queryView);
      await cdp.send('Page.navigate', { url: target.toString() });
      const state = await waitForInspector(cdp);
      assertInspectorIdentity(state);
      report.effectiveRoute = state.effectiveRoute;
      report.sourceHash = state.sourceHash;
      report.registrationHash = state.registrationHash;
      report.effectiveAmplitude = state.effectiveAmplitude;
      report.lastTrustworthyEvidence = `${view.id} exact route and dense motion mounted`;
      await writeReport(reportPath, report);

      const frameRoot = resolve(outputRoot, view.id);
      await prepareFrameDirectory(frameRoot);
      for (let index = 0; index < frameCount; index += 1) {
        failurePhase = `capture-${view.id}-${index}`;
        const phase = index / frameCount;
        const sample = await evaluate(cdp, `(async () => {
          const state = window.__setLirmMotionPhase(${phase});
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return { state, screenProbe: window.__lirmMotionScreenProbe() };
        })()`, true);
        const motion = sample?.state;
        if (!motion || Math.abs(motion.phase - phase) > 1e-6) throw new Error(`dense motion phase drift at ${view.id} ${index}`);
        const screenProbe = sample?.screenProbe;
        if (!screenProbe?.intersectsViewport || screenProbe.areaRatio < 0.025
            || screenProbe.clipped.width < 120 || screenProbe.clipped.height < 90) {
          throw new Error(`motion object is not credibly framed at ${view.id} ${index}: ${JSON.stringify(screenProbe)}`);
        }
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        const bytes = Buffer.from(shot.data, 'base64');
        const frameId = `${view.id}-${String(index).padStart(3, '0')}`;
        const visualEvidence = verifyPng(bytes, frameId, { minWidth: 1280, minHeight: 800 });
        const margin = 12;
        const clipX = Math.max(0, Math.floor(screenProbe.clipped.minX - margin));
        const clipY = Math.max(0, Math.floor(screenProbe.clipped.minY - margin));
        const clip = {
          x: clipX,
          y: clipY,
          width: Math.min(1280 - clipX, Math.ceil(screenProbe.clipped.width + margin * 2)),
          height: Math.min(800 - clipY, Math.ceil(screenProbe.clipped.height + margin * 2)),
          scale: 1,
        };
        const bodyShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
        const bodyEvidence = verifyPng(Buffer.from(bodyShot.data, 'base64'), `${frameId}-body`, {
          minWidth: 120,
          minHeight: 90,
          minLuminanceStdDev: 10,
          minActivePixelRatio: 0.025,
        });
        const framePath = resolve(frameRoot, `frame-${String(index).padStart(3, '0')}.png`);
        await writeFile(framePath, bytes);
        report.capturedFrames.push({
          id: frameId,
          view: view.id,
          index,
          phase,
          ...await fileIdentity(framePath, outputRoot),
          motion,
          screenProbe,
          visualEvidence,
          bodyEvidence,
        });
      }
      assertCapturedFrameSet(report.capturedFrames, view.id, frameCount);
      const videoPath = resolve(outputRoot, `${view.id}.mp4`);
      encodeVideo(frameRoot, videoPath, frameRate);
      const sheetPath = resolve(outputRoot, `${view.id}-dense-full-cycle.png`);
      encodeContactSheet(frameRoot, sheetPath, frameRate, frameCount);
      report.outputs[view.id] = {
        frameRoot: relative(outputRoot, frameRoot),
        frameCount,
        video: await fileIdentity(videoPath, outputRoot),
        sheet: await fileIdentity(sheetPath, outputRoot),
      };
      await writeReport(reportPath, report);
    }
    report.status = 'captured-uninspected';
    report.effectiveConfig = { views: VIEWS.map(view => view.id), frameCount, frameRate, phaseStep: 1 / frameCount };
    report.lastTrustworthyEvidence = 'profile and three-quarter contiguous frames, videos, and full-cycle sheets written; visual inspection pending';
  } catch (error) {
    report.status = 'failed';
    report.failurePhase = failurePhase;
    report.error = { name: error.name, message: error.message };
    report.lastTrustworthyEvidence = `${report.lastTrustworthyEvidence}; failed during ${failurePhase}`;
    throw error;
  } finally {
    report.timing.finishedAt = new Date().toISOString();
    await writeReport(reportPath, report);
    cdp?.close();
    chrome?.kill('SIGTERM');
    await rm(chromeRoot, { recursive: true, force: true });
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runDenseMotionWitness({
    url: options.url,
    outDir: options.out,
    chromePath: options.chrome ?? DEFAULT_CHROME,
    frameCount: options.frames ? Number(options.frames) : 72,
    frameRate: options.fps ? Number(options.fps) : 12,
  });
  process.stdout.write(`${JSON.stringify({ status: report.status, report: resolve(options.out, 'capture-report.json'), outputs: report.outputs }, null, 2)}\n`);
}

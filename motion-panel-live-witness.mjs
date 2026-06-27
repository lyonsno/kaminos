#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const url = args.get('--url') || 'http://127.0.0.1:18123/?kaminos_motion_agency=1';
const serverUrl = String(args.get('--server-url') || 'http://127.0.0.1:8098').replace(/\/+$/, '');
const prompt = args.get('--prompt') || 'a little worm squirms vigorously uphill';
const frameTotal = positiveInt(args.get('--frames'), 12, '--frames');
const intervalMs = nonnegativeNumber(args.get('--interval-ms'), 420, '--interval-ms');
const settleMs = nonnegativeNumber(args.get('--settle-ms'), 900, '--settle-ms');
const duration = positiveNumber(args.get('--duration'), 6, '--duration');
const steps = positiveInt(args.get('--steps'), 20, '--steps');
const sourceMode = args.get('--source-mode') || 'sidecar';
const sourceOpacity = positiveNumber(args.get('--source-opacity'), 0.55, '--source-opacity');
const tileWidth = positiveInt(args.get('--tile-width'), 420, '--tile-width');
const columns = positiveInt(args.get('--columns'), frameTotal, '--columns');
const exportCurrentView = args.has('--export-current-view');
const exportReferenceMode = exportReferenceModeFromArgs(args.get('--export-reference-mode'));
const cameraPosition = args.get('--camera-position') || '';
const cameraTarget = args.get('--camera-target') || '';
const port = positiveInt(args.get('--debug-port'), 9670, '--debug-port');
const chrome = process.env.KAMINOS_CHROME || args.get('--chrome') || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = resolve(args.get('--out-dir') || `/tmp/kaminos-motion-panel-live-witness-${timestamp}`);
const reportPath = resolve(args.get('--report') || `${outDir}/report.json`);
const filmstripPath = resolve(args.get('--filmstrip') || `${outDir}/filmstrip.png`);
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-motion-panel-live-witness-profile-${port}-${process.pid}`;

let phase = 'initializing';
let stderr = '';
let chromeProcess = null;
let effectiveUrl = null;
let browserVersion = null;

function positiveInt(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function positiveNumber(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function nonnegativeNumber(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a nonnegative number`);
  return parsed;
}

function exportReferenceModeFromArgs(value) {
  if (value == null || value === '') return 'current';
  const mode = String(value);
  if (!['current', 'hidden', 'overlay', 'sidecar'].includes(mode)) {
    throw new Error('--export-reference-mode must be current, hidden, overlay, or sidecar');
  }
  return mode;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.motion-panel-live-witness.v0',
    requestedUrl: url,
    effectiveUrl,
    serverUrl,
    prompt,
    frameTotal,
    intervalMs,
    settleMs,
    duration,
    steps,
    sourceMode,
    sourceOpacity,
    tileWidth,
    columns,
    exportCurrentView,
    exportReferenceMode,
    cameraPosition,
    cameraTarget,
    debugPort: port,
    chrome,
    userDataDir,
    outDir,
    filmstripPath,
    phase,
    browserVersion,
    stderrTail: stderr.slice(-3000),
    ...report,
  }, null, 2));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 100; i++) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(150);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}, options = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, options.timeoutMs || 10000);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

async function evaluate(ws, expression, options = {}) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, { timeoutMs: options.timeoutMs });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function closeBrowser(ws) {
  try {
    await wsRequest(ws, 'Browser.close', {}, { timeoutMs: 2000 });
  } catch {
    try { ws.close(); } catch {}
  }
  if (!chromeProcess) return;
  await delay(250);
  if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) {
    chromeProcess.kill('SIGTERM');
    await delay(250);
  }
  if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) {
    chromeProcess.kill('SIGKILL');
  }
}

function assertPng(buffer, label) {
  assert.ok(buffer.length > 1024, `${label} PNG is too small to be credible visual evidence`);
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, `${label} is not a PNG`);
}

async function configureMotionPanel(ws) {
  return evaluate(ws, `(() => {
    const requireEl = id => {
      const el = document.getElementById(id);
      if (!el) throw new Error('missing motion panel control #' + id);
      return el;
    };
    const setSelectValue = (id, value) => {
      const el = requireEl(id);
      const next = String(value);
      if (![...el.options].some(option => option.value === next)) throw new Error('#' + id + ' has no option ' + next);
      el.value = next;
      return el.value;
    };
    requireEl('motion-panel-prompt').value = ${JSON.stringify(prompt)};
    requireEl('motion-panel-server-url').value = ${JSON.stringify(serverUrl)};
    requireEl('motion-panel-source-ghost-mode').value = ${JSON.stringify(sourceMode)};
    requireEl('motion-panel-source-opacity').value = ${JSON.stringify(String(sourceOpacity))};
    requireEl('motion-panel-duration').value = ${JSON.stringify(String(duration))};
    requireEl('motion-panel-steps').value = ${JSON.stringify(String(steps))};
    const exportValues = ${JSON.stringify(exportCurrentView)} ? {
      frames: setSelectValue('motion-panel-export-frames', ${JSON.stringify(String(frameTotal))}),
      columns: setSelectValue('motion-panel-export-columns', ${JSON.stringify(String(columns))}),
      tileWidth: setSelectValue('motion-panel-export-resolution', ${JSON.stringify(String(tileWidth))}),
      referenceMode: setSelectValue('motion-panel-export-reference', ${JSON.stringify(exportReferenceMode)}),
    } : null;
    for (const id of ['motion-panel-source-ghost-mode', 'motion-panel-source-opacity', 'motion-panel-duration', 'motion-panel-steps', 'motion-panel-export-reference']) {
      document.getElementById(id)?.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById(id)?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return {
      prompt: requireEl('motion-panel-prompt').value,
      serverUrl: requireEl('motion-panel-server-url').value,
      sourceMode: requireEl('motion-panel-source-ghost-mode').value,
      sourceOpacity: requireEl('motion-panel-source-opacity').value,
      duration: requireEl('motion-panel-duration').value,
      steps: requireEl('motion-panel-steps').value,
      exportValues,
    };
  })()`);
}

async function generateMotion(ws) {
  return evaluate(ws, `window.generateMotion().then(result => ({
    ok: true,
    clipId: result?.clip?.id || null,
    label: result?.clip?.label || null,
    frameCount: result?.clip?.temporalSamples?.length || null,
    take: result?.take || null,
    takeShelf: typeof window.kaminosMotionPanelTakeShelfDebugState === 'function'
      ? window.kaminosMotionPanelTakeShelfDebugState()
      : null,
    state: result?.state || null,
  })).catch(error => ({
    ok: false,
    error: String(error?.message || error),
  }))`, { timeoutMs: 240000 });
}

async function captureFrame(ws, index) {
  const debug = await evaluate(ws, `(() => {
    const state = window.kaminosGeneratedPoseTemporalDebugState?.();
    const actor = state?.actors?.[0] || null;
    const sourceGhost = actor?.sourceGhost || state?.sourceGhost || null;
    const canvas = document.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    return {
      index: ${index},
      route: state?.route || null,
      status: document.getElementById('motion-panel-temporal-status')?.textContent || null,
      info: document.getElementById('info')?.textContent || null,
      envLoadingDisplay: getComputedStyle(document.getElementById('env-loading')).display,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
      canvasRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      actorRoot: actor?.root || null,
      behaviorState: actor?.behaviorState || null,
      sourceFrame: actor?.sourceFrame ?? null,
      sourceInterpolation: actor?.sourceInterpolation ?? null,
      sourceGhost,
    };
  })()`, { timeoutMs: 20000 });
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true }, { timeoutMs: 20000 });
  const png = Buffer.from(shot.data, 'base64');
  assertPng(png, `frame ${index}`);
  const path = `${outDir}/frame-${String(index).padStart(3, '0')}.png`;
  writeFileSync(path, png);
  return {
    schema: 'kaminos.motion-panel-live-frame.v0',
    index,
    path,
    bytes: png.length,
    screenshotDataUrl: `data:image/png;base64,${shot.data}`,
    debug,
  };
}

async function composeFilmstrip(ws, frames) {
  const payload = {
    schema: 'kaminos.motion-panel-live-filmstrip.v0',
    prompt,
    tileWidth,
    columns,
    frames: frames.map(frame => ({
      index: frame.index,
      screenshotDataUrl: frame.screenshotDataUrl,
      behaviorState: frame.debug?.behaviorState?.state || null,
      behaviorPhase: frame.debug?.behaviorState?.phase || null,
      sourceFrame: frame.debug?.sourceFrame ?? null,
      canvasRect: frame.debug?.canvasRect || null,
      viewport: frame.debug?.viewport || null,
    })),
  };
  const result = await evaluate(ws, `(async () => {
    const payload = ${JSON.stringify(payload)};
    const images = await Promise.all(payload.frames.map(frame => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load screenshot for filmstrip frame ' + frame.index));
      img.src = frame.screenshotDataUrl;
    })));
    if (!images.length) throw new Error('no frames for filmstrip');
    const firstFrame = payload.frames[0];
    const firstImage = images[0];
    const viewport = firstFrame.viewport || { width: firstImage.naturalWidth, height: firstImage.naturalHeight };
    const scaleX = firstImage.naturalWidth / Math.max(1, viewport.width || firstImage.naturalWidth);
    const scaleY = firstImage.naturalHeight / Math.max(1, viewport.height || firstImage.naturalHeight);
    const cssRect = firstFrame.canvasRect || { x: 0, y: 0, width: viewport.width || firstImage.naturalWidth, height: viewport.height || firstImage.naturalHeight };
    const crop = {
      x: Math.max(0, Math.round(cssRect.x * scaleX)),
      y: Math.max(0, Math.round(cssRect.y * scaleY)),
      width: Math.max(1, Math.round(cssRect.width * scaleX)),
      height: Math.max(1, Math.round(cssRect.height * scaleY)),
    };
    crop.width = Math.min(crop.width, firstImage.naturalWidth - crop.x);
    crop.height = Math.min(crop.height, firstImage.naturalHeight - crop.y);
    const labelHeight = 46;
    const tileWidth = payload.tileWidth;
    const tileHeight = Math.max(1, Math.round(tileWidth * crop.height / crop.width));
    const columnCount = payload.columns;
    const rowCount = Math.ceil(images.length / columnCount);
    const canvas = document.createElement('canvas');
    canvas.width = tileWidth * columnCount;
    canvas.height = (tileHeight + labelHeight) * rowCount;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i < images.length; i++) {
      const column = i % columnCount;
      const row = Math.floor(i / columnCount);
      const x = column * tileWidth;
      const y = row * (tileHeight + labelHeight);
      ctx.drawImage(images[i], crop.x, crop.y, crop.width, crop.height, x, y + labelHeight, tileWidth, tileHeight);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
      ctx.fillRect(x, y, tileWidth, labelHeight);
      ctx.fillStyle = 'rgba(240, 210, 138, 0.96)';
      const frame = payload.frames[i];
      const sourceFrame = Number.isFinite(Number(frame.sourceFrame)) ? Number(frame.sourceFrame).toFixed(1) : 'n/a';
      ctx.fillText('frame ' + String(frame.index).padStart(2, '0') + '  source ' + sourceFrame, x + 10, y + 7);
      ctx.fillStyle = 'rgba(255, 239, 196, 0.86)';
      const state = [frame.behaviorState, frame.behaviorPhase].filter(Boolean).join(' / ') || 'generated motion';
      ctx.fillText(state.slice(0, 42), x + 10, y + 25);
    }
    return {
      schema: 'kaminos.motion-panel-live-filmstrip.v0',
      width: canvas.width,
      height: canvas.height,
      crop,
      tileWidth,
      tileHeight,
      columns: columnCount,
      rows: rowCount,
      imageDataUrl: canvas.toDataURL('image/png'),
    };
  })()`, { timeoutMs: 120000 });
  const base64 = String(result.imageDataUrl || '').replace(/^data:image\/png;base64,/, '');
  const png = Buffer.from(base64, 'base64');
  assertPng(png, 'filmstrip');
  mkdirSync(dirname(filmstripPath), { recursive: true });
  writeFileSync(filmstripPath, png);
  return {
    schema: result.schema,
    path: filmstripPath,
    bytes: png.length,
    width: result.width,
    height: result.height,
    crop: result.crop,
    tileWidth: result.tileWidth,
    tileHeight: result.tileHeight,
    columns: result.columns,
    rows: result.rows,
  };
}

async function exportCurrentViewFilmstrip(ws) {
  const result = await evaluate(ws, `(async () => {
    const parseVec = value => String(value || '')
      .split(',')
      .map(part => Number(part.trim()))
      .filter(number => Number.isFinite(number));
    const cameraPosition = parseVec(${JSON.stringify(cameraPosition)});
    const cameraTarget = parseVec(${JSON.stringify(cameraTarget)});
    if (cameraPosition.length || cameraTarget.length) {
      if (typeof window.kaminosSetCameraDebugPose !== 'function') throw new Error('camera debug pose setter unavailable');
      window.kaminosSetCameraDebugPose({
        position: cameraPosition.length === 3 ? cameraPosition : undefined,
        target: cameraTarget.length === 3 ? cameraTarget : undefined,
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const cameraBefore = typeof window.motionPanelCurrentViewCameraEvidence === 'function'
      ? window.motionPanelCurrentViewCameraEvidence()
      : null;
    const sourceModeBeforeExport = document.getElementById('motion-panel-source-ghost-mode')?.value || null;
    if (typeof window.exportMotionPanelCurrentViewFilmstrip !== 'function') throw new Error('current-view export function unavailable');
    const exported = await window.exportMotionPanelCurrentViewFilmstrip();
    if (!exported?.dataUrl?.startsWith('data:image/png;base64,')) throw new Error('current-view export did not return a PNG data URL');
    const sourceModeAfterExport = document.getElementById('motion-panel-source-ghost-mode')?.value || null;
    return {
      schema: 'kaminos.motion-panel-live-current-view-export.v0',
      status: document.getElementById('motion-panel-temporal-status')?.textContent || null,
      cameraBefore,
      cameraAfter: exported.camera || null,
      requestedExportReferenceMode: ${JSON.stringify(exportReferenceMode)},
      sourceModeBeforeExport,
      sourceModeAfterExport,
      referenceMode: exported.referenceMode || null,
      effectiveReferenceMode: exported.effectiveReferenceMode || null,
      previousReferenceMode: exported.previousReferenceMode || null,
      referenceOverrideApplied: !!exported.referenceOverrideApplied,
      selectedTake: exported.selectedTake || null,
      sourceGhostAtExportStart: exported.sourceGhostAtExportStart || null,
      sourceGhostAtExportEnd: exported.sourceGhostAtExportEnd || null,
      prompt: exported.prompt || null,
      settings: exported.settings || null,
      width: exported.width || null,
      height: exported.height || null,
      frameCount: exported.frameCount || null,
      columns: exported.columns || null,
      rows: exported.rows || null,
      downloadName: exported.downloadName || null,
      dataUrl: exported.dataUrl,
    };
  })()`, { timeoutMs: 240000 });
  const base64 = String(result.dataUrl || '').replace(/^data:image\/png;base64,/, '');
  const png = Buffer.from(base64, 'base64');
  assertPng(png, 'current-view export filmstrip');
  mkdirSync(dirname(filmstripPath), { recursive: true });
  writeFileSync(filmstripPath, png);
  const { dataUrl, ...reportable } = result;
  return {
    ...reportable,
    path: filmstripPath,
    bytes: png.length,
  };
}

try {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-default-apps',
    '--window-size=1400,900',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  chromeProcess.once('error', error => { stderr += `\nChrome launch failed: ${error.message}`; });

  phase = 'connecting-cdp';
  const version = await waitForCdp();
  browserVersion = version.Browser || null;
  const pages = await cdpFetch('/json/list');
  const page = pages.find(entry => entry.type === 'page') || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable Chrome page found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.bringToFront').catch(() => null);

  phase = 'settling-route';
  await delay(settleMs);
  effectiveUrl = await evaluate(ws, 'window.location.href');
  if (!effectiveUrl.includes('kaminos_motion_agency=1')) throw new Error(`effective URL lost motion route: ${effectiveUrl}`);
  const preflight = await evaluate(ws, `(() => ({
    href: location.href,
    hasGenerateMotion: typeof window.generateMotion === 'function',
    panelPresent: !!document.getElementById('motion-panel-orb-preview'),
    envLoadingDisplay: getComputedStyle(document.getElementById('env-loading')).display,
    envLoadingText: document.getElementById('env-loading')?.textContent || null,
  }))()`);
  if (!preflight.hasGenerateMotion || !preflight.panelPresent) throw new Error(`live motion panel unavailable: ${JSON.stringify(preflight)}`);

  phase = 'configuring-panel';
  const configured = await configureMotionPanel(ws);

  phase = 'generating-motion';
  const generated = await generateMotion(ws);
  if (!generated?.ok) throw new Error(`window.generateMotion() failed: ${JSON.stringify(generated)}`);
  if (!generated?.takeShelf?.selectedTake) throw new Error(`motion take shelf did not select generated take: ${JSON.stringify(generated?.takeShelf || null)}`);
  await delay(settleMs);

  let filmstrip = null;
  let frames = [];
  if (exportCurrentView) {
    phase = 'exporting-current-view-filmstrip';
    filmstrip = await exportCurrentViewFilmstrip(ws);
    if (!filmstrip?.selectedTake) throw new Error(`current-view export did not record selected take: ${JSON.stringify(filmstrip || null)}`);
  } else {
    phase = 'capturing-frames';
    const capturedFrames = [];
    for (let index = 0; index < frameTotal; index++) {
      capturedFrames.push(await captureFrame(ws, index));
      if (index < frameTotal - 1) await delay(intervalMs);
    }

    phase = 'composing-filmstrip';
    filmstrip = await composeFilmstrip(ws, capturedFrames);
    frames = capturedFrames.map(({ screenshotDataUrl, ...frame }) => frame);
  }

  phase = 'writing-report';
  writeReport({
    ok: true,
    preflight,
    configured,
    generated,
    takeShelf: generated?.takeShelf || null,
    frames,
    filmstrip,
  });
  await closeBrowser(ws);
} catch (error) {
  writeReport({
    ok: false,
    error: error.stack || String(error),
  });
  if (chromeProcess) chromeProcess.kill('SIGTERM');
  throw error;
}

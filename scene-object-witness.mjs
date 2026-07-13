#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8095/';
const out = resolve(args.get('--out') || '/tmp/kaminos-scene-object-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9439);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-scene-object-witness-profile-${port}-${process.pid}`;
const settleMs = Number(args.get('--settle-ms') || 3500);
const scenario = args.get('--scenario') || 'append-select-remove-keyboard';
const expectedServerRoot = args.get('--expected-server-root') ? resolve(args.get('--expected-server-root')) : null;
const headless = process.env.KAMINOS_WITNESS_HEADLESS !== '0';
const hybridModuleUrl = args.get('--hybrid-module-url') || null;
const splatAssetName = args.get('--splat-asset-name') || null;

let phase = 'initializing';
let stderr = '';
let lastEvidence = {};
let effectiveUrl = null;
let effectiveServerRoots = null;
let browserVersion = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    requestedUrl: url,
    effectiveUrl: effectiveUrl,
    effectiveServerRoots: effectiveServerRoots,
    expectedServerRoot: expectedServerRoot,
    scenario,
    debugPort: port,
    chrome,
    userDataDir,
    settleMs,
    phase,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    ...report,
  }, null, 2));
}

function assertPngScreenshot(buffer) {
  assert.ok(buffer.length > 1024, 'screenshot is too small to be credible visual evidence');
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
}

function siblingPngPath(suffix) {
  return out.replace(/\.png$/i, `${suffix}.png`);
}

async function capturePngScreenshot(ws, screenshotPath) {
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assertPngScreenshot(png);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, png);
  return { path: screenshotPath, bytes: png.length };
}

function decodePng8(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG format for visual sample: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * channels);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[prevStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[prevStart + x - channels] : 0;
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      const predictor = pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft);
      const encoded = raw[src++];
      let value = encoded;
      if (filter === 1) value = encoded + left;
      else if (filter === 2) value = encoded + up;
      else if (filter === 3) value = encoded + Math.floor((left + up) / 2);
      else if (filter === 4) value = encoded + predictor;
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      pixels[rowStart + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function comparePresentationScreenshots(pathA, pathB, hostRect) {
  const a = decodePng8(readFileSync(pathA));
  const b = decodePng8(readFileSync(pathB));
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error(`presentation screenshots differ in format: ${pathA} vs ${pathB}`);
  }
  const rect = hostRect || { x: 0, y: 0, width: a.width, height: a.height };
  const scaleX = a.width / Math.max(1, rect.x + rect.width);
  const scaleY = a.height / Math.max(1, rect.y + rect.height);
  const minX = Math.max(0, Math.floor(rect.x * scaleX));
  const maxX = Math.min(a.width - 1, Math.ceil((rect.x + rect.width) * scaleX) - 1);
  const minY = Math.max(0, Math.floor(rect.y * scaleY));
  const maxY = Math.min(a.height - 1, Math.ceil((rect.y + rect.height) * scaleY) - 1);
  let sampledPixels = 0;
  let changedPixels = 0;
  let absDiffSum = 0;
  let maxDiff = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = (y * a.width + x) * a.channels;
      const diff = Math.abs(a.pixels[index] - b.pixels[index])
        + Math.abs(a.pixels[index + 1] - b.pixels[index + 1])
        + Math.abs(a.pixels[index + 2] - b.pixels[index + 2]);
      sampledPixels += 1;
      absDiffSum += diff;
      maxDiff = Math.max(maxDiff, diff);
      if (diff >= 12) changedPixels += 1;
    }
  }
  return {
    rect: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    sampledPixels,
    changedPixels,
    changedFraction: sampledPixels > 0 ? changedPixels / sampledPixels : 0,
    absDiffSum,
    maxDiff,
  };
}

function sampleRealHybridScreenshot(buffer, evidence) {
  const image = decodePng8(buffer);
  const hostRect = evidence?.overlayHost?.rect || { x: 0, y: 0, width: image.width, height: image.height };
  const probe = evidence?.cameraCoherence?.projectionProbeB?.pbrnextOverlayScreen
    || evidence?.cameraCoherence?.projectionProbeA?.pbrnextOverlayScreen
    || { x: hostRect.width / 2, y: hostRect.height / 2 };
  const hostRight = Math.max(1, hostRect.x + hostRect.width);
  const hostBottom = Math.max(1, hostRect.y + hostRect.height);
  const scaleX = image.width / hostRight;
  const scaleY = image.height / hostBottom;
  const cx = Math.round((hostRect.x + probe.x) * scaleX);
  const cy = Math.round((hostRect.y + probe.y) * scaleY);
  const radius = 140;
  let minX = Math.max(0, cx - radius);
  let maxX = Math.min(image.width - 1, cx + radius);
  let minY = Math.max(0, cy - radius);
  let maxY = Math.min(image.height - 1, cy + radius);
  if (maxX < minX || maxY < minY) {
    minX = Math.max(0, Math.round(hostRect.x * scaleX));
    maxX = Math.min(image.width - 1, Math.round((hostRect.x + hostRect.width) * scaleX));
    minY = Math.max(0, Math.round(hostRect.y * scaleY));
    maxY = Math.min(image.height - 1, Math.round((hostRect.y + hostRect.height) * scaleY));
  }
  let sampledPixels = 0;
  let edgePixels = 0;
  let emissivePixels = 0;
  let brightPixels = 0;
  const lumaAt = (x, y) => {
    const index = (y * image.width + x) * image.channels;
    const r = image.pixels[index];
    const g = image.pixels[index + 1];
    const b = image.pixels[index + 2];
    return { r, g, b, y: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  };
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p = lumaAt(x, y);
      sampledPixels += 1;
      if (p.r > 120 && p.g > 35 && p.g < 190 && p.b < 110 && p.r > p.g * 1.12) emissivePixels += 1;
      if (p.r + p.g + p.b > 420) brightPixels += 1;
      if (x < maxX) {
        const r = lumaAt(x + 1, y);
        if (Math.abs(p.y - r.y) > 18) edgePixels += 1;
      }
      if (y < maxY) {
        const d = lumaAt(x, y + 1);
        if (Math.abs(p.y - d.y) > 18) edgePixels += 1;
      }
    }
  }
  return {
    sampled: true,
    image: { width: image.width, height: image.height, channels: image.channels },
    center: { x: cx, y: cy },
    rect: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    sampledPixels,
    edgePixels,
    emissivePixels,
    brightPixels,
    visible: edgePixels > 500 || emissivePixels > 8 || brightPixels > 100,
  };
}

function assertRealHybridScreenshotVisible(screenshotPath) {
  const evidence = lastEvidence.realHybridSplatOverlay;
  if (!evidence) return;
  const sample = sampleRealHybridScreenshot(readFileSync(screenshotPath), evidence);
  evidence.screenshotSample = sample;
  if ((evidence.afterSample?.visiblePixels || 0) <= 0 && !sample.visible) {
    throw new Error(`real hybrid splat overlay screenshot has no visible splat-region geometry: ${JSON.stringify({
      afterSample: evidence.afterSample,
      screenshotSample: sample,
      overlayDebug: evidence.overlayDebug,
    })}`);
  }
}

function screenshotPointForHostScreen(image, hostRect, screen) {
  const hostRight = Math.max(1, hostRect.x + hostRect.width);
  const hostBottom = Math.max(1, hostRect.y + hostRect.height);
  return {
    x: Math.round((hostRect.x + screen.x) * (image.width / hostRight)),
    y: Math.round((hostRect.y + screen.y) * (image.height / hostBottom)),
  };
}

function comparePngRegion(pathA, pathB, evidence, radius = 90) {
  const a = decodePng8(readFileSync(pathA));
  const b = decodePng8(readFileSync(pathB));
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error(`cannot compare screenshots with different formats: ${pathA} vs ${pathB}`);
  }
  const hostRect = evidence?.overlayHost?.rect || { x: 0, y: 0, width: a.width, height: a.height };
  const screen = evidence?.occluder?.screen;
  const center = screenshotPointForHostScreen(a, hostRect, screen || { x: hostRect.width / 2, y: hostRect.height / 2 });
  const minX = Math.max(0, center.x - radius);
  const maxX = Math.min(a.width - 1, center.x + radius);
  const minY = Math.max(0, center.y - radius);
  const maxY = Math.min(a.height - 1, center.y + radius);
  let sampledPixels = 0;
  let changedPixels = 0;
  let absDiffSum = 0;
  let maxDiff = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = (y * a.width + x) * a.channels;
      const dr = Math.abs(a.pixels[index] - b.pixels[index]);
      const dg = Math.abs(a.pixels[index + 1] - b.pixels[index + 1]);
      const db = Math.abs(a.pixels[index + 2] - b.pixels[index + 2]);
      const diff = dr + dg + db;
      sampledPixels += 1;
      absDiffSum += diff;
      maxDiff = Math.max(maxDiff, diff);
      if (diff > 40) changedPixels += 1;
    }
  }
  return {
    sampled: true,
    center,
    rect: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    sampledPixels,
    changedPixels,
    changedRatio: sampledPixels > 0 ? changedPixels / sampledPixels : 0,
    meanAbsDiff: sampledPixels > 0 ? absDiffSum / sampledPixels : 0,
    maxDiff,
  };
}

async function cdpFetch(path, options) {
  const { timeoutMs = 5000, ...fetchOptions } = options || {};
  if (!fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(timeoutMs);
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, fetchOptions);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function isCdpEndpointOpen() {
  try {
    await cdpFetch('/json/version', { timeoutMs: 300 });
    return true;
  } catch {
    return false;
  }
}

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
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
    awaitPromise: true,
    returnByValue: true,
    expression,
  }, { timeoutMs: options.timeoutMs });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function runMeshAssetLinkScenario(ws) {
  phase = 'scenario-mesh-asset-link';
  lastEvidence.meshAssetLink = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitForAssetLink = async () => {
        for (let i = 0; i < 160; i++) {
          const state = window.kaminosAssetSmokeLinkDebugState?.();
          const objects = window.kaminosSceneObjectDebugState?.() || [];
          if (state?.status === 'loaded' && state.registeredObjectId && objects.some(object => object.id === state.registeredObjectId)) {
            return { state, objects };
          }
          if (state?.status === 'failed') {
            throw new Error('mesh asset link failed before registration: ' + JSON.stringify(state));
          }
          await wait(125);
        }
        return {
          state: window.kaminosAssetSmokeLinkDebugState?.() || null,
          objects: window.kaminosSceneObjectDebugState?.() || [],
        };
      };
      const evidence = await waitForAssetLink();
      const state = evidence.state;
      if (!state || state.schema !== 'kaminos.asset-smoke-link.v0') {
        throw new Error('mesh asset link debug state missing schema: ' + JSON.stringify(evidence));
      }
      if (state.assetType !== 'mesh') {
        throw new Error('mesh asset link debug state used wrong asset type: ' + JSON.stringify(state));
      }
      if (!state.requestedRoot || !state.requestedPath || !state.effectiveUrl?.includes('/api/read?')) {
        throw new Error('mesh asset link did not preserve requested/effective route identity: ' + JSON.stringify(state));
      }
      const object = evidence.objects.find(record => record.id === state.registeredObjectId);
      if (!object || object.type !== 'glb' || object.source !== state.effectiveUrl) {
        throw new Error('mesh asset link did not register the loaded GLB as a scene object: ' + JSON.stringify({ state, object, objects: evidence.objects }));
      }
      const resourceNames = performance.getEntriesByType('resource').map(entry => entry.name);
      const requestedResource = resourceNames.find(name => name.includes('/api/read?') && name.includes('root=' + encodeURIComponent(state.requestedRoot)) && name.includes('path=' + encodeURIComponent(state.requestedPath)));
      if (!requestedResource) {
        throw new Error('mesh asset link registered without a matching browser resource request: ' + JSON.stringify({ state, resourceNames }));
      }
      const row = [...document.querySelectorAll('[data-scene-object-id]')].find(row => row.dataset.sceneObjectId === state.registeredObjectId);
      if (!row) {
        throw new Error('mesh asset link registered object missing from scene object list: ' + JSON.stringify({ state, rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => row.dataset.sceneObjectId) }));
      }
      return {
        state,
        object,
        requestedResource,
        rowText: row.textContent.trim(),
        info: document.getElementById('info-bar')?.textContent?.trim() || null,
      };
    })()
  `, { timeoutMs: 45000 });
}

async function runSplatAssetLinkScenario(ws) {
  phase = 'scenario-splat-asset-link';
  lastEvidence.splatAssetLink = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitForAssetLink = async () => {
        for (let i = 0; i < 160; i++) {
          const state = window.kaminosAssetSmokeLinkDebugState?.();
          const objects = window.kaminosSceneObjectDebugState?.() || [];
          if (state?.status === 'loaded' && state.registeredObjectId && objects.some(object => object.id === state.registeredObjectId)) {
            return { state, objects };
          }
          if (state?.status === 'failed') {
            throw new Error('splat asset link failed before registration: ' + JSON.stringify(state));
          }
          await wait(125);
        }
        return {
          state: window.kaminosAssetSmokeLinkDebugState?.() || null,
          objects: window.kaminosSceneObjectDebugState?.() || [],
        };
      };
      const evidence = await waitForAssetLink();
      const state = evidence.state;
      if (!state || state.schema !== 'kaminos.asset-smoke-link.v0') {
        throw new Error('splat asset link debug state missing schema: ' + JSON.stringify(evidence));
      }
      if (state.assetType !== 'splat') {
        throw new Error('splat asset link debug state used wrong asset type: ' + JSON.stringify(state));
      }
      if (!state.requestedRoot || !state.requestedPath || !state.effectiveUrl?.includes('/api/read?')) {
        throw new Error('splat asset link did not preserve requested/effective route identity: ' + JSON.stringify(state));
      }
      const object = evidence.objects.find(record => record.id === state.registeredObjectId);
      if (!object || object.type !== 'splat' || object.source !== state.effectiveUrl) {
        throw new Error('splat asset link did not register the loaded PLY as a splat scene object: ' + JSON.stringify({ state, object, objects: evidence.objects }));
      }
      if (object.splat?.format !== 'ply' || !object.splat?.previewKind) {
        throw new Error('splat asset link registered without PLY splat preview metadata: ' + JSON.stringify({ state, object }));
      }
      const resourceNames = performance.getEntriesByType('resource').map(entry => entry.name);
      const requestedResource = resourceNames.find(name => name.includes('/api/read?') && name.includes('root=' + encodeURIComponent(state.requestedRoot)) && name.includes('path=' + encodeURIComponent(state.requestedPath)));
      if (!requestedResource) {
        throw new Error('splat asset link registered without a matching browser resource request: ' + JSON.stringify({ state, resourceNames }));
      }
      const row = [...document.querySelectorAll('[data-scene-object-id]')].find(row => row.dataset.sceneObjectId === state.registeredObjectId);
      if (!row) {
        throw new Error('splat asset link registered object missing from scene object list: ' + JSON.stringify({ state, rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => row.dataset.sceneObjectId) }));
      }
      return {
        state,
        object,
        requestedResource,
        rowText: row.textContent.trim(),
        info: document.getElementById('info-bar')?.textContent?.trim() || null,
      };
    })()
  `, { timeoutMs: 45000 });
}

async function runHybridRendererModuleWrongServerScenario(ws) {
  phase = 'scenario-hybrid-renderer-module-wrong-server';
  lastEvidence.hybridRendererModuleWrongServer = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitForLinkedSplat = async () => {
        for (let i = 0; i < 160; i++) {
          const state = window.kaminosAssetSmokeLinkDebugState?.();
          const objects = window.kaminosSceneObjectDebugState?.() || [];
          const object = state?.registeredObjectId
            ? objects.find(record => record.id === state.registeredObjectId)
            : objects.find(record => record.type === 'splat');
          if (object?.type === 'splat') return { state, object, objects };
          if (state?.status === 'failed') {
            throw new Error('wrong-server module witness could not load splat route first: ' + JSON.stringify(state));
          }
          await wait(125);
        }
        return {
          state: window.kaminosAssetSmokeLinkDebugState?.() || null,
          object: (window.kaminosSceneObjectDebugState?.() || []).find(record => record.type === 'splat') || null,
          objects: window.kaminosSceneObjectDebugState?.() || [],
        };
      };
      const linked = await waitForLinkedSplat();
      if (!linked.object?.id) {
        throw new Error('wrong-server module witness did not start from a loaded splat: ' + JSON.stringify(linked));
      }
      window.selectSceneObject?.(linked.object.id);
      await wait(100);
      const wrongModuleUrl = new URL('/', location.href).href;
      window.kaminosSetHybridSplatOverlayModuleUrl?.(wrongModuleUrl);
      let startResult = null;
      let thrown = null;
      try {
        startResult = await window.startHybridSplatSceneRenderer?.();
      } catch (error) {
        thrown = String(error?.message || error);
      }
      await wait(400);
      const overlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const moduleDebug = window.kaminosHybridSplatRendererModuleDebugState?.() || null;
      const info = document.getElementById('info-bar')?.textContent?.trim() || null;
      return {
        linked,
        wrongModuleUrl,
        startResult,
        thrown,
        overlayDebug,
        moduleDebug,
        info,
      };
    })()
  `, { timeoutMs: 45000 });
  const evidence = lastEvidence.hybridRendererModuleWrongServer;
  if (evidence.thrown) {
    throw new Error(`wrong-server module leaked an uncaught exception: ${evidence.thrown}`);
  }
  const message = `${evidence.overlayDebug?.error || ''} ${evidence.moduleDebug?.error || ''} ${evidence.info || ''}`;
  if (evidence.overlayDebug?.status !== 'error'
      || evidence.moduleDebug?.status !== 'failed'
      || !/Hybrid Renderer module unavailable/.test(message)
      || !/expected JavaScript module/.test(message)) {
    throw new Error(`wrong-server module did not fail with renderer module diagnostics: ${JSON.stringify(evidence)}`);
  }
  if (evidence.moduleDebug?.moduleUrl !== evidence.wrongModuleUrl
      || evidence.moduleDebug?.contentType?.includes('html') !== true) {
    throw new Error(`wrong-server module diagnostics did not preserve effective HTML response identity: ${JSON.stringify(evidence)}`);
  }
}

async function runHybridRendererDefaultPackageRouteScenario(ws) {
  phase = 'scenario-hybrid-renderer-default-package-route';
  lastEvidence.hybridRendererDefaultPackageRoute = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      localStorage.removeItem('kaminosHybridSplatOverlayModuleUrl');
      const waitForLinkedSplat = async () => {
        for (let i = 0; i < 160; i++) {
          const state = window.kaminosAssetSmokeLinkDebugState?.();
          const objects = window.kaminosSceneObjectDebugState?.() || [];
          const object = state?.registeredObjectId
            ? objects.find(record => record.id === state.registeredObjectId)
            : objects.find(record => record.type === 'splat');
          if (object?.type === 'splat') return { state, object, objects };
          if (state?.status === 'failed') {
            throw new Error('default package route witness could not load splat route first: ' + JSON.stringify(state));
          }
          await wait(125);
        }
        return {
          state: window.kaminosAssetSmokeLinkDebugState?.() || null,
          object: (window.kaminosSceneObjectDebugState?.() || []).find(record => record.type === 'splat') || null,
          objects: window.kaminosSceneObjectDebugState?.() || [],
        };
      };
      const linked = await waitForLinkedSplat();
      if (!linked.object?.id) {
        throw new Error('default package route witness did not start from a loaded splat: ' + JSON.stringify(linked));
      }
      window.selectSceneObject?.(linked.object.id);
      await wait(100);
      let startResult = null;
      let thrown = null;
      try {
        startResult = await window.startSelectedSplatHybridRenderer?.();
      } catch (error) {
        thrown = String(error?.message || error);
      }
      await wait(900);
      const overlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const moduleDebug = window.kaminosHybridSplatRendererModuleDebugState?.() || null;
      const routeDebug = window.kaminosHybridMeshSplatRouteDebugState?.() || null;
      return {
        linked,
        startResult,
        thrown,
        overlayDebug,
        moduleDebug,
        routeDebug,
      };
    })()
  `, { timeoutMs: 45000 });
  const evidence = lastEvidence.hybridRendererDefaultPackageRoute;
  if (evidence.thrown) {
    throw new Error(`default package route leaked an uncaught exception: ${evidence.thrown}`);
  }
  if (evidence.moduleDebug?.moduleUrl !== '/vendor/meshsplat-renderer/splatOverlay.js'
      || evidence.moduleDebug?.source !== 'packaged-local'
      || evidence.moduleDebug?.packageRoute !== '/vendor/meshsplat-renderer/splatOverlay.js'
      || evidence.moduleDebug?.moduleUrl?.includes('127.0.0.1:5173')) {
    throw new Error(`default package route did not use packaged module identity: ${JSON.stringify(evidence)}`);
  }
  if (evidence.moduleDebug?.status !== 'loaded'
      || evidence.overlayDebug?.status !== 'rendering'
      || evidence.startResult?.status !== 'rendering'
      || evidence.overlayDebug?.rendererMode !== 'scene'
      || !evidence.overlayDebug?.sceneSplatIds?.includes(evidence.linked.object.id)) {
    throw new Error(`default package route did not start the scene renderer from the packaged route: ${JSON.stringify(evidence)}`);
  }
}

async function runImageAssetLinkScenario(ws) {
  phase = 'scenario-image-asset-link';
  lastEvidence.imageAssetLink = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitForAssetLink = async () => {
        for (let i = 0; i < 160; i++) {
          const state = window.kaminosAssetSmokeLinkDebugState?.();
          const objects = window.kaminosSceneObjectDebugState?.() || [];
          if (state?.status === 'loaded' && state.registeredObjectId && objects.some(object => object.id === state.registeredObjectId)) {
            return { state, objects };
          }
          if (state?.status === 'failed') {
            throw new Error('image asset link failed before registration: ' + JSON.stringify(state));
          }
          await wait(125);
        }
        return {
          state: window.kaminosAssetSmokeLinkDebugState?.() || null,
          objects: window.kaminosSceneObjectDebugState?.() || [],
        };
      };
      const evidence = await waitForAssetLink();
      const state = evidence.state;
      if (!state || state.schema !== 'kaminos.asset-smoke-link.v0') {
        throw new Error('image asset link debug state missing schema: ' + JSON.stringify(evidence));
      }
      if (state.assetType !== 'image') {
        throw new Error('image asset link debug state used wrong asset type: ' + JSON.stringify(state));
      }
      if (!state.requestedRoot || !state.requestedPath || !state.effectiveUrl?.includes('/api/read?')) {
        throw new Error('image asset link did not preserve requested/effective route identity: ' + JSON.stringify(state));
      }
      const object = evidence.objects.find(record => record.id === state.registeredObjectId);
      if (!object || object.type !== 'image' || object.source !== state.effectiveUrl) {
        throw new Error('image asset link did not register the loaded image as a scene object: ' + JSON.stringify({ state, object, objects: evidence.objects }));
      }
      if (object.image?.schema !== 'kaminos.image-plane.v0' || !(object.image.width > 0) || !(object.image.height > 0)) {
        throw new Error('image asset link registered without decoded image-plane metadata: ' + JSON.stringify({ state, object }));
      }
      const resourceNames = performance.getEntriesByType('resource').map(entry => entry.name);
      const requestedResource = resourceNames.find(name => name.includes('/api/read?') && name.includes('root=' + encodeURIComponent(state.requestedRoot)) && name.includes('path=' + encodeURIComponent(state.requestedPath)));
      if (!requestedResource) {
        throw new Error('image asset link registered without a matching browser resource request: ' + JSON.stringify({ state, resourceNames }));
      }
      const row = [...document.querySelectorAll('[data-scene-object-id]')].find(row => row.dataset.sceneObjectId === state.registeredObjectId);
      if (!row) {
        throw new Error('image asset link registered object missing from scene object list: ' + JSON.stringify({ state, rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => row.dataset.sceneObjectId) }));
      }
      return {
        state,
        object,
        requestedResource,
        rowText: row.textContent.trim(),
        info: document.getElementById('info-bar')?.textContent?.trim() || null,
      };
    })()
  `, { timeoutMs: 45000 });
}

async function dispatchMouseClick(ws, point) {
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

async function dispatchMouseDrag(ws, from, to) {
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 1,
  });
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

function normalizeUrlForWitness(value) {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

async function fetchServerRoots(baseUrl) {
  const resp = await fetch(new URL('/api/roots', baseUrl));
  const roots = await resp.json();
  if (!resp.ok || roots.error) {
    throw new Error(`server root identity unavailable: ${roots.error || resp.status}`);
  }
  return roots;
}

function assertExpectedServerRoot(roots) {
  const scenesPath = roots?.scenes?.path;
  if (!scenesPath) throw new Error('server root identity unavailable: missing scenes root');
  if (!isAbsolute(scenesPath)) throw new Error(`server root identity is not absolute: ${scenesPath}`);
  if (!expectedServerRoot) return;
  const effectiveServerRoot = resolve(scenesPath, '..');
  if (effectiveServerRoot !== expectedServerRoot) {
    throw new Error(`effective server root mismatch: expected ${expectedServerRoot} but server reported ${effectiveServerRoot}`);
  }
}

async function runForgeHostSmokeOffersScenario(ws) {
  phase = 'scenario-forge-host-smoke-offers';
  lastEvidence.forgeHostSmokeOffers = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const initial = window.kaminosForgeHostDebugState?.();
      if (!initial?.active) throw new Error('Forge Host stations did not auto-spawn from smoke URL');
      if (initial.manifestSchema !== 'kaminos.forge-host.station-manifest.v0') {
        throw new Error('Forge Host manifest schema mismatch: ' + JSON.stringify(initial));
      }
      if (initial.validation?.falseAuthorityViolations?.length) {
        throw new Error('fixture offer claimed live display authority: ' + JSON.stringify(initial.validation.falseAuthorityViolations));
      }
      if (initial.stationCount < 4) throw new Error('Forge Host station count too small: ' + initial.stationCount);
      if (initial.smokeOfferCount < initial.stationCount) throw new Error('Forge Host smoke offers missing from stations');
      const stationRows = [...document.querySelectorAll('[data-forge-station-actor-id]')].map(row => ({
        actorId: row.dataset.forgeStationActorId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        text: row.textContent.trim(),
      }));
      if (stationRows.length !== initial.stationCount) {
        throw new Error('Forge Host station rows did not match debug state: ' + JSON.stringify({ stationRows, initial }));
      }
      const targetStation = initial.stations.find(station => station.diaulos === 'wake-and-bake-pit-boss') || initial.stations[1];
      window.selectForgeHostStation(targetStation.actorId);
      await wait(250);
      const selected = window.kaminosForgeHostDebugState();
      if (selected.selectedActorId !== targetStation.actorId) {
        throw new Error('Forge Host station selection did not update debug state: ' + JSON.stringify({ targetStation, selected }));
      }
      if (selected.selectedStation.attention.schema !== 'kaminos.forge-host.station-attention.v0') {
        throw new Error('Forge Host selected station lost attention schema: ' + JSON.stringify(selected.selectedStation.attention));
      }
      if (!['camera', 'offer', 'bench', 'wander'].includes(selected.selectedStation.attention.primaryLookTarget)) {
        throw new Error('Forge Host selected station attention target invalid: ' + JSON.stringify(selected.selectedStation.attention));
      }
      const offers = [...document.querySelectorAll('[data-forge-smoke-offer-id]')].map(row => ({
        id: row.dataset.forgeSmokeOfferId,
        text: row.textContent.trim(),
      }));
      if (!offers.length) throw new Error('Forge Host selected station did not render smoke offer rows');
      const opened = window.kaminosOpenForgeHostSmokeOffer(offers[0].id);
      await wait(150);
      const finalState = window.kaminosForgeHostDebugState();
      if (finalState.lastOpenedOffer?.id !== offers[0].id) {
        throw new Error('Forge Host smoke offer did not become last opened offer: ' + JSON.stringify({ offers, finalState }));
      }
      if (opened.schema !== 'kaminos.forge-host.smoke-chamber.v0') {
        throw new Error('Forge Host opened offer did not materialize chamber schema: ' + JSON.stringify(opened));
      }
      if (finalState.smokeChamber?.sourceOffer?.id !== offers[0].id) {
        throw new Error('Forge Host smoke chamber did not preserve opened offer id: ' + JSON.stringify({ offers, finalState }));
      }
      if (opened.displayState === 'live' && ['fixture', 'fallback', 'seeded'].includes(opened.sourceAuthority)) {
        throw new Error('fixture offer claimed live display authority: ' + JSON.stringify(opened));
      }
      return {
        initial,
        stationRows,
        selectedActorId: finalState.selectedActorId,
        selectedAttention: finalState.selectedStation.attention,
        offers,
        openedOffer: finalState.lastOpenedOffer,
      };
    })()
  `, { timeoutMs: 20000 });
}

async function runForgeHostLiveRegistryScenario(ws) {
  phase = 'scenario-forge-host-live-registry';
  lastEvidence.forgeHostLiveRegistry = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i = 0; i < 80; i++) {
        const state = window.kaminosForgeHostDebugState?.();
        if (state?.active && state?.registrySource?.schema === 'kaminos.forge-host.registry-snapshot.v0') break;
        await wait(125);
      }
      const initial = window.kaminosForgeHostDebugState?.();
      if (!initial?.active) throw new Error('Forge Host live registry scene did not activate');
      if (initial.registrySource?.schema !== 'kaminos.forge-host.registry-snapshot.v0') {
        throw new Error('Forge Host live scene did not preserve registry snapshot identity: ' + JSON.stringify(initial));
      }
      if (initial.sourceAuthority !== 'live_registry') {
        throw new Error('live registry scene used fallback authority: ' + JSON.stringify(initial.registrySource));
      }
      if (initial.validation?.falseAuthorityViolations?.length) {
        throw new Error('live registry scene false authority: ' + JSON.stringify(initial.validation.falseAuthorityViolations));
      }
      const liveStations = initial.stations.filter(station => station.sourceAuthority === 'live_registry');
      if (!liveStations.length) throw new Error('Forge Host live registry produced no live stations: ' + JSON.stringify(initial));
      const minion = initial.stations.find(station => station.diaulos === 'minion-spawnfucker');
      if (!minion) throw new Error('Forge Host live registry did not include this Minion endpoint: ' + JSON.stringify(initial.stations.map(station => station.diaulos)));
      if (!minion.endpoint?.thread_id) throw new Error('Forge Host live registry station lost endpoint thread id: ' + JSON.stringify(minion));
      if (minion.smokeOffers?.[0]?.displayState !== 'live') {
        throw new Error('Forge Host live endpoint offer did not display as live: ' + JSON.stringify(minion.smokeOffers?.[0]));
      }
      const stationRows = [...document.querySelectorAll('[data-forge-station-actor-id]')].map(row => ({
        actorId: row.dataset.forgeStationActorId,
        text: row.textContent.trim(),
      }));
      if (stationRows.length !== initial.stationCount) {
        throw new Error('Forge Host live station rows did not match debug state: ' + JSON.stringify({ stationRows, initial }));
      }
      window.selectForgeHostStation(minion.actorId);
      await wait(250);
      const selected = window.kaminosForgeHostDebugState();
      const opened = window.kaminosOpenForgeHostSmokeOffer(selected.selectedStation.smokeOffers[0].id);
      if (opened.sourceAuthority !== 'live' || opened.displayState !== 'live') {
        throw new Error('Forge Host live smoke offer lost live authority: ' + JSON.stringify(opened));
      }
      return {
        initial,
        stationRows,
        selectedActorId: selected.selectedActorId,
        openedOffer: opened,
      };
    })()
  `, { timeoutMs: 25000 });
}

async function runForgeHostSmokeChamberRoutingScenario(ws) {
  phase = 'scenario-forge-host-smoke-chamber-routing';
  lastEvidence.forgeHostSmokeChamberRouting = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i = 0; i < 80; i++) {
        const state = window.kaminosForgeHostDebugState?.();
        if (state?.active && state?.registrySource?.schema === 'kaminos.forge-host.registry-snapshot.v0') break;
        await wait(125);
      }
      const initial = window.kaminosForgeHostDebugState?.();
      if (!initial?.active) throw new Error('Forge Host smoke chamber route did not activate');
      const minion = initial.stations.find(station => station.diaulos === 'minion-spawnfucker');
      if (!minion) throw new Error('Forge Host smoke chamber route missing minion live endpoint: ' + JSON.stringify(initial.stations.map(station => station.diaulos)));
      window.selectForgeHostStation(minion.actorId);
      await wait(250);
      const selected = window.kaminosForgeHostDebugState();
      const offer = selected.selectedStation.smokeOffers[0];
      const chamber = window.kaminosOpenForgeHostSmokeOffer(offer.id);
      await wait(150);
      const finalState = window.kaminosForgeHostDebugState();
      const panel = document.querySelector('#forge-host-smoke-chamber');
      if (!panel) throw new Error('Forge Host smoke chamber panel missing from DOM');
      if (panel.dataset.forgeHostSmokeChamberSchema !== 'kaminos.forge-host.smoke-chamber.v0') {
        throw new Error('Forge Host smoke chamber DOM lost schema identity: ' + panel.outerHTML);
      }
      if (panel.dataset.forgeHostSmokeChamberActive !== 'true') {
        throw new Error('Forge Host smoke chamber panel did not become active: ' + panel.outerHTML);
      }
      if (chamber.schema !== 'kaminos.forge-host.smoke-chamber.v0') {
        throw new Error('Forge Host smoke chamber schema mismatch: ' + JSON.stringify(chamber));
      }
      if (chamber.routeIdentity !== 'forge-host-smoke-offer-route') {
        throw new Error('Forge Host smoke chamber lost route identity: ' + JSON.stringify(chamber));
      }
      if (chamber.sourceOffer?.id !== offer.id || finalState.smokeChamber?.sourceOffer?.id !== offer.id) {
        throw new Error('Forge Host smoke chamber did not preserve source offer identity: ' + JSON.stringify({ offer, chamber, finalState }));
      }
      if (chamber.sourceAuthority !== 'live' || chamber.displayState !== 'live') {
        throw new Error('Forge Host smoke chamber lost live authority: ' + JSON.stringify(chamber));
      }
      if (!/directive-alert-endpoints\\.json#minion-spawnfucker/.test(chamber.sourceRef)) {
        throw new Error('Forge Host smoke chamber lost endpoint source ref: ' + JSON.stringify(chamber));
      }
      if (!chamber.targetUrl) throw new Error('Forge Host smoke chamber lost target URL: ' + JSON.stringify(chamber));
      if (!chamber.routeWarnings?.includes('not_chat_bridge') || !chamber.routeWarnings?.includes('not_command_execution')) {
        throw new Error('Forge Host smoke chamber overclaimed chat or command execution: ' + JSON.stringify(chamber));
      }
      panel.scrollIntoView({ block: 'center' });
      await wait(150);
      const lyingOffer = { ...offer, authority: 'fallback', displayState: 'live' };
      try {
        window.kaminosRouteForgeHostSmokeOfferToChamber(lyingOffer, selected.selectedStation);
      } catch (error) {
        if (!/fallback.*live/i.test(String(error?.message || error))) {
          throw new Error('Forge Host smoke chamber false-authority failure was unclear: ' + String(error?.message || error));
        }
        return {
          initial,
          selectedActorId: selected.selectedActorId,
          offer,
          chamber,
          panelText: panel.textContent.trim(),
          falseAuthorityFailure: String(error?.message || error),
        };
      }
      throw new Error('smoke chamber routed fallback as live');
    })()
  `, { timeoutMs: 25000 });
}

function assertClickedSelection(evidence, phaseLabel, clickedId, otherId) {
  const rows = evidence || [];
  const activeRows = rows.filter(row => row.active && row.pressed === 'true');
  if (activeRows.length !== 1) {
    throw new Error(`${phaseLabel} selection not exclusive: ${JSON.stringify(rows)}`);
  }
  if (activeRows[0].id !== clickedId) {
    throw new Error(`${phaseLabel} selection did not activate the clicked row: ${JSON.stringify({ clickedId, rows })}`);
  }
  const other = rows.find(row => row.id === otherId);
  if (!other || other.active || other.pressed !== 'false') {
    throw new Error(`${phaseLabel} selection did not deactivate other rows: ${JSON.stringify({ otherId, rows })}`);
  }
}

async function runSaveLoadRoundtripScenario(ws) {
  phase = 'scenario-save-load-roundtrip';
  lastEvidence.saveLoadRoundtrip = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const assertSceneDeleted = async (name, label = 'saved') => {
        const cleanup = await deleteScene(name);
        if (cleanup.deleted !== name) {
          throw new Error('cleanup did not delete saved scene file: ' + JSON.stringify({ savedFile: name, cleanup }));
        }
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) {
          throw new Error('post-cleanup scene listing still includes saved scene file: ' + JSON.stringify({ savedFile: name, postCleanupFiles }));
        }
        return { cleanup, postCleanupFiles };
      };
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const groupState = () => window.kaminosSceneGroupDebugState?.() || [];
      const roundTransformValue = value => Number(Number(value || 0).toFixed(4));
      const normalizeTransform = transform => ({
        position: (transform?.position || []).map(roundTransformValue),
        rotation: (transform?.rotation || []).map(roundTransformValue),
        scale: (transform?.scale || []).map(roundTransformValue),
      });
      const transformMatches = (actual, expected, epsilon = 0.001) => {
        const normalizedActual = normalizeTransform(actual);
        const normalizedExpected = normalizeTransform(expected);
        for (const key of ['position', 'rotation', 'scale']) {
          if (normalizedActual[key].length !== 3 || normalizedExpected[key].length !== 3) return false;
          for (let i = 0; i < 3; i++) {
            if (Math.abs(normalizedActual[key][i] - normalizedExpected[key][i]) > epsilon) return false;
          }
        }
        return true;
      };
      const waitForRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');

      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 1) break;
        await wait(125);
      }
      const initialRows = rowState();
      if (initialRows.length !== 1) throw new Error('scene save setup did not start with one object row: ' + JSON.stringify(initialRows));

      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = true;
      demo.click();
      const appendedRows = await waitForRows(2);
      if (appendedRows.length !== 2) throw new Error('scene save setup did not create two object rows: ' + JSON.stringify(appendedRows));
      if (new Set(appendedRows.map(row => row.id)).size !== 2) throw new Error('scene save setup rows were not unique: ' + JSON.stringify(appendedRows));

      const firstId = appendedRows[0].id;
      const secondId = appendedRows[1].id;
      if (typeof window.kaminosSetSceneObjectTransform !== 'function') {
        throw new Error('scene transform witness missing kaminosSetSceneObjectTransform');
      }
      if (typeof window.kaminosSceneObjectDebugState !== 'function') {
        throw new Error('scene transform witness missing kaminosSceneObjectDebugState');
      }
      const transformPlan = {
        [firstId]: {
          position: [-0.75, -0.23, 0.14],
          rotation: [0.11, 0.22, 0.33],
          scale: [0.82, 0.91, 1.07],
        },
        [secondId]: {
          position: [0.68, 0.18, -0.22],
          rotation: [0.04, -0.31, 0.18],
          scale: [1.18, 0.76, 0.94],
        },
      };
      window.kaminosSetSceneObjectTransform(firstId, transformPlan[firstId]);
      window.kaminosSetSceneObjectTransform(secondId, transformPlan[secondId]);
      const transformDebugBeforeSave = window.kaminosSceneObjectDebugState();
      const firstBeforeSave = transformDebugBeforeSave.find(object => object.id === firstId);
      const secondBeforeSave = transformDebugBeforeSave.find(object => object.id === secondId);
      if (!transformMatches(firstBeforeSave?.transform, transformPlan[firstId]) || !transformMatches(secondBeforeSave?.transform, transformPlan[secondId])) {
        throw new Error('scene transform witness could not set distinct object transforms: ' + JSON.stringify({ transformDebugBeforeSave, transformPlan }));
      }
      document.querySelector('[data-scene-object-id="' + firstId + '"]').click();
      await wait(250);
      const beforeSaveRows = rowState();
      const activeBeforeSave = beforeSaveRows.find(row => row.active && row.pressed === 'true')?.id || null;
      if (activeBeforeSave !== firstId) throw new Error('scene save setup did not activate first object before save: ' + JSON.stringify(beforeSaveRows));

      const beforeSceneFiles = new Set(await listScenes());
      await window.saveSceneAs();
      let newFiles = [];
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) break;
        await wait(125);
      }
      if (newFiles.length !== 1) {
        throw new Error('scene save did not create exactly one new scene file: ' + JSON.stringify({ newFiles, before: [...beforeSceneFiles] }));
      }
      const savedFile = newFiles[0];
      const savedScene = await readScene(savedFile);
      if (!Array.isArray(savedScene.objects) || savedScene.objects.length !== 2) {
        throw new Error('saved scene document did not persist two objects: ' + JSON.stringify(savedScene.objects));
      }
      const savedIds = savedScene.objects.map(object => object.id);
      if (!savedIds.includes(firstId) || !savedIds.includes(secondId)) {
        throw new Error('saved scene document ids did not match authored objects: ' + JSON.stringify({ savedIds, firstId, secondId }));
      }
      if (savedScene.activeObjectId !== firstId) {
        throw new Error('saved scene document did not preserve active object id: ' + JSON.stringify({ activeObjectId: savedScene.activeObjectId, firstId }));
      }
      const firstSavedObject = savedScene.objects.find(object => object.id === firstId);
      const secondSavedObject = savedScene.objects.find(object => object.id === secondId);
      if (!transformMatches(firstSavedObject?.transform, transformPlan[firstId]) || !transformMatches(secondSavedObject?.transform, transformPlan[secondId])) {
        throw new Error('saved scene document did not preserve distinct object transforms: ' + JSON.stringify({
          savedTransforms: savedScene.objects.map(object => ({ id: object.id, transform: normalizeTransform(object.transform) })),
          transformPlan,
        }));
      }
      const savedSources = savedScene.objects.map(object => object.source);
      if (!savedSources.every(source => source === 'demos/supermat-ring/')) {
        throw new Error('saved scene document did not preserve reloadable demo sources: ' + JSON.stringify(savedSources));
      }
      if (savedScene.volumePrimitives?.schema !== 'kaminos.volume-primitives.v0') {
        throw new Error('saved scene document did not preserve volume primitive schema: ' + JSON.stringify(savedScene.volumePrimitives));
      }

      document.querySelector('[data-tab="greenroom"]').click();
      let sceneEntry = null;
      for (let i = 0; i < 120; i++) {
        sceneEntry = [...document.querySelectorAll('#scenes-list .gr-entry')].find(entry => (
          entry.querySelector('.gr-name')?.textContent?.trim() === savedFile.replace('.kaminos.json', '')
        ));
        if (sceneEntry) break;
        await wait(125);
      }
      if (!sceneEntry) throw new Error('saved scene did not appear in scene list: ' + savedFile);
      const loadButton = [...sceneEntry.querySelectorAll('button')].find(button => button.textContent.trim() === 'Load');
      if (!loadButton) throw new Error('saved scene list entry missing Load button: ' + savedFile);
      loadButton.click();

      let restoredRows = [];
      for (let i = 0; i < 160; i++) {
        restoredRows = rowState();
        const activeId = restoredRows.find(row => row.active && row.pressed === 'true')?.id || null;
        const info = document.getElementById('info-bar').textContent.trim();
        if (restoredRows.length === 2 && activeId === firstId && info === 'Scene loaded: 2 objects') break;
        await wait(125);
      }
      const activeAfterLoad = restoredRows.find(row => row.active && row.pressed === 'true')?.id || null;
      const infoAfterLoad = document.getElementById('info-bar').textContent.trim();
      const transformBarVisible = document.getElementById('transform-bar').classList.contains('visible');
      const restoredIds = restoredRows.map(row => row.id);
      if (restoredRows.length !== 2 || !restoredIds.includes(firstId) || !restoredIds.includes(secondId)) {
        throw new Error('scene load did not restore two object rows: ' + JSON.stringify({ restoredRows, firstId, secondId, infoAfterLoad }));
      }
      if (activeAfterLoad !== firstId) {
        throw new Error('scene load did not restore active object id: ' + JSON.stringify({ activeAfterLoad, firstId, restoredRows }));
      }
      if (!transformBarVisible) {
        throw new Error('scene load did not preserve transform toolbar: ' + JSON.stringify({ restoredRows, activeAfterLoad }));
      }
      const restoredTransformDebugState = window.kaminosSceneObjectDebugState();
      const firstAfterLoad = restoredTransformDebugState.find(object => object.id === firstId);
      const secondAfterLoad = restoredTransformDebugState.find(object => object.id === secondId);
      if (!transformMatches(firstAfterLoad?.transform, transformPlan[firstId]) || !transformMatches(secondAfterLoad?.transform, transformPlan[secondId])) {
        throw new Error('scene load did not restore distinct object transforms: ' + JSON.stringify({
          restoredTransformDebugState,
          transformPlan,
        }));
      }
      if (infoAfterLoad !== 'Scene loaded: 2 objects') {
        throw new Error('scene load did not report two loaded objects: ' + JSON.stringify({ infoAfterLoad }));
      }

      const { cleanup, postCleanupFiles } = await assertSceneDeleted(savedFile);
      return {
        savedFile,
        firstId,
        secondId,
        beforeSaveRows,
        savedScene: {
          objectCount: savedScene.objects.length,
          objectIds: savedIds,
          objectSources: savedSources,
          activeObjectId: savedScene.activeObjectId,
          volumePrimitiveSchema: savedScene.volumePrimitives?.schema || null,
          objectTransforms: savedScene.objects.map(object => ({ id: object.id, transform: normalizeTransform(object.transform) })),
        },
        transformDebugBeforeSave,
        restoredRows,
        restoredTransformDebugState,
        activeAfterLoad,
        infoAfterLoad,
        transformBarVisible,
        cleanup,
        postCleanupFileCount: postCleanupFiles.length,
      };
    })()
  `, { timeoutMs: 60000 });
}

async function runTransformInspectorScenario(ws) {
  phase = 'scenario-transform-inspector';
  lastEvidence.transformInspector = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const assertSceneDeleted = async name => {
        const cleanup = await deleteScene(name);
        if (cleanup.deleted !== name) {
          throw new Error('transform inspector cleanup did not delete saved scene file: ' + JSON.stringify({ savedFile: name, cleanup }));
        }
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) {
          throw new Error('transform inspector post-cleanup scene listing still includes saved scene file: ' + JSON.stringify({ savedFile: name, postCleanupFiles }));
        }
        return { cleanup, postCleanupFiles };
      };
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
      const waitForRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const roundTransformValue = value => Number(Number(value || 0).toFixed(4));
      const normalizeTransform = transform => ({
        position: (transform?.position || []).map(roundTransformValue),
        rotation: (transform?.rotation || []).map(roundTransformValue),
        scale: (transform?.scale || []).map(roundTransformValue),
      });
      const transformMatches = (actual, expected, epsilon = 0.001) => {
        const normalizedActual = normalizeTransform(actual);
        const normalizedExpected = normalizeTransform(expected);
        for (const key of ['position', 'rotation', 'scale']) {
          if (normalizedActual[key].length !== 3 || normalizedExpected[key].length !== 3) return false;
          for (let i = 0; i < 3; i++) {
            if (Math.abs(normalizedActual[key][i] - normalizedExpected[key][i]) > epsilon) return false;
          }
        }
        return true;
      };
      const radians = degrees => degrees * Math.PI / 180;
      const inspectorTransformPlan = {
        position: [-0.42, 0.16, 0.24],
        rotation: [radians(12), radians(-18), radians(27)],
        scale: [1.15, 0.85, 1.05],
      };
      const fieldValuePlan = {
        'position.x': -0.42,
        'position.y': 0.16,
        'position.z': 0.24,
        'rotation.x': 12,
        'rotation.y': -18,
        'rotation.z': 27,
        'scale.x': 1.15,
        'scale.y': 0.85,
        'scale.z': 1.05,
      };
      const setInspectorValue = (field, value) => {
        const input = document.querySelector('[data-transform-field="' + field + '"]');
        if (!input) throw new Error('transform inspector field missing: ' + field);
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const inspectorValues = () => Object.fromEntries([...document.querySelectorAll('[data-transform-field]')].map(input => [input.dataset.transformField, Number(input.value)]));

      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 1) break;
        await wait(125);
      }
      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = true;
      demo.click();
      const appendedRows = await waitForRows(2);
      if (appendedRows.length !== 2) throw new Error('transform inspector setup did not create two object rows: ' + JSON.stringify(appendedRows));
      if (typeof window.kaminosSceneObjectDebugState !== 'function') throw new Error('transform inspector witness missing kaminosSceneObjectDebugState');
      const firstId = appendedRows[0].id;
      const secondId = appendedRows[1].id;
      document.querySelector('[data-scene-object-id="' + firstId + '"]').click();
      await wait(250);
      const beforeEditDebug = window.kaminosSceneObjectDebugState();
      const secondBeforeEdit = beforeEditDebug.find(object => object.id === secondId)?.transform;
      if (!secondBeforeEdit) throw new Error('transform inspector setup could not capture second object transform: ' + JSON.stringify(beforeEditDebug));
      const inspector = document.getElementById('transform-inspector');
      if (!inspector) throw new Error('transform inspector panel missing');
      if (inspector.dataset.selectedObjectId !== firstId) {
        throw new Error('transform inspector did not bind to selected object: ' + JSON.stringify({ selectedObjectId: inspector.dataset.selectedObjectId, firstId, rows: rowState() }));
      }
      for (const [field, value] of Object.entries(fieldValuePlan)) setInspectorValue(field, value);
      await wait(250);
      const afterInspectorEditDebug = window.kaminosSceneObjectDebugState();
      const firstAfterEdit = afterInspectorEditDebug.find(object => object.id === firstId);
      const secondAfterEdit = afterInspectorEditDebug.find(object => object.id === secondId);
      if (!transformMatches(firstAfterEdit?.transform, inspectorTransformPlan)) {
        throw new Error('transform inspector did not update selected object transform: ' + JSON.stringify({ afterInspectorEditDebug, inspectorTransformPlan, inspectorValues: inspectorValues() }));
      }
      if (!transformMatches(secondAfterEdit?.transform, secondBeforeEdit)) {
        throw new Error('transform inspector changed a non-selected object: ' + JSON.stringify({ secondBeforeEdit: normalizeTransform(secondBeforeEdit), secondAfterEdit: normalizeTransform(secondAfterEdit?.transform) }));
      }
      const infoAfterInspectorEdit = document.getElementById('info-bar').textContent.trim();
      if (!infoAfterInspectorEdit.includes('Transform updated')) {
        throw new Error('transform inspector did not report transform update: ' + JSON.stringify({ infoAfterInspectorEdit }));
      }

      const beforeSceneFiles = new Set(await listScenes());
      await window.saveSceneAs();
      let newFiles = [];
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) break;
        await wait(125);
      }
      if (newFiles.length !== 1) throw new Error('transform inspector save did not create exactly one new scene file: ' + JSON.stringify({ newFiles, before: [...beforeSceneFiles] }));
      const savedFile = newFiles[0];
      const savedScene = await readScene(savedFile);
      const savedFirst = savedScene.objects?.find(object => object.id === firstId);
      const savedSecond = savedScene.objects?.find(object => object.id === secondId);
      if (!transformMatches(savedFirst?.transform, inspectorTransformPlan)) {
        throw new Error('transform inspector saved scene did not preserve edited transform: ' + JSON.stringify({ savedTransforms: savedScene.objects?.map(object => ({ id: object.id, transform: normalizeTransform(object.transform) })), inspectorTransformPlan }));
      }
      if (!transformMatches(savedSecond?.transform, secondBeforeEdit)) {
        throw new Error('transform inspector saved scene mutated non-selected transform: ' + JSON.stringify({ savedSecond: normalizeTransform(savedSecond?.transform), secondBeforeEdit: normalizeTransform(secondBeforeEdit) }));
      }

      document.querySelector('[data-tab="greenroom"]').click();
      let sceneEntry = null;
      for (let i = 0; i < 120; i++) {
        sceneEntry = [...document.querySelectorAll('#scenes-list .gr-entry')].find(entry => (
          entry.querySelector('.gr-name')?.textContent?.trim() === savedFile.replace('.kaminos.json', '')
        ));
        if (sceneEntry) break;
        await wait(125);
      }
      if (!sceneEntry) throw new Error('transform inspector saved scene did not appear in scene list: ' + savedFile);
      const loadButton = [...sceneEntry.querySelectorAll('button')].find(button => button.textContent.trim() === 'Load');
      if (!loadButton) throw new Error('transform inspector saved scene list entry missing Load button: ' + savedFile);
      loadButton.click();
      let restoredRows = [];
      for (let i = 0; i < 160; i++) {
        restoredRows = rowState();
        const restoredDebug = window.kaminosSceneObjectDebugState();
        const activeId = restoredRows.find(row => row.active && row.pressed === 'true')?.id || null;
        const firstRestored = restoredDebug.find(object => object.id === firstId);
        const info = document.getElementById('info-bar').textContent.trim();
        if (restoredRows.length === 2 && activeId === firstId && transformMatches(firstRestored?.transform, inspectorTransformPlan) && info === 'Scene loaded: 2 objects') break;
        await wait(125);
      }
      const restoredDebugState = window.kaminosSceneObjectDebugState();
      const restoredFirst = restoredDebugState.find(object => object.id === firstId);
      const restoredSecond = restoredDebugState.find(object => object.id === secondId);
      if (!transformMatches(restoredFirst?.transform, inspectorTransformPlan)) {
        throw new Error('transform inspector load did not restore edited transform: ' + JSON.stringify({ restoredDebugState, inspectorTransformPlan }));
      }
      if (!transformMatches(restoredSecond?.transform, secondBeforeEdit)) {
        throw new Error('transform inspector load mutated non-selected transform: ' + JSON.stringify({ restoredSecond: normalizeTransform(restoredSecond?.transform), secondBeforeEdit: normalizeTransform(secondBeforeEdit) }));
      }
      document.querySelector('[data-tab="assets"]').click();
      await wait(250);
      if (document.getElementById('transform-inspector')?.dataset.selectedObjectId !== firstId) {
        throw new Error('transform inspector did not rebind after scene load: ' + JSON.stringify({ selectedObjectId: document.getElementById('transform-inspector')?.dataset.selectedObjectId, firstId, restoredRows }));
      }
      const restoredInspectorValues = inspectorValues();
      if (Math.abs(restoredInspectorValues['rotation.x'] - 12) > 0.01 || Math.abs(restoredInspectorValues['rotation.y'] + 18) > 0.01 || Math.abs(restoredInspectorValues['rotation.z'] - 27) > 0.01) {
        throw new Error('transform inspector did not display restored rotation degrees: ' + JSON.stringify({ restoredInspectorValues }));
      }
      const { cleanup, postCleanupFiles } = await assertSceneDeleted(savedFile);
      return {
        savedFile,
        firstId,
        secondId,
        inspectorValuesAfterEdit: inspectorValues(),
        afterInspectorEditDebug,
        savedScene: {
          objectCount: savedScene.objects?.length || 0,
          objectTransforms: savedScene.objects?.map(object => ({ id: object.id, transform: normalizeTransform(object.transform) })) || [],
        },
        restoredRows,
        restoredDebugState,
        cleanup,
        postCleanupFileCount: postCleanupFiles.length,
      };
    })()
  `, { timeoutMs: 60000 });
}

async function runObjectGroupsRoundtripScenario(ws) {
  phase = 'scenario-object-groups-roundtrip';
  lastEvidence.objectGroupsRoundtrip = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const assertSceneDeleted = async name => {
        const cleanup = await deleteScene(name);
        if (cleanup.deleted !== name) throw new Error('cleanup did not delete saved scene file: ' + JSON.stringify({ name, cleanup }));
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) throw new Error('post-cleanup scene listing still includes saved scene file: ' + JSON.stringify({ name, postCleanupFiles }));
        return { cleanup, postCleanupFiles };
      };
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        grouped: row.classList.contains('grouped'),
      }));
      const groupRows = () => [...document.querySelectorAll('[data-scene-group-id]')].map(row => ({
        id: row.dataset.sceneGroupId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-group-name]')?.value?.trim() || row.querySelector('.scene-group-name')?.textContent?.trim() || null,
      }));
      const waitForRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const setInputValue = (selector, value) => {
        const input = document.querySelector(selector);
        if (!input) throw new Error('outliner input missing: ' + selector);
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 1) break;
        await wait(125);
      }
      const initialRows = rowState();
      if (initialRows.length !== 1) throw new Error('object grouping setup did not start with one object row: ' + JSON.stringify(initialRows));
      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = true;
      demo.click();
      const appendedRows = await waitForRows(2);
      if (appendedRows.length !== 2) throw new Error('object grouping setup did not create two object rows: ' + JSON.stringify(appendedRows));
      const firstId = appendedRows[0].id;
      const secondId = appendedRows[1].id;

      setInputValue('[data-scene-object-name="' + firstId + '"]', 'Key Ring');
      setInputValue('[data-scene-object-name="' + secondId + '"]', 'Fill Ring');
      await wait(200);
      const renamedRows = rowState();
      if (!renamedRows.some(row => row.id === firstId && row.label === 'Key Ring') || !renamedRows.some(row => row.id === secondId && row.label === 'Fill Ring')) {
        throw new Error('object grouping did not preserve renamed object labels: ' + JSON.stringify(renamedRows));
      }
      if (typeof window.createSceneGroupForObjects !== 'function' || typeof window.kaminosSceneGroupDebugState !== 'function') {
        throw new Error('object grouping debug/create API missing');
      }
      const group = window.createSceneGroupForObjects([firstId, secondId], 'Lighting Pair');
      await wait(250);
      if (!group?.id) throw new Error('object grouping did not create a group record');
      const createdGroupRows = groupRows();
      if (createdGroupRows.length !== 1 || createdGroupRows[0].label !== 'Lighting Pair') {
        throw new Error('object grouping did not create a group row: ' + JSON.stringify(createdGroupRows));
      }
      setInputValue('[data-scene-group-name="' + group.id + '"]', 'Hero Pair');
      await wait(200);
      const renamedGroups = groupRows();
      if (renamedGroups.length !== 1 || renamedGroups[0].label !== 'Hero Pair') {
        throw new Error('object grouping did not preserve renamed group label: ' + JSON.stringify(renamedGroups));
      }
      document.querySelector('[data-scene-group-id="' + group.id + '"]').click();
      await wait(250);
      const groupSelectionRows = groupRows();
      const transformBarVisibleAfterGroup = document.getElementById('transform-bar').classList.contains('visible');
      const inspector = document.getElementById('transform-inspector');
      const inspectorFields = document.getElementById('transform-inspector-fields');
      const inspectorFieldsVisible = !!inspectorFields
        && !inspectorFields.hidden
        && getComputedStyle(inspectorFields).display !== 'none'
        && inspectorFields.getBoundingClientRect().height > 0;
      if (!groupSelectionRows[0]?.active || groupSelectionRows[0]?.pressed !== 'true') {
        throw new Error('object grouping did not select group row: ' + JSON.stringify(groupSelectionRows));
      }
      if (transformBarVisibleAfterGroup || inspectorFieldsVisible || inspector?.dataset?.selectedObjectId) {
        throw new Error('group selection did not hide object transform controls: ' + JSON.stringify({
          transformBarVisibleAfterGroup,
          inspectorFieldsHidden: inspectorFields?.hidden ?? null,
          inspectorFieldsDisplay: inspectorFields ? getComputedStyle(inspectorFields).display : null,
          inspectorFieldsHeight: inspectorFields?.getBoundingClientRect?.().height ?? null,
          selectedObjectId: inspector?.dataset?.selectedObjectId || null,
          selectedGroupId: inspector?.dataset?.selectedGroupId || null,
        }));
      }

      const beforeSceneFiles = new Set(await listScenes());
      await window.saveSceneAs();
      let newFiles = [];
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) break;
        await wait(125);
      }
      if (newFiles.length !== 1) throw new Error('object grouping save did not create exactly one scene file: ' + JSON.stringify({ newFiles, before: [...beforeSceneFiles] }));
      const savedFile = newFiles[0];
      const savedScene = await readScene(savedFile);
      const savedGroup = savedScene.groups?.find(saved => saved.id === group.id);
      if (!savedGroup || savedGroup.label !== 'Hero Pair' || savedGroup.objectIds.length !== 2 || !savedGroup.objectIds.includes(firstId) || !savedGroup.objectIds.includes(secondId)) {
        throw new Error('object grouping saved scene did not preserve group membership: ' + JSON.stringify(savedScene.groups));
      }
      if (savedScene.activeGroupId !== group.id) {
        throw new Error('object grouping saved scene did not preserve active group: ' + JSON.stringify({ activeGroupId: savedScene.activeGroupId, groupId: group.id }));
      }
      const savedLabels = savedScene.objects.map(object => [object.id, object.label]);
      if (!savedLabels.some(([id, label]) => id === firstId && label === 'Key Ring') || !savedLabels.some(([id, label]) => id === secondId && label === 'Fill Ring')) {
        throw new Error('object grouping saved scene did not preserve object labels: ' + JSON.stringify(savedLabels));
      }

      document.querySelector('[data-tab="greenroom"]').click();
      let sceneEntry = null;
      for (let i = 0; i < 120; i++) {
        sceneEntry = [...document.querySelectorAll('#scenes-list .gr-entry')].find(entry => (
          entry.querySelector('.gr-name')?.textContent?.trim() === savedFile.replace('.kaminos.json', '')
        ));
        if (sceneEntry) break;
        await wait(125);
      }
      if (!sceneEntry) throw new Error('object grouping saved scene did not appear in scene list: ' + savedFile);
      const loadButton = [...sceneEntry.querySelectorAll('button')].find(button => button.textContent.trim() === 'Load');
      if (!loadButton) throw new Error('object grouping saved scene list entry missing Load button: ' + savedFile);
      loadButton.click();
      let restoredGroups = [];
      let restoredRows = [];
      for (let i = 0; i < 160; i++) {
        restoredGroups = window.kaminosSceneGroupDebugState?.() || [];
        restoredRows = rowState();
        if (restoredGroups.length === 1 && restoredRows.length === 2 && restoredGroups[0].label === 'Hero Pair') break;
        await wait(125);
      }
      const restoredGroup = restoredGroups[0];
      if (!restoredGroup || restoredGroup.label !== 'Hero Pair' || restoredGroup.objectIds.length !== 2 || !restoredGroup.objectIds.includes(firstId) || !restoredGroup.objectIds.includes(secondId)) {
        throw new Error('object grouping load did not restore group membership: ' + JSON.stringify({ restoredGroups, restoredRows }));
      }
      if (!restoredGroup.active || document.getElementById('transform-bar').classList.contains('visible')) {
        throw new Error('object grouping load did not restore active group selection: ' + JSON.stringify({
          restoredGroups,
          transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
        }));
      }
      if (!restoredRows.every(row => row.grouped) || !restoredRows.some(row => row.label === 'Key Ring') || !restoredRows.some(row => row.label === 'Fill Ring')) {
        throw new Error('object grouping load did not restore grouped renamed rows: ' + JSON.stringify(restoredRows));
      }

      document.querySelector('[data-tab="assets"]').click();
      const { cleanup, postCleanupFiles } = await assertSceneDeleted(savedFile);
      window.selectSceneGroup(group.id);
      await wait(250);
      const finalGroups = groupRows();
      const finalRows = rowState();
      if (!finalGroups.some(row => row.id === group.id && row.active && row.label === 'Hero Pair') || !finalRows.every(row => row.grouped)) {
        throw new Error('object grouping final screenshot state lost group membership: ' + JSON.stringify({ finalGroups, finalRows }));
      }
      window.removeSceneObject(firstId);
      await wait(250);
      const groupsAfterMemberRemoval = groupRows();
      const rowsAfterMemberRemoval = rowState();
      const groupDebugAfterMemberRemoval = window.kaminosSceneGroupDebugState?.() || [];
      const survivingGroup = groupDebugAfterMemberRemoval.find(record => record.id === group.id);
      if (!groupsAfterMemberRemoval.some(row => row.id === group.id && row.active && row.pressed === 'true')) {
        throw new Error('object grouping active group selection was cleared by member removal: ' + JSON.stringify({
          groupsAfterMemberRemoval,
          groupDebugAfterMemberRemoval,
          rowsAfterMemberRemoval,
        }));
      }
      if (!survivingGroup || !survivingGroup.active || survivingGroup.objectIds.length !== 1 || !survivingGroup.objectIds.includes(secondId)) {
        throw new Error('object grouping member removal did not preserve pruned active group membership: ' + JSON.stringify({
          survivingGroup,
          groupDebugAfterMemberRemoval,
          rowsAfterMemberRemoval,
        }));
      }
      return {
        savedFile,
        firstId,
        secondId,
        groupId: group.id,
        renamedRows,
        renamedGroups,
        groupSelectionRows,
        savedGroup,
        savedLabels,
        restoredGroups,
        restoredRows,
        finalGroups,
        finalRows,
        groupsAfterMemberRemoval,
        rowsAfterMemberRemoval,
        groupDebugAfterMemberRemoval,
        cleanup,
        postCleanupFileCount: postCleanupFiles.length,
      };
    })()
  `, { timeoutMs: 60000 });
}

async function runSceneBoundaryRoundtripScenario(ws) {
  phase = 'scenario-scene-boundary-roundtrip';
  lastEvidence.sceneBoundaryRoundtrip = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const schema = 'kaminos.volume-primitives.v0';
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const assertSceneDeleted = async name => {
        const cleanup = await deleteScene(name);
        if (cleanup.deleted !== name) {
          throw new Error('boundary cleanup did not delete scene file: ' + JSON.stringify({ name, cleanup }));
        }
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) {
          throw new Error('post-cleanup scene listing still includes boundary scene file: ' + JSON.stringify({ name, postCleanupFiles }));
        }
        return { cleanup, postCleanupFiles };
      };
      const saveFixtureToServer = async doc => {
        const resp = await fetch('/api/save-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc),
        });
        const data = await resp.json();
        if (!resp.ok || data.error || !data.saved) throw new Error('fixture scene save failed: ' + JSON.stringify(data));
        return data.saved;
      };
      const loadSceneDocument = async (doc, name) => {
        const input = document.getElementById('scene-file-input');
        const file = new File([JSON.stringify(doc)], name, { type: 'application/json' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const waitForInfo = async expected => {
        let info = '';
        for (let i = 0; i < 160; i++) {
          info = document.getElementById('info-bar').textContent.trim();
          if (info === expected) return info;
          await wait(125);
        }
        return info;
      };
      const saveSceneAsAndRead = async () => {
        const before = new Set(await listScenes());
        const saved = await window.saveSceneAs();
        if (!saved) throw new Error('scene boundary save-as did not report success');
        let newFiles = [];
        for (let i = 0; i < 120; i++) {
          const after = await listScenes();
          newFiles = after.filter(name => !before.has(name));
          if (newFiles.length === 1) break;
          await wait(125);
        }
        if (newFiles.length !== 1) throw new Error('scene boundary save-as did not create exactly one file: ' + JSON.stringify({ newFiles, before: [...before] }));
        return { savedFile: newFiles[0], savedScene: await readScene(newFiles[0]) };
      };

      if (rowState().length === 0) {
        const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
        if (!demo) throw new Error('SuperMat Ring demo button missing for scene boundary setup');
        demo.click();
      }
      for (let i = 0; i < 80; i++) {
        const rows = rowState();
        if (rows.length === 1 && rows[0].active) break;
        await wait(125);
      }
      const initialRows = rowState();
      if (initialRows.length !== 1) throw new Error('scene boundary setup did not create one explicit demo object row: ' + JSON.stringify(initialRows));

      const timestamp = new Date().toISOString();
      const volumeScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp,
        objects: [],
        activeObjectId: null,
        model: null,
        volumePrimitives: {
          schema,
          primitives: [{
            id: 'boundary-volume',
            kind: 'fire_smoke',
            shape: 'sphere',
            transform: { position: [0, -0.74, 0], rotation: [0, 0, 0], scale: [0.12, 0.12, 0.12] },
            simulation: { sourceRadius: 0.12, flowRate: 0.15, vorticity: 2.65 },
          }],
        },
      };
      await loadSceneDocument(volumeScene, 'boundary-volume.kaminos.json');
      const volumeInfo = await waitForInfo('Volume scene loaded');
      const rowsAfterVolume = rowState();
      const toolbarAfterVolume = document.getElementById('transform-bar').classList.contains('visible');
      if (rowsAfterVolume.length !== 0 || toolbarAfterVolume) {
        throw new Error('scene load did not clear stale object rows for volume-only scene: ' + JSON.stringify({ rowsAfterVolume, toolbarAfterVolume, volumeInfo }));
      }
      const volumeSave = await saveSceneAsAndRead();
      if ((volumeSave.savedScene.objects || []).length !== 0) {
        throw new Error('volume-only save after load retained stale objects: ' + JSON.stringify(volumeSave.savedScene.objects));
      }
      if (volumeSave.savedScene.volumePrimitives?.primitives?.length !== 1) {
        throw new Error('volume-only save after load did not retain volume primitive: ' + JSON.stringify(volumeSave.savedScene.volumePrimitives));
      }
      const volumeCleanup = await assertSceneDeleted(volumeSave.savedFile);

      const localPreviewScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [{
          id: 'failed-local-preview-object',
          source: 'material-preview',
          type: 'pbr',
          fileName: 'Failed Local Preview',
          label: 'Failed Local Preview',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materials: { side: 0, transparent: false, opacity: 1 },
        }],
        activeObjectId: 'failed-local-preview-object',
        model: { source: 'material-preview', type: 'pbr', fileName: 'Failed Local Preview' },
        volumePrimitives: { schema, primitives: [] },
      };
      const localPreviewFile = await saveFixtureToServer(localPreviewScene);
      await loadSceneDocument(localPreviewScene, localPreviewFile);
      let failedInfo = '';
      for (let i = 0; i < 120; i++) {
        failedInfo = document.getElementById('info-bar').textContent.trim();
        if (failedInfo.startsWith('Scene load failed:')) break;
        await wait(125);
      }
      if (!failedInfo.startsWith('Scene load failed:')) {
        throw new Error('local-preview scene load did not fail as expected: ' + failedInfo);
      }
      const protectedSave = await window.saveScene();
      if (protectedSave !== false) {
        throw new Error('failed local-preview scene load did not protect save target: ' + JSON.stringify({ protectedSave, failedInfo }));
      }
      const localPreviewAfterSaveAttempt = await readScene(localPreviewFile);
      if (localPreviewAfterSaveAttempt.objects?.[0]?.source !== 'material-preview') {
        throw new Error('failed local-preview scene load overwrote its source file: ' + JSON.stringify(localPreviewAfterSaveAttempt.objects));
      }
      const localPreviewCleanup = await assertSceneDeleted(localPreviewFile);

      const previousScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [],
        activeObjectId: null,
        model: null,
        volumePrimitives: {
          schema,
          primitives: [{
            id: 'previous-volume',
            kind: 'fire_smoke',
            shape: 'sphere',
            transform: { position: [0.4, -0.74, 0], rotation: [0, 0, 0], scale: [0.08, 0.08, 0.08] },
            simulation: { sourceRadius: 0.08, flowRate: 0.08, vorticity: 1.25 },
          }],
        },
      };
      const previousFile = await saveFixtureToServer(previousScene);
      await loadSceneDocument(previousScene, previousFile);
      await waitForInfo('Volume scene loaded');
      const previousBeforeMixedFailure = await readScene(previousFile);

      const mixedFailedScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [{
          id: 'mixed-failed-local-preview-object',
          source: 'material-preview',
          type: 'pbr',
          fileName: 'Mixed Failed Local Preview',
          label: 'Mixed Failed Local Preview',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materials: { side: 0, transparent: false, opacity: 1 },
        }],
        activeObjectId: 'mixed-failed-local-preview-object',
        model: { source: 'material-preview', type: 'pbr', fileName: 'Mixed Failed Local Preview' },
        volumePrimitives: {
          schema,
          primitives: [{
            id: 'failed-mixed-volume',
            kind: 'fire_smoke',
            shape: 'sphere',
            transform: { position: [-0.4, -0.74, 0], rotation: [0, 0, 0], scale: [0.16, 0.16, 0.16] },
            simulation: { sourceRadius: 0.16, flowRate: 0.22, vorticity: 3.1 },
          }],
        },
      };
      await loadSceneDocument(mixedFailedScene, 'mixed-failed-local-preview.kaminos.json');
      let mixedFailedInfo = '';
      for (let i = 0; i < 120; i++) {
        mixedFailedInfo = document.getElementById('info-bar').textContent.trim();
        if (mixedFailedInfo.startsWith('Scene load failed:')) break;
        await wait(125);
      }
      if (!mixedFailedInfo.startsWith('Scene load failed:')) {
        throw new Error('mixed failed scene load did not fail as expected: ' + mixedFailedInfo);
      }
      const mixedProtectedSave = await window.saveScene();
      if (mixedProtectedSave !== false) {
        throw new Error('mixed failed scene load did not protect previous save target: ' + JSON.stringify({ mixedProtectedSave, mixedFailedInfo }));
      }
      const previousAfterMixedFailure = await readScene(previousFile);
      if (JSON.stringify(previousAfterMixedFailure.volumePrimitives) !== JSON.stringify(previousBeforeMixedFailure.volumePrimitives)) {
        throw new Error('mixed failed scene load overwrote previous save target: ' + JSON.stringify({ previousBeforeMixedFailure, previousAfterMixedFailure }));
      }
      const mixedCleanup = await assertSceneDeleted(previousFile);

      const actualFailurePreviousFile = await saveFixtureToServer(previousScene);
      await loadSceneDocument(previousScene, actualFailurePreviousFile);
      await waitForInfo('Volume scene loaded');
      const actualFailurePreviousBefore = await readScene(actualFailurePreviousFile);
      const missingDemoMixedScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [{
          id: 'missing-demo-object',
          source: 'demos/missing/',
          type: 'pbr',
          fileName: 'Missing Demo Object',
          label: 'Missing Demo Object',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materials: { side: 0, transparent: false, opacity: 1 },
        }],
        activeObjectId: 'missing-demo-object',
        model: { source: 'demos/missing/', type: 'pbr', fileName: 'Missing Demo Object' },
        volumePrimitives: {
          schema,
          primitives: [{
            id: 'actual-load-failed-volume',
            kind: 'fire_smoke',
            shape: 'sphere',
            transform: { position: [-0.2, -0.74, 0.2], rotation: [0, 0, 0], scale: [0.2, 0.2, 0.2] },
            simulation: { sourceRadius: 0.2, flowRate: 0.3, vorticity: 3.6 },
          }],
        },
      };
      await loadSceneDocument(missingDemoMixedScene, 'mixed-missing-demo.kaminos.json');
      let missingDemoFailedInfo = '';
      for (let i = 0; i < 120; i++) {
        missingDemoFailedInfo = document.getElementById('info-bar').textContent.trim();
        if (missingDemoFailedInfo.startsWith('Scene load failed:')) break;
        await wait(125);
      }
      if (!missingDemoFailedInfo.startsWith('Scene load failed:')) {
        throw new Error('syntactically reloadable mixed scene load did not fail as expected: ' + missingDemoFailedInfo);
      }
      const goodDemo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!goodDemo) throw new Error('SuperMat Ring demo button missing for actual failure recovery');
      goodDemo.click();
      for (let i = 0; i < 120; i++) {
        if (rowState().length === 1 && rowState()[0].label === 'SuperMat Ring') break;
        await wait(125);
      }
      const postFailureImportRows = rowState();
      if (postFailureImportRows.length !== 1 || postFailureImportRows[0].label !== 'SuperMat Ring') {
        throw new Error('normal import after syntactically reloadable failure did not recover one good row: ' + JSON.stringify(postFailureImportRows));
      }
      const beforePostFailureImportSaveFiles = new Set(await listScenes());
      await window.saveScene();
      let postFailureImportSavedFiles = [];
      for (let i = 0; i < 120; i++) {
        const afterFiles = await listScenes();
        postFailureImportSavedFiles = afterFiles.filter(name => !beforePostFailureImportSaveFiles.has(name));
        if (postFailureImportSavedFiles.length <= 1) break;
        await wait(125);
      }
      const actualFailurePreviousAfter = await readScene(actualFailurePreviousFile);
      if (JSON.stringify(actualFailurePreviousAfter.volumePrimitives) !== JSON.stringify(actualFailurePreviousBefore.volumePrimitives)) {
        throw new Error('syntactically reloadable failed scene load overwrote previous save target after import: ' + JSON.stringify({ actualFailurePreviousBefore, actualFailurePreviousAfter }));
      }
      if ((actualFailurePreviousAfter.objects || []).length !== (actualFailurePreviousBefore.objects || []).length) {
        throw new Error('syntactically reloadable failed scene load changed previous scene objects after import: ' + JSON.stringify({ actualFailurePreviousBefore, actualFailurePreviousAfter }));
      }
      for (const generatedFile of postFailureImportSavedFiles) {
        if (generatedFile !== actualFailurePreviousFile) await assertSceneDeleted(generatedFile);
      }
      const actualFailureCleanup = await assertSceneDeleted(actualFailurePreviousFile);

      const objectScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [{
          id: 'boundary-object',
          source: 'demos/supermat-ring/',
          type: 'pbr',
          fileName: 'Boundary Object',
          label: 'Boundary Object',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materials: { side: 0, transparent: false, opacity: 1 },
        }],
        activeObjectId: 'boundary-object',
        model: { source: 'demos/supermat-ring/', type: 'pbr', fileName: 'Boundary Object' },
        volumePrimitives: { schema, primitives: [] },
      };
      await loadSceneDocument(objectScene, 'boundary-object.kaminos.json');
      const objectInfo = await waitForInfo('Scene loaded: 1 object');
      const rowsAfterObject = rowState();
      if (rowsAfterObject.length !== 1 || rowsAfterObject[0].id !== 'boundary-object') {
        throw new Error('scene boundary object-only load did not restore one expected row: ' + JSON.stringify({ rowsAfterObject, objectInfo }));
      }
      const objectSave = await saveSceneAsAndRead();
      if (objectSave.savedScene.volumePrimitives?.primitives?.length !== 0) {
        throw new Error('scene load did not clear stale volume primitives for object-only scene: ' + JSON.stringify(objectSave.savedScene.volumePrimitives));
      }
      const objectCleanup = await assertSceneDeleted(objectSave.savedFile);

      document.querySelector('[data-tab="assets"]').click();
      return {
        initialRows,
        rowsAfterVolume,
        toolbarAfterVolume,
        volumeInfo,
        volumeSavedObjectCount: (volumeSave.savedScene.objects || []).length,
        volumeSavedPrimitiveCount: volumeSave.savedScene.volumePrimitives?.primitives?.length || 0,
        volumeCleanupDeleted: volumeCleanup.cleanup.deleted,
        failedLocalPreviewInfo: failedInfo,
        failedLocalPreviewProtectedSave: protectedSave,
        localPreviewCleanupDeleted: localPreviewCleanup.cleanup.deleted,
        mixedFailedInfo,
        mixedProtectedSave,
        mixedPreviousPrimitiveIds: previousAfterMixedFailure.volumePrimitives?.primitives?.map(primitive => primitive.id) || [],
        mixedCleanupDeleted: mixedCleanup.cleanup.deleted,
        missingDemoFailedInfo,
        postFailureImportRows,
        postFailureImportSavedFiles,
        actualFailurePreviousPrimitiveIds: actualFailurePreviousAfter.volumePrimitives?.primitives?.map(primitive => primitive.id) || [],
        actualFailureCleanupDeleted: actualFailureCleanup.cleanup.deleted,
        rowsAfterObject,
        objectInfo,
        objectSavedPrimitiveCount: objectSave.savedScene.volumePrimitives?.primitives?.length || 0,
        objectCleanupDeleted: objectCleanup.cleanup.deleted,
      };
    })()
  `, { timeoutMs: 90000 });
}

async function runAppendSelectRemoveKeyboardScenario(ws) {
  phase = 'scenario-default-replace';
  lastEvidence.defaultReplace = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      if (document.querySelectorAll('[data-scene-object-id]').length === 0) {
        demo.click();
        for (let i = 0; i < 80; i++) {
          const rows = [...document.querySelectorAll('[data-scene-object-id]')];
          if (rows.length === 1 && rows[0].classList.contains('active')) break;
          await wait(125);
        }
      }
      const initialRows = [...document.querySelectorAll('[data-scene-object-id]')];
      const initialIds = initialRows.map(row => row.dataset.sceneObjectId);
      if (initialRows.length !== 1) {
        throw new Error('default replace did not create one explicit demo row before proving replace: ' + JSON.stringify({ rowCount: initialRows.length, ids: initialIds }));
      }
      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = false;
      demo.click();
      let rows = [];
      for (let i = 0; i < 80; i++) {
        rows = [...document.querySelectorAll('[data-scene-object-id]')];
        if (rows.length === 1 && rows[0].dataset.sceneObjectId !== initialIds[0]) break;
        await wait(125);
      }
      return {
        appendChecked: append.checked,
        rowCount: rows.length,
        initialIds,
        ids: rows.map(row => row.dataset.sceneObjectId),
        activeCount: document.querySelectorAll('.scene-object-row.active').length,
      };
    })()
  `);
  if (lastEvidence.defaultReplace.rowCount !== 1) {
    throw new Error(`default replace did not keep one row: ${JSON.stringify(lastEvidence.defaultReplace)}`);
  }
  if (lastEvidence.defaultReplace.ids[0] === lastEvidence.defaultReplace.initialIds[0]) {
    throw new Error(`default replace did not complete with a new row: ${JSON.stringify(lastEvidence.defaultReplace)}`);
  }

  phase = 'scenario-append-and-selection';
  lastEvidence.appendSelection = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      const append = document.getElementById('append-import-toggle');
      append.checked = true;
      demo.click();
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 2) break;
        await wait(125);
      }
      const rows = [...document.querySelectorAll('[data-scene-object-id]')];
      if (rows.length !== 2) return { rowCount: rows.length, ids: rows.map(row => row.dataset.sceneObjectId) };
      rows[0].click();
      await wait(250);
      const afterFirst = [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      }));
      document.querySelector('[data-scene-object-id="' + rows[1].dataset.sceneObjectId + '"]').click();
      await wait(250);
      const afterSecond = [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      }));
      return {
        appendChecked: append.checked,
        rowCount: rows.length,
        uniqueIds: new Set(rows.map(row => row.dataset.sceneObjectId)).size,
        firstId: rows[0].dataset.sceneObjectId,
        secondId: rows[1].dataset.sceneObjectId,
        afterFirst,
        afterSecond,
        transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      };
    })()
  `);
  if (lastEvidence.appendSelection.rowCount !== 2 || lastEvidence.appendSelection.uniqueIds !== 2) {
    throw new Error(`append import did not produce two unique rows: ${JSON.stringify(lastEvidence.appendSelection)}`);
  }
  assertClickedSelection(
    lastEvidence.appendSelection.afterFirst,
    'first',
    lastEvidence.appendSelection.firstId,
    lastEvidence.appendSelection.secondId,
  );
  assertClickedSelection(
    lastEvidence.appendSelection.afterSecond,
    'second',
    lastEvidence.appendSelection.secondId,
    lastEvidence.appendSelection.firstId,
  );
  if (!lastEvidence.appendSelection.transformBarVisible) {
    throw new Error(`append selection did not preserve transform toolbar: ${JSON.stringify(lastEvidence.appendSelection)}`);
  }

  phase = 'scenario-mouse-remove';
  lastEvidence.mouseRemove = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const activeRemove = document.querySelector('.scene-object-row.active [data-scene-object-remove-id]');
      if (!activeRemove) throw new Error('active remove button missing');
      activeRemove.click();
      await wait(500);
      const rows = [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      }));
      return {
        rows,
        info: document.getElementById('info-bar').textContent.trim(),
        transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      };
    })()
  `);
  if (lastEvidence.mouseRemove.rows.length !== 1 || lastEvidence.mouseRemove.rows.filter(row => row.active && row.pressed === 'true').length !== 1) {
    throw new Error(`mouse remove did not leave one active row: ${JSON.stringify(lastEvidence.mouseRemove)}`);
  }
  if (!lastEvidence.mouseRemove.info.startsWith('Removed:')) {
    throw new Error(`mouse remove did not report removal: ${JSON.stringify(lastEvidence.mouseRemove)}`);
  }
  if (!lastEvidence.mouseRemove.transformBarVisible) {
    throw new Error(`mouse remove did not preserve transform toolbar: ${JSON.stringify(lastEvidence.mouseRemove)}`);
  }

  phase = 'scenario-keyboard-remove';
  lastEvidence.keyboardSetup = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      document.getElementById('append-import-toggle').checked = true;
      demo.click();
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 2) break;
        await wait(125);
      }
      const activeRemove = document.querySelector('.scene-object-row.active [data-scene-object-remove-id]');
      if (!activeRemove) throw new Error('active remove button missing after reappend');
      activeRemove.focus();
      return {
        rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({ id: row.dataset.sceneObjectId, active: row.classList.contains('active') })),
        focusedRemoveId: document.activeElement?.dataset?.sceneObjectRemoveId || null,
        activeElementClass: document.activeElement?.className || null,
      };
    })()
  `);
  await wsRequest(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await wsRequest(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await delay(700);
  lastEvidence.keyboardRemove = await evaluate(ws, `
    (async () => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      info: document.getElementById('info-bar').textContent.trim(),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
    }))()
  `);
  if (lastEvidence.keyboardRemove.rows.length !== 1 || lastEvidence.keyboardRemove.rows.filter(row => row.active && row.pressed === 'true').length !== 1) {
    throw new Error(`keyboard remove did not remove focused row: ${JSON.stringify(lastEvidence.keyboardRemove)}`);
  }
  if (!lastEvidence.keyboardRemove.info.startsWith('Removed:')) {
    throw new Error(`keyboard remove did not report removal: ${JSON.stringify(lastEvidence.keyboardRemove)}`);
  }
  if (!lastEvidence.keyboardRemove.transformBarVisible) {
    throw new Error(`keyboard remove did not preserve transform toolbar: ${JSON.stringify(lastEvidence.keyboardRemove)}`);
  }
}

async function runStartupEmptyScenario(ws) {
  phase = 'scenario-startup-empty';
  lastEvidence.startupEmpty = await evaluate(ws, `
    (() => {
      const rows = [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      }));
      const empty = document.getElementById('scene-object-empty');
      const transformBar = document.getElementById('transform-bar');
      const demoButton = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      return {
        rows,
        emptyVisible: !!empty && getComputedStyle(empty).display !== 'none',
        transformBarVisible: !!transformBar && transformBar.classList.contains('visible'),
        demoButtonPresent: !!demoButton,
        info: document.getElementById('info-bar')?.textContent?.trim() || '',
      };
    })()
  `);
  if (lastEvidence.startupEmpty.rows.length !== 0) {
    throw new Error(`startup did not remain empty before explicit import: ${JSON.stringify(lastEvidence.startupEmpty)}`);
  }
  if (!lastEvidence.startupEmpty.emptyVisible) {
    throw new Error(`startup empty scene did not show object-list empty state: ${JSON.stringify(lastEvidence.startupEmpty)}`);
  }
  if (lastEvidence.startupEmpty.transformBarVisible) {
    throw new Error(`startup empty scene showed transform toolbar: ${JSON.stringify(lastEvidence.startupEmpty)}`);
  }
  if (!lastEvidence.startupEmpty.demoButtonPresent) {
    throw new Error(`startup empty scene lost manual demo affordance: ${JSON.stringify(lastEvidence.startupEmpty)}`);
  }
}

async function runWorldChambersLermsUnderhillScenario(ws) {
  phase = 'scenario-world-chambers-lerms-underhill';
  lastEvidence.worldChambersLermsUnderhill = await evaluate(ws, `
    (() => {
      if (typeof window.kaminosWorldChambersDebugState !== 'function') {
        throw new Error('world chambers witness missing kaminosWorldChambersDebugState');
      }
      document.querySelector('[data-tab="worlds"]')?.click();
      const debug = window.kaminosWorldChambersDebugState();
      const tab = document.querySelector('[data-tab="worlds"]');
      const panel = document.getElementById('tab-worlds');
      return {
        debug,
        tabActive: !!tab && tab.classList.contains('active'),
        panelActive: !!panel && panel.classList.contains('active'),
        title: document.getElementById('world-chamber-title')?.textContent?.trim() || null,
        routeText: document.getElementById('world-chamber-route')?.textContent?.trim() || null,
        authorityText: document.getElementById('world-chamber-authority')?.textContent?.trim() || null,
        evidenceText: document.getElementById('world-chamber-evidence')?.textContent?.trim() || null,
        absenceRows: [...document.querySelectorAll('#world-chamber-absence-list .world-chamber-row')].map(row => row.textContent.trim()),
      };
    })()
  `);
  const evidence = lastEvidence.worldChambersLermsUnderhill;
  if (!evidence.tabActive || !evidence.panelActive) {
    throw new Error(`world chambers tab did not activate: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.activeChamberId !== 'lerms-underhill') {
    throw new Error(`world chambers active chamber mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.route !== 'first-vertical-composer/witness-file') {
    throw new Error(`world chambers route mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.authority !== 'synthetic_fixture') {
    throw new Error(`world chambers authority mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.authorityNote !== 'integrated fixture evidence; not a live first vertical') {
    throw new Error(`world chambers authority note mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.falseLiveClaim !== false) {
    throw new Error(`world chambers false-live guard did not report false: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.summary?.lerms !== 8 || evidence.debug?.summary?.goins !== 2) {
    throw new Error(`world chambers summary mismatch: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.absenceRows.some(row => row.includes('liveFingerJuicePackets'))) {
    throw new Error(`world chambers absence rows did not include liveFingerJuicePackets: ${JSON.stringify(evidence)}`);
  }
}

async function runWorldChambersLermsUnderhillReceiptUrlScenario(ws) {
  phase = 'scenario-world-chambers-lerms-underhill-receipt-url';
  lastEvidence.worldChambersLermsUnderhillReceiptUrl = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      if (typeof window.kaminosWorldChambersDebugState !== 'function') {
        throw new Error('world chambers receipt-url witness missing kaminosWorldChambersDebugState');
      }
      document.querySelector('[data-tab="worlds"]')?.click();
      let debug = window.kaminosWorldChambersDebugState();
      for (let i = 0; i < 80; i++) {
        debug = window.kaminosWorldChambersDebugState();
        if (debug.receiptSource?.mode && debug.receiptSource.mode !== 'embedded_fixture') break;
        if (debug.receiptLoadError) break;
        await wait(125);
      }
      const tab = document.querySelector('[data-tab="worlds"]');
      const panel = document.getElementById('tab-worlds');
      return {
        debug,
        tabActive: !!tab && tab.classList.contains('active'),
        panelActive: !!panel && panel.classList.contains('active'),
        title: document.getElementById('world-chamber-title')?.textContent?.trim() || null,
        routeText: document.getElementById('world-chamber-route')?.textContent?.trim() || null,
        authorityText: document.getElementById('world-chamber-authority')?.textContent?.trim() || null,
        receiptSourceText: document.getElementById('world-chamber-receipt-source')?.textContent?.trim() || null,
        loadErrorText: document.getElementById('world-chamber-load-error')?.textContent?.trim() || null,
      };
    })()
  `, { timeoutMs: 15000 });
  const evidence = lastEvidence.worldChambersLermsUnderhillReceiptUrl;
  if (!evidence.tabActive || !evidence.panelActive) {
    throw new Error(`world chambers receipt-url tab did not activate: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.receiptLoadError) {
    throw new Error(`world chambers receipt-url load failed: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.activeChamberId !== 'lerms-underhill') {
    throw new Error(`world chambers receipt-url active chamber mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.route !== 'first-vertical-composer/witness-file') {
    throw new Error(`world chambers receipt-url route mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.authority !== 'synthetic_fixture') {
    throw new Error(`world chambers receipt-url authority mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.receiptSource?.mode !== 'external_url' && evidence.debug?.receiptSource?.mode !== 'server_file') {
    throw new Error(`world chambers receiptSource was not external: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.usingFixtureFallback !== false) {
    throw new Error(`world chambers receipt-url used fixture fallback: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.summary?.lerms !== 8 || evidence.debug?.summary?.goins !== 2) {
    throw new Error(`world chambers receipt-url summary mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.debug?.summary?.carrierDrops !== 1 || evidence.debug?.summary?.juiceHits !== 1) {
    throw new Error(`world chambers receipt-url event summary mismatch: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.receiptSourceText || evidence.receiptSourceText === 'embedded Kaminos fixture receipt') {
    throw new Error(`world chambers receipt source UI did not show external source: ${JSON.stringify(evidence)}`);
  }
}

async function runLermsPreviewBenchTerrainScenario(ws) {
  phase = 'scenario-lerms-preview-bench-terrain';
  lastEvidence.lermsPreviewBenchTerrain = await evaluate(ws, `
    (() => {
      if (!window.__kaminosLermsPreviewState) {
        throw new Error('LERMS Preview Bench witness missing window.__kaminosLermsPreviewState');
      }
      document.querySelector('[data-tab="worlds"]')?.click();
      const state = window.kaminosLermsPreviewBenchDebugState?.() || window.__kaminosLermsPreviewState;
      const tab = document.querySelector('[data-tab="worlds"]');
      const panel = document.getElementById('tab-worlds');
      return {
        state,
        tabActive: !!tab && tab.classList.contains('active'),
        panelActive: !!panel && panel.classList.contains('active'),
        title: document.getElementById('lerms-preview-title')?.textContent?.trim() || null,
        routeText: document.getElementById('lerms-preview-route')?.textContent?.trim() || null,
        benchText: document.getElementById('lerms-preview-bench-id')?.textContent?.trim() || null,
        postureText: document.getElementById('lerms-preview-posture')?.textContent?.trim() || null,
        cameraText: document.getElementById('lerms-preview-camera')?.textContent?.trim() || null,
        sourceBadgeText: document.getElementById('lerms-preview-source-badge')?.textContent?.trim() || null,
        fallbackBadgeText: document.getElementById('lerms-preview-fallback-badge')?.textContent?.trim() || null,
        freshnessBadgeText: document.getElementById('lerms-preview-freshness-badge')?.textContent?.trim() || null,
        terrainText: document.getElementById('lerms-preview-terrain-count')?.textContent?.trim() || null,
        cameraChips: [...document.querySelectorAll('#lerms-preview-camera-list .lerms-preview-camera')].map(chip => chip.textContent.trim()),
      };
    })()
  `);
  const evidence = lastEvidence.lermsPreviewBenchTerrain;
  if (!evidence.tabActive || !evidence.panelActive) {
    throw new Error(`LERMS Preview Bench tab did not activate: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.schema !== 'kaminos.lerms-preview-witness.v0') {
    throw new Error(`LERMS Preview Bench witness schema mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.hostDescriptor !== 'kaminos.world-chamber.preview-bench.v0') {
    throw new Error(`LERMS Preview Bench host descriptor mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.chamberId !== 'lerms-underhill' || evidence.state?.benchId !== 'terrain-preview') {
    throw new Error(`LERMS Preview Bench route identity mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.route !== 'world_chamber=lerms-underhill&posture=inspect&bench=terrain-preview') {
    throw new Error(`LERMS Preview Bench route mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.badges?.source !== 'synthetic_fixture' || evidence.state?.badges?.fallback !== 'embedded_fixture') {
    throw new Error(`LERMS Preview Bench source/fallback badges mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.activeCamera?.id !== 'overview-oblique') {
    throw new Error(`LERMS Preview Bench camera mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.terrain?.sampleCount !== 16) {
    throw new Error(`LERMS Preview Bench terrain sample count mismatch: ${JSON.stringify(evidence)}`);
  }
  const cameraIds = ['overview-oblique', 'topographic-top', 'route-follow', 'actor-close', 'terrain-cross-section', 'operator-free-camera'];
  for (const cameraId of cameraIds) {
    if (!evidence.cameraChips.includes(cameraId)) {
      throw new Error(`LERMS Preview Bench missing camera chip ${cameraId}: ${JSON.stringify(evidence)}`);
    }
  }
}

async function runLermsPreviewBenchActorMotionScenario(ws) {
  phase = 'scenario-lerms-preview-bench-actor-motion';
  lastEvidence.lermsPreviewBenchActorMotion = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      if (!window.__kaminosLermsPreviewState) {
        throw new Error('LERMS actor motion witness missing window.__kaminosLermsPreviewState');
      }
      document.querySelector('[data-tab="worlds"]')?.click();
      let state = window.kaminosLermsPreviewBenchDebugState?.() || window.__kaminosLermsPreviewState;
      for (let i = 0; i < 80; i++) {
        state = window.kaminosLermsPreviewBenchDebugState?.() || window.__kaminosLermsPreviewState;
        if (state.actorMotion?.actorCount) break;
        await wait(125);
      }
      const actorMotionPayload = state.actorMotion || null;
      return {
        state,
        actorMotionPayload,
        actorVisuals: window.__kaminosLermsPreviewActorVisuals || null,
        actorVisualObjects: [...(window.__kaminosLermsPreviewActorsGroup?.children || [])].map(child => child.userData?.kaminosLermsPreviewActor || null).filter(Boolean),
        tabActive: !!document.querySelector('[data-tab="worlds"]')?.classList.contains('active'),
        panelActive: !!document.getElementById('tab-worlds')?.classList.contains('active'),
        title: document.getElementById('lerms-preview-title')?.textContent?.trim() || null,
        routeText: document.getElementById('lerms-preview-route')?.textContent?.trim() || null,
        actorMotionBadge: document.getElementById('lerms-preview-actor-motion-badge')?.textContent?.trim() || null,
        actorCountText: document.getElementById('lerms-preview-actor-count')?.textContent?.trim() || null,
        statesText: document.getElementById('lerms-preview-actor-states')?.textContent?.trim() || null,
        motionSourceText: document.getElementById('lerms-preview-motion-source')?.textContent?.trim() || null,
        downgradeText: document.getElementById('lerms-preview-motion-downgrade')?.textContent?.trim() || null,
      };
    })()
  `, { timeoutMs: 15000 });
  const evidence = lastEvidence.lermsPreviewBenchActorMotion;
  if (!evidence.tabActive || !evidence.panelActive) {
    throw new Error(`LERMS actor motion Preview Bench tab did not activate: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.schema !== 'kaminos.lerms-preview-witness.v0') {
    throw new Error(`LERMS actor motion witness state schema mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.chamberId !== 'lerms-underhill' || evidence.state?.benchId !== 'terrain-preview') {
    throw new Error(`LERMS actor motion route identity mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorMotionPayload?.payloadSchema !== 'lerms.preview-bench-actor-motion-payload.v0') {
    throw new Error(`LERMS actor motion payload schema mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorMotionPayload?.route !== 'lerms/preview-bench/actor-motion-payload-file') {
    throw new Error(`LERMS actor motion payload route mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorMotionPayload?.source?.authority !== 'live_simulation') {
    throw new Error(`LERMS actor motion source authority mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorMotionPayload?.actorCount < 6) {
    throw new Error(`LERMS actor motion actor count too low: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.actorMotionPayload?.states?.includes('hit_reacting') || !evidence.actorMotionPayload?.states?.includes('rerouting_to_goin')) {
    throw new Error(`LERMS actor motion state coverage missing hit/reroute: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorMotionPayload?.selectedClipletSource?.model !== 'kimodo') {
    throw new Error(`LERMS actor motion cliplet model mismatch: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.actorMotionPayload?.downgrades?.includes('gutterglass_camera_witness_custody_not_claimed')) {
    throw new Error(`LERMS actor motion payload did not preserve custody downgrade: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorMotionBadge !== 'live_simulation') {
    throw new Error(`LERMS actor motion UI badge mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorVisuals?.schema !== 'kaminos.lerms-preview-actor-visual-layer.v0') {
    throw new Error(`LERMS actor visual layer schema mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorVisuals?.actorVisualCount !== evidence.actorMotionPayload.actorCount) {
    throw new Error(`LERMS actor visual count does not match payload actor count: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorVisualObjects?.length !== evidence.actorMotionPayload.actorCount) {
    throw new Error(`LERMS actor visual objects missing from scene: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.actorVisualObjects.every(actor => actor.kind === 'proxy_schnoz_sphere' && actor.downgrade === 'proxy_body_visual_only')) {
    throw new Error(`LERMS actor visual objects lost proxy downgrade identity: ${JSON.stringify(evidence)}`);
  }
}

async function runPreviewBenchPayloadContractScenario(ws) {
  phase = 'scenario-preview-bench-payload-contract';
  lastEvidence.previewBenchPayloadContract = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      if (!window.__kaminosLermsPreviewState) {
        throw new Error('Preview Bench payload witness missing window.__kaminosLermsPreviewState');
      }
      document.querySelector('[data-tab="worlds"]')?.click();
      let state = window.kaminosLermsPreviewBenchDebugState?.() || window.__kaminosLermsPreviewState;
      for (let i = 0; i < 80; i++) {
        state = window.kaminosLermsPreviewBenchDebugState?.() || window.__kaminosLermsPreviewState;
        if ((state.previewPayloads || []).length) break;
        await wait(125);
      }
      const previewBenchPayloads = window.__kaminosPreviewBenchPayloads || state.previewPayloads || [];
      return {
        state,
        previewBenchPayloads,
        tabActive: !!document.querySelector('[data-tab="worlds"]')?.classList.contains('active'),
        panelActive: !!document.getElementById('tab-worlds')?.classList.contains('active'),
        adapterCountText: document.getElementById('lerms-preview-adapter-count')?.textContent?.trim() || null,
        adapterRows: [...document.querySelectorAll('#preview-bench-adapter-list .world-chamber-row')].map(row => ({
          text: row.textContent?.trim() || '',
          schema: row.dataset.previewBenchPayloadSchema || row.dataset.previewBenchPayloadField || null,
          route: row.dataset.previewBenchPayloadRoute || null,
          authority: row.dataset.previewBenchPayloadAuthority || null,
        })),
      };
    })()
  `, { timeoutMs: 15000 });
  const evidence = lastEvidence.previewBenchPayloadContract;
  if (!evidence.tabActive || !evidence.panelActive) {
    throw new Error(`Preview Bench payload tab did not activate: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.schema !== 'kaminos.lerms-preview-witness.v0') {
    throw new Error(`Preview Bench payload host state schema mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.hostDescriptor !== 'kaminos.world-chamber.preview-bench.v0') {
    throw new Error(`Preview Bench payload host descriptor mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.state?.chamberId !== 'lerms-underhill' || evidence.state?.benchId !== 'terrain-preview') {
    throw new Error(`Preview Bench payload route identity mismatch: ${JSON.stringify(evidence)}`);
  }
  const payload = evidence.previewBenchPayloads?.[0];
  if (payload?.schema !== 'kaminos.preview-bench.payload-state.v0') {
    throw new Error(`Preview Bench payload state schema mismatch: ${JSON.stringify(evidence)}`);
  }
  if (!payload.payloadSchema || payload.payloadSchema.startsWith('kaminos.')) {
    throw new Error(`Preview Bench payload did not preserve source-owned schema: ${JSON.stringify(evidence)}`);
  }
  if (!payload.route || payload.route === 'kaminos/preview-bench/payload-file') {
    throw new Error(`Preview Bench payload did not preserve source-owned route: ${JSON.stringify(evidence)}`);
  }
  if (!payload.source?.authority) {
    throw new Error(`Preview Bench payload source authority missing: ${JSON.stringify(evidence)}`);
  }
  if (!Array.isArray(payload.rejectedSurfaces) || payload.rejectedSurfaces.length === 0) {
    throw new Error(`Preview Bench payload rejected debug surfaces missing: ${JSON.stringify(evidence)}`);
  }
  if (!payload.custody?.sourceOwns?.length || !payload.custody?.kaminosOwns?.length) {
    throw new Error(`Preview Bench payload custody split missing: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.adapterRows?.some(row => row.schema === payload.payloadSchema && row.authority === payload.source.authority)) {
    throw new Error(`Preview Bench payload UI row missing schema/authority identity: ${JSON.stringify(evidence)}`);
  }
  if (evidence.adapterCountText !== String(evidence.previewBenchPayloads.length)) {
    throw new Error(`Preview Bench payload UI count mismatch: ${JSON.stringify(evidence)}`);
  }
}

async function runLermsPreviewBenchActorMotionTimelineScenario(ws) {
  phase = 'scenario-lerms-preview-bench-actor-motion-timeline';
  lastEvidence.lermsPreviewBenchActorMotionTimeline = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      if (!window.__kaminosLermsPreviewState) {
        throw new Error('LERMS actor timeline witness missing window.__kaminosLermsPreviewState');
      }
      document.querySelector('[data-tab="worlds"]')?.click();
      let state = window.kaminosLermsPreviewBenchDebugState?.() || window.__kaminosLermsPreviewState;
      for (let i = 0; i < 80; i++) {
        state = window.kaminosLermsPreviewBenchDebugState?.() || window.__kaminosLermsPreviewState;
        if (state.actorMotionTimeline?.frameCount) break;
        await wait(125);
      }
      const sample = () => ({
        playbackFrame: window.__kaminosLermsPreviewTimelinePlaybackFrame || null,
        actorVisuals: window.__kaminosLermsPreviewActorVisuals || null,
        actorObjects: [...(window.__kaminosLermsPreviewActorsGroup?.children || [])].map(child => ({
          ...(child.userData?.kaminosLermsPreviewActor || {}),
          position: child.position ? [Number(child.position.x.toFixed(3)), Number(child.position.y.toFixed(3)), Number(child.position.z.toFixed(3))] : null,
        })),
      });
      const first = sample();
      await wait(520);
      const second = sample();
      await wait(520);
      const third = sample();
      state = window.kaminosLermsPreviewBenchDebugState?.() || window.__kaminosLermsPreviewState;
      return {
        state,
        actorTimeline: state.actorMotionTimeline || null,
        playbackSamples: [first, second, third],
        tabActive: !!document.querySelector('[data-tab="worlds"]')?.classList.contains('active'),
        panelActive: !!document.getElementById('tab-worlds')?.classList.contains('active'),
        actorTimelineBadge: document.getElementById('lerms-preview-actor-timeline-badge')?.textContent?.trim() || null,
        timelineFrameText: document.getElementById('lerms-preview-timeline-frame')?.textContent?.trim() || null,
        actorCountText: document.getElementById('lerms-preview-actor-count')?.textContent?.trim() || null,
        statesText: document.getElementById('lerms-preview-actor-states')?.textContent?.trim() || null,
        downgradeText: document.getElementById('lerms-preview-motion-downgrade')?.textContent?.trim() || null,
      };
    })()
  `, { timeoutMs: 20000 });
  const evidence = lastEvidence.lermsPreviewBenchActorMotionTimeline;
  if (!evidence.tabActive || !evidence.panelActive) {
    throw new Error(`LERMS actor timeline Preview Bench tab did not activate: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorTimeline?.payloadSchema !== 'lerms.preview-bench-actor-motion-timeline.v0') {
    throw new Error(`LERMS actor timeline payload schema mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorTimeline?.route !== 'lerms/preview-bench/actor-motion-timeline-file') {
    throw new Error(`LERMS actor timeline route mismatch: ${JSON.stringify(evidence)}`);
  }
  if (evidence.actorTimeline?.frameCount < 6 || evidence.actorTimeline?.durationMs < 1200) {
    throw new Error(`LERMS actor timeline duration/frame count too low: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.actorTimeline?.requiresMotionWitness || evidence.actorTimeline?.staticActorPayloadAcceptedAsLoop !== false) {
    throw new Error(`LERMS actor timeline did not require motion witness: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.actorTimeline?.movingActorIds?.length || !evidence.actorTimeline?.stateTransitions?.length) {
    throw new Error(`LERMS actor timeline lacks motion/state-transition proof: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.actorTimeline?.downgrades?.includes('timevarying_payload_not_live_socket_stream')) {
    throw new Error(`LERMS actor timeline lost live-stream downgrade: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.actorTimelineBadge?.startsWith('timeline:')) {
    throw new Error(`LERMS actor timeline UI badge mismatch: ${JSON.stringify(evidence)}`);
  }
  const samples = evidence.playbackSamples || [];
  if (samples.length !== 3 || !samples.every(sample => sample.playbackFrame?.schema === 'kaminos.lerms-preview-timeline-playback-frame.v0')) {
    throw new Error(`LERMS actor timeline playback samples missing: ${JSON.stringify(evidence)}`);
  }
  const samplePositions = samples.map(sample => JSON.stringify((sample.actorObjects || []).map(actor => [actor.actorId, actor.position])));
  if (new Set(samplePositions).size < 2) {
    throw new Error(`LERMS actor timeline visual objects did not move between samples: ${JSON.stringify(evidence)}`);
  }
  if (!samples.every(sample => sample.actorVisuals?.actorVisualCount > 0)) {
    throw new Error(`LERMS actor timeline visual layer missing during playback: ${JSON.stringify(evidence)}`);
  }
}

async function runSelectedDeleteShortcutScenario(ws) {
  phase = 'scenario-selected-delete-shortcut';
  lastEvidence.selectedDeleteSetup = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = false;
      demo.click();
      for (let i = 0; i < 80; i++) {
        const rows = [...document.querySelectorAll('[data-scene-object-id]')];
        if (rows.length === 1 && rows[0].classList.contains('active')) break;
        await wait(125);
      }
      window.__kaminosConfirmMessages = [];
      window.confirm = message => {
        window.__kaminosConfirmMessages.push(String(message));
        return true;
      };
      return {
        rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
          id: row.dataset.sceneObjectId,
          active: row.classList.contains('active'),
          pressed: row.getAttribute('aria-pressed'),
        })),
        transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      };
    })()
  `);
  if (lastEvidence.selectedDeleteSetup.rows.length !== 1 || !lastEvidence.selectedDeleteSetup.rows[0].active) {
    throw new Error(`selected delete setup did not create one selected object: ${JSON.stringify(lastEvidence.selectedDeleteSetup)}`);
  }
  await wsRequest(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
  await wsRequest(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
  await delay(700);
  lastEvidence.selectedDeleteShortcut = await evaluate(ws, `
    (() => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      confirmMessages: window.__kaminosConfirmMessages || [],
      info: document.getElementById('info-bar').textContent.trim(),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      emptyVisible: getComputedStyle(document.getElementById('scene-object-empty')).display !== 'none',
    }))()
  `);
  if (lastEvidence.selectedDeleteShortcut.confirmMessages.length !== 1) {
    throw new Error(`selected delete shortcut did not ask for confirmation: ${JSON.stringify(lastEvidence.selectedDeleteShortcut)}`);
  }
  if (lastEvidence.selectedDeleteShortcut.rows.length !== 0) {
    throw new Error(`selected delete shortcut did not remove active scene object: ${JSON.stringify(lastEvidence.selectedDeleteShortcut)}`);
  }
  if (!lastEvidence.selectedDeleteShortcut.info.startsWith('Removed:')) {
    throw new Error(`selected delete shortcut did not report removal: ${JSON.stringify(lastEvidence.selectedDeleteShortcut)}`);
  }
  if (lastEvidence.selectedDeleteShortcut.transformBarVisible || !lastEvidence.selectedDeleteShortcut.emptyVisible) {
    throw new Error(`selected delete shortcut did not leave an empty deselected scene: ${JSON.stringify(lastEvidence.selectedDeleteShortcut)}`);
  }
}

async function runViewportClickSelectDeselectScenario(ws) {
  phase = 'scenario-viewport-click-select-deselect';
  lastEvidence.viewportClickSelectionSetup = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      document.getElementById('append-import-toggle').checked = false;
      if (rowState().length !== 1) {
        demo.click();
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === 1 && rows[0].active && rows[0].pressed === 'true') break;
          await wait(125);
        }
      } else {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === 1 && rows[0].active && rows[0].pressed === 'true') break;
          await wait(125);
        }
      }
      const rows = rowState();
      const canvas = document.querySelector('#viewport canvas');
      if (!canvas) throw new Error('viewport canvas missing');
      const rect = canvas.getBoundingClientRect();
      return {
        rows,
        selectedId: rows.find(row => row.active && row.pressed === 'true')?.id || null,
        transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
        emptyPoint: {
          x: Math.round(rect.left + rect.width * 0.88),
          y: Math.round(rect.top + rect.height * 0.76),
        },
        objectPoint: {
          x: Math.round(rect.left + rect.width * 0.52),
          y: Math.round(rect.top + rect.height * 0.52),
        },
      };
    })()
  `);
  if (lastEvidence.viewportClickSelectionSetup.rows.length !== 1 || !lastEvidence.viewportClickSelectionSetup.selectedId) {
    throw new Error(`viewport click selection setup did not create one selected object: ${JSON.stringify(lastEvidence.viewportClickSelectionSetup)}`);
  }
  if (!lastEvidence.viewportClickSelectionSetup.transformBarVisible) {
    throw new Error(`viewport click selection setup did not show transform toolbar: ${JSON.stringify(lastEvidence.viewportClickSelectionSetup)}`);
  }

  const dragStart = lastEvidence.viewportClickSelectionSetup.emptyPoint;
  const dragEnd = {
    x: dragStart.x + 24,
    y: dragStart.y + 18,
  };
  await dispatchMouseDrag(ws, dragStart, dragEnd);
  await delay(600);
  lastEvidence.viewportClickSelectionAfterDrag = await evaluate(ws, `
    (() => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      info: document.getElementById('info-bar').textContent.trim(),
    }))()
  `);
  const dragActiveRows = lastEvidence.viewportClickSelectionAfterDrag.rows.filter(row => row.active && row.pressed === 'true');
  if (dragActiveRows.length !== 1 || dragActiveRows[0].id !== lastEvidence.viewportClickSelectionSetup.selectedId) {
    throw new Error(`viewport drag changed scene object selection: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterDrag)}`);
  }
  if (!lastEvidence.viewportClickSelectionAfterDrag.transformBarVisible) {
    throw new Error(`viewport drag hid transform toolbar: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterDrag)}`);
  }
  if (lastEvidence.viewportClickSelectionAfterDrag.info === 'Selection cleared') {
    throw new Error(`viewport drag reported selection cleared: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterDrag)}`);
  }

  await dispatchMouseClick(ws, lastEvidence.viewportClickSelectionSetup.emptyPoint);
  await delay(600);
  lastEvidence.viewportClickSelectionAfterEmpty = await evaluate(ws, `
    (() => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      info: document.getElementById('info-bar').textContent.trim(),
    }))()
  `);
  const emptyActiveRows = lastEvidence.viewportClickSelectionAfterEmpty.rows.filter(row => row.active || row.pressed === 'true');
  if (emptyActiveRows.length !== 0) {
    throw new Error(`viewport empty click did not deselect scene object: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterEmpty)}`);
  }
  if (lastEvidence.viewportClickSelectionAfterEmpty.transformBarVisible) {
    throw new Error(`viewport empty click did not hide transform toolbar: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterEmpty)}`);
  }

  await dispatchMouseClick(ws, lastEvidence.viewportClickSelectionSetup.objectPoint);
  await delay(800);
  lastEvidence.viewportClickSelectionAfterObject = await evaluate(ws, `
    (() => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      info: document.getElementById('info-bar').textContent.trim(),
    }))()
  `);
  const objectActiveRows = lastEvidence.viewportClickSelectionAfterObject.rows.filter(row => row.active && row.pressed === 'true');
  if (objectActiveRows.length !== 1 || objectActiveRows[0].id !== lastEvidence.viewportClickSelectionSetup.selectedId) {
    throw new Error(`viewport object click did not select scene object: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterObject)}`);
  }
  if (!lastEvidence.viewportClickSelectionAfterObject.transformBarVisible) {
    throw new Error(`viewport object click did not restore transform toolbar: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterObject)}`);
  }
}

async function runSplatViewportEmptyDeselectScenario(ws) {
  phase = 'scenario-splat-viewport-empty-deselect';
  lastEvidence.splatViewportEmptyDeselectSetup = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        type: (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === row.dataset.sceneObjectId)?.type || null,
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const assetEntry = (assetData.entries || []).find(entry => entry.kind === 'splat' && entry.source && Number(entry.size || 0) > 1024)
        || (assetData.entries || []).find(entry => entry.kind === 'splat' && entry.source)
        || null;
      if (!assetEntry) throw new Error('splat asset fixture missing');
      await window.greenroomImportSplat(assetEntry.source, assetEntry.name || assetEntry.path || 'splat.ply', assetEntry.display || { title: assetEntry.name || 'Splat' }, { clear: true, metadata: { splat: { ...(assetEntry || {}), correction: assetEntry.correction, provenance: { root_id: assetEntry.root_id, asset_path: assetEntry.path } } } });
      for (let i = 0; i < 120; i++) {
        const rows = rowState();
        if (rows.length === 1 && rows[0].type === 'splat' && rows[0].active && rows[0].pressed === 'true') break;
        await wait(125);
      }
      const canvas = document.querySelector('#viewport canvas');
      if (!canvas) throw new Error('viewport canvas missing');
      const rect = canvas.getBoundingClientRect();
      return {
        rows: rowState(),
        assetEntry,
        transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
        emptyPoint: {
          x: Math.round(rect.left + rect.width * 0.94),
          y: Math.round(rect.top + rect.height * 0.88),
        },
      };
    })()
  `);
  const setupActiveRows = lastEvidence.splatViewportEmptyDeselectSetup.rows.filter(row => row.active && row.pressed === 'true');
  if (setupActiveRows.length !== 1 || setupActiveRows[0].type !== 'splat') {
    throw new Error(`splat empty-click setup did not create one selected splat: ${JSON.stringify(lastEvidence.splatViewportEmptyDeselectSetup)}`);
  }
  await dispatchMouseClick(ws, lastEvidence.splatViewportEmptyDeselectSetup.emptyPoint);
  await delay(700);
  lastEvidence.splatViewportEmptyDeselectAfterClick = await evaluate(ws, `
    (() => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        type: (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === row.dataset.sceneObjectId)?.type || null,
      })),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      info: document.getElementById('info-bar').textContent.trim(),
    }))()
  `);
  const activeRows = lastEvidence.splatViewportEmptyDeselectAfterClick.rows.filter(row => row.active || row.pressed === 'true');
  if (activeRows.length !== 0) {
    throw new Error(`splat viewport empty click did not deselect: ${JSON.stringify(lastEvidence.splatViewportEmptyDeselectAfterClick)}`);
  }
  if (lastEvidence.splatViewportEmptyDeselectAfterClick.transformBarVisible) {
    throw new Error(`splat viewport empty click did not hide transform toolbar: ${JSON.stringify(lastEvidence.splatViewportEmptyDeselectAfterClick)}`);
  }
}

async function runGreenroomPickerDisplayScenario(ws) {
  phase = 'scenario-greenroom-picker-display';
  lastEvidence.greenroomPickerDisplay = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const groupState = () => window.kaminosSceneGroupDebugState?.() || [];
      const infoText = () => document.getElementById('info-bar')?.textContent?.trim() || '';
      const previewState = () => {
        const panel = document.getElementById('greenroom-preview-controls');
        const importButton = document.querySelector('[data-greenroom-preview-action="import"]');
        return {
          active: !!window.greenroomPreviewIsActive?.(),
          visible: !!panel && !panel.hidden,
          title: document.getElementById('greenroom-preview-title')?.textContent?.trim() || null,
          source: document.getElementById('greenroom-preview-source')?.textContent?.trim() || null,
          importDisabled: importButton ? importButton.disabled : null,
          actions: [...document.querySelectorAll('[data-greenroom-preview-action]')].map(button => button.textContent.trim()),
        };
      };
      const previewDebug = () => window.greenroomPreviewDebugState?.() || {};
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const waitForPreviewActive = async active => {
        for (let i = 0; i < 120; i++) {
          const state = previewState();
          if (state.active === active && state.visible === active) return state;
          await wait(125);
        }
        return previewState();
      };
      const waitForPreviewObject = async route => {
        for (let i = 0; i < 160; i++) {
          const state = previewState();
          const debug = previewDebug();
          if (state.active && state.visible && !state.importDisabled
            && debug.previewObjectInScene
            && debug.previewObjectSource?.includes(route)) {
            return { state, debug };
          }
          await wait(125);
        }
        return { state: previewState(), debug: previewDebug() };
      };
      const sameRows = (a, b) => JSON.stringify(a.map(row => [row.id, row.label, row.source, row.active, row.pressed]))
        === JSON.stringify(b.map(row => [row.id, row.label, row.source, row.active, row.pressed]));
      const ensureBaseObject = async () => {
        if (rowState().length) return rowState();
        const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
        if (!demo) throw new Error('SuperMat Ring demo button missing');
        demo.click();
        return waitForSceneRows(1);
      };
      const setupRows = await ensureBaseObject();
      const beforeSceneFiles = new Set(await listScenes());
      await window.saveSceneAs();
      let savedFile = null;
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        const newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) {
          savedFile = newFiles[0];
          break;
        }
        await wait(125);
      }
      if (!savedFile) throw new Error('greenroom View setup did not create a saved scene target');
      const savedBeforeView = await readScene(savedFile);

      document.querySelector('[data-tab="greenroom"]').click();
      let rows = [];
      for (let i = 0; i < 80; i++) {
        rows = [...document.querySelectorAll('#greenroom-list .gr-entry')];
        if (rows.length) break;
        await wait(125);
      }
      const greenroomRawName = value => String(value || '').trim().replace(/^raw\\s+/i, '');
      const greenroomIdentityKey = value => greenroomRawName(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const grRowState = rows.map(row => {
        const title = row.querySelector('.gr-title')?.textContent?.trim() || null;
        const raw = row.querySelector('.gr-raw')?.textContent?.trim() || null;
        const rawName = greenroomRawName(raw);
        const titleIdentityKey = greenroomIdentityKey(title);
        const rawIdentityKey = greenroomIdentityKey(raw);
        return {
          title,
          subtitle: row.querySelector('.gr-subtitle')?.textContent?.trim() || null,
          raw,
          rawName,
          titleIdentityKey,
          rawIdentityKey,
          status: row.querySelector('.gr-status')?.textContent?.trim() || null,
          buttons: [...row.querySelectorAll('button')].map(button => button.textContent.trim()),
        };
      });
      const humaneRows = grRowState.filter(row => row.title && row.raw && row.titleIdentityKey !== row.rawIdentityKey);
      const loadRow = grRowState.find(row => row.rawName && row.buttons.includes('View') && row.buttons.includes('Import'));
      let loadProbe = null;
      if (loadRow) {
        const outputsResp = await fetch('/api/job-outputs?job_id=' + encodeURIComponent(loadRow.rawName));
        const outputsData = await outputsResp.json().catch(() => ({}));
        const mesh = (outputsData.entries || []).find(entry => /\\.(glb|gltf|obj)$/i.test(entry.name));
        loadProbe = {
          jobId: loadRow.rawName,
          outputsStatus: outputsResp.status,
          outputsOk: outputsResp.ok,
          outputsError: outputsData.error || null,
          mesh: mesh?.name || null,
          route: mesh ? '/api/job-output?job_id=' + encodeURIComponent(loadRow.rawName) + '&file=' + encodeURIComponent(mesh.name) : null,
          outputStatus: null,
          outputOk: false,
          outputContentType: null,
          outputBytes: 0,
        };
        if (mesh) {
          const outputResp = await fetch(loadProbe.route);
          const outputBuffer = await outputResp.arrayBuffer();
          loadProbe.outputStatus = outputResp.status;
          loadProbe.outputOk = outputResp.ok;
          loadProbe.outputContentType = outputResp.headers.get('content-type');
          loadProbe.outputBytes = outputBuffer.byteLength;
        }
      }
      const actionRow = [...document.querySelectorAll('#greenroom-list .gr-entry')]
        .find(row => row.querySelector('.gr-raw')?.textContent?.replace(/^raw\\s+/i, '').trim() === loadRow?.rawName);
      const viewButton = actionRow ? [...actionRow.querySelectorAll('button')].find(button => button.textContent.trim() === 'View') : null;
      const importButton = actionRow ? [...actionRow.querySelectorAll('button')].find(button => button.textContent.trim() === 'Import') : null;
      if (viewButton) {
        viewButton.click();
        await waitForPreviewActive(true);
        await waitForPreviewObject(loadProbe?.route);
      }
      const afterViewRows = rowState();
      const afterViewPreview = previewState();
      const afterViewInfo = infoText();
      const filesBeforeViewSave = new Set(await listScenes());
      const previewSaveResult = await window.saveScene();
      await wait(500);
      const filesAfterViewSave = await listScenes();
      const viewSaveFiles = filesAfterViewSave.filter(name => !filesBeforeViewSave.has(name));
      const previewSaveBlocked = previewSaveResult === false
        && viewSaveFiles.length === 0
        && infoText().includes('Greenroom preview is temporary');
      const previewEnteredTemporaryMode = afterViewPreview.active
        && afterViewPreview.visible
        && afterViewPreview.actions.includes('Import to Scene')
        && afterViewPreview.actions.includes('Back to Scene')
        && afterViewPreview.source?.includes(loadProbe?.route)
        && afterViewInfo.includes('Greenroom');
      const previewDidNotMutateAuthoredRows = afterViewRows.length === 0;
      const backButton = document.querySelector('[data-greenroom-preview-action="back"]');
      if (backButton) {
        backButton.click();
        await waitForPreviewActive(false);
        await waitForSceneRows(setupRows.length);
      }
      const afterBackRows = rowState();
      const backRestoredAuthoredRows = sameRows(setupRows, afterBackRows);
      if (viewButton) {
        viewButton.click();
        await waitForPreviewActive(true);
        await waitForPreviewObject(loadProbe?.route);
      }
      window.rotateAxis?.('y');
      const previewImportButton = document.querySelector('[data-greenroom-preview-action="import"]');
      if (previewImportButton) {
        previewImportButton.click();
        await waitForPreviewActive(false);
        await waitForSceneRows(setupRows.length + 1);
      }
      const savedAfterView = await readScene(savedFile);
      const afterPreviewImportRows = rowState();
      const viewProtectedSaveTarget = JSON.stringify(savedBeforeView) === JSON.stringify(savedAfterView);
      const authoredRowsAfterPreviewImport = afterPreviewImportRows.filter(row => setupRows.some(setup => setup.id === row.id));
      const previewImportedRows = afterPreviewImportRows.filter(row => row.label === loadRow?.title && row.source?.includes(loadProbe?.route));
      const afterPreviewImportGroups = groupState();
      const previewImportGroup = afterPreviewImportGroups.find(group => (
        group.label === loadRow?.title
        && group.source?.includes(loadProbe?.route)
        && previewImportedRows.some(row => group.objectIds?.includes(row.id))
      )) || null;
      const previewImportRestoredAndAppended = authoredRowsAfterPreviewImport.length === setupRows.length
        && previewImportedRows.length === 1
        && afterPreviewImportRows.length === setupRows.length + 1;
      const previewImportRowsGreenroomSourced = previewImportedRows.length === 1
        && previewImportedRows.every(row => row.source?.includes(loadProbe?.route));
      const previewImportCreatedGroup = !!previewImportGroup;
      for (const name of [savedFile, ...viewSaveFiles].filter(Boolean)) {
        await deleteScene(name);
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) {
          throw new Error('greenroom action cleanup did not delete scene file: ' + name);
        }
      }
      return {
        rowCount: rows.length,
        rows: grRowState.slice(0, 8),
        humaneRowCount: humaneRows.length,
        hasSubtitle: grRowState.some(row => row.subtitle),
        hasRaw: grRowState.some(row => row.raw),
        hasView: grRowState.some(row => row.buttons.includes('View')),
        hasImport: grRowState.some(row => row.buttons.includes('Import')),
        loadProbe,
        afterViewRows,
        afterViewPreview,
        afterViewInfo,
        afterBackRows,
        afterPreviewImportRows,
        afterPreviewImportGroups,
        previewImportGroup,
        savedFile,
        viewSaveFiles,
        viewProtectedSaveTarget,
        setupRows,
        previewSaveBlocked,
        previewEnteredTemporaryMode,
        previewDidNotMutateAuthoredRows,
        backRestoredAuthoredRows,
        previewImportRestoredAndAppended,
        previewImportRowsGreenroomSourced,
        previewImportCreatedGroup,
      };
    })()
  `, { timeoutMs: 90000 });

  if (lastEvidence.greenroomPickerDisplay.rowCount < 1) {
    throw new Error(`greenroom picker did not render any rows: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (lastEvidence.greenroomPickerDisplay.humaneRowCount < 1) {
    throw new Error(`greenroom picker titles still look raw-id-first: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.hasSubtitle || !lastEvidence.greenroomPickerDisplay.hasRaw) {
    throw new Error(`greenroom picker did not expose subtitle and raw metadata: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.hasView || !lastEvidence.greenroomPickerDisplay.hasImport) {
    throw new Error(`greenroom picker did not expose View and Import mesh actions: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  const loadProbe = lastEvidence.greenroomPickerDisplay.loadProbe;
  if (!loadProbe || !loadProbe.outputsOk || !loadProbe.mesh || !loadProbe.outputOk || loadProbe.outputBytes < 1) {
    throw new Error(`greenroom picker mesh route was not fetchable: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewEnteredTemporaryMode) {
    throw new Error(`greenroom View did not enter temporary preview mode: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewDidNotMutateAuthoredRows) {
    throw new Error(`greenroom View mutated authored scene rows: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewSaveBlocked) {
    throw new Error(`greenroom preview save was not blocked: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.backRestoredAuthoredRows) {
    throw new Error(`greenroom preview Back did not restore authored scene rows: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewImportRestoredAndAppended) {
    throw new Error(`greenroom preview Import to Scene did not restore and append into the authored scene: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewImportRowsGreenroomSourced) {
    throw new Error(`greenroom preview import did not preserve Greenroom route source: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewImportCreatedGroup) {
    throw new Error(`greenroom preview import did not create a grouped imported object: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.viewProtectedSaveTarget) {
    throw new Error(`greenroom View did not protect the previous save target: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
}

async function runGreenroomPreviewRaceScenario(ws) {
  phase = 'scenario-greenroom-preview-race';
  lastEvidence.greenroomPreviewRace = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const previewState = () => {
        const panel = document.getElementById('greenroom-preview-controls');
        return {
          active: !!window.greenroomPreviewIsActive?.(),
          visible: !!panel && !panel.hidden,
          title: document.getElementById('greenroom-preview-title')?.textContent?.trim() || null,
          source: document.getElementById('greenroom-preview-source')?.textContent?.trim() || null,
          actions: [...document.querySelectorAll('[data-greenroom-preview-action]')].map(button => button.textContent.trim()),
        };
      };
      const previewDebug = () => window.greenroomPreviewDebugState?.() || {};
      const waitForSceneRows = async count => {
        for (let i = 0; i < 160; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const waitForPreviewRoute = async route => {
        for (let i = 0; i < 160; i++) {
          const state = previewState();
          const debug = previewDebug();
          if (state.active
            && state.visible
            && state.source?.includes(route)
            && debug.previewObjectSource?.includes(route)
            && debug.previewSceneObjectSources?.length === 1
            && debug.previewSceneObjectSources[0]?.includes(route)) {
            return { state, debug };
          }
          await wait(125);
        }
        return { state: previewState(), debug: previewDebug() };
      };
      const ensureBaseObject = async () => {
        if (rowState().length) return rowState();
        const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
        if (!demo) throw new Error('SuperMat Ring demo button missing');
        demo.click();
        return waitForSceneRows(1);
      };
      const greenroomRawName = value => String(value || '').trim().replace(/^raw\\s+/i, '');
      const getJobOutputEvents = async query => {
        const suffix = query ? '?' + query : '';
        const resp = await fetch('/api/job-output-events' + suffix);
        const data = await resp.json().catch(() => ({}));
        return {
          ok: resp.ok,
          status: resp.status,
          events: Array.isArray(data.events) ? data.events : [],
          cleared: !!data.cleared,
          error: data.error || null,
        };
      };
      const outputRouteFor = async rawName => {
        const outputsResp = await fetch('/api/job-outputs?job_id=' + encodeURIComponent(rawName));
        const outputsData = await outputsResp.json().catch(() => ({}));
        const mesh = (outputsData.entries || []).find(entry => /\\.(glb|gltf|obj)$/i.test(entry.name));
        return {
          jobId: rawName,
          outputsStatus: outputsResp.status,
          outputsOk: outputsResp.ok,
          outputsError: outputsData.error || null,
          mesh: mesh?.name || null,
          route: mesh ? '/api/job-output?job_id=' + encodeURIComponent(rawName) + '&file=' + encodeURIComponent(mesh.name) : null,
        };
      };
      const setupRows = rowState();
      document.querySelector('[data-tab="greenroom"]').click();
      let entries = [];
      for (let i = 0; i < 120; i++) {
        entries = [...document.querySelectorAll('#greenroom-list .gr-entry')];
        if (entries.filter(entry => [...entry.querySelectorAll('button')].some(button => button.textContent.trim() === 'View')).length >= 2) break;
        const doneEntry = entries.find(entry => (
          entry.querySelector('.gr-title')?.textContent?.trim().toLowerCase() === 'done'
          || entry.querySelector('.gr-raw')?.textContent?.trim().toLowerCase() === 'raw done'
        ));
        if (doneEntry) doneEntry.click();
        await wait(125);
      }
      const raceRows = entries.map((entry, index) => ({
        index,
        title: entry.querySelector('.gr-title')?.textContent?.trim() || null,
        raw: entry.querySelector('.gr-raw')?.textContent?.trim() || null,
        rawName: greenroomRawName(entry.querySelector('.gr-raw')?.textContent?.trim() || ''),
        buttons: [...entry.querySelectorAll('button')].map(button => button.textContent.trim()),
      })).filter(row => row.rawName && row.buttons.includes('View'));
      if (raceRows.length < 2) {
        throw new Error('greenroom preview race fixture needs at least two View rows: ' + JSON.stringify(raceRows));
      }
      const raceA = raceRows[0];
      const raceB = raceRows[1];
      const raceRouteA = await outputRouteFor(raceA.rawName);
      const raceRouteB = await outputRouteFor(raceB.rawName);
      if (!raceRouteA.route || !raceRouteB.route) {
        throw new Error('greenroom preview race fixture rows did not expose mesh routes: ' + JSON.stringify({ raceRouteA, raceRouteB }));
      }
      const actionEntries = [...document.querySelectorAll('#greenroom-list .gr-entry')];
      const entryA = actionEntries.find(entry => greenroomRawName(entry.querySelector('.gr-raw')?.textContent?.trim() || '') === raceA.rawName);
      const entryB = actionEntries.find(entry => greenroomRawName(entry.querySelector('.gr-raw')?.textContent?.trim() || '') === raceB.rawName);
      const viewA = [...(entryA?.querySelectorAll('button') || [])].find(button => button.textContent.trim() === 'View');
      const viewB = [...(entryB?.querySelectorAll('button') || [])].find(button => button.textContent.trim() === 'View');
      if (!viewA || !viewB) {
        throw new Error('greenroom preview race View buttons disappeared: ' + JSON.stringify({ raceRows }));
      }
      const clearedJobOutputEvents = await getJobOutputEvents('clear=1');
      viewA.click();
      await wait(50);
      viewB.click();
      const afterSecondRoute = await waitForPreviewRoute(raceRouteB.route);
      const routeBOwnedAtMs = Date.now();
      await wait(3200);
      const jobOutputEventState = await getJobOutputEvents();
      const routeAEvents = jobOutputEventState.events.filter(event => event.job_id === raceA.rawName && event.file === raceRouteA.mesh);
      const routeBEvents = jobOutputEventState.events.filter(event => event.job_id === raceB.rawName && event.file === raceRouteB.mesh);
      const delayedRouteAEvent = routeAEvents.find(event => Number(event.delay_ms || 0) > 0) || null;
      const effectiveDelayMs = Number(delayedRouteAEvent?.delay_ms || 0);
      const routeACompletedAfterRouteBOwned = !!delayedRouteAEvent
        && Number(delayedRouteAEvent.ended_at_ms || 0) > routeBOwnedAtMs;
      const afterBothLoads = { state: previewState(), debug: previewDebug() };
      const sources = afterBothLoads.debug.previewSceneObjectSources || [];
      const raceSettledOnSecondRoute = afterBothLoads.state.active
        && afterBothLoads.state.visible
        && afterBothLoads.state.source?.includes(raceRouteB.route)
        && afterBothLoads.debug.previewObjectSource?.includes(raceRouteB.route)
        && sources.length === 1
        && sources[0]?.includes(raceRouteB.route)
        && afterBothLoads.debug.sceneObjectCount === 0;
      const firstRouteAbsent = !afterBothLoads.state.source?.includes(raceRouteA.route)
        && !afterBothLoads.debug.previewObjectSource?.includes(raceRouteA.route)
        && !sources.some(source => source?.includes(raceRouteA.route));
      const importButton = document.querySelector('[data-greenroom-preview-action="import"]');
      if (!importButton) throw new Error('greenroom preview race Import to Scene button missing');
      importButton.click();
      const afterImportRows = await waitForSceneRows(setupRows.length + 1);
      const routeBImports = afterImportRows.filter(row => row.source?.includes(raceRouteB.route));
      const routeAImports = afterImportRows.filter(row => row.source?.includes(raceRouteA.route));
      const importAppendedSecondRoute = afterImportRows.length === setupRows.length + 1
        && routeBImports.length === 1
        && routeAImports.length === 0;
      return {
        setupRows,
        raceRows: [raceA, raceB],
        raceRouteA,
        raceRouteB,
        clearedJobOutputEvents,
        afterSecondRoute,
        routeBOwnedAtMs,
        jobOutputEventState,
        routeAEvents,
        routeBEvents,
        delayedRouteAEvent,
        effectiveDelayMs,
        routeACompletedAfterRouteBOwned,
        afterBothLoads,
        afterImportRows,
        routeBImports,
        routeAImports,
        raceSettledOnSecondRoute,
        firstRouteAbsent,
        importAppendedSecondRoute,
      };
    })()
  `, { timeoutMs: 120000 });

  if (!lastEvidence.greenroomPreviewRace.raceSettledOnSecondRoute) {
    throw new Error(`greenroom preview race did not settle on the second route: ${JSON.stringify(lastEvidence.greenroomPreviewRace)}`);
  }
  if (!lastEvidence.greenroomPreviewRace.firstRouteAbsent) {
    throw new Error(`greenroom preview race leaked the first route into active preview state: ${JSON.stringify(lastEvidence.greenroomPreviewRace)}`);
  }
  if (!lastEvidence.greenroomPreviewRace.importAppendedSecondRoute) {
    throw new Error(`greenroom preview race import did not append the second route: ${JSON.stringify(lastEvidence.greenroomPreviewRace)}`);
  }
  if (!lastEvidence.greenroomPreviewRace.routeACompletedAfterRouteBOwned) {
    throw new Error(`greenroom preview race did not prove delayed route A completed after route B owned preview: ${JSON.stringify(lastEvidence.greenroomPreviewRace)}`);
  }
}

async function runGreenroomSplatHandoffScenario(ws) {
  phase = 'scenario-greenroom-splat-handoff';
  lastEvidence.greenroomSplatHandoff = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const loadSceneDocument = async (doc, name) => {
        const input = document.getElementById('scene-file-input');
        const file = new File([JSON.stringify(doc)], name, { type: 'application/json' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const waitForGreenroomRows = async () => {
        for (let i = 0; i < 100; i++) {
          const rows = [...document.querySelectorAll('#greenroom-list .gr-entry')];
          if (rows.length) return rows;
          await wait(125);
        }
        return [...document.querySelectorAll('#greenroom-list .gr-entry')];
      };
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const fetchRoute = async route => {
        if (!route) return null;
        const resp = await fetch(route);
        const body = await resp.arrayBuffer();
        return {
          route,
          ok: resp.ok,
          status: resp.status,
          contentType: resp.headers.get('content-type'),
          bytes: body.byteLength,
        };
      };

      document.querySelector('[data-tab="greenroom"]').click();
      const beforeRows = rowState();
      const greenroomRows = await waitForGreenroomRows();
      const actionRow = greenroomRows.find(row => [...row.querySelectorAll('button')]
        .some(button => button.textContent.trim() === 'Import Splat'));
      const actionButton = actionRow ? [...actionRow.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Import Splat') : null;
      const title = actionRow?.querySelector('.gr-title')?.textContent?.trim() || null;
      const raw = actionRow?.querySelector('.gr-raw')?.textContent?.replace(/^raw\\s+/i, '').trim() || null;
      let outputProbe = null;
      if (raw) {
        const outputsResp = await fetch('/api/job-outputs?job_id=' + encodeURIComponent(raw));
        const outputsData = await outputsResp.json().catch(() => ({}));
        const splat = (outputsData.entries || []).find(entry => /\\.(ply|spz)$/i.test(entry.name));
        if (splat) {
          const route = '/api/job-output?job_id=' + encodeURIComponent(raw) + '&file=' + encodeURIComponent(splat.name);
          outputProbe = await fetchRoute(route);
        }
      }
      if (actionButton) {
        actionButton.click();
      }
      const afterRows = await waitForSceneRows(beforeRows.length + 1);
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splatObject = sceneDebug.find(record => record.type === 'splat') || null;
      const handoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const pointCloudPreviewRendered = splatObject?.splat?.previewKind === 'point-cloud';
      const pointCloudPreviewPointCount = Number(splatObject?.splat?.pointCount || 0);
      const beforeSceneFiles = new Set(await listScenes());
      const savedOk = await window.saveSceneAs();
      let savedFile = null;
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        const newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) {
          savedFile = newFiles[0];
          break;
        }
        await wait(125);
      }
      const savedScene = savedFile ? await readScene(savedFile) : null;
      const savedSplatObject = (savedScene?.objects || []).find(record => record.type === 'splat') || null;
      const savedSplatMetadataPreserved = !!savedSplatObject
        && savedSplatObject.source === splatObject?.source
        && savedSplatObject.splat?.assetSource === splatObject?.source
        && savedSplatObject.renderHandoffSchema === 'kaminos.render-handoff.v0'
        && savedSplatObject.renderCapabilities?.meshDepthOcclusion === false;
      if (savedScene && savedFile) {
        await loadSceneDocument(savedScene, savedFile);
        await waitForSceneRows(savedScene.objects?.length || 1);
      }
      const reloadedSceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const reloadedSplatObject = reloadedSceneDebug.find(record => record.type === 'splat') || null;
      const reloadedHandoffDebug = window.kaminosRenderHandoffDebugState?.(reloadedSplatObject?.id) || null;
      const loadRestoredSplatObject = !!reloadedSplatObject
        && reloadedSplatObject.source === splatObject?.source
        && reloadedHandoffDebug?.activeHandoff?.source === splatObject?.source;
      const loadRestoredPointCloudState = reloadedSplatObject?.splat?.previewKind === 'point-cloud'
        && Number(reloadedSplatObject?.splat?.pointCount || 0) === pointCloudPreviewPointCount;
      let cleanup = null;
      let postCleanupFiles = null;
      if (savedFile) {
        cleanup = await deleteScene(savedFile);
        postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(savedFile)) {
          throw new Error('splat handoff cleanup did not delete saved scene file: ' + savedFile);
        }
      }
      return {
        beforeRows,
        afterRows,
        greenroomRowCount: greenroomRows.length,
        actionExposed: !!actionButton,
        title,
        raw,
        outputProbe,
        sceneDebug,
        splatObject,
        handoffDebug,
        pointCloudPreviewRendered,
        pointCloudPreviewPointCount,
        savedOk,
        savedFile,
        savedSplatObject,
        savedSplatMetadataPreserved,
        reloadedSceneDebug,
        reloadedSplatObject,
        reloadedHandoffDebug,
        loadRestoredSplatObject,
        loadRestoredPointCloudState,
        cleanup,
        postCleanupFiles,
      };
    })()
  `, { timeoutMs: 60000 });

  if (!lastEvidence.greenroomSplatHandoff.actionExposed) {
    throw new Error(`Greenroom splat fixture did not expose Import Splat action: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  const splatObject = lastEvidence.greenroomSplatHandoff.splatObject;
  if (!splatObject || splatObject.type !== 'splat') {
    throw new Error(`splat handoff did not register a type=splat scene object: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  const source = splatObject.source || '';
  const handoffSource = lastEvidence.greenroomSplatHandoff.handoffDebug?.activeHandoff?.source || '';
  if (!source.includes('/api/') || source !== handoffSource) {
    throw new Error(`splat handoff did not preserve route source: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  const capabilities = lastEvidence.greenroomSplatHandoff.handoffDebug?.activeHandoff?.capabilities || {};
  if (capabilities.meshDepthOcclusion !== false) {
    throw new Error(`splat handoff did not record meshDepthOcclusion=false: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (capabilities.sharedCanvasComposite !== false) {
    throw new Error(`splat handoff did not record sharedCanvasComposite=false: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (capabilities.realSplatRendering !== false) {
    throw new Error(`splat handoff claimed real splat rendering: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (!lastEvidence.greenroomSplatHandoff.pointCloudPreviewRendered) {
    throw new Error(`splat preview did not render a point cloud: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (lastEvidence.greenroomSplatHandoff.pointCloudPreviewPointCount < 1) {
    throw new Error(`splat preview did not report point count: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (!lastEvidence.greenroomSplatHandoff.savedSplatMetadataPreserved) {
    throw new Error(`splat handoff saved scene did not preserve splat metadata: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (!lastEvidence.greenroomSplatHandoff.loadRestoredSplatObject) {
    throw new Error(`splat handoff scene load did not restore splat object: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (!lastEvidence.greenroomSplatHandoff.loadRestoredPointCloudState) {
    throw new Error(`splat preview lost point-cloud state after scene load: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
}

async function runHybridSplatOverlayScenario(ws) {
  phase = 'scenario-hybrid-splat-overlay';
  lastEvidence.hybridSplatOverlay = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const waitForAssetRows = async () => {
        for (let i = 0; i < 100; i++) {
          const rows = [...document.querySelectorAll('#splat-assets-list .gr-entry')];
          if (rows.length) return rows;
          await wait(125);
        }
        return [...document.querySelectorAll('#splat-assets-list .gr-entry')];
      };
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };
      document.querySelector('[data-tab="greenroom"]').click();
      if (window.grBrowseSplatAssets) await window.grBrowseSplatAssets();
      const beforeRows = rowState();
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const assetRows = await waitForAssetRows();
      const assetEntry = (assetData.entries || [])[0] || null;
      const actionRow = assetRows.find(row => row.dataset.assetSource === assetEntry?.source
        && [...row.querySelectorAll('button')].some(button => button.textContent.trim() === 'Import Splat'))
        || assetRows.find(row => [...row.querySelectorAll('button')]
        .some(button => button.textContent.trim() === 'Import Splat'));
      const actionButton = actionRow ? [...actionRow.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Import Splat') : null;
      if (actionButton) actionButton.click();
      await waitForSceneRows(beforeRows.length + 1);
      const splatObject = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.type === 'splat') || null;
      if (splatObject?.id) window.selectSceneObject?.(splatObject.id);
      await wait(250);
      const panel = document.getElementById('splat-hybrid-renderer-panel');
      const startButton = document.getElementById('splat-hybrid-renderer-start-button');
      const statusEl = document.getElementById('splat-hybrid-renderer-status');
      const moduleSource = [
        'export async function createSplatOverlay(container, options = {}) {',
        '  const canvas = document.createElement("canvas");',
        '  canvas.dataset.hybridSplatOverlayWitness = "1";',
        '  canvas.width = 32;',
        '  canvas.height = 32;',
        '  container.appendChild(canvas);',
        '  const capabilities = Object.freeze({ canvasMode: "dual-canvas-overlay", meshDepthOcclusion: false, sharedCanvasComposite: false, sharedCommandEncoder: false, cropAppliedByRenderer: true });',
        '  const state = { sources: [], frames: 0, modelMatrices: [], viewports: [], corrections: [], sceneContexts: [], sceneContextTelemetry: null, started: false, stopped: false, destroyed: false, options, sourceIdentity: null, correctionApplication: null, capabilities };',
        '  function publish() { window.__hybridSplatOverlayWitness = { ...state, canvasConnected: canvas.isConnected }; }',
        '  publish();',
        '  return {',
        '    canvas,',
        '    get scene() { return state.sources.length ? { witnessScene: true } : null; },',
        '    get capabilities() { return capabilities; },',
        '    get sourceIdentity() { return state.sourceIdentity; },',
        '    get correctionApplication() { return state.correctionApplication; },',
        '    get cropAppliedByRenderer() { return state.correctionApplication?.cropApplied; },',
        '    setCameraMatrices(viewMatrix, projectionMatrix, cameraPosition) { state.frames += 1; state.lastViewLength = viewMatrix.length; state.lastProjectionLength = projectionMatrix.length; state.lastCameraLength = cameraPosition.length; publish(); },',
        '    setModelMatrix(matrix) { state.modelMatrices.push(Array.from(matrix)); publish(); },',
        '    setViewport(width, height, devicePixelRatio = 1) { state.viewports.push({ width, height, devicePixelRatio }); publish(); },',
        '    setCorrectionIdentity(correction) { const cropApplied = correction?.crop?.enabled === true; state.corrections.push(correction); state.correctionApplication = { cropApplied, cropFrame: cropApplied ? "witness-renderer-crop" : "disabled", sourceCount: 3, keptCount: cropApplied ? 2 : 3 }; if (state.sourceIdentity) state.sourceIdentity = { ...state.sourceIdentity, correctionApplied: true, correctionIdentity: correction }; publish(); },',
        '    setSceneContext(context) { const telemetry = { accepted: true, acceptedFields: ["lighting.environment", "lighting.exposure", "composition.background"], honoredFields: ["composition.background"], unsupportedFields: ["hostDepthTexture"], stale: false, ignored: false, missing: false, failurePhase: null }; state.sceneContexts.push(context); state.sceneContextTelemetry = telemetry; publish(); return telemetry; },',
        '    async loadPly(source, fileName) { state.sources.push({ source: String(source), fileName: fileName || null }); state.sourceIdentity = { source: String(source), loadMethod: "ply-url", correctionApplied: false }; publish(); },',
        '    async loadManifest(url) { state.sources.push({ manifest: String(url) }); state.sourceIdentity = { source: String(url), loadMethod: "manifest", correctionApplied: false }; publish(); },',
        '    loadAttributes(attributes) { state.attributeKeys = Object.keys(attributes || {}); state.sourceIdentity = { source: String(attributes?.sourceKind || "attributes"), loadMethod: "attributes", correctionApplied: false }; publish(); },',
        '    start() { state.started = true; publish(); },',
        '    stop() { state.stopped = true; publish(); },',
        '    destroy() { state.destroyed = true; canvas.remove(); publish(); },',
        '  };',
        '}',
      ].join('\\n');
      const missingTelemetryModuleSource = [
        'export async function createSplatOverlay(container, options = {}) {',
        '  const canvas = document.createElement("canvas");',
        '  canvas.dataset.hybridSplatOverlayWitness = "missing-scene-context-telemetry";',
        '  canvas.width = 32;',
        '  canvas.height = 32;',
        '  container.appendChild(canvas);',
        '  const capabilities = Object.freeze({ canvasMode: "dual-canvas-overlay", meshDepthOcclusion: false, sharedCanvasComposite: false, sharedCommandEncoder: false, cropAppliedByRenderer: true });',
        '  const state = { sources: [], frames: 0, modelMatrices: [], viewports: [], corrections: [], sceneContexts: [], sceneContextTelemetry: null, started: false, stopped: false, destroyed: false, options, sourceIdentity: null, correctionApplication: null, capabilities };',
        '  function publish() { window.__hybridSplatOverlayWitness = { ...state, canvasConnected: canvas.isConnected }; }',
        '  publish();',
        '  return {',
        '    canvas,',
        '    get scene() { return state.sources.length ? { witnessScene: true } : null; },',
        '    get capabilities() { return capabilities; },',
        '    get sourceIdentity() { return state.sourceIdentity; },',
        '    get correctionApplication() { return state.correctionApplication; },',
        '    get cropAppliedByRenderer() { return state.correctionApplication?.cropApplied; },',
        '    setCameraMatrices(viewMatrix, projectionMatrix, cameraPosition) { state.frames += 1; state.lastViewLength = viewMatrix.length; state.lastProjectionLength = projectionMatrix.length; state.lastCameraLength = cameraPosition.length; publish(); },',
        '    setModelMatrix(matrix) { state.modelMatrices.push(Array.from(matrix)); publish(); },',
        '    setViewport(width, height, devicePixelRatio = 1) { state.viewports.push({ width, height, devicePixelRatio }); publish(); },',
        '    setCorrectionIdentity(correction) { const cropApplied = correction?.crop?.enabled === true; state.corrections.push(correction); state.correctionApplication = { cropApplied, cropFrame: cropApplied ? "witness-renderer-crop" : "disabled", sourceCount: 3, keptCount: cropApplied ? 2 : 3 }; if (state.sourceIdentity) state.sourceIdentity = { ...state.sourceIdentity, correctionApplied: true, correctionIdentity: correction }; publish(); },',
        '    setSceneContext(context) { state.sceneContexts.push(context); state.sceneContextTelemetry = undefined; publish(); },',
        '    async loadPly(source, fileName) { state.sources.push({ source: String(source), fileName: fileName || null }); state.sourceIdentity = { source: String(source), loadMethod: "ply-url", correctionApplied: false }; publish(); },',
        '    async loadManifest(url) { state.sources.push({ manifest: String(url) }); state.sourceIdentity = { source: String(url), loadMethod: "manifest", correctionApplied: false }; publish(); },',
        '    loadAttributes(attributes) { state.attributeKeys = Object.keys(attributes || {}); state.sourceIdentity = { source: String(attributes?.sourceKind || "attributes"), loadMethod: "attributes", correctionApplied: false }; publish(); },',
        '    start() { state.started = true; publish(); },',
        '    stop() { state.stopped = true; publish(); },',
        '    destroy() { state.destroyed = true; canvas.remove(); publish(); },',
        '  };',
        '}',
      ].join('\\n');
      const malformedTelemetryModuleSource = missingTelemetryModuleSource
        .replace('missing-scene-context-telemetry', 'malformed-scene-context-telemetry')
        .replace('setSceneContext(context) { state.sceneContexts.push(context); state.sceneContextTelemetry = undefined; publish(); }',
          'setSceneContext(context) { const telemetry = {}; state.sceneContexts.push(context); state.sceneContextTelemetry = telemetry; publish(); return telemetry; }');
      const rendererTelemetryModuleSource = moduleSource
        .replace('hybridSplatOverlayWitness = "1"', 'hybridSplatOverlayWitness = "renderer-scene-context-telemetry"')
        .replace('setSceneContext(context) { const telemetry = { accepted: true, acceptedFields: ["lighting.environment", "lighting.exposure", "composition.background"], honoredFields: ["composition.background"], unsupportedFields: ["hostDepthTexture"], stale: false, ignored: false, missing: false, failurePhase: null }; state.sceneContexts.push(context); state.sceneContextTelemetry = telemetry; publish(); return telemetry; }',
          'setSceneContext(context) { const telemetry = { schema: "hybrid-render.scene-context.v0", accepted: true, timestamp: "2026-06-25T00:00:00.000Z", frameId: context?.producer?.frameId || null, honored: { environment: true, environmentIntensity: true, environmentRotation: true, exposure: false, toneMapping: false, lights: false, depthSource: false }, unsupported: ["toneMapping:aces", "lights", "depthSource:host-depth-texture"] }; state.sceneContexts.push(context); state.sceneContextTelemetry = telemetry; publish(); return telemetry; }');
      const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
      window.kaminosSetHybridSplatOverlayModuleUrl?.(moduleUrl);
      const startResult = await window.startHybridSplatSceneRenderer?.();
      await wait(500);
      const overlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const handoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const witness = window.__hybridSplatOverlayWitness || null;
      window.stopHybridSplatOverlay?.();
      URL.revokeObjectURL(moduleUrl);
      const rendererTelemetryModuleUrl = URL.createObjectURL(new Blob([rendererTelemetryModuleSource], { type: 'text/javascript' }));
      window.kaminosSetHybridSplatOverlayModuleUrl?.(rendererTelemetryModuleUrl);
      const rendererTelemetryStartResult = await window.startSelectedSplatHybridRenderer?.();
      await wait(500);
      const rendererTelemetryOverlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const rendererTelemetryHandoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const rendererTelemetryWitness = window.__hybridSplatOverlayWitness || null;
      window.stopHybridSplatOverlay?.();
      URL.revokeObjectURL(rendererTelemetryModuleUrl);
      const missingTelemetryModuleUrl = URL.createObjectURL(new Blob([missingTelemetryModuleSource], { type: 'text/javascript' }));
      window.kaminosSetHybridSplatOverlayModuleUrl?.(missingTelemetryModuleUrl);
      const missingTelemetryStartResult = await window.startSelectedSplatHybridRenderer?.();
      await wait(500);
      const missingTelemetryOverlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const missingTelemetryHandoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const missingTelemetryWitness = window.__hybridSplatOverlayWitness || null;
      window.stopHybridSplatOverlay?.();
      URL.revokeObjectURL(missingTelemetryModuleUrl);
      const malformedTelemetryModuleUrl = URL.createObjectURL(new Blob([malformedTelemetryModuleSource], { type: 'text/javascript' }));
      window.kaminosSetHybridSplatOverlayModuleUrl?.(malformedTelemetryModuleUrl);
      const malformedTelemetryStartResult = await window.startSelectedSplatHybridRenderer?.();
      await wait(500);
      const malformedTelemetryOverlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const malformedTelemetryHandoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const malformedTelemetryWitness = window.__hybridSplatOverlayWitness || null;
      window.stopHybridSplatOverlay?.();
      URL.revokeObjectURL(malformedTelemetryModuleUrl);
      return {
        actionExposed: !!actionButton,
        assetRowCount: assetRows.length,
        assetEntry,
        splatObject,
        panelVisible: !!panel && !panel.hidden,
        startButtonVisible: !!startButton
          && !startButton.hidden
          && getComputedStyle(startButton).display !== 'none'
          && getComputedStyle(startButton).visibility !== 'hidden',
        statusText: statusEl?.textContent || null,
        startResult,
        overlayDebug,
        handoffDebug,
        witness,
        rendererTelemetryStartResult,
        rendererTelemetryOverlayDebug,
        rendererTelemetryHandoffDebug,
        rendererTelemetryWitness,
        missingTelemetryStartResult,
        missingTelemetryOverlayDebug,
        missingTelemetryHandoffDebug,
        missingTelemetryWitness,
        malformedTelemetryStartResult,
        malformedTelemetryOverlayDebug,
        malformedTelemetryHandoffDebug,
        malformedTelemetryWitness,
      };
    })()
  `, { timeoutMs: 60000 });

  if (!lastEvidence.hybridSplatOverlay.actionExposed || !lastEvidence.hybridSplatOverlay.splatObject) {
    throw new Error(`hybrid splat overlay could not import a splat fixture: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  if (!lastEvidence.hybridSplatOverlay.panelVisible || !lastEvidence.hybridSplatOverlay.startButtonVisible) {
    throw new Error(`hybrid splat overlay did not expose visible UI: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  const splatSource = lastEvidence.hybridSplatOverlay.splatObject.source;
  const loadedSource = lastEvidence.hybridSplatOverlay.overlayDebug?.loadedSource;
  const witnessSource = lastEvidence.hybridSplatOverlay.witness?.sources?.[0]?.source;
  if (!splatSource || loadedSource !== splatSource || witnessSource !== splatSource) {
    throw new Error(`hybrid splat overlay did not load selected splat source: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  const capabilities = lastEvidence.hybridSplatOverlay.handoffDebug?.activeHandoff?.capabilities || {};
  if (capabilities.realSplatRendering !== true || capabilities.canvasMode !== 'dual-canvas-overlay') {
    throw new Error(`hybrid splat overlay did not record dual-canvas capability: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  if (lastEvidence.hybridSplatOverlay.overlayDebug?.cropAppliedByRenderer !== true
    || capabilities.cropAppliedByRenderer !== true
    || lastEvidence.hybridSplatOverlay.handoffDebug?.activeHandoff?.evidence?.cropAppliedByRenderer !== true) {
    throw new Error(`hybrid splat overlay did not report renderer crop application: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  if (capabilities.sharedCommandEncoder !== false) {
    throw new Error(`hybrid splat overlay lost sharedCommandEncoder=false: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  const witness = lastEvidence.hybridSplatOverlay.witness || {};
  const lastFrame = lastEvidence.hybridSplatOverlay.overlayDebug?.lastFrame || {};
  if (!witness.modelMatrices?.length || !Array.isArray(lastFrame.objectWorldMatrix)) {
    throw new Error(`hybrid splat overlay did not receive model matrix: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  if (!witness.viewports?.length || !lastFrame.viewport?.width || !lastFrame.viewport?.height) {
    throw new Error(`hybrid splat overlay did not receive viewport identity: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  if (!witness.corrections?.length || witness.sourceIdentity?.correctionApplied !== true) {
    throw new Error(`hybrid splat overlay did not receive correction identity: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  if (!witness.sceneContexts?.length
      || lastEvidence.hybridSplatOverlay.overlayDebug?.lastSceneContext?.schema !== 'hybrid-render.scene-context.v0'
      || lastEvidence.hybridSplatOverlay.handoffDebug?.activeHandoff?.hybridOverlay?.lastSceneContext?.schema !== 'hybrid-render.scene-context.v0') {
    throw new Error(`hybrid splat overlay did not publish scene context: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  if (lastEvidence.hybridSplatOverlay.overlayDebug?.sceneContextAccepted !== true
      || lastEvidence.hybridSplatOverlay.overlayDebug?.sceneContextTelemetry?.accepted !== true) {
    throw new Error(`hybrid splat overlay did not report accepted scene context: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  const rendererTelemetry = lastEvidence.hybridSplatOverlay.rendererTelemetryOverlayDebug?.sceneContextTelemetry || {};
  if (lastEvidence.hybridSplatOverlay.rendererTelemetryOverlayDebug?.sceneContextAccepted !== true
      || rendererTelemetry.accepted !== true
      || !rendererTelemetry.honored?.environment
      || !Array.isArray(rendererTelemetry.honoredFields)
      || !rendererTelemetry.honoredFields.includes('lighting.environment')
      || !Array.isArray(rendererTelemetry.unsupportedFields)
      || !rendererTelemetry.unsupportedFields.includes('toneMapping:aces')
      || !lastEvidence.hybridSplatOverlay.rendererTelemetryWitness?.sceneContexts?.length) {
    throw new Error(`hybrid splat overlay dropped renderer-owned scene-context telemetry: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  const missingTelemetry = lastEvidence.hybridSplatOverlay.missingTelemetryOverlayDebug?.sceneContextTelemetry || {};
  if (lastEvidence.hybridSplatOverlay.missingTelemetryOverlayDebug?.sceneContextAccepted !== false
      || missingTelemetry.accepted !== false
      || missingTelemetry.missing !== true
      || missingTelemetry.failurePhase !== 'setSceneContext.telemetry'
      || !lastEvidence.hybridSplatOverlay.missingTelemetryWitness?.sceneContexts?.length) {
    throw new Error(`hybrid splat overlay accepted missing scene-context telemetry: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  const malformedTelemetry = lastEvidence.hybridSplatOverlay.malformedTelemetryOverlayDebug?.sceneContextTelemetry || {};
  if (lastEvidence.hybridSplatOverlay.malformedTelemetryOverlayDebug?.sceneContextAccepted !== false
      || malformedTelemetry.accepted !== false
      || malformedTelemetry.missing !== true
      || malformedTelemetry.failurePhase !== 'setSceneContext.telemetry'
      || !Array.isArray(malformedTelemetry.acceptedFields)
      || malformedTelemetry.acceptedFields.length !== 0
      || !lastEvidence.hybridSplatOverlay.malformedTelemetryWitness?.sceneContexts?.length) {
    throw new Error(`hybrid splat overlay accepted malformed scene-context telemetry: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
  if (lastEvidence.hybridSplatOverlay.overlayDebug?.sourceIdentity?.source !== splatSource
      || lastEvidence.hybridSplatOverlay.handoffDebug?.activeHandoff?.hybridOverlay?.sourceIdentity?.source !== splatSource) {
    throw new Error(`hybrid splat overlay did not expose renderer source identity: ${JSON.stringify(lastEvidence.hybridSplatOverlay)}`);
  }
}

async function runSelectedSplatBakeLayerScenario(ws) {
  phase = 'scenario-selected-splat-bake-layer';
  lastEvidence.selectedSplatBakeLayer = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
      const waitForAssetRows = async () => {
        for (let i = 0; i < 100; i++) {
          const rows = [...document.querySelectorAll('#splat-assets-list .gr-entry')];
          if (rows.length) return rows;
          await wait(125);
        }
        return [...document.querySelectorAll('#splat-assets-list .gr-entry')];
      };
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };
      document.querySelector('[data-tab="greenroom"]')?.click();
      if (window.grBrowseSplatAssets) await window.grBrowseSplatAssets();
      const beforeRows = rowState();
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const assetRows = await waitForAssetRows();
      const assetEntry = (assetData.entries || [])[0] || null;
      const actionRow = assetRows.find(row => row.dataset.assetSource === assetEntry?.source
        && [...row.querySelectorAll('button')].some(button => button.textContent.trim() === 'Import Splat'))
        || assetRows.find(row => [...row.querySelectorAll('button')]
        .some(button => button.textContent.trim() === 'Import Splat'));
      const actionButton = actionRow ? [...actionRow.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Import Splat') : null;
      if (actionButton) actionButton.click();
      await waitForSceneRows(beforeRows.length + 1);
      const splatObject = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.type === 'splat') || null;
      if (splatObject?.id) window.selectSceneObject?.(splatObject.id);
      await wait(250);
      const startResult = await window.startHybridSplatSceneRenderer?.();
      await wait(2200);
      if (splatObject?.id) window.selectSceneObject?.(splatObject.id);
      const bakeButton = document.getElementById('selected-splat-bake-layer-button');
      const bakePanelBefore = document.getElementById('selected-splat-bake-layer-panel');
      const beforeDebug = window.kaminosSelectedSplatBakeLayerDebugState?.(splatObject?.id) || null;
      const beforePreview = window.kaminosSelectedSplatBakeLayerPreviewDebugState?.(splatObject?.id) || null;
      const cameraBefore = window.kaminosCameraDebugState?.() || null;
      const layer = await window.kaminosCreateSelectedSplatViewBakeLayer?.({ label: 'Witness View Bake', strength: 1 });
      await wait(100);
      const afterCreateDebug = window.kaminosSelectedSplatBakeLayerDebugState?.(splatObject?.id) || null;
      const afterCreatePreview = window.kaminosSelectedSplatBakeLayerPreviewDebugState?.(splatObject?.id) || null;
      const afterCreateRendererControls = window.kaminosPublishHybridSplatRendererControls?.() || null;
      const createdLayer = afterCreateDebug?.layers?.[0] || null;
      let unlayeredSplat = (window.kaminosSceneObjectDebugState?.() || [])
        .find(record => record.type === 'splat' && record.id !== splatObject?.id) || null;
      if (!unlayeredSplat && actionButton) {
        actionButton.click();
        await waitForSceneRows(beforeRows.length + 2);
        await wait(250);
        unlayeredSplat = (window.kaminosSceneObjectDebugState?.() || [])
          .find(record => record.type === 'splat' && record.id !== splatObject?.id) || null;
      }
      if (unlayeredSplat?.id) window.selectSceneObject?.(unlayeredSplat.id);
      await wait(100);
      const afterSelectUnlayeredRendererControls = window.kaminosHybridSplatRendererControlsDebugState?.() || null;
      const manualDeferredOverride = window.kaminosSetHybridSourceColorPreviewEnabled?.(false) || null;
      window.kaminosSetHybridSplatOverlayModuleUrl?.(startResult?.moduleUrl);
      await wait(100);
      const afterStatusRefreshManualOverride = window.kaminosHybridSplatRendererControlsDebugState?.() || null;
      window.selectSceneObject?.('__selected-splat-bake-layer-clear-witness__');
      await wait(100);
      const afterClearSelectionRendererControls = window.kaminosHybridSplatRendererControlsDebugState?.() || null;
      if (splatObject?.id) window.selectSceneObject?.(splatObject.id);
      await wait(100);
      const afterReselectLayeredRendererControls = window.kaminosHybridSplatRendererControlsDebugState?.() || null;
      const tunedLayer = createdLayer
        ? window.kaminosSetSelectedSplatBakeLayerControls?.(createdLayer.id, { enabled: false, strength: 0.37 })
        : null;
      await wait(100);
      const afterTuneDebug = window.kaminosSelectedSplatBakeLayerDebugState?.(splatObject?.id) || null;
      const afterTunePreview = window.kaminosSelectedSplatBakeLayerPreviewDebugState?.(splatObject?.id) || null;
      const afterTuneRendererControls = window.kaminosPublishHybridSplatRendererControls?.() || null;
      const bakePanelAfter = document.getElementById('selected-splat-bake-layer-panel');
      return {
        actionExposed: !!actionButton,
        assetRowCount: assetRows.length,
        splatObject,
        startResult,
        bakeButtonVisible: !!bakeButton
          && !bakeButton.hidden
          && getComputedStyle(bakeButton).display !== 'none'
          && getComputedStyle(bakeButton).visibility !== 'hidden',
        bakePanelVisibleBefore: !!bakePanelBefore && !bakePanelBefore.hidden,
        bakePanelVisibleAfter: !!bakePanelAfter && !bakePanelAfter.hidden,
        beforeDebug,
        beforePreview,
        cameraBefore,
        layer,
        tunedLayer,
        afterCreateDebug,
        afterCreatePreview,
        afterCreateRendererControls,
        unlayeredSplat,
        afterSelectUnlayeredRendererControls,
        manualDeferredOverride,
        afterStatusRefreshManualOverride,
        afterClearSelectionRendererControls,
        afterReselectLayeredRendererControls,
        afterTuneDebug,
        afterTunePreview,
        afterTuneRendererControls,
        panelText: bakePanelAfter?.textContent || null,
      };
    })()
  `, { timeoutMs: 60000 });

  if (!lastEvidence.selectedSplatBakeLayer.actionExposed || !lastEvidence.selectedSplatBakeLayer.splatObject) {
    throw new Error(`selected splat bake layer could not import a splat fixture: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (lastEvidence.selectedSplatBakeLayer.startResult?.status !== 'rendering'
      || lastEvidence.selectedSplatBakeLayer.startResult?.moduleIdentity?.status !== 'loaded') {
    throw new Error(`selected splat bake layer did not start live hybrid renderer: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (!lastEvidence.selectedSplatBakeLayer.bakeButtonVisible || !lastEvidence.selectedSplatBakeLayer.bakePanelVisibleBefore) {
    throw new Error(`selected splat bake layer did not expose viewport UI: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const layer = lastEvidence.selectedSplatBakeLayer.afterCreateDebug?.layers?.[0] || null;
  if (!layer || layer.schema !== 'kaminos.splat-bake-layer.v0' || layer.targetObjectId !== lastEvidence.selectedSplatBakeLayer.splatObject.id) {
    throw new Error(`selected splat bake layer did not create a layer: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (layer.receipt?.schema !== 'kaminos.splat-bake-layer.receipt.v0'
      || layer.receipt?.firing?.route !== 'selected-splat-view-bake-layer-v0'
      || layer.receipt?.crucible?.kind !== 'selected-splat-view-bake-layer-crucible-v0'
      || layer.receipt?.graduationStatus !== 'candidate') {
    throw new Error(`selected splat bake layer did not preserve receipt identity: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const camera = layer.receipt?.witness?.camera;
  if (!camera?.position?.length || !camera?.projectionMatrix?.length || !camera?.viewport?.width) {
    throw new Error(`selected splat bake layer did not preserve current camera: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (layer.receipt?.firing?.pipelineId !== 'selected-splat-view-bake-layer-v0'
      || layer.receipt?.firing?.status !== 'complete'
      || layer.pipelineRun?.ok !== true
      || layer.pipelineRun?.pipelineId !== 'selected-splat-view-bake-layer-v0') {
    throw new Error(`selected splat bake layer did not fire backend pipeline: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (layer.receipt?.firing?.requestContext?.schema !== 'kaminos.selected-splat-view-bake-request.v0'
      || layer.receipt?.firing?.requestContext?.camera?.schema !== 'kaminos.splat-bake-layer.camera.v0'
      || layer.receipt?.firing?.requestContext?.rendererControls?.schema !== 'hybrid-render.splat-renderer-controls.v0') {
    throw new Error(`selected splat bake layer did not preserve pipeline request context: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (!layer.receipt?.outputs?.receiptRef?.path
      || layer.receipt?.outputs?.artifactAuthority !== 'pipeline-receipt-only'
      || !Array.isArray(layer.receipt?.outputs?.shardRefs)
      || !layer.receipt.outputs.shardRefs.some(ref => ref.id === 'layerReceipt')) {
    throw new Error(`selected splat bake layer did not preserve pipeline output receipt: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const tuned = lastEvidence.selectedSplatBakeLayer.afterTuneDebug?.layers?.[0] || null;
  if (!tuned || tuned.enabled !== false || Math.abs(Number(tuned.strength) - 0.37) > 0.001) {
    throw new Error(`selected splat bake layer controls did not update: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const beforePreview = lastEvidence.selectedSplatBakeLayer.beforePreview;
  const afterCreatePreview = lastEvidence.selectedSplatBakeLayer.afterCreatePreview;
  const afterTunePreview = lastEvidence.selectedSplatBakeLayer.afterTunePreview;
  const beforeSize = Number(beforePreview?.pointCloudMaterial?.included?.size || 0);
  const afterCreateSize = Number(afterCreatePreview?.pointCloudMaterial?.included?.size || 0);
  const afterTuneSize = Number(afterTunePreview?.pointCloudMaterial?.included?.size || 0);
  if (afterCreatePreview?.contribution?.schema !== 'kaminos.splat-bake-layer.preview-contribution.v0'
      || Number(afterCreatePreview?.contribution?.strength || 0) <= 0.99
      || Number(afterCreatePreview?.contribution?.appliedMaterialCount || 0) < 1
      || !(afterCreateSize > beforeSize)) {
    throw new Error(`selected splat bake layer did not couple to point-cloud material: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (Number(afterTunePreview?.contribution?.strength || 0) > 0.001
      || Math.abs(afterTuneSize - beforeSize) > Math.max(0.000001, beforeSize * 0.001)) {
    throw new Error(`selected splat bake layer controls did not remove preview contribution: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const telemetryPreview = layer.receipt?.witness?.rendererControls?.candidateLayerPreview;
  if (telemetryPreview?.schema !== 'kaminos.splat-bake-layer.preview-contribution.v0'
      || telemetryPreview?.targetObjectId !== lastEvidence.selectedSplatBakeLayer.splatObject.id
      || Number(telemetryPreview?.strength || 0) <= 0.99) {
    throw new Error(`selected splat bake layer did not expose preview contribution telemetry: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const afterCreateControls = lastEvidence.selectedSplatBakeLayer.afterCreateRendererControls?.controls || {};
  const afterTuneControls = lastEvidence.selectedSplatBakeLayer.afterTuneRendererControls?.controls || {};
  if (afterCreateControls.preview?.sourceColor !== false
      || afterCreateControls.presentation?.mode !== 'deferred-pbr') {
    throw new Error(`selected splat bake layer did not select deferred-PBR presentation: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (afterTuneControls.preview?.sourceColor !== true
      || afterTuneControls.presentation?.mode !== 'source-radiance') {
    throw new Error(`selected splat bake layer did not restore source-radiance presentation: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const afterSelectUnlayeredControls = lastEvidence.selectedSplatBakeLayer.afterSelectUnlayeredRendererControls?.controls || {};
  const afterReselectLayeredControls = lastEvidence.selectedSplatBakeLayer.afterReselectLayeredRendererControls?.controls || {};
  if (!lastEvidence.selectedSplatBakeLayer.unlayeredSplat
      || afterSelectUnlayeredControls.preview?.sourceColor !== true
      || afterSelectUnlayeredControls.presentation?.mode !== 'source-radiance') {
    throw new Error(`selecting an unlayered splat did not restore source-radiance presentation: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const afterStatusRefreshManualControls = lastEvidence.selectedSplatBakeLayer.afterStatusRefreshManualOverride?.controls || {};
  const afterStatusRefreshManualPresentation = lastEvidence.selectedSplatBakeLayer.afterStatusRefreshManualOverride?.presentation || {};
  if (afterStatusRefreshManualControls.preview?.sourceColor !== false
      || afterStatusRefreshManualControls.presentation?.mode !== 'deferred-pbr'
      || afterStatusRefreshManualPresentation.effectiveRoute !== 'deferred-pbr-lighting') {
    throw new Error(`renderer status refresh overwrote the operator presentation override: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const afterClearSelectionControls = lastEvidence.selectedSplatBakeLayer.afterClearSelectionRendererControls?.controls || {};
  const afterClearSelectionPresentation = lastEvidence.selectedSplatBakeLayer.afterClearSelectionRendererControls?.presentation || {};
  if (lastEvidence.selectedSplatBakeLayer.afterClearSelectionRendererControls?.requestedControls?.candidateLayerPreview?.targetObjectId !== null
      || afterClearSelectionControls.preview?.sourceColor !== true
      || afterClearSelectionControls.presentation?.mode !== 'source-radiance'
      || afterClearSelectionPresentation.effectiveRoute !== 'source-radiance-copy') {
    throw new Error(`clearing splat selection did not publish null candidate identity: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (afterReselectLayeredControls.preview?.sourceColor !== false
      || afterReselectLayeredControls.presentation?.mode !== 'deferred-pbr') {
    throw new Error(`reselecting a layered splat did not restore deferred-PBR presentation: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  const afterCreatePresentation = lastEvidence.selectedSplatBakeLayer.afterCreateRendererControls?.presentation || {};
  const afterSelectUnlayeredPresentation = lastEvidence.selectedSplatBakeLayer.afterSelectUnlayeredRendererControls?.presentation || {};
  const afterReselectLayeredPresentation = lastEvidence.selectedSplatBakeLayer.afterReselectLayeredRendererControls?.presentation || {};
  const afterTunePresentation = lastEvidence.selectedSplatBakeLayer.afterTuneRendererControls?.presentation || {};
  if (lastEvidence.selectedSplatBakeLayer.afterCreateRendererControls?.accepted !== true
      || afterCreatePresentation.effectiveMode !== 'deferred-pbr'
      || afterCreatePresentation.effectiveRoute !== 'deferred-pbr-lighting'
      || lastEvidence.selectedSplatBakeLayer.afterSelectUnlayeredRendererControls?.accepted !== true
      || afterSelectUnlayeredPresentation.effectiveMode !== 'source-radiance'
      || afterSelectUnlayeredPresentation.effectiveRoute !== 'source-radiance-copy'
      || lastEvidence.selectedSplatBakeLayer.afterReselectLayeredRendererControls?.accepted !== true
      || afterReselectLayeredPresentation.effectiveMode !== 'deferred-pbr'
      || afterReselectLayeredPresentation.effectiveRoute !== 'deferred-pbr-lighting'
      || lastEvidence.selectedSplatBakeLayer.afterTuneRendererControls?.accepted !== true
      || afterTunePresentation.effectiveMode !== 'source-radiance'
      || afterTunePresentation.effectiveRoute !== 'source-radiance-copy') {
    throw new Error(`selected splat bake layer presentation was not accepted by live renderer: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
  if (telemetryPreview.rendererControlScope !== 'telemetry-only-no-bake-output'
      || Number(afterCreateControls.material?.roughness?.contrast) !== 1
      || Number(afterCreateControls.material?.roughness?.brightness) !== 0
      || Number(afterCreateControls.material?.albedo?.contrast) !== 1
      || Number(afterCreateControls.material?.albedo?.brightness) !== 0
      || Number(afterTuneControls.material?.roughness?.contrast) !== 1
      || Number(afterTuneControls.material?.roughness?.brightness) !== 0
      || Number(afterTuneControls.material?.albedo?.contrast) !== 1
      || Number(afterTuneControls.material?.albedo?.brightness) !== 0) {
    throw new Error(`selected splat bake layer faked backend coupling through renderer material curves: ${JSON.stringify(lastEvidence.selectedSplatBakeLayer)}`);
  }
}

async function runRealHybridSplatOverlayScenario(ws) {
  phase = 'scenario-real-hybrid-splat-overlay';
  lastEvidence.realHybridSplatOverlay = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const waitForAssetRows = async () => {
        for (let i = 0; i < 100; i++) {
          const rows = [...document.querySelectorAll('#splat-assets-list .gr-entry')];
          if (rows.length) return rows;
          await wait(125);
        }
        return [...document.querySelectorAll('#splat-assets-list .gr-entry')];
      };
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const sampleCanvas = canvas => {
        if (!canvas) return { sampled: false, error: 'missing canvas', visiblePixels: 0, alphaPixels: 0 };
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.min(320, Math.floor(rect.width || canvas.width || 1)));
        const height = Math.max(1, Math.min(240, Math.floor(rect.height || canvas.height || 1)));
        const probe = document.createElement('canvas');
        probe.width = width;
        probe.height = height;
        const ctx = probe.getContext('2d', { willReadFrequently: true });
        try {
          ctx.drawImage(canvas, 0, 0, width, height);
          const data = ctx.getImageData(0, 0, width, height).data;
          let visiblePixels = 0;
          let alphaPixels = 0;
          let redSum = 0;
          let greenSum = 0;
          let blueSum = 0;
          let rgbChecksum = 2166136261;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 8) alphaPixels += 1;
            if (data[i + 3] > 8 && data[i] + data[i + 1] + data[i + 2] > 24) visiblePixels += 1;
            redSum += data[i];
            greenSum += data[i + 1];
            blueSum += data[i + 2];
            rgbChecksum = Math.imul(rgbChecksum ^ data[i], 16777619);
            rgbChecksum = Math.imul(rgbChecksum ^ data[i + 1], 16777619);
            rgbChecksum = Math.imul(rgbChecksum ^ data[i + 2], 16777619);
          }
          return {
            sampled: true,
            width,
            height,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            visiblePixels,
            alphaPixels,
            channelSums: { red: redSum, green: greenSum, blue: blueSum },
            rgbChecksum: rgbChecksum >>> 0,
          };
        } catch (error) {
          return { sampled: false, width, height, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, error: String(error?.message || error), visiblePixels: 0, alphaPixels: 0 };
        }
      };
      document.querySelector('[data-tab="greenroom"]').click();
      if (window.grBrowseSplatAssets) await window.grBrowseSplatAssets();
      const beforeRows = rowState();
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const requestedSplatAssetName = ${JSON.stringify(splatAssetName)};
      const assetEntries = assetData.entries || [];
      const rendererCapableEntry = entry => !!entry?.source
        && entry.renderability?.status !== 'not-splat-like'
        && (entry.size || 0) > 4096;
      const requestedEntry = requestedSplatAssetName
        ? assetEntries.find(entry => entry.name === requestedSplatAssetName || entry.path === requestedSplatAssetName)
        : null;
      if (requestedEntry?.renderability?.status === 'not-splat-like') {
        throw new Error(\`requested splat asset is point-cloud-only, not renderer-capable: \${requestedSplatAssetName}\`);
      }
      const assetEntry = (requestedEntry && rendererCapableEntry(requestedEntry) ? requestedEntry : null)
        || assetEntries.find(entry => rendererCapableEntry(entry) && entry.correction?.crop?.enabled !== true)
        || assetEntries.find(rendererCapableEntry)
        || assetEntries.find(entry => entry.name === 'witness-crop-frame.ply')
        || assetEntries[0]
        || null;
      const assetRows = await waitForAssetRows();
      const display = assetEntry?.display || { title: assetEntry?.name || assetEntry?.path || 'Splat' };
      const actionExposed = !!assetEntry && typeof window.greenroomImportSplat === 'function';
      if (actionExposed) {
        const rendererSmokeCorrection = assetEntry.correction?.crop?.enabled === true ? null : assetEntry.correction || null;
        await window.greenroomImportSplat(assetEntry.source, assetEntry.name || assetEntry.path || 'splat.ply', display, {
          clear: false,
          metadata: {
            source: assetEntry.source,
            fileName: assetEntry.name || assetEntry.path || 'splat.ply',
            label: display.title || assetEntry.name || 'Splat',
            splat: {
              schema: 'kaminos.splat-asset.v0',
              assetSource: assetEntry.source,
              fileName: assetEntry.name || assetEntry.path || 'splat.ply',
              format: 'ply',
              bounds: null,
              splatCount: null,
              sidecars: [],
              correction: rendererSmokeCorrection,
              renderability: assetEntry.renderability || null,
              provenance: {
                source_group: assetEntry.stage === 'production' ? 'splat-production' : 'splat-inbox',
                source_url: assetEntry.source,
                root_id: assetEntry.root_id || null,
                root_label: assetEntry.root_label || null,
                asset_stage: assetEntry.stage || 'experimental',
                asset_path: assetEntry.path || null,
              },
            },
          },
        });
      }
      await waitForSceneRows(beforeRows.length + 1);
      let splatObject = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.type === 'splat') || null;
      if (splatObject?.id) window.selectSceneObject?.(splatObject.id);
      const rendererSmokeCorrectionOverride = !!assetEntry?.correction?.crop?.enabled;
      if (splatObject?.id && rendererSmokeCorrectionOverride) {
        splatObject = window.kaminosSetSplatCorrectionDebug?.(splatObject.id, {
          orientation: { rotation: [0, 0, 0] },
          axisFlips: [1, 1, 1],
          centroidOffset: [0, 0, 0],
          crop: { enabled: false, min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
        }) || splatObject;
      }
      await wait(250);
      const requestedHybridModuleUrl = ${JSON.stringify(hybridModuleUrl)};
      if (requestedHybridModuleUrl) {
        window.kaminosSetHybridSplatOverlayModuleUrl?.(requestedHybridModuleUrl);
      }
      const beforeOverlayCanvas = document.querySelector('#hybrid-splat-overlay-host canvas');
      const beforeSample = sampleCanvas(beforeOverlayCanvas);
      const startResult = await window.startHybridSplatSceneRenderer?.();
      await wait(2200);
      const cameraPoseA = window.kaminosSetCameraDebugPose?.({ position: [0, 0.6, 3], target: [0, 0, 0] }) || null;
      await wait(300);
      const projectionProbeA = window.kaminosHybridSplatOverlayProjectionProbe?.() || null;
      const cameraPoseB = window.kaminosSetCameraDebugPose?.({ position: [0, 1.55, 3], target: [0, 0, 0] }) || null;
      await wait(300);
      const projectionProbeB = window.kaminosHybridSplatOverlayProjectionProbe?.() || null;
      const screenDelta = (key) => {
        const a = projectionProbeA?.[key];
        const b = projectionProbeB?.[key];
        if (!a || !b) return null;
        return {
          x: Number((b.x - a.x).toFixed(4)),
          y: Number((b.y - a.y).toFixed(4)),
          a: { x: Number(a.x.toFixed(4)), y: Number(a.y.toFixed(4)) },
          b: { x: Number(b.x.toFixed(4)), y: Number(b.y.toFixed(4)) },
        };
      };
      const sign = value => Math.abs(value || 0) < 0.001 ? 0 : Math.sign(value);
      const cameraCoherence = {
        cameraPoseA,
        cameraPoseB,
        projectionProbeA,
        projectionProbeB,
        previewDelta: screenDelta('kaminosPreviewScreen'),
        overlayDelta: screenDelta('pbrnextOverlayScreen'),
        uncompensatedDelta: screenDelta('pbrnextUncompensatedScreen'),
      };
      cameraCoherence.previewYSign = sign(cameraCoherence.previewDelta?.y);
      cameraCoherence.overlayYSign = sign(cameraCoherence.overlayDelta?.y);
      cameraCoherence.uncompensatedYSign = sign(cameraCoherence.uncompensatedDelta?.y);
      cameraCoherence.coherent = cameraCoherence.previewYSign !== 0
        && cameraCoherence.previewYSign === cameraCoherence.overlayYSign;
      cameraCoherence.uncompensatedWouldInvert = cameraCoherence.previewYSign !== 0
        && cameraCoherence.uncompensatedYSign !== 0
        && cameraCoherence.previewYSign !== cameraCoherence.uncompensatedYSign;
      const overlayCanvas = document.querySelector('#hybrid-splat-overlay-host canvas');
      const computed = overlayCanvas ? getComputedStyle(overlayCanvas) : null;
      const host = document.getElementById('hybrid-splat-overlay-host');
      const hostStyle = host ? getComputedStyle(host) : null;
      const afterSample = sampleCanvas(overlayCanvas);
      const deferredTelemetry = window.kaminosSetHybridSourceColorPreviewEnabled?.(false) || null;
      await wait(700);
      const deferredSample = sampleCanvas(overlayCanvas);
      const sourceRadianceTelemetry = window.kaminosSetHybridSourceColorPreviewEnabled?.(true) || null;
      await wait(700);
      const sourceRadianceSample = sampleCanvas(overlayCanvas);
      const sourceRadiancePixelDelta = ['red', 'green', 'blue'].reduce((sum, channel) => (
        sum + Math.abs(
          Number(sourceRadianceSample.channelSums?.[channel] || 0)
          - Number(deferredSample.channelSums?.[channel] || 0)
        )
      ), 0);
      const overlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const handoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const previewDebug = window.kaminosSplatPreviewDebugState?.(splatObject?.id) || null;
      const statusText = document.getElementById('splat-hybrid-renderer-status')?.textContent || null;
      return {
        assetEntry,
        actionExposed,
        rendererSmokeCorrectionOverride,
        assetRowCount: assetRows.length,
        splatObject,
        startResult,
        overlayDebug,
        handoffDebug,
        previewDebug,
        cameraCoherence,
        statusText,
        beforeSample,
        afterSample,
        presentationAB: {
          deferredTelemetry,
          deferredSample,
          sourceRadianceTelemetry,
          sourceRadianceSample,
          sourceRadiancePixelDelta,
        },
        overlayCanvas: overlayCanvas ? {
          width: overlayCanvas.width,
          height: overlayCanvas.height,
          connected: overlayCanvas.isConnected,
          style: computed ? {
            display: computed.display,
            visibility: computed.visibility,
            opacity: computed.opacity,
            zIndex: computed.zIndex,
            position: computed.position,
          } : null,
        } : null,
        overlayHost: host ? {
          rect: (() => { const r = host.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
          style: hostStyle ? {
            display: hostStyle.display,
            visibility: hostStyle.visibility,
            opacity: hostStyle.opacity,
            zIndex: hostStyle.zIndex,
            position: hostStyle.position,
          } : null,
        } : null,
      };
    })()
  `, { timeoutMs: 90000 });

  const evidence = lastEvidence.realHybridSplatOverlay;
  const deferredState = await evaluate(ws, `
    (async () => {
      const telemetry = window.kaminosSetHybridSourceColorPreviewEnabled?.(false) || null;
      await new Promise(resolve => setTimeout(resolve, 800));
      return { telemetry, overlayDebug: window.kaminosHybridSplatOverlayDebugState?.() || null };
    })()
  `, { timeoutMs: 10000 });
  const deferredPath = siblingPngPath('-deferred-pbr');
  const deferredShot = await capturePngScreenshot(ws, deferredPath);
  const sourceRadianceState = await evaluate(ws, `
    (async () => {
      const telemetry = window.kaminosSetHybridSourceColorPreviewEnabled?.(true) || null;
      await new Promise(resolve => setTimeout(resolve, 800));
      return { telemetry, overlayDebug: window.kaminosHybridSplatOverlayDebugState?.() || null };
    })()
  `, { timeoutMs: 10000 });
  const sourceRadiancePath = siblingPngPath('-source-radiance');
  const sourceRadianceShot = await capturePngScreenshot(ws, sourceRadiancePath);
  const screenshotDiff = comparePresentationScreenshots(
    deferredPath,
    sourceRadiancePath,
    evidence.overlayHost?.rect || null,
  );
  evidence.presentationAB = {
    deferredTelemetry: deferredState.telemetry,
    deferredOverlayDebug: deferredState.overlayDebug,
    deferredScreenshot: deferredShot,
    sourceRadianceTelemetry: sourceRadianceState.telemetry,
    sourceRadianceOverlayDebug: sourceRadianceState.overlayDebug,
    sourceRadianceScreenshot: sourceRadianceShot,
    screenshotDiff,
  };
  const presentationAB = evidence.presentationAB || {};
  if (!evidence.actionExposed || !evidence.splatObject) {
    throw new Error(`real hybrid splat overlay could not import a splat fixture: ${JSON.stringify(evidence)}`);
  }
  if (evidence.overlayDebug?.status !== 'rendering' || !evidence.overlayDebug?.canvasConnected) {
    throw new Error(`real hybrid splat overlay did not reach connected rendering state: ${JSON.stringify(evidence)}`);
  }
  if (evidence.overlayDebug?.rendererMode !== 'scene'
      || !evidence.overlayDebug?.sceneSplatIds?.includes(evidence.splatObject.id)) {
    throw new Error(`real hybrid splat overlay did not start as a renderer-owned scene: ${JSON.stringify(evidence)}`);
  }
  if (evidence.overlayDebug?.renderError
      || presentationAB.deferredOverlayDebug?.renderError
      || presentationAB.sourceRadianceOverlayDebug?.renderError) {
    throw new Error(`real hybrid splat overlay reported a renderer frame error: ${JSON.stringify(evidence)}`);
  }
  if (presentationAB.deferredTelemetry?.presentation?.effectiveMode !== 'deferred-pbr'
      || presentationAB.deferredTelemetry?.presentation?.effectiveRoute !== 'deferred-pbr-lighting'
      || presentationAB.sourceRadianceTelemetry?.presentation?.effectiveMode !== 'source-radiance'
      || presentationAB.sourceRadianceTelemetry?.presentation?.effectiveRoute !== 'source-radiance-copy') {
    throw new Error(`real hybrid overlay did not expose effectiveMode source-radiance and deferred-pbr route identity: ${JSON.stringify(evidence)}`);
  }
  if (!(presentationAB.screenshotDiff?.changedPixels > 1000)
      || !(presentationAB.screenshotDiff?.absDiffSum > 100000)) {
    throw new Error(`source-radiance presentation route did not change live pixels: ${JSON.stringify(evidence)}`);
  }
  const correctionApplication = evidence.overlayDebug?.correctionApplication || {};
  if (evidence.previewDebug?.includedPointCount > 0
    && correctionApplication.cropApplied === true
    && !(correctionApplication.keptCount > 0)) {
    throw new Error(`real hybrid splat overlay crop kept zero splats despite visible Kaminos preview crop: ${JSON.stringify(evidence)}`);
  }
  if ((evidence.overlayHost?.rect?.width || 0) < 64
    || (evidence.overlayHost?.rect?.height || 0) < 64
    || (evidence.overlayCanvas?.width || 0) < 64
    || (evidence.overlayCanvas?.height || 0) < 64) {
    throw new Error(`real hybrid splat overlay canvas has no visible geometry: ${JSON.stringify(evidence)}`);
  }
  if (evidence.splatObject?.splat?.previewKind === 'point-cloud') {
    const frame = evidence.overlayDebug?.lastFrame || {};
    const firstEntryCompatibility = evidence.overlayDebug?.sceneIdentity?.compatibilityMode === 'first-entry'
      || frame.firstEntryCompatibility === true;
    if (firstEntryCompatibility) {
      if (frame.modelMatrixFrameMode !== 'first-entry-compat-pbrnext-setModelMatrix-owned'
        || frame.assetFrameMode !== 'first-entry-compat-asset-world-matrix') {
        throw new Error(`real hybrid splat overlay did not record first-entry compatibility matrix evidence: ${JSON.stringify(evidence)}`);
      }
      const rendererMatrix = Array.isArray(frame.rendererModelMatrix) ? frame.rendererModelMatrix : [];
      const assetWorldMatrix = Array.isArray(frame.overlayAssetWorldMatrix) ? frame.overlayAssetWorldMatrix : [];
      const matricesMatch = rendererMatrix.length === 16
        && assetWorldMatrix.length === 16
        && rendererMatrix.every((value, index) => Math.abs(value - assetWorldMatrix[index]) < 1e-6);
      if (!matricesMatch) {
        throw new Error(`real hybrid splat overlay first-entry compatibility dropped the preview transform: ${JSON.stringify(evidence)}`);
      }
    } else {
      if (frame.modelMatrixFrameMode !== 'kaminos-scene-world-pretransformed') {
        throw new Error(`real hybrid splat overlay did not record scene-world-pretransformed matrix evidence: ${JSON.stringify(evidence)}`);
      }
      if (frame.assetFrameMode !== 'scene-world-pretransformed'
        || !Array.isArray(frame.rendererModelMatrix)
        || frame.rendererModelMatrix.length !== 16
        || frame.rendererModelMatrix[0] !== 1
        || frame.rendererModelMatrix[5] !== 1
        || frame.rendererModelMatrix[10] !== 1
        || frame.rendererModelMatrix[15] !== 1) {
        throw new Error(`real hybrid splat overlay did not use scene-world-pretransformed renderer mode: ${JSON.stringify(evidence)}`);
      }
    }
  }
  const cameraCoherence = evidence.cameraCoherence || {};
  if (!cameraCoherence.projectionProbeA || !cameraCoherence.projectionProbeB) {
    throw new Error(`real hybrid splat overlay did not expose camera coherence projection probes: ${JSON.stringify(evidence)}`);
  }
  if (!cameraCoherence.coherent) {
    throw new Error(`hybrid splat overlay camera motion inverted relative to Kaminos preview: ${JSON.stringify(cameraCoherence)}`);
  }
  if (!cameraCoherence.uncompensatedWouldInvert) {
    throw new Error(`hybrid splat overlay camera witness did not prove the old PBRnext vertical flip failure path: ${JSON.stringify(cameraCoherence)}`);
  }
}

async function runHybridHostDepthOccluderScenario(ws) {
  await runRealHybridSplatOverlayScenario(ws);
  phase = 'scenario-hybrid-host-depth-occluder';

  const setup = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const occluder = window.kaminosPlaceHybridSplatDepthOccluderDebugMesh?.({
        x: 0,
        y: 0.06,
        z: 0.48,
        width: 0.72,
        height: 0.72,
        depth: 0.08,
      }) || null;
      await wait(500);
      const offToggle = window.kaminosSetHybridSplatHostDepthDebugEnabled?.(false) || null;
      await wait(700);
      const offDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const host = document.getElementById('hybrid-splat-overlay-host');
      const hostRect = host ? (() => {
        const r = host.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })() : null;
      return {
        occluder,
        offToggle,
        offDebug,
        overlayHost: { rect: hostRect },
      };
    })()
  `, { timeoutMs: 30000 });

  const offShot = await capturePngScreenshot(ws, siblingPngPath('-host-depth-off'));

  const enable = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const onToggle = window.kaminosSetHybridSplatHostDepthDebugEnabled?.(true) || null;
      await wait(900);
      const onDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const occluder = window.kaminosHybridSplatDepthOccluderDebugState?.() || null;
      return { onToggle, onDebug, occluder };
    })()
  `, { timeoutMs: 30000 });

  const onShot = await capturePngScreenshot(ws, siblingPngPath('-host-depth-on'));
  const evidence = {
    schema: 'kaminos.hybrid-splat.host-depth-occluder-witness.v0',
    setup,
    enable,
    overlayHost: setup.overlayHost,
    occluder: enable.occluder || setup.occluder,
    offScreenshot: offShot,
    onScreenshot: onShot,
  };
  evidence.regionDiff = comparePngRegion(offShot.path, onShot.path, evidence, 95);
  lastEvidence.hybridHostDepthOccluder = evidence;

  if (setup.offDebug?.capabilities?.hostDepthTexture !== false
    || setup.offDebug?.depthCompositionTelemetry?.source === 'host-depth-texture') {
    throw new Error(`host-depth occluder witness could not disable host depth for A/B baseline: ${JSON.stringify(evidence)}`);
  }
  const onTelemetry = enable.onDebug?.depthCompositionTelemetry || null;
  if (enable.onDebug?.capabilities?.hostDepthTexture !== true
    || enable.onDebug?.capabilities?.sharedDevice !== true
    || onTelemetry?.source !== 'host-depth-texture'
    || enable.onDebug?.renderError) {
    throw new Error(`host-depth occluder witness did not activate the shared host-depth route cleanly: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.occluder?.active
    || !Number.isFinite(evidence.occluder?.screen?.x)
    || !Number.isFinite(evidence.occluder?.screen?.y)
    || !evidence.overlayHost?.rect) {
    throw new Error(`host-depth occluder witness did not project a deterministic host occluder: ${JSON.stringify(evidence)}`);
  }
  if (evidence.regionDiff.changedRatio < 0.025 || evidence.regionDiff.meanAbsDiff < 3.0) {
    throw new Error(`host-depth occluder witness did not change the projected occluder region when host depth was enabled: ${JSON.stringify(evidence)}`);
  }
}

async function runHybridTwoSplatDepthOrderScenario(ws) {
  await runRealHybridSplatOverlayScenario(ws);
  phase = 'scenario-hybrid-two-splat-depth-order';

  const setup = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const overlayDebugBeforePeer = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const selectedSplatId = overlayDebugBeforePeer?.objectId || null;
      const selectedSource = overlayDebugBeforePeer?.sourceIdentity?.source || overlayDebugBeforePeer?.loadedSource || null;
      const beforeSplats = (window.kaminosSceneObjectDebugState?.() || []).filter(record => record.type === 'splat');
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const assetEntries = assetData.entries || [];
      const rendererCapableEntry = entry => !!entry?.source
        && entry.renderability?.status !== 'not-splat-like'
        && (entry.size || 0) > 4096;
      const peerAsset = assetEntries.find(entry => rendererCapableEntry(entry) && entry.source !== selectedSource)
        || assetEntries.find(entry => entry.source && entry.source !== selectedSource && entry.renderability?.status !== 'not-splat-like')
        || null;
      if (peerAsset && typeof window.greenroomImportSplat === 'function') {
        await window.greenroomImportSplat(peerAsset.source, peerAsset.name || peerAsset.path || 'peer-splat.ply', peerAsset.display || { title: peerAsset.name || 'Peer Splat' }, {
          clear: false,
          metadata: {
            source: peerAsset.source,
            fileName: peerAsset.name || peerAsset.path || 'peer-splat.ply',
            label: peerAsset.display?.title || peerAsset.name || 'Peer Splat',
            splat: {
              schema: 'kaminos.splat-asset.v0',
              assetSource: peerAsset.source,
              fileName: peerAsset.name || peerAsset.path || 'peer-splat.ply',
              format: 'ply',
              bounds: null,
              splatCount: null,
              sidecars: [],
              correction: peerAsset.correction?.crop?.enabled === true ? null : peerAsset.correction || null,
              renderability: peerAsset.renderability || null,
              provenance: {
                source_group: peerAsset.stage === 'production' ? 'splat-production' : 'splat-inbox',
                source_url: peerAsset.source,
                root_id: peerAsset.root_id || null,
                root_label: peerAsset.root_label || null,
                asset_stage: peerAsset.stage || 'experimental',
                asset_path: peerAsset.path || null,
              },
            },
          },
        });
      }
      for (let i = 0; i < 120; i++) {
        const splats = (window.kaminosSceneObjectDebugState?.() || []).filter(record => record.type === 'splat');
        if (splats.length > beforeSplats.length) break;
        await wait(125);
      }
      const afterSplats = (window.kaminosSceneObjectDebugState?.() || []).filter(record => record.type === 'splat');
      const peerSplat = afterSplats.find(record => record.id !== selectedSplatId && record.source === peerAsset?.source)
        || afterSplats.find(record => record.id !== selectedSplatId)
        || null;
      if (peerSplat?.id) {
        window.kaminosSetSceneObjectTransform?.(peerSplat.id, {
          position: [0, 0.02, 1.15],
          rotation: [0, 0, 0],
          scale: [1.05, 1.05, 1.05],
        });
      }
      if (selectedSplatId) window.selectSceneObject?.(selectedSplatId);
      window.kaminosSetCameraDebugPose?.({ position: [0, 0.72, 3.05], target: [0, 0.03, 0.05] });
      await wait(500);
      const reloadSceneResult = await window.reloadHybridSplatSceneRenderer?.();
      await wait(1600);
      const sceneDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const offToggle = window.kaminosSetHybridSplatHostDepthDebugEnabled?.(false) || null;
      await wait(800);
      const offDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const host = document.getElementById('hybrid-splat-overlay-host');
      const hostRect = host ? (() => {
        const r = host.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })() : null;
      const peer = window.kaminosHybridSplatPeerDepthDebugState?.(peerSplat?.id) || null;
      return {
        selectedSplatId,
        selectedSource,
        peerAsset,
        peerSplat,
        beforeSplats,
        afterSplats,
        reloadSceneResult,
        sceneDebug,
        offToggle,
        offDebug,
        peer,
        overlayHost: { rect: hostRect },
      };
    })()
  `, { timeoutMs: 90000 });

  const offShot = await capturePngScreenshot(ws, siblingPngPath('-two-splat-host-depth-off'));

  const enable = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const onToggle = window.kaminosSetHybridSplatHostDepthDebugEnabled?.(true) || null;
      await wait(1000);
      const onDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const peer = window.kaminosHybridSplatPeerDepthDebugState?.(${JSON.stringify(null)}) || null;
      const hostDepth = window.kaminosHybridSplatHostDepthDebugState?.() || null;
      return { onToggle, onDebug, peer, hostDepth };
    })()
  `, { timeoutMs: 30000 });

  const onShot = await capturePngScreenshot(ws, siblingPngPath('-two-splat-host-depth-on'));
  const evidence = {
    schema: 'kaminos.hybrid-splat.two-splat-depth-order-witness.v0',
    setup,
    enable,
    overlayHost: setup.overlayHost,
    occluder: enable.peer || setup.peer,
    offScreenshot: offShot,
    onScreenshot: onShot,
  };
  evidence.regionDiff = comparePngRegion(offShot.path, onShot.path, evidence, 120);
  lastEvidence.hybridTwoSplatDepthOrder = evidence;

  if (!setup.selectedSplatId || !setup.peerSplat?.id || setup.peerSplat.id === setup.selectedSplatId) {
    throw new Error(`two-splat depth witness did not create a distinct selected splat plus peer splat: ${JSON.stringify(evidence)}`);
  }
  if (setup.offDebug?.capabilities?.hostDepthTexture !== false
    || setup.offDebug?.depthCompositionTelemetry?.source === 'host-depth-texture') {
    throw new Error(`two-splat depth witness could not disable host depth for A/B baseline: ${JSON.stringify(evidence)}`);
  }
  const onTelemetry = enable.onDebug?.depthCompositionTelemetry || null;
  if (enable.onDebug?.capabilities?.hostDepthTexture !== true
    || enable.onDebug?.capabilities?.sharedDevice !== true
    || onTelemetry?.source !== 'host-depth-texture'
    || enable.onDebug?.renderError) {
    throw new Error(`two-splat depth witness did not activate the shared host-depth route cleanly: ${JSON.stringify(evidence)}`);
  }
  const sceneSplatIds = setup.sceneDebug?.sceneSplatIds || [];
  if (setup.sceneDebug?.rendererMode !== 'scene'
    || !sceneSplatIds.includes(setup.selectedSplatId)
    || !sceneSplatIds.includes(setup.peerSplat.id)) {
    throw new Error(`two-splat depth witness did not reload both splats into the scene renderer: ${JSON.stringify(evidence)}`);
  }
  const included = enable.hostDepth?.status?.hostDepthIncludedSplatIds || [];
  const rendererOwned = enable.hostDepth?.status?.rendererOwnedSplatIds || [];
  if (included.includes(setup.peerSplat.id)
    || included.includes(setup.selectedSplatId)
    || !rendererOwned.includes(setup.peerSplat.id)
    || !rendererOwned.includes(setup.selectedSplatId)) {
    throw new Error(`two-splat depth witness did not exclude renderer-owned scene splats from the host depth pass: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.occluder?.active
    || !Number.isFinite(evidence.occluder?.screen?.x)
    || !Number.isFinite(evidence.occluder?.screen?.y)
    || !evidence.overlayHost?.rect) {
    throw new Error(`two-splat depth witness did not project a deterministic peer splat: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.regionDiff?.sampled) {
    throw new Error(`two-splat depth witness did not preserve comparable screenshot evidence: ${JSON.stringify(evidence)}`);
  }
}

async function runHybridLiveImportSceneMembershipScenario(ws) {
  await runRealHybridSplatOverlayScenario(ws);
  phase = 'scenario-hybrid-live-import-scene-membership';

  lastEvidence.hybridLiveImportSceneMembership = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const beforeDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const beforeSplats = (window.kaminosSceneObjectDebugState?.() || []).filter(record => record.type === 'splat');
      const beforeSources = new Set(beforeSplats.map(record => record.source).filter(Boolean));
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const rendererCapableEntry = entry => !!entry?.source
        && entry.renderability?.status !== 'not-splat-like'
        && (entry.size || 0) > 4096;
      const peerAsset = (assetData.entries || []).find(entry => rendererCapableEntry(entry) && !beforeSources.has(entry.source))
        || (assetData.entries || []).find(entry => entry.source && !beforeSources.has(entry.source) && entry.renderability?.status !== 'not-splat-like')
        || null;
      if (peerAsset && typeof window.greenroomImportSplat === 'function') {
        await window.greenroomImportSplat(peerAsset.source, peerAsset.name || peerAsset.path || 'live-peer-splat.ply', peerAsset.display || { title: peerAsset.name || 'Live Peer Splat' }, {
          clear: false,
          metadata: {
            source: peerAsset.source,
            fileName: peerAsset.name || peerAsset.path || 'live-peer-splat.ply',
            label: peerAsset.display?.title || peerAsset.name || 'Live Peer Splat',
            splat: {
              schema: 'kaminos.splat-asset.v0',
              assetSource: peerAsset.source,
              fileName: peerAsset.name || peerAsset.path || 'live-peer-splat.ply',
              format: 'ply',
              bounds: null,
              splatCount: null,
              sidecars: [],
              correction: peerAsset.correction?.crop?.enabled === true ? null : peerAsset.correction || null,
              renderability: peerAsset.renderability || null,
              provenance: {
                source_group: peerAsset.stage === 'production' ? 'splat-production' : 'splat-inbox',
                source_url: peerAsset.source,
                root_id: peerAsset.root_id || null,
                root_label: peerAsset.root_label || null,
                asset_stage: peerAsset.stage || 'experimental',
                asset_path: peerAsset.path || null,
              },
            },
          },
        });
      }
      let afterSplats = [];
      let peerSplat = null;
      let afterDebug = null;
      for (let i = 0; i < 80; i++) {
        afterSplats = (window.kaminosSceneObjectDebugState?.() || []).filter(record => record.type === 'splat');
        peerSplat = afterSplats.find(record => !beforeSplats.some(before => before.id === record.id)) || null;
        afterDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
        if (peerSplat?.id
          && beforeDebug?.sceneSplatIds?.every(id => afterDebug?.sceneSplatIds?.includes(id))
          && afterDebug?.sceneSplatIds?.includes(peerSplat.id)) {
          break;
        }
        await wait(125);
      }
      const peerVisibility = window.kaminosHybridSplatPeerDepthDebugState?.(peerSplat?.id) || null;
      const hostDepth = window.kaminosHybridSplatHostDepthDebugState?.() || null;
      return { beforeDebug, beforeSplats, peerAsset, afterSplats, peerSplat, afterDebug, peerVisibility, hostDepth };
    })()
  `, { timeoutMs: 90000 });

  const evidence = lastEvidence.hybridLiveImportSceneMembership;
  if (evidence.beforeDebug?.rendererMode !== 'scene' || evidence.beforeDebug?.status !== 'rendering') {
    throw new Error(`live-import scene membership witness did not begin with a running scene renderer: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.peerSplat?.id) {
    throw new Error(`live-import scene membership witness did not import a second splat while rendering: ${JSON.stringify(evidence)}`);
  }
  const sceneSplatIds = evidence.afterDebug?.sceneSplatIds || [];
  if (evidence.afterDebug?.rendererMode !== 'scene'
    || evidence.afterDebug?.status !== 'rendering'
    || !sceneSplatIds.includes(evidence.peerSplat.id)
    || !evidence.beforeDebug.sceneSplatIds.every(id => sceneSplatIds.includes(id))) {
    throw new Error(`live-import scene membership witness did not add the imported splat to the active renderer scene: ${JSON.stringify(evidence)}`);
  }
  if (evidence.peerVisibility?.visible !== false) {
    throw new Error(`live-import scene membership witness left the imported renderer-owned point-cloud preview visible: ${JSON.stringify(evidence)}`);
  }
}

async function runRealHybridCroppedUnsupportedGuardScenario(ws) {
  phase = 'scenario-real-hybrid-cropped-unsupported-guard';
  lastEvidence.realHybridCroppedUnsupportedGuard = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
      document.querySelector('[data-tab="greenroom"]').click();
      if (window.grBrowseSplatAssets) await window.grBrowseSplatAssets();
      const beforeRows = rowState();
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const assetEntry = (assetData.entries || []).find(entry => entry.name === 'evil_orb_final_composite.ply') || null;
      if (assetEntry) {
        await window.greenroomImportSplat(assetEntry.source, assetEntry.name, assetEntry.display || { title: assetEntry.name }, {
          clear: false,
          metadata: {
            source: assetEntry.source,
            fileName: assetEntry.name,
            label: assetEntry.display?.title || assetEntry.name,
            splat: {
              schema: 'kaminos.splat-asset.v0',
              assetSource: assetEntry.source,
              fileName: assetEntry.name,
              format: 'ply',
              bounds: null,
              splatCount: null,
              sidecars: [],
              correction: assetEntry.correction || null,
              provenance: {
                source_group: 'splat-inbox',
                source_url: assetEntry.source,
                root_id: assetEntry.root_id || null,
                root_label: assetEntry.root_label || null,
                asset_stage: assetEntry.stage || 'experimental',
                asset_path: assetEntry.path || null,
              },
            },
          },
        });
      }
      for (let i = 0; i < 120; i++) {
        if (rowState().length > beforeRows.length) break;
        await wait(125);
      }
      const splatObject = (window.kaminosSceneObjectDebugState?.() || [])
        .find(record => record.type === 'splat' && record.source === assetEntry?.source) || null;
      if (splatObject?.id) window.selectSceneObject?.(splatObject.id);
      const requestedHybridModuleUrl = ${JSON.stringify(hybridModuleUrl)};
      if (requestedHybridModuleUrl) {
        window.kaminosSetHybridSplatOverlayModuleUrl?.(requestedHybridModuleUrl);
      }
      const startResult = await window.startSelectedSplatHybridRenderer?.();
      await wait(500);
      const overlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const handoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const statusText = document.getElementById('splat-hybrid-renderer-status')?.textContent || null;
      return {
        assetEntry,
        splatObject,
        startResult,
        overlayDebug,
        handoffDebug,
        statusText,
        sceneRows: rowState(),
      };
    })()
  `, { timeoutMs: 90000 });

  const evidence = lastEvidence.realHybridCroppedUnsupportedGuard;
  if (!evidence.assetEntry?.correction?.crop?.enabled || !evidence.splatObject) {
    throw new Error(`real hybrid cropped guard could not import the cropped final composite: ${JSON.stringify(evidence)}`);
  }
  if (evidence.overlayDebug?.status !== 'error'
      || evidence.overlayDebug?.canvasConnected
      || evidence.overlayDebug?.sceneLoaded
      || !/crop unsupported/i.test(evidence.statusText || '')
      || !/crop unsupported/i.test(evidence.overlayDebug?.error || '')) {
    throw new Error(`real hybrid cropped guard allowed an uncropped expensive renderer start: ${JSON.stringify(evidence)}`);
  }
}

async function runRealHybridCroppedSupportedOverlayScenario(ws) {
  phase = 'scenario-real-hybrid-cropped-supported-overlay';
  lastEvidence.realHybridCroppedSupportedOverlay = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
      document.querySelector('[data-tab="greenroom"]').click();
      if (window.grBrowseSplatAssets) await window.grBrowseSplatAssets();
      const beforeRows = rowState();
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const assetEntry = (assetData.entries || []).find(entry => entry.name === 'evil_orb_final_composite.ply') || null;
      if (assetEntry) {
        await window.greenroomImportSplat(assetEntry.source, assetEntry.name, assetEntry.display || { title: assetEntry.name }, {
          clear: false,
          metadata: {
            source: assetEntry.source,
            fileName: assetEntry.name,
            label: assetEntry.display?.title || assetEntry.name,
            splat: {
              schema: 'kaminos.splat-asset.v0',
              assetSource: assetEntry.source,
              fileName: assetEntry.name,
              format: 'ply',
              bounds: null,
              splatCount: null,
              sidecars: [],
              correction: assetEntry.correction || null,
              provenance: {
                source_group: 'splat-inbox',
                source_url: assetEntry.source,
                root_id: assetEntry.root_id || null,
                root_label: assetEntry.root_label || null,
                asset_stage: assetEntry.stage || 'experimental',
                asset_path: assetEntry.path || null,
              },
            },
          },
        });
      }
      for (let i = 0; i < 120; i++) {
        if (rowState().length > beforeRows.length) break;
        await wait(125);
      }
      const splatObject = (window.kaminosSceneObjectDebugState?.() || [])
        .find(record => record.type === 'splat' && record.source === assetEntry?.source) || null;
      if (splatObject?.id) window.selectSceneObject?.(splatObject.id);
      const previewDebugBefore = window.kaminosSplatPreviewDebugState?.(splatObject?.id) || null;
      const requestedHybridModuleUrl = ${JSON.stringify(hybridModuleUrl)};
      if (requestedHybridModuleUrl) {
        window.kaminosSetHybridSplatOverlayModuleUrl?.(requestedHybridModuleUrl);
      }
      const startResult = await window.startSelectedSplatHybridRenderer?.();
      await wait(2200);
      const overlayDebug = window.kaminosHybridSplatOverlayDebugState?.() || null;
      const handoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const previewDebugAfter = window.kaminosSplatPreviewDebugState?.(splatObject?.id) || null;
      const statusText = document.getElementById('splat-hybrid-renderer-status')?.textContent || null;
      const overlayCanvas = document.querySelector('#hybrid-splat-overlay-host canvas');
      const host = document.getElementById('hybrid-splat-overlay-host');
      return {
        assetEntry,
        splatObject,
        startResult,
        overlayDebug,
        handoffDebug,
        previewDebugBefore,
        previewDebugAfter,
        statusText,
        overlayCanvas: overlayCanvas ? {
          width: overlayCanvas.width,
          height: overlayCanvas.height,
          connected: overlayCanvas.isConnected,
        } : null,
        overlayHost: host ? (() => {
          const rect = host.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })() : null,
        sceneRows: rowState(),
      };
    })()
  `, { timeoutMs: 90000 });

  const evidence = lastEvidence.realHybridCroppedSupportedOverlay;
  if (!evidence.assetEntry?.correction?.crop?.enabled || !evidence.splatObject) {
    throw new Error(`crop-capable renderer witness could not import the corrected final composite: ${JSON.stringify(evidence)}`);
  }
  if (evidence.previewDebugBefore?.cropEnabled !== true
      || !(evidence.previewDebugBefore?.includedPointCount > 0)
      || evidence.previewDebugAfter?.cropEnabled !== true
      || !(evidence.previewDebugAfter?.includedPointCount > 0)) {
    throw new Error(`crop-capable renderer witness did not prove Kaminos had a visible corrected crop before handoff: ${JSON.stringify(evidence)}`);
  }
  if (evidence.overlayDebug?.status !== 'rendering'
      || !evidence.overlayDebug?.canvasConnected
      || !evidence.overlayDebug?.sceneLoaded
      || !evidence.overlayCanvas?.connected
      || (evidence.overlayHost?.width || 0) < 64
      || (evidence.overlayHost?.height || 0) < 64) {
    throw new Error(`crop-capable renderer did not render the corrected cropped splat: ${JSON.stringify(evidence)}`);
  }
  const capabilities = evidence.overlayDebug?.capabilities || {};
  const correctionApplication = evidence.overlayDebug?.correctionApplication || {};
  if (evidence.overlayDebug?.cropAppliedByRenderer !== true
      || capabilities.cropAppliedByRenderer !== true
      || correctionApplication.cropApplied !== true
      || evidence.handoffDebug?.activeHandoff?.evidence?.cropAppliedByRenderer !== true) {
    throw new Error(`cropped hybrid overlay did not report renderer-side crop application: ${JSON.stringify(evidence)}`);
  }
  if (correctionApplication.sourceCount > 0 && !(correctionApplication.keptCount > 0)) {
    throw new Error(`cropped hybrid overlay reported zero kept splats after renderer-side crop: ${JSON.stringify(evidence)}`);
  }
  if (correctionApplication.sourceCount > 0
      && correctionApplication.keptCount > 0
      && correctionApplication.keptCount >= correctionApplication.sourceCount) {
    throw new Error(`cropped hybrid overlay reported no dropped splats for an enabled crop: ${JSON.stringify(evidence)}`);
  }
  if (evidence.overlayDebug?.sourceIdentity?.source !== evidence.splatObject.source
      || evidence.handoffDebug?.activeHandoff?.hybridOverlay?.sourceIdentity?.source !== evidence.splatObject.source) {
    throw new Error(`cropped hybrid overlay did not preserve renderer source identity: ${JSON.stringify(evidence)}`);
  }
  if (evidence.overlayDebug?.sceneContextAccepted !== true
      || evidence.handoffDebug?.activeHandoff?.hybridOverlay?.sceneContextAccepted !== true
      || !evidence.overlayDebug?.sceneContextTelemetry) {
    throw new Error(`cropped hybrid overlay lost scene-context acceptance: ${JSON.stringify(evidence)}`);
  }
  if (/crop unsupported/i.test(evidence.statusText || '')
      || /point-cloud fallback/i.test(evidence.statusText || '')) {
    throw new Error(`crop-capable renderer witness stayed on the Kaminos fallback path: ${JSON.stringify(evidence)}`);
  }
}

async function runRealSavedSplatCropVisibilityScenario(ws) {
  phase = 'scenario-real-saved-splat-crop-visibility';
  const requestedSplatAssetName = splatAssetName || 'evil_orb_multiview_emissive.ply';
  lastEvidence.realSavedSplatCropVisibility = await evaluate(ws, `
    (async () => {
      const requestedSplatAssetName = ${JSON.stringify(requestedSplatAssetName)};
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const waitForAssetRows = async () => {
        for (let i = 0; i < 100; i++) {
          const rows = [...document.querySelectorAll('#splat-assets-list .gr-entry')];
          if (rows.length) return rows;
          await wait(125);
        }
        return [...document.querySelectorAll('#splat-assets-list .gr-entry')];
      };
      const waitForSceneRows = async count => {
        for (let i = 0; i < 160; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };
      document.querySelector('[data-tab="greenroom"]').click();
      if (window.grBrowseSplatAssets) await window.grBrowseSplatAssets();
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const assetEntry = (assetData.entries || []).find(entry => entry.name === requestedSplatAssetName) || null;
      const beforeRows = rowState();
      const assetRows = await waitForAssetRows();
      const actionRows = assetRows.filter(row => [...row.querySelectorAll('button')]
        .some(button => button.textContent.trim() === 'Import Splat'));
      const actionRow = actionRows.find(row => row.textContent.includes(assetEntry?.display?.title || requestedSplatAssetName)) || null;
      const actionButton = actionRow ? [...actionRow.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Import Splat') : null;
      if (actionButton) actionButton.click();
      await waitForSceneRows(beforeRows.length + 1);
      await wait(500);
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splat = sceneDebug.find(record => record.type === 'splat' && record.source === assetEntry?.source)
        || sceneDebug.find(record => record.type === 'splat' && String(record.source || '').includes(requestedSplatAssetName))
        || null;
      if (splat?.id) window.selectSceneObject?.(splat.id);
      await wait(250);
      const pivotBeforeMode = window.kaminosSplatPivotDebugState?.(splat?.id) || null;
      const previewBeforeMode = window.kaminosSplatPreviewDebugState?.(splat?.id) || null;
      const enteredMode = await window.enterSplatCorrectionMode?.(splat?.id);
      await wait(250);
      const previewInMode = window.kaminosSplatPreviewDebugState?.(splat?.id) || null;
      const exitedMode = window.exitSplatCorrectionMode?.({ revert: false, silent: true });
      await wait(250);
      const previewAfterClose = window.kaminosSplatPreviewDebugState?.(splat?.id) || null;
      const pivotAfterClose = window.kaminosSplatPivotDebugState?.(splat?.id) || null;
      return {
        assetEntry,
        requestedSplatAssetName,
        actionExposed: !!actionButton,
        splat,
        pivotBeforeMode,
        previewBeforeMode,
        enteredMode,
        previewInMode,
        exitedMode,
        previewAfterClose,
        pivotAfterClose,
      };
    })()
  `, { timeoutMs: 120000 });

  const evidence = lastEvidence.realSavedSplatCropVisibility;
  if (!evidence.assetEntry?.source || !evidence.actionExposed || !evidence.splat) {
    throw new Error(`real saved splat crop witness could not import ${requestedSplatAssetName}: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.splat.splat?.correction?.crop?.enabled) {
    throw new Error(`real saved splat crop did not load crop correction from sidecar: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.previewBeforeMode
      || evidence.previewBeforeMode.cropEnabled !== true
      || evidence.previewBeforeMode.includedPointCount < 1
      || evidence.previewBeforeMode.includedVisible !== true
      || evidence.previewBeforeMode.excludedVisible !== false) {
    throw new Error(`real saved splat crop did not show included points before edit mode: ${JSON.stringify(evidence)}`);
  }
  const includedRatio = evidence.previewBeforeMode.includedPointCount / Math.max(1, evidence.previewBeforeMode.totalPointCount || 0);
  if (evidence.requestedSplatAssetName === 'evil_orb_final_composite.ply' && includedRatio < 0.01) {
    throw new Error(`real saved final-composite crop chose a sparse false-positive frame: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.previewInMode
      || evidence.previewInMode.excludedPointCount < 1
      || evidence.previewInMode.excludedVisible !== true
      || !(evidence.previewInMode.excludedOpacity < evidence.previewInMode.includedOpacity)) {
    throw new Error(`real saved splat crop did not expose edit context: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.previewAfterClose
      || evidence.previewAfterClose.includedPointCount < 1
      || evidence.previewAfterClose.includedVisible !== true
      || evidence.previewAfterClose.excludedVisible !== false) {
    throw new Error(`real saved splat crop did not remain visible after edit mode closed: ${JSON.stringify(evidence)}`);
  }
}

async function runSplatAssetInboxScenario(ws) {
  phase = 'scenario-splat-asset-inbox';
  lastEvidence.splatAssetInbox = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const waitForAssetRows = async () => {
        for (let i = 0; i < 100; i++) {
          const rows = [...document.querySelectorAll('#splat-assets-list .gr-entry')];
          if (rows.length) return rows;
          await wait(125);
        }
        return [...document.querySelectorAll('#splat-assets-list .gr-entry')];
      };
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };

      document.querySelector('[data-tab="greenroom"]').click();
      if (window.grBrowseSplatAssets) await window.grBrowseSplatAssets();
      const beforeRows = rowState();
      const assetRows = await waitForAssetRows();
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const actionRow = assetRows.find(row => row.dataset.assetStage === 'experimental'
        && [...row.querySelectorAll('button')].some(button => button.textContent.trim() === 'Import Splat'));
      const actionButton = actionRow ? [...actionRow.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Import Splat') : null;
      const stageText = actionRow?.querySelector('.gr-stage')?.textContent?.trim() || null;
      const title = actionRow?.querySelector('.gr-title')?.textContent?.trim() || null;
      const raw = actionRow?.querySelector('.gr-raw')?.textContent?.replace(/^raw\\s+/i, '').trim() || null;
      const assetEntry = (assetData.entries || []).find(entry => entry.stage === 'experimental') || null;
      const sourceProbe = assetEntry?.source
        ? await fetch(assetEntry.source).then(async resp => ({
            ok: resp.ok,
            status: resp.status,
            route: assetEntry.source,
            bytes: (await resp.arrayBuffer()).byteLength,
          }))
        : null;
      if (actionButton) actionButton.click();
      const afterRows = await waitForSceneRows(beforeRows.length + 1);
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splatObject = sceneDebug.find(record => record.type === 'splat'
        && record.source === assetEntry?.source) || sceneDebug.find(record => record.type === 'splat') || null;
      return {
        beforeRows,
        afterRows,
        assetRowCount: assetRows.length,
        assetData,
        actionExposed: !!actionButton,
        stageText,
        title,
        raw,
        assetEntry,
        sourceProbe,
        sceneDebug,
        splatObject,
      };
    })()
  `, { timeoutMs: 60000 });

  if (lastEvidence.splatAssetInbox.assetRowCount < 1) {
    throw new Error(`splat asset inbox did not render any splat assets: ${JSON.stringify(lastEvidence.splatAssetInbox)}`);
  }
  if (lastEvidence.splatAssetInbox.stageText !== 'experimental'
      || lastEvidence.splatAssetInbox.assetEntry?.stage !== 'experimental') {
    throw new Error(`splat asset inbox did not preserve experimental stage: ${JSON.stringify(lastEvidence.splatAssetInbox)}`);
  }
  const splatObject = lastEvidence.splatAssetInbox.splatObject;
  if (!splatObject || splatObject.type !== 'splat'
      || splatObject.splat?.previewKind !== 'point-cloud'
      || Number(splatObject.splat?.pointCount || 0) < 1) {
    throw new Error(`splat asset inbox import did not register point-cloud splat: ${JSON.stringify(lastEvidence.splatAssetInbox)}`);
  }
  const source = splatObject.source || '';
  const expectedSource = lastEvidence.splatAssetInbox.assetEntry?.source || '';
  if (!expectedSource || source !== expectedSource || !source.includes('/api/read?root=splat-inbox')) {
    throw new Error(`splat asset inbox did not preserve asset source: ${JSON.stringify(lastEvidence.splatAssetInbox)}`);
  }
}

async function runSplatDirectDropIngestScenario(ws) {
  phase = 'scenario-splat-direct-drop-ingest';
  lastEvidence.splatDirectDropIngest = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const ply = [
        'ply',
        'format ascii 1.0',
        'element vertex 6',
        'property float x',
        'property float y',
        'property float z',
        'property uchar red',
        'property uchar green',
        'property uchar blue',
        'end_header',
        '-1 0 0 255 60 60',
        '1 0 0 60 255 60',
        '0 -1 0 60 60 255',
        '0 1 0 255 220 60',
        '0 0 -1 255 60 220',
        '0 0 1 60 255 220',
      ].join('\\n') + '\\n';
      document.querySelector('[data-tab="greenroom"]').click();
      const beforeRows = rowState();
      const file = new File([ply], 'Witness Direct Drop.PLY', { type: 'application/octet-stream' });
      const ingestResult = await window.kaminosIngestDroppedSplatFile(file, { clear: false });
      const afterRows = await waitForSceneRows(beforeRows.length + 1);
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splatObject = sceneDebug.find(record => record.type === 'splat'
        && record.source === ingestResult?.entry?.source) || sceneDebug.find(record => record.type === 'splat') || null;
      const sourceProbe = ingestResult?.entry?.source
        ? await fetch(ingestResult.entry.source).then(async resp => ({
            ok: resp.ok,
            status: resp.status,
            route: ingestResult.entry.source,
            bytes: (await resp.arrayBuffer()).byteLength,
          }))
        : null;
      return {
        beforeRows,
        afterRows,
        ingestResult: {
          entry: ingestResult?.entry || null,
          objectName: ingestResult?.object?.name || null,
        },
        assetData,
        sourceProbe,
        sceneDebug,
        splatObject,
        info: document.getElementById('info-bar')?.textContent?.trim() || null,
      };
    })()
  `, { timeoutMs: 60000 });

  const entry = lastEvidence.splatDirectDropIngest.ingestResult?.entry;
  if (!entry || entry.stage !== 'experimental' || entry.root_id !== 'splat-inbox') {
    throw new Error(`direct splat drop did not upload to the experimental inbox: ${JSON.stringify(lastEvidence.splatDirectDropIngest)}`);
  }
  const splatObject = lastEvidence.splatDirectDropIngest.splatObject;
  const source = splatObject?.source || '';
  if (!splatObject || source !== entry.source || !source.includes('/api/read?root=splat-inbox')) {
    throw new Error(`direct splat drop did not import from the reloadable inbox route: ${JSON.stringify(lastEvidence.splatDirectDropIngest)}`);
  }
  if (splatObject.splat?.previewKind !== 'point-cloud' || Number(splatObject.splat?.pointCount || 0) !== 6) {
    throw new Error(`direct splat drop did not register point-cloud splat: ${JSON.stringify(lastEvidence.splatDirectDropIngest)}`);
  }
  const provenance = splatObject.splat?.provenance || {};
  if (provenance.ingest !== 'direct-drop'
      || provenance.asset_stage !== 'experimental'
      || provenance.root_id !== 'splat-inbox'
      || provenance.source_url !== entry.source) {
    throw new Error(`direct splat drop did not preserve ingest provenance: ${JSON.stringify(lastEvidence.splatDirectDropIngest)}`);
  }
}

async function runSplatCorrectionSidecarScenario(ws) {
  phase = 'scenario-splat-correction-sidecar';
  lastEvidence.splatCorrectionSidecar = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const ply = [
        'ply',
        'format ascii 1.0',
        'element vertex 7',
        'property float x',
        'property float y',
        'property float z',
        'property uchar red',
        'property uchar green',
        'property uchar blue',
        'end_header',
        '0 0 0 255 255 255',
        '-1 0 0 255 60 60',
        '1 0 0 60 255 60',
        '0 -1 0 60 60 255',
        '0 1 0 255 220 60',
        '0 0 -1 255 60 220',
        '0 0 1 60 255 220',
      ].join('\\n') + '\\n';
      document.querySelector('[data-tab="greenroom"]').click();
      const file = new File([ply], 'Witness Correction Sidecar.PLY', { type: 'application/octet-stream' });
      const ingestResult = await window.kaminosIngestDroppedSplatFile(file, { clear: true });
      await wait(250);
      const firstSceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const firstSplat = firstSceneDebug.find(record => record.type === 'splat'
        && record.source === ingestResult?.entry?.source) || firstSceneDebug.find(record => record.type === 'splat');
      if (!firstSplat) throw new Error('correction scenario could not import initial splat');
      window.selectSceneObject(firstSplat.id);
      await window.enterSplatCorrectionMode(firstSplat.id);
      window.kaminosSetSplatCorrectionDraftTransform({
        position: [0.5, 0, 0],
        rotation: [0.1, 0.2, 0.3],
        scale: [1, 1, 1],
      });
      const setField = (name, value) => {
        const input = document.querySelector('[data-splat-correction-field="' + name + '"]');
        if (!input) throw new Error('missing splat correction field ' + name);
        if (input.type === 'checkbox') input.checked = !!value;
        else input.value = String(value);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setField('crop.enabled', true);
      setField('crop.min.x', -0.05);
      setField('crop.min.y', -0.05);
      setField('crop.min.z', -0.05);
      setField('crop.max.x', 0.05);
      setField('crop.max.y', 0.05);
      setField('crop.max.z', 0.05);
      const saveResult = await window.kaminosSaveSelectedSplatCorrection();
      const assetDataAfterSave = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const savedAssetEntry = (assetDataAfterSave.entries || []).find(entry => entry.path === ingestResult?.entry?.path) || null;
      const sourceBeforeReload = ingestResult?.entry?.source;
      await window.greenroomImportSplat(sourceBeforeReload, ingestResult?.entry?.name || 'splat.ply', ingestResult?.entry?.display || { title: 'Splat' }, {
        clear: true,
        metadata: {
          source: sourceBeforeReload,
          fileName: ingestResult?.entry?.name || 'splat.ply',
          label: 'Reloaded correction sidecar',
          splat: {
            schema: 'kaminos.splat-asset.v0',
            assetSource: sourceBeforeReload,
            fileName: ingestResult?.entry?.name || 'splat.ply',
            format: 'ply',
            bounds: null,
            splatCount: null,
            sidecars: [],
            provenance: {
              source_group: 'splat-inbox',
              source_url: sourceBeforeReload,
              root_id: ingestResult?.entry?.root_id,
              root_label: ingestResult?.entry?.root_label,
              asset_stage: ingestResult?.entry?.stage,
              asset_path: ingestResult?.entry?.path,
            },
          },
        },
      });
      await wait(250);
      const reloadedSceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const reloadedSplat = reloadedSceneDebug.find(record => record.type === 'splat') || null;
      const reloadedPivotBeforeMode = window.kaminosSplatPivotDebugState?.(reloadedSplat?.id) || null;
      const reloadedPreviewBeforeMode = window.kaminosSplatPreviewDebugState?.(reloadedSplat?.id) || null;
      const enteredReloadedMode = await window.enterSplatCorrectionMode(reloadedSplat?.id);
      await wait(50);
      const reloadedPivotInMode = window.kaminosSplatPivotDebugState?.(reloadedSplat?.id) || null;
      const reloadedPreviewInMode = window.kaminosSplatPreviewDebugState?.(reloadedSplat?.id) || null;
      const exitedReloadedMode = window.exitSplatCorrectionMode({ revert: false, silent: true });
      const handoffDebug = window.kaminosRenderHandoffDebugState?.(reloadedSplat?.id) || null;
      return {
        ingestResult: { entry: ingestResult?.entry || null },
        saveResult,
        assetDataAfterSave,
        savedAssetEntry,
        firstSplat,
        reloadedSplat,
        reloadedPivotBeforeMode,
        reloadedPreviewBeforeMode,
        enteredReloadedMode,
        reloadedPivotInMode,
        reloadedPreviewInMode,
        exitedReloadedMode,
        handoffDebug,
      };
    })()
  `, { timeoutMs: 60000 });

  const saved = lastEvidence.splatCorrectionSidecar.savedAssetEntry;
  const savedCorrection = saved?.correction || null;
  if (!savedCorrection
      || savedCorrection.crop?.enabled !== true
      || savedCorrection.centroidOffset?.[0] !== 0.5
      || savedCorrection.orientation?.rotation?.[2] !== 0.3) {
    throw new Error(`splat correction did not persist to sidecar: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
  const reloaded = lastEvidence.splatCorrectionSidecar.reloadedSplat;
  if (!reloaded?.splat?.correction
      || reloaded.splat.correction.crop?.enabled !== true
      || reloaded.splat.correction.centroidOffset?.[0] !== 0.5
      || reloaded.splat.correction.centroidOffset?.[2] !== 0
      || reloaded.sceneTransform?.position?.[0] !== 0
      || reloaded.transform?.position?.[1] !== 0
      || reloaded.transform?.position?.[2] !== 0
      || reloaded.transform?.rotation?.[1] !== 0.2) {
    throw new Error(`splat correction did not reload from sidecar: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
  const reloadedPivotBeforeMode = lastEvidence.splatCorrectionSidecar.reloadedPivotBeforeMode;
  if (!reloadedPivotBeforeMode
      || Math.abs(reloadedPivotBeforeMode.objectPivotWorldPosition?.[0] - 0.5) > 1e-6
      || Math.abs(reloadedPivotBeforeMode.sceneAnchorWorldPosition?.[0] - 0) > 1e-6
      || Math.abs(reloadedPivotBeforeMode.visualAnchorWorldPosition?.[0] - 0) > 1e-6
      || Math.abs(reloadedPivotBeforeMode.correctionPivotWorldPosition?.[0] - 0.5) > 1e-6) {
    throw new Error(`saved splat correction did not import with corrected pivot while preserving visual anchor: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
  const caps = lastEvidence.splatCorrectionSidecar.handoffDebug?.activeHandoff?.capabilities || {};
  if (caps.realSplatRendering !== false || caps.meshDepthOcclusion !== false) {
    throw new Error(`splat correction leaked into render truth claim: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
  const reloadedPreviewBeforeMode = lastEvidence.splatCorrectionSidecar.reloadedPreviewBeforeMode;
  if (!reloadedPreviewBeforeMode
      || reloadedPreviewBeforeMode.includedPointCount !== 1
      || reloadedPreviewBeforeMode.excludedPointCount !== 6
      || reloadedPreviewBeforeMode.includedVisible !== true
      || reloadedPreviewBeforeMode.excludedVisible !== false) {
    throw new Error(`saved splat crop centroid preview did not show included points before edit mode: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
  const reloadedPreviewInMode = lastEvidence.splatCorrectionSidecar.reloadedPreviewInMode;
  if (!reloadedPreviewInMode
      || reloadedPreviewInMode.includedPointCount !== 1
      || reloadedPreviewInMode.excludedPointCount !== 6
      || reloadedPreviewInMode.excludedVisible !== true
      || !(reloadedPreviewInMode.excludedOpacity < reloadedPreviewInMode.includedOpacity)) {
    throw new Error(`saved splat crop centroid preview did not show edit context: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
}

async function runSplatCorrectionModeScenario(ws) {
  phase = 'scenario-splat-correction-mode';
  lastEvidence.splatCorrectionMode = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const ply = [
        'ply',
        'format ascii 1.0',
        'element vertex 6',
        'property float x',
        'property float y',
        'property float z',
        'property uchar red',
        'property uchar green',
        'property uchar blue',
        'end_header',
        '-1 0 0 255 80 80',
        '1 0 0 80 255 80',
        '0 -1 0 80 80 255',
        '0 1 0 255 220 80',
        '0 0 -1 255 80 220',
        '0 0 1 80 255 220',
      ].join('\\n') + '\\n';
      document.querySelector('[data-tab="greenroom"]').click();
      const file = new File([ply], 'Witness Correction Mode.PLY', { type: 'application/octet-stream' });
      const ingestResult = await window.kaminosIngestDroppedSplatFile(file, { clear: true });
      await wait(250);
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splat = sceneDebug.find(record => record.type === 'splat' && record.source === ingestResult?.entry?.source)
        || sceneDebug.find(record => record.type === 'splat');
      if (!splat) throw new Error('correction mode scenario could not import splat');
      window.selectSceneObject(splat.id);
      const plannedSceneTransform = {
        position: [1.0, 0.25, -0.5],
        rotation: [0.4, -0.2, 0.1],
        scale: [1.1, 1.2, 1.3],
      };
      const sceneBeforeMode = window.kaminosSetSceneObjectTransform(splat.id, plannedSceneTransform);
      const entered = await window.enterSplatCorrectionMode(splat.id);
      const draft = window.kaminosSetSplatCorrectionDraftTransform({
        position: [0.2, 0.3, 0.4],
        rotation: [0.05, 0.1, 0.15],
        scale: [1, 1, 1],
      });
      const sceneAfterDraft = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      const pivotAfterDraft = window.kaminosSplatPivotDebugState?.(splat.id) || null;
      const flipDraft = window.kaminosToggleSplatCorrectionAxisFlip('x');
      const sceneAfterFlip = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      const pivotAfterFlip = window.kaminosSplatPivotDebugState?.(splat.id) || null;
      const cropEnabled = document.querySelector('[data-splat-correction-field="crop.enabled"]');
      if (!cropEnabled) throw new Error('Splat Correction Mode witness could not find crop enabled control');
      cropEnabled.checked = true;
      cropEnabled.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(50);
      const cropToggleDraft = window.kaminosSplatCorrectionModeDebugState?.() || null;
      const sceneAfterCropToggle = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      const cropMode = await window.setSplatCorrectionEditMode('crop');
      const cropEdit = window.kaminosSetSplatCorrectionCropTransform({
        position: [0, 0, 1],
        scale: [0.4, 0.4, 0.4],
      });
      const sceneAfterCropEdit = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      const cropEditPreview = window.kaminosSplatPreviewDebugState?.(splat.id) || null;
      const saveButton = [...document.querySelectorAll('#splat-correction-panel button')]
        .find(button => button.textContent.trim() === 'Save Correction');
      if (!saveButton) throw new Error('Splat Correction Mode witness could not find visible Save Correction button');
      saveButton.click();
      let saveResult = null;
      let assetDataAfterSave = null;
      let savedAssetEntry = null;
      for (let i = 0; i < 80; i++) {
        await wait(125);
        assetDataAfterSave = await fetch('/api/assets?kind=splat').then(resp => resp.json());
        savedAssetEntry = (assetDataAfterSave.entries || []).find(entry => entry.path === ingestResult?.entry?.path) || null;
        if (savedAssetEntry?.correction?.axisFlips?.[0] === -1) {
          saveResult = await fetch('/api/splat-correction?' + new URLSearchParams({
            root: ingestResult?.entry?.root_id,
            path: ingestResult?.entry?.path,
          })).then(resp => resp.json());
          break;
        }
      }
      const modeAfterSave = window.kaminosSplatCorrectionModeDebugState?.() || null;
      const editPreviewAfterSave = window.kaminosSplatPreviewDebugState?.(splat.id) || null;
      const closedMode = window.exitSplatCorrectionMode({ revert: false, silent: true });
      await wait(50);
      const previewAfterClose = window.kaminosSplatPreviewDebugState?.(splat.id) || null;
      return {
        ingestResult: { entry: ingestResult?.entry || null },
        sceneBeforeMode,
        entered,
        draft,
        sceneAfterDraft,
        pivotAfterDraft,
        flipDraft,
        sceneAfterFlip,
        pivotAfterFlip,
        cropToggleDraft,
        sceneAfterCropToggle,
        cropMode,
        cropEdit,
        sceneAfterCropEdit,
        cropEditPreview,
        saveResult,
        modeAfterSave,
        editPreviewAfterSave,
        closedMode,
        previewAfterClose,
        assetDataAfterSave,
        savedAssetEntry,
      };
    })()
  `, { timeoutMs: 60000 });

  const evidence = lastEvidence.splatCorrectionMode;
  if (!evidence.entered?.active || !evidence.entered?.targetAttached || evidence.entered?.transformTargetName !== 'splat-correction-target') {
    throw new Error(`splat correction mode did not retarget gizmo: ${JSON.stringify(evidence)}`);
  }
  const before = evidence.sceneBeforeMode?.sceneTransform;
  const after = evidence.sceneAfterDraft?.sceneTransform;
  const sameSceneTransform = Array.isArray(before?.position)
    && Array.isArray(after?.position)
    && before.position.every((value, index) => Math.abs(value - after.position[index]) < 1e-6)
    && before.rotation.every((value, index) => Math.abs(value - after.rotation[index]) < 1e-6)
    && before.scale.every((value, index) => Math.abs(value - after.scale[index]) < 1e-6);
  if (!sameSceneTransform) {
    throw new Error(`splat correction mode dirtied scene transform: ${JSON.stringify(evidence)}`);
  }
  const afterFlip = evidence.sceneAfterFlip?.sceneTransform;
  const flipPreservedSceneTransform = Array.isArray(afterFlip?.position)
    && before.position.every((value, index) => Math.abs(value - afterFlip.position[index]) < 1e-6)
    && before.rotation.every((value, index) => Math.abs(value - afterFlip.rotation[index]) < 1e-6)
    && before.scale.every((value, index) => Math.abs(value - afterFlip.scale[index]) < 1e-6);
  if (!flipPreservedSceneTransform) {
    throw new Error(`splat correction axis flip dirtied scene transform: ${JSON.stringify(evidence)}`);
  }
  const visual = evidence.pivotAfterDraft;
  if (!visual
      || Math.abs(visual.visualAnchorWorldPosition?.[0] - 1.0) > 1e-6
      || Math.abs(visual.visualAnchorWorldPosition?.[1] - 0.25) > 1e-6
      || Math.abs(visual.visualAnchorWorldPosition?.[2] + 0.5) > 1e-6
      || Math.abs(visual.objectPivotWorldPosition?.[0] - 1.2) > 1e-6
      || Math.abs(visual.objectPivotWorldPosition?.[1] - 0.55) > 1e-6
      || Math.abs(visual.objectPivotWorldPosition?.[2] + 0.1) > 1e-6
      || Math.abs(evidence.sceneAfterDraft?.transform?.rotation?.[2] - 0.25) > 1e-6) {
    throw new Error(`splat correction pivot edit moved splat preview: ${JSON.stringify(evidence)}`);
  }
  const flippedVisual = evidence.sceneAfterFlip?.transform;
  if (!flippedVisual || Math.abs(flippedVisual.scale?.[0] + 1.1) > 1e-6) {
    throw new Error(`splat correction mode did not compose axis flip into preview scale: ${JSON.stringify(evidence)}`);
  }
  const cropToggleCorrection = evidence.cropToggleDraft?.draftCorrection
    || evidence.sceneAfterCropToggle?.splat?.correction
    || null;
  if (cropToggleCorrection?.axisFlips?.[0] !== -1
      || evidence.sceneAfterCropToggle?.splat?.correction?.axisFlips?.[0] !== -1) {
    throw new Error(`splat correction crop edit reset axis flip: ${JSON.stringify(evidence)}`);
  }
  const cropToggleVisual = evidence.sceneAfterCropToggle?.transform;
  if (!cropToggleVisual || Math.abs(cropToggleVisual.scale?.[0] + 1.1) > 1e-6) {
    throw new Error(`splat correction crop edit dropped flipped preview scale: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.cropMode?.targetAttached
      || evidence.cropMode?.editMode !== 'crop'
      || evidence.cropMode?.transformTargetName !== 'splat-correction-crop-target'
      || !evidence.cropMode?.cropBoxVisible) {
    throw new Error(`splat correction crop mode did not attach crop target: ${JSON.stringify(evidence)}`);
  }
  if (evidence.cropMode?.cropTargetParentName !== 'splat-visual-root'
      || evidence.cropEdit?.cropTargetParentName !== 'splat-visual-root'
      || evidence.modeAfterSave?.cropTargetParentName !== 'splat-visual-root') {
    throw new Error(`splat correction crop box was not parented in the preview crop frame: ${JSON.stringify(evidence)}`);
  }
  const cropEditCorrection = evidence.cropEdit?.draftCorrection || evidence.sceneAfterCropEdit?.splat?.correction || null;
  if (!cropEditCorrection?.crop?.enabled
      || Math.abs(cropEditCorrection.crop.min?.[0] + 0.2) > 1e-6
      || Math.abs(cropEditCorrection.crop.max?.[0] - 0.2) > 1e-6
      || Math.abs(cropEditCorrection.crop.min?.[2] - 0.8) > 1e-6
      || Math.abs(cropEditCorrection.crop.max?.[2] - 1.2) > 1e-6) {
    throw new Error(`splat correction crop mode did not update crop bounds: ${JSON.stringify(evidence)}`);
  }
  const afterCropEdit = evidence.sceneAfterCropEdit?.sceneTransform;
  const cropEditPreservedSceneTransform = Array.isArray(afterCropEdit?.position)
    && before.position.every((value, index) => Math.abs(value - afterCropEdit.position[index]) < 1e-6)
    && before.rotation.every((value, index) => Math.abs(value - afterCropEdit.rotation[index]) < 1e-6)
    && before.scale.every((value, index) => Math.abs(value - afterCropEdit.scale[index]) < 1e-6);
  if (!cropEditPreservedSceneTransform) {
    throw new Error(`splat correction crop mode dirtied scene transform: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.previewAfterClose
      || evidence.previewAfterClose.includedPointCount !== 1
      || evidence.previewAfterClose.excludedPointCount !== 5
      || evidence.previewAfterClose.excludedVisible !== false) {
    throw new Error(`splat correction crop preview did not hide outside points: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.cropEditPreview
      || evidence.cropEditPreview.includedPointCount !== 1
      || evidence.cropEditPreview.excludedPointCount !== 5
      || evidence.cropEditPreview.excludedVisible !== true
      || !(evidence.cropEditPreview.excludedOpacity < evidence.cropEditPreview.includedOpacity)) {
    throw new Error(`splat correction crop preview did not show edit context: ${JSON.stringify(evidence)}`);
  }
  const savedCorrection = evidence.savedAssetEntry?.correction || null;
  if (!savedCorrection
      || Math.abs(savedCorrection.centroidOffset?.[0] - 0.2) > 1e-6
      || Math.abs(savedCorrection.centroidOffset?.[2] - 0.4) > 1e-6
      || Math.abs(savedCorrection.orientation?.rotation?.[1] - 0.1) > 1e-6
      || evidence.modeAfterSave?.dirty !== false) {
    throw new Error(`splat correction mode did not save draft: ${JSON.stringify(evidence)}`);
  }
  if (savedCorrection.axisFlips?.[0] !== -1 || evidence.saveResult?.correction?.axisFlips?.[0] !== -1) {
    throw new Error(`splat correction mode did not save axis flip: ${JSON.stringify(evidence)}`);
  }
}

async function runSplatCropFrameScenario(ws) {
  phase = 'scenario-splat-crop-frame';
  lastEvidence.splatCropFrame = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const ply = [
        'ply',
        'format ascii 1.0',
        'element vertex 6',
        'property float x',
        'property float y',
        'property float z',
        'property uchar red',
        'property uchar green',
        'property uchar blue',
        'end_header',
        '-1 0 0 255 80 80',
        '1 0 0 80 255 80',
        '0 -1 0 80 80 255',
        '0 1 0 255 220 80',
        '0 0 -1 255 80 220',
        '0 0 1 80 255 220',
      ].join('\\n') + '\\n';
      document.querySelector('[data-tab="greenroom"]').click();
      const file = new File([ply], 'Witness Crop Frame.PLY', { type: 'application/octet-stream' });
      const ingestResult = await window.kaminosIngestDroppedSplatFile(file, { clear: true });
      await wait(250);
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splat = sceneDebug.find(record => record.type === 'splat' && record.source === ingestResult?.entry?.source)
        || sceneDebug.find(record => record.type === 'splat');
      if (!splat) throw new Error('crop-frame scenario could not import splat');
      window.selectSceneObject(splat.id);
      const plannedSceneTransform = {
        position: [1.0, 0.25, -0.5],
        rotation: [0.4, -0.2, 0.1],
        scale: [1.1, 1.2, 1.3],
      };
      const sceneBeforeMode = window.kaminosSetSceneObjectTransform(splat.id, plannedSceneTransform);
      await window.enterSplatCorrectionMode(splat.id);
      window.kaminosSetSplatCorrectionDraftTransform({
        position: [0.2, 0.3, 0.4],
        rotation: [0.05, 0.1, 0.15],
        scale: [1, 1, 1],
      });
      window.kaminosToggleSplatCorrectionAxisFlip('x');
      const cropMode = await window.setSplatCorrectionEditMode('crop');
      const cropEdit = window.kaminosSetSplatCorrectionCropTransform({
        position: [0, 0, 1],
        scale: [0.4, 0.4, 0.4],
      });
      const cropEditPreview = window.kaminosSplatPreviewDebugState?.(splat.id) || null;
      const sceneAfterCropEdit = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      return {
        ingestResult: { entry: ingestResult?.entry || null },
        sceneBeforeMode,
        cropMode,
        cropEdit,
        cropEditPreview,
        sceneAfterCropEdit,
      };
    })()
  `, { timeoutMs: 30000 });

  const evidence = lastEvidence.splatCropFrame;
  if (evidence.cropMode?.cropTargetParentName !== 'splat-visual-root'
      || evidence.cropEdit?.cropTargetParentName !== 'splat-visual-root') {
    throw new Error(`splat correction crop box was not parented in the preview crop frame: ${JSON.stringify(evidence)}`);
  }
  const cropTransform = evidence.cropEdit?.cropTargetTransform || {};
  if (!Array.isArray(cropTransform.position)
      || Math.abs(cropTransform.position[0]) > 1e-6
      || Math.abs(cropTransform.position[1]) > 1e-6
      || Math.abs(cropTransform.position[2] - 1) > 1e-6
      || Math.abs(cropTransform.scale?.[0] - 0.4) > 1e-6
      || Math.abs(cropTransform.scale?.[1] - 0.4) > 1e-6
      || Math.abs(cropTransform.scale?.[2] - 0.4) > 1e-6) {
    throw new Error(`splat correction crop box did not keep local crop transform: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.cropEditPreview
      || evidence.cropEditPreview.includedPointCount !== 1
      || evidence.cropEditPreview.excludedPointCount !== 5
      || evidence.cropEditPreview.excludedVisible !== true) {
    throw new Error(`splat correction crop frame did not match preview crop predicate: ${JSON.stringify(evidence)}`);
  }
  const afterCropEdit = evidence.sceneAfterCropEdit?.sceneTransform;
  const before = evidence.sceneBeforeMode?.sceneTransform;
  const cropEditPreservedSceneTransform = Array.isArray(afterCropEdit?.position)
    && before.position.every((value, index) => Math.abs(value - afterCropEdit.position[index]) < 1e-6)
    && before.rotation.every((value, index) => Math.abs(value - afterCropEdit.rotation[index]) < 1e-6)
    && before.scale.every((value, index) => Math.abs(value - afterCropEdit.scale[index]) < 1e-6);
  if (!cropEditPreservedSceneTransform) {
    throw new Error(`splat correction crop frame dirtied scene transform: ${JSON.stringify(evidence)}`);
  }
}

async function runAoRouteDeltaScenario(ws) {
  phase = 'scenario-ao-route-delta-on';
  lastEvidence.aoRouteDelta = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitForAo = async () => {
        for (let i = 0; i < 120; i++) {
          if (typeof window.kaminosAODebugState === 'function') {
            const state = window.kaminosAODebugState();
            if (state?.hasRenderPipeline && state?.hasAoPass && state?.hasAoIntensity) return state;
          }
          await wait(125);
        }
        throw new Error('AO debug state did not expose the managed RenderPipeline route');
      };
      const waitForObject = async () => {
        for (let i = 0; i < 120; i++) {
          const rows = [...document.querySelectorAll('[data-scene-object-id]')];
          if (rows.length > 0) return rows.length;
          await wait(125);
        }
        const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
        if (!demo) throw new Error('AO witness could not find the SuperMat Ring demo button');
        demo.click();
        for (let i = 0; i < 120; i++) {
          const rows = [...document.querySelectorAll('[data-scene-object-id]')];
          if (rows.length > 0) return rows.length;
          await wait(125);
        }
        throw new Error('AO witness did not load a scene object');
      };
      const setRange = (id, value) => {
        const el = document.getElementById(id);
        if (!el) throw new Error('AO control missing: ' + id);
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const setToggle = value => {
        const el = document.getElementById('ao-toggle');
        if (!el) throw new Error('AO toggle missing');
        el.checked = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const objectCount = await waitForObject();
      const initialState = await waitForAo();
      if (initialState.route !== 'three-tsl-render-pipeline-gtao-compute') {
        throw new Error('AO route is not the managed TSL route: ' + JSON.stringify(initialState));
      }
      if (initialState.rawPipelineActive) {
        throw new Error('raw AO pipeline reported active: ' + JSON.stringify(initialState));
      }
      setRange('ao-radius', 4.0);
      setRange('ao-scale', 1.62);
      setRange('ao-thickness', 1.81);
      setRange('ao-falloff', 0.74);
      setRange('ao-intensity', 2.25);
      setToggle(true);
      window._kaminosDirty?.();
      await wait(1400);
      const stateOn = window.kaminosAODebugState();
      if (!stateOn.hasRenderPipeline || !stateOn.hasAoPass || stateOn.intensity <= 2.0) {
        throw new Error('AO on state did not take: ' + JSON.stringify(stateOn));
      }
      return {
        objectCount,
        initialState,
        stateOn,
        info: document.getElementById('info-bar')?.textContent?.trim() || null,
        rendererCanvasSize: {
          width: document.querySelector('canvas')?.width || null,
          height: document.querySelector('canvas')?.height || null,
        },
      };
    })()
  `, { timeoutMs: 45000 });

  const onShot = await capturePngScreenshot(ws, siblingPngPath('-ao-on'));

  phase = 'scenario-ao-route-delta-off';
  const offEvidence = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const toggle = document.getElementById('ao-toggle');
      if (!toggle) throw new Error('AO toggle missing for off capture');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      window._kaminosDirty?.();
      await wait(1400);
      const stateOff = window.kaminosAODebugState?.();
      if (!stateOff || stateOff.intensity !== 0) {
        throw new Error('AO off state did not bypass intensity: ' + JSON.stringify(stateOff));
      }
      return { stateOff };
    })()
  `, { timeoutMs: 20000 });

  const offShot = await capturePngScreenshot(ws, siblingPngPath('-ao-off'));

  phase = 'scenario-ao-route-delta-restore-on';
  const restoreEvidence = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const toggle = document.getElementById('ao-toggle');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      window._kaminosDirty?.();
      await wait(900);
      return { stateRestored: window.kaminosAODebugState?.() };
    })()
  `, { timeoutMs: 20000 });

  lastEvidence.aoRouteDelta = {
    ...lastEvidence.aoRouteDelta,
    ...offEvidence,
    ...restoreEvidence,
    onShot,
    offShot,
  };
}

let chromeProcess = null;
let ws = null;

try {
  phase = 'checking-debug-port';
  if (await isCdpEndpointOpen()) {
    throw new Error(`CDP debug port already in use before launch: ${port}`);
  }

  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...(headless ? ['--headless=new'] : ['--no-first-run', '--no-default-browser-check', '--disable-extensions']),
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--window-size=1468,960',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const chromeLaunchSignal = new Promise(resolveLaunch => {
    chromeProcess.once('error', error => resolveLaunch({ error }));
    chromeProcess.once('exit', (code, signal) => resolveLaunch({ exit: { code, signal } }));
  });

  phase = 'waiting-for-cdp';
  const launchResult = await Promise.race([
    waitForCdp().then(version => ({ version })),
    chromeLaunchSignal,
  ]);
  if (launchResult.error) {
    throw new Error(`Chrome launch failed: ${launchResult.error.message}`);
  }
  if (launchResult.exit) {
    throw new Error(`Chrome exited before DevTools opened: ${JSON.stringify(launchResult.exit)}`);
  }
  browserVersion = launchResult.version;

  phase = 'opening-target';
  const targets = await cdpFetch('/json/list');
  const target = targets.find(t => t.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Page.bringToFront');
  await delay(settleMs);
  effectiveUrl = await evaluate(ws, 'location.href');
  const requestedHref = normalizeUrlForWitness(url);
  const effectiveHref = normalizeUrlForWitness(effectiveUrl);
  if (requestedHref !== effectiveHref) {
    throw new Error(`effective URL mismatch: requested ${requestedHref} but browser loaded ${effectiveHref}`);
  }
  phase = 'checking-server-root';
  effectiveServerRoots = await fetchServerRoots(effectiveHref);
  assertExpectedServerRoot(effectiveServerRoots);

  if (scenario === 'startup-empty') {
    await runStartupEmptyScenario(ws);
  } else if (scenario === 'world-chambers-lerms-underhill') {
    await runWorldChambersLermsUnderhillScenario(ws);
  } else if (scenario === 'world-chambers-lerms-underhill-receipt-url') {
    await runWorldChambersLermsUnderhillReceiptUrlScenario(ws);
  } else if (scenario === 'lerms-preview-bench-terrain') {
    await runLermsPreviewBenchTerrainScenario(ws);
  } else if (scenario === 'lerms-preview-bench-actor-motion') {
    await runLermsPreviewBenchActorMotionScenario(ws);
  } else if (scenario === 'preview-bench-payload-contract') {
    await runPreviewBenchPayloadContractScenario(ws);
  } else if (scenario === 'lerms-preview-bench-actor-motion-timeline') {
    await runLermsPreviewBenchActorMotionTimelineScenario(ws);
  } else if (scenario === 'append-select-remove-keyboard') {
    await runAppendSelectRemoveKeyboardScenario(ws);
  } else if (scenario === 'selected-delete-shortcut') {
    await runSelectedDeleteShortcutScenario(ws);
  } else if (scenario === 'save-load-roundtrip') {
    await runSaveLoadRoundtripScenario(ws);
  } else if (scenario === 'transform-inspector') {
    await runTransformInspectorScenario(ws);
  } else if (scenario === 'object-groups-roundtrip') {
    await runObjectGroupsRoundtripScenario(ws);
  } else if (scenario === 'scene-boundary-roundtrip') {
    await runSceneBoundaryRoundtripScenario(ws);
  } else if (scenario === 'greenroom-picker-display') {
    await runGreenroomPickerDisplayScenario(ws);
  } else if (scenario === 'greenroom-preview-race') {
    await runGreenroomPreviewRaceScenario(ws);
  } else if (scenario === 'greenroom-splat-handoff') {
    await runGreenroomSplatHandoffScenario(ws);
  } else if (scenario === 'hybrid-splat-overlay') {
    await runHybridSplatOverlayScenario(ws);
  } else if (scenario === 'selected-splat-bake-layer') {
    await runSelectedSplatBakeLayerScenario(ws);
  } else if (scenario === 'real-hybrid-splat-overlay') {
    await runRealHybridSplatOverlayScenario(ws);
  } else if (scenario === 'hybrid-host-depth-occluder') {
    await runHybridHostDepthOccluderScenario(ws);
  } else if (scenario === 'hybrid-two-splat-depth-order') {
    await runHybridTwoSplatDepthOrderScenario(ws);
  } else if (scenario === 'hybrid-live-import-scene-membership') {
    await runHybridLiveImportSceneMembershipScenario(ws);
  } else if (scenario === 'real-hybrid-cropped-unsupported-guard') {
    await runRealHybridCroppedUnsupportedGuardScenario(ws);
  } else if (scenario === 'real-hybrid-cropped-supported-overlay') {
    await runRealHybridCroppedSupportedOverlayScenario(ws);
  } else if (scenario === 'real-saved-splat-crop-visibility') {
    await runRealSavedSplatCropVisibilityScenario(ws);
  } else if (scenario === 'splat-asset-inbox') {
    await runSplatAssetInboxScenario(ws);
  } else if (scenario === 'splat-direct-drop-ingest') {
    await runSplatDirectDropIngestScenario(ws);
  } else if (scenario === 'splat-correction-sidecar') {
    await runSplatCorrectionSidecarScenario(ws);
  } else if (scenario === 'splat-correction-mode') {
    await runSplatCorrectionModeScenario(ws);
  } else if (scenario === 'splat-crop-frame') {
    await runSplatCropFrameScenario(ws);
  } else if (scenario === 'ao-route-delta') {
    await runAoRouteDeltaScenario(ws);
  } else if (scenario === 'mesh-asset-link') {
    await runMeshAssetLinkScenario(ws);
  } else if (scenario === 'splat-asset-link') {
    await runSplatAssetLinkScenario(ws);
  } else if (scenario === 'hybrid-renderer-module-wrong-server') {
    await runHybridRendererModuleWrongServerScenario(ws);
  } else if (scenario === 'hybrid-renderer-default-package-route') {
    await runHybridRendererDefaultPackageRouteScenario(ws);
  } else if (scenario === 'image-asset-link') {
    await runImageAssetLinkScenario(ws);
  } else if (scenario === 'forge-host-smoke-offers') {
    await runForgeHostSmokeOffersScenario(ws);
  } else if (scenario === 'forge-host-live-registry') {
    await runForgeHostLiveRegistryScenario(ws);
  } else if (scenario === 'forge-host-smoke-chamber-routing') {
    await runForgeHostSmokeChamberRoutingScenario(ws);
  } else if (scenario === 'viewport-click-select-deselect') {
    await runViewportClickSelectDeselectScenario(ws);
  } else if (scenario === 'splat-viewport-empty-deselect') {
    await runSplatViewportEmptyDeselectScenario(ws);
  } else {
    throw new Error(`Unsupported scene object witness scenario: ${scenario}`);
  }

  phase = 'capturing-screenshot';
  const finalShot = await capturePngScreenshot(ws, out);
  phase = 'validating-screenshot';
  if (scenario === 'real-hybrid-splat-overlay' || scenario === 'hybrid-host-depth-occluder' || scenario === 'hybrid-two-splat-depth-order' || scenario === 'hybrid-renderer-controls-dropdown') {
    assertRealHybridScreenshotVisible(out);
  }

  phase = 'writing-report';
  const report = {
    ok: true,
    screenshot: out,
    screenshotBytes: finalShot.bytes,
    evidence: lastEvidence,
  };
  writeReport(report);
  console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
} catch (error) {
  let failureShot = null;
  try {
    if (ws) {
      phase = 'capturing-failure-screenshot';
      failureShot = await capturePngScreenshot(ws, out);
    }
  } catch (captureError) {
    failureShot = { path: null, bytes: 0, error: String(captureError?.message || captureError) };
  }
  writeReport({
    ok: false,
    error: error.stack || String(error),
    screenshot: failureShot?.path || null,
    screenshotBytes: failureShot?.bytes || 0,
    screenshotError: failureShot?.error || null,
    evidence: lastEvidence,
  });
  throw error;
} finally {
  try { ws?.close?.(); } catch {}
  chromeProcess?.kill('SIGTERM');
}

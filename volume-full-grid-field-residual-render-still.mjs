#!/usr/bin/env node
import { createHash, randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.full-grid-field-residual-render-still.v0';
const APPLICATION_SCHEMA = 'kaminos.volume.full-grid-field-residual-application.v0';
const CHANNEL_ABLATION_SCHEMA = 'kaminos.volume.full-grid-field-channel-ablation-matrix.v0';
const LIMITATION = 'full-grid-buffer-render-override-not-selected-tiles';
const TEMPORAL_STRIP_IDENTITY = 'full-grid-field-residual-temporal-dynamics-strip-v0';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const next = process.argv[index + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, true);
  }
}

const applicationManifestPath = resolve(String(args.get('--application-manifest') || ''));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-full-grid-field-residual-render-still'));
const manifestOut = resolve(String(args.get('--out') || join(outDir, 'manifest.json')));
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = String(args.get('--user-data-dir') || mkdtempSync('/tmp/kaminos-full-grid-render-profile-'));
const windowSize = String(args.get('--window-size') || '1024,1024');
const settleMs = Number(args.get('--settle-ms') || 2500);
const chunkBytes = Math.max(4096, Math.floor(Number(args.get('--chunk-bytes') || 262144)));
const temporalStripFrameCount = Math.max(0, Math.floor(Number(args.get('--temporal-strip-frame-count') || 0)));
const temporalStripStepMs = Math.max(0, Number(args.get('--temporal-strip-step-ms') || (1000 / 60)));

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${debugPort}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function launchBrowser(url) {
  return spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });
}

async function closeBrowser(browser) {
  try {
    await fetch(`http://127.0.0.1:${debugPort}/json/close`);
  } catch {}
  browser?.kill('SIGTERM');
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
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression, phase) {
  const response = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(`${phase}: ${JSON.stringify(response.exceptionDetails)}`);
  if (response.result?.subtype === 'error') throw new Error(`${phase}: ${JSON.stringify(response.result)}`);
  return response.result.value;
}

async function connectPage(url) {
  const targets = await cdpFetch('/json/list');
  const page = targets.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1')) || targets.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Page.navigate', { url });
  return ws;
}

async function waitForVolume(ws) {
  await delay(settleMs);
  let state = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    state = await evaluate(ws, 'window.__kaminosVolumePrototype?.debugState?.()', 'debug-state');
    if (state?.active && state.width > 0 && state.height > 0 && state.frameCount > 0) return state;
    await delay(250);
  }
  throw new Error(`volume prototype did not become active: ${JSON.stringify(state)}`);
}

async function captureReplay(ws, replay) {
  const options = { steps: replay.steps, timeStepMs: replay.timeStepMs, startTimeMs: replay.startTimeMs };
  await evaluate(ws, 'window.__kaminosVolumePrototype.setActive(false)', 'set-inactive-before-replay');
  const sample = await evaluate(ws, `window.__kaminosVolumePrototype.sampleDeterministicReplayFrame(${JSON.stringify(options)})`, 'sampleDeterministicReplayFrame');
  await evaluate(ws, 'window.__kaminosVolumePrototype.setActive(false)', 'set-inactive-after-replay');
  if (sample?.ok !== true) throw new Error(`deterministic replay failed: ${JSON.stringify(sample)}`);
  return sample;
}

async function captureNoAdvance(ws, replay) {
  const finalTimeMs = replay.startTimeMs + Math.max(0, replay.steps - 1) * replay.timeStepMs;
  const sample = await evaluate(ws, `window.__kaminosVolumePrototype.sampleFrame(${JSON.stringify({ allowInactive: true, advanceSim: false, nowMs: finalTimeMs })})`, 'sampleFrame-no-advance');
  if (sample?.ok !== true) throw new Error(`sampleFrame failed: ${JSON.stringify(sample)}`);
  return sample;
}

async function captureTemporalDynamicsStrip(ws, replay, roleName, frameCount) {
  const frames = [];
  const finalTimeMs = replay.startTimeMs + Math.max(0, replay.steps - 1) * replay.timeStepMs;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const request = {
      allowInactive: true,
      advanceSim: frameIndex > 0,
      nowMs: finalTimeMs + frameIndex * temporalStripStepMs,
    };
    const sample = await evaluate(
      ws,
      `window.__kaminosVolumePrototype.sampleFrame(${JSON.stringify(request)})`,
      `sampleFrame-temporal-dynamics-${roleName}-${frameIndex}`,
    );
    if (sample?.ok !== true) throw new Error(`temporal dynamics sample failed for ${roleName}/${frameIndex}: ${JSON.stringify(sample)}`);
    frames.push({
      frameIndex,
      role: roleName,
      sample,
      width: sample.preview.width,
      height: sample.preview.height,
      rgba: sample.preview.rgba,
    });
  }
  return frames;
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function writeRgbaPng(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function pasteRgba(target, targetWidth, source, sourceWidth, sourceHeight, offsetX, offsetY) {
  for (let y = 0; y < sourceHeight; y += 1) {
    const dst = ((offsetY + y) * targetWidth + offsetX) * 4;
    const src = y * sourceWidth * 4;
    target.set(source.slice(src, src + sourceWidth * 4), dst);
  }
}

const LABEL_FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
};

function drawRect(rgba, width, height, x, y, rectWidth, rectHeight, color) {
  const [r, g, b, a] = color;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + rectWidth));
  const y1 = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const offset = (py * width + px) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = a;
    }
  }
}

function drawLabelText(rgba, width, height, text, x, y, options = {}) {
  const scale = Math.max(1, Math.floor(Number(options.scale || 2)));
  const color = options.color || [232, 244, 244, 255];
  const shadow = options.shadow || [0, 0, 0, 255];
  const normalized = String(text || '').toUpperCase();
  let cursor = Math.floor(x);
  const top = Math.floor(y);
  for (const char of normalized) {
    if (char === ' ') {
      cursor += 4 * scale;
      continue;
    }
    const glyph = LABEL_FONT[char] || LABEL_FONT['-'];
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] !== '1') continue;
        drawRect(rgba, width, height, cursor + gx * scale + 1, top + gy * scale + 1, scale, scale, shadow);
        drawRect(rgba, width, height, cursor + gx * scale, top + gy * scale, scale, scale, color);
      }
    }
    cursor += 6 * scale;
  }
  return { text, x: Math.floor(x), y: top, scale };
}

function buildLabeledContactSheet(frames) {
  const frameWidth = frames[0].width;
  const frameHeight = frames[0].height;
  const labelHeight = 24;
  const width = frameWidth * frames.length;
  const height = frameHeight + labelHeight;
  const sheet = new Uint8Array(width * height * 4);
  drawRect(sheet, width, height, 0, 0, width, height, [0, 0, 0, 255]);
  const labels = [];
  frames.forEach((frame, index) => {
    const offsetX = frameWidth * index;
    pasteRgba(sheet, width, frame.rgba, frame.width, frame.height, offsetX, labelHeight);
    labels.push(drawLabelText(sheet, width, height, frame.displayLabel || frame.role, offsetX + 8, 6, { scale: 2 }));
  });
  return {
    rgba: sheet,
    width,
    height,
    visibleRasterLabels: {
      identity: 'visible-raster-role-labels-v0',
      columnLabels: labels,
    },
  };
}

function renderedRoleMetrics(truthFrame, frame) {
  if (!truthFrame || !frame || truthFrame.width !== frame.width || truthFrame.height !== frame.height) {
    return {
      status: 'skipped',
      reason: 'frame-shape-mismatch',
      truthShape: truthFrame ? [truthFrame.width, truthFrame.height] : null,
      roleShape: frame ? [frame.width, frame.height] : null,
    };
  }
  let sumAbs = 0;
  let sumSq = 0;
  let maskedAbs = 0;
  let maskedChannels = 0;
  let rbAbs = 0;
  let rbTruthSum = 0;
  let rbRoleSum = 0;
  let rbTruthSq = 0;
  let rbRoleSq = 0;
  let rbCross = 0;
  const pixels = truthFrame.width * truthFrame.height;
  const channels = pixels * 3;
  for (let offset = 0; offset < pixels * 4; offset += 4) {
    const tr = Number(truthFrame.rgba[offset]) / 255;
    const tg = Number(truthFrame.rgba[offset + 1]) / 255;
    const tb = Number(truthFrame.rgba[offset + 2]) / 255;
    const rr = Number(frame.rgba[offset]) / 255;
    const rg = Number(frame.rgba[offset + 1]) / 255;
    const rb = Number(frame.rgba[offset + 2]) / 255;
    const diffs = [rr - tr, rg - tg, rb - tb];
    for (const diff of diffs) {
      sumAbs += Math.abs(diff);
      sumSq += diff * diff;
    }
    const truthSignal = Math.max(tr, tg, tb);
    if (truthSignal > 0.08) {
      maskedAbs += Math.abs(rr - tr) + Math.abs(rg - tg) + Math.abs(rb - tb);
      maskedChannels += 3;
    }
    const truthRedBlue = tr - tb;
    const roleRedBlue = rr - rb;
    const redBlueDiff = roleRedBlue - truthRedBlue;
    rbAbs += Math.abs(redBlueDiff);
    rbTruthSum += truthRedBlue;
    rbRoleSum += roleRedBlue;
    rbTruthSq += truthRedBlue * truthRedBlue;
    rbRoleSq += roleRedBlue * roleRedBlue;
    rbCross += truthRedBlue * roleRedBlue;
  }
  const rbNumerator = rbCross - (rbTruthSum * rbRoleSum) / Math.max(1, pixels);
  const rbTruthVar = rbTruthSq - (rbTruthSum * rbTruthSum) / Math.max(1, pixels);
  const rbRoleVar = rbRoleSq - (rbRoleSum * rbRoleSum) / Math.max(1, pixels);
  const redBlueCorrelation = rbTruthVar > 1e-12 && rbRoleVar > 1e-12
    ? rbNumerator / Math.sqrt(rbTruthVar * rbRoleVar)
    : null;
  return {
    status: 'computed',
    mae: sumAbs / Math.max(1, channels),
    rmse: Math.sqrt(sumSq / Math.max(1, channels)),
    maskedMae: maskedChannels > 0 ? maskedAbs / maskedChannels : null,
    truthSignalMaskThreshold: 0.08,
    truthSignalMaskedChannelCount: maskedChannels,
    redBlueMae: rbAbs / Math.max(1, pixels),
    redBlueCorrelation,
  };
}

function renderComparisonMetrics(frames) {
  const truthFrame = frames.find(frame => frame.role === 'truthHigh');
  return {
    identity: 'rendered-role-pixel-comparison-metrics-v0',
    baselineRole: 'truthHigh',
    limitation: 'Pixel metrics compare rendered witness PNG buffers for this route and are diagnostic only; field sidecar metrics remain the field-truth authority.',
    roles: frames
      .filter(frame => frame.role !== 'truthHigh')
      .map(frame => ({
        role: frame.role,
        metrics: renderedRoleMetrics(truthFrame, frame),
      })),
  };
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fileName(path) {
  return String(path).split('/').pop();
}

function writeTemporalStripViewer(path, temporalStrip, report) {
  const imageName = fileName(temporalStrip.contactSheet.path);
  const rows = temporalStrip.rows.map(row => `<tr><td>${htmlEscape(row.role)}</td><td>${htmlEscape(row.label)}</td><td>${row.frames.map(frame => `#${frame.frameIndex}`).join(', ')}</td></tr>`).join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Kaminos full-grid residual temporal dynamics strip</title>
<style>
body { margin: 24px; background: #090b0c; color: #dfe8e8; font: 14px/1.45 system-ui, sans-serif; }
img { max-width: 100%; image-rendering: auto; border: 1px solid #2c3436; }
table { border-collapse: collapse; margin: 16px 0; }
td, th { border: 1px solid #30383a; padding: 6px 10px; }
.muted { color: #91a0a3; }
code { color: #ffd08a; }
</style>
<h1>Full-grid residual temporal dynamics strip</h1>
<p><strong>Rows:</strong> ${htmlEscape(temporalStrip.rowOrder.join(', '))}. <strong>Columns:</strong> initialized field at frame 0, then simulator-advanced frames. This is not per-frame model prediction.</p>
<p class="muted">Identity: <code>${htmlEscape(temporalStrip.identity)}</code>. Application: <code>${htmlEscape(report.applicationManifest)}</code>.</p>
<img src="${htmlEscape(imageName)}" alt="Rows are ${htmlEscape(temporalStrip.rowOrder.join(', '))}; columns are temporal dynamics frames">
<table>
<thead><tr><th>Role</th><th>Label</th><th>Frames</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="muted">${htmlEscape(temporalStrip.limitation)}</p>
`;
  writeFileSync(path, html);
}

function resolveRolePath(descriptor) {
  return resolve(String(descriptor?.path || ''));
}

function verifyRoleSidecar(role, kind, descriptor) {
  const path = resolveRolePath(descriptor);
  const bytes = readFileSync(path);
  if (bytes.byteLength !== Number(descriptor.byteLength)) {
    throw new Error(`${role}.${kind} byte length mismatch`);
  }
  const actualSha = sha256File(path);
  if (descriptor.sha256 && descriptor.sha256 !== actualSha) {
    throw new Error(`${role}.${kind} sha256 mismatch`);
  }
  return { path, bytes };
}

async function streamRoleSidecar(ws, sessionId, role, kind, descriptor) {
  const { path, bytes } = verifyRoleSidecar(role, kind, descriptor);
  let chunkCount = 0;
  for (let byteOffset = 0; byteOffset < bytes.byteLength; byteOffset += chunkBytes) {
    const chunk = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + chunkBytes));
    const result = await evaluate(
      ws,
      `window.__kaminosVolumePrototype.writeDebugFullFieldBufferOverrideChunk(${JSON.stringify({
        sessionId,
        role,
        kind,
        byteOffset,
        base64: chunk.toString('base64'),
      })})`,
      `writeDebugFullFieldBufferOverrideChunk-${role}-${kind}`,
    );
    if (result?.ok !== true) throw new Error(`full buffer chunk write failed: ${JSON.stringify(result)}`);
    chunkCount += 1;
  }
  return { path, chunkCount, byteLength: bytes.byteLength };
}

async function applyFullGridRole(ws, applicationManifest, roleName, role) {
  const begin = await evaluate(
    ws,
    `window.__kaminosVolumePrototype.beginDebugFullFieldBufferOverride(${JSON.stringify({
      role: roleName,
      grid: applicationManifest.highGrid,
      sourceApplicationManifest: applicationManifestPath,
      sourceFieldAuthority: applicationManifest.fieldAuthority,
      fluid: role.fluid,
      front: role.front,
    })})`,
    `beginDebugFullFieldBufferOverride-${roleName}`,
  );
  if (begin?.ok !== true) throw new Error(`full buffer override begin failed: ${JSON.stringify(begin)}`);
  const fluid = await streamRoleSidecar(ws, begin.sessionId, roleName, 'fluid', role.fluid);
  const front = await streamRoleSidecar(ws, begin.sessionId, roleName, 'front', role.front);
  const finish = await evaluate(
    ws,
    `window.__kaminosVolumePrototype.finishDebugFullFieldBufferOverride(${JSON.stringify({ sessionId: begin.sessionId, role: roleName })})`,
    `finishDebugFullFieldBufferOverride-${roleName}`,
  );
  if (finish?.ok !== true || finish.status !== 'applied') {
    throw new Error(`full buffer override finish failed: ${JSON.stringify(finish)}`);
  }
  return { begin, fluid, front, finish };
}

function routeForApplication(application) {
  if (args.get('--url')) return String(args.get('--url'));
  const pair = readJson(application.pairManifest);
  const highManifest = readJson(pair.highManifest);
  if (!highManifest.url) throw new Error('No --url and high full-grid export manifest has no url');
  return String(highManifest.url);
}

function replayForApplication(application) {
  const replay = application.deterministicReplay?.high || application.deterministicReplay;
  if (!replay) throw new Error('Application manifest has no deterministic replay metadata');
  return {
    steps: Number(replay.steps || 30),
    timeStepMs: Number(replay.timeStepMs || 1000 / 60),
    startTimeMs: Number(replay.startTimeMs || 1000),
  };
}

function roleSidecarBytesMatchTruth(application, roleName) {
  const truth = application.roles?.truthHigh;
  const role = application.roles?.[roleName];
  return Boolean(
    truth?.fluid?.sha256 &&
    truth?.front?.sha256 &&
    role?.fluid?.sha256 === truth.fluid.sha256 &&
    role?.front?.sha256 === truth.front.sha256
  );
}

function buildByteIdenticalOverrideSanity(application, outputs) {
  const truthOutput = outputs.find(output => output.role === 'truthHigh') || null;
  const checks = outputs
    .filter(output => output.role !== 'truthHigh')
    .map(output => {
      const sidecarBytesMatchTruth = roleSidecarBytesMatchTruth(application, output.role);
      const exactPngMatchesTruth = Boolean(sidecarBytesMatchTruth && truthOutput && output.sha256 === truthOutput.sha256);
      const sample = output.sample || {};
      const truthSample = truthOutput?.sample || {};
      const fireLikePixels = Number(sample.fireLikePixels ?? 0);
      const truthFireLikePixels = Number(truthSample.fireLikePixels ?? 0);
      const smokeLikePixels = Number(sample.smokeLikePixels ?? 0);
      const truthSmokeLikePixels = Number(truthSample.smokeLikePixels ?? 0);
      const fireEdgeEnergy = Number(sample.fireEdgeEnergy ?? 0);
      const truthFireEdgeEnergy = Number(truthSample.fireEdgeEnergy ?? 0);
      const fireLikeDelta = Number(sample.fireLikePixels ?? 0) - Number(truthSample.fireLikePixels ?? 0);
      const smokeLikeDelta = Number(sample.smokeLikePixels ?? 0) - Number(truthSample.smokeLikePixels ?? 0);
      const fireEdgeEnergyDelta = Number(sample.fireEdgeEnergy ?? 0) - Number(truthSample.fireEdgeEnergy ?? 0);
      const fireLikeRatio = truthFireLikePixels > 0 ? fireLikePixels / truthFireLikePixels : (fireLikePixels > 0 ? 1 : 0);
      const smokeLikeRatio = truthSmokeLikePixels > 0 ? smokeLikePixels / truthSmokeLikePixels : (smokeLikePixels > 0 ? 1 : 0);
      const fireEdgeEnergyRatio = truthFireEdgeEnergy > 0 ? fireEdgeEnergy / truthFireEdgeEnergy : (fireEdgeEnergy > 0 ? 1 : 0);
      const fireSignatureMatchesTruth = Boolean(
        sidecarBytesMatchTruth &&
        truthOutput &&
        (
          exactPngMatchesTruth ||
          (
            fireLikeRatio >= 0.50 &&
            fireEdgeEnergyRatio >= 0.75 &&
            smokeLikeRatio >= 0.65 &&
            smokeLikeRatio <= 1.45
          )
        )
      );
      return {
        role: output.role,
        identity: sidecarBytesMatchTruth && !exactPngMatchesTruth && !fireSignatureMatchesTruth
          ? 'override-equivalence-mismatch-v0'
          : 'override-equivalence-check-v0',
        sidecarBytesMatchTruth,
        exactPngMatchesTruth,
        renderPngMatchesTruth: exactPngMatchesTruth,
        fireSignatureMatchesTruth,
        outputSha256: output.sha256,
        truthSha256: truthOutput?.sha256 || null,
        fireLikeRatio,
        smokeLikeRatio,
        fireEdgeEnergyRatio,
        fireLikeDelta,
        smokeLikeDelta,
        fireEdgeEnergyDelta,
      };
    });
  const mismatches = checks.filter(check => check.sidecarBytesMatchTruth && !check.fireSignatureMatchesTruth);
  const exactPixelMismatches = checks.filter(check => check.sidecarBytesMatchTruth && !check.exactPngMatchesTruth);
  return {
    identity: 'byte-identical-full-buffer-override-sanity-v0',
    status: mismatches.length
      ? 'mismatch'
      : (exactPixelMismatches.length ? 'fire-signature-passed-exact-pixel-mismatch' : 'passed'),
    mismatchCount: mismatches.length,
    exactPixelMismatchCount: exactPixelMismatches.length,
    limitation: 'Byte-identical sidecars should preserve fire/smoke visual signature before channel-graft visuals can be trusted as model evidence; exact pixel equality is tracked separately because renderer-adjacent Pyro memory can be replay-warmed or static-field-warmed.',
    checks,
  };
}

function sampleMetrics(sample) {
  return {
    simGrid: sample.simGrid,
    simStepCount: sample.simStepCount,
    frameCount: sample.frameCount,
    fireLikePixels: sample.fireLikePixels,
    smokeLikePixels: sample.smokeLikePixels,
    fireEdgeEnergy: sample.fireEdgeEnergy,
    fullFieldBufferRenderOverride: sample.fullFieldBufferRenderOverride,
  };
}

function renderRoleOrder(application) {
  const ablationRoleOrder = application.channelAblationMatrix?.ablationRoleOrder;
  if (Array.isArray(ablationRoleOrder)) {
    return ablationRoleOrder.filter(roleName => roleName !== 'truthHigh' && application.roles?.[roleName]);
  }
  return ['lowUpsampled', 'naiveScalar', 'predictedHigh'].filter(roleName => application.roles?.[roleName]);
}

function roleRenderLabel(roleName) {
  if (roleName === 'lowUpsampled') return 'low-grid upsampled field initialized state';
  if (roleName === 'naiveScalar') return 'naive scalar-head assembled field initialized state';
  if (roleName === 'predictedHigh') return 'model predicted high-grid field initialized state';
  return `${roleName} initialized state`;
}

function displayLabelForRole(application, roleName) {
  const role = application.roles?.[roleName];
  return String(role?.displayLabel || roleName);
}

function buildTemporalStrip(temporalRows, outDir) {
  if (!temporalRows.length) return null;
  const frameWidth = temporalRows[0].frames[0].width;
  const frameHeight = temporalRows[0].frames[0].height;
  const frameCount = temporalRows[0].frames.length;
  const labelWidth = 220;
  const labelHeight = 24;
  const stripWidth = labelWidth + frameWidth * frameCount;
  const stripHeight = labelHeight + frameHeight * temporalRows.length;
  const sheet = new Uint8Array(stripWidth * stripHeight * 4);
  drawRect(sheet, stripWidth, stripHeight, 0, 0, stripWidth, stripHeight, [0, 0, 0, 255]);
  const rowLabels = [];
  const columnLabels = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    columnLabels.push(drawLabelText(sheet, stripWidth, stripHeight, `frame-${frameIndex}`, labelWidth + frameWidth * frameIndex + 8, 6, { scale: 2 }));
  }
  temporalRows.forEach((row, rowIndex) => {
    rowLabels.push(drawLabelText(sheet, stripWidth, stripHeight, row.role, 8, labelHeight + frameHeight * rowIndex + 8, { scale: 2 }));
    row.frames.forEach((frame, frameIndex) => {
      pasteRgba(sheet, stripWidth, frame.rgba, frame.width, frame.height, labelWidth + frameWidth * frameIndex, labelHeight + frameHeight * rowIndex);
    });
  });
  const contactSheet = resolve(outDir, 'temporal-dynamics-strip.png');
  writeRgbaPng(contactSheet, stripWidth, stripHeight, Array.from(sheet));
  return {
    identity: TEMPORAL_STRIP_IDENTITY,
    authority: 'initialized-full-grid-field-then-simulator-advanced-dynamics-v0',
    frameCount,
    stepMs: temporalStripStepMs,
    rowOrder: temporalRows.map(row => row.role),
    columnOrder: Array.from({ length: frameCount }, (_, index) => `frame-${index}`),
    visibleRasterLabels: {
      identity: 'visible-raster-row-column-labels-v0',
      rowLabels,
      columnLabels,
      labelWidth,
      labelHeight,
    },
    limitation: 'Temporal strip initializes each role from a complete field buffer and advances simulator dynamics after frame 0; it is not a per-frame residual model prediction or held-out temporal proof.',
    contactSheet: {
      path: contactSheet,
      sha256: sha256File(contactSheet),
    },
    rows: temporalRows.map(row => ({
      role: row.role,
      label: row.label,
      frames: row.frames.map(frame => ({
        frameIndex: frame.frameIndex,
        sample: sampleMetrics(frame.sample),
      })),
    })),
  };
}

function failureReport(phase, error, evidence = {}) {
  return {
    schema: SCHEMA,
    status: 'failed',
    createdAt: utcNow(),
    applicationManifest: applicationManifestPath,
    failurePhase: phase,
    error: String(error?.message || error),
    lastTrustworthyEvidence: evidence,
    limitation: LIMITATION,
  };
}

async function main() {
  let phase = 'args';
  let browser = null;
  let evidence = {};
  try {
    if (!applicationManifestPath) throw new Error('--application-manifest is required');
    mkdirSync(outDir, { recursive: true });
    phase = 'application-read';
    const application = readJson(applicationManifestPath);
    if (application.schema !== APPLICATION_SCHEMA && application.diagnosticSchema !== CHANNEL_ABLATION_SCHEMA) {
      throw new Error(`application schema mismatch: ${application.schema}`);
    }
    const route = routeForApplication(application);
    const replay = replayForApplication(application);
    evidence = { route, replay, highGrid: application.highGrid };

    phase = 'browser-launch';
    browser = launchBrowser(route);
    await waitForCdp();
    phase = 'browser-connect';
    const ws = await connectPage(route);
    phase = 'volume-load';
    const initialState = await waitForVolume(ws);

    const frames = [];
    const outputs = [];
    const temporalRows = [];
    phase = 'truthHigh';
    const truthReplay = await captureReplay(ws, replay);
    const truthTemporalFrames = temporalStripFrameCount > 1
      ? await captureTemporalDynamicsStrip(ws, replay, 'truthHigh', temporalStripFrameCount)
      : [];
    if (truthTemporalFrames.length) {
      temporalRows.push({ role: 'truthHigh', label: 'true high-grid replay initialized state', frames: truthTemporalFrames });
    }
    const truthSample = truthTemporalFrames[0]?.sample || await captureNoAdvance(ws, replay);
    const truthPng = resolve(outDir, 'truthHigh.full-grid-render.png');
    writeRgbaPng(truthPng, truthSample.preview.width, truthSample.preview.height, truthSample.preview.rgba);
    frames.push({ role: 'truthHigh', width: truthSample.preview.width, height: truthSample.preview.height, rgba: truthSample.preview.rgba });
    outputs.push({
      role: 'truthHigh',
      path: truthPng,
      sha256: sha256File(truthPng),
      sample: {
        simGrid: truthSample.simGrid,
        simStepCount: truthSample.simStepCount,
        fireLikePixels: truthSample.fireLikePixels,
        smokeLikePixels: truthSample.smokeLikePixels,
        fireEdgeEnergy: truthSample.fireEdgeEnergy,
      },
      replay: truthReplay.deterministicReplay,
    });

    for (const roleName of renderRoleOrder(application)) {
      phase = roleName;
      await captureReplay(ws, replay);
      const override = await applyFullGridRole(ws, application, roleName, application.roles[roleName]);
      const roleTemporalFrames = temporalStripFrameCount > 1
        ? await captureTemporalDynamicsStrip(ws, replay, roleName, temporalStripFrameCount)
        : [];
      if (roleTemporalFrames.length) {
        temporalRows.push({
          role: roleName,
          label: roleRenderLabel(roleName),
          frames: roleTemporalFrames,
        });
      }
      const sample = roleTemporalFrames[0]?.sample || await captureNoAdvance(ws, replay);
      const png = resolve(outDir, `${roleName}.full-grid-render.png`);
      writeRgbaPng(png, sample.preview.width, sample.preview.height, sample.preview.rgba);
      frames.push({
        role: roleName,
        displayLabel: displayLabelForRole(application, roleName),
        width: sample.preview.width,
        height: sample.preview.height,
        rgba: sample.preview.rgba,
      });
      outputs.push({
        role: roleName,
        path: png,
        sha256: sha256File(png),
        override,
        sample: {
          simGrid: sample.simGrid,
          simStepCount: sample.simStepCount,
          fireLikePixels: sample.fireLikePixels,
          smokeLikePixels: sample.smokeLikePixels,
          fireEdgeEnergy: sample.fireEdgeEnergy,
          fullFieldBufferRenderOverride: sample.fullFieldBufferRenderOverride,
        },
      });
    }

    phase = 'contactSheet';
    const sheet = buildLabeledContactSheet(frames);
    const contactSheet = resolve(outDir, 'contactSheet.png');
    writeRgbaPng(contactSheet, sheet.width, sheet.height, Array.from(sheet.rgba));
    const temporalStrip = buildTemporalStrip(temporalRows, outDir);

    phase = 'write-report';
    const report = {
      schema: SCHEMA,
      status: 'captured',
      createdAt: utcNow(),
      applicationManifest: applicationManifestPath,
      applicationManifestSha256: sha256File(applicationManifestPath),
      limitation: LIMITATION,
      renderAuthority: 'debug-full-field-buffer-render-override-v0',
      route: {
        requestedUrl: route,
        effectiveRoute: initialState.effectiveRoute,
        prototypeIdentity: initialState.prototypeIdentity,
        backend: initialState.backend,
        initialState: {
          simGrid: initialState.simGrid,
          simGridLabel: initialState.simGridLabel,
        },
      },
      deterministicReplay: replay,
      highGrid: application.highGrid,
      model: application.model,
      outputs,
      renderComparisonMetrics: renderComparisonMetrics(frames),
      byteIdenticalOverrideSanity: buildByteIdenticalOverrideSanity(application, outputs),
      contactSheet: {
        path: contactSheet,
        sha256: sha256File(contactSheet),
        columnOrder: frames.map(frame => frame.role),
        visibleRasterLabels: sheet.visibleRasterLabels,
      },
    };
    if (temporalStrip) {
      const temporalStripViewer = resolve(outDir, 'temporal-dynamics-strip.html');
      writeTemporalStripViewer(temporalStripViewer, temporalStrip, report);
      report.temporalStrip = temporalStrip;
      report.temporalStripViewer = {
        path: temporalStripViewer,
        sha256: sha256File(temporalStripViewer),
      };
    }
    writeJson(manifestOut, report);
    ws.close();
    await closeBrowser(browser);
    console.log(JSON.stringify({ ok: true, manifest: manifestOut, contactSheet, outputs: outputs.map(output => output.role) }, null, 2));
  } catch (error) {
    writeJson(manifestOut, failureReport(phase, error, evidence));
    if (browser) await closeBrowser(browser);
    console.error(`full-grid residual render-still failed at ${phase}: ${error?.message || error}`);
    process.exitCode = 2;
  }
}

await main();

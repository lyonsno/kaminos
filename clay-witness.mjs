#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8098/?kaminos_clay_sim=1&clay_cube=1&clay_cube_grid=10x10x10&clay_steps=7&clay_debug_colliders=0&clay_benchmark_shadow=0&clay_normal_cadence=every_3&clay_colliders=clay_fixture_hand&clay_brush_hotkey=1';
const routeUsesPointerDrag = url.includes('clay_interactive=1') || url.includes('clay_brush_hotkey=1');
const routeUsesBrushHotkey = url.includes('clay_brush_hotkey=1');
const routeUsesOrbitProbe = url.includes('clay_orbit_probe=1');
const cornerSmokeTarget = new URL(url).searchParams.get('clay_corner_smoke') || '';
const out = resolve(args.get('--out') || '/tmp/kaminos-clay-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9444);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-clay-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 1600);
const windowSize = args.get('--window-size') || '1280,900';
const expectedGrid = args.get('--expected-grid') || null;
const handPosePayloadPath = args.get('--hand-pose-payload') || null;
const handPosePayloadReplay = args.get('--hand-pose-payload-replay') || null;
const recordingEnabled = args.get('--recording') !== '0';
const recordingFrameLimit = Number(args.get('--recording-frame-limit') || (routeUsesPointerDrag ? 12 : 5));
const recordingFrameDir = resolve(args.get('--frame-dir') || out.replace(/\.png$/i, '-frames'));
const recordingFilmstripPath = resolve(args.get('--filmstrip') || out.replace(/\.png$/i, '-filmstrip.png'));
const recordingEvidenceKind = 'cdp-png-frame-sequence-and-filmstrip-v0';

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function parsePngPixels(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'only 8-bit screenshots are supported');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert.ok(channels, `unsupported screenshot color type ${data[9]}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let p = 0;
  let prev = Buffer.alloc(stride);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    p += 1;
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    }
    row.copy(pixels, y * stride);
    prev = row;
  }
  return { width, height, channels, pixels };
}

function screenshotMetricsFromPng(buffer) {
  const { width, height, channels, pixels } = parsePngPixels(buffer);
  let clayColorPixels = 0;
  let brightOrangePixels = 0;
  let litPixels = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const luma = (r + g + b) / 3;
    if (luma > 18) litPixels += 1;
    if (r > 90 && r < 210 && g > 65 && g < 175 && b > 35 && b < 140 && r >= g && g >= b * 0.75) {
      clayColorPixels += 1;
    }
    if (r > 190 && g > 90 && b < 60) brightOrangePixels += 1;
  }
  return { width, height, clayColorPixels, brightOrangePixels, litPixels };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([len, typeBuffer, data, crc]);
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND'),
  ]);
}

function samplePngPixel(parsed, x, y) {
  const clampedX = Math.max(0, Math.min(parsed.width - 1, x));
  const clampedY = Math.max(0, Math.min(parsed.height - 1, y));
  const offset = (clampedY * parsed.width + clampedX) * parsed.channels;
  return [
    parsed.pixels[offset],
    parsed.pixels[offset + 1],
    parsed.pixels[offset + 2],
    parsed.channels === 4 ? parsed.pixels[offset + 3] : 255,
  ];
}

function writeFilmstripPng(frames, filmstripPath, options = {}) {
  assert.ok(frames.length > 0, 'cannot write filmstrip without frames');
  const thumbWidth = options.thumbWidth || 360;
  const gap = options.gap || 8;
  const columns = Math.min(options.columns || 4, frames.length);
  const parsedFrames = frames.map(frame => ({
    frame,
    png: parsePngPixels(readFileSync(frame.path)),
  }));
  const thumbHeight = Math.max(1, Math.round(parsedFrames[0].png.height * (thumbWidth / parsedFrames[0].png.width)));
  const rows = Math.ceil(parsedFrames.length / columns);
  const filmstripWidth = columns * thumbWidth + (columns + 1) * gap;
  const filmstripHeight = rows * thumbHeight + (rows + 1) * gap;
  const rgba = Buffer.alloc(filmstripWidth * filmstripHeight * 4, 18);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  parsedFrames.forEach(({ png }, frameIndex) => {
    const col = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);
    const dstX0 = gap + col * (thumbWidth + gap);
    const dstY0 = gap + row * (thumbHeight + gap);
    for (let y = 0; y < thumbHeight; y += 1) {
      const sy = Math.floor((y / Math.max(1, thumbHeight - 1)) * (png.height - 1));
      for (let x = 0; x < thumbWidth; x += 1) {
        const sx = Math.floor((x / Math.max(1, thumbWidth - 1)) * (png.width - 1));
        const [r, g, b, a] = samplePngPixel(png, sx, sy);
        const dst = ((dstY0 + y) * filmstripWidth + dstX0 + x) * 4;
        rgba[dst] = r;
        rgba[dst + 1] = g;
        rgba[dst + 2] = b;
        rgba[dst + 3] = a;
      }
    }
  });

  mkdirSync(dirname(filmstripPath), { recursive: true });
  writeFileSync(filmstripPath, encodePngRgba(filmstripWidth, filmstripHeight, rgba));
  return {
    path: filmstripPath,
    width: filmstripWidth,
    height: filmstripHeight,
    columns,
    rows,
    thumbWidth,
    thumbHeight,
  };
}

function expectedGridTopology(grid) {
  const match = /^(\d+)x(\d+)$/.exec(String(grid || ''));
  if (!match) return null;
  const gridX = Number(match[1]);
  const gridZ = Number(match[2]);
  if (!Number.isInteger(gridX) || !Number.isInteger(gridZ) || gridX < 2 || gridZ < 2) return null;
  return {
    grid,
    vertexCount: gridX * gridZ,
    triangleCount: (gridX - 1) * (gridZ - 1) * 2,
  };
}

function parseLooseJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8')
    .replace(/:\s*Infinity\b/g, ': null')
    .replace(/:\s*-Infinity\b/g, ': null')
    .replace(/:\s*NaN\b/g, ': null'));
}

function pickClayHandPosePayload(json) {
  return json?.witness?.clay_hand_pose_frame
    || json?.clay_hand_pose_frame
    || json?.clay?.hand_pose_frame
    || json?.hand_pose_frame
    || json?.witness?.hand_pose_frame_update?.payload
    || null;
}

function vectorDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return Number.POSITIVE_INFINITY;
  const dx = Number(a[0]) - Number(b[0]);
  const dy = Number(a[1]) - Number(b[1]);
  const dz = Number(a[2]) - Number(b[2]);
  if (![dx, dy, dz].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  let phase = 'launch';
  const [width, height] = windowSize.split(',').map(v => Number(v.trim()) || 0);
  const recordingFrames = [];
  let sculptOrbitProbe = null;
  let filmstripWritten = false;
  let filmstripMetadata = null;
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${width || 1280},${height || 900}`,
    url,
  ], { stdio: 'ignore' });
  let ws = null;

  const visualRecording = () => ({
    enabled: recordingEnabled,
    evidenceKind: recordingEvidenceKind,
    requestedFrameCount: recordingFrameLimit,
    recordingFrameCount: recordingFrames.length,
    recordingFrames: recordingFrames.slice(),
    frameDir: recordingFrameDir,
    filmstrip: recordingFilmstripPath,
    filmstripWritten,
    filmstripMetadata,
  });

  const recordFrame = async label => {
    if (!recordingEnabled || !ws || ws.readyState !== WebSocket.OPEN) return null;
    if (recordingFrames.length >= recordingFrameLimit) return null;
    mkdirSync(recordingFrameDir, { recursive: true });
    const index = recordingFrames.length;
    const safeLabel = String(label || 'frame').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'frame';
    const path = resolve(recordingFrameDir, `${String(index).padStart(2, '0')}-${safeLabel}.png`);
    const capturedAtMs = Date.now();
    const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    const buffer = Buffer.from(shot.data, 'base64');
    writeFileSync(path, buffer);
    const metrics = screenshotMetricsFromPng(buffer);
    const frame = {
      index,
      phase,
      label: safeLabel,
      path,
      capturedAtMs,
      width: metrics.width,
      height: metrics.height,
      clayColorPixels: metrics.clayColorPixels,
      brightOrangePixels: metrics.brightOrangePixels,
      litPixels: metrics.litPixels,
    };
    recordingFrames.push(frame);
    return frame;
  };

  const finalizeVisualRecording = () => {
    if (!recordingEnabled || !recordingFrames.length) return visualRecording();
    filmstripMetadata = writeFilmstripPng(recordingFrames, recordingFilmstripPath);
    filmstripWritten = true;
    return visualRecording();
  };

  try {
    phase = 'cdp';
    await waitForCdp();
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_clay_sim=1')) || targets.find(t => t.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'missing clay page websocket');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'settle';
    await delay(settleMs);
    await recordFrame('settled');
    let injectedHandPosePayload = null;
    if (handPosePayloadPath) {
      phase = 'hand-pose-payload';
      injectedHandPosePayload = pickClayHandPosePayload(parseLooseJsonFile(handPosePayloadPath));
      assert.ok(injectedHandPosePayload, `missing clay hand-pose payload in ${handPosePayloadPath}`);
      if (handPosePayloadReplay === 'captured') {
        injectedHandPosePayload = {
          ...injectedHandPosePayload,
          originalEvidenceKind: injectedHandPosePayload.evidenceKind,
          evidenceKind: 'captured',
          timestampMs: 0,
        };
      }
      const payloadLiteral = JSON.stringify(injectedHandPosePayload);
      const injectEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: `(async () => {
          const substrate = window.PerceptasiaClaySubstrate || window.__kaminosClayPrototype;
          if (!substrate?.setHandPoseFrame) return { ok: false, reason: 'missing setHandPoseFrame substrate' };
          const payload = ${payloadLiteral};
          if (${JSON.stringify(handPosePayloadReplay)} === 'captured') payload.timestampMs = performance.now();
          const accepted = await substrate.setHandPoseFrame(payload);
          return { ok: true, accepted };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (injectEval.exceptionDetails) {
        throw new Error(`hand-pose-payload injection failed: ${injectEval.exceptionDetails.text || 'unknown exception'}`);
      }
      assert.ok(injectEval.result?.value?.ok, injectEval.result?.value?.reason || 'hand-pose-payload injection did not reach substrate');
      await delay(350);
      await recordFrame('hand-pose-payload');
    }

    if (routeUsesOrbitProbe) {
      phase = 'camera-orbit-probe';
      const readCenterHit = async label => {
        const evalResult = await wsRequest(ws, 'Runtime.evaluate', {
          expression: `(() => {
            const canvas = document.querySelector('canvas');
            const pointerInteraction = window.__kaminosClayPointerInteraction;
            if (!canvas) return { ok: false, reason: 'missing clay canvas' };
            if (!pointerInteraction?.eventToClayHit) return { ok: false, reason: 'missing pointer interaction hit sampler' };
            const rect = canvas.getBoundingClientRect();
            if (!(rect.width > 16 && rect.height > 16)) {
              return { ok: false, reason: 'missing clay canvas bounds', rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
            }
            const isSculptRoute = ${JSON.stringify(url.includes('clay_sculpt=1'))};
            const liveSculptSource = 'sculpt-boundary-skin-raycast-v0';
            let screenX = rect.left + rect.width * 0.50;
            let screenY = rect.top + rect.height * 0.50;
            let hit = pointerInteraction.eventToClayHit({ clientX: screenX, clientY: screenY, shiftKey: false });
            if (isSculptRoute && hit?.surfaceSource !== liveSculptSource) {
              let best = null;
              for (const fy of [0.34, 0.38, 0.42, 0.46, 0.50, 0.54, 0.58, 0.62]) {
                for (const fx of [0.28, 0.34, 0.40, 0.46, 0.52, 0.58, 0.64, 0.70, 0.76]) {
                  const x = rect.left + rect.width * fx;
                  const y = rect.top + rect.height * fy;
                  const candidate = pointerInteraction.eventToClayHit({ clientX: x, clientY: y, shiftKey: false });
                  if (candidate?.surfaceSource !== liveSculptSource) continue;
                  const distance = (fx - 0.50) ** 2 + (fy - 0.50) ** 2;
                  if (!best || distance < best.distance) best = { x, y, hit: candidate, distance };
                }
              }
              if (best) {
                screenX = best.x;
                screenY = best.y;
                hit = best.hit;
              }
            }
            return {
              ok: !!hit,
              label: ${JSON.stringify(label)},
              reason: hit ? null : 'center ray missed clay',
              hit,
              screenX,
              screenY,
              rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            };
          })()`,
          returnByValue: true,
        });
        if (evalResult.exceptionDetails) {
          throw new Error(`sculpt orbit probe hit evaluation failed: ${evalResult.exceptionDetails.text || 'unknown exception'}`);
        }
        return evalResult.result?.value;
      };
      const before = await readCenterHit('before-orbit');
      assert.ok(before?.ok, before?.reason || 'sculpt orbit probe could not sample the pre-orbit hit');
      await recordFrame('orbit-before');
      const orbit = before.rect;
      const y = orbit.top + orbit.height * 0.52;
      const startX = orbit.left + orbit.width * 0.68;
      const midX = orbit.left + orbit.width * 0.38;
      const endX = orbit.left + orbit.width * 0.18;
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y, button: 'left', buttons: 1, clickCount: 1 });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: midX, y, button: 'left', buttons: 1 });
      await delay(80);
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: endX, y, button: 'left', buttons: 1 });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y, button: 'left', buttons: 0, clickCount: 1 });
      await delay(450);
      const after = await readCenterHit('after-orbit');
      assert.ok(after?.ok, after?.reason || 'sculpt orbit probe could not sample the post-orbit hit');
      sculptOrbitProbe = {
        evidenceKind: 'cdp-orbit-controls-center-surface-raycast-v0',
        before,
        after,
        normalDelta: vectorDistance(before.hit?.surfaceNormal, after.hit?.surfaceNormal),
        rawCenterDelta: vectorDistance(before.hit?.rawCenter, after.hit?.rawCenter),
      };
      assert.ok(
        sculptOrbitProbe.normalDelta > 0.15,
        `sculpt orbit probe did not change hit normal: ${JSON.stringify(sculptOrbitProbe)}`,
      );
      await recordFrame('orbit-after');
    }

    if (routeUsesPointerDrag) {
      phase = 'pointer-drag-geometry';
      let drag = null;
      let dragFailure = 'missing clay canvas bounds';
      for (let i = 0; i < 30; i += 1) {
        const dragEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: `(() => {
            const canvas = document.querySelector('canvas');
            const pointerInteraction = window.__kaminosClayPointerInteraction;
            if (!canvas) return { ok: false, reason: 'missing clay canvas' };
            const rect = canvas.getBoundingClientRect();
            if (!pointerInteraction) return { ok: false, reason: 'missing pointer interaction' };
            if (!(rect.width > 16 && rect.height > 16)) {
              return { ok: false, reason: 'missing clay canvas bounds', rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
            }
            const cornerSmokeTarget = ${JSON.stringify(cornerSmokeTarget)};
            const isSculptRoute = ${JSON.stringify(url.includes('clay_sculpt=1'))};
            const liveSculptSource = 'sculpt-boundary-skin-raycast-v0';
            const liveSculptSamples = [];
            if (isSculptRoute) {
              for (const fy of [0.34, 0.38, 0.42, 0.46, 0.50, 0.54, 0.58, 0.62]) {
                for (const fx of [0.28, 0.34, 0.40, 0.46, 0.52, 0.58, 0.64, 0.70, 0.76]) {
                  const x = rect.left + rect.width * fx;
                  const y = rect.top + rect.height * fy;
                  const hit = pointerInteraction.eventToClayHit({ clientX: x, clientY: y, shiftKey: false });
                  if (hit?.surfaceSource === liveSculptSource) {
                    liveSculptSamples.push({ x, y, fx, fy, hit });
                  }
                }
              }
              if (liveSculptSamples.length < 3) {
                return {
                  ok: false,
                  reason: 'missing live sculpt surface samples',
                  liveSculptSampleCount: liveSculptSamples.length,
                  rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                };
              }
              const nearestLiveSample = (targetFx, targetFy) => liveSculptSamples
                .slice()
                .sort((a, b) => ((a.fx - targetFx) ** 2 + (a.fy - targetFy) ** 2) - ((b.fx - targetFx) ** 2 + (b.fy - targetFy) ** 2))[0];
              const start = nearestLiveSample(0.42, 0.50);
              const mid = nearestLiveSample(0.48, 0.50);
              const end = nearestLiveSample(0.56, 0.51);
              return {
                ok: true,
                startX: start.x,
                startY: start.y,
                midX: mid.x,
                midY: mid.y,
                endX: end.x,
                endY: end.y,
                liveSculptSampleCount: liveSculptSamples.length,
                liveSculptSampleSources: liveSculptSamples.slice(0, 5).map(sample => sample.hit.surfaceSource),
                rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
              };
            }
            const dragPlan = cornerSmokeTarget === 'front_upper_right'
              ? {
                startX: rect.left + rect.width * 0.62,
                startY: rect.top + rect.height * 0.42,
                midX: rect.left + rect.width * 0.68,
                midY: rect.top + rect.height * 0.40,
                endX: rect.left + rect.width * 0.74,
                endY: rect.top + rect.height * 0.38,
              }
              : {
                startX: rect.left + rect.width * 0.43,
                startY: rect.top + rect.height * 0.50,
                midX: rect.left + rect.width * 0.46,
                midY: rect.top + rect.height * 0.50,
                endX: rect.left + rect.width * 0.50,
                endY: rect.top + rect.height * 0.51,
              };
            return {
              ok: true,
              ...dragPlan,
              rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            };
          })()`,
          returnByValue: true,
        });
        if (dragEval.exceptionDetails) {
          throw new Error(`pointer-drag-geometry evaluation failed: ${dragEval.exceptionDetails.text || 'unknown exception'}`);
        }
        const candidate = dragEval.result?.value;
        if (candidate?.ok) {
          drag = candidate;
          break;
        }
        dragFailure = candidate?.reason || dragFailure;
        await delay(100);
      }
      assert.ok(drag, `missing clay canvas bounds for pointer drag geometry: ${dragFailure}`);
      await recordFrame('before-drag');
      phase = 'pointer-drag';
      if (routeUsesBrushHotkey) {
        await wsRequest(ws, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'b',
          code: 'KeyB',
          windowsVirtualKeyCode: 66,
          nativeVirtualKeyCode: 66,
        });
      }
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: drag.startX, y: drag.startY });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: drag.startX, y: drag.startY, button: 'left', buttons: 1, clickCount: 1 });
      await recordFrame('drag-pressed');
      let dragFrameIndex = 0;
      for (const [x, y] of [
        [drag.midX, drag.midY],
        [drag.endX, drag.endY],
        [drag.endX + 18, drag.endY - 4],
        [drag.endX + 36, drag.endY + 6],
        [drag.endX + 54, drag.endY + 2],
        [drag.endX + 72, drag.endY + 8],
      ]) {
        await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
        await delay(80);
        await recordFrame(`drag-${String(dragFrameIndex).padStart(2, '0')}`);
        dragFrameIndex += 1;
      }
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: drag.endX + 36, y: drag.endY + 6, button: 'left', buttons: 0, clickCount: 1 });
      if (routeUsesBrushHotkey) {
        await wsRequest(ws, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'b',
          code: 'KeyB',
          windowsVirtualKeyCode: 66,
          nativeVirtualKeyCode: 66,
        });
      }
      await delay(600);
      await recordFrame('released-settle');
    }

    phase = 'state';
    let state = null;
    for (let i = 0; i < 30; i += 1) {
      const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'window.__kaminosClayPrototype?.debugState?.()',
        returnByValue: true,
      });
      state = stateEval.result.value;
      if (
        (state?.persistentClayStepCount ?? 0) >= 6
        && (state?.persistentClayDeltaHistory?.length ?? 0) >= 3
        && (state?.clayStepSampleCount ?? 0) >= 6
        && (!routeUsesPointerDrag || (state?.clayPointerDragStepCount ?? 0) >= 3)
        && state?.clayDeformationCount > 0
      ) break;
      await delay(180);
    }
    assert.ok(state, 'missing clay debug state');
    assert.equal(state.effectiveRoute, 'kaminos-clay-sim-route-v0');
    assert.equal(state.prototypeIdentity, 'kaminos-clay-prototype-v0');
    assert.equal(state.solverIdentity, 'webgpu-clay-surface-lattice-scaffold-v0');
    assert.equal(state.effectiveBackend, 'WebGPU');
    assert.equal(state.substrateEvidenceKind, 'webgpu-compute-readback');
    assert.equal(state.runtimeCpuFallback, false);
    assert.equal(state.packagePrimitiveSourceContract, 'kaolin-kpm-001-forward-distance-feature-codes');
    assert.equal(state.packagePrimitiveImportPath, './vendor/webgpu-geometry-primitives/point-triangle.js');
    assert.equal(state.packagePrimitiveCommit, '3a8441b');
    assert.equal(state.pointTriangleJobFloats, 16);
    assert.equal(state.pointTriangleResultBytes, 16);
    assert.equal(state.sharedPrimitiveProbeStatus, 'pass');
    assert.equal(state.sharedPrimitiveProbeFeature, 0);
    assert.equal(state.sharedPrimitiveProbeTriangleIndex, 77);
    assert.ok(
      Math.abs((state.sharedPrimitiveProbeDistanceSq ?? Number.NaN) - 0.25) <= 1e-5,
      `shared primitive probe distance mismatch: ${state.sharedPrimitiveProbeDistanceSq}`,
    );
    const isPointerDragRoute = routeUsesPointerDrag;
    const isCubeRoute = url.includes('clay_cube=1');
    const isSculptRoute = url.includes('clay_sculpt=1');
    assert.equal(state.primitiveContactPassStatus, 'pass');
    const expectedPrimitiveContacts = isPointerDragRoute
      ? 1
      : url.includes('clay_colliders=clay_edge_fixture')
        ? 2
        : 5;
    if (isPointerDragRoute && (state.clayPointerDragStepCount ?? 0) >= 3) {
      assert.ok((state.primitiveContactJobCount ?? 0) >= 0, 'interactive primitive contact job count missing');
      if ((state.primitiveContactActiveCount ?? 0) > 0) {
        assert.ok(Number.isFinite(state.primitiveContactMinDistance), 'interactive primitive contact distance missing while contacts are active');
        assert.ok((state.primitiveContactForceSum ?? 0) > 0, 'interactive primitive contact force missing while contacts are active');
      }
    } else {
      assert.ok((state.primitiveContactJobCount ?? 0) >= expectedPrimitiveContacts, 'primitive contact pass did not process expected colliders');
      assert.ok((state.primitiveContactActiveCount ?? 0) >= expectedPrimitiveContacts, 'primitive contact pass did not report active contacts');
      assert.ok(Number.isFinite(state.primitiveContactMinDistance), 'primitive contact pass did not record a minimum distance');
      assert.ok((state.primitiveContactForceSum ?? 0) > 0, 'primitive contact pass did not derive positive force');
    }
    assert.equal(state.persistentClayStateStatus, 'persistent');
    assert.ok((state.persistentClayStepCount ?? 0) >= 6, 'persistent clay state did not survive the multi-step relaxation route');
    assert.ok((state.persistentClayMaxDelta ?? 0) > 0, 'persistent clay state did not report step delta');
    assert.ok(
      Array.isArray(state.persistentClayDeltaHistory) && state.persistentClayDeltaHistory.length >= 3,
      'persistent clay state did not report a multi-step delta history',
    );
    assert.ok((state.persistentClayInitialDelta ?? 0) > 0, 'persistent clay state did not record initial relaxation delta');
    assert.ok((state.persistentClayLatestDelta ?? 0) > 0, 'persistent clay state did not record latest relaxation delta');
    assert.ok(Number.isFinite(state.persistentClaySettlingRatio), 'persistent clay state did not record settling ratio');
    if (!routeUsesPointerDrag && !handPosePayloadPath) {
      assert.ok(state.persistentClaySettlingRatio < 1, `persistent clay did not settle: ${state.persistentClaySettlingRatio}`);
    }
    assert.equal(state.clayCubeEnabled, isCubeRoute, 'cube witness enablement did not match clay_cube route parameter');
    if (isCubeRoute) {
      const requestedVolumePreservation = new URL(url).searchParams.get('clay_volume_preservation')
        || new URL(url).searchParams.get('clay_volume_mode')
        || 'disabled';
      const normalizedVolumePreservation = String(requestedVolumePreservation).trim().toLowerCase().replaceAll('-', '_');
      const expectedVolumePreservation = ['cells', 'cell', 'volume_cell', 'volume_cells'].includes(normalizedVolumePreservation)
        ? 'volume_cells'
        : ['preserve_demo', 'demo', 'preserve', '1', 'true'].includes(normalizedVolumePreservation)
        ? 'preserve_demo'
        : 'disabled';
      const expectedVolumePolicy = expectedVolumePreservation === 'preserve_demo'
        ? 'local-boundary-pressure-compensation-not-incompressible-mpm-v0'
        : expectedVolumePreservation === 'volume_cells'
          ? 'structured-hexa-cell-volume-projection-js-postprocess-v0'
          : 'disabled';
      assert.equal(state.clayCubeSolverIdentity, 'webgpu-clay-material-point-cube-first-loop-v0', 'cube solver identity missing');
      assert.equal(state.clayCubeStepStatus, 'pass', 'cube first-loop step did not pass');
      assert.equal(state.clayCubeEvidenceKind, 'webgpu-material-point-readback', 'cube evidence did not come from WebGPU readback');
      assert.equal(state.clayCubeOracleEvidenceKind, 'deterministic-js-oracle-not-runtime-fallback', 'cube oracle evidence kind missing');
      assert.equal(state.clayCubeSurfaceVisible, false, 'cube route should hide the old heightfield surface in the current witness');
      assert.equal(state.clayCubeDiagnosticColorMode, 'cube-diagnostic-contact-displacement-colors-v0', 'cube diagnostic color mode missing');
      assert.equal(state.clayCubeBoundingBoxVisible, true, 'cube diagnostic bounding box missing');
      assert.equal(state.clayCubeBoundingBoxContract, 'cube-diagnostic-bounding-box-v0', 'cube diagnostic bounding-box contract missing');
      assert.equal(state.clayCubeIsoSurfaceEvidenceKind, 'diagnostic-marching-cubes-cpu-render-surface-not-solver-v0', 'cube diagnostic iso-surface evidence kind missing');
      assert.equal(
        state.clayCubeIsoSurfaceVisibilityPolicy,
        'hidden-while-boundary-skin-active-v0',
        'cube diagnostic iso-surface visibility policy missing',
      );
      assert.ok((state.clayCubeIsoSurfaceResolution ?? 0) >= 20, 'cube diagnostic iso-surface resolution too low or missing');
      assert.ok((state.clayCubeIsoSurfaceBallCount ?? 0) >= 216, 'cube diagnostic iso-surface did not consume enough material points');
      if (state.clayCubeBoundarySkinVisible) {
        assert.equal(state.clayCubeIsoSurfaceVisible, false, 'cube diagnostic iso-surface leaked visible fragments while boundary skin is active');
      }
      if (state.clayCubeIsoSurfaceVisible) {
        assert.ok((state.clayCubeIsoSurfaceTriangleCount ?? 0) > 0, 'cube diagnostic iso-surface produced no triangles');
      }
      assert.equal(state.clayCubeBoundarySkinVisible, true, 'cube diagnostic boundary skin missing');
      assert.equal(state.clayCubeBoundarySkinEvidenceKind, 'diagnostic-boundary-skin-from-material-points-not-solver-v0', 'cube diagnostic boundary-skin evidence kind missing');
      assert.equal(state.clayCubeBoundarySkinVisualMode, 'shared-vertex-displacement-heat-boundary-skin-v0', 'cube diagnostic boundary-skin visual mode missing');
      assert.ok((state.clayCubeBoundarySkinVertexCount ?? 0) > 0, 'cube diagnostic boundary skin produced no vertices');
      assert.ok((state.clayCubeBoundarySkinSharedVertexCount ?? 0) > 0, 'cube diagnostic boundary skin did not report shared vertices');
      assert.equal(state.clayCubeBoundarySkinSharedVertexCount, state.clayCubeBoundarySkinVertexCount, 'cube boundary skin still duplicates exterior material vertices');
      assert.ok((state.clayCubeBoundarySkinTriangleCount ?? 0) > 0, 'cube diagnostic boundary skin produced no triangles');
      assert.equal(state.clayCubeVisibleSurfaceSource, 'boundary-skin', 'cube visible surface source was not boundary skin');
      assert.ok(['disabled', 'source-tint-visible-surfaces-v0'].includes(state.clayCubeSurfaceSourceDebug), 'cube surface source debug mode missing');
      assert.equal(
        state.clayCubeBoundarySkinCullingPolicy,
        'boundary-skin-folded-triangle-cull-v0',
        'cube boundary skin culling policy missing',
      );
      assert.ok(Number.isFinite(state.clayCubeBoundarySkinCulledTriangleCount), 'cube boundary skin culled-triangle count missing');
      assert.equal(
        state.clayCubeBoundarySkinFairingPolicy,
        'contacted-boundary-skin-curvature-fairing-v0',
        'cube boundary skin did not report contacted curvature fairing policy',
      );
      assert.ok(Number.isFinite(state.clayCubeBoundarySkinRawRoughness), 'cube boundary skin raw roughness metric missing');
      assert.ok(Number.isFinite(state.clayCubeBoundarySkinRoughness), 'cube boundary skin faired roughness metric missing');
      assert.ok(Number.isFinite(state.clayCubeBoundarySkinMaxFairingDisplacement), 'cube boundary skin fairing displacement metric missing');
      assert.ok(
        state.clayCubeBoundarySkinRoughness <= state.clayCubeBoundarySkinRawRoughness,
        `cube boundary skin fairing increased roughness: raw=${state.clayCubeBoundarySkinRawRoughness} faired=${state.clayCubeBoundarySkinRoughness}`,
      );
      assert.equal(state.clayCubeFaceMetricEvidenceKind, 'solver-space-material-point-face-locality-v0', 'cube face-locality metric evidence kind missing');
      assert.equal(state.clayCubeVolumePreservationMode, expectedVolumePreservation, 'cube volume-preservation mode did not match route');
      assert.equal(
        state.clayCubeVolumePreservationPolicy,
        expectedVolumePolicy,
        'cube volume-preservation policy missing or mismatched',
      );
      assert.equal(state.clayCubeVolumeProxyEvidenceKind, 'signed-boundary-skin-volume-proxy-v0', 'cube volume proxy evidence kind missing');
      assert.ok((state.clayCubeBaseVolumeProxy ?? 0) > 0, 'cube base volume proxy missing');
      assert.ok((state.clayCubeVolumeProxy ?? 0) > 0, 'cube current volume proxy missing');
      assert.ok(Number.isFinite(state.clayCubeVolumeRatio), 'cube volume ratio missing');
      assert.ok(Number.isFinite(state.clayCubeVolumeCompensationCount), 'cube volume compensation count missing');
      assert.equal(state.clayCubeCellVolumeEvidenceKind, 'structured-hexa-cell-volume-metrics-v0', 'cube cell-volume metric evidence kind missing');
      assert.ok(Number.isFinite(state.clayCubeCellVolumeMeanRelativeErrorBefore), 'cube pre-projection mean cell-volume error missing');
      assert.ok(Number.isFinite(state.clayCubeCellVolumeMeanRelativeErrorAfter), 'cube post-projection mean cell-volume error missing');
      assert.ok(Number.isFinite(state.clayCubeCellVolumeMaxRelativeErrorBefore), 'cube pre-projection max cell-volume error missing');
      assert.ok(Number.isFinite(state.clayCubeCellVolumeMaxRelativeErrorAfter), 'cube post-projection max cell-volume error missing');
      assert.ok(Number.isFinite(state.clayCubeVolumeCellConstraintIterationCount), 'cube volume-cell iteration count missing');
      assert.ok(Number.isFinite(state.clayCubeVolumeCellConstrainedCellCount), 'cube volume-cell constrained count missing');
      if (expectedVolumePreservation === 'preserve_demo') {
        assert.ok(state.clayCubeVolumeRatio >= 0.96, `preserve-demo cube volume ratio collapsed: ${state.clayCubeVolumeRatio}`);
        assert.ok(state.clayCubeVolumeCompensationCount > 0, 'preserve-demo did not touch any compensation particles');
      } else if (expectedVolumePreservation === 'volume_cells') {
        assert.ok(state.clayCubeVolumeRatio >= 0.98, `volume-cells cube volume ratio collapsed: ${state.clayCubeVolumeRatio}`);
        assert.ok(state.clayCubeVolumeCellConstraintIterationCount >= 2, 'volume-cells mode did not report projection iterations');
        assert.ok(state.clayCubeVolumeCellConstrainedCellCount > 0, 'volume-cells mode did not constrain any cells');
        assert.ok(
          state.clayCubeCellVolumeMaxRelativeErrorAfter <= state.clayCubeCellVolumeMaxRelativeErrorBefore * 1.05,
          `volume-cells mode worsened max local cell-volume error too much: before=${state.clayCubeCellVolumeMaxRelativeErrorBefore} after=${state.clayCubeCellVolumeMaxRelativeErrorAfter}`,
        );
      }
      assert.ok(Number.isFinite(state.clayCubeFrontFaceDeformedParticleCount), 'cube front-face deformation count missing');
      assert.ok(Number.isFinite(state.clayCubeBackFaceDeformedParticleCount), 'cube back-face deformation count missing');
      assert.ok(Number.isFinite(state.clayCubeFrontBackDeformationRatio), 'cube front/back deformation ratio missing');
      assert.ok(Number.isFinite(state.clayCubeEdgeBandDeformedParticleCount), 'cube edge-band deformation count missing');
      assert.ok(Number.isFinite(state.clayCubeCornerBandDeformedParticleCount), 'cube corner-band deformation count missing');
      assert.ok(['front', 'back', 'left', 'right', 'top', 'bottom', 'interior'].includes(state.clayCubeMaxDisplacementFace), 'cube max displacement face missing');
      assert.ok((state.clayCubeParticleCount ?? 0) >= 216, 'cube material-point count too small for first-loop witness');
      assert.ok((state.clayCubeGridDimension ?? 0) >= 12, 'cube grid dimension missing');
      assert.ok((state.clayCubeActiveGridCellCount ?? 0) > 0, 'cube active grid-cell count missing');
      assert.ok((state.clayCubeDeformedParticleCount ?? 0) > 0, 'cube deformation count missing');
      if (!routeUsesPointerDrag) {
        assert.ok((state.clayCubeContactParticleCount ?? 0) > 0, 'cube contact count missing');
      }
      assert.ok((state.clayCubeDiagnosticColoredParticleCount ?? 0) > 0, 'cube diagnostic colored particle count missing');
      assert.ok((state.clayCubeDiagnosticHotParticleCount ?? 0) > 0, 'cube hot/contact diagnostic particle count missing');
      assert.ok((state.clayCubeMaxDisplacement ?? 0) > 0.005, 'cube max displacement too small to prove hand influence');
      assert.ok((state.clayCubeHeightRange ?? 0) > 0.25, 'cube height range too small for volumetric witness');
      assert.ok(Number.isFinite(state.clayCubeReadbackWallMs) && state.clayCubeReadbackWallMs > 0, 'cube readback timing missing');
      assert.ok((state.clayCubeDispatchWorkgroups ?? 0) > 0, 'cube dispatch workgroup count missing');
    }
    assert.equal(state.claySculptEnabled, isSculptRoute, 'sculpt witness enablement did not match clay_sculpt route parameter');
    if (isSculptRoute) {
      assert.equal(state.claySculptSolverIdentity, 'webgpu-clay-particle-sculpt-hash-grid-v0', 'sculpt solver identity missing');
      assert.equal(state.claySculptStepStatus, 'pass', 'sculpt hash-grid step did not pass');
      assert.equal(state.claySculptEvidenceKind, 'webgpu-particle-hash-grid-readback', 'sculpt evidence did not come from WebGPU readback');
      assert.equal(state.claySculptHashGridContract, 'fixed-capacity-uniform-grid-neighbor-bins-v0', 'sculpt hash-grid contract missing');
      assert.equal(state.claySculptHashGridEvidenceKind, 'deterministic-js-hash-grid-oracle-not-runtime-fallback', 'sculpt hash-grid oracle evidence kind missing');
      assert.equal(state.claySculptOracleEvidenceKind, 'deterministic-js-sculpt-oracle-not-runtime-fallback', 'sculpt oracle evidence kind missing');
      assert.ok((state.claySculptParticleCount ?? 0) >= 384, 'sculpt particle count too small for first hash-grid witness');
      assert.ok((state.claySculptHashGridDimension ?? 0) >= 12, 'sculpt hash-grid dimension missing');
      assert.ok((state.claySculptHashGridCellCapacity ?? 0) >= 8, 'sculpt hash-grid capacity missing');
      assert.ok((state.claySculptActiveCellCount ?? 0) > 0, 'sculpt hash-grid active cells missing');
      assert.ok((state.claySculptMaxCellOccupancy ?? 0) > 1, 'sculpt hash-grid never recorded multi-particle occupancy');
      assert.equal(state.claySculptOverflowCount, 0, 'sculpt hash-grid overflowed in first witness preset');
      assert.ok((state.claySculptNeighborSampleCount ?? 0) > 0, 'sculpt solver did not sample hash-grid neighbors');
      assert.ok((state.claySculptAverageNeighborCount ?? 0) > 1, 'sculpt solver neighborhood density too low');
      assert.ok((state.claySculptContactParticleCount ?? 0) > 0, 'sculpt brush did not contact particles');
      assert.ok((state.claySculptDeformedParticleCount ?? 0) > 0, 'sculpt brush did not deform particles');
      assert.ok((state.claySculptMaxDisplacement ?? 0) > 0.01, 'sculpt max displacement too small to prove brush influence');
      assert.ok((state.claySculptNeighborCohesionDisplacement ?? 0) > 0, 'sculpt cohesion metric missing');
      assert.ok(Number.isFinite(state.claySculptReadbackWallMs) && state.claySculptReadbackWallMs > 0, 'sculpt readback timing missing');
      assert.ok((state.claySculptDispatchWorkgroups ?? 0) > 0, 'sculpt dispatch workgroup count missing');
      assert.equal(state.claySculptPointCloudVisible, true, 'sculpt point cloud was not visible');
      assert.equal(state.claySculptSurfaceEvidenceKind, 'diagnostic-boundary-skin-from-sculpt-particles-not-solver-v0', 'sculpt diagnostic surface evidence kind missing');
      assert.equal(state.claySculptSurfaceVisualMode, 'structured-lattice-boundary-skin-over-live-sculpt-particles-v0', 'sculpt diagnostic surface visual mode missing');
      assert.equal(state.claySculptSurfaceVisible, true, 'sculpt diagnostic surface was not visible');
      assert.ok((state.claySculptSurfaceVertexCount ?? 0) >= 400, 'sculpt diagnostic surface did not consume enough exterior particles');
      assert.ok((state.claySculptSurfaceTriangleCount ?? 0) > 0, 'sculpt diagnostic surface produced no triangles');
      assert.equal(state.claySculptSurfaceNeedsRefresh, false, 'sculpt diagnostic surface was stale at assertion time');
      assert.equal(state.claySculptSurfaceSkippedUpdateCount, 0, 'sculpt diagnostic surface skipped live pointer updates');
      assert.ok((state.claySculptSurfaceUpdateCount ?? 0) >= 6, 'sculpt diagnostic surface did not update across the pointer smoke');
      assert.equal(state.clayPointerDepthPolicy, 'camera-ray-nearest-sculpt-surface', 'sculpt pointer hit used the old heightfield depth policy');
      assert.equal(state.clayPointerLastHit.depthPolicy, 'camera-ray-nearest-sculpt-surface', 'sculpt pointer hit did not preserve depth policy');
      assert.equal(state.clayPointerLastHit.surfaceSource, 'sculpt-boundary-skin-raycast-v0', 'sculpt pointer hit used proxy bounds instead of live boundary-skin picking');
      assert.ok(Array.isArray(state.clayPointerLastHit.surfaceNormal), 'sculpt pointer hit did not preserve inward surface normal');
      assert.ok(
        vectorDistance(state.clayPointerLastHit.surfaceNormal, [0, 0, 0]) > 0.90,
        'sculpt pointer hit normal was not normalized enough to drive brush force',
      );
      if (!routeUsesOrbitProbe) {
        assert.ok((state.clayPointerLastHit.surfaceNormal[2] ?? 0) < -0.20, 'sculpt front-face pointer hit did not drive inward from the visible face');
        assert.ok(Math.abs(state.clayPointerLastHit.z - state.clayPointerLastHit.rawCenter[2]) <= 1e-6, 'sculpt pointer effective hit was inset from the raw sculpt face hit');
      } else {
        assert.ok(sculptOrbitProbe, 'sculpt orbit probe did not record hit evidence');
      }
      assert.ok((state.claySculptDeformedParticleCount ?? Infinity) < (state.claySculptParticleCount ?? 0) * 0.50, 'sculpt brush leaked deformation into most of the particle body');
    }
    assert.equal(state.clayTimingEvidenceSource, 'webgpu-step-readback-wall-time', 'clay timing evidence source did not reach debug state');
    assert.equal(
      state.clayTimingDisclaimer,
      'includes primitive-contact and clay readback; not gpu-exclusive-or-present-latency',
      'clay timing disclaimer did not reach debug state',
    );
    assert.ok(Array.isArray(state.clayStepDurationHistory) && state.clayStepDurationHistory.length >= 6, 'clay timing history did not record route steps');
    assert.ok(Number.isFinite(state.clayStepLatestMs) && state.clayStepLatestMs > 0, 'clay latest step timing missing');
    assert.ok(Number.isFinite(state.clayStepP95Ms) && state.clayStepP95Ms > 0, 'clay p95 step timing missing');
    assert.ok((state.clayStepSampleCount ?? 0) >= 6, 'clay step timing sample count missing');
    assert.equal(state.clayTimingWarmupPolicy, 'first-three-steps-treated-as-warmup', 'clay timing warmup policy missing');
    assert.equal(state.clayWarmupStepCount, 3, 'clay timing warmup count missing');
    assert.ok(Array.isArray(state.claySteadyStepDurationHistory), 'clay steady timing history missing');
    assert.ok((state.claySteadyStepSampleCount ?? 0) >= 3, 'clay steady timing sample count missing');
    assert.ok(Number.isFinite(state.claySteadyStepP50Ms) && state.claySteadyStepP50Ms > 0, 'clay steady p50 timing missing');
    assert.ok(Number.isFinite(state.claySteadyStepP95Ms) && state.claySteadyStepP95Ms > 0, 'clay steady p95 timing missing');
    assert.ok(
      Number.isFinite(state.clayStepMaxOutlierMs) && state.clayStepMaxOutlierMs >= state.clayStepP95Ms,
      'clay max timing outlier missing',
    );
    assert.match(
      state.clayPhaseTimingDisclaimer || '',
      /not GPU timestamp-query kernel time/,
      'clay phase timing disclaimer did not reach debug state',
    );
    assert.ok(Number.isFinite(state.clayContactWallMs) && state.clayContactWallMs >= 0, 'clay primitive contact wall timing missing');
    assert.ok(Number.isFinite(state.clayColliderPrepWallMs) && state.clayColliderPrepWallMs >= 0, 'clay collider prep timing missing');
    assert.ok(Number.isFinite(state.clayLatticeReadbackWallMs) && state.clayLatticeReadbackWallMs > 0, 'clay lattice dispatch/readback timing missing');
    assert.ok(Number.isFinite(state.clayCpuMeshUpdateMs) && state.clayCpuMeshUpdateMs >= 0, 'clay CPU mesh update timing missing');
    assert.ok(Number.isFinite(state.clayNormalUpdateMs) && state.clayNormalUpdateMs >= 0, 'clay normal recompute timing missing');
    const requestedNormalCadence = new URL(url).searchParams.get('clay_normal_cadence') || 'every_step';
    assert.equal(state.clayNormalCadence, requestedNormalCadence, 'clay normal cadence did not match route');
    assert.ok(Array.isArray(state.clayNormalCadenceWarnings), 'clay normal cadence warnings missing');
    assert.ok(Number.isFinite(state.clayNormalUpdateCount) && state.clayNormalUpdateCount > 0, 'clay normal update count missing');
    assert.ok(Number.isFinite(state.clayNormalSkippedCount) && state.clayNormalSkippedCount >= 0, 'clay normal skipped count missing');
    if (requestedNormalCadence === 'every_3') {
      assert.ok(state.clayNormalSkippedCount > 0, 'clay every-third normal cadence did not skip recomputes');
    } else if (requestedNormalCadence === 'every_step') {
      assert.equal(state.clayNormalSkippedCount, 0, 'clay every-step normal cadence skipped recomputes');
    }
    assert.ok(Number.isFinite(state.clayStepTotalWallMs) && state.clayStepTotalWallMs > 0, 'clay total wall timing missing');
    assert.equal(state.clayCpuShadowEvidenceKind, 'benchmark-only-js-shadow-not-runtime-fallback', 'clay CPU shadow evidence kind is not explicit');
    assert.equal(state.clayCpuShadowBenchmarkEnabled, url.includes('clay_benchmark_shadow=1'), 'clay CPU shadow benchmark enablement does not match route');
    if (url.includes('clay_benchmark_shadow=1')) {
      assert.ok(Number.isFinite(state.clayCpuShadowEstimateMs) && state.clayCpuShadowEstimateMs > 0, 'clay CPU shadow estimate missing');
      assert.ok(Number.isFinite(state.clayCpuShadowRatio) && state.clayCpuShadowRatio >= 0, 'clay CPU shadow ratio missing');
      assert.ok((state.clayCpuShadowSampleCount ?? 0) >= 1, 'clay CPU shadow sample count missing');
      assert.ok(Number.isFinite(state.clayCpuContactShadowEstimateMs) && state.clayCpuContactShadowEstimateMs > 0, 'clay CPU contact shadow estimate missing');
      assert.ok(Number.isFinite(state.clayCpuContactShadowRatio) && state.clayCpuContactShadowRatio >= 0, 'clay CPU contact shadow ratio missing');
      assert.ok((state.clayCpuContactShadowSampleCount ?? 0) >= 1, 'clay CPU contact shadow sample count missing');
    }
    assert.ok((state.claySurfaceVertexCount ?? 0) >= 1000, 'clay surface vertex count is too small for quality witness');
    assert.ok((state.claySurfaceTriangleCount ?? 0) >= 2500, 'clay surface triangle count is too small for quality witness');
    assert.equal(state.clayBrushBoundaryPolicy, 'radius-aware-center-clamp', 'clay brush boundary policy missing');
    assert.equal(state.clayBrushBoundaryEdgeFalloff, 'smoothstep-edge-falloff', 'clay brush boundary edge falloff missing');
    assert.ok(Number.isFinite(state.clayBrushBoundaryClampCount) && state.clayBrushBoundaryClampCount >= 0, 'clay brush boundary clamp count missing');
    assert.ok(Array.isArray(state.clayBrushBoundaryWarnings), 'clay brush boundary warnings missing');
    if (url.includes('clay_colliders=clay_edge_fixture')) {
      assert.ok(state.clayBrushBoundaryClampCount > 0, 'clay edge fixture did not exercise brush boundary clamp');
    }
    assert.ok(state.requestedClayGrid, 'clay route did not report requested grid');
    assert.ok(state.effectiveClayGrid, 'clay route did not report effective grid');
    assert.ok(Array.isArray(state.clayGridConfigWarnings), 'clay route did not report grid config warnings');
    if (expectedGrid) {
      const expected = expectedGridTopology(expectedGrid);
      assert.ok(expected, `invalid --expected-grid ${expectedGrid}`);
      assert.equal(state.effectiveClayGrid, expected.grid, `effective grid did not match expected-grid ${expected.grid}`);
      assert.equal(state.clayGrid, expected.grid, `clay grid did not match expected-grid ${expected.grid}`);
      assert.equal(state.claySurfaceVertexCount, expected.vertexCount, `vertex count did not match expected-grid ${expected.grid}`);
      assert.equal(state.claySurfaceTriangleCount, expected.triangleCount, `triangle count did not match expected-grid ${expected.grid}`);
    }
    if (isCubeRoute) {
      assert.ok((state.clayCubeMaxDisplacement ?? 0) > 0.05, 'cube route did not show readable material-point displacement');
      assert.ok((state.clayCubeDeformedParticleCount ?? 0) > 0, 'cube route did not report deformed material points');
    } else if (isSculptRoute) {
      assert.ok((state.claySculptMaxDisplacement ?? 0) > 0.01, 'sculpt route did not show readable particle displacement');
      assert.ok((state.claySculptDeformedParticleCount ?? 0) > 0, 'sculpt route did not report deformed particles');
    } else {
      assert.ok((state.claySurfaceHeightRange ?? 0) > 0.05, 'clay surface height range did not show readable deformation');
      assert.ok((state.claySurfaceMeanAbsHeight ?? 0) > 0.01, 'clay mean absolute height did not show readable deformation');
    }
    if (url.includes('clay_debug_colliders=0')) {
      assert.equal(state.clayDebugCollidersVisible, false, 'quality witness did not hide debug colliders');
    }
    if (routeUsesPointerDrag) {
      assert.ok((state.clayPointerDragStepCount ?? 0) >= 3, 'pointer clay route did not run pointer-driven steps');
      assert.ok(['pointer_drag', 'pointer_idle'].includes(state.clayInteractionMode), `unexpected clay interaction mode: ${state.clayInteractionMode}`);
      assert.ok(state.clayPointerLastHit, 'pointer clay route did not record a pointer hit');
      assert.ok(Number.isFinite(state.clayPointerLastHit.x), 'pointer hit x did not reach clay debug state');
      assert.ok(Number.isFinite(state.clayPointerLastHit.y), 'pointer hit y did not reach clay debug state');
      assert.ok(Number.isFinite(state.clayPointerLastHit.z), 'pointer hit z did not reach clay debug state');
      if (isCubeRoute) {
        assert.equal(
          state.clayCubePlasticRestPolicy,
          'plastic-current-state-no-birth-shape-recovery-v0',
          'cube route did not report plastic rest-state/no-birth-recovery policy',
        );
        assert.equal(
          state.clayCubeCornerSofteningPolicy,
          'contacted-boundary-axis-corner-softening-v0',
          'cube route did not report contacted boundary-axis corner-softening policy',
        );
        assert.equal(state.clayPointerDepthPolicy, 'camera-ray-nearest-cube-surface', 'cube pointer hit used the wrong depth policy');
        assert.equal(state.clayPointerLastHit.depthPolicy, 'camera-ray-nearest-cube-surface', 'cube pointer hit did not preserve depth policy');
        assert.ok(Array.isArray(state.clayPointerLastHit.rawCenter), 'cube pointer hit did not preserve raw ray hit');
        assert.deepEqual(state.clayPointerLastHit.surfaceNormal, [0, 0, -1], 'cube front-face pointer hit did not preserve inward surface normal');
        assert.ok((state.clayPointerLastHit.rawCenter[2] ?? 0) > 0.25, 'cube pointer raw hit landed behind the visible front face');
        assert.ok(Math.abs(state.clayPointerLastHit.z - state.clayPointerLastHit.rawCenter[2]) <= 1e-6, 'cube pointer effective hit was inset from the raw cube face hit');
        assert.ok(Math.abs(state.clayPointerLastHit.y - state.clayPointerLastHit.rawCenter[1]) <= 1e-6, 'cube pointer effective hit lost ray-derived cube height');
        if (state.clayCubeVolumePreservationMode === 'volume_cells') {
          assert.ok(
            (state.clayCubeFrontBackDeformationRatio ?? 0) > 0.85,
            `volume-preserving cube pointer deformation became back-heavy: ${state.clayCubeFrontBackDeformationRatio}`,
          );
        } else {
          assert.ok((state.clayCubeFrontBackDeformationRatio ?? 0) > 1, `cube pointer brush deformation was not front-local: ${state.clayCubeFrontBackDeformationRatio}`);
        }
        assert.ok(Number.isFinite(state.clayCubeBrushToContactCentroidDistance), 'cube pointer brush/contact centroid distance missing');
        assert.ok(state.clayCubeBrushToContactCentroidDistance < 0.5, `cube pointer brush/contact centroid drifted too far: ${state.clayCubeBrushToContactCentroidDistance}`);
        if (cornerSmokeTarget === 'front_upper_right') {
          assert.ok((state.clayCubeEdgeBandDeformedParticleCount ?? 0) > 0, 'corner smoke did not exercise edge-band deformation');
          assert.ok((state.clayCubeCornerBandDeformedParticleCount ?? 0) > 0, 'corner smoke did not exercise corner-band deformation');
        }
      }
      const requestedBrushRadius = Number(new URL(url).searchParams.get('clay_brush_radius') || 0.17);
      const requestedBrushStrength = Number(new URL(url).searchParams.get('clay_brush_strength') || 0.45);
      const requestedBrushRampSteps = Number(new URL(url).searchParams.get('clay_brush_ramp_steps') || (isSculptRoute ? 24 : 0));
      const requestedBrushRampMinScale = Number(new URL(url).searchParams.get('clay_brush_ramp_min_scale') || (isSculptRoute ? 0.08 : 1));
      assert.ok(Math.abs(state.clayPointerLastHit.radius - requestedBrushRadius) <= 1e-6, 'pointer hit radius did not match route');
      assert.ok(Math.abs(state.clayPointerLastHit.requestedStrength - requestedBrushStrength) <= 1e-6, 'pointer hit requested strength did not match route');
      assert.equal(state.clayPointerLastHit.brushRampSteps, requestedBrushRampSteps, 'pointer hit ramp steps did not match route');
      assert.ok(Math.abs(state.clayPointerLastHit.brushRampMinScale - requestedBrushRampMinScale) <= 1e-6, 'sculpt brush ramp floor did not match route');
      assert.ok(Number.isFinite(state.clayPointerLastHit.strengthScale), 'pointer hit did not report strength scale');
      assert.ok(
        Math.abs(state.clayPointerLastHit.strength - requestedBrushStrength * state.clayPointerLastHit.strengthScale) <= 1e-6,
        'pointer hit strength did not match requested strength times ramp scale',
      );
      if (isSculptRoute && requestedBrushRampSteps > 0) {
        if (requestedBrushRampMinScale < 1) {
          assert.ok(state.clayPointerLastHit.strength < requestedBrushStrength, 'sculpt brush ramp did not reduce final pointer strength');
        }
        assert.ok(state.clayPointerLastHit.strengthScale >= requestedBrushRampMinScale, 'sculpt brush ramp fell below minimum usable force scale');
        assert.ok(state.clayPointerLastHit.strengthScale < 1 || requestedBrushRampMinScale >= 1, 'sculpt brush ramp reached full force during default smoke');
      } else {
        assert.ok(Math.abs(state.clayPointerLastHit.strength - requestedBrushStrength) <= 1e-6, 'pointer hit strength did not match route');
      }
    }
    if (url.includes('hand_pose_fixture') || handPosePayloadPath) {
      const expectedHandPose = injectedHandPosePayload || {
        requestedBackend: 'mlx',
        effectiveBackend: 'wilor-mlx-fixture',
        evidenceKind: 'synthetic',
      };
      assert.equal(state.requestedHandPoseBackend, expectedHandPose.requestedBackend, 'requested hand-pose backend did not reach clay debug state');
      assert.equal(state.effectiveHandPoseBackend, expectedHandPose.effectiveBackend, 'effective hand-pose backend did not reach clay debug state');
      assert.equal(state.handPoseEvidenceKind, expectedHandPose.evidenceKind, 'hand-pose evidence kind did not reach clay debug state');
      assert.equal(state.handPoseStale, false, 'fresh clay hand-pose fixture was marked stale');
      if (expectedHandPose.evidenceKind === 'stale_visual_only') {
        assert.equal(state.handPoseVisualOnly, true, 'stale visual-only payload did not preserve visual-only evidence flag');
      }
      if (expectedHandPose.source_backend) {
        assert.equal(state.sourceBackend, expectedHandPose.source_backend, 'source backend did not reach clay debug state');
      }
      if (Number.isFinite(expectedHandPose.sample_authority)) {
        assert.equal(state.sampleAuthority, expectedHandPose.sample_authority, 'sample authority did not reach clay debug state');
      }
      assert.equal(state.handPosePressureContract, 'clay_local_y_axis_drives_fingertip_pressure', 'Palm Daddy pressure contract missing from clay debug state');
      if (!handPosePayloadPath) {
        assert.ok(String(state.handPoseFrameId || '').startsWith('hand-pose-fixture-'), 'hand-pose frame id did not reach clay debug state');
      } else {
        assert.equal(String(state.handPoseFrameId), String(expectedHandPose.frameId), 'captured hand-pose frame id did not reach clay debug state');
      }
      assert.equal(state.handPoseHandCount, 1, 'clay hand-pose fixture did not report one hand');
      assert.equal(state.handPoseColliderCount, 5, 'clay hand-pose fixture did not emit fingertip colliders');
      assert.deepEqual(state.handPoseAdapterWarnings, [], 'clay hand-pose fixture emitted adapter warnings');
    }
    assert.ok((state.clayRelaxationFactor ?? 0) > 0, 'clay relaxation factor missing');
    assert.ok((state.clayPlasticityFactor ?? 0) > 0, 'clay plasticity factor missing');
    const expectedClayColliders = routeUsesPointerDrag
      ? 0
      : url.includes('clay_colliders=clay_edge_fixture')
        ? 2
        : 5;
    assert.ok((state.clayColliderCount ?? 0) >= expectedClayColliders, 'clay fixture did not seed expected colliders');
    if (isPointerDragRoute) {
      assert.ok((state.clayPointerDragStepCount ?? 0) >= 3, 'pointer clay route did not preserve pointer contact history');
    } else {
      assert.ok((state.clayContactCount ?? 0) > 0, 'clay route did not report contact');
    }
    assert.ok((state.clayDeformationCount ?? 0) > 0, 'clay route did not report deformation');
    await recordFrame('asserted-state');

    const earlyScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    const screenshotBuffer = Buffer.from(earlyScreenshot.data, 'base64');
    writeFileSync(out, screenshotBuffer);

    phase = 'pixels';
    const metrics = screenshotMetricsFromPng(screenshotBuffer);
    assert.ok(metrics.clayColorPixels > 400, `missing clay-colored visual evidence: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.brightOrangePixels < metrics.clayColorPixels * 0.35, `not fire: output is too orange/fire-like ${JSON.stringify(metrics)}`);
    const visualRecordingReport = finalizeVisualRecording();
    if (recordingEnabled) {
      assert.ok(visualRecordingReport.recordingFrameCount >= (routeUsesPointerDrag ? 6 : 2), `visual recording captured too few frames: ${visualRecordingReport.recordingFrameCount}`);
      assert.equal(visualRecordingReport.filmstripWritten, true, 'visual recording filmstrip was not written');
    }

    phase = 'screenshot';
    const report = {
      requestedRoute: url,
      windowSize,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      solverIdentity: state.solverIdentity,
      effectiveBackend: state.effectiveBackend,
      substrateEvidenceKind: state.substrateEvidenceKind,
      runtimeCpuFallback: state.runtimeCpuFallback,
      packagePrimitiveSourceContract: state.packagePrimitiveSourceContract,
      packagePrimitiveImportPath: state.packagePrimitiveImportPath,
      packagePrimitiveCommit: state.packagePrimitiveCommit,
      pointTriangleJobFloats: state.pointTriangleJobFloats,
      pointTriangleResultBytes: state.pointTriangleResultBytes,
      sharedPrimitiveProbeStatus: state.sharedPrimitiveProbeStatus,
      sharedPrimitiveProbeDistanceSq: state.sharedPrimitiveProbeDistanceSq,
      sharedPrimitiveProbeFeature: state.sharedPrimitiveProbeFeature,
      sharedPrimitiveProbeTriangleIndex: state.sharedPrimitiveProbeTriangleIndex,
      primitiveContactPassStatus: state.primitiveContactPassStatus,
      primitiveContactJobCount: state.primitiveContactJobCount,
      primitiveContactActiveCount: state.primitiveContactActiveCount,
      primitiveContactMinDistance: state.primitiveContactMinDistance,
      primitiveContactForceSum: state.primitiveContactForceSum,
      persistentClayStateStatus: state.persistentClayStateStatus,
      persistentClayStepCount: state.persistentClayStepCount,
      persistentClayMaxDelta: state.persistentClayMaxDelta,
      persistentClayDeltaHistory: state.persistentClayDeltaHistory,
      persistentClayInitialDelta: state.persistentClayInitialDelta,
      persistentClayLatestDelta: state.persistentClayLatestDelta,
      persistentClaySettlingRatio: state.persistentClaySettlingRatio,
      clayCubeEnabled: state.clayCubeEnabled,
      clayCubeSolverIdentity: state.clayCubeSolverIdentity,
      clayCubeStepStatus: state.clayCubeStepStatus,
      clayCubeEvidenceKind: state.clayCubeEvidenceKind,
      clayCubeOracleEvidenceKind: state.clayCubeOracleEvidenceKind,
      requestedClayCube: state.requestedClayCube,
      effectiveClayCube: state.effectiveClayCube,
      clayCubeConfigWarnings: state.clayCubeConfigWarnings,
      clayCubeGridDimension: state.clayCubeGridDimension,
      clayCubeParticleCount: state.clayCubeParticleCount,
      clayCubeActiveGridCellCount: state.clayCubeActiveGridCellCount,
      clayCubeDeformedParticleCount: state.clayCubeDeformedParticleCount,
      clayCubeContactParticleCount: state.clayCubeContactParticleCount,
      clayCubeMaxDisplacement: state.clayCubeMaxDisplacement,
      clayCubeMinY: state.clayCubeMinY,
      clayCubeMaxY: state.clayCubeMaxY,
      clayCubeHeightRange: state.clayCubeHeightRange,
      clayCubeReadbackWallMs: state.clayCubeReadbackWallMs,
      clayCubeDispatchWorkgroups: state.clayCubeDispatchWorkgroups,
      clayCubeSurfaceVisible: state.clayCubeSurfaceVisible,
      clayCubeBoundingBoxVisible: state.clayCubeBoundingBoxVisible,
      clayCubeBoundingBoxContract: state.clayCubeBoundingBoxContract,
      clayCubeDiagnosticColorMode: state.clayCubeDiagnosticColorMode,
      clayCubeDiagnosticColoredParticleCount: state.clayCubeDiagnosticColoredParticleCount,
      clayCubeDiagnosticHotParticleCount: state.clayCubeDiagnosticHotParticleCount,
      clayCubeIsoSurfaceVisible: state.clayCubeIsoSurfaceVisible,
      clayCubeIsoSurfaceEvidenceKind: state.clayCubeIsoSurfaceEvidenceKind,
      clayCubeIsoSurfaceVisibilityPolicy: state.clayCubeIsoSurfaceVisibilityPolicy,
      clayCubeIsoSurfaceResolution: state.clayCubeIsoSurfaceResolution,
      clayCubeIsoSurfaceBallCount: state.clayCubeIsoSurfaceBallCount,
      clayCubeIsoSurfaceTriangleCount: state.clayCubeIsoSurfaceTriangleCount,
      clayCubeBoundarySkinVisible: state.clayCubeBoundarySkinVisible,
      clayCubeBoundarySkinEvidenceKind: state.clayCubeBoundarySkinEvidenceKind,
      clayCubeBoundarySkinVisualMode: state.clayCubeBoundarySkinVisualMode,
      clayCubeBoundarySkinVertexCount: state.clayCubeBoundarySkinVertexCount,
      clayCubeBoundarySkinSharedVertexCount: state.clayCubeBoundarySkinSharedVertexCount,
      clayCubeBoundarySkinTriangleCount: state.clayCubeBoundarySkinTriangleCount,
      clayCubeVisibleSurfaceSource: state.clayCubeVisibleSurfaceSource,
      clayCubeSurfaceSourceDebug: state.clayCubeSurfaceSourceDebug,
      clayCubeBoundarySkinCullingPolicy: state.clayCubeBoundarySkinCullingPolicy,
      clayCubeBoundarySkinCulledTriangleCount: state.clayCubeBoundarySkinCulledTriangleCount,
      clayCubeBoundarySkinFairingPolicy: state.clayCubeBoundarySkinFairingPolicy,
      clayCubeBoundarySkinRawRoughness: state.clayCubeBoundarySkinRawRoughness,
      clayCubeBoundarySkinRoughness: state.clayCubeBoundarySkinRoughness,
      clayCubeBoundarySkinMaxFairingDisplacement: state.clayCubeBoundarySkinMaxFairingDisplacement,
      clayCubeFaceMetricEvidenceKind: state.clayCubeFaceMetricEvidenceKind,
      clayCubePlasticRestPolicy: state.clayCubePlasticRestPolicy,
      clayCubeCornerSofteningPolicy: state.clayCubeCornerSofteningPolicy,
      clayCubeVolumePreservationMode: state.clayCubeVolumePreservationMode,
      clayCubeVolumePreservationPolicy: state.clayCubeVolumePreservationPolicy,
      clayCubeVolumeProxyEvidenceKind: state.clayCubeVolumeProxyEvidenceKind,
      clayCubeBaseVolumeProxy: state.clayCubeBaseVolumeProxy,
      clayCubeVolumeProxy: state.clayCubeVolumeProxy,
      clayCubeVolumeRatio: state.clayCubeVolumeRatio,
      clayCubeVolumeCompensationCount: state.clayCubeVolumeCompensationCount,
      clayCubeCellVolumeEvidenceKind: state.clayCubeCellVolumeEvidenceKind,
      clayCubeCellVolumeMeanRelativeErrorBefore: state.clayCubeCellVolumeMeanRelativeErrorBefore,
      clayCubeCellVolumeMeanRelativeErrorAfter: state.clayCubeCellVolumeMeanRelativeErrorAfter,
      clayCubeCellVolumeMaxRelativeErrorBefore: state.clayCubeCellVolumeMaxRelativeErrorBefore,
      clayCubeCellVolumeMaxRelativeErrorAfter: state.clayCubeCellVolumeMaxRelativeErrorAfter,
      clayCubeVolumeCellConstraintIterationCount: state.clayCubeVolumeCellConstraintIterationCount,
      clayCubeVolumeCellConstrainedCellCount: state.clayCubeVolumeCellConstrainedCellCount,
      clayCubeFrontFaceDeformedParticleCount: state.clayCubeFrontFaceDeformedParticleCount,
      clayCubeBackFaceDeformedParticleCount: state.clayCubeBackFaceDeformedParticleCount,
      clayCubeFrontBackDeformationRatio: state.clayCubeFrontBackDeformationRatio,
      clayCubeEdgeBandDeformedParticleCount: state.clayCubeEdgeBandDeformedParticleCount,
      clayCubeCornerBandDeformedParticleCount: state.clayCubeCornerBandDeformedParticleCount,
      clayCubeMaxDisplacementFace: state.clayCubeMaxDisplacementFace,
      clayCubeDeformationCentroid: state.clayCubeDeformationCentroid,
      clayCubeContactCentroid: state.clayCubeContactCentroid,
      clayCubeBrushCentroid: state.clayCubeBrushCentroid,
      clayCubeBrushToDeformationCentroidDistance: state.clayCubeBrushToDeformationCentroidDistance,
      clayCubeBrushToContactCentroidDistance: state.clayCubeBrushToContactCentroidDistance,
      claySculptEnabled: state.claySculptEnabled,
      claySculptSolverIdentity: state.claySculptSolverIdentity,
      claySculptStepStatus: state.claySculptStepStatus,
      claySculptEvidenceKind: state.claySculptEvidenceKind,
      requestedClaySculptParticles: state.requestedClaySculptParticles,
      effectiveClaySculptParticles: state.effectiveClaySculptParticles,
      claySculptConfigWarnings: state.claySculptConfigWarnings,
      claySculptParticleCount: state.claySculptParticleCount,
      claySculptHashGridContract: state.claySculptHashGridContract,
      claySculptHashGridEvidenceKind: state.claySculptHashGridEvidenceKind,
      claySculptOracleEvidenceKind: state.claySculptOracleEvidenceKind,
      claySculptHashGridDimension: state.claySculptHashGridDimension,
      claySculptHashGridCellCapacity: state.claySculptHashGridCellCapacity,
      claySculptActiveCellCount: state.claySculptActiveCellCount,
      claySculptMaxCellOccupancy: state.claySculptMaxCellOccupancy,
      claySculptOverflowCount: state.claySculptOverflowCount,
      claySculptNeighborSampleCount: state.claySculptNeighborSampleCount,
      claySculptAverageNeighborCount: state.claySculptAverageNeighborCount,
      claySculptContactParticleCount: state.claySculptContactParticleCount,
      claySculptDeformedParticleCount: state.claySculptDeformedParticleCount,
      claySculptMaxDisplacement: state.claySculptMaxDisplacement,
      claySculptNeighborCohesionDisplacement: state.claySculptNeighborCohesionDisplacement,
      claySculptReadbackWallMs: state.claySculptReadbackWallMs,
      claySculptDispatchWorkgroups: state.claySculptDispatchWorkgroups,
      claySculptPointCloudVisible: state.claySculptPointCloudVisible,
      claySculptSurfaceVisible: state.claySculptSurfaceVisible,
      claySculptSurfaceEvidenceKind: state.claySculptSurfaceEvidenceKind,
      claySculptSurfaceVisualMode: state.claySculptSurfaceVisualMode,
      claySculptSurfaceResolution: state.claySculptSurfaceResolution,
      claySculptSurfaceBallCount: state.claySculptSurfaceBallCount,
      claySculptSurfaceVertexCount: state.claySculptSurfaceVertexCount,
      claySculptSurfaceTriangleCount: state.claySculptSurfaceTriangleCount,
      claySculptSurfaceNeedsRefresh: state.claySculptSurfaceNeedsRefresh,
      claySculptSurfaceUpdateStepInterval: state.claySculptSurfaceUpdateStepInterval,
      claySculptSurfaceUpdateCount: state.claySculptSurfaceUpdateCount,
      claySculptSurfaceSkippedUpdateCount: state.claySculptSurfaceSkippedUpdateCount,
      clayTimingEvidenceSource: state.clayTimingEvidenceSource,
      clayTimingDisclaimer: state.clayTimingDisclaimer,
      clayPhaseTimingDisclaimer: state.clayPhaseTimingDisclaimer,
      clayTimingWarmupPolicy: state.clayTimingWarmupPolicy,
      clayWarmupStepCount: state.clayWarmupStepCount,
      clayStepDurationHistory: state.clayStepDurationHistory,
      claySteadyStepDurationHistory: state.claySteadyStepDurationHistory,
      clayStepLatestMs: state.clayStepLatestMs,
      clayStepP95Ms: state.clayStepP95Ms,
      clayStepSampleCount: state.clayStepSampleCount,
      claySteadyStepP50Ms: state.claySteadyStepP50Ms,
      claySteadyStepP95Ms: state.claySteadyStepP95Ms,
      claySteadyStepSampleCount: state.claySteadyStepSampleCount,
      clayStepMaxOutlierMs: state.clayStepMaxOutlierMs,
      clayContactWallMs: state.clayContactWallMs,
      clayColliderPrepWallMs: state.clayColliderPrepWallMs,
      clayLatticeReadbackWallMs: state.clayLatticeReadbackWallMs,
      clayCpuMeshUpdateMs: state.clayCpuMeshUpdateMs,
      clayNormalUpdateMs: state.clayNormalUpdateMs,
      clayNormalCadence: state.clayNormalCadence,
      clayNormalCadenceWarnings: state.clayNormalCadenceWarnings,
      clayNormalUpdateCount: state.clayNormalUpdateCount,
      clayNormalSkippedCount: state.clayNormalSkippedCount,
      clayNormalsStale: state.clayNormalsStale,
      clayStepTotalWallMs: state.clayStepTotalWallMs,
      clayCpuShadowBenchmarkEnabled: state.clayCpuShadowBenchmarkEnabled,
      clayCpuShadowEvidenceKind: state.clayCpuShadowEvidenceKind,
      clayCpuShadowEstimateMs: state.clayCpuShadowEstimateMs,
      clayCpuShadowRatio: state.clayCpuShadowRatio,
      clayCpuShadowSampleCount: state.clayCpuShadowSampleCount,
      clayCpuShadowChecksum: state.clayCpuShadowChecksum,
      clayCpuContactShadowEstimateMs: state.clayCpuContactShadowEstimateMs,
      clayCpuContactShadowRatio: state.clayCpuContactShadowRatio,
      clayCpuContactShadowSampleCount: state.clayCpuContactShadowSampleCount,
      clayCpuContactShadowChecksum: state.clayCpuContactShadowChecksum,
      claySurfaceMinY: state.claySurfaceMinY,
      claySurfaceMaxY: state.claySurfaceMaxY,
      claySurfaceHeightRange: state.claySurfaceHeightRange,
      claySurfaceMeanAbsHeight: state.claySurfaceMeanAbsHeight,
      clayBrushBoundaryPolicy: state.clayBrushBoundaryPolicy,
      clayBrushBoundaryEdgeFalloff: state.clayBrushBoundaryEdgeFalloff,
      clayBrushBoundaryClampCount: state.clayBrushBoundaryClampCount,
      clayBrushBoundaryWarnings: state.clayBrushBoundaryWarnings,
      claySurfaceVertexCount: state.claySurfaceVertexCount,
      claySurfaceTriangleCount: state.claySurfaceTriangleCount,
      requestedClayGrid: state.requestedClayGrid,
      effectiveClayGrid: state.effectiveClayGrid,
      clayGridConfigWarnings: state.clayGridConfigWarnings,
      clayDebugCollidersVisible: state.clayDebugCollidersVisible,
      clayInteractionMode: state.clayInteractionMode,
      clayPointerActive: state.clayPointerActive,
      clayPointerColliderCount: state.clayPointerColliderCount,
      clayPointerDragStepCount: state.clayPointerDragStepCount,
      clayPointerDepthPolicy: state.clayPointerDepthPolicy,
      clayPointerLastHit: state.clayPointerLastHit,
      requestedHandPoseBackend: state.requestedHandPoseBackend,
      effectiveHandPoseBackend: state.effectiveHandPoseBackend,
      handPoseEvidenceKind: state.handPoseEvidenceKind,
      handPoseStale: state.handPoseStale,
      handPoseVisualOnly: state.handPoseVisualOnly,
      handPoseFrameId: state.handPoseFrameId,
      handPoseHandCount: state.handPoseHandCount,
      handPoseColliderCount: state.handPoseColliderCount,
      handPoseAdapterWarnings: state.handPoseAdapterWarnings,
      sourceBackend: state.sourceBackend,
      sampleAgeMs: state.sampleAgeMs,
      sampleAuthority: state.sampleAuthority,
      handPosePressureContract: state.handPosePressureContract,
      handPosePayloadPath,
      handPosePayloadReplay,
      clayRelaxationFactor: state.clayRelaxationFactor,
      clayPlasticityFactor: state.clayPlasticityFactor,
      clayColliderCount: state.clayColliderCount,
      clayContactCount: state.clayContactCount,
      clayDeformationCount: state.clayDeformationCount,
      clayDeformationMax: state.clayDeformationMax,
      gpuStepCount: state.gpuStepCount,
      clayColorPixels: metrics.clayColorPixels,
      brightOrangePixels: metrics.brightOrangePixels,
      litPixels: metrics.litPixels,
      visualRecording: visualRecordingReport,
      sculptOrbitProbe,
      recordingFrameCount: visualRecordingReport.recordingFrameCount,
      recordingFrames: visualRecordingReport.recordingFrames,
      filmstrip: visualRecordingReport.filmstrip,
      filmstripWritten: visualRecordingReport.filmstripWritten,
      visualVerdict: isCubeRoute
        ? 'webgpu clay cube diagnostic skin visible; old surface hidden; not fire'
        : 'webgpu clay surface visible; not fire',
      screenshot: out,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    ws.close();
    proc.kill('SIGTERM');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    let failureState = null;
    let failureScreenshotWritten = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: 'window.__kaminosClayPrototype?.debugState?.()',
          returnByValue: true,
        });
        failureState = stateEval.result?.value || null;
      } catch {
        failureState = null;
      }
      try {
        const failureScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
        writeFileSync(out, Buffer.from(failureScreenshot.data, 'base64'));
        failureScreenshotWritten = true;
        await recordFrame('failure');
      } catch {
        failureScreenshotWritten = false;
      }
      try {
        finalizeVisualRecording();
      } catch {
        filmstripWritten = false;
      }
      ws.close();
    }
    const report = {
      requestedRoute: url,
      windowSize,
      phase,
      error: err?.message || String(err),
      screenshot: out,
      screenshotWritten: failureScreenshotWritten,
      visualRecording: visualRecording(),
      sculptOrbitProbe,
      recordingFrameCount: recordingFrames.length,
      recordingFrames: recordingFrames.slice(),
      filmstrip: recordingFilmstripPath,
      filmstripWritten,
      failureState,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    proc.kill('SIGTERM');
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, '1');
  }
}

const requestedSource = args.get('--source') || '';
const url = args.get('--url') || 'http://127.0.0.1:8095/';
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-glb-viewset');
const manifestPath = resolve(args.get('--manifest') || `${outDir}/viewset-manifest.json`);
const atlasPath = resolve(args.get('--atlas') || `${outDir}/viewset-atlas.png`);
const impostorManifestPath = resolve(args.get('--impostor-manifest') || `${outDir}/impostor-manifest.json`);
const maskThreshold = clamp01(Number(args.get('--mask-threshold') || 0.08));
const maskMode = args.get('--mask-mode') || 'dual-background';
const chromaKeyColor = args.get('--chroma-key-color') || '#ff00ff';
const angles = parseNumberList(args.get('--angles') || '0,45,90,135,180,225,270,315');
const elevation = Number(args.get('--elevation') || 18);
const elevations = args.has('--elevations') ? parseNumberList(args.get('--elevations')) : [elevation].filter(value => Number.isFinite(value));
const radius = Number(args.get('--radius') || 3.2);
const renderConditions = {
  environment: args.get('--environment') || null,
  exposure: optionalNumber(args.get('--exposure')),
  envIntensity: optionalNumber(args.get('--env-intensity')),
  envRotation: optionalNumber(args.get('--env-rotation')),
  captureBackground: args.get('--capture-background') || 'transparent',
};
const width = Math.max(64, Math.floor(Number(args.get('--width') || 1024)));
const height = Math.max(64, Math.floor(Number(args.get('--height') || 1024)));
const settleMs = Math.max(0, Math.floor(Number(args.get('--settle-ms') || 450)));
const port = Number(args.get('--debug-port') || 9457);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-glb-viewset-profile-${port}-${process.pid}`;
const label = args.get('--label') || null;

let phase = 'initializing';
let stderr = '';
let effectiveUrl = null;
let browserVersion = null;
const frames = [];
let lastEvidence = {};

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberList(value) {
  return String(value)
    .split(',')
    .map(part => Number(part.trim()))
    .filter(valuePart => Number.isFinite(valuePart));
}

function sourcePathCandidate(source) {
  if (!source) return null;
  if (source.startsWith('file://')) return new URL(source).pathname;
  if (isAbsolute(source) && existsSync(source)) return source;
  return null;
}

function hashFile(path) {
  if (!path || !existsSync(path)) return null;
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function pngMagic(buffer) {
  return buffer.subarray(0, 8).toString('hex');
}

function pngInfo(buffer) {
  const magic = pngMagic(buffer);
  if (magic !== '89504e470d0a1a0a') return { pngMagic: magic };
  return {
    pngMagic: magic,
    pngWidth: buffer.readUInt32BE(16),
    pngHeight: buffer.readUInt32BE(20),
    pngBitDepth: buffer[24],
    pngColorType: buffer[25],
    hasAlphaChannel: buffer[25] === 4 || buffer[25] === 6,
  };
}

function assertPngScreenshot(buffer) {
  if (buffer.length <= 1024) throw new Error('screenshot is too small to be credible visual evidence');
  const magic = pngMagic(buffer);
  if (magic !== '89504e470d0a1a0a') throw new Error(`screenshot is not a PNG: ${magic}`);
  return magic;
}

function formatAngleLabel(value) {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? 'm' : 'p';
  return `${sign}${String(Math.abs(rounded)).padStart(3, '0')}`;
}

function viewsetFramePath(index, angle, elevationDeg) {
  const normalizedAzimuth = String(Math.round(normalizeAngle(angle))).padStart(3, '0');
  const normalizedElevation = formatAngleLabel(elevationDeg);
  return resolve(outDir, `view-${String(index).padStart(2, '0')}-az${normalizedAzimuth}-el${normalizedElevation}.png`);
}

function normalizeAngle(angle) {
  return ((Number(angle) % 360) + 360) % 360;
}

function cameraForAngle(angleDeg, elevationDeg = elevation) {
  const az = angleDeg * Math.PI / 180;
  const el = elevationDeg * Math.PI / 180;
  const horizontal = Math.cos(el) * radius;
  return {
    position: [
      Number((Math.sin(az) * horizontal).toFixed(5)),
      Number((Math.sin(el) * radius).toFixed(5)),
      Number((Math.cos(az) * horizontal).toFixed(5)),
    ],
    target: [0, 0, 0],
  };
}

function normalizedVector(from, to = [0, 0, 0]) {
  const vector = [
    Number(from[0] || 0) - Number(to[0] || 0),
    Number(from[1] || 0) - Number(to[1] || 0),
    Number(from[2] || 0) - Number(to[2] || 0),
  ];
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return vector.map(value => Number((value / length).toFixed(6)));
}

function viewVectorLocalForCamera(camera) {
  return normalizedVector(camera.position || [0, 0, radius], camera.target || [0, 0, 0]);
}

function chromaKeyRgb(color) {
  const text = String(color || '#ff00ff').trim();
  const hex = text.startsWith('#') ? text.slice(1) : text;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return { r: 255, g: 0, b: 255 };
}

function writeManifest(report) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  const sourcePath = sourcePathCandidate(requestedSource);
  writeFileSync(manifestPath, JSON.stringify({
    schema: 'kaminos.glb-viewset-bake.v0',
    requestedSource,
    effectiveSource: requestedSource,
    sourcePath,
    sourceSha256: hashFile(sourcePath),
    requestedUrl: url,
    effectiveUrl,
    outDir,
    manifestPath,
    angles,
    elevation,
    elevations,
    radius,
    renderConditions,
    width,
    height,
    settleMs,
    transparentBackground: true,
    alphaMode: lastEvidence.alphaMode || null,
    atlasPath,
    impostorManifestPath,
    maskThreshold,
    maskMode,
    chromaKeyColor,
    debugPort: port,
    chrome,
    userDataDir,
    phase,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    frames: frames,
    ...lastEvidence,
    ...report,
  }, null, 2));
}

function fail(error) {
  writeManifest({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function isCdpEndpointOpen() {
  try {
    await cdpFetch('/json/version', { signal: AbortSignal.timeout(300) });
    return true;
  } catch {
    return false;
  }
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
  }, { timeoutMs: options.timeoutMs || 10000 });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function viewportClip(ws) {
  return evaluate(ws, `(() => {
    const canvas = document.querySelector('#viewport canvas') || document.querySelector('canvas');
    const element = canvas || document.querySelector('#viewport');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top),
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      scale: 1
    };
  })()`);
}

async function rawPngScreenshot(ws, clip, options = {}) {
  if (lastEvidence.activeCapture) {
    lastEvidence.activeCapture = {
      ...lastEvidence.activeCapture,
      subphase: 'rendering-capture-frame',
    };
  }
  await evaluate(ws, `window.kaminosViewsetRenderCaptureFrame && window.kaminosViewsetRenderCaptureFrame(${JSON.stringify({
    captureBackground: options.captureBackground,
  })})`, { timeoutMs: 60000 });
  if (lastEvidence.activeCapture) {
    lastEvidence.activeCapture = {
      ...lastEvidence.activeCapture,
      subphase: 'page-capture-screenshot',
    };
  }
  const omitBackground = options.omitBackground ?? true;
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true, omitBackground, clip: clip || undefined }, { timeoutMs: 60000 });
  const png = Buffer.from(shot.data, 'base64');
  assertPngScreenshot(png);
  return { dataBase64: shot.data, png };
}

async function capturePngScreenshot(ws, screenshotPath, clip) {
  if (maskMode === 'dual-background') {
    return captureDualBackgroundMatte(ws, screenshotPath, clip);
  }
  if (maskMode === 'chroma-key') {
    return captureChromaKeyMatte(ws, screenshotPath, clip);
  }
  const shot = await rawPngScreenshot(ws, clip);
  const png = shot.png;
  const info = pngInfo(png);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, png);
  const alpha = await analyzePngAlpha(ws, shot.dataBase64, maskThreshold, info);
  return { path: screenshotPath, bytes: png.length, dataBase64: shot.dataBase64, ...info, ...alpha };
}

async function captureChromaKeyMatte(ws, screenshotPath, clip) {
  const keyed = await rawPngScreenshot(ws, clip, { omitBackground: false, captureBackground: chromaKeyColor });
  await setCaptureBackground(ws, 'transparent');
  const matte = await synthesizeChromaKeyMatte(ws, keyed.dataBase64, chromaKeyColor, maskThreshold);
  const png = Buffer.from(matte.dataBase64, 'base64');
  assertPngScreenshot(png);
  const info = pngInfo(png);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, png);
  return {
    path: screenshotPath,
    bytes: png.length,
    dataBase64: matte.dataBase64,
    ...info,
    alphaMode: 'chroma-key-matte',
    alphaCoverage: matte.alphaCoverage,
    opaqueCoverage: matte.opaqueCoverage,
    transparentPixels: matte.transparentPixels,
    opaquePixels: matte.opaquePixels,
    maskThreshold,
    chromaKeyColor,
    objectBounds: matte.objectBounds,
  };
}

async function synthesizeChromaKeyMatte(ws, sourceBase64, keyColor, threshold) {
  const keyRgb = chromaKeyRgb(keyColor);
  return evaluate(ws, `(() => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, width, height);
        const kr = ${keyRgb.r};
        const kg = ${keyRgb.g};
        const kb = ${keyRgb.b};
        const thresholdDistance = Math.max(0, Math.min(1, ${JSON.stringify(threshold)})) * Math.sqrt(3) * 255;
        let transparent = 0;
        let opaque = 0;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        for (let offset = 0, pixel = 0; offset < pixels.data.length; offset += 4, pixel += 1) {
          const dr = pixels.data[offset] - kr;
          const dg = pixels.data[offset + 1] - kg;
          const db = pixels.data[offset + 2] - kb;
          const distance = Math.hypot(dr, dg, db);
          if (distance <= thresholdDistance) {
            transparent += 1;
            pixels.data[offset] = 0;
            pixels.data[offset + 1] = 0;
            pixels.data[offset + 2] = 0;
            pixels.data[offset + 3] = 0;
            continue;
          }
          opaque += 1;
          pixels.data[offset + 3] = 255;
          const x = pixel % width;
          const y = Math.floor(pixel / width);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
        ctx.putImageData(pixels, 0, 0);
        const total = width * height;
        resolve({
          dataBase64: canvas.toDataURL('image/png').split(',')[1],
          alphaCoverage: Number((transparent / total).toFixed(6)),
          opaqueCoverage: Number((opaque / total).toFixed(6)),
          transparentPixels: transparent,
          opaquePixels: opaque,
          objectBounds: opaque > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
        });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('chroma-key source failed to decode'));
    image.src = 'data:image/png;base64,' + ${JSON.stringify(sourceBase64)};
  }))()`, { timeoutMs: 20000 });
}

async function setCaptureBackground(ws, color) {
  return evaluate(ws, `window.kaminosSetViewsetCaptureBackground(${JSON.stringify(color)})`);
}

async function captureDualBackgroundMatte(ws, screenshotPath, clip) {
  const black = await rawPngScreenshot(ws, clip, { omitBackground: false, captureBackground: '#000000' });
  const white = await rawPngScreenshot(ws, clip, { omitBackground: false, captureBackground: '#ffffff' });
  await setCaptureBackground(ws, 'transparent');
  const matte = await synthesizeDualBackgroundMatte(ws, black.dataBase64, white.dataBase64, maskThreshold);
  const png = Buffer.from(matte.dataBase64, 'base64');
  assertPngScreenshot(png);
  const info = pngInfo(png);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, png);
  return {
    path: screenshotPath,
    bytes: png.length,
    dataBase64: matte.dataBase64,
    ...info,
    alphaMode: 'dual-background-matte',
    alphaCoverage: matte.alphaCoverage,
    opaqueCoverage: matte.opaqueCoverage,
    transparentPixels: matte.transparentPixels,
    opaquePixels: matte.opaquePixels,
    maskThreshold,
    objectBounds: matte.objectBounds,
  };
}

async function synthesizeDualBackgroundMatte(ws, blackBase64, whiteBase64, threshold) {
  return evaluate(ws, `(() => new Promise((resolve, reject) => {
    function loadImage(source) {
      return new Promise((resolveImage, rejectImage) => {
        const image = new Image();
        image.onload = () => resolveImage(image);
        image.onerror = () => rejectImage(new Error('dual-background source failed to decode'));
        image.src = 'data:image/png;base64,' + source;
      });
    }
    Promise.all([loadImage(${JSON.stringify(blackBase64)}), loadImage(${JSON.stringify(whiteBase64)})]).then(([black, white]) => {
      const width = black.naturalWidth;
      const height = black.naturalHeight;
      if (white.naturalWidth !== width || white.naturalHeight !== height) {
        throw new Error('dual-background frame dimensions differ');
      }
      const blackCanvas = document.createElement('canvas');
      const whiteCanvas = document.createElement('canvas');
      const outCanvas = document.createElement('canvas');
      blackCanvas.width = whiteCanvas.width = outCanvas.width = width;
      blackCanvas.height = whiteCanvas.height = outCanvas.height = height;
      const blackCtx = blackCanvas.getContext('2d', { willReadFrequently: true });
      const whiteCtx = whiteCanvas.getContext('2d', { willReadFrequently: true });
      const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
      blackCtx.drawImage(black, 0, 0);
      whiteCtx.drawImage(white, 0, 0);
      const blackPixels = blackCtx.getImageData(0, 0, width, height).data;
      const whitePixels = whiteCtx.getImageData(0, 0, width, height).data;
      const out = outCtx.createImageData(width, height);
      const thresholdByte = Math.max(0, Math.min(255, Math.round(${JSON.stringify(threshold)} * 255)));
      let transparent = 0;
      let opaque = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let offset = 0, pixel = 0; offset < out.data.length; offset += 4, pixel += 1) {
        const dr = whitePixels[offset] - blackPixels[offset];
        const dg = whitePixels[offset + 1] - blackPixels[offset + 1];
        const db = whitePixels[offset + 2] - blackPixels[offset + 2];
        const backgroundLeak = Math.max(0, Math.min(255, dr, dg, db));
        let alpha = Math.max(0, Math.min(255, 255 - backgroundLeak));
        if (alpha <= thresholdByte) alpha = 0;
        if (alpha === 0) {
          transparent += 1;
          out.data[offset] = 0;
          out.data[offset + 1] = 0;
          out.data[offset + 2] = 0;
          out.data[offset + 3] = 0;
          continue;
        }
        opaque += 1;
        const scale = 255 / alpha;
        out.data[offset] = Math.max(0, Math.min(255, Math.round(blackPixels[offset] * scale)));
        out.data[offset + 1] = Math.max(0, Math.min(255, Math.round(blackPixels[offset + 1] * scale)));
        out.data[offset + 2] = Math.max(0, Math.min(255, Math.round(blackPixels[offset + 2] * scale)));
        out.data[offset + 3] = alpha;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      outCtx.putImageData(out, 0, 0);
      const total = Math.max(1, transparent + opaque);
      resolve({
        dataBase64: outCanvas.toDataURL('image/png').split(',')[1],
        alphaCoverage: Number((transparent / total).toFixed(6)),
        opaqueCoverage: Number((opaque / total).toFixed(6)),
        transparentPixels: transparent,
        opaquePixels: opaque,
        objectBounds: opaque > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null
      });
    }).catch(reject);
  }))()`, { timeoutMs: 30000 });
}

async function analyzePngAlpha(ws, dataBase64, threshold, info) {
  return evaluate(ws, `(() => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const thresholdByte = Math.max(0, Math.min(255, Math.round(${JSON.stringify(threshold)} * 255)));
        let transparent = 0;
        let opaque = 0;
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;
        for (let offset = 3, pixel = 0; offset < pixels.length; offset += 4, pixel += 1) {
          const alpha = pixels[offset];
          if (alpha <= thresholdByte) {
            transparent += 1;
          } else {
            opaque += 1;
            const x = pixel % canvas.width;
            const y = Math.floor(pixel / canvas.width);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
        const total = Math.max(1, opaque + transparent);
        resolve({
          alphaMode: ${JSON.stringify(info.hasAlphaChannel ? 'png-alpha-channel' : 'png-no-alpha-channel')},
          alphaCoverage: Number((transparent / total).toFixed(6)),
          opaqueCoverage: Number((opaque / total).toFixed(6)),
          transparentPixels: transparent,
          opaquePixels: opaque,
          maskThreshold: ${JSON.stringify(threshold)},
          objectBounds: opaque > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null
        });
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error('frame PNG failed to decode for alpha analysis'));
    img.src = 'data:image/png;base64,${dataBase64}';
  }))()`, { timeoutMs: 20000 });
}

function composeAtlasWithFfmpeg(frameCaptures, columns, rows, cellWidth, cellHeight) {
  const atlasWidth = columns * cellWidth;
  const atlasHeight = rows * cellHeight;
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black@0.0:s=${atlasWidth}x${atlasHeight},format=rgba`,
  ];
  for (const frame of frameCaptures) args.push('-i', frame.path);

  let prior = '[0:v]';
  const filters = [];
  for (let index = 0; index < frameCaptures.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const out = index === frameCaptures.length - 1 ? '[out]' : `[tmp${index}]`;
    filters.push(`${prior}[${index + 1}:v]overlay=x=${column * cellWidth}:y=${row * cellHeight}:format=auto${out}`);
    prior = out;
  }

  mkdirSync(dirname(atlasPath), { recursive: true });
  const result = spawnSync('ffmpeg', [
    ...args,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-frames:v',
    '1',
    '-pix_fmt',
    'rgba',
    atlasPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg atlas composition failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  const png = readFileSync(atlasPath);
  assertPngScreenshot(png);
  return {
    atlasPath,
    atlasBytes: png.length,
    atlasPngMagic: pngMagic(png),
    atlasColumns: columns,
    atlasRows: rows,
    atlasCellWidth: cellWidth,
    atlasCellHeight: cellHeight,
    atlasWidth,
    atlasHeight,
    atlasComposer: 'ffmpeg-overlay',
  };
}

async function composeAtlasInBrowser(ws, frameCaptures, columns, rows, cellWidth, cellHeight) {
  const atlasBase64 = await evaluate(ws, `(() => new Promise((resolve, reject) => {
    const sources = ${JSON.stringify(frameCaptures.map(frame => frame.dataBase64))};
    const columns = ${columns};
    const cellWidth = ${cellWidth};
    const cellHeight = ${cellHeight};
    const rows = ${rows};
    Promise.all(sources.map(source => new Promise((resolveImage, rejectImage) => {
      const image = new Image();
      image.onload = () => resolveImage(image);
      image.onerror = () => rejectImage(new Error('atlas source frame failed to decode'));
      image.src = 'data:image/png;base64,' + source;
    }))).then(images => {
      const canvas = document.createElement('canvas');
      canvas.width = columns * cellWidth;
      canvas.height = rows * cellHeight;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      images.forEach((image, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        ctx.drawImage(image, column * cellWidth, row * cellHeight);
      });
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    }).catch(reject);
  }))()`, { timeoutMs: 60000 });
  const png = Buffer.from(atlasBase64, 'base64');
  assertPngScreenshot(png);
  mkdirSync(dirname(atlasPath), { recursive: true });
  writeFileSync(atlasPath, png);
  return {
    atlasPath,
    atlasBytes: png.length,
    atlasPngMagic: pngMagic(png),
    atlasColumns: columns,
    atlasRows: rows,
    atlasCellWidth: cellWidth,
    atlasCellHeight: cellHeight,
    atlasWidth: columns * cellWidth,
    atlasHeight: rows * cellHeight,
    atlasComposer: 'browser-canvas',
  };
}

async function composeAtlasPng(ws, frameCaptures) {
  if (!frameCaptures.length) throw new Error('Cannot compose atlas with no frames');
  const columns = Math.ceil(Math.sqrt(frameCaptures.length));
  const rows = Math.ceil(frameCaptures.length / columns);
  const cellWidth = Math.max(...frameCaptures.map(frame => frame.pngWidth || width));
  const cellHeight = Math.max(...frameCaptures.map(frame => frame.pngHeight || height));
  try {
    return composeAtlasWithFfmpeg(frameCaptures, columns, rows, cellWidth, cellHeight);
  } catch (error) {
    lastEvidence.atlasComposerFallback = error instanceof Error ? error.message : String(error);
    return composeAtlasInBrowser(ws, frameCaptures, columns, rows, cellWidth, cellHeight);
  }
}

function writeImpostorManifest(report) {
  mkdirSync(dirname(impostorManifestPath), { recursive: true });
  const sourcePath = sourcePathCandidate(requestedSource);
  const impostorManifest = {
    schema: 'kaminos.glb-impostor-atlas.v0',
    requestedSource,
    effectiveSource: requestedSource,
    sourcePath,
    sourceSha256: hashFile(sourcePath),
    requestedUrl: url,
    effectiveUrl,
    label,
    atlasPath: report.atlas?.atlasPath || atlasPath,
    atlasSha256: hashFile(report.atlas?.atlasPath || atlasPath),
    atlas: report.atlas || null,
    alphaMode: report.alphaMode,
    maskThreshold,
    chromaKeyColor: maskMode === 'chroma-key' ? chromaKeyColor : null,
    elevation,
    elevations,
    radius,
    renderConditions: report.renderConditions || lastEvidence.renderConditions || renderConditions,
    frames: report.frames || frames,
    sourceManifestPath: manifestPath,
  };
  writeFileSync(impostorManifestPath, JSON.stringify({ impostorManifest }, null, 2));
  return { impostorManifestPath, impostorManifest };
}

async function main() {
  phase = 'validating-args';
  if (!requestedSource) throw new Error('Missing --source');
  if (!angles.length) throw new Error('No valid --angles values');
  if (!elevations.length) throw new Error('No valid --elevations values');

  phase = 'checking-debug-port';
  if (await isCdpEndpointOpen()) throw new Error(`CDP debug port already in use before launch: ${port}`);

  phase = 'launching-chrome';
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate,OptimizationHints',
    '--enable-unsafe-webgpu',
    `--window-size=${width},${height}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  chromeProcess.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    browserVersion = await waitForCdp();
    const tabs = await cdpFetch('/json');
    const page = tabs.find(tab => tab.type === 'page') || tabs[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('No Chrome page websocket available');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wsRequest(ws, 'Page.navigate', { url });

    phase = 'waiting-for-kaminos';
    for (let i = 0; i < 80; i += 1) {
      effectiveUrl = normalizeUrl((await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
      })).result.value);
      if (effectiveUrl === normalizeUrl(url)) break;
      await delay(125);
    }
    if (normalizeUrl(url) !== effectiveUrl) {
      throw new Error(`effective URL mismatch: requested ${normalizeUrl(url)} got ${effectiveUrl}`);
    }
    for (let i = 0; i < 120; i += 1) {
      const available = await evaluate(ws, `Boolean(
        window.kaminosViewsetCaptureReady &&
        window.kaminosViewsetCaptureReady()
      )`);
      if (available) break;
      await delay(125);
      if (i === 119) throw new Error('Kaminos GLB debug/camera surfaces did not become available');
    }

    phase = 'loading-glb';
    lastEvidence.debugLoad = await evaluate(ws, `
      window.kaminosViewGLBDebugRoute({
        source: ${JSON.stringify(requestedSource)},
        fileName: ${JSON.stringify(args.get('--file-name') || null)},
        label: ${JSON.stringify(label)},
        opaque: true
      })
    `, { timeoutMs: 60000 });
    lastEvidence.renderConditions = await evaluate(ws, `
      window.kaminosSetViewsetRenderConditions(${JSON.stringify(renderConditions)})
    `, { timeoutMs: 60000 });
    await delay(Math.max(settleMs, 250));

    phase = 'capturing-viewset';
    mkdirSync(outDir, { recursive: true });
    const frameCaptures = [];
    let frameIndex = 0;
    for (const elevationDeg of elevations) {
      for (const angle of angles) {
        const camera = cameraForAngle(angle, elevationDeg);
        lastEvidence.activeCapture = {
          frameIndex,
          angle: normalizeAngle(angle),
          azimuth: normalizeAngle(angle),
          elevation: elevationDeg,
          subphase: 'setting-camera',
        };
        const pose = await evaluate(ws, `
          window.kaminosSetCameraDebugPose(${JSON.stringify(camera)})
        `);
        await delay(settleMs);
        const framePath = viewsetFramePath(frameIndex, angle, elevationDeg);
        lastEvidence.activeCapture = {
          ...lastEvidence.activeCapture,
          path: framePath,
          subphase: 'reading-viewport-clip',
        };
        const clip = await viewportClip(ws);
        lastEvidence.activeCapture = {
          ...lastEvidence.activeCapture,
          viewportClip: clip,
          subphase: 'capturing-screenshot',
        };
        const screenshot = await capturePngScreenshot(ws, framePath, clip);
        frameCaptures.push(screenshot);
        frames.push({
          index: frameIndex,
          angle: normalizeAngle(angle),
          azimuth: normalizeAngle(angle),
          elevation: elevationDeg,
          viewVectorLocal: viewVectorLocalForCamera(camera),
          path: framePath,
          bytes: screenshot.bytes,
          pngMagic: screenshot.pngMagic,
          pngWidth: screenshot.pngWidth,
          pngHeight: screenshot.pngHeight,
          pngColorType: screenshot.pngColorType,
          hasAlphaChannel: screenshot.hasAlphaChannel,
          alphaMode: screenshot.alphaMode,
          alphaCoverage: screenshot.alphaCoverage,
          opaqueCoverage: screenshot.opaqueCoverage,
          transparentPixels: screenshot.transparentPixels,
          opaquePixels: screenshot.opaquePixels,
          maskThreshold: screenshot.maskThreshold,
          objectBounds: screenshot.objectBounds,
          cellRect: null,
          viewportClip: clip,
          camera: pose || camera,
        });
        frameIndex += 1;
        lastEvidence.activeCapture = {
          frameIndex,
          completedFrames: frames.length,
          subphase: 'frame-complete',
        };
      }
    }

    phase = 'composing-atlas';
    const atlas = await composeAtlasPng(ws, frameCaptures);
    frames.forEach(frame => {
      const column = frame.index % atlas.atlasColumns;
      const row = Math.floor(frame.index / atlas.atlasColumns);
      frame.cellRect = {
        x: column * atlas.atlasCellWidth,
        y: row * atlas.atlasCellHeight,
        width: atlas.atlasCellWidth,
        height: atlas.atlasCellHeight,
      };
    });
    const alphaModes = new Set(frames.map(frame => frame.alphaMode));
    lastEvidence.alphaMode = alphaModes.size === 1 ? [...alphaModes][0] : 'mixed';
    lastEvidence.atlas = atlas;
    lastEvidence.impostor = writeImpostorManifest({
      frames,
      atlas,
      alphaMode: lastEvidence.alphaMode,
      renderConditions: lastEvidence.renderConditions,
    });

    phase = 'complete';
    writeManifest({ ok: true });
    ws.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

function normalizeUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

main().catch(fail);

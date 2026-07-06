#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { deflateSync } from 'node:zlib';

const MANIFEST_SCHEMA = 'kaminos.volume.field-residual-render-still.v0';
const APPLICATION_ARTIFACT_SCHEMA = 'kaminos.volume.field-residual-application-artifact.v0';
const FOCUSED_RENDER_SCHEMA = 'kaminos.volume.field-residual-focused-render-discriminator.v0';
const TEMPORAL_TRACE_SCHEMA = 'kaminos.volume.field-residual-temporal-trace.v0';
const PATCH_LIMITATION = 'residual-augmented-selected-field-tiles-not-full-volume-prediction';
const FOCUSED_RENDER_LIMITATION = 'selected-patch-difference-focused-not-full-volume-proof';
const TEMPORAL_TRACE_LIMITATION = 'single-patch-live-sim-advance-not-framewise-model';
const RESIDUAL_GAIN_CONSTRUCTION = 'lowPlusGainPredictedResidual';
const DEFAULT_PAYLOAD_KEYS = ['lowTarget', 'predictedHighTarget', 'truthHighTarget'];

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

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

function resolvePayloadPath(manifestPath, descriptor) {
  const requested = String(descriptor?.path || '');
  if (!requested) throw new Error('payload descriptor has no path');
  return resolve(dirname(manifestPath), requested);
}

function readFloat32Payload(manifestPath, descriptor, expectedValues) {
  const payloadPath = resolvePayloadPath(manifestPath, descriptor);
  const bytes = readFileSync(payloadPath);
  const expectedBytes = expectedValues * 4;
  if (bytes.byteLength !== expectedBytes || Number(descriptor?.byteLength) !== expectedBytes) {
    throw new Error(`payload byte length mismatch for ${payloadPath}`);
  }
  const actualSha = sha256File(payloadPath);
  if (descriptor?.sha256 !== actualSha) {
    throw new Error(`payload sha256 mismatch for ${payloadPath}`);
  }
  return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, expectedValues));
}

function product(values) {
  return values.reduce((acc, value) => acc * Number(value), 1);
}

function parseOriginFromPath(path) {
  const match = String(path || '').match(/-x(\d+)-y(\d+)-z(\d+)\.f32$/);
  if (!match) throw new Error(`could not parse high-grid tile origin from ${path}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function inferGrid(artifact, args) {
  const requested = Number(args.get('--grid'));
  if (Number.isFinite(requested) && requested > 0) return requested;
  const first = artifact.tiles?.[0] || {};
  const pairMatch = String(first.pairId || '').match(/to-g(\d+)/);
  if (pairMatch) return Number(pairMatch[1]);
  const pathMatch = String(first.sourceHighPath || '').match(/-high-g(\d+)\./);
  if (pathMatch) return Number(pathMatch[1]);
  return 192;
}

function sourceDatasetManifest(artifact, artifactManifestPath) {
  const source = artifact.sourceManifest ? resolve(dirname(artifactManifestPath), artifact.sourceManifest) : '';
  return source ? readJson(source) : null;
}

function replayForArtifact(artifact, sourceManifest, args) {
  const replayStateIdentity = String(args.get('--replay-state') || artifact.tiles?.[0]?.replayStateIdentity || '');
  const states = sourceManifest?.dataset?.deterministicReplayStates || [];
  const found = states.find(state => state.replayStateIdentity === replayStateIdentity);
  const replay = found?.deterministicReplay || artifact.deterministicReplay || sourceManifest?.dataset?.deterministicReplay || null;
  if (!replay) throw new Error(`could not find deterministic replay state ${replayStateIdentity || '(default)'}`);
  return {
    replayStateIdentity: found?.replayStateIdentity || replayStateIdentity || 'unknown',
    steps: Number(replay.steps || 64),
    timeStepMs: Number(replay.timeStepMs || 1000 / 60),
    startTimeMs: Number(replay.startTimeMs || 1000),
  };
}

function routeForArtifact(artifact, sourceManifest, grid, args) {
  if (args.get('--url')) return String(args.get('--url'));
  const baseUrl = sourceManifest?.dataset?.baseUrl;
  if (!baseUrl) throw new Error('no --url and source dataset manifest has no baseUrl');
  const url = new URL(baseUrl);
  url.searchParams.set('volume_resolution', String(grid));
  url.searchParams.set('volume_temporal_accum', '0');
  url.searchParams.set('volume_temporal_jitter', '0');
  url.searchParams.set('volume_history_clamp', '1');
  url.searchParams.set('volume_quality_reason', 'field-residual-render-still-0706');
  if (args.get('--render-scale')) url.searchParams.set('volume_render_scale', String(args.get('--render-scale')));
  return String(url);
}

function payloadForKey(artifact, artifactManifestPath, key, grid) {
  const tiles = artifact.tiles.map((tile) => {
    const shape = (tile.shape || []).map(Number);
    if (shape.length !== 4) throw new Error(`tile ${tile.order} has invalid shape`);
    const channels = tile.targetChannels || artifact.model?.targetChannels?.targetChannels || [];
    const expectedValues = product(shape);
    const values = readFloat32Payload(artifactManifestPath, tile[key], expectedValues);
    const origin = parseOriginFromPath(tile.sourceHighPath);
    return {
      order: tile.order,
      pairId: tile.pairId,
      matchId: tile.matchId,
      replayStateIdentity: tile.replayStateIdentity,
      origin,
      size: [shape[2], shape[1], shape[0]],
      channels,
      values,
    };
  });
  return {
    grid,
    patchTarget: key,
    sourceArtifactManifest: artifactManifestPath,
    sourceArtifactAuthority: artifact.artifactAuthority,
    tiles,
  };
}

function gainToken(gain) {
  return String(gain)
    .replace(/^-/, 'm')
    .replace(/\./g, 'p')
    .replace(/[^A-Za-z0-9_]/g, '_');
}

function gainRoleName(gain) {
  return `predictedHighTargetGain${gainToken(gain)}`;
}

function parseResidualGainList(args) {
  const raw = args.get('--residual-gain-list');
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map(item => Number(item.trim()))
    .filter(value => Number.isFinite(value));
}

function payloadForResidualGain(artifact, artifactManifestPath, gain, grid) {
  const role = gainRoleName(gain);
  const tiles = artifact.tiles.map((tile) => {
    const shape = (tile.shape || []).map(Number);
    if (shape.length !== 4) throw new Error(`tile ${tile.order} has invalid shape`);
    const channels = tile.targetChannels || artifact.model?.targetChannels?.targetChannels || [];
    const expectedValues = product(shape);
    const lowValues = readFloat32Payload(artifactManifestPath, tile.lowTarget, expectedValues);
    const predictedValues = readFloat32Payload(artifactManifestPath, tile.predictedHighTarget, expectedValues);
    const values = lowValues.map((lowValue, index) => lowValue + gain * (predictedValues[index] - lowValue));
    const origin = parseOriginFromPath(tile.sourceHighPath);
    return {
      order: tile.order,
      pairId: tile.pairId,
      matchId: tile.matchId,
      replayStateIdentity: tile.replayStateIdentity,
      origin,
      size: [shape[2], shape[1], shape[0]],
      channels,
      values,
    };
  });
  return {
    grid,
    patchTarget: role,
    residualGain: gain,
    residualConstruction: RESIDUAL_GAIN_CONSTRUCTION,
    sourceArtifactManifest: artifactManifestPath,
    sourceArtifactAuthority: artifact.artifactAuthority,
    tiles,
  };
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
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
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function numericArg(args, key, fallback, min = -Infinity, max = Infinity) {
  const value = Number(args.get(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function rgbaDifference(baseRgba, otherRgba, offset) {
  return (
    Math.abs(Number(baseRgba[offset]) - Number(otherRgba[offset])) +
    Math.abs(Number(baseRgba[offset + 1]) - Number(otherRgba[offset + 1])) +
    Math.abs(Number(baseRgba[offset + 2]) - Number(otherRgba[offset + 2]))
  ) / 3;
}

function computeDifferenceLocalizedCropWindow(frames, threshold, padding) {
  const baseline = frames[0];
  let minX = baseline.width;
  let minY = baseline.height;
  let maxX = -1;
  let maxY = -1;
  let changedPixelCount = 0;
  let deltaSum = 0;
  let maxDelta = 0;
  for (const frame of frames.slice(1)) {
    if (frame.width !== baseline.width || frame.height !== baseline.height) {
      throw new Error('focused discriminator frames have mismatched dimensions');
    }
    for (let y = 0; y < baseline.height; y += 1) {
      for (let x = 0; x < baseline.width; x += 1) {
        const offset = (y * baseline.width + x) * 4;
        const delta = rgbaDifference(baseline.rgba, frame.rgba, offset);
        maxDelta = Math.max(maxDelta, delta);
        if (delta < threshold) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        changedPixelCount += 1;
        deltaSum += delta;
      }
    }
  }
  if (maxX < 0 || maxY < 0) {
    return {
      x: 0,
      y: 0,
      width: baseline.width,
      height: baseline.height,
      threshold,
      padding,
      changedPixelCount,
      meanChangedDelta: 0,
      maxDelta,
      fallback: 'full-preview-no-difference-above-threshold',
    };
  }
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(baseline.width - 1, maxX + padding);
  const bottom = Math.min(baseline.height - 1, maxY + padding);
  return {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
    threshold,
    padding,
    changedPixelCount,
    meanChangedDelta: deltaSum / Math.max(1, changedPixelCount),
    maxDelta,
    fallback: null,
  };
}

function cropRgba(rgba, sourceWidth, crop) {
  const out = new Uint8Array(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y += 1) {
    const sourceStart = ((crop.y + y) * sourceWidth + crop.x) * 4;
    const sourceEnd = sourceStart + crop.width * 4;
    out.set(rgba.slice(sourceStart, sourceEnd), y * crop.width * 4);
  }
  return out;
}

function pasteRgba(target, targetWidth, source, sourceWidth, sourceHeight, dstX, dstY) {
  for (let y = 0; y < sourceHeight; y += 1) {
    const sourceStart = y * sourceWidth * 4;
    const targetStart = ((dstY + y) * targetWidth + dstX) * 4;
    target.set(source.slice(sourceStart, sourceStart + sourceWidth * 4), targetStart);
  }
}

function cropDeltaMetrics(baselineCrop, roleCrop) {
  let sum = 0;
  let max = 0;
  let changedAbove2 = 0;
  let changedAbove6 = 0;
  const pixels = Math.floor(baselineCrop.length / 4);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const delta = rgbaDifference(baselineCrop, roleCrop, offset);
    sum += delta;
    max = Math.max(max, delta);
    if (delta >= 2) changedAbove2 += 1;
    if (delta >= 6) changedAbove6 += 1;
  }
  return {
    meanAbsRgbDelta: sum / Math.max(1, pixels),
    maxAbsRgbDelta: max,
    changedPixelFractionAt2: changedAbove2 / Math.max(1, pixels),
    changedPixelFractionAt6: changedAbove6 / Math.max(1, pixels),
  };
}

function buildPairwiseRoleDelta(croppedFrames) {
  const pairs = [];
  for (let left = 0; left < croppedFrames.length; left += 1) {
    for (let right = left + 1; right < croppedFrames.length; right += 1) {
      pairs.push({
        leftRole: croppedFrames[left].role,
        rightRole: croppedFrames[right].role,
        ...cropDeltaMetrics(croppedFrames[left].rgba, croppedFrames[right].rgba),
      });
    }
  }
  return pairs;
}

function writeFocusedRenderDiscriminator({ args, outDir, frames, outputs, route, replay, tilePatchScope }) {
  const requestedDir = args.get('--focused-output-dir');
  if (!requestedDir) return null;
  const focusedOutputDir = resolve(String(requestedDir));
  mkdirSync(focusedOutputDir, { recursive: true });
  const threshold = numericArg(args, '--focus-diff-threshold', 2, 0, 255);
  const padding = Math.floor(numericArg(args, '--focus-padding', 18, 0, 256));
  const differenceLocalizedCropWindow = computeDifferenceLocalizedCropWindow(frames, threshold, padding);
  const baselineCrop = cropRgba(frames[0].rgba, frames[0].width, differenceLocalizedCropWindow);
  const focusedOutputs = [];
  const croppedFrames = [];
  const contactSheet = new Uint8Array(differenceLocalizedCropWindow.width * frames.length * differenceLocalizedCropWindow.height * 4);
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const crop = cropRgba(frame.rgba, frame.width, differenceLocalizedCropWindow);
    croppedFrames.push({ role: frame.role, rgba: crop });
    const path = resolve(focusedOutputDir, `${frame.role}.focused-crop.png`);
    writeRgbaPng(path, differenceLocalizedCropWindow.width, differenceLocalizedCropWindow.height, Array.from(crop));
    pasteRgba(
      contactSheet,
      differenceLocalizedCropWindow.width * frames.length,
      crop,
      differenceLocalizedCropWindow.width,
      differenceLocalizedCropWindow.height,
      differenceLocalizedCropWindow.width * index,
      0
    );
    focusedOutputs.push({
      role: frame.role,
      path,
      sha256: sha256File(path),
      sourceRenderPath: outputs.find(output => output.role === frame.role)?.path || null,
      cropDeltaVsBaseline: index === 0 ? null : cropDeltaMetrics(baselineCrop, crop),
    });
  }
  const focusedContactSheet = resolve(focusedOutputDir, 'focusedContactSheet.png');
  writeRgbaPng(
    focusedContactSheet,
    differenceLocalizedCropWindow.width * frames.length,
    differenceLocalizedCropWindow.height,
    Array.from(contactSheet)
  );
  const discriminator = {
    schema: FOCUSED_RENDER_SCHEMA,
    status: 'captured',
    authority: 'difference-localized-render-crop-from-selected-field-tile-patches',
    limitation: FOCUSED_RENDER_LIMITATION,
    sourceRenderOutDir: outDir,
    route,
    deterministicReplay: replay,
    tilePatchScope,
    differenceLocalizedCropWindow,
    roleOrder: frames.map(frame => frame.role),
    pairwiseRoleDelta: buildPairwiseRoleDelta(croppedFrames),
    outputs: focusedOutputs,
    focusedContactSheet: {
      path: focusedContactSheet,
      sha256: sha256File(focusedContactSheet),
      columnOrder: frames.map(frame => frame.role),
    },
  };
  const manifestPath = resolve(focusedOutputDir, 'focused-render-discriminator.json');
  writeJson(manifestPath, discriminator);
  return {
    ...discriminator,
    manifest: manifestPath,
    manifestSha256: sha256File(manifestPath),
  };
}

async function captureTemporalFrame(ws, nowMs, advanceSim) {
  return evaluate(ws, `window.__kaminosVolumePrototype.sampleFrame(${JSON.stringify({ allowInactive: true, advanceSim, nowMs })})`);
}

async function writeTemporalTrace({ args, outDir, ws, replay, patchPayloads, route, tilePatchScope }) {
  const role = String(args.get('--temporal-trace-role') || '');
  if (!role) return null;
  const patchPayload = patchPayloads[role];
  if (!patchPayload) throw new Error(`temporal trace role ${role} is not a known patch role`);
  const frameCount = Math.max(2, Math.floor(numericArg(args, '--temporal-trace-frame-count', 10, 2)));
  const stepMs = numericArg(args, '--temporal-trace-step-ms', replay.timeStepMs, 0);
  const traceDir = resolve(outDir, `temporalTrace-${role}`);
  mkdirSync(traceDir, { recursive: true });

  const replaySample = await captureReplay(ws, replay, replay.startTimeMs);
  if (replaySample?.ok !== true) throw new Error(`temporal trace replay failed before patch: ${JSON.stringify(replaySample)}`);
  const patch = await evaluate(ws, `window.__kaminosVolumePrototype.applyDebugFieldTilePatch(${JSON.stringify(patchPayload)})`);
  if (patch?.status !== 'applied') throw new Error(`temporal trace field tile patch failed: ${JSON.stringify(patch)}`);

  const finalTimeMs = replay.startTimeMs + Math.max(0, replay.steps - 1) * replay.timeStepMs;
  const framePayloads = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const sample = await captureTemporalFrame(ws, finalTimeMs + frameIndex * stepMs, frameIndex > 0);
    if (sample?.ok !== true) throw new Error(`temporal trace sample ${frameIndex} failed: ${JSON.stringify(sample)}`);
    const path = resolve(traceDir, `frame-${String(frameIndex).padStart(3, '0')}.png`);
    writeRgbaPng(path, sample.preview.width, sample.preview.height, sample.preview.rgba);
    framePayloads.push({
      frameIndex,
      elapsedMs: frameIndex * stepMs,
      path,
      sha256: sha256File(path),
      width: sample.preview.width,
      height: sample.preview.height,
      rgba: sample.preview.rgba,
      sample: {
        simGrid: sample.simGrid,
        simStepCount: sample.simStepCount,
        fireLikePixels: sample.fireLikePixels,
        smokeLikePixels: sample.smokeLikePixels,
        fireEdgeEnergy: sample.fireEdgeEnergy,
        smokeHorizontalEnergy: sample.smokeHorizontalEnergy,
        smokeVerticalEnergy: sample.smokeVerticalEnergy,
      },
    });
  }

  const fullWidth = framePayloads[0].width * framePayloads.length;
  const fullHeight = framePayloads[0].height;
  const contact = new Uint8Array(fullWidth * fullHeight * 4);
  for (const frame of framePayloads) {
    pasteRgba(contact, fullWidth, frame.rgba, frame.width, frame.height, frame.width * frame.frameIndex, 0);
  }
  const temporalTraceContactSheet = resolve(traceDir, 'temporalTraceContactSheet.png');
  writeRgbaPng(temporalTraceContactSheet, fullWidth, fullHeight, Array.from(contact));

  const crop = computeDifferenceLocalizedCropWindow(
    framePayloads.map(frame => ({ role: `frame-${frame.frameIndex}`, width: frame.width, height: frame.height, rgba: frame.rgba })),
    numericArg(args, '--focus-diff-threshold', 2, 0, 255),
    Math.floor(numericArg(args, '--focus-padding', 18, 0, 256))
  );
  const cropWidth = crop.width * framePayloads.length;
  const cropHeight = crop.height;
  const focusedContact = new Uint8Array(cropWidth * cropHeight * 4);
  const croppedFrames = framePayloads.map((frame) => {
    const rgba = cropRgba(frame.rgba, frame.width, crop);
    const cropPath = resolve(traceDir, `frame-${String(frame.frameIndex).padStart(3, '0')}.focused-crop.png`);
    writeRgbaPng(cropPath, crop.width, crop.height, Array.from(rgba));
    pasteRgba(focusedContact, cropWidth, rgba, crop.width, crop.height, crop.width * frame.frameIndex, 0);
    return { ...frame, cropPath, cropSha256: sha256File(cropPath), cropRgba: rgba };
  });
  const focusedTemporalTraceContactSheet = resolve(traceDir, 'focusedTemporalTraceContactSheet.png');
  writeRgbaPng(focusedTemporalTraceContactSheet, cropWidth, cropHeight, Array.from(focusedContact));
  const firstCrop = croppedFrames[0].cropRgba;
  const temporalTraceFrames = croppedFrames.map((frame, index) => ({
    frameIndex: frame.frameIndex,
    elapsedMs: frame.elapsedMs,
    path: frame.path,
    sha256: frame.sha256,
    focusedCropPath: frame.cropPath,
    focusedCropSha256: frame.cropSha256,
    sample: frame.sample,
    cropDeltaVsFirst: index === 0 ? null : cropDeltaMetrics(firstCrop, frame.cropRgba),
    cropDeltaVsPrevious: index === 0 ? null : cropDeltaMetrics(croppedFrames[index - 1].cropRgba, frame.cropRgba),
  }));
  const trace = {
    schema: TEMPORAL_TRACE_SCHEMA,
    status: 'captured',
    authority: 'single-selected-field-patch-evolved-by-live-simulator',
    limitation: TEMPORAL_TRACE_LIMITATION,
    role,
    residualGain: patchPayload.residualGain ?? null,
    residualConstruction: patchPayload.residualConstruction ?? null,
    sourceArtifactManifest: patchPayload.sourceArtifactManifest,
    route,
    deterministicReplay: replay,
    frameCount,
    stepMs,
    patch,
    tilePatchScope,
    differenceLocalizedCropWindow: crop,
    temporalTraceFrames,
    temporalTraceContactSheet: {
      path: temporalTraceContactSheet,
      sha256: sha256File(temporalTraceContactSheet),
    },
    focusedTemporalTraceContactSheet: {
      path: focusedTemporalTraceContactSheet,
      sha256: sha256File(focusedTemporalTraceContactSheet),
    },
  };
  const manifest = resolve(traceDir, 'temporal-trace.json');
  writeJson(manifest, trace);
  return {
    ...trace,
    manifest,
    manifestSha256: sha256File(manifest),
  };
}

async function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await cdpFetch(port, '/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error(`CDP endpoint did not open on port ${port}`);
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectReq(new Error(`${method}: ${message.error.message}`));
      else resolveReq(message);
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

async function launchBrowser({ port, userDataDir, windowSize, url }) {
  const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });
  await waitForCdp(port);
  return proc;
}

async function closeBrowser(port, proc) {
  try {
    const version = await cdpFetch(port, '/json/version');
    if (version.webSocketDebuggerUrl) {
      const ws = new WebSocket(version.webSocketDebuggerUrl);
      await waitForWebSocketOpen(ws);
      await wsRequest(ws, 'Browser.close');
      ws.close();
    }
  } catch {
    // The process fallback below is the durable cleanup path.
  }
  if (proc && !proc.killed) proc.kill('SIGTERM');
}

async function evaluate(ws, expression) {
  const response = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(`browser evaluation rejected: ${JSON.stringify(response.result.exceptionDetails)}`);
  }
  if (response.result?.result?.subtype === 'error') {
    throw new Error(`browser evaluation returned error: ${JSON.stringify(response.result.result)}`);
  }
  return response.result?.result?.value;
}

async function connectPage(port, url) {
  const targets = await cdpFetch(port, '/json/list');
  const page = targets.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1')) || targets.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Page.navigate', { url });
  await wsRequest(ws, 'Page.bringToFront');
  return ws;
}

async function waitForVolume(ws, settleMs) {
  await delay(settleMs);
  let state = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    state = await evaluate(ws, 'window.__kaminosVolumePrototype?.debugState?.()');
    if (state?.active && state.frameCount > 8) return state;
    await delay(250);
  }
  throw new Error(`volume prototype did not become active: ${JSON.stringify(state)}`);
}

async function captureReplay(ws, replay, nowMs) {
  const options = { steps: replay.steps, timeStepMs: replay.timeStepMs, startTimeMs: replay.startTimeMs };
  await evaluate(ws, 'window.__kaminosVolumePrototype.setActive(false)');
  const sample = await evaluate(ws, `window.__kaminosVolumePrototype.sampleDeterministicReplayFrame(${JSON.stringify(options)})`);
  await evaluate(ws, 'window.__kaminosVolumePrototype.setActive(false)');
  return sample;
}

async function captureNoAdvance(ws, replay) {
  const finalTimeMs = replay.startTimeMs + Math.max(0, replay.steps - 1) * replay.timeStepMs;
  return evaluate(ws, `window.__kaminosVolumePrototype.sampleFrame(${JSON.stringify({ allowInactive: true, advanceSim: false, nowMs: finalTimeMs })})`);
}

async function capturePatched(ws, replay, patchPayload) {
  const replaySample = await captureReplay(ws, replay, replay.startTimeMs);
  if (replaySample?.ok !== true) throw new Error(`deterministic replay failed before patch: ${JSON.stringify(replaySample)}`);
  const patch = await evaluate(ws, `window.__kaminosVolumePrototype.applyDebugFieldTilePatch(${JSON.stringify(patchPayload)})`);
  if (patch?.status !== 'applied') throw new Error(`field tile patch failed: ${JSON.stringify(patch)}`);
  const sample = await captureNoAdvance(ws, replay);
  if (sample?.ok !== true) throw new Error(`patched sampleFrame failed: ${JSON.stringify(sample)}`);
  return { replaySample, patch, sample };
}

function failureReport({ artifactManifest, outDir, failurePhase, error, evidence = {} }) {
  return {
    schema: MANIFEST_SCHEMA,
    status: 'failed',
    createdAt: utcNow(),
    artifactManifest,
    outDir,
    failurePhase,
    error: String(error?.message || error),
    lastTrustworthyEvidence: evidence,
    limitation: PATCH_LIMITATION,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactManifest = resolve(String(args.get('--artifact-manifest') || ''));
  const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-field-residual-render-still'));
  const manifestOut = resolve(String(args.get('--out') || `${outDir}/manifest.json`));
  let phase = 'args';
  let browser = null;
  try {
    if (!artifactManifest) throw new Error('--artifact-manifest is required');
    mkdirSync(outDir, { recursive: true });
    phase = 'artifact-read';
    const artifact = readJson(artifactManifest);
    if (artifact.schema !== APPLICATION_ARTIFACT_SCHEMA) throw new Error(`artifact schema mismatch: ${artifact.schema}`);
    if (!Array.isArray(artifact.tiles) || artifact.tiles.length < 1) throw new Error('artifact has no tiles');
    const sourceManifest = sourceDatasetManifest(artifact, artifactManifest);
    const grid = inferGrid(artifact, args);
    const replay = replayForArtifact(artifact, sourceManifest, args);
    const url = routeForArtifact(artifact, sourceManifest, grid, args);
    const payloadKeys = String(args.get('--payload-keys') || DEFAULT_PAYLOAD_KEYS.join(','))
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    const patchPayloads = Object.fromEntries(payloadKeys.map(key => [key, payloadForKey(artifact, artifactManifest, key, grid)]));
    const residualGainSweep = parseResidualGainList(args).map((gain) => {
      const role = gainRoleName(gain);
      patchPayloads[role] = payloadForResidualGain(artifact, artifactManifest, gain, grid);
      return {
        role,
        gain,
        residualConstruction: RESIDUAL_GAIN_CONSTRUCTION,
        expression: 'lowTarget + gain * (predictedHighTarget - lowTarget)',
      };
    });
    const patchRoles = [...payloadKeys, ...residualGainSweep.map(item => item.role)];
    const debugPort = Number(args.get('--debug-port') || 9877);
    const windowSize = String(args.get('--window-size') || '1024,1024');
    const settleMs = Number(args.get('--settle-ms') || 3500);
    const userDataDir = resolve(String(args.get('--user-data-dir') || `${outDir}/chrome-profile-${debugPort}`));

    phase = 'browser-launch';
    browser = await launchBrowser({ port: debugPort, userDataDir, windowSize, url });
    phase = 'browser-connect';
    const ws = await connectPage(debugPort, url);
    phase = 'volume-load';
    const initialState = await waitForVolume(ws, settleMs);
    phase = 'true-high-baseline';
    const baseline = await captureReplay(ws, replay, replay.startTimeMs);
    if (baseline?.ok !== true) throw new Error(`baseline replay sample failed: ${JSON.stringify(baseline)}`);
    const baselineRender = await captureNoAdvance(ws, replay);
    if (baselineRender?.ok !== true) throw new Error(`baseline no-advance sample failed: ${JSON.stringify(baselineRender)}`);

    const outputs = [];
    const frames = [];
    const baselinePng = resolve(outDir, 'true-high-route-baseline.png');
    writeRgbaPng(baselinePng, baselineRender.preview.width, baselineRender.preview.height, baselineRender.preview.rgba);
    outputs.push({
      role: 'true-high-route-baseline',
      path: baselinePng,
      sha256: sha256File(baselinePng),
      sample: {
        width: baselineRender.width,
        height: baselineRender.height,
        renderScale: baselineRender.renderScale,
        simGrid: baselineRender.simGrid,
        simStepCount: baselineRender.simStepCount,
        fireLikePixels: baselineRender.fireLikePixels,
        smokeLikePixels: baselineRender.smokeLikePixels,
        fireEdgeEnergy: baselineRender.fireEdgeEnergy,
      },
    });
    frames.push({
      role: 'true-high-route-baseline',
      width: baselineRender.preview.width,
      height: baselineRender.preview.height,
      rgba: baselineRender.preview.rgba,
    });

    for (const key of patchRoles) {
      phase = `patched-${key}`;
      const patchPayload = patchPayloads[key];
      const { patch, sample } = await capturePatched(ws, replay, patchPayload);
      const png = resolve(outDir, `${key}.selected-field-tile-render.png`);
      writeRgbaPng(png, sample.preview.width, sample.preview.height, sample.preview.rgba);
      outputs.push({
        role: key,
        path: png,
        sha256: sha256File(png),
        residualGain: patchPayload.residualGain ?? null,
        residualConstruction: patchPayload.residualConstruction ?? null,
        patch,
        sample: {
          width: sample.width,
          height: sample.height,
          renderScale: sample.renderScale,
          simGrid: sample.simGrid,
          simStepCount: sample.simStepCount,
          fireLikePixels: sample.fireLikePixels,
          smokeLikePixels: sample.smokeLikePixels,
          fireEdgeEnergy: sample.fireEdgeEnergy,
          fieldTilePatchRenderOverride: sample.fieldTilePatchRenderOverride,
        },
      });
      frames.push({
        role: key,
        width: sample.preview.width,
        height: sample.preview.height,
        rgba: sample.preview.rgba,
      });
    }

    phase = 'write-report';
    const route = {
      requestedUrl: url,
      effectiveRoute: baseline.effectiveRoute,
      prototypeIdentity: baseline.prototypeIdentity,
      backend: baseline.backend,
      initialState: {
        effectiveRoute: initialState.effectiveRoute,
        prototypeIdentity: initialState.prototypeIdentity,
        backend: initialState.backend,
        simGrid: initialState.simGrid,
      },
    };
    const tilePatchScope = {
      grid,
      tileCount: artifact.tiles.length,
      targetChannels: artifact.model?.targetChannels?.targetChannels || artifact.tiles[0]?.targetChannels || [],
      note: 'Only selected held-out field tiles are patched before rendering; unpatched cells remain the deterministic high-grid replay state.',
    };
    const focusedRenderDiscriminator = writeFocusedRenderDiscriminator({
      args,
      outDir,
      frames,
      outputs,
      route,
      replay,
      tilePatchScope,
    });
    phase = 'temporal-trace';
    const temporalTrace = await writeTemporalTrace({
      args,
      outDir,
      ws,
      replay,
      patchPayloads,
      route,
      tilePatchScope,
    });
    phase = 'write-report';
    const report = {
      schema: MANIFEST_SCHEMA,
      status: 'captured',
      createdAt: utcNow(),
      artifactManifest,
      artifactManifestSha256: sha256File(artifactManifest),
      sourceManifest: artifact.sourceManifest || null,
      sourceManifestSha256: artifact.sourceManifest ? sha256File(resolve(dirname(artifactManifest), artifact.sourceManifest)) : null,
      outDir,
      route,
      deterministicReplay: replay,
      residualRenderAuthority: 'debug-field-tile-patch-render-override-v0',
      limitation: PATCH_LIMITATION,
      tilePatchScope,
      residualGainSweep,
      outputs,
      focusedRenderDiscriminator,
      temporalTrace,
    };
    writeJson(manifestOut, report);
    ws.close();
    await closeBrowser(debugPort, browser);
  } catch (error) {
    writeJson(manifestOut, failureReport({ artifactManifest, outDir, failurePhase: phase, error }));
    if (browser) await closeBrowser(Number(args.get('--debug-port') || 9877), browser);
    console.error(`field residual render-still failed at ${phase}: ${error?.message || error}`);
    process.exitCode = 2;
  }
}

await main();

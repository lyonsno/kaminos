#!/usr/bin/env node
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.cadence-gap-interframe-witness.v0';
const CONTEXT_SCHEMA = 'kaminos.volume.cadence-gap-interframe-candidate-context.v0';
const MANIFEST_ID = 'kaminos-volume-cadence-gap-manifest-v0';
const CONTINUATION_TARGET_AUTHORITY = 'continuation-target-from-latest-live-field';
const SYNTHETIC_AUTHORITY = 'synthetic-comparison-not-live-simulator-output';
const CADENCE_CONTINUATION_BASELINE = 'cadence-continuation-baseline';
const BUILTIN_CANDIDATES = [
  'hold-last-rgba-v0',
  'hold-next-rgba-v0',
  'pixel-linear-ratio-rgba-v0',
];
const FAILURE_MODE_BUCKETS = [
  'ghosting',
  'smearing',
  'topology-lie',
  'snuff-quench-miss',
  'low-fire-shimmer',
  'broad-smoke-mush',
];
const cwd = new URL('.', import.meta.url).pathname;

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

function parseExternalBaselineSpecs(argv) {
  const specs = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--external-baseline') continue;
    const raw = argv[index + 1];
    if (!raw || raw.startsWith('--')) throw new Error('--external-baseline requires id::command');
    index += 1;
    const separator = raw.indexOf('::');
    if (separator <= 0) throw new Error(`external baseline spec must be id::command, got ${raw}`);
    const id = raw.slice(0, separator).trim();
    const command = raw.slice(separator + 2).trim();
    if (!/^[a-z0-9][a-z0-9-]*-v[0-9]+$/.test(id)) throw new Error(`external baseline id must be stable kebab schema id ending in -vN, got ${id}`);
    if (!command.includes('{out}')) throw new Error(`external baseline ${id} command must include {out}`);
    specs.push({ id, command });
  }
  return specs;
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function writeRgbaPng(path, width, height, rgba) {
  mkdirSync(dirname(path), { recursive: true });
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
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8, 'only 8-bit PNG is supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let p = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p++];
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      rgba[dst] = row[src];
      rgba[dst + 1] = row[src + 1];
      rgba[dst + 2] = row[src + 2];
      rgba[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
    prev = row;
  }
  return { width, height, rgba };
}

function readPngRgba(path) {
  return parsePngRgba(readFileSync(path));
}

function compareRgba(actual, synthetic, width, height) {
  let absolute = 0;
  let squared = 0;
  let maxChannelError = 0;
  let highErrorPixels = 0;
  let fireWeightedAbsolute = 0;
  let fireWeight = 0;
  let smokeWeightedAbsolute = 0;
  let smokeWeight = 0;
  const channels = width * height * 3;
  for (let i = 0; i < actual.length; i += 4) {
    const r = actual[i];
    const g = actual[i + 1];
    const b = actual[i + 2];
    const sr = synthetic[i];
    const sg = synthetic[i + 1];
    const sb = synthetic[i + 2];
    const dr = Math.abs(r - sr);
    const dg = Math.abs(g - sg);
    const db = Math.abs(b - sb);
    const pixelError = (dr + dg + db) / 3;
    absolute += dr + dg + db;
    squared += dr * dr + dg * dg + db * db;
    maxChannelError = Math.max(maxChannelError, dr, dg, db);
    if (pixelError > 32) highErrorPixels += 1;
    const fireLike = r > 120 && g > 70 && b < 95;
    const smokeLike = b > 28 && g > 28 && r < 110 && Math.abs(g - b) < 65;
    if (fireLike) {
      fireWeightedAbsolute += pixelError;
      fireWeight += 1;
    }
    if (smokeLike) {
      smokeWeightedAbsolute += pixelError;
      smokeWeight += 1;
    }
  }
  return {
    meanAbsoluteError: absolute / Math.max(1, channels),
    rootMeanSquaredError: Math.sqrt(squared / Math.max(1, channels)),
    maxChannelError,
    highErrorPixelRatio: highErrorPixels / Math.max(1, width * height),
    fireRegionMeanAbsoluteError: fireWeightedAbsolute / Math.max(1, fireWeight),
    smokeRegionMeanAbsoluteError: smokeWeightedAbsolute / Math.max(1, smokeWeight),
    firePixelCount: fireWeight,
    smokePixelCount: smokeWeight,
  };
}

function meanMetrics(metricsList) {
  const keys = [
    'meanAbsoluteError',
    'rootMeanSquaredError',
    'maxChannelError',
    'highErrorPixelRatio',
    'fireRegionMeanAbsoluteError',
    'smokeRegionMeanAbsoluteError',
  ];
  const out = { comparedFrameCount: metricsList.length };
  for (const key of keys) {
    out[key] = metricsList.reduce((sum, metrics) => sum + Number(metrics[key] || 0), 0) / Math.max(1, metricsList.length);
  }
  return out;
}

function classifyFailureModes(metrics) {
  const modes = [];
  if (metrics.highErrorPixelRatio > 0.12) modes.push('ghosting');
  if (metrics.meanAbsoluteError > 18 || metrics.rootMeanSquaredError > 28) modes.push('smearing');
  if (metrics.fireRegionMeanAbsoluteError > Math.max(14, metrics.meanAbsoluteError * 1.18)) modes.push('topology-lie');
  if (metrics.fireRegionMeanAbsoluteError > 18) modes.push('snuff-quench-miss');
  if (metrics.firePixelCount < 20 && metrics.fireRegionMeanAbsoluteError > 10) modes.push('low-fire-shimmer');
  if (metrics.smokeRegionMeanAbsoluteError > Math.max(12, metrics.meanAbsoluteError * 1.10)) modes.push('broad-smoke-mush');
  return modes.length ? modes : ['no-obvious-bucket-from-cheap-metrics'];
}

function linearRgba(first, third, ratio) {
  const out = new Uint8Array(first.length);
  for (let i = 0; i < first.length; i += 4) {
    out[i] = Math.round(first[i] * (1 - ratio) + third[i] * ratio);
    out[i + 1] = Math.round(first[i + 1] * (1 - ratio) + third[i + 1] * ratio);
    out[i + 2] = Math.round(first[i + 2] * (1 - ratio) + third[i + 2] * ratio);
    out[i + 3] = 255;
  }
  return out;
}

function builtinCandidateRgba(id, first, third, ratio) {
  if (id === 'hold-last-rgba-v0') return Uint8Array.from(first);
  if (id === 'hold-next-rgba-v0') return Uint8Array.from(third);
  if (id === 'pixel-linear-ratio-rgba-v0') return linearRgba(first, third, ratio);
  throw new Error(`unknown built-in candidate ${id}`);
}

function frameDelta(a, b, width, height) {
  return compareRgba(a, b, width, height).meanAbsoluteError;
}

function sequenceTemporalStats(frameRgba, width, height) {
  const deltas = [];
  for (let index = 1; index < frameRgba.length; index += 1) {
    deltas.push(frameDelta(frameRgba[index - 1], frameRgba[index], width, height));
  }
  const mean = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
  const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, deltas.length);
  return {
    consecutiveDeltaCount: deltas.length,
    meanConsecutiveDelta: mean,
    maxConsecutiveDelta: deltas.reduce((max, value) => Math.max(max, value), 0),
    consecutiveDeltaStdDev: Math.sqrt(variance),
    consecutiveDeltas: deltas,
  };
}

function pathForHtml(outputPath, imagePath) {
  return relative(dirname(outputPath), imagePath).split('/').map(encodeURIComponent).join('/');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function renderExternalBaselineCommand(spec, context) {
  return spec.command
    .replaceAll('{first}', shellQuote(context.firstPath))
    .replaceAll('{third}', shellQuote(context.thirdPath))
    .replaceAll('{target}', shellQuote(context.targetPath))
    .replaceAll('{out}', shellQuote(context.outPath))
    .replaceAll('{outDir}', shellQuote(context.outDir))
    .replaceAll('{gapDir}', shellQuote(context.gapDir))
    .replaceAll('{report}', shellQuote(context.candidateContextPath))
    .replaceAll('{candidateContext}', shellQuote(context.candidateContextPath))
    .replaceAll('{gapIndex}', shellQuote(context.gapIndexLabel))
    .replaceAll('{candidateId}', shellQuote(spec.id))
    .replaceAll('{ratio}', shellQuote(context.ratio))
    .replaceAll('{phase}', shellQuote(context.cadencePhase));
}

function runExternalBaseline(spec, context) {
  mkdirSync(dirname(context.outPath), { recursive: true });
  const externalBaselineCommand = renderExternalBaselineCommand(spec, context);
  const stdoutPath = `${context.outPath}.stdout.txt`;
  const stderrPath = `${context.outPath}.stderr.txt`;
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(externalBaselineCommand, {
      cwd,
      shell: true,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  const stdout = readFileSync(stdoutPath, 'utf8');
  const stderr = readFileSync(stderrPath, 'utf8');
  if (result.status !== 0) {
    const error = new Error(`external baseline ${spec.id} failed with status ${result.status}`);
    error.code = 'external-baseline-failed';
    error.failurePhase = 'external-baseline';
    error.details = {
      candidateId: spec.id,
      externalBaselineCommand,
      stdoutPath,
      stderrPath,
      stdout,
      stderr,
      signal: result.signal,
    };
    throw error;
  }
  if (!existsSync(context.outPath)) {
    const error = new Error(`external baseline ${spec.id} did not write ${context.outPath}`);
    error.code = 'external-baseline-missing-output';
    error.failurePhase = 'external-baseline';
    error.details = { candidateId: spec.id, externalBaselineCommand, stdoutPath, stderrPath, stdout, stderr };
    throw error;
  }
  return { externalBaselineCommand, stdoutPath, stderrPath, stdout, stderr };
}

function commandExists(command) {
  const result = spawnSync(command, ['-version'], { encoding: 'utf8' });
  return result.status === 0;
}

function writeVideo(timelineDir, outPath, fps) {
  const result = spawnSync('ffmpeg', [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    resolve(timelineDir, 'frame-%03d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    const error = new Error(`ffmpeg video encode failed for ${outPath}`);
    error.code = 'video-encode-failed';
    error.failurePhase = 'video';
    error.details = { outPath, fps, stderr: String(result.stderr || '').slice(-2000), stdout: String(result.stdout || '').slice(-1000) };
    throw error;
  }
}

function normalizeFrame(frame, manifestPath) {
  return {
    ...frame,
    path: resolve(dirname(manifestPath), frame.frameImage),
    authority: frame.gapFrameRole === 'live-sim-anchor' ? 'live-sim-anchor' : CONTINUATION_TARGET_AUTHORITY,
  };
}

function frameSummary(frame) {
  return {
    index: frame.index,
    path: frame.path,
    frameImage: frame.frameImage,
    frameCount: frame.frameCount,
    simStepCount: frame.simStepCount,
    simCadence: frame.simCadence,
    gapFrameRole: frame.gapFrameRole,
    authority: frame.authority,
    liveSimAnchorFrameId: frame.liveSimAnchorFrameId,
    previousLiveSimFrame: frame.previousLiveSimFrame,
    nextLiveSimFrame: frame.nextLiveSimFrame,
    cadenceGapIndex: frame.cadenceGapIndex,
    cadencePhase: frame.cadencePhase,
    framesSinceLiveSim: frame.framesSinceLiveSim,
    effectiveVisualAuthority: frame.effectiveVisualAuthority,
    continuationAuthority: frame.continuationAuthority,
    metrics: frame.metrics || null,
  };
}

function writeTimelineFrames(timelineDir, frames) {
  mkdirSync(timelineDir, { recursive: true });
  for (const frame of frames) {
    writeFileSync(resolve(timelineDir, `frame-${String(frame.index).padStart(3, '0')}.png`), readFileSync(frame.path));
  }
}

function writePlaybackHtml(path, report) {
  const width = report.width;
  const height = report.height;
  const baseline = {
    id: CADENCE_CONTINUATION_BASELINE,
    authority: CONTINUATION_TARGET_AUTHORITY,
    temporalStats: report.baseline.temporalStats,
    videoFps24: report.baseline.videoFps24 ? pathForHtml(path, report.baseline.videoFps24) : null,
    frames: report.baseline.frames.map(frame => ({
      label: `${String(frame.index).padStart(2, '0')} ${frame.gapFrameRole} p${frame.cadencePhase}`,
      src: pathForHtml(path, frame.timelinePath),
      frameCount: frame.frameCount,
      simStepCount: frame.simStepCount,
      role: frame.gapFrameRole,
      cadencePhase: frame.cadencePhase,
    })),
  };
  const candidates = report.candidates.map(candidate => ({
    id: candidate.id,
    sourceKind: candidate.sourceKind,
    syntheticAuthority: candidate.syntheticAuthority,
    continuationTargetUsedAsComparison: candidate.continuationTargetUsedAsComparison,
    actualMiddleUsed: candidate.actualMiddleUsed,
    summaryMetrics: candidate.summaryMetrics,
    temporalStats: candidate.temporalStats,
    temporalPulseVsCadenceBaseline: candidate.temporalPulseVsCadenceBaseline,
    failureModes: candidate.failureModes,
    failures: candidate.failures,
    videoFps24: candidate.videoFps24 ? pathForHtml(path, candidate.videoFps24) : null,
    frames: candidate.timelineFrames.map(frame => ({
      label: `${String(frame.index).padStart(2, '0')} ${frame.role} p${frame.cadencePhase}`,
      src: pathForHtml(path, frame.timelinePath),
      frameCount: frame.frameCount,
      simStepCount: frame.simStepCount,
      role: frame.role,
      cadencePhase: frame.cadencePhase,
    })),
  }));
  const payload = jsonForScript({
    width,
    height,
    fps: 24,
    baseline,
    candidates,
    defaultCandidateId: report.summary?.lowestTemporalMaxConsecutiveDelta?.id || candidates[0]?.id || null,
  });
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kaminos Cadence Gap Interframe Witness</title>
<style>
  :root { color-scheme: dark; background: #07090b; color: #eef3f6; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: #07090b; }
  header, main { max-width: 1320px; margin: 0 auto; }
  header { display: grid; gap: 10px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
  h2 { margin: 0 0 5px; font-size: 14px; letter-spacing: 0; }
  p { margin: 0; }
  .meta { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  .chip { min-height: 52px; border: 1px solid #20303a; background: #101820; padding: 8px 10px; }
  .chip b { display: block; font-size: 10px; color: #85a7ba; text-transform: uppercase; }
  .chip span { display: block; font-size: 12px; overflow-wrap: anywhere; }
  main { display: grid; gap: 12px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
  .panel { border: 1px solid #1b2830; background: #0c1014; padding: 10px; min-width: 0; }
  .panel p { color: #b7c5ce; font-size: 12px; margin-bottom: 8px; }
  .stage { width: 100%; aspect-ratio: ${width} / ${height}; background: #000; overflow: hidden; }
  .stage img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .readout { min-height: 54px; display: grid; grid-template-columns: 152px minmax(0, 1fr); gap: 8px; align-items: center; margin-top: 8px; color: #d2dde3; font-size: 12px; }
  .bar { height: 9px; background: #16232b; position: relative; overflow: hidden; }
  .bar span { position: absolute; top: 0; bottom: 0; left: 0; width: 0%; background: #f0b85a; }
  .authority { color: #f0b85a; }
  .transport { display: grid; grid-template-columns: repeat(3, 34px) minmax(160px, 1fr) 76px minmax(260px, 380px); gap: 8px; align-items: center; }
  button, select, input[type="range"] { min-height: 30px; border: 1px solid #315062; background: #111c24; color: #eef3f6; }
  button { width: 34px; cursor: pointer; }
  select { min-width: 0; width: 100%; padding: 0 8px; }
  input[type="range"] { width: 100%; accent-color: #f0b85a; }
  .stats { min-height: 32px; color: #b7c5ce; font-size: 12px; overflow-wrap: anywhere; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
  .stat { border: 1px solid #20303a; background: #101820; padding: 7px 8px; min-height: 42px; }
  .stat b { display: block; font-size: 10px; color: #85a7ba; text-transform: uppercase; }
  .stat span { display: block; font-size: 12px; overflow-wrap: anywhere; }
  @media (max-width: 860px) { body { padding: 10px; } .meta, .grid, .stats-grid, .transport { grid-template-columns: 1fr; } button { width: 100%; } }
</style>
</head>
<body>
<header>
  <h1>Kaminos Cadence Gap Interframe Witness</h1>
  <div class="meta">
    <div class="chip"><b>Schema</b><span>${SCHEMA}</span></div>
    <div class="chip"><b>Source</b><span>${escapeHtml(report.source.manifestIdentity)}</span></div>
    <div class="chip"><b>Frames</b><span>${report.totalFrameCount}; ${report.liveAnchorCount} live anchors; ${report.continuationTargetCount} continuation targets</span></div>
    <div class="chip"><b>Comparison</b><span>${CONTINUATION_TARGET_AUTHORITY}; actualMiddleUsed=false</span></div>
    <div class="chip"><b>Synthetic</b><span class="authority">${SYNTHETIC_AUTHORITY}</span></div>
  </div>
  <div class="transport">
    <button data-step-back aria-label="Previous frame">&lt;</button>
    <button data-play-toggle aria-label="Pause playback">||</button>
    <button data-step-forward aria-label="Next frame">&gt;</button>
    <input data-frame-scrubber type="range" min="0" max="${Math.max(0, baseline.frames.length - 1)}" value="0" step="1" aria-label="Frame scrubber">
    <select data-fps aria-label="Playback frame rate"><option>12</option><option selected>24</option><option>60</option></select>
    <select data-candidate-select aria-label="Comparison candidate"></select>
  </div>
  <div class="stats" id="global-label">F00</div>
</header>
<main>
  <section class="grid">
    <article class="panel" data-baseline-panel>
      <h2>Cadence continuation baseline</h2>
      <p>Original Hellmouth bundle frames: live anchors plus current continuation targets.</p>
      <div class="stage" data-baseline-stage><img alt="Cadence continuation baseline frame"></div>
      <div class="readout"><span data-label>F00</span><div class="bar"><span data-bar></span></div></div>
      <div class="stats" data-stats></div>
    </article>
    <article class="panel" data-candidate-panel>
      <h2 data-candidate-title>Candidate</h2>
      <p class="authority" data-candidate-authority></p>
      <div class="stage" data-candidate-stage><img alt="Selected synthetic comparison timeline frame"></div>
      <div class="readout"><span data-label>F00</span><div class="bar"><span data-bar></span></div></div>
      <div class="stats" data-candidate-stats></div>
    </article>
  </section>
  <section class="panel">
    <h2>Selected Candidate Metrics</h2>
    <p class="authority">Candidate frames are synthetic comparison evidence, not live simulator output. Continuation targets remain comparison targets, not actual hidden middle truth.</p>
    <div class="stats-grid" data-metric-grid></div>
  </section>
</main>
<script type="application/json" id="sequence-data">${payload}</script>
<script>
const data = JSON.parse(document.getElementById('sequence-data').textContent);
let index = 0;
let playing = true;
let fps = data.fps;
let lastTime = performance.now();
const baselinePanel = document.querySelector('[data-baseline-panel]');
const candidatePanel = document.querySelector('[data-candidate-panel]');
const candidateSelect = document.querySelector('[data-candidate-select]');
const frameScrubber = document.querySelector('[data-frame-scrubber]');
const metricGrid = document.querySelector('[data-metric-grid]');
let selectedCandidate = data.candidates.find(candidate => candidate.id === data.defaultCandidateId) || data.candidates[0] || null;
function fmt(value) { return Number.isFinite(value) ? value.toFixed(3) : 'n/a'; }
function statsText(candidate) {
  const temporal = candidate.temporalStats || {};
  const pulse = candidate.temporalPulseVsCadenceBaseline || {};
  const mae = candidate.summaryMetrics || {};
  return 'target MAE ' + fmt(mae.meanAbsoluteError) + '; max step ' + fmt(temporal.maxConsecutiveDelta) + '; max-step delta vs baseline ' + fmt(pulse.maxConsecutiveDeltaReduction) + '; failures ' + (candidate.failures || []).length;
}
function metricCell(label, value) {
  return '<div class="stat"><b>' + label + '</b><span>' + value + '</span></div>';
}
for (const candidate of data.candidates) {
  const option = document.createElement('option');
  option.value = candidate.id;
  option.textContent = candidate.id + ' | max step ' + fmt(candidate.temporalStats?.maxConsecutiveDelta);
  candidateSelect.appendChild(option);
}
candidateSelect.value = selectedCandidate ? selectedCandidate.id : '';
baselinePanel.querySelector('[data-stats]').textContent = 'max step ' + fmt(data.baseline.temporalStats.maxConsecutiveDelta) + '; step stddev ' + fmt(data.baseline.temporalStats.consecutiveDeltaStdDev);
function paintPanel(root, frame, frameCount) {
  if (!frame || !frameCount) return;
  root.querySelector('img').src = frame.src;
  root.querySelector('[data-label]').textContent = frame.label + ' / route frame ' + frame.frameCount + ' sim ' + frame.simStepCount;
  root.querySelector('[data-bar]').style.width = ((index + 1) / frameCount * 100).toFixed(2) + '%';
}
function paintCandidateMeta() {
  if (!selectedCandidate) return;
  const temporal = selectedCandidate.temporalStats || {};
  const pulse = selectedCandidate.temporalPulseVsCadenceBaseline || {};
  const summary = selectedCandidate.summaryMetrics || {};
  candidatePanel.querySelector('[data-candidate-title]').textContent = selectedCandidate.id;
  candidatePanel.querySelector('[data-candidate-authority]').textContent = selectedCandidate.syntheticAuthority + '; actualMiddleUsed=' + selectedCandidate.actualMiddleUsed + '; sourceKind=' + selectedCandidate.sourceKind;
  candidatePanel.querySelector('[data-candidate-stats]').textContent = statsText(selectedCandidate);
  metricGrid.innerHTML = [
    metricCell('Mean absolute error', fmt(summary.meanAbsoluteError)),
    metricCell('Max absolute error', fmt(summary.maxAbsoluteError)),
    metricCell('Temporal max step', fmt(temporal.maxConsecutiveDelta)),
    metricCell('Step stddev', fmt(temporal.consecutiveDeltaStdDev)),
    metricCell('Delta vs baseline', fmt(pulse.maxConsecutiveDeltaReduction)),
    metricCell('Failure modes', (selectedCandidate.failureModes || []).join(', ') || 'none'),
    metricCell('Failures', String((selectedCandidate.failures || []).length)),
    metricCell('Video', selectedCandidate.videoFps24 || 'not written'),
  ].join('');
}
function paint() {
  const baselineFrames = data.baseline.frames;
  const candidateFrames = selectedCandidate ? selectedCandidate.frames : [];
  const frameIndex = index % baselineFrames.length;
  paintPanel(baselinePanel, baselineFrames[frameIndex], baselineFrames.length);
  paintPanel(candidatePanel, candidateFrames[index % candidateFrames.length], candidateFrames.length);
  frameScrubber.value = String(frameIndex);
  document.getElementById('global-label').textContent = 'F' + String(index).padStart(2, '0');
}
function stepFrame(delta) {
  index = (index + delta + data.baseline.frames.length) % data.baseline.frames.length;
  paint();
}
function tick(now) {
  if (playing && now - lastTime >= 1000 / fps) {
    lastTime = now;
    stepFrame(1);
  }
  requestAnimationFrame(tick);
}
paintCandidateMeta();
paint();
requestAnimationFrame(tick);
document.querySelector('[data-play-toggle]').addEventListener('click', event => {
  playing = !playing;
  event.currentTarget.textContent = playing ? '||' : '>';
});
document.querySelector('[data-step-back]').addEventListener('click', () => {
  playing = false;
  document.querySelector('[data-play-toggle]').textContent = '>';
  stepFrame(-1);
});
document.querySelector('[data-step-forward]').addEventListener('click', () => {
  playing = false;
  document.querySelector('[data-play-toggle]').textContent = '>';
  stepFrame(1);
});
document.querySelector('[data-fps]').addEventListener('change', event => {
  fps = Number(event.target.value);
});
frameScrubber.addEventListener('input', event => {
  playing = false;
  document.querySelector('[data-play-toggle]').textContent = '>';
  index = Number(event.target.value);
  paint();
});
candidateSelect.addEventListener('change', event => {
  selectedCandidate = data.candidates.find(candidate => candidate.id === event.target.value) || selectedCandidate;
  paintCandidateMeta();
  paint();
});
</script>
</body>
</html>`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

const args = parseArgs(process.argv.slice(2));
const externalBaselineSpecs = parseExternalBaselineSpecs(process.argv.slice(2));
const externalBaselineById = new Map(externalBaselineSpecs.map(spec => [spec.id, spec]));
const candidateIds = [...BUILTIN_CANDIDATES, ...externalBaselineSpecs.map(spec => spec.id)];
const renderReportPath = args.get('--render-report') ? resolve(args.get('--render-report')) : null;
const outDir = resolve(args.get('--out-dir') || (renderReportPath ? dirname(renderReportPath) : '/tmp/kaminos-cadence-gap-interframe-witness'));
const reportPath = resolve(args.get('--report') || renderReportPath || `${outDir}/cadence-gap-interframe-report.json`);
const playbackPath = resolve(args.get('--playback') || `${outDir}/cadence-gap-interframe-playback.html`);
const dryRun = args.has('--dry-run');
const skipVideos = args.has('--skip-videos');
const createdAt = new Date().toISOString();

if (renderReportPath) {
  const report = readJson(renderReportPath);
  if (report.schema !== SCHEMA) throw new Error(`wrong cadence-gap interframe report schema: ${report.schema || 'missing'}`);
  writePlaybackHtml(playbackPath, report);
  const playbackReceiptPath = playbackPath.replace(/\.html$/i, '.receipt.json');
  writeJson(playbackReceiptPath, {
    schema: `${SCHEMA}.playback-render-receipt.v0`,
    status: 'playback-rendered',
    createdAt,
    renderReportPath,
    playbackPath,
    sourceReportStatus: report.status || null,
    sourceManifestIdentity: report.source?.manifestIdentity || null,
    candidateCount: Array.isArray(report.candidates) ? report.candidates.length : 0,
    defaultCandidateId: report.summary?.lowestTemporalMaxConsecutiveDelta?.id || report.candidates?.[0]?.id || null,
  });
  console.log(JSON.stringify({ status: 'playback-rendered', renderReportPath, playbackPath, playbackReceiptPath }, null, 2));
  process.exit(0);
}

const gapManifestPath = args.get('--gap-manifest') ? resolve(args.get('--gap-manifest')) : null;
if (!gapManifestPath) throw new Error('--gap-manifest is required');

const baseReport = {
  schema: SCHEMA,
  status: dryRun ? 'dry-run' : 'running',
  createdAt,
  updatedAt: createdAt,
  cwd,
  gitCommit: gitValue(['rev-parse', 'HEAD']),
  gitBranch: gitValue(['branch', '--show-current']),
  gitStatusShort: gitValue(['status', '--short'], ''),
  gapManifestPath,
  outDir,
  reportPath,
  playbackPath,
  dryRun,
  skipVideos,
  comparisonAuthority: CONTINUATION_TARGET_AUTHORITY,
  continuationTargetUsedAsComparison: true,
  actualMiddleUsed: false,
  syntheticAuthority: SYNTHETIC_AUTHORITY,
  failureModeBuckets: FAILURE_MODE_BUCKETS,
  externalBaselines: externalBaselineSpecs.map(spec => ({ id: spec.id, commandTemplate: spec.command })),
  source: null,
  width: null,
  height: null,
  totalFrameCount: null,
  liveAnchorCount: null,
  continuationTargetCount: null,
  baseline: null,
  candidates: [],
  summary: {},
  artifacts: {
    playbackHtml: playbackPath,
    timelineDir: resolve(outDir, 'timelines'),
    gapDir: resolve(outDir, 'gaps'),
  },
  failures: [],
};

writeJson(reportPath, baseReport);

let phase = 'manifest';
try {
  const manifest = readJson(gapManifestPath);
  if (manifest.identity !== MANIFEST_ID) {
    const error = new Error(`wrong gap manifest identity: ${manifest.identity || 'missing'}`);
    error.code = 'wrong-gap-manifest-identity';
    error.failurePhase = 'manifest';
    error.details = { expected: MANIFEST_ID, actual: manifest.identity || null };
    throw error;
  }
  if (manifest.authorityBoundary?.continuationTargetAuthority !== CONTINUATION_TARGET_AUTHORITY) {
    const error = new Error('gap manifest did not declare the expected continuation target authority');
    error.code = 'wrong-comparison-authority';
    error.failurePhase = 'manifest';
    error.details = { authorityBoundary: manifest.authorityBoundary || null };
    throw error;
  }
  const frames = [...manifest.frames].sort((a, b) => a.index - b.index).map(frame => normalizeFrame(frame, gapManifestPath));
  if (!frames.length) throw new Error('gap manifest contains no frames');
  for (const frame of frames) {
    if (!existsSync(frame.path)) throw new Error(`manifest frame image missing: ${frame.path}`);
  }
  const parsedFirst = readPngRgba(frames[0].path);
  const width = parsedFirst.width;
  const height = parsedFirst.height;
  const rgbaByIndex = new Map([[frames[0].index, parsedFirst.rgba]]);
  for (const frame of frames.slice(1)) {
    const parsed = readPngRgba(frame.path);
    if (parsed.width !== width || parsed.height !== height) throw new Error(`frame dimension drift at index ${frame.index}: ${parsed.width}x${parsed.height}, expected ${width}x${height}`);
    rgbaByIndex.set(frame.index, parsed.rgba);
  }
  const frameByIndex = new Map(frames.map(frame => [frame.index, frame]));
  const liveAnchorCount = frames.filter(frame => frame.gapFrameRole === 'live-sim-anchor').length;
  const continuationTargetCount = frames.filter(frame => frame.gapFrameRole === 'continuation-target').length;
  if (!liveAnchorCount || !continuationTargetCount) throw new Error('gap manifest must contain live anchors and continuation targets');

  const baselineTimelineDir = resolve(outDir, 'timelines', CADENCE_CONTINUATION_BASELINE);
  const baselineFrames = frames.map(frame => ({
    ...frameSummary(frame),
    timelinePath: resolve(baselineTimelineDir, `frame-${String(frame.index).padStart(3, '0')}.png`),
  }));
  writeTimelineFrames(baselineTimelineDir, baselineFrames);
  const baselineRgba = frames.map(frame => rgbaByIndex.get(frame.index));
  const baselineTemporalStats = sequenceTemporalStats(baselineRgba, width, height);
  const baseline = {
    id: CADENCE_CONTINUATION_BASELINE,
    authority: CONTINUATION_TARGET_AUTHORITY,
    continuationTargetUsedAsComparison: true,
    frames: baselineFrames,
    temporalStats: baselineTemporalStats,
    videoFps24: null,
  };

  phase = 'source-captured';
  writeJson(reportPath, {
    ...baseReport,
    status: 'source-captured',
    updatedAt: new Date().toISOString(),
    source: {
      manifestIdentity: manifest.identity,
      sourceWitnessIdentity: manifest.sourceWitnessIdentity || null,
      sourceWitnessReport: manifest.sourceWitnessReport || null,
      sourceStripImage: manifest.sourceStripImage || null,
      requestedRoute: manifest.requestedRoute || null,
      effectiveRoute: manifest.effectiveRoute || null,
      backend: manifest.backend || null,
      captureCadence: manifest.captureCadence || null,
      requestedSimCadence: manifest.requestedSimCadence || null,
      frameImageDirectory: manifest.frameImageDirectory || null,
      authorityBoundary: manifest.authorityBoundary || null,
    },
    width,
    height,
    totalFrameCount: frames.length,
    liveAnchorCount,
    continuationTargetCount,
    baseline,
  });

  if (dryRun) {
    console.log(JSON.stringify({ ...baseReport, status: 'dry-run', source: { manifestIdentity: manifest.identity }, totalFrameCount: frames.length }, null, 2));
    process.exit(0);
  }

  phase = 'candidate-synthesis';
  const candidateReportsById = new Map(candidateIds.map(id => [id, {
    id,
    sourceKind: externalBaselineById.has(id) ? 'external-command' : 'in-process-baseline',
    syntheticAuthority: SYNTHETIC_AUTHORITY,
    comparisonAuthority: CONTINUATION_TARGET_AUTHORITY,
    continuationTargetUsedAsComparison: true,
    actualMiddleUsed: false,
    syntheticFrames: [],
    timelineFrames: [],
    perTargetMetrics: [],
    temporalStats: null,
    temporalPulseVsCadenceBaseline: null,
    summaryMetrics: null,
    failureModes: [],
    failures: [],
    videoFps24: null,
  }]));

  for (const gap of manifest.continuationGaps || []) {
    const previousAnchor = frameByIndex.get(gap.previousCapturedAnchorIndex);
    const nextAnchor = frameByIndex.get(gap.nextCapturedAnchorIndex);
    if (!previousAnchor || !nextAnchor) throw new Error(`gap ${gap.cadenceGapIndex} missing previous or next anchor frame`);
    for (const targetRef of gap.continuationTargets || []) {
      const target = frameByIndex.get(targetRef.index);
      if (!target) throw new Error(`gap ${gap.cadenceGapIndex} target index ${targetRef.index} missing from frames`);
      const ratio = Number(target.cadencePhase);
      if (!(ratio > 0 && ratio < 1)) throw new Error(`gap ${gap.cadenceGapIndex} target ${target.index} has invalid cadencePhase ${target.cadencePhase}`);
      const gapIndexLabel = `${String(previousAnchor.index).padStart(3, '0')}-${String(target.index).padStart(3, '0')}-${String(nextAnchor.index).padStart(3, '0')}`;
      const gapDir = resolve(outDir, 'gaps', `gap-${gapIndexLabel}`);
      mkdirSync(gapDir, { recursive: true });
      const candidateContextPath = resolve(gapDir, `candidate-context-${gapIndexLabel}.json`);
      const candidateContext = {
        schema: CONTEXT_SCHEMA,
        status: 'gap-captured',
        sourceManifestPath: gapManifestPath,
        sourceManifestIdentity: MANIFEST_ID,
        sourceWitnessReport: manifest.sourceWitnessReport || null,
        authority: manifest.identity,
        comparisonAuthority: CONTINUATION_TARGET_AUTHORITY,
        syntheticAuthority: SYNTHETIC_AUTHORITY,
        continuationTargetUsedAsComparison: true,
        actualMiddleUsed: false,
        effectiveRoute: manifest.effectiveRoute || null,
        prototypeIdentity: manifest.prototypeIdentity || manifest.sourceWitnessIdentity || null,
        backend: manifest.backend || null,
        width,
        height,
        cadenceGapIndex: gap.cadenceGapIndex,
        cadencePhase: ratio,
        ratio,
        framesAvailableToCandidate: [frameSummary(previousAnchor), frameSummary(nextAnchor)],
        framesWithheldFromCandidate: [frameSummary(target)],
        targetFrame: frameSummary(target),
        t0: frameSummary(previousAnchor),
        t2: frameSummary(nextAnchor),
        frameCountDelta: {
          t0ToTarget: target.frameCount - previousAnchor.frameCount,
          targetToT2: nextAnchor.frameCount - target.frameCount,
          t0ToT2: nextAnchor.frameCount - previousAnchor.frameCount,
          firstToWithheld: target.frameCount - previousAnchor.frameCount,
          withheldToThird: nextAnchor.frameCount - target.frameCount,
          firstToThird: nextAnchor.frameCount - previousAnchor.frameCount,
        },
        simStepCountDelta: {
          t0ToTarget: target.simStepCount - previousAnchor.simStepCount,
          targetToT2: nextAnchor.simStepCount - target.simStepCount,
          t0ToT2: nextAnchor.simStepCount - previousAnchor.simStepCount,
          firstToWithheld: target.simStepCount - previousAnchor.simStepCount,
          withheldToThird: nextAnchor.simStepCount - target.simStepCount,
          firstToThird: nextAnchor.simStepCount - previousAnchor.simStepCount,
        },
      };
      writeJson(candidateContextPath, candidateContext);

      for (const id of candidateIds) {
        const candidateReport = candidateReportsById.get(id);
        const outPath = resolve(gapDir, `${id}.png`);
        let commandReceipt = null;
        try {
          if (externalBaselineById.has(id)) {
            commandReceipt = runExternalBaseline(externalBaselineById.get(id), {
              firstPath: previousAnchor.path,
              thirdPath: nextAnchor.path,
              targetPath: target.path,
              outPath,
              outDir,
              gapDir,
              gapIndexLabel,
              candidateContextPath,
              ratio,
              cadencePhase: ratio,
            });
          } else {
            const synthetic = builtinCandidateRgba(id, rgbaByIndex.get(previousAnchor.index), rgbaByIndex.get(nextAnchor.index), ratio);
            writeRgbaPng(outPath, width, height, synthetic);
          }
          const parsed = readPngRgba(outPath);
          if (parsed.width !== width || parsed.height !== height) throw new Error(`candidate ${id} wrote ${parsed.width}x${parsed.height}, expected ${width}x${height}`);
          const metrics = compareRgba(rgbaByIndex.get(target.index), parsed.rgba, width, height);
          const failureModes = classifyFailureModes(metrics);
          candidateReport.syntheticFrames.push({
            index: target.index,
            path: outPath,
            candidateContextPath,
            targetPath: target.path,
            cadenceGapIndex: gap.cadenceGapIndex,
            cadencePhase: ratio,
            ratio,
            continuationTargetUsedAsComparison: true,
            actualMiddleUsed: false,
            syntheticAuthority: SYNTHETIC_AUTHORITY,
            comparisonAuthority: CONTINUATION_TARGET_AUTHORITY,
            metrics,
            failureModes,
            commandReceipt,
          });
          candidateReport.perTargetMetrics.push({ index: target.index, cadenceGapIndex: gap.cadenceGapIndex, cadencePhase: ratio, metrics, failureModes });
        } catch (error) {
          candidateReport.failures.push({
            index: target.index,
            cadenceGapIndex: gap.cadenceGapIndex,
            cadencePhase: ratio,
            code: error.code || 'candidate-target-failed',
            message: error.message,
            failurePhase: error.failurePhase || 'candidate-synthesis',
            details: error.details || null,
          });
        }
      }
    }
    writeJson(reportPath, {
      ...baseReport,
      status: 'candidate-synthesis-in-progress',
      updatedAt: new Date().toISOString(),
      source: {
        manifestIdentity: manifest.identity,
        sourceWitnessIdentity: manifest.sourceWitnessIdentity || null,
        sourceWitnessReport: manifest.sourceWitnessReport || null,
        sourceStripImage: manifest.sourceStripImage || null,
        effectiveRoute: manifest.effectiveRoute || null,
        backend: manifest.backend || null,
        authorityBoundary: manifest.authorityBoundary || null,
      },
      width,
      height,
      totalFrameCount: frames.length,
      liveAnchorCount,
      continuationTargetCount,
      baseline,
      candidates: [...candidateReportsById.values()],
    });
  }

  phase = 'timeline-materialization';
  const candidates = [...candidateReportsById.values()].map(candidate => {
    const timelineDir = resolve(outDir, 'timelines', candidate.id);
    mkdirSync(timelineDir, { recursive: true });
    const syntheticByIndex = new Map(candidate.syntheticFrames.map(frame => [frame.index, frame]));
    const timelineRgba = [];
    const timelineFrames = [];
    for (const frame of frames) {
      const synthetic = syntheticByIndex.get(frame.index);
      const timelinePath = resolve(timelineDir, `frame-${String(frame.index).padStart(3, '0')}.png`);
      if (frame.gapFrameRole === 'live-sim-anchor' || !synthetic) {
        writeFileSync(timelinePath, readFileSync(frame.path));
        timelineRgba.push(rgbaByIndex.get(frame.index));
        timelineFrames.push({
          ...frameSummary(frame),
          role: frame.gapFrameRole === 'live-sim-anchor' ? 'live-sim-anchor' : 'continuation-target-unreplaced',
          timelinePath,
        });
      } else {
        writeFileSync(timelinePath, readFileSync(synthetic.path));
        timelineRgba.push(readPngRgba(synthetic.path).rgba);
        timelineFrames.push({
          ...frameSummary(frame),
          role: 'synthetic-comparison-fill',
          timelinePath,
          syntheticSourcePath: synthetic.path,
          candidateContextPath: synthetic.candidateContextPath,
        });
      }
    }
    const temporalStats = sequenceTemporalStats(timelineRgba, width, height);
    const summaryMetrics = meanMetrics(candidate.perTargetMetrics.map(entry => entry.metrics));
    const failureModes = [...new Set(candidate.perTargetMetrics.flatMap(entry => entry.failureModes))];
    return {
      ...candidate,
      timelineFrames,
      temporalStats,
      temporalPulseVsCadenceBaseline: {
        maxConsecutiveDeltaReduction: baselineTemporalStats.maxConsecutiveDelta - temporalStats.maxConsecutiveDelta,
        stdDevReduction: baselineTemporalStats.consecutiveDeltaStdDev - temporalStats.consecutiveDeltaStdDev,
        meanDeltaChange: temporalStats.meanConsecutiveDelta - baselineTemporalStats.meanConsecutiveDelta,
      },
      summaryMetrics,
      failureModes: failureModes.length ? failureModes : ['no-completed-targets'],
    };
  });

  phase = 'video';
  const videoFailures = [];
  if (!skipVideos && commandExists('ffmpeg')) {
    try {
      const baselineVideo = resolve(baselineTimelineDir, `${CADENCE_CONTINUATION_BASELINE}-24fps.mp4`);
      writeVideo(baselineTimelineDir, baselineVideo, 24);
      baseline.videoFps24 = baselineVideo;
    } catch (error) {
      videoFailures.push({ code: error.code || 'video-failed', message: error.message, failurePhase: error.failurePhase || 'video', details: error.details || null });
    }
    for (const candidate of candidates) {
      try {
        const timelineDir = resolve(outDir, 'timelines', candidate.id);
        const videoPath = resolve(timelineDir, `${candidate.id}-24fps.mp4`);
        writeVideo(timelineDir, videoPath, 24);
        candidate.videoFps24 = videoPath;
      } catch (error) {
        videoFailures.push({ candidateId: candidate.id, code: error.code || 'video-failed', message: error.message, failurePhase: error.failurePhase || 'video', details: error.details || null });
      }
    }
  }

  phase = 'playback';
  const successfulCandidates = candidates.filter(candidate => candidate.syntheticFrames.length === continuationTargetCount);
  const lowestTemporalMaxConsecutiveDelta = successfulCandidates
    .toSorted((a, b) => a.temporalStats.maxConsecutiveDelta - b.temporalStats.maxConsecutiveDelta)[0] || null;
  const closestToContinuationTarget = successfulCandidates
    .toSorted((a, b) => a.summaryMetrics.meanAbsoluteError - b.summaryMetrics.meanAbsoluteError)[0] || null;
  const finalReport = {
    ...baseReport,
    status: candidates.some(candidate => candidate.failures.length) || videoFailures.length ? 'completed-with-candidate-failures' : 'completed',
    updatedAt: new Date().toISOString(),
    source: {
      manifestIdentity: manifest.identity,
      sourceWitnessIdentity: manifest.sourceWitnessIdentity || null,
      sourceWitnessReport: manifest.sourceWitnessReport || null,
      sourceStripImage: manifest.sourceStripImage || null,
      requestedRoute: manifest.requestedRoute || null,
      effectiveRoute: manifest.effectiveRoute || null,
      backend: manifest.backend || null,
      captureCadence: manifest.captureCadence || null,
      requestedSimCadence: manifest.requestedSimCadence || null,
      frameImageDirectory: manifest.frameImageDirectory || null,
      authorityBoundary: manifest.authorityBoundary || null,
    },
    width,
    height,
    totalFrameCount: frames.length,
    liveAnchorCount,
    continuationTargetCount,
    baseline,
    candidates,
    summary: {
      cadenceContinuationBaseline: {
        id: CADENCE_CONTINUATION_BASELINE,
        temporalStats: baselineTemporalStats,
      },
      lowestTemporalMaxConsecutiveDelta: lowestTemporalMaxConsecutiveDelta ? {
        id: lowestTemporalMaxConsecutiveDelta.id,
        maxConsecutiveDelta: lowestTemporalMaxConsecutiveDelta.temporalStats.maxConsecutiveDelta,
        maxConsecutiveDeltaReduction: lowestTemporalMaxConsecutiveDelta.temporalPulseVsCadenceBaseline.maxConsecutiveDeltaReduction,
      } : null,
      closestToContinuationTarget: closestToContinuationTarget ? {
        id: closestToContinuationTarget.id,
        meanAbsoluteError: closestToContinuationTarget.summaryMetrics.meanAbsoluteError,
      } : null,
      candidateOrder: candidates.map(candidate => candidate.id),
      note: 'Continuation target metrics measure similarity to the current cadence continuation baseline. They are not actual-middle simulator truth.',
    },
    failures: videoFailures,
  };
  writePlaybackHtml(playbackPath, finalReport);
  writeJson(reportPath, {
    ...finalReport,
    artifacts: {
      ...finalReport.artifacts,
      playbackHtml: playbackPath,
    },
  });
  console.log(JSON.stringify({
    schema: SCHEMA,
    status: finalReport.status,
    reportPath,
    playbackPath,
    totalFrameCount: frames.length,
    liveAnchorCount,
    continuationTargetCount,
    candidates: candidates.map(candidate => ({
      id: candidate.id,
      completedSyntheticFrames: candidate.syntheticFrames.length,
      failures: candidate.failures.length,
      summaryMetrics: candidate.summaryMetrics,
      temporalStats: candidate.temporalStats,
      temporalPulseVsCadenceBaseline: candidate.temporalPulseVsCadenceBaseline,
      failureModes: candidate.failureModes,
      videoFps24: candidate.videoFps24,
    })),
  }, null, 2));
} catch (error) {
  const failed = {
    ...baseReport,
    status: 'failed',
    updatedAt: new Date().toISOString(),
    failurePhase: error.failurePhase || phase,
    failures: [{
      code: error.code || 'cadence-gap-interframe-witness-failed',
      message: error.message,
      failurePhase: error.failurePhase || phase,
      details: error.details || null,
      stack: error.stack,
    }],
  };
  writeJson(reportPath, failed);
  console.error(JSON.stringify(failed.failures[0], null, 2));
  process.exitCode = 1;
}

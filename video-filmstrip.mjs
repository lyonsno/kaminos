#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const requestedInput = args.get('--input') || '';
const effectiveInput = requestedInput ? resolve(requestedInput) : null;
const out = resolve(args.get('--out') || '/tmp/kaminos-video-filmstrip.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const frameCount = Math.max(1, Math.floor(Number(args.get('--frames') || 10)));
const thumbWidth = Math.max(32, Math.floor(Number(args.get('--thumb-width') || 220)));
const requestedColumns = args.get('--columns');
const tileColumns = Math.min(frameCount, Math.max(1, Math.floor(Number(requestedColumns || Math.min(4, frameCount)))));
const tileRows = Math.ceil(frameCount / tileColumns);
const cropFilter = args.get('--crop') || null;
const ffmpegPath = args.get('--ffmpeg') || 'ffmpeg';
const ffprobePath = args.get('--ffprobe') || 'ffprobe';

let phase = 'initializing';
let lastEvidence = {};

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.video-filmstrip-witness.v0',
    requestedInput,
    effectiveInput,
    outputPath: out,
    reportPath,
    frameCount,
    thumbWidth,
    requestedColumns: requestedColumns || null,
    tileColumns,
    tileRows,
    cropFilter,
    ffmpeg: ffmpegPath,
    ffprobe: ffprobePath,
    phase,
    ...lastEvidence,
    ...report,
  }, null, 2));
}

function fail(error) {
  writeReport({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function commandExists(command) {
  const result = spawnSync(command, ['-version'], { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    status: result.status,
    stderrTail: String(result.stderr || '').slice(-1000),
    stdoutHead: String(result.stdout || '').slice(0, 200),
    error: result.error?.message,
  };
}

function hashFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function probeMedia(path) {
  const result = spawnSync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=width,height,nb_frames,r_frame_rate',
    '-of', 'json',
    path,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffprobe failed ${result.status}: ${String(result.stderr || '').slice(-1000)}`);
  }
  return JSON.parse(result.stdout);
}

function firstVideoStream(probe) {
  return Array.isArray(probe.streams) ? probe.streams.find(stream => Number(stream.width) > 0 && Number(stream.height) > 0) : null;
}

function computeSelectedTimes(duration, count) {
  if (!Number.isFinite(duration) || duration <= 0) return Array.from({ length: count }, (_, index) => index);
  if (count === 1) return [0];
  const last = Math.max(0, duration - Math.min(0.001, duration * 0.001));
  return Array.from({ length: count }, (_, index) => Number(((last * index) / (count - 1)).toFixed(4)));
}

function pngMagic(path) {
  return readFileSync(path).subarray(0, 8).toString('hex');
}

try {
  phase = 'validating-args';
  if (!requestedInput) throw new Error('Missing --input');
  if (!existsSync(effectiveInput)) throw new Error(`Input does not exist: ${effectiveInput}`);

  phase = 'checking-tools';
  const ffprobeCheck = commandExists(ffprobePath);
  const ffmpegCheck = commandExists(ffmpegPath);
  lastEvidence = { ffprobeCheck, ffmpegCheck };
  if (!ffprobeCheck.ok) throw new Error(`ffprobe unavailable: ${ffprobeCheck.error || ffprobeCheck.stderrTail || ffprobeCheck.status}`);
  if (!ffmpegCheck.ok) throw new Error(`ffmpeg unavailable: ${ffmpegCheck.error || ffmpegCheck.stderrTail || ffmpegCheck.status}`);

  phase = 'reading-input-identity';
  const inputStat = statSync(effectiveInput);
  const inputSha256 = hashFile(effectiveInput);
  lastEvidence = {
    ...lastEvidence,
    inputSizeBytes: inputStat.size,
    inputMtimeMs: inputStat.mtimeMs,
    inputSha256,
  };

  phase = 'probing-media';
  const probe = probeMedia(effectiveInput);
  const stream = firstVideoStream(probe);
  if (!stream) throw new Error('No video stream found');
  const duration = Number(probe.format?.duration || 0);
  const selectedTimes = computeSelectedTimes(duration, frameCount);
  const effectiveFps = duration > 0 ? Math.max(frameCount / duration, 0.001) : 1;
  lastEvidence = {
    ...lastEvidence,
    duration,
    sourceWidth: Number(stream.width),
    sourceHeight: Number(stream.height),
    sourceFrameRate: stream.r_frame_rate || null,
    sourceFrameCount: stream.nb_frames ? Number(stream.nb_frames) : null,
    selectedTimes,
  };

  phase = 'rendering-filmstrip';
  mkdirSync(dirname(out), { recursive: true });
  const filterParts = [];
  if (cropFilter) filterParts.push(`crop=${cropFilter}`);
  filterParts.push(`fps=${effectiveFps.toFixed(8)}`);
  filterParts.push(`scale=${thumbWidth}:-1:flags=lanczos`);
  filterParts.push(`tile=${tileColumns}x${tileRows}`);
  const filter = filterParts.join(',');
  const result = spawnSync(ffmpegPath, [
    '-y',
    '-i', effectiveInput,
    '-vf', filter,
    '-frames:v', '1',
    out,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg filmstrip failed ${result.status}: ${String(result.stderr || '').slice(-2000)}`);
  }

  phase = 'validating-output';
  if (!existsSync(out)) throw new Error(`Filmstrip was not written: ${out}`);
  const outputStat = statSync(out);
  const magic = pngMagic(out);
  if (magic !== '89504e470d0a1a0a') throw new Error(`Output is not a PNG: ${magic}`);

  phase = 'complete';
  writeReport({
    ok: true,
    pngMagic: magic,
    outputSizeBytes: outputStat.size,
    renderFilter: filter,
  });
} catch (error) {
  fail(error);
}

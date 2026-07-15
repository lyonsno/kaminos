import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const STAGE_AUDIO_ANALYSIS_SCHEMA = 'kaminos.stage-audio-analysis.v0';
export const DECODED_AUDIO_FEATURE_AUTHORITY = 'decoded-audio-clock-frame-v0';
export const SOURCE_PAGE_DOWNLOAD_AUTHORITY = 'source-page-referred-download';

const BROWSER_AUDIO_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139.0 Safari/537.36';

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function rounded(value, places = 6) {
  return Number(Number(value).toFixed(places));
}

function audioDecodeError(message, stderr = '') {
  const error = new Error(stderr ? `${message}: ${stderr.trim()}` : message);
  error.code = 'audio_decode_failed';
  return error;
}

function audioDownloadError(message, receipt) {
  const error = new Error(message);
  error.code = 'audio_download_failed';
  error.receipt = receipt;
  return error;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw audioDecodeError(`${command} unavailable`, result.error.message);
  if (result.status !== 0) throw audioDecodeError(`${command} exited ${result.status}`, result.stderr);
  return result;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function fftMagnitudes(samples, start, available) {
  const size = 1024;
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const copied = Math.min(size, available);
  for (let index = 0; index < copied; index += 1) {
    const phase = copied <= 1 ? 0 : index / (copied - 1);
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
    real[index] = samples[start + index] * hann;
  }

  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imag[index], imag[reversed]] = [imag[reversed], imag[index]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imag[odd] * twiddleImag;
        const oddImag = real[odd] * twiddleImag + imag[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextReal;
      }
    }
  }

  const magnitudes = new Float64Array(size / 2);
  for (let index = 0; index < magnitudes.length; index += 1) {
    magnitudes[index] = Math.hypot(real[index], imag[index]);
  }
  return magnitudes;
}

function spectralCentroid(samples, start, available, sampleRate) {
  const magnitudes = fftMagnitudes(samples, start, available);
  let weighted = 0;
  let total = 0;
  for (let index = 1; index < magnitudes.length; index += 1) {
    const magnitude = magnitudes[index];
    weighted += (index * sampleRate / 1024) * magnitude;
    total += magnitude;
  }
  return total > 1e-12 ? clamp((weighted / total) / (sampleRate / 2)) : 0;
}

function recurrenceAt(energies, index, rateHz) {
  const motifLength = Math.max(2, Math.round(rateHz * 0.2));
  const minLag = Math.max(motifLength, Math.round(rateHz * 0.25));
  const maxLag = Math.min(index - motifLength, Math.round(rateHz * 2));
  if (maxLag < minLag) return 0;
  let strongest = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let leftPower = 0;
    let rightPower = 0;
    let meanEnergy = 0;
    for (let motif = 0; motif < motifLength; motif += 1) {
      const left = energies[index - motif];
      const right = energies[index - lag - motif];
      dot += left * right;
      leftPower += left * left;
      rightPower += right * right;
      meanEnergy += (left + right) * 0.5;
    }
    const correlation = dot / Math.sqrt(Math.max(1e-12, leftPower * rightPower));
    strongest = Math.max(strongest, correlation * clamp(meanEnergy / motifLength * 1.5));
  }
  return clamp(strongest);
}

function decodeReceipt(path) {
  const result = run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'format=duration,format_name,size,bit_rate:stream=codec_name,sample_rate,channels',
    '-of', 'json',
    path,
  ]);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    throw audioDecodeError('ffprobe returned invalid JSON', error.message);
  }
  const stream = payload.streams?.[0];
  const format = payload.format || {};
  if (!stream || !Number.isFinite(Number(stream.sample_rate)) || !Number.isFinite(Number(format.duration))) {
    throw audioDecodeError('ffprobe found no decodable first audio stream');
  }
  const bytes = readFileSync(path);
  return {
    codec: String(stream.codec_name || ''),
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
    durationSeconds: rounded(format.duration),
    format: String(format.format_name || ''),
    byteLength: statSync(path).size,
    bitRate: Number(format.bit_rate || 0),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function analyzeAudioFile(path, { featureRateHz = 20 } = {}) {
  const effectivePath = resolve(path);
  const decode = decodeReceipt(effectivePath);
  const rateHz = Number(featureRateHz);
  if (!Number.isFinite(rateHz) || rateHz <= 0) {
    const error = new Error(`invalid_feature_rate:${featureRateHz}`);
    error.code = 'invalid_feature_rate';
    throw error;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'kaminos-stage-pcm-'));
  const pcmPath = join(scratch, 'decoded.f32le');
  try {
    run('ffmpeg', [
      '-v', 'error',
      '-i', effectivePath,
      '-map', '0:a:0',
      '-vn',
      '-ac', '1',
      '-ar', String(decode.sampleRate),
      '-c:a', 'pcm_f32le',
      '-f', 'f32le',
      pcmPath,
    ]);
    const pcm = readFileSync(pcmPath);
    if (pcm.byteLength < 4 || pcm.byteLength % 4 !== 0) {
      throw audioDecodeError('ffmpeg produced invalid float PCM');
    }
    const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
    const samplesPerFrame = Math.max(1, Math.round(decode.sampleRate / rateHz));
    const rawFrames = [];
    for (let start = 0; start < samples.length; start += samplesPerFrame) {
      const available = Math.min(samplesPerFrame, samples.length - start);
      let sumSquares = 0;
      for (let index = 0; index < available; index += 1) {
        const sample = samples[start + index];
        sumSquares += sample * sample;
      }
      rawFrames.push({
        t: start / decode.sampleRate,
        rms: Math.sqrt(sumSquares / Math.max(1, available)),
        spectralCentroid: spectralCentroid(samples, start, available, decode.sampleRate),
      });
    }

    const energyReference = Math.max(1e-9, percentile(rawFrames.map(frame => frame.rms), 0.95));
    const energies = rawFrames.map(frame => clamp(frame.rms / energyReference));
    const frames = rawFrames.map((frame, index) => ({
      index,
      t: rounded(frame.t),
      energy: rounded(energies[index]),
      onsetStrength: rounded(clamp((energies[index] - (energies[index - 1] || 0)) * 3)),
      recurrenceConfidence: rounded(recurrenceAt(energies, index, rateHz)),
      spectralCentroid: rounded(frame.spectralCentroid),
    }));

    return {
      schema: STAGE_AUDIO_ANALYSIS_SCHEMA,
      effectivePath,
      fileName: basename(effectivePath),
      authority: 'decoded-local-audio-file',
      decode,
      featureClock: {
        authority: 'decoded-pcm-sample-clock',
        rateHz,
        sampleRate: decode.sampleRate,
        samplesPerFrame,
        frameCount: frames.length,
      },
      featureSummary: {
        normalization: 'per-file-rms-p95',
        maxEnergy: rounded(Math.max(...frames.map(frame => frame.energy))),
        maxOnsetStrength: rounded(Math.max(...frames.map(frame => frame.onsetStrength))),
        maxRecurrenceConfidence: rounded(Math.max(...frames.map(frame => frame.recurrenceConfidence))),
        meanSpectralCentroid: rounded(frames.reduce((sum, frame) => sum + frame.spectralCentroid, 0) / Math.max(1, frames.length)),
      },
      frames,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function audioFeatureFrameAt(analysis, timeSeconds) {
  const frames = analysis?.frames || [];
  if (frames.length === 0) throw audioDecodeError('audio analysis has no feature frames');
  const requestedTime = Math.max(0, Number(timeSeconds) || 0);
  const index = Math.min(frames.length - 1, Math.round(requestedTime * analysis.featureClock.rateHz));
  return frames[index];
}

export function selectAudioFeatureFrame(analysis, { timeSeconds = null } = {}) {
  const explicitTime = timeSeconds !== null && Number.isFinite(Number(timeSeconds));
  const frame = explicitTime
    ? audioFeatureFrameAt(analysis, Number(timeSeconds))
    : analysis.frames.reduce((selected, candidate) => {
      if (!selected) return candidate;
      if (candidate.onsetStrength !== selected.onsetStrength) {
        return candidate.onsetStrength > selected.onsetStrength ? candidate : selected;
      }
      return candidate.energy > selected.energy ? candidate : selected;
    }, null);
  if (!frame) throw audioDecodeError('audio analysis has no selectable feature frame');
  return {
    frame,
    receipt: {
      authority: explicitTime ? 'explicit-audio-time-frame' : 'strongest-onset-frame',
      requestedTimeSeconds: explicitTime ? Number(timeSeconds) : null,
      effectiveTimeSeconds: frame.t,
      frameIndex: frame.index,
      featureClockAuthority: analysis.featureClock.authority,
    },
  };
}

export async function downloadAudioSource({ downloadUrl, sourcePageUrl, cacheFile }) {
  const requestedUrl = String(downloadUrl || '');
  const referer = String(sourcePageUrl || '');
  const effectivePath = resolve(String(cacheFile || ''));
  const receipt = {
    schema: 'kaminos.stage-audio-download-receipt.v0',
    requestedUrl,
    effectiveUrl: '',
    sourcePageUrl: referer,
    effectivePath,
    authority: SOURCE_PAGE_DOWNLOAD_AUTHORITY,
    statusCode: null,
    contentType: '',
    contentLengthHeader: null,
    byteLength: null,
    sha256: '',
    status: 'requested',
  };
  if (!requestedUrl || !referer || !cacheFile) {
    throw audioDownloadError('downloadUrl, sourcePageUrl, and cacheFile are required', receipt);
  }

  let response;
  try {
    response = await fetch(requestedUrl, {
      redirect: 'follow',
      headers: {
        Referer: referer,
        'User-Agent': BROWSER_AUDIO_USER_AGENT,
        Accept: 'audio/*,application/octet-stream;q=0.9,*/*;q=0.1',
      },
    });
  } catch (error) {
    receipt.status = 'transport_failed';
    throw audioDownloadError(`audio download transport failed: ${error.message}`, receipt);
  }

  receipt.effectiveUrl = response.url || requestedUrl;
  receipt.statusCode = response.status;
  receipt.contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const declaredLength = Number(response.headers.get('content-length'));
  receipt.contentLengthHeader = Number.isFinite(declaredLength) ? declaredLength : null;
  if (!response.ok) {
    receipt.status = 'http_failed';
    throw audioDownloadError(`audio download returned HTTP ${response.status}`, receipt);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  receipt.byteLength = bytes.byteLength;
  receipt.sha256 = createHash('sha256').update(bytes).digest('hex');
  const prefix = bytes.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  const declaredAudio = receipt.contentType.startsWith('audio/') || receipt.contentType === 'application/octet-stream';
  const looksLikeMarkup = prefix.startsWith('<!doctype') || prefix.startsWith('<html') || prefix.startsWith('<?xml');
  if (!declaredAudio || looksLikeMarkup || bytes.byteLength === 0) {
    receipt.status = 'content_rejected';
    throw audioDownloadError(`downloaded response is not audio: ${receipt.contentType || 'missing content type'}`, receipt);
  }
  if (receipt.contentLengthHeader !== null && receipt.contentLengthHeader !== bytes.byteLength) {
    receipt.status = 'length_mismatch';
    throw audioDownloadError(`downloaded byte length ${bytes.byteLength} did not match ${receipt.contentLengthHeader}`, receipt);
  }

  mkdirSync(dirname(effectivePath), { recursive: true });
  const temporaryPath = `${effectivePath}.partial-${process.pid}`;
  writeFileSync(temporaryPath, bytes);
  renameSync(temporaryPath, effectivePath);
  receipt.status = 'downloaded';
  return receipt;
}

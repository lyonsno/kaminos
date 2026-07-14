#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { renderBoundarySplatRowsPng } from './boundary-splat-phase-render-witness.mjs';
import { addBitmapLabel } from './boundary-splat-moving-phase-witness.mjs';

const SCHEMA = 'kaminos-boundary-splat-destination-state-witness-v0';
const EVALUATION_SCHEMA = 'kaminos-boundary-splat-phase-destination-state-evaluation-v0';
const ROLE_AUTHORITIES = {
  reference: 'exact-heldout-valid-local-donor-support-v0',
  control: 'oracle-support-carried-donor-control-v0',
  predicted: 'frozen-destination-state-one-step-on-oracle-support-v0',
};
const COHORT_AUTHORITY = 'exact-oracle-support-motion-cohort-index-v0';
const COHORT_ORDER = ['stable-q1', 'stable-q2', 'stable-q3', 'stable-q4', 'transported', 'birth'];
const DEBUG_GAIN = 0.625;

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) result.set(key, '1');
    else {
      result.set(key, value);
      index += 1;
    }
  }
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value));
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result;
}

async function loadFloatArtifact(artifact, stride, label, authority) {
  if (
    artifact?.strideFloats !== stride
    || artifact?.dtype !== 'float32-le'
    || artifact?.authority !== authority
    || !Number.isInteger(artifact?.count)
    || artifact.count <= 0
  ) throw new Error(`${label} contract mismatch`);
  const path = resolve(String(artifact.path));
  const bytes = await readFile(path);
  if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
    throw new Error(`${label} byte/hash mismatch`);
  }
  const view = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (view.length !== artifact.count * stride) throw new Error(`${label} count mismatch`);
  return { values: new Float32Array(view), count: artifact.count };
}

async function loadRole(pair, role) {
  const authority = ROLE_AUTHORITIES[role];
  const document = pair?.[role];
  const [candidates, splats] = await Promise.all([
    loadFloatArtifact(document?.candidates, 16, `${role} candidates`, authority),
    loadFloatArtifact(document?.splats, 12, `${role} splats`, authority),
  ]);
  if (candidates.count !== splats.count) throw new Error(`${role} candidate/splat count mismatch`);
  const sites = Array.from({ length: splats.count }, (_, index) => ({
    candidate: Array.from(candidates.values.subarray(index * 16, (index + 1) * 16)),
    splat: Array.from(splats.values.subarray(index * 12, (index + 1) * 12)),
  }));
  return { sites, count: splats.count };
}

async function loadCohorts(artifact, expectedCount) {
  if (
    artifact?.authority !== COHORT_AUTHORITY
    || artifact?.dtype !== 'uint8'
    || artifact?.count !== expectedCount
    || artifact?.bytes !== expectedCount
    || JSON.stringify(artifact?.order) !== JSON.stringify(COHORT_ORDER)
  ) throw new Error('cohort artifact contract mismatch');
  const bytes = await readFile(resolve(String(artifact.path)));
  if (bytes.byteLength !== expectedCount || sha256(bytes) !== artifact.sha256) {
    throw new Error('cohort artifact byte/hash mismatch');
  }
  const cohorts = Array.from(bytes, value => COHORT_ORDER[value]);
  if (cohorts.some(value => value === undefined)) throw new Error('cohort artifact contains an unknown index');
  return cohorts;
}

function mixColor(row, color, gain) {
  const result = Array.from(row);
  for (let channel = 0; channel < 3; channel += 1) {
    result[4 + channel] = result[4 + channel] * (1 - gain) + color[channel] * gain;
  }
  return result;
}

export function buildCohortRows(sites, cohorts, debugGain = null) {
  if (!Array.isArray(sites) || sites.length !== cohorts?.length) throw new Error('cohort rows must align with sites');
  if (debugGain !== null && debugGain !== DEBUG_GAIN) throw new Error('destination-state debug gain must be exactly 0.625');
  const colors = {
    'stable-q1': [0.15, 0.9, 0.25],
    'stable-q2': [0.15, 0.9, 0.25],
    'stable-q3': [0.95, 0.8, 0.1],
    'stable-q4': [1, 0.25, 0.05],
    transported: [0.1, 0.65, 1],
    birth: [1, 0.1, 0.8],
  };
  return sites.map((site, index) => {
    const cohort = cohorts[index];
    if (!COHORT_ORDER.includes(cohort)) throw new Error(`unknown destination-state cohort ${cohort}`);
    const row = Array.from(site.splat);
    if (cohort === 'stable-q1' || cohort === 'stable-q2') row[7] *= 0.1;
    return debugGain === null ? row : mixColor(row, colors[cohort], debugGain);
  });
}

export function detectExactPeriod(hashes) {
  for (let period = 1; period <= Math.floor(hashes.length / 2); period += 1) {
    let periodic = true;
    for (let index = period; index < hashes.length; index += 1) {
      if (hashes[index] !== hashes[index % period]) {
        periodic = false;
        break;
      }
    }
    if (periodic) return period;
  }
  return null;
}

function probeVideo(path, ffprobe) {
  const result = run(ffprobe, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration',
    '-of', 'json', path,
  ], 'destination-state ffprobe');
  const document = JSON.parse(result.stdout);
  const stream = document.streams?.[0];
  if (!stream) throw new Error('destination-state video has no stream');
  const [numerator, denominator] = String(stream.r_frame_rate).split('/').map(Number);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: numerator / denominator,
    frameCount: Number(stream.nb_read_frames),
    duration: Number(document.format?.duration),
  };
}

async function encodeVideo(roleDirs, outputPath, fps, frameCount, ffmpeg, ffprobe) {
  const args = ['-y'];
  for (const directory of roleDirs) args.push('-framerate', String(fps), '-i', resolve(directory, 'frame-%03d.png'));
  args.push(
    '-filter_complex', '[0:v][1:v][2:v]hstack=inputs=3[out]',
    '-map', '[out]', '-frames:v', String(frameCount),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outputPath,
  );
  run(ffmpeg, args, 'destination-state video encode');
  const bytes = await readFile(outputPath);
  const probe = probeVideo(outputPath, ffprobe);
  if (probe.frameCount !== frameCount || Math.abs(probe.fps - fps) > 1e-9) {
    throw new Error('destination-state video frame count/cadence mismatch');
  }
  return { path: outputPath, bytes: bytes.byteLength, sha256: sha256(bytes), probe, command: [ffmpeg, ...args] };
}

async function renderFrame(rows, camera, options, label, path) {
  const rendered = renderBoundarySplatRowsPng(rows, camera, options);
  if (rendered.nonBackgroundPixelCount <= 0 || rendered.projectedSplatCount <= 0) {
    throw new Error(`${label} destination-state frame is blank`);
  }
  const png = addBitmapLabel(rendered, label);
  await writeFile(path, png);
  return {
    sha256: sha256(png),
    inputSplatCount: rendered.inputSplatCount,
    projectedSplatCount: rendered.projectedSplatCount,
    nonBackgroundPixelCount: rendered.nonBackgroundPixelCount,
  };
}

function aggregateSupportAccounting(pairs) {
  const fields = [
    'targetFrameSupportCount', 'exactSupportCount', 'excludedUnsupportedTargetCount',
    'learnedUpdatedCount', 'copiedStaticCount', 'unsupportedBirthCount',
  ];
  return Object.fromEntries(fields.map(field => [field, pairs.reduce((sum, pair) => sum + Number(pair.supportAccounting?.[field] || 0), 0)]));
}

function validateEvaluation(evaluation, evaluationBytes) {
  if (evaluation?.schema !== EVALUATION_SCHEMA || evaluation.status !== 'completed') {
    throw new Error('destination-state evaluation schema/status mismatch');
  }
  if (JSON.stringify(evaluation.roles) !== JSON.stringify(ROLE_AUTHORITIES)) {
    throw new Error('destination-state role authority mismatch');
  }
  if (
    evaluation.route?.backend !== 'mlx'
    || !/^Device\(gpu,\s*\d+\)$/i.test(String(evaluation.route?.device))
    || evaluation.route?.fallbackReason !== null
  ) throw new Error('destination-state evaluation route must be non-fallback MLX GPU');
  if (
    !Array.isArray(evaluation.pairs)
    || evaluation.pairs.length < 2
    || evaluation.temporal?.evaluatedPairCount !== evaluation.pairs.length
    || evaluation.temporal?.pairCap !== null
    || evaluation.temporal?.sampleCap !== null
  ) throw new Error('destination-state evaluation temporal completeness mismatch');
  if (!evaluation.evaluation?.allCohortsBeatCarriedDonor || !(evaluation.evaluation?.aggregate?.predictionToDonorMseRatio < 1)) {
    throw new Error('destination-state evaluation does not preserve the claimed heldout signal');
  }
  for (const identity of [evaluation.model, evaluation.evaluationManifest]) {
    if (!isSha256(identity?.sha256) || !Number.isInteger(identity?.bytes) || identity.bytes <= 0) {
      throw new Error('destination-state evaluation source identity is incomplete');
    }
  }
  return { path: null, bytes: evaluationBytes.byteLength, sha256: sha256(evaluationBytes) };
}

function inspectionGuide(report) {
  const ratio = report.signal.aggregatePredictionToDonorMseRatio.toFixed(4);
  const excluded = report.supportAccounting.excludedUnsupportedTargetCount.toLocaleString();
  const eligible = report.supportAccounting.exactSupportCount.toLocaleString();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>One-Step Destination-State Recovery</title><style>
:root{color-scheme:dark;background:#08090b;color:#f2f3f5;font-family:ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0}header,section{padding:24px max(20px,calc((100vw - 1180px)/2));border-bottom:1px solid #292d33}header{background:#111317}h1{font-size:28px;margin:0 0 10px;letter-spacing:0}h2{font-size:20px;margin:0 0 10px;letter-spacing:0}p{max-width:980px;color:#c8ccd2;line-height:1.5}strong{color:#fff}video{display:block;width:100%;max-width:1180px;margin-top:16px;background:#000}code{color:#a8d8ff}.signal{color:#9de5b0}.boundary{color:#f4cf73}
</style></head><body><header><h1>One-Step Destination-State Recovery</h1>
<p><strong>Question:</strong> Before recurrence feeds prediction error back into occupancy, does the frozen state head visibly recover the next exact held-out state better than carrying its local donor unchanged?</p>
<p class="signal"><strong>Measured answer:</strong> yes on the evaluated state channels. Across all 63 adjacent pairs and every Q3/Q4/transport/birth cohort, normalized state MSE is <code>${ratio}x</code> copied donor.</p>
<p><strong>Every frame:</strong> left = exact eligible target, middle = copied local-donor control, right = one-step learned prediction. This is a temporal sequence of separate adjacent one-step evaluations, not an autoregressive rollout.</p></header>
<section><h2>Beauty Emphasis, ${report.playback.simulatorDurationSeconds.toFixed(2)} Seconds</h2><p>Q1/Q2 static support is attenuated to 10% in every role so the trained motion-bearing state changes remain visible. Compare fine color, opacity, scale, and rotation structure between the copied middle and learned right against the exact left.</p><video controls muted playsinline preload="metadata" src="destination-state-one-step-comparison.mp4"></video></section>
<section><h2>Additive Cohort Debug, Gain 0.625</h2><p>Same payloads and cadence; display-only colors are green Q1/Q2, yellow Q3, red Q4, blue transported, and magenta birth. The mix does not alter state or model input.</p><video controls muted playsinline preload="metadata" src="destination-state-one-step-debug-comparison.mp4"></video></section>
<section><h2>Support Boundary</h2><p class="boundary">All roles share ${eligible} cumulative eligible target sites. Unsupported births are excluded from all three roles (${excluded} cumulative rows), so missing donor authority cannot be mistaken for learned state error. Copied Q1/Q2 rows remain donor state; learned residuals are applied only to the trained Q3/Q4/transport/birth population.</p></section>
<section><h2>Claim Boundary</h2><p>This witness establishes isolated one-step visual behavior on exact held-out support with valid local donor assignment. It does not establish stable recurrence, full-frame analytical-raymarch agreement, unsupported-birth synthesis, multi-basin generalization, nonstutter runtime motion, or runtime integration. Operator visual acceptance remains pending.</p></section>
</body></html>`;
}

export async function writeDestinationStateWitness(evaluationPathValue, options = {}) {
  const evaluationPath = resolve(evaluationPathValue);
  const outDir = resolve(options.outDir ?? '/tmp/kaminos-destination-state-witness');
  const reportPath = resolve(options.report ?? outDir, options.report ? '' : 'destination-state-witness.json');
  const width = Math.max(32, Math.floor(Number(options.width ?? 320)));
  const height = Math.max(32, Math.floor(Number(options.height ?? 240)));
  const ffmpeg = String(options.ffmpeg ?? 'ffmpeg');
  const ffprobe = String(options.ffprobe ?? 'ffprobe');
  let failurePhase = 'argument-validation';
  let lastTrustworthyEvidence = { evaluationPath, outDir, width, height };
  await mkdir(outDir, { recursive: true });
  try {
    failurePhase = 'evaluation-validation';
    const evaluationBytes = await readFile(evaluationPath);
    const evaluation = JSON.parse(evaluationBytes.toString('utf8'));
    const evaluationIdentity = validateEvaluation(evaluation, evaluationBytes);
    evaluationIdentity.path = evaluationPath;
    const modelBytes = await readFile(resolve(evaluation.model.path));
    const manifestBytes = await readFile(resolve(evaluation.evaluationManifest.path));
    if (modelBytes.byteLength !== evaluation.model.bytes || sha256(modelBytes) !== evaluation.model.sha256) {
      throw new Error('destination-state model byte/hash mismatch');
    }
    if (manifestBytes.byteLength !== evaluation.evaluationManifest.bytes || sha256(manifestBytes) !== evaluation.evaluationManifest.sha256) {
      throw new Error('destination-state evaluation corpus byte/hash mismatch');
    }
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const cameraById = new Map(manifest.frames.map(frame => [frame.id, frame.camera]));
    const cadenceMs = Number(evaluation.temporal.controlledStepDeltaMs);
    if (!Number.isFinite(cadenceMs) || cadenceMs <= 0) throw new Error('destination-state cadence must be positive');
    const fps = 1000 / cadenceMs;
    const roleNames = ['reference', 'control', 'predicted'];
    const labels = ['REFERENCE', 'CONTROL', 'PREDICTED'];
    for (const surface of ['beauty', 'debug']) {
      for (const role of roleNames) await mkdir(resolve(outDir, surface, role), { recursive: true });
    }
    const evidence = {
      beauty: Object.fromEntries(roleNames.map(role => [role, []])),
      debug: Object.fromEntries(roleNames.map(role => [role, []])),
    };
    const renderOptions = { width, height, radiusMultiplier: 1, kernelSharpness: 6.5 };
    failurePhase = 'role-raster';
    for (let pairIndex = 0; pairIndex < evaluation.pairs.length; pairIndex += 1) {
      const pair = evaluation.pairs[pairIndex];
      if (pair.step !== pairIndex + 1) throw new Error('destination-state pair order is not contiguous');
      const states = await Promise.all(roleNames.map(role => loadRole(pair, role)));
      if (new Set(states.map(state => state.count)).size !== 1) throw new Error(`pair ${pair.step} role support mismatch`);
      if (pair.supportAccounting?.supportChanged || pair.supportAccounting?.worldPositionsChanged) {
        throw new Error(`pair ${pair.step} changed oracle support or positions`);
      }
      const cohorts = await loadCohorts(pair.cohorts, states[0].count);
      const camera = cameraById.get(pair.targetFrameId);
      if (!camera) throw new Error(`pair ${pair.step} target camera is absent from evaluation corpus`);
      for (let roleIndex = 0; roleIndex < roleNames.length; roleIndex += 1) {
        const role = roleNames[roleIndex];
        const beautyRows = buildCohortRows(states[roleIndex].sites, cohorts);
        const debugRows = buildCohortRows(states[roleIndex].sites, cohorts, DEBUG_GAIN);
        const frameName = `frame-${String(pairIndex).padStart(3, '0')}.png`;
        evidence.beauty[role].push(await renderFrame(
          beautyRows, camera, renderOptions, labels[roleIndex], resolve(outDir, 'beauty', role, frameName),
        ));
        evidence.debug[role].push(await renderFrame(
          debugRows, camera, renderOptions, labels[roleIndex], resolve(outDir, 'debug', role, frameName),
        ));
      }
      lastTrustworthyEvidence = {
        ...lastTrustworthyEvidence,
        evaluationSha256: evaluationIdentity.sha256,
        modelSha256: evaluation.model.sha256,
        evaluationManifestSha256: evaluation.evaluationManifest.sha256,
        completedFrameCount: pairIndex + 1,
        lastCompletedPair: pair.step,
      };
    }
    const periodicity = {};
    for (const surface of ['beauty', 'debug']) {
      periodicity[surface] = {};
      for (const role of roleNames) {
        const hashes = evidence[surface][role].map(frame => frame.sha256);
        periodicity[surface][role] = {
          distinctFrameHashCount: new Set(hashes).size,
          observedExactPeriodFrames: detectExactPeriod(hashes),
        };
        if (new Set(hashes).size < 2 || detectExactPeriod(hashes) !== null) {
          throw new Error(`cached-or-periodic-${surface}-${role}-motion`);
        }
      }
    }
    failurePhase = 'video-encode';
    const frameCount = evaluation.pairs.length;
    const beautyArtifact = await encodeVideo(
      roleNames.map(role => resolve(outDir, 'beauty', role)),
      resolve(outDir, 'destination-state-one-step-comparison.mp4'), fps, frameCount, ffmpeg, ffprobe,
    );
    const debugArtifact = await encodeVideo(
      roleNames.map(role => resolve(outDir, 'debug', role)),
      resolve(outDir, 'destination-state-one-step-debug-comparison.mp4'), fps, frameCount, ffmpeg, ffprobe,
    );
    failurePhase = 'report-write';
    const report = {
      schema: SCHEMA,
      status: 'completed',
      source: {
        evaluation: evaluationIdentity,
        model: evaluation.model,
        evaluationManifest: evaluation.evaluationManifest,
        route: evaluation.route,
      },
      playback: {
        authority: 'finite-all-adjacent-one-step-evaluation-sequence-v0',
        frameCount,
        controlledStepDeltaMs: cadenceMs,
        simulatorDurationSeconds: frameCount * cadenceMs / 1000,
        requestedFps: fps,
        effectiveFps: beautyArtifact.probe.fps,
        encodedDurationSeconds: beautyArtifact.probe.duration,
        nonLoopingEncoding: true,
        boundedExactPeriodObserved: false,
        operatorMotionAcceptance: 'pending-direct-operator-visual-smoke',
      },
      roles: evaluation.roles,
      supportAccounting: aggregateSupportAccounting(evaluation.pairs),
      signal: {
        authority: evaluation.evaluation.authority,
        aggregatePredictionToDonorMseRatio: evaluation.evaluation.aggregate.predictionToDonorMseRatio,
        allCohortsBeatCarriedDonor: evaluation.evaluation.allCohortsBeatCarriedDonor,
        cohortRatios: Object.fromEntries(Object.entries(evaluation.evaluation.cohorts).map(([cohort, row]) => [cohort, row.predictionToDonorMseRatio])),
      },
      emphasis: {
        authority: 'exact-evaluator-cohort-static-attenuation-v0',
        staticCohorts: ['stable-q1', 'stable-q2'],
        motionCohorts: ['stable-q3', 'stable-q4', 'transported', 'birth'],
        staticAttenuation: 0.1,
      },
      evidence,
      periodicity,
      artifact: beautyArtifact,
      partialFlowDebug: {
        authority: 'display-only-exact-evaluator-cohort-debug-mix-v0',
        requestedGain: DEBUG_GAIN,
        effectiveGain: DEBUG_GAIN,
        stateMutation: false,
        artifact: debugArtifact,
      },
      claimBoundary: 'Isolated all-pair one-step destination-state visual evidence on exact heldout valid-donor support. No recurrence, unsupported-birth synthesis, analytical-raymarch agreement, multi-basin generalization, operator acceptance, or runtime integration.',
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resolve(outDir, 'inspection-guide.html'), inspectionGuide(report));
    return report;
  } catch (error) {
    const failure = {
      schema: SCHEMA,
      status: 'failed',
      failurePhase,
      error: error?.stack || error?.message || String(error),
      lastTrustworthyEvidence,
    };
    await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.get('--evaluation') || !args.get('--out-dir')) {
    console.error('Usage: node boundary-splat-destination-state-witness.mjs --evaluation <destination-state-evaluation.json> --out-dir <dir>');
    process.exitCode = 2;
  } else {
    try {
      const report = await writeDestinationStateWitness(args.get('--evaluation'), {
        outDir: args.get('--out-dir'), report: args.get('--report'), width: args.get('--width'), height: args.get('--height'),
        ffmpeg: args.get('--ffmpeg'), ffprobe: args.get('--ffprobe'),
      });
      console.log(JSON.stringify({ schema: report.schema, status: report.status, frames: report.playback.frameCount }, null, 2));
    } catch (error) {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    }
  }
}

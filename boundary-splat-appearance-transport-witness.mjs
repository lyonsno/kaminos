#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { renderBoundarySplatRowsPng } from './boundary-splat-phase-render-witness.mjs';
import { addBitmapLabel } from './boundary-splat-moving-phase-witness.mjs';

const SCHEMA = 'kaminos-boundary-splat-appearance-transport-witness-v0';
const EVALUATION_SCHEMA = 'kaminos-boundary-splat-phase-appearance-transport-evaluation-v0';
const ROLE_AUTHORITIES = {
  reference: 'exact-heldout-valid-local-donor-support-and-candidate-state-v0',
  sourceReuse: 'current-source-state-zero-flow-reuse-v0',
  oracleDonor: 'oracle-correspondence-transported-splat-donor-v0',
  oraclePredicted: 'oracle-correspondence-transport-plus-frozen-splat-residual-v0',
  learnedDonor: 'forced-support-best-valid-learned-displacement-splat-donor-v0',
  learnedPredicted: 'forced-support-learned-displacement-plus-frozen-splat-residual-v0',
};
const COHORT_AUTHORITY = 'exact-oracle-support-motion-cohort-index-v0';
const COHORT_ORDER = ['stable-q1', 'stable-q2', 'stable-q3', 'stable-q4', 'transported', 'birth'];
const DEBUG_GAIN = 0.625;
const BEAUTY_ROLES = ['reference', 'sourceReuse', 'oracleDonor', 'oraclePredicted', 'learnedDonor', 'learnedPredicted'];
const BEAUTY_LABELS = ['REFERENCE', 'SOURCE REUSE', 'ORACLE DONOR', 'ORACLE RESIDUAL', 'LEARNED DONOR', 'LEARNED RESIDUAL'];
const DEBUG_ROLES = ['reference', 'oracleDonor', 'oraclePredicted', 'learnedDonor', 'learnedPredicted'];
const DEBUG_LABELS = ['REFERENCE', 'ORACLE DONOR', 'ORACLE RESIDUAL', 'LEARNED DONOR', 'LEARNED RESIDUAL'];

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

export function validateAppearanceTransportRoles(roles) {
  if (
    !roles
    || typeof roles !== 'object'
    || Array.isArray(roles)
    || Object.keys(roles).length !== Object.keys(ROLE_AUTHORITIES).length
    || Object.entries(ROLE_AUTHORITIES).some(([role, authority]) => roles[role] !== authority)
  ) throw new Error('appearance transport role authority mismatch');
  return roles;
}

function mixColor(row, color, gain) {
  const result = Array.from(row);
  for (let channel = 0; channel < 3; channel += 1) {
    result[4 + channel] = result[4 + channel] * (1 - gain) + color[channel] * gain;
  }
  return result;
}

export function buildAppearanceRows(sites, cohorts = null, debugGain = null) {
  if (!Array.isArray(sites) || sites.length === 0) throw new Error('appearance rows require nonempty sites');
  if (cohorts === null && debugGain !== null) throw new Error('appearance debug rows require exact cohorts');
  if (cohorts !== null && (!Array.isArray(cohorts) || cohorts.length !== sites.length)) {
    throw new Error('appearance cohorts must align with sites');
  }
  if (debugGain !== null && debugGain !== DEBUG_GAIN) throw new Error('appearance debug gain must be exactly 0.625');
  const colors = {
    'stable-q1': [0.15, 0.9, 0.25],
    'stable-q2': [0.15, 0.9, 0.25],
    'stable-q3': [0.95, 0.8, 0.1],
    'stable-q4': [1, 0.25, 0.05],
    transported: [0.1, 0.65, 1],
    birth: [1, 0.1, 0.8],
  };
  return sites.map((site, index) => {
    if (!Array.isArray(site?.splat) || site.splat.length !== 12) throw new Error('appearance site splat contract mismatch');
    const row = Array.from(site.splat);
    if (cohorts === null) return row;
    const cohort = cohorts[index];
    if (!COHORT_ORDER.includes(cohort)) throw new Error(`unknown appearance cohort ${cohort}`);
    return debugGain === null ? row : mixColor(row, colors[cohort], debugGain);
  });
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
  return {
    count: splats.count,
    sites: Array.from({ length: splats.count }, (_, index) => ({
      candidate: Array.from(candidates.values.subarray(index * 16, (index + 1) * 16)),
      splat: Array.from(splats.values.subarray(index * 12, (index + 1) * 12)),
    })),
  };
}

async function loadCohorts(artifact, expectedCount) {
  if (
    artifact?.authority !== COHORT_AUTHORITY
    || artifact?.dtype !== 'uint8'
    || artifact?.count !== expectedCount
    || artifact?.bytes !== expectedCount
    || JSON.stringify(artifact?.order) !== JSON.stringify(COHORT_ORDER)
  ) throw new Error('appearance cohort artifact contract mismatch');
  const bytes = await readFile(resolve(String(artifact.path)));
  if (bytes.byteLength !== expectedCount || sha256(bytes) !== artifact.sha256) {
    throw new Error('appearance cohort artifact byte/hash mismatch');
  }
  const cohorts = Array.from(bytes, value => COHORT_ORDER[value]);
  if (cohorts.some(value => value === undefined)) throw new Error('appearance cohort artifact contains an unknown index');
  return cohorts;
}

function validateIdentity(identity, label) {
  if (!isSha256(identity?.sha256) || !Number.isInteger(identity?.bytes) || identity.bytes <= 0) {
    throw new Error(`${label} identity is incomplete`);
  }
  return identity;
}

export function validateAppearanceTransportEvaluation(evaluation, bytes) {
  if (evaluation?.schema !== EVALUATION_SCHEMA || evaluation.status !== 'completed') {
    throw new Error('appearance transport evaluation schema/status mismatch');
  }
  validateAppearanceTransportRoles(evaluation.roles);
  if (
    evaluation.route?.backend !== 'mlx'
    || !/^Device\(gpu,\s*\d+\)$/i.test(String(evaluation.route?.device))
    || evaluation.route?.fallbackReason !== null
  ) throw new Error('appearance transport evaluation route must be non-fallback MLX GPU');
  if (
    !Array.isArray(evaluation.pairs)
    || evaluation.pairs.length < 2
    || evaluation.temporal?.evaluatedPairCount !== evaluation.pairs.length
    || evaluation.temporal?.pairCap !== null
    || evaluation.temporal?.sampleCap !== null
    || evaluation.evaluation?.pairCap !== null
    || evaluation.evaluation?.sampleCap !== null
  ) throw new Error('appearance transport evaluation temporal completeness mismatch');
  validateIdentity(evaluation.model, 'appearance model');
  validateIdentity(evaluation.transportModel, 'transport model');
  validateIdentity(evaluation.evaluationManifest, 'evaluation corpus');
  const oracleRows = evaluation.pairs.map(pair => Number(pair.metrics?.oracleTransport?.aggregate?.predictionMse));
  const learnedRows = evaluation.pairs.map(pair => Number(pair.metrics?.learnedTransport?.aggregate?.predictionMse));
  if (
    evaluation.evaluation?.authority !== 'all-adjacent-matched-appearance-transport-comparisons-v0'
    || evaluation.evaluation?.pairCount !== evaluation.pairs.length
    || oracleRows.some(value => !Number.isFinite(value) || value < 0)
    || learnedRows.some(value => !Number.isFinite(value) || value < 0)
  ) throw new Error('appearance transport pair metrics are incomplete');
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const recomputed = {
    oracleAggregatePredictionMse: mean(oracleRows),
    learnedAggregatePredictionMse: mean(learnedRows),
    oracleBeatsLearnedPairCount: oracleRows.reduce(
      (count, oracle, index) => count + Number(oracle < learnedRows[index]), 0,
    ),
  };
  if (
    Math.abs(Number(evaluation.evaluation.oracleAggregatePredictionMse) - recomputed.oracleAggregatePredictionMse) > 1e-12
    || Math.abs(Number(evaluation.evaluation.learnedAggregatePredictionMse) - recomputed.learnedAggregatePredictionMse) > 1e-12
    || evaluation.evaluation.oracleBeatsLearnedPairCount !== recomputed.oracleBeatsLearnedPairCount
  ) throw new Error('appearance transport metric recomputation mismatch');
  return { path: null, bytes: bytes.byteLength, sha256: sha256(bytes), schema: EVALUATION_SCHEMA };
}

async function validateSourceBytes(identity, label) {
  const bytes = await readFile(resolve(String(identity.path)));
  if (bytes.byteLength !== identity.bytes || sha256(bytes) !== identity.sha256) {
    throw new Error(`${label} byte/hash mismatch`);
  }
}

function probeVideo(path, ffprobe) {
  const result = run(ffprobe, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration',
    '-of', 'json', path,
  ], 'appearance transport ffprobe');
  const document = JSON.parse(result.stdout);
  const stream = document.streams?.[0];
  if (!stream) throw new Error('appearance transport video has no stream');
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
  const inputs = roleDirs.map((_, index) => `[${index}:v]`).join('');
  args.push(
    '-filter_complex', `${inputs}hstack=inputs=${roleDirs.length}[out]`,
    '-map', '[out]', '-frames:v', String(frameCount),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outputPath,
  );
  run(ffmpeg, args, 'appearance transport video encode');
  const bytes = await readFile(outputPath);
  const probe = probeVideo(outputPath, ffprobe);
  if (probe.frameCount !== frameCount || Math.abs(probe.fps - fps) > 1e-9) {
    throw new Error('appearance transport video frame count/cadence mismatch');
  }
  return { path: outputPath, bytes: bytes.byteLength, sha256: sha256(bytes), probe, command: [ffmpeg, ...args] };
}

async function renderFrame(rows, camera, options, label, path) {
  const rendered = renderBoundarySplatRowsPng(rows, camera, options);
  if (rendered.nonBackgroundPixelCount <= 0 || rendered.projectedSplatCount <= 0) {
    throw new Error(`${label} appearance transport frame is blank`);
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

function detectExactPeriod(hashes) {
  for (let period = 1; period <= Math.floor(hashes.length / 2); period += 1) {
    if (hashes.slice(period).every((hash, index) => hash === hashes[index % period])) return period;
  }
  return null;
}

function aggregateSupportAccounting(pairs) {
  const sum = field => pairs.reduce((total, pair) => total + Number(pair.supportAccounting?.[field] || 0), 0);
  return {
    targetFrameSupportCount: sum('targetFrameSupportCount'),
    exactSupportCount: sum('exactSupportCount'),
    excludedUnsupportedTargetCount: sum('excludedUnsupportedTargetCount'),
    unsupportedBirthCount: sum('unsupportedBirthCount'),
    learnedDestinationCount: pairs.reduce(
      (total, pair) => total + Number(pair.supportAccounting?.learnedDonor?.destinationCount || 0), 0,
    ),
    deathWouldHaveWonCount: pairs.reduce(
      (total, pair) => total + Number(pair.supportAccounting?.learnedDonor?.deathWouldHaveWonCount || 0), 0,
    ),
  };
}

function inspectionGuide(report) {
  const support = report.supportAccounting;
  const deathRate = support.deathWouldHaveWonCount / Math.max(1, support.learnedDestinationCount);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Appearance Transport Falsifier</title><style>
:root{color-scheme:dark;background:#090a0c;color:#f4f5f7;font-family:ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0}header,section{padding:24px max(20px,calc((100vw - 1240px)/2));border-bottom:1px solid #2a2d32}header{background:#121419}h1{font-size:28px;margin:0 0 12px;letter-spacing:0}h2{font-size:20px;margin:0 0 10px;letter-spacing:0}p{max-width:1100px;color:#c9cdd3;line-height:1.5}strong{color:#fff}code{color:#a8d8ff}video{display:block;width:100%;margin-top:14px;background:#000}.boundary{color:#f1ce79}
</style></head><body><header><h1>Appearance Transport Falsifier</h1><p><strong>Question:</strong> Is the appearance residual head failing, or does learned local displacement hand it the wrong transported donor?</p><p><strong>This is a one-step temporal sequence:</strong> every video frame is a separate exact adjacent heldout pair. It is not a recurrent rollout. Matched roles freeze exact target support, positions, and 16-feature candidate state; only nine non-position splat channels differ.</p></header>
<section><h2>Raw Beauty, ${report.playback.simulatorDurationSeconds.toFixed(2)} Seconds</h2><p>Left to right: exact reference; current source reused with its <strong>native differing support</strong>; oracle correspondence donor; oracle donor plus the frozen appearance residual; best-valid learned donor; learned donor plus the same frozen residual. The oracle-versus-learned gap isolates displacement quality while keeping model capacity fixed.</p><video controls muted playsinline preload="metadata" src="appearance-transport-beauty.mp4"></video></section>
<section><h2>Additive Cohort Debug, Gain 0.625</h2><p>Matched-support roles only. Green marks Q1/Q2, yellow Q3, red Q4, blue transported, and magenta birth. This is display-only and does not mutate model state.</p><video controls muted playsinline preload="metadata" src="appearance-transport-debug.mp4"></video></section>
<section><h2>Accounting</h2><p>Across all pairs, learned displacement is forced to choose a valid local donor at ${support.learnedDestinationCount.toLocaleString()} destinations. Its unconstrained head preferred death at ${support.deathWouldHaveWonCount.toLocaleString()} (${(deathRate * 100).toFixed(2)}%). Unsupported births excluded from matched roles: ${support.excludedUnsupportedTargetCount.toLocaleString()}. Source reuse is not allowed to impersonate matched support.</p></section>
<section><h2>Claim Boundary</h2><p class="boundary">This witness diagnoses one-step appearance transport on one heldout basin through the isolated offline raster. Different appearance is not analytical-raymarch error. It does not prove recurrence, unsupported-birth synthesis, multi-basin generalization, runtime integration, or product closure. Operator motion acceptance remains pending.</p></section></body></html>`;
}

export async function writeAppearanceTransportWitness(evaluationPathValue, options = {}) {
  const evaluationPath = resolve(evaluationPathValue);
  const outDir = resolve(options.outDir ?? '/tmp/kaminos-appearance-transport-witness');
  const reportPath = resolve(options.report ?? resolve(outDir, 'appearance-transport-witness.json'));
  const width = Math.max(32, Math.floor(Number(options.width ?? 300)));
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
    const evaluationIdentity = validateAppearanceTransportEvaluation(evaluation, evaluationBytes);
    evaluationIdentity.path = evaluationPath;
    await Promise.all([
      validateSourceBytes(evaluation.model, 'appearance model'),
      validateSourceBytes(evaluation.transportModel, 'transport model'),
      validateSourceBytes(evaluation.evaluationManifest, 'evaluation corpus'),
    ]);
    const manifestBytes = await readFile(resolve(evaluation.evaluationManifest.path));
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const cameraById = new Map(manifest.frames.map(frame => [frame.id, frame.camera]));
    const cadenceMs = Number(evaluation.temporal.controlledStepDeltaMs);
    if (!Number.isFinite(cadenceMs) || cadenceMs <= 0) throw new Error('appearance transport cadence must be positive');
    const fps = 1000 / cadenceMs;
    for (const [surface, roles] of [['beauty', BEAUTY_ROLES], ['debug', DEBUG_ROLES]]) {
      for (const role of roles) await mkdir(resolve(outDir, surface, role), { recursive: true });
    }
    const evidence = {
      beauty: Object.fromEntries(BEAUTY_ROLES.map(role => [role, []])),
      debug: Object.fromEntries(DEBUG_ROLES.map(role => [role, []])),
    };
    const renderOptions = { width, height, radiusMultiplier: 1, kernelSharpness: 6.5 };
    failurePhase = 'role-raster';
    for (let pairIndex = 0; pairIndex < evaluation.pairs.length; pairIndex += 1) {
      const pair = evaluation.pairs[pairIndex];
      if (pair.step !== pairIndex + 1) throw new Error('appearance transport pair order is not contiguous');
      const roleStates = Object.fromEntries(await Promise.all(
        BEAUTY_ROLES.map(async role => [role, await loadRole(pair, role)]),
      ));
      const matchedCount = roleStates.reference.count;
      if (DEBUG_ROLES.some(role => roleStates[role].count !== matchedCount)) {
        throw new Error(`pair ${pair.step} matched role support mismatch`);
      }
      if (
        pair.supportAccounting?.supportChanged
        || pair.supportAccounting?.worldPositionsChanged
        || pair.supportAccounting?.candidateStateFrozenToExact !== true
        || pair.supportAccounting?.learnedCompositionMatchesOracleSupport !== true
      ) throw new Error(`pair ${pair.step} violated frozen appearance support`);
      const cohorts = await loadCohorts(pair.cohorts, matchedCount);
      const camera = cameraById.get(pair.targetFrameId);
      if (!camera) throw new Error(`pair ${pair.step} target camera is absent from evaluation corpus`);
      const frameName = `frame-${String(pairIndex).padStart(3, '0')}.png`;
      for (let roleIndex = 0; roleIndex < BEAUTY_ROLES.length; roleIndex += 1) {
        const role = BEAUTY_ROLES[roleIndex];
        evidence.beauty[role].push(await renderFrame(
          buildAppearanceRows(roleStates[role].sites), camera, renderOptions, BEAUTY_LABELS[roleIndex],
          resolve(outDir, 'beauty', role, frameName),
        ));
      }
      for (let roleIndex = 0; roleIndex < DEBUG_ROLES.length; roleIndex += 1) {
        const role = DEBUG_ROLES[roleIndex];
        evidence.debug[role].push(await renderFrame(
          buildAppearanceRows(roleStates[role].sites, cohorts, DEBUG_GAIN), camera, renderOptions, DEBUG_LABELS[roleIndex],
          resolve(outDir, 'debug', role, frameName),
        ));
      }
      lastTrustworthyEvidence = {
        ...lastTrustworthyEvidence,
        evaluationSha256: evaluationIdentity.sha256,
        appearanceModelSha256: evaluation.model.sha256,
        transportModelSha256: evaluation.transportModel.sha256,
        evaluationManifestSha256: evaluation.evaluationManifest.sha256,
        completedFrameCount: pairIndex + 1,
        lastCompletedPair: pair.step,
      };
    }
    const periodicity = {};
    for (const [surface, roles] of [['beauty', BEAUTY_ROLES], ['debug', DEBUG_ROLES]]) {
      periodicity[surface] = {};
      for (const role of roles) {
        const hashes = evidence[surface][role].map(frame => frame.sha256);
        const period = detectExactPeriod(hashes);
        periodicity[surface][role] = { distinctFrameHashCount: new Set(hashes).size, observedExactPeriodFrames: period };
        if (new Set(hashes).size < 2 || period !== null) throw new Error(`cached-or-periodic-${surface}-${role}-motion`);
      }
    }
    failurePhase = 'video-encode';
    const frameCount = evaluation.pairs.length;
    const beauty = await encodeVideo(
      BEAUTY_ROLES.map(role => resolve(outDir, 'beauty', role)),
      resolve(outDir, 'appearance-transport-beauty.mp4'), fps, frameCount, ffmpeg, ffprobe,
    );
    const debug = await encodeVideo(
      DEBUG_ROLES.map(role => resolve(outDir, 'debug', role)),
      resolve(outDir, 'appearance-transport-debug.mp4'), fps, frameCount, ffmpeg, ffprobe,
    );
    failurePhase = 'report-write';
    const report = {
      schema: SCHEMA,
      status: 'completed',
      source: {
        evaluation: evaluationIdentity,
        appearanceModel: evaluation.model,
        transportModel: evaluation.transportModel,
        evaluationManifest: evaluation.evaluationManifest,
        route: evaluation.route,
      },
      playback: {
        authority: 'finite-all-adjacent-one-step-appearance-transport-sequence-v0',
        frameCount,
        controlledStepDeltaMs: cadenceMs,
        simulatorDurationSeconds: frameCount * cadenceMs / 1000,
        requestedFps: fps,
        effectiveFps: beauty.probe.fps,
        encodedDurationSeconds: beauty.probe.duration,
        nonLoopingEncoding: true,
        boundedExactPeriodObserved: false,
        operatorMotionAcceptance: 'pending-direct-operator-visual-smoke',
      },
      roles: evaluation.roles,
      supportAccounting: aggregateSupportAccounting(evaluation.pairs),
      signal: evaluation.evaluation,
      evidence,
      periodicity,
      artifact: beauty,
      partialFlowDebug: {
        authority: 'display-only-exact-appearance-cohort-debug-mix-v0',
        requestedGain: DEBUG_GAIN,
        effectiveGain: DEBUG_GAIN,
        stateMutation: false,
        artifact: debug,
      },
      claimBoundary: 'One-step appearance-only oracle-versus-learned donor visual evidence on one heldout basin and isolated offline raster. No recurrence, unsupported-birth synthesis, analytical-raymarch agreement, multi-basin generalization, operator acceptance, runtime integration, or product closure.',
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
    console.error('Usage: node boundary-splat-appearance-transport-witness.mjs --evaluation <evaluation.json> --out-dir <dir>');
    process.exitCode = 2;
  } else {
    try {
      const report = await writeAppearanceTransportWitness(args.get('--evaluation'), {
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

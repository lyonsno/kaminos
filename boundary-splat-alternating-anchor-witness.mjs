#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderBoundarySplatRowsPng } from './boundary-splat-phase-render-witness.mjs';
import { addBitmapLabel } from './boundary-splat-moving-phase-witness.mjs';
import {
  buildBoundedTransportCorrespondence,
  interpolateTransportRows,
} from './boundary-splat-phase-transport.mjs';

const NATURAL_AUTHORITY = 'exact-simulator-state-every-display-frame-v0';
const HOLD_AUTHORITY = 'prior-exact-even-anchor-byte-repeated-v0';
const CAUSAL_AUTHORITY = 'causal-one-step-prediction-from-prior-exact-anchor-v0';
const ORACLE_AUTHORITY = 'exact-target-support-world-position-offline-upper-bound-v0';
const INTERPOLATED_AUTHORITY = 'noncausal-exact-neighbor-interpolation-v0';
const SCHEMA = 'kaminos-boundary-splat-alternating-anchor-witness-v0';
const CORPUS_SCHEMA = 'kaminos-boundary-splat-phase-candidate-corpus-v0';
const PREDICTION_SCHEMA = 'kaminos-boundary-splat-phase-transport-predictions-v0';
const ORACLE_SCHEMA = 'kaminos-boundary-splat-phase-appearance-transport-evaluation-v0';
const EXACT_SPLAT_AUTHORITY = 'intercepted-live-boundary-splat-buffer-post-compaction-v0';
const ORACLE_SPLAT_AUTHORITY = 'oracle-correspondence-transport-plus-frozen-splat-residual-v0';
const FEATURE_ORDER = [
  'sidecar.support', 'sidecar.coverage', 'sidecar.ridge', 'sidecar.footprint',
  'material.density', 'material.heat', 'material.fuel', 'material.detail',
  'fire.energy', 'fire.temperature', 'fire.emission', 'fire.detail',
  'micro.x', 'micro.y', 'micro.z', 'micro.w',
];
const ROLE_LABELS = {
  natural: 'NATURAL',
  hold: 'HOLD',
  causal: 'CAUSAL',
  oracle: 'ORACLE',
  interpolated: 'INTERP',
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value));
}

async function readJsonRecord(pathValue) {
  const path = resolve(String(pathValue));
  const bytes = await readFile(path);
  return {
    path,
    bytes,
    identity: { path, bytes: bytes.byteLength, sha256: sha256(bytes) },
    document: JSON.parse(bytes),
  };
}

function sameIdentity(actual, declared) {
  return Boolean(
    declared
    && resolve(String(declared.path)) === actual.path
    && declared.bytes === actual.bytes.byteLength
    && declared.sha256 === actual.identity.sha256
  );
}

function validateIdentity(identity, label) {
  if (
    !identity
    || typeof identity.path !== 'string'
    || !identity.path
    || !Number.isInteger(identity.bytes)
    || identity.bytes <= 0
    || !isSha256(identity.sha256)
  ) throw new Error(`${label} identity is missing or malformed`);
}

function gpuRoute(route, label) {
  if (
    route?.backend !== 'mlx'
    || !/^Device\(gpu,\s*\d+\)$/i.test(String(route.device))
    || route.fallbackReason !== null
  ) throw new Error(`${label} must use non-fallback MLX GPU`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) values.set(key, '1');
    else {
      values.set(key, value);
      index += 1;
    }
  }
  return values;
}

function sameArtifact(left, right) {
  return Boolean(
    left
    && right
    && left.path === right.path
    && left.bytes === right.bytes
    && left.sha256 === right.sha256
    && left.count === right.count
    && left.strideFloats === right.strideFloats
    && left.dtype === right.dtype
  );
}

function sameState(left, right) {
  return Boolean(
    left
    && right
    && sameArtifact(left.candidates, right.candidates)
    && sameArtifact(left.splats, right.splats)
  );
}

export function validateAlternatingPlayback(frameCount, controlledStepDeltaMs) {
  if (!Number.isInteger(frameCount) || frameCount < 3 || frameCount % 2 !== 1) {
    throw new Error('alternating playback requires an odd frame count ending on an exact anchor');
  }
  if (
    !Number.isFinite(controlledStepDeltaMs)
    || controlledStepDeltaMs < 16
    || controlledStepDeltaMs > 17.5
  ) throw new Error('alternating playback requires truthful fine display cadence near 16.667 ms');
  const durationSeconds = ((frameCount - 1) * controlledStepDeltaMs) / 1000;
  if (durationSeconds < 4) throw new Error('alternating playback requires at least four seconds');
  return {
    frameCount,
    controlledStepDeltaMs,
    fps: 1000 / controlledStepDeltaMs,
    durationSeconds,
    minimumDurationSeconds: 4,
    frameCap: null,
  };
}

export function buildAlternatingRolePlan(manifestFrames, predictionFrames, oraclePairs) {
  if (
    !Array.isArray(manifestFrames)
    || !Array.isArray(predictionFrames)
    || manifestFrames.length < 3
    || manifestFrames.length % 2 !== 1
    || predictionFrames.length !== manifestFrames.length
  ) throw new Error('alternating role plan requires aligned odd-length exact and prediction sequences');
  const oracleByTarget = new Map(
    (oraclePairs || []).map(pair => [`${pair.sourceFrameId}->${pair.targetFrameId}`, pair]),
  );
  const plan = manifestFrames.map((exactState, displayFrameIndex) => {
    const predictionState = predictionFrames[displayFrameIndex];
    if (
      exactState?.controlledStepFrameIndex !== displayFrameIndex
      || predictionState?.displayFrameIndex !== displayFrameIndex
      || predictionState?.referenceFrameId !== exactState.id
    ) throw new Error('alternating role plan frame identity mismatch');
    if (displayFrameIndex % 2 === 0) {
      return {
        displayFrameIndex,
        referenceFrameId: exactState.id,
        exactState,
        priorExactAnchor: exactState,
        nextExactAnchor: exactState,
        natural: { authority: NATURAL_AUTHORITY, state: exactState },
        hold: { authority: HOLD_AUTHORITY, state: exactState },
        causal: { authority: CAUSAL_AUTHORITY, state: exactState, sourceFrameId: exactState.id },
        oracle: { authority: ORACLE_AUTHORITY, state: exactState },
        interpolated: { authority: INTERPOLATED_AUTHORITY, state: exactState, noncausal: false },
      };
    }
    const priorExactAnchor = manifestFrames[displayFrameIndex - 1];
    const nextExactAnchor = manifestFrames[displayFrameIndex + 1];
    const oraclePair = oracleByTarget.get(`${priorExactAnchor.id}->${exactState.id}`);
    if (!oraclePair?.oraclePredicted) {
      throw new Error(`alternating role plan lacks oracle pair ${priorExactAnchor.id}->${exactState.id}`);
    }
    return {
      displayFrameIndex,
      referenceFrameId: exactState.id,
      exactState,
      priorExactAnchor,
      nextExactAnchor,
      natural: { authority: NATURAL_AUTHORITY, state: exactState },
      hold: { authority: HOLD_AUTHORITY, state: priorExactAnchor },
      causal: {
        authority: CAUSAL_AUTHORITY,
        state: predictionState,
        sourceFrameId: predictionState.sourceFrameId,
      },
      oracle: { authority: ORACLE_AUTHORITY, state: oraclePair.oraclePredicted },
      interpolated: {
        authority: INTERPOLATED_AUTHORITY,
        left: priorExactAnchor,
        right: nextExactAnchor,
        fraction: 0.5,
        noncausal: true,
      },
    };
  });
  validateAlternatingRolePlan(plan);
  return plan;
}

export function validateAlternatingRolePlan(plan) {
  if (!Array.isArray(plan) || plan.length < 3 || plan.length % 2 !== 1) {
    throw new Error('alternating role plan must be a nonempty odd-length sequence');
  }
  for (let index = 0; index < plan.length; index += 1) {
    const row = plan[index];
    if (row?.displayFrameIndex !== index || row.referenceFrameId !== row.exactState?.id) {
      throw new Error('alternating role plan display identity mismatch');
    }
    if (row.natural?.authority !== NATURAL_AUTHORITY || !sameState(row.natural.state, row.exactState)) {
      throw new Error('natural full-rate control must bind the exact display-frame state');
    }
    if (row.hold?.authority !== HOLD_AUTHORITY || !sameState(row.hold.state, row.priorExactAnchor)) {
      throw new Error('hold control must byte-repeat the prior exact anchor');
    }
    if (row.causal?.authority !== CAUSAL_AUTHORITY) {
      throw new Error('causal role authority mismatch');
    }
    if (index % 2 === 1) {
      if (
        row.causal.sourceFrameId !== row.priorExactAnchor?.id
        || row.causal.state?.sourceFrameId !== row.priorExactAnchor?.id
      ) throw new Error('causal odd frame must source only the prior exact anchor');
      if (
        row.oracle?.authority !== ORACLE_AUTHORITY
        || row.interpolated?.authority !== INTERPOLATED_AUTHORITY
        || row.interpolated.left?.id !== row.priorExactAnchor?.id
        || row.interpolated.right?.id !== row.nextExactAnchor?.id
        || row.interpolated.fraction !== 0.5
        || row.interpolated.noncausal !== true
      ) throw new Error('offline comparison role authority mismatch');
    }
  }
  return plan;
}

function validateInputDocuments(manifestRecord, predictionRecord, oracleRecord) {
  const manifest = manifestRecord.document;
  const prediction = predictionRecord.document;
  const oracle = oracleRecord.document;
  if (
    manifest?.schema !== CORPUS_SCHEMA
    || JSON.stringify(manifest.featureOrder) !== JSON.stringify(FEATURE_ORDER)
    || manifest.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0'
    || !Array.isArray(manifest.frames)
  ) throw new Error('alternating witness exact corpus contract mismatch');
  const cadence = Number(manifest.frames[0]?.controlledStepDeltaMs);
  const playback = validateAlternatingPlayback(manifest.frames.length, cadence);
  const frameIds = manifest.frames.map((frame, index) => {
    if (
      frame?.id !== `frame-${index}`
      || frame.controlledStepFrameIndex !== index
      || Math.abs(Number(frame.controlledStepDeltaMs) - cadence) > 1e-6
      || frame.fallbackReason !== null
      || frame.sourceAuthority !== 'live-baked-sidecar-plus-fluid-material-v0'
      || frame.rendererIdentity !== 'live-boundary-sidecar-learned-attribute-splats-v0'
      || !frame.camera
      || frame.splats?.authority !== EXACT_SPLAT_AUTHORITY
    ) throw new Error(`alternating witness exact frame ${index} contract mismatch`);
    if (index > 0 && !(Number(frame.simStepCount) > Number(manifest.frames[index - 1].simStepCount))) {
      throw new Error('natural full-rate simulator step sequence must advance every display frame');
    }
    return frame.id;
  });
  if (new Set(manifest.frames.map(frame => frame.splats.sha256)).size < 2) {
    throw new Error('natural full-rate exact corpus is a repeated-frame counterfeit');
  }
  if (prediction?.schema !== PREDICTION_SCHEMA || prediction.status !== 'completed') {
    throw new Error('alternating witness prediction schema/status mismatch');
  }
  gpuRoute(prediction.route, 'alternating prediction route');
  if (!sameIdentity(manifestRecord, prediction.manifest)) {
    throw new Error('alternating prediction evaluation corpus identity mismatch');
  }
  validateIdentity(prediction.modelTrainingManifest, 'alternating prediction training corpus');
  validateIdentity(prediction.model, 'alternating transport model');
  validateIdentity(prediction.destinationStateModel, 'alternating destination-state model');
  if (prediction.modelTrainingManifest.sha256 === manifestRecord.identity.sha256) {
    throw new Error('alternating prediction training/evaluation corpus leakage');
  }
  const temporal = prediction.temporal;
  if (
    temporal?.authority !== 'alternating-exact-anchor-causal-odd-projection-v0'
    || Math.abs(Number(temporal.controlledStepDeltaMs) - cadence) > 1e-6
    || temporal.exactAnchorParity !== 'even'
    || temporal.heldoutTargetParity !== 'odd'
    || temporal.targetFramesAvailableToPredictor !== false
    || temporal.inferenceCorpusSeenDuringTraining !== false
    || JSON.stringify(temporal.producedSequenceRoles) !== JSON.stringify(['exact-even-anchor', 'causal-odd-prediction'])
  ) throw new Error('alternating prediction temporal authority mismatch');
  const natural = temporal.naturalFullRateControl;
  if (
    natural?.authority !== 'exact-controlled-step-corpus-all-display-frames-v0'
    || natural.visible !== true
    || natural.simulatorAdvancedEveryDisplayFrame !== true
    || natural.frameCount !== frameIds.length
    || JSON.stringify(natural.frameIds) !== JSON.stringify(frameIds)
    || !sameIdentity(manifestRecord, natural.sourceManifest)
  ) throw new Error('natural full-rate frame identity mismatch');
  if (
    temporal.holdControlAuthority !== 'prior-exact-even-anchor-byte-repeated-on-odd-display-frames-v0'
    || temporal.interpolationAuthority !== INTERPOLATED_AUTHORITY
    || temporal.oracleScaffoldAuthority !== ORACLE_AUTHORITY
    || !Array.isArray(prediction.frames)
    || prediction.frames.length !== frameIds.length
  ) throw new Error('alternating comparison role declaration mismatch');
  for (let index = 0; index < prediction.frames.length; index += 1) {
    const frame = prediction.frames[index];
    const expectedSource = `frame-${index % 2 === 0 ? index : index - 1}`;
    const expectedAuthority = index % 2 === 0
      ? 'exact-natural-full-rate-anchor-v0'
      : CAUSAL_AUTHORITY;
    if (
      frame.displayFrameIndex !== index
      || frame.referenceFrameId !== frameIds[index]
      || frame.sourceFrameId !== expectedSource
      || frame.roleAuthority !== expectedAuthority
      || frame.splats?.authority !== expectedAuthority
    ) throw new Error(`alternating prediction frame ${index} role mismatch`);
  }
  if (oracle?.schema !== ORACLE_SCHEMA || oracle.status !== 'completed') {
    throw new Error('alternating oracle evaluation schema/status mismatch');
  }
  gpuRoute(oracle.route, 'alternating oracle route');
  if (
    !sameIdentity(manifestRecord, oracle.evaluationManifest)
    || Math.abs(Number(oracle.temporal?.controlledStepDeltaMs) - cadence) > 1e-6
    || oracle.temporal?.pairCap !== null
    || oracle.temporal?.sampleCap !== null
    || !Array.isArray(oracle.pairs)
    || oracle.pairs.length !== (frameIds.length - 1) / 2
  ) throw new Error('alternating oracle corpus/temporal completeness mismatch');
  const rolePlan = buildAlternatingRolePlan(manifest.frames, prediction.frames, oracle.pairs);
  return { playback, rolePlan };
}

async function loadSplatState(state, label, expectedAuthority = null) {
  const artifact = state?.splats;
  const candidateArtifact = state?.candidates;
  if (
    artifact?.strideFloats !== 12
    || artifact.dtype !== 'float32-le'
    || !Number.isInteger(artifact.count)
    || artifact.count <= 0
    || (expectedAuthority !== null && artifact.authority !== expectedAuthority)
  ) throw new Error(`${label} splat artifact contract mismatch`);
  if (
    candidateArtifact?.strideFloats !== 16
    || candidateArtifact.dtype !== 'float32-le'
    || candidateArtifact.count !== artifact.count
  ) throw new Error(`${label} candidate artifact contract mismatch`);
  const [bytes, candidateBytes] = await Promise.all([
    readFile(resolve(String(artifact.path))),
    readFile(resolve(String(candidateArtifact.path))),
  ]);
  if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
    throw new Error(`${label} splat byte/hash mismatch`);
  }
  if (
    candidateBytes.byteLength !== candidateArtifact.bytes
    || sha256(candidateBytes) !== candidateArtifact.sha256
  ) throw new Error(`${label} candidate byte/hash mismatch`);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const candidateValues = new Float32Array(
    candidateBytes.buffer,
    candidateBytes.byteOffset,
    candidateBytes.byteLength / 4,
  );
  if (values.length !== artifact.count * 12) throw new Error(`${label} splat count mismatch`);
  if (candidateValues.length !== artifact.count * 16) throw new Error(`${label} candidate count mismatch`);
  const rows = Array.from({ length: artifact.count }, (_, index) => (
    Array.from(values.subarray(index * 12, (index + 1) * 12))
  ));
  const candidates = Array.from({ length: artifact.count }, (_, index) => (
    Array.from(candidateValues.subarray(index * 16, (index + 1) * 16))
  ));
  return {
    rows,
    sites: rows.map((row, index) => ({
      position: row.slice(0, 3),
      candidate: candidates[index],
      splat: row,
    })),
  };
}

function interpolateStates(left, right, gridStep) {
  const correspondence = buildBoundedTransportCorrespondence(left.sites, right.sites, {
    gridStep,
    radiusCells: 1,
  });
  const rows = interpolateTransportRows(left.sites, right.sites, correspondence.matches, 0.5);
  for (const targetIndex of correspondence.births) {
    const birth = Array.from(right.sites[targetIndex].splat);
    birth[7] *= 0.5;
    rows.push(birth);
  }
  for (const sourceIndex of correspondence.deaths) {
    const death = Array.from(left.sites[sourceIndex].splat);
    death[7] *= 0.5;
    rows.push(death);
  }
  return { rows, correspondence };
}

function renderRows(rows, camera, options, label) {
  const rendered = renderBoundarySplatRowsPng(rows, camera, options);
  if (
    rendered.projectedSplatCount <= 0
    || rendered.nonBackgroundPixelCount <= 0
    || rendered.maxLuminance <= rendered.backgroundLuminance
  ) throw new Error(`${label} rendered blank or partial`);
  return rendered;
}

async function encodeFiveRoleVideo(roleDirs, outputPath, playback, ffmpeg, ffprobe) {
  const args = ['-y'];
  for (const directory of roleDirs) {
    args.push('-framerate', String(playback.fps), '-i', resolve(directory, 'frame-%04d.png'));
  }
  args.push(
    '-filter_complex', '[0:v][1:v][2:v][3:v][4:v]hstack=inputs=5[out]',
    '-map', '[out]', '-frames:v', String(playback.frameCount),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', outputPath,
  );
  run(ffmpeg, args, 'alternating five-role video encode');
  const probeResult = run(ffprobe, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration',
    '-of', 'json', outputPath,
  ], 'alternating five-role ffprobe');
  const probe = JSON.parse(probeResult.stdout);
  const stream = probe.streams?.[0];
  const [numerator, denominator] = String(stream?.r_frame_rate).split('/').map(Number);
  const result = {
    width: Number(stream?.width),
    height: Number(stream?.height),
    fps: numerator / denominator,
    frameCount: Number(stream?.nb_read_frames),
    durationSeconds: Number(probe.format?.duration),
  };
  if (
    result.frameCount !== playback.frameCount
    || result.durationSeconds < playback.minimumDurationSeconds
    || !Number.isFinite(result.fps)
  ) throw new Error('alternating five-role video probe mismatch');
  return result;
}

function guideHtml(report) {
  const rows = [
    ['NATURAL FULL-RATE', 'Exact captured simulator splat state at every display frame, rendered through the isolated comparison raster. This is not an analytical-raymarch claim.'],
    ['HOLD HALF-RATE', 'Prior exact even anchor repeated on each odd display frame. This is the production-shaped no-intervention baseline.'],
    ['CAUSAL PREDICTED', 'Frozen learned one-step odd prediction from the prior exact even anchor; exact odd target is unavailable to the predictor.'],
    ['ORACLE-SCAFFOLD', 'Offline upper bound using exact target support and world positions. It is noncausal and cannot represent a production path.'],
    ['INTERPOLATED', 'Offline midpoint between neighboring exact even anchors. It uses the future anchor and is explicitly noncausal.'],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alternating Anchor Phase Witness</title><style>
body{margin:0;background:#111;color:#eee;font:14px/1.45 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:20px}h1{font-size:24px;margin:0 0 8px}p{max-width:1000px;color:#bbb}video{width:100%;background:#000;display:block}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{text-align:left;vertical-align:top;border-top:1px solid #444;padding:9px}th{width:190px;color:#fff}code{color:#9ed0ff}</style></head>
<body><main><h1>Alternating Anchor Phase Witness</h1>
<p>Context: one ${report.playback.durationSeconds.toFixed(3)}-second fine-cadence basin at <code>${report.playback.controlledStepDeltaMs} ms</code>. Panels are simultaneous role views of each display frame, not five successive temporal frames. Judge whether causal odd predictions remove the visible half-rate hitch while retaining plausible fine motion; do not interpret isolated-raster appearance difference as analytical-raymarch error.</p>
<video controls playsinline src="alternating-anchor-five-role.mp4"></video><table><tbody>${rows.map(([name, description]) => `<tr><th>${name}</th><td>${description}</td></tr>`).join('')}</tbody></table>
<p>Corpus <code>${report.inputs.manifest.sha256}</code>; transport <code>${report.inputs.transportModel.sha256}</code>; destination state <code>${report.inputs.destinationStateModel.sha256}</code>; oracle evaluation <code>${report.inputs.oracleEvaluation.sha256}</code>.</p>
</main></body></html>\n`;
}

export async function writeAlternatingAnchorWitness(manifestPath, predictionsPath, oraclePath, options = {}) {
  const outDir = resolve(String(options.outDir || 'alternating-anchor-witness'));
  const reportPath = resolve(outDir, 'alternating-anchor-witness-report.json');
  const outputPath = resolve(outDir, 'alternating-anchor-five-role.mp4');
  const guidePath = resolve(outDir, 'inspection-guide.html');
  const roleNames = Object.keys(ROLE_LABELS);
  const roleDirs = roleNames.map(role => resolve(outDir, `frames-${role}`));
  const startedAt = Date.now() / 1000;
  let failurePhase = 'output-cleanup';
  let lastTrustworthy = {
    requestedManifestPath: resolve(String(manifestPath)),
    requestedPredictionsPath: resolve(String(predictionsPath)),
    requestedOraclePath: resolve(String(oraclePath)),
    requestedOutDir: outDir,
  };
  await mkdir(outDir, { recursive: true });
  try {
    await Promise.all([
      rm(outputPath, { force: true }),
      rm(guidePath, { force: true }),
      ...roleDirs.map(path => rm(path, { recursive: true, force: true })),
    ]);
    failurePhase = 'input-validation';
    const [manifestRecord, predictionRecord, oracleRecord] = await Promise.all([
      readJsonRecord(manifestPath),
      readJsonRecord(predictionsPath),
      readJsonRecord(oraclePath),
    ]);
    const { playback, rolePlan } = validateInputDocuments(
      manifestRecord,
      predictionRecord,
      oracleRecord,
    );
    lastTrustworthy = {
      ...lastTrustworthy,
      manifest: manifestRecord.identity,
      predictions: predictionRecord.identity,
      oracleEvaluation: oracleRecord.identity,
      playback,
    };
    failurePhase = 'frame-render';
    await Promise.all(roleDirs.map(path => mkdir(path, { recursive: true })));
    const requestedRoute = new URL(manifestRecord.document.requestedRoute);
    const gridSize = Number(requestedRoute.searchParams.get('volume_resolution') || 160);
    const gridStep = 2 / gridSize;
    const renderOptions = {
      width: Number(options.width || 256),
      height: Number(options.height || 256),
      radiusMultiplier: Number(options.radiusMultiplier || 1),
      kernelSharpness: Number(options.kernelSharpness || 3.4),
    };
    if (
      !Number.isInteger(renderOptions.width)
      || !Number.isInteger(renderOptions.height)
      || renderOptions.width < 16
      || renderOptions.height < 16
    ) throw new Error('alternating witness render dimensions are invalid');
    const frameEvidence = Object.fromEntries(roleNames.map(role => [role, []]));
    for (const row of rolePlan) {
      const indexLabel = String(row.displayFrameIndex).padStart(4, '0');
      const natural = await loadSplatState(row.natural.state, `natural ${indexLabel}`, EXACT_SPLAT_AUTHORITY);
      let states;
      if (row.displayFrameIndex % 2 === 0) {
        states = Object.fromEntries(roleNames.map(role => [role, natural.rows]));
      } else {
        const [hold, causal, oracle, next] = await Promise.all([
          loadSplatState(row.hold.state, `hold ${indexLabel}`, EXACT_SPLAT_AUTHORITY),
          loadSplatState(row.causal.state, `causal ${indexLabel}`, CAUSAL_AUTHORITY),
          loadSplatState(row.oracle.state, `oracle ${indexLabel}`, ORACLE_SPLAT_AUTHORITY),
          loadSplatState(row.interpolated.right, `interpolation right ${indexLabel}`, EXACT_SPLAT_AUTHORITY),
        ]);
        const interpolation = interpolateStates(hold, next, gridStep);
        states = {
          natural: natural.rows,
          hold: hold.rows,
          causal: causal.rows,
          oracle: oracle.rows,
          interpolated: interpolation.rows,
        };
      }
      for (let roleIndex = 0; roleIndex < roleNames.length; roleIndex += 1) {
        const role = roleNames[roleIndex];
        const rendered = renderRows(
          states[role],
          row.exactState.camera,
          renderOptions,
          `${role} ${indexLabel}`,
        );
        const png = addBitmapLabel(rendered, ROLE_LABELS[role]);
        const path = resolve(roleDirs[roleIndex], `frame-${indexLabel}.png`);
        await writeFile(path, png);
        frameEvidence[role].push({
          displayFrameIndex: row.displayFrameIndex,
          path,
          sha256: sha256(png),
          inputSplatCount: rendered.inputSplatCount,
          projectedSplatCount: rendered.projectedSplatCount,
          nonBackgroundPixelCount: rendered.nonBackgroundPixelCount,
          maxLuminance: rendered.maxLuminance,
        });
      }
    }
    failurePhase = 'video-encode';
    const ffmpeg = String(options.ffmpeg || '/opt/homebrew/bin/ffmpeg');
    const ffprobe = String(options.ffprobe || '/opt/homebrew/bin/ffprobe');
    const probe = await encodeFiveRoleVideo(roleDirs, outputPath, playback, ffmpeg, ffprobe);
    const videoBytes = await readFile(outputPath);
    const report = {
      schema: SCHEMA,
      status: 'completed',
      startedAt,
      completedAt: Date.now() / 1000,
      inputs: {
        manifest: manifestRecord.identity,
        predictions: predictionRecord.identity,
        oracleEvaluation: oracleRecord.identity,
        trainingManifest: predictionRecord.document.modelTrainingManifest,
        transportModel: predictionRecord.document.model,
        destinationStateModel: predictionRecord.document.destinationStateModel,
      },
      route: {
        requested: manifestRecord.document.requestedRoute,
        effective: manifestRecord.document.effectiveRoute,
        rendererIdentity: manifestRecord.document.frames[0].rendererIdentity,
        prediction: predictionRecord.document.route,
        oracle: oracleRecord.document.route,
        witnessRenderer: 'isolated-captured-splat-cpu-raster-v0',
        fallbackReason: null,
      },
      playback: { ...playback, probe },
      roles: {
        natural: {
          authority: NATURAL_AUTHORITY,
          source: 'exact-inference-manifest',
          simulatorAdvancedEveryDisplayFrame: true,
          analyticalRaymarchClaim: false,
        },
        hold: { authority: HOLD_AUTHORITY, byteRepeatsPriorExactAnchorOnOddFrames: true },
        causal: { authority: CAUSAL_AUTHORITY, targetFramesAvailableToPredictor: false },
        oracle: { authority: ORACLE_AUTHORITY, noncausal: true, productionCandidate: false },
        interpolated: { authority: INTERPOLATED_AUTHORITY, noncausal: true, futureAnchorUsed: true },
      },
      video: { path: outputPath, bytes: videoBytes.byteLength, sha256: sha256(videoBytes) },
      guide: { path: guidePath },
      frameEvidence,
      caps: { requestedFrameCount: playback.frameCount, effectiveFrameCount: playback.frameCount, frameCap: null },
      claimBoundary: 'exact captured simulator splat state versus sample hold, causal odd projection, oracle exact-support upper bound, and future-looking interpolation through one isolated raster; no analytical-raymarch, recurrence, live renderer, or runtime integration claim',
    };
    failurePhase = 'guide-write';
    await writeFile(guidePath, guideHtml(report));
    failurePhase = 'report-write';
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } catch (error) {
    await Promise.all([
      rm(outputPath, { force: true }),
      rm(guidePath, { force: true }),
      ...roleDirs.map(path => rm(path, { recursive: true, force: true })),
    ]);
    const failure = {
      schema: SCHEMA,
      status: 'failed',
      startedAt,
      completedAt: Date.now() / 1000,
      failurePhase,
      error: String(error?.stack || error),
      lastTrustworthy,
      primaryOutput: outputPath,
      primaryOutputExists: false,
      partialFrameDirectoriesRemoved: true,
    };
    await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = args.get('--manifest');
  const predictions = args.get('--predictions');
  const oracle = args.get('--oracle-evaluation');
  const outDir = args.get('--out-dir');
  if (!manifest || !predictions || !oracle || !outDir) {
    throw new Error('usage: boundary-splat-alternating-anchor-witness.mjs --manifest <corpus> --predictions <predictions> --oracle-evaluation <evaluation> --out-dir <dir>');
  }
  const report = await writeAlternatingAnchorWitness(manifest, predictions, oracle, {
    outDir,
    width: Number(args.get('--width') || 256),
    height: Number(args.get('--height') || 256),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

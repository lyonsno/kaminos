#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { renderBoundarySplatRowsPng } from './boundary-splat-phase-render-witness.mjs';
import { addBitmapLabel } from './boundary-splat-moving-phase-witness.mjs';
import {
  evaluateMotionCohorts,
  partitionMotionCohorts,
} from './boundary-splat-phase-transport.mjs';

const SCHEMA = 'kaminos-boundary-splat-motion-cohort-audit-v0';
const CORPUS_SCHEMA = 'kaminos-boundary-splat-phase-candidate-corpus-v0';
const PREDICTION_SCHEMA = 'kaminos-boundary-splat-phase-transport-predictions-v0';
const MODEL_SCHEMA = 'kaminos-boundary-splat-phase-transport-model-v0';
const REFERENCE_SPLAT_AUTHORITY = 'intercepted-live-boundary-splat-buffer-post-compaction-v0';
const PREDICTION_SPLAT_AUTHORITY = 'learned-local-grid-transport-plus-residual-churn-v0';
const WITNESS_SCHEMA = 'kaminos-boundary-splat-motion-cohort-witness-v0';

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

async function loadFloatArtifact(artifact, stride, label, authority = null) {
  if (artifact?.strideFloats !== stride || artifact?.dtype !== 'float32-le') {
    throw new Error(`${label} must be float32-le stride-${stride}`);
  }
  if (!Number.isInteger(artifact.count) || artifact.count <= 0) throw new Error(`${label} count must be positive`);
  if (authority && artifact.authority !== authority) throw new Error(`${label} authority mismatch`);
  const path = resolve(String(artifact.path));
  const bytes = await readFile(path);
  if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new Error(`${label} byte/hash mismatch`);
  const source = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (source.length !== artifact.count * stride) throw new Error(`${label} count mismatch`);
  return new Float32Array(source);
}

function row(values, index, stride) {
  return Array.from(values.subarray(index * stride, (index + 1) * stride));
}

function positionKey(position) {
  return position.map(value => Number(value).toFixed(6)).join(',');
}

async function loadState(frame, label, splatAuthority) {
  const [candidates, splats] = await Promise.all([
    loadFloatArtifact(frame.candidates, 16, `${label} candidates`),
    loadFloatArtifact(frame.splats, 12, `${label} splats`, splatAuthority),
  ]);
  if (frame.candidates.count !== frame.splats.count) throw new Error(`${label} candidate/splat count mismatch`);
  const sites = Array.from({ length: frame.splats.count }, (_, index) => ({
    position: row(splats, index, 12).slice(0, 3),
    candidate: row(candidates, index, 16),
    splat: row(splats, index, 12),
  }));
  return { frame, sites };
}

export function buildMotionEmphasisRows(sites, partition, options = {}) {
  if (partition?.authority !== 'exact-adjacent-state-change-and-bounded-transport-cohorts-v0') {
    throw new Error('motion cohort partition authority mismatch');
  }
  const staticAttenuation = Number(options.staticAttenuation ?? 0.1);
  const unmatchedAttenuation = Number(options.unmatchedAttenuation ?? 0.05);
  if (
    !Number.isFinite(staticAttenuation) || staticAttenuation < 0 || staticAttenuation > 1
    || !Number.isFinite(unmatchedAttenuation) || unmatchedAttenuation < 0 || unmatchedAttenuation > 1
  ) throw new Error('motion emphasis attenuation must be finite inside [0, 1]');
  const cohortByKey = new Map(partition.targetKeys.map((key, index) => [key, partition.targetIndexToCohort[index]]));
  const firstMotionBin = Math.floor(partition.stableChangeBinCount / 2) + 1;
  const staticIds = new Set(Array.from({ length: firstMotionBin - 1 }, (_, index) => `stable-q${index + 1}`));
  return sites.map(site => {
    const result = Array.from(site.splat);
    const cohort = cohortByKey.get(positionKey(site.position));
    const gain = cohort === undefined ? unmatchedAttenuation : (staticIds.has(cohort) ? staticAttenuation : 1);
    result[7] *= gain;
    return result;
  });
}

function mixColor(rowValue, color, gain) {
  const result = Array.from(rowValue);
  for (let channel = 0; channel < 3; channel += 1) {
    result[4 + channel] = result[4 + channel] * (1 - gain) + color[channel] * gain;
  }
  return result;
}

export function buildMotionDebugRows(sites, partition, options = {}) {
  const gain = Number(options.gain ?? 0.625);
  if (gain !== 0.625) throw new Error('motion cohort debug gain must be exactly 0.625');
  const emphasized = buildMotionEmphasisRows(sites, partition, options);
  const cohortByKey = new Map(partition.targetKeys.map((key, index) => [key, partition.targetIndexToCohort[index]]));
  const colors = {
    'stable-q1': [0.15, 0.9, 0.25],
    'stable-q2': [0.15, 0.9, 0.25],
    'stable-q3': [0.95, 0.8, 0.1],
    'stable-q4': [1, 0.25, 0.05],
    transported: [0.1, 0.65, 1],
    birth: [1, 0.1, 0.8],
    unmatched: [1, 0.2, 0.05],
  };
  return sites.map((site, index) => {
    const cohort = cohortByKey.get(positionKey(site.position)) ?? 'unmatched';
    return mixColor(emphasized[index], colors[cohort], gain);
  });
}

export function validateMotionCohortWitness(witness) {
  if (witness?.schema !== WITNESS_SCHEMA || witness.status !== 'completed') {
    throw new Error('motion cohort witness schema/status mismatch');
  }
  if (!isSha256(witness.source?.audit?.sha256)) throw new Error('motion cohort witness audit identity is missing');
  const playback = witness.playback;
  if (
    !Number.isInteger(playback?.frameCount) || playback.frameCount <= 0
    || !Number.isFinite(playback.effectiveFps) || playback.effectiveFps <= 0
    || !Number.isFinite(playback.encodedDurationSeconds) || playback.encodedDurationSeconds <= 0
    || playback.loops !== false
  ) throw new Error('motion cohort witness playback contract mismatch');
  const emphasis = witness.emphasis;
  if (
    emphasis?.authority !== 'exact-motion-cohort-static-attenuation-v0'
    || JSON.stringify(emphasis.staticCohorts) !== JSON.stringify(['stable-q1', 'stable-q2'])
    || JSON.stringify(emphasis.motionCohorts) !== JSON.stringify(['stable-q3', 'stable-q4', 'transported', 'birth'])
    || emphasis.staticAttenuation !== 0.1
    || emphasis.unmatchedAttenuation !== 0.05
  ) throw new Error('motion cohort witness emphasis contract mismatch');
  const expectedRoles = {
    reference: 'exact-heldout-target-motion-cohorts-v0',
    control: 'copied-current-projected-onto-exact-motion-cohorts-v0',
    predicted: 'learned-recurrent-state-projected-onto-exact-motion-cohorts-v0',
  };
  if (JSON.stringify(witness.roles) !== JSON.stringify(expectedRoles)) throw new Error('motion cohort witness role contract mismatch');
  const artifact = witness.artifact;
  if (!isSha256(artifact?.sha256) || !Number.isInteger(artifact.bytes) || artifact.bytes <= 0) {
    throw new Error('motion cohort witness artifact identity mismatch');
  }
  const probe = artifact.probe;
  if (
    probe?.frameCount !== playback.frameCount || probe.frameCount <= 0
    || !Number.isFinite(probe.width) || probe.width <= 0
    || !Number.isFinite(probe.height) || probe.height <= 0
    || probe.fps !== playback.effectiveFps
    || !Number.isFinite(probe.duration) || probe.duration <= 0
  ) throw new Error('motion cohort witness encoded frame count/cadence mismatch');
  const debug = witness.partialFlowDebug;
  if (
    debug?.authority !== 'display-only-motion-cohort-debug-mix-v0'
    || debug.requestedGain !== 0.625
    || debug.effectiveGain !== 0.625
    || debug.stateMutation !== false
  ) throw new Error('motion cohort witness flow debug contract mismatch');
  const debugArtifact = debug.artifact;
  const debugProbe = debugArtifact?.probe;
  if (
    !isSha256(debugArtifact?.sha256) || !Number.isInteger(debugArtifact.bytes) || debugArtifact.bytes <= 0
    || debugProbe?.frameCount !== playback.frameCount || debugProbe.frameCount <= 0
    || debugProbe.width !== probe.width || debugProbe.height !== probe.height
    || debugProbe.fps !== playback.effectiveFps
    || !Number.isFinite(debugProbe.duration) || debugProbe.duration <= 0
  ) throw new Error('motion cohort witness flow debug artifact mismatch');
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${label} failed ${result.status}: ${String(result.stderr || result.stdout).slice(-3000)}`);
  return result;
}

function probeVideo(path, ffprobe) {
  const result = run(ffprobe, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration',
    '-of', 'json', path,
  ], 'ffprobe');
  const document = JSON.parse(result.stdout);
  const stream = document.streams?.[0];
  if (!stream || !Number(stream.width) || !Number(stream.height)) throw new Error('encoded motion cohort witness has no video stream');
  const [numerator, denominator] = String(stream.r_frame_rate).split('/').map(Number);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: numerator / denominator,
    frameCount: Number(stream.nb_read_frames),
    duration: Number(document.format?.duration),
  };
}

async function encodeComparison(roleDirs, outputPath, fps, frameCount, ffmpeg, ffprobe) {
  await mkdir(dirname(outputPath), { recursive: true });
  const args = ['-y'];
  for (const directory of roleDirs) args.push('-framerate', String(fps), '-i', resolve(directory, 'frame-%03d.png'));
  args.push(
    '-filter_complex', '[0:v][1:v][2:v]hstack=inputs=3[out]',
    '-map', '[out]', '-frames:v', String(frameCount),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outputPath,
  );
  run(ffmpeg, args, 'motion cohort comparison encode');
  const bytes = await readFile(outputPath);
  const probe = probeVideo(outputPath, ffprobe);
  if (probe.frameCount !== frameCount || Math.abs(probe.fps - fps) > 1e-9) {
    throw new Error('motion cohort comparison frame count/cadence mismatch');
  }
  return { path: outputPath, bytes: bytes.byteLength, sha256: sha256(bytes), probe, command: [ffmpeg, ...args] };
}

async function renderLabeledFrame(rows, camera, options, label, path) {
  const rendered = renderBoundarySplatRowsPng(rows, camera, options);
  if (rendered.nonBackgroundPixelCount <= 0 || rendered.projectedSplatCount <= 0) {
    throw new Error(`${label} motion cohort frame is blank`);
  }
  const png = addBitmapLabel(rendered, label);
  await writeFile(path, png);
  return {
    sha256: sha256(png),
    inputSplatCount: rendered.inputSplatCount,
    projectedSplatCount: rendered.projectedSplatCount,
    nonBackgroundPixelCount: rendered.nonBackgroundPixelCount,
    maxLuminance: rendered.maxLuminance,
  };
}

function motionWitnessGuide(witness, audit) {
  const rows = Object.entries(audit.aggregate.cohorts).map(([id, cohort]) => `<tr><th>${id}</th><td>${cohort.predictionSupportRecall.toFixed(3)}</td><td>${cohort.controlSupportRecall.toFixed(3)}</td><td>${cohort.predictionEnergyRetention.toFixed(3)}</td><td>${cohort.controlEnergyRetention.toFixed(3)}</td><td>${cohort.predictionBeatStepFraction.toFixed(3)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motion-Cohort Phase Audit</title>
<style>body{margin:0;background:#111;color:#eee;font:15px/1.45 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:24px}h1,h2{letter-spacing:0}video{display:block;width:100%;background:#000;border:1px solid #444}section{margin:28px 0}code{color:#9ee7ff}table{border-collapse:collapse;width:100%}th,td{padding:7px;border-bottom:1px solid #444;text-align:right}th:first-child{text-align:left}.legend{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.legend span{padding:7px;border-left:5px solid #777}</style></head>
<body><main><h1>Which Fire Support Did The Model Learn?</h1>
<p>This is a finite ${witness.playback.simulatorDurationSeconds.toFixed(2)}-second held-out episode. Left is exact <strong>REFERENCE</strong>, center is copied-current <strong>CONTROL</strong>, and right is recurrent <strong>PREDICTED</strong>. Playback does not loop.</p>
<section><h2>Motion-Bearing Beauty</h2><p>Stable Q1/Q2 are attenuated to 0.1 opacity. High-change same-cell Q3/Q4, transported support, and births remain at full opacity. Unmatched and dying support remains faint at 0.05. This isolates temporal state propagation without claiming an analytical-raymarch comparison.</p><video controls muted playsinline src="motion-cohort-comparison.mp4"></video></section>
<section><h2>Partial Cohort Debug, Gain 0.625</h2><p>The same role states and opacity emphasis receive an additive display-only cohort mix. Green: Q1/Q2. Yellow: Q3. Red: Q4. Blue: transported. Magenta: birth. Orange: unmatched/death.</p><div class="legend"><span style="border-color:#26e63f">Q1/Q2</span><span style="border-color:#f2cc1a">Q3</span><span style="border-color:#ff4210">Q4/death</span><span style="border-color:#19a6ff">transport</span><span style="border-color:#ff1acc">birth</span></div><video controls muted playsinline src="motion-cohort-debug-comparison.mp4"></video></section>
<section><h2>Full-Episode Cohort Audit</h2><table><thead><tr><th>cohort</th><th>prediction support</th><th>control support</th><th>prediction energy</th><th>control energy</th><th>prediction beat-step fraction</th></tr></thead><tbody>${rows}</tbody></table></section>
<section><h2>Claim Boundary</h2><p>${witness.claimBoundary}</p></section></main></body></html>`;
}

function channelStandardDeviation(sites, selector, length) {
  const mean = Array(length).fill(0);
  const squared = Array(length).fill(0);
  for (const site of sites) {
    const values = selector(site);
    for (let channel = 0; channel < length; channel += 1) mean[channel] += values[channel];
  }
  for (let channel = 0; channel < length; channel += 1) mean[channel] /= sites.length;
  for (const site of sites) {
    const values = selector(site);
    for (let channel = 0; channel < length; channel += 1) {
      const delta = values[channel] - mean[channel];
      squared[channel] += delta * delta;
    }
  }
  return squared.map(value => Math.max(Math.sqrt(value / Math.max(1, sites.length)), 1e-6));
}

function visualEnergy(site) {
  const [red, green, blue] = site.splat.slice(4, 7);
  return Math.max(0, site.splat[7]) * Math.max(0, red * 0.2126 + green * 0.7152 + blue * 0.0722);
}

function cohortEnergy(cohort, targetSites, candidateSites) {
  const candidateByKey = new Map(candidateSites.map(site => [site.position.map(value => value.toFixed(6)).join(','), site]));
  let exact = 0;
  let candidate = 0;
  for (const targetIndex of cohort.targetIndices) {
    const target = targetSites[targetIndex];
    exact += visualEnergy(target);
    const key = target.position.map(value => value.toFixed(6)).join(',');
    const matched = candidateByKey.get(key);
    if (matched) candidate += visualEnergy(matched);
  }
  return { exact, candidate, retention: exact > 0 ? candidate / exact : null };
}

function validateIdentity(identity, label, requireSchema = false) {
  if (!identity || typeof identity.path !== 'string' || !identity.path || !isSha256(identity.sha256)) {
    throw new Error(`${label} identity is missing or malformed`);
  }
  if (requireSchema && identity.schema !== MODEL_SCHEMA) throw new Error(`${label} schema mismatch`);
}

function validateModel(model, predictions) {
  if (model?.schema !== MODEL_SCHEMA || model.status !== 'completed') throw new Error('model schema/status mismatch');
  if (model.route?.backend !== 'mlx' || !/^Device\(gpu,\s*\d+\)$/i.test(String(model.route?.device)) || model.route.fallbackReason !== null) {
    throw new Error('model route must be completed MLX GPU with null fallback');
  }
  if (
    model.manifest?.path !== predictions.modelTrainingManifest?.path
    || model.manifest?.bytes !== predictions.modelTrainingManifest?.bytes
    || model.manifest?.sha256 !== predictions.modelTrainingManifest?.sha256
  ) throw new Error('model training manifest identity mismatch');
}

function initializeAggregate(cohortIds) {
  return Object.fromEntries(cohortIds.map(id => [id, {
    targetCount: 0,
    predictionSupportCount: 0,
    controlSupportCount: 0,
    predictionStateSquared: 0,
    predictionStateCount: 0,
    controlStateSquared: 0,
    controlStateCount: 0,
    predictionEnergy: 0,
    controlEnergy: 0,
    exactEnergy: 0,
    predictionBeatSteps: 0,
    populatedSteps: 0,
  }]));
}

function addStepToAggregate(aggregate, partition, evaluation, targetSites, predictionSites, controlSites) {
  for (const cohort of partition.targetCohorts) {
    const metrics = evaluation.cohorts[cohort.id];
    const row = aggregate[cohort.id];
    const predictionEnergy = cohortEnergy(cohort, targetSites, predictionSites);
    const controlEnergy = cohortEnergy(cohort, targetSites, controlSites);
    row.targetCount += cohort.count;
    row.predictionSupportCount += metrics.prediction.supportCount;
    row.controlSupportCount += metrics.control.supportCount;
    if (metrics.prediction.meanStateMse !== null) {
      row.predictionStateSquared += metrics.prediction.meanStateMse * metrics.prediction.supportCount;
      row.predictionStateCount += metrics.prediction.supportCount;
    }
    if (metrics.control.meanStateMse !== null) {
      row.controlStateSquared += metrics.control.meanStateMse * metrics.control.supportCount;
      row.controlStateCount += metrics.control.supportCount;
    }
    row.predictionEnergy += predictionEnergy.candidate;
    row.controlEnergy += controlEnergy.candidate;
    row.exactEnergy += predictionEnergy.exact;
    row.predictionBeatSteps += metrics.predictionBeatsControl ? 1 : 0;
    row.populatedSteps += cohort.count > 0 ? 1 : 0;
  }
}

function finalizeAggregate(aggregate) {
  return Object.fromEntries(Object.entries(aggregate).map(([id, row]) => [id, {
    ...row,
    predictionSupportRecall: row.predictionSupportCount / Math.max(1, row.targetCount),
    controlSupportRecall: row.controlSupportCount / Math.max(1, row.targetCount),
    predictionMeanStateMse: row.predictionStateCount ? row.predictionStateSquared / row.predictionStateCount : null,
    controlMeanStateMse: row.controlStateCount ? row.controlStateSquared / row.controlStateCount : null,
    predictionToControlStateMseRatio: row.predictionStateCount && row.controlStateCount && row.controlStateSquared > 0
      ? (row.predictionStateSquared / row.predictionStateCount) / (row.controlStateSquared / row.controlStateCount)
      : null,
    predictionEnergyRetention: row.exactEnergy > 0 ? row.predictionEnergy / row.exactEnergy : null,
    controlEnergyRetention: row.exactEnergy > 0 ? row.controlEnergy / row.exactEnergy : null,
    predictionBeatStepFraction: row.predictionBeatSteps / Math.max(1, row.populatedSteps),
  }]));
}

export async function writeMotionCohortAudit(manifestPathValue, predictionsPathValue, options = {}) {
  const manifestPath = resolve(manifestPathValue);
  const predictionsPath = resolve(predictionsPathValue);
  const outDir = resolve(options.outDir ?? '/tmp/kaminos-motion-cohort-audit');
  const reportPath = resolve(options.report ?? outDir, options.report ? '' : 'motion-cohort-audit.json');
  const gridStep = Number(options.gridStep ?? (2 / 160));
  let failurePhase = 'argument-validation';
  let lastTrustworthyEvidence = { manifestPath, predictionsPath, outDir };
  await mkdir(outDir, { recursive: true });
  try {
    if (!Number.isFinite(gridStep) || gridStep <= 0) throw new Error('grid step must be finite and positive');
    failurePhase = 'manifest-validation';
    const [manifestBytes, predictionsBytes] = await Promise.all([readFile(manifestPath), readFile(predictionsPath)]);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const predictions = JSON.parse(predictionsBytes.toString('utf8'));
    if (manifest.schema !== CORPUS_SCHEMA || manifest.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') {
      throw new Error('phase corpus schema/route mismatch');
    }
    if (predictions.schema !== PREDICTION_SCHEMA || predictions.status !== 'completed') {
      throw new Error('transport predictions schema/status mismatch');
    }
    validateIdentity(predictions.manifest, 'prediction corpus');
    if (predictions.manifest.bytes !== manifestBytes.byteLength || predictions.manifest.sha256 !== sha256(manifestBytes)) {
      throw new Error('prediction corpus identity mismatch');
    }
    validateIdentity(predictions.model, 'prediction model', true);
    const modelBytes = await readFile(resolve(predictions.model.path));
    if (sha256(modelBytes) !== predictions.model.sha256) throw new Error('prediction model hash mismatch');
    const model = JSON.parse(modelBytes.toString('utf8'));
    validateModel(model, predictions);
    if (predictions.route?.backend !== 'mlx' || !/^Device\(gpu,\s*\d+\)$/i.test(String(predictions.route?.device)) || predictions.route.fallbackReason !== null) {
      throw new Error('prediction route must be completed MLX GPU with null fallback');
    }
    if (predictions.temporal?.inferenceCorpusSeenDuringTraining !== false) throw new Error('heldout corpus separation is not proven');
    const referenceIds = predictions.temporal?.heldoutReferenceFrameIds;
    if (!Array.isArray(referenceIds) || referenceIds.length < 3 || predictions.frames?.length !== referenceIds.length) {
      throw new Error('heldout forward episode is incomplete');
    }
    const corpusFrames = new Map(manifest.frames.map(frame => [frame.id, frame]));
    const referenceDocs = referenceIds.map(id => corpusFrames.get(id));
    if (referenceDocs.some(frame => !frame)) throw new Error('heldout reference frame is absent from corpus');
    if (predictions.frames.some((frame, index) => frame.referenceFrameId !== referenceIds[index])) {
      throw new Error('prediction/reference order mismatch');
    }
    const corpusCadences = [...new Set(referenceDocs.map(frame => Number(frame.controlledStepDeltaMs)))];
    if (corpusCadences.length !== 1 || corpusCadences[0] <= 0 || predictions.temporal.controlledStepDeltaMs !== corpusCadences[0]) {
      throw new Error('prediction temporal cadence does not match corpus');
    }
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      manifestSha256: sha256(manifestBytes),
      predictionsSha256: sha256(predictionsBytes),
      modelSha256: predictions.model.sha256,
      effectiveRoute: manifest.effectiveRoute,
      effectiveBackend: predictions.route,
      referenceIds,
    };
    failurePhase = 'artifact-validation';
    const control = await loadState(referenceDocs[0], 'control frame 0', REFERENCE_SPLAT_AUTHORITY);
    const candidateScale = channelStandardDeviation(control.sites, site => site.candidate, 16);
    const splatScale = channelStandardDeviation(control.sites, site => site.splat.slice(3, 12), 9);
    const cohortIds = ['stable-q1', 'stable-q2', 'stable-q3', 'stable-q4', 'transported', 'birth'];
    const aggregate = initializeAggregate(cohortIds);
    const steps = [];
    let source = control;
    failurePhase = 'cohort-analysis';
    for (let step = 1; step < referenceDocs.length; step += 1) {
      const [target, prediction] = await Promise.all([
        loadState(referenceDocs[step], `reference step ${step}`, REFERENCE_SPLAT_AUTHORITY),
        loadState(predictions.frames[step], `prediction step ${step}`, PREDICTION_SPLAT_AUTHORITY),
      ]);
      const partition = partitionMotionCohorts(source.sites, target.sites, {
        gridStep,
        stableChangeBinCount: 4,
        candidateScale,
        splatScale,
      });
      const evaluation = evaluateMotionCohorts(partition, source.sites, target.sites, prediction.sites, control.sites);
      addStepToAggregate(aggregate, partition, evaluation, target.sites, prediction.sites, control.sites);
      steps.push({
        step,
        simulatorTimeSeconds: step * corpusCadences[0] / 1000,
        cohorts: Object.fromEntries(partition.targetCohorts.map(cohort => [cohort.id, {
          count: cohort.count,
          minimumChangeScore: cohort.minimumChangeScore,
          maximumChangeScore: cohort.maximumChangeScore,
          ...evaluation.cohorts[cohort.id],
          energy: {
            prediction: cohortEnergy(cohort, target.sites, prediction.sites),
            control: cohortEnergy(cohort, target.sites, control.sites),
          },
        }])),
        deathCount: partition.death.count,
        claimGate: evaluation.claimGate,
      });
      source = target;
    }
    const cohortAggregates = finalizeAggregate(aggregate);
    const motionCohortIds = ['stable-q3', 'stable-q4', 'transported', 'birth'];
    const allMotionCohortsBeatControl = motionCohortIds
      .filter(id => cohortAggregates[id].targetCount > 0)
      .every(id => cohortAggregates[id].predictionBeatStepFraction === 1);
    failurePhase = 'report-write';
    const report = {
      schema: SCHEMA,
      status: 'completed',
      source: {
        manifest: { path: manifestPath, bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
        predictions: { path: predictionsPath, bytes: predictionsBytes.byteLength, sha256: sha256(predictionsBytes) },
        model: predictions.model,
        modelTrainingManifest: predictions.modelTrainingManifest,
        requestedRoute: manifest.requestedRoute,
        effectiveRoute: manifest.effectiveRoute,
        backend: predictions.route,
      },
      temporal: {
        authority: predictions.temporal.authority,
        frameCount: referenceDocs.length,
        analyzedTransitionCount: steps.length,
        controlledStepDeltaMs: corpusCadences[0],
        simulatorDurationSeconds: (referenceDocs.length - 1) * corpusCadences[0] / 1000,
      },
      normalization: {
        authority: 'exact-source-frame-spatial-channel-standard-deviation-v0',
        sourceFrameId: referenceIds[0],
        candidateScale,
        splatScale,
      },
      cohortSemantics: {
        stableQuartiles: 'same-position exact carriers ranked within each adjacent transition by normalized candidate plus non-position splat state change',
        transported: 'exact one-cell displaced carrier under stable-site-first bounded correspondence',
        birth: 'exact target support without an assigned source carrier',
        death: 'exact source support without an assigned target carrier',
        motionBearing: motionCohortIds,
      },
      steps,
      aggregate: {
        cohorts: cohortAggregates,
        claimGate: {
          authority: 'motion-bearing-cohorts-cannot-be-closed-by-aggregate-support-v0',
          allMotionCohortsBeatControl,
          aggregateSupportCanCloseClaim: false,
          result: allMotionCohortsBeatControl ? 'motion-cohort-advantage-observed' : 'motion-cohort-advantage-not-established',
        },
      },
      claimBoundary: 'This audit localizes support and state fidelity by exact adjacent motion cohort under one held-out recurrent episode. It does not establish visual coherence, analytical-raymarch agreement, or a training remedy without the static-attenuated witness.',
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
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

export async function writeMotionCohortWitness(manifestPathValue, predictionsPathValue, auditPathValue, options = {}) {
  const manifestPath = resolve(manifestPathValue);
  const predictionsPath = resolve(predictionsPathValue);
  const auditPath = resolve(auditPathValue);
  const outDir = resolve(options.outDir ?? '/tmp/kaminos-motion-cohort-witness');
  const reportPath = resolve(options.report ?? outDir, options.report ? '' : 'motion-cohort-witness.json');
  const width = Math.max(32, Math.floor(Number(options.width ?? 320)));
  const height = Math.max(32, Math.floor(Number(options.height ?? 240)));
  const gridStep = Number(options.gridStep ?? (2 / 160));
  const staticAttenuation = Number(options.staticAttenuation ?? 0.1);
  const unmatchedAttenuation = Number(options.unmatchedAttenuation ?? 0.05);
  const debugGain = Number(options.partialFlowDebugGain ?? 0.625);
  const ffmpeg = String(options.ffmpeg ?? 'ffmpeg');
  const ffprobe = String(options.ffprobe ?? 'ffprobe');
  let failurePhase = 'argument-validation';
  let lastTrustworthyEvidence = { manifestPath, predictionsPath, auditPath, outDir };
  await mkdir(outDir, { recursive: true });
  try {
    if (!Number.isFinite(gridStep) || gridStep <= 0) throw new Error('grid step must be finite and positive');
    if (staticAttenuation !== 0.1 || unmatchedAttenuation !== 0.05) throw new Error('motion cohort witness attenuation contract mismatch');
    if (debugGain !== 0.625) throw new Error('motion cohort witness debug gain must be exactly 0.625');
    failurePhase = 'source-validation';
    const [manifestBytes, predictionsBytes, auditBytes] = await Promise.all([
      readFile(manifestPath), readFile(predictionsPath), readFile(auditPath),
    ]);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const predictions = JSON.parse(predictionsBytes.toString('utf8'));
    const audit = JSON.parse(auditBytes.toString('utf8'));
    if (audit.schema !== SCHEMA || audit.status !== 'completed') throw new Error('motion cohort audit schema/status mismatch');
    if (
      audit.source?.manifest?.sha256 !== sha256(manifestBytes)
      || audit.source?.predictions?.sha256 !== sha256(predictionsBytes)
    ) throw new Error('motion cohort audit source identity mismatch');
    if (manifest.schema !== CORPUS_SCHEMA || manifest.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') {
      throw new Error('phase corpus schema/route mismatch');
    }
    if (predictions.schema !== PREDICTION_SCHEMA || predictions.status !== 'completed') {
      throw new Error('transport predictions schema/status mismatch');
    }
    validateIdentity(predictions.model, 'prediction model', true);
    const modelBytes = await readFile(resolve(predictions.model.path));
    if (sha256(modelBytes) !== predictions.model.sha256) throw new Error('prediction model hash mismatch');
    validateModel(JSON.parse(modelBytes.toString('utf8')), predictions);
    if (predictions.route?.backend !== 'mlx' || !/^Device\(gpu,\s*\d+\)$/i.test(String(predictions.route?.device)) || predictions.route.fallbackReason !== null) {
      throw new Error('prediction route must be completed MLX GPU with null fallback');
    }
    const referenceIds = predictions.temporal?.heldoutReferenceFrameIds;
    const corpusFrames = new Map(manifest.frames.map(frame => [frame.id, frame]));
    const referenceDocs = referenceIds?.map(id => corpusFrames.get(id));
    if (!Array.isArray(referenceDocs) || referenceDocs.length < 3 || referenceDocs.some(frame => !frame)) {
      throw new Error('heldout reference episode is incomplete');
    }
    if (predictions.frames?.length !== referenceDocs.length || predictions.frames.some((frame, index) => frame.referenceFrameId !== referenceIds[index])) {
      throw new Error('prediction/reference order mismatch');
    }
    const cadenceMs = Number(predictions.temporal?.controlledStepDeltaMs);
    if (!Number.isFinite(cadenceMs) || cadenceMs <= 0 || referenceDocs.some(frame => frame.controlledStepDeltaMs !== cadenceMs)) {
      throw new Error('prediction temporal cadence does not match corpus');
    }
    const frameCount = referenceDocs.length - 1;
    const fps = 1000 / cadenceMs;
    if (audit.temporal?.analyzedTransitionCount !== frameCount || audit.steps?.length !== frameCount) {
      throw new Error('motion cohort audit transition count mismatch');
    }
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      manifestSha256: sha256(manifestBytes),
      predictionsSha256: sha256(predictionsBytes),
      auditSha256: sha256(auditBytes),
      modelSha256: predictions.model.sha256,
      effectiveRoute: manifest.effectiveRoute,
      effectiveBackend: predictions.route,
      frameCount,
      fps,
    };
    failurePhase = 'artifact-validation';
    const control = await loadState(referenceDocs[0], 'control frame 0', REFERENCE_SPLAT_AUTHORITY);
    const candidateScale = audit.normalization?.candidateScale;
    const splatScale = audit.normalization?.splatScale;
    const roleNames = ['reference', 'control', 'predicted'];
    const labels = ['REFERENCE', 'CONTROL', 'PREDICTED'];
    const beautyEvidence = Object.fromEntries(roleNames.map(role => [role, []]));
    const debugEvidence = Object.fromEntries(roleNames.map(role => [role, []]));
    for (const surface of ['beauty', 'debug']) {
      for (const role of roleNames) await mkdir(resolve(outDir, surface, role), { recursive: true });
    }
    const renderOptions = { width, height, radiusMultiplier: 1, kernelSharpness: 6.5 };
    const camera = referenceDocs[0].camera;
    let source = control;
    failurePhase = 'cohort-raster';
    for (let step = 1; step < referenceDocs.length; step += 1) {
      const [target, prediction] = await Promise.all([
        loadState(referenceDocs[step], `reference step ${step}`, REFERENCE_SPLAT_AUTHORITY),
        loadState(predictions.frames[step], `prediction step ${step}`, PREDICTION_SPLAT_AUTHORITY),
      ]);
      const partition = partitionMotionCohorts(source.sites, target.sites, {
        gridStep,
        stableChangeBinCount: 4,
        candidateScale,
        splatScale,
      });
      const expectedStep = audit.steps[step - 1];
      for (const cohort of partition.targetCohorts) {
        if (expectedStep.cohorts?.[cohort.id]?.count !== cohort.count) {
          throw new Error(`motion cohort replay count mismatch at step ${step} ${cohort.id}`);
        }
      }
      const states = [target.sites, control.sites, prediction.sites];
      const frameIndex = step - 1;
      for (let roleIndex = 0; roleIndex < roleNames.length; roleIndex += 1) {
        const role = roleNames[roleIndex];
        const beautyRows = buildMotionEmphasisRows(states[roleIndex], partition, { staticAttenuation, unmatchedAttenuation });
        const debugRows = buildMotionDebugRows(states[roleIndex], partition, {
          staticAttenuation, unmatchedAttenuation, gain: debugGain,
        });
        beautyEvidence[role].push(await renderLabeledFrame(
          beautyRows, camera, renderOptions, labels[roleIndex], resolve(outDir, 'beauty', role, `frame-${String(frameIndex).padStart(3, '0')}.png`),
        ));
        debugEvidence[role].push(await renderLabeledFrame(
          debugRows, camera, renderOptions, labels[roleIndex], resolve(outDir, 'debug', role, `frame-${String(frameIndex).padStart(3, '0')}.png`),
        ));
      }
      source = target;
    }
    failurePhase = 'video-encode';
    const beautyArtifact = await encodeComparison(
      roleNames.map(role => resolve(outDir, 'beauty', role)),
      resolve(outDir, 'motion-cohort-comparison.mp4'), fps, frameCount, ffmpeg, ffprobe,
    );
    const debugArtifact = await encodeComparison(
      roleNames.map(role => resolve(outDir, 'debug', role)),
      resolve(outDir, 'motion-cohort-debug-comparison.mp4'), fps, frameCount, ffmpeg, ffprobe,
    );
    failurePhase = 'report-write';
    const report = {
      schema: WITNESS_SCHEMA,
      status: 'completed',
      source: {
        audit: { path: auditPath, bytes: auditBytes.byteLength, sha256: sha256(auditBytes) },
        manifest: { path: manifestPath, bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
        predictions: { path: predictionsPath, bytes: predictionsBytes.byteLength, sha256: sha256(predictionsBytes) },
        model: predictions.model,
        modelTrainingManifest: predictions.modelTrainingManifest,
        requestedRoute: manifest.requestedRoute,
        effectiveRoute: manifest.effectiveRoute,
        backend: predictions.route,
      },
      playback: {
        authority: 'finite-discrete-exact-cadence-motion-cohort-sequence-v0',
        frameCount,
        controlledStepDeltaMs: cadenceMs,
        simulatorDurationSeconds: frameCount * cadenceMs / 1000,
        requestedFps: fps,
        effectiveFps: beautyArtifact.probe.fps,
        encodedDurationSeconds: beautyArtifact.probe.duration,
        loops: false,
        firstFrame: { step: 1, simulatorTimeSeconds: cadenceMs / 1000 },
        lastFrame: { step: frameCount, simulatorTimeSeconds: frameCount * cadenceMs / 1000 },
      },
      emphasis: {
        authority: 'exact-motion-cohort-static-attenuation-v0',
        staticCohorts: ['stable-q1', 'stable-q2'],
        motionCohorts: ['stable-q3', 'stable-q4', 'transported', 'birth'],
        staticAttenuation,
        unmatchedAttenuation,
        thresholdSelection: 'registered upper-half stable state-change quartiles plus exact transport and birth; no visual threshold tuning',
      },
      roles: {
        reference: 'exact-heldout-target-motion-cohorts-v0',
        control: 'copied-current-projected-onto-exact-motion-cohorts-v0',
        predicted: 'learned-recurrent-state-projected-onto-exact-motion-cohorts-v0',
      },
      roleEvidence: beautyEvidence,
      artifact: beautyArtifact,
      partialFlowDebug: {
        authority: 'display-only-motion-cohort-debug-mix-v0',
        requestedGain: debugGain,
        effectiveGain: debugGain,
        stateMutation: false,
        legend: {
          stableQ1Q2: 'green', stableQ3: 'yellow', stableQ4: 'red', transported: 'blue', birth: 'magenta', unmatchedDeath: 'orange',
        },
        roleEvidence: debugEvidence,
        artifact: debugArtifact,
      },
      claimBoundary: 'This witness reveals exact registered motion-bearing support under an isolated offline splat raster. It does not measure analytical-raymarch image error, prove a training remedy, or authorize runtime composition.',
    };
    validateMotionCohortWitness(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resolve(outDir, 'inspection-guide.html'), motionWitnessGuide(report, audit));
    return report;
  } catch (error) {
    const failure = {
      schema: WITNESS_SCHEMA,
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
  if (!args.get('--manifest') || !args.get('--predictions')) {
    console.error('Usage: node boundary-splat-motion-cohort-audit.mjs --manifest <phase-corpus.json> --predictions <transport-predictions.json> --out-dir <dir>');
    process.exitCode = 2;
  } else {
    try {
      if (args.get('--audit')) {
        const report = await writeMotionCohortWitness(
          args.get('--manifest'), args.get('--predictions'), args.get('--audit'), {
            outDir: args.get('--out-dir'), report: args.get('--report'), gridStep: args.get('--grid-step'),
            width: args.get('--width'), height: args.get('--height'),
            staticAttenuation: args.get('--static-attenuation'), unmatchedAttenuation: args.get('--unmatched-attenuation'),
            partialFlowDebugGain: args.get('--partial-flow-debug-gain'), ffmpeg: args.get('--ffmpeg'), ffprobe: args.get('--ffprobe'),
          },
        );
        console.log(JSON.stringify({ schema: report.schema, status: report.status, frames: report.playback.frameCount }, null, 2));
      } else {
        const report = await writeMotionCohortAudit(args.get('--manifest'), args.get('--predictions'), {
          outDir: args.get('--out-dir'), report: args.get('--report'), gridStep: args.get('--grid-step'),
        });
        console.log(JSON.stringify({
          schema: report.schema,
          status: report.status,
          transitions: report.temporal.analyzedTransitionCount,
          result: report.aggregate.claimGate.result,
        }, null, 2));
      }
    } catch (error) {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    }
  }
}

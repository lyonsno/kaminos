#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
const RECURRENT_ENVELOPE_AUTHORITY = 'legacy-vs-training-episode-envelope-recurrence-v0';
const PHYSICAL_ENERGY_ENVELOPE_AUTHORITY = 'legacy-vs-training-episode-envelope-physical-energy-v1';
const PHYSICAL_SPLAT_ATTRIBUTE_ORDER = Object.freeze([
  'splat.support',
  'splat.color.r', 'splat.color.g', 'splat.color.b',
  'splat.opacity', 'splat.shape.x', 'splat.shape.y',
  'splat.ridge', 'splat.fireSignal',
]);
const PHYSICAL_VISIBLE_ENERGY_LOSS_IDENTITY = Object.freeze({
  authority: 'candidate-splat-physical-visible-energy-weighted-loss-v1',
  candidateChannelCount: 16,
  splatChannelCount: 9,
  visibleEnergy: 'max(opacity,0)*max(rec709-luminance,0)',
  visibleEnergyChannels: Object.freeze({ color: Object.freeze([17, 18, 19]), opacity: 20 }),
  weights: Object.freeze({ candidate: 0.1, splat: 1.0, visibleEnergy: 0.25 }),
  splatAttributeOrder: PHYSICAL_SPLAT_ATTRIBUTE_ORDER,
});

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

function routeHasExactOption(route, option, expectedValue) {
  const tokens = String(route).trim().split(/\s+/).filter(Boolean);
  const values = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === option) values.push(tokens[index + 1]);
    else if (tokens[index].startsWith(`${option}=`)) values.push(tokens[index].slice(option.length + 1));
  }
  return values.length === 1 && values[0] === expectedValue;
}

function lossContractIdentity(loss) {
  return {
    authority: loss?.authority,
    candidateChannelCount: loss?.candidateChannelCount,
    splatChannelCount: loss?.splatChannelCount,
    visibleEnergy: loss?.visibleEnergy,
    visibleEnergyChannels: loss?.visibleEnergyChannels,
    weights: loss?.weights,
    splatAttributeOrder: PHYSICAL_SPLAT_ATTRIBUTE_ORDER,
  };
}

export function physicalDestinationStateModelIdentity(model, reportIdentity) {
  const losses = [model?.training?.distribution?.loss, model?.training?.loss];
  const output = model?.output;
  if (
    model?.schema !== 'kaminos-boundary-splat-phase-destination-state-model-v0'
    || model.status !== 'completed'
    || model.route?.backend !== 'mlx'
    || !/^Device\(gpu,\s*\d+\)$/i.test(String(model.route?.device))
    || model.route?.fallbackReason !== null
    || output?.authority !== 'candidate-16-plus-nonposition-splat-9-donor-residual-v0'
    || output.attributeCount !== 25
    || !Array.isArray(output.attributeOrder)
    || output.attributeOrder.length !== 25
    || JSON.stringify(output.attributeOrder.slice(16)) !== JSON.stringify(PHYSICAL_SPLAT_ATTRIBUTE_ORDER)
    || losses.some(loss => JSON.stringify(lossContractIdentity(loss)) !== JSON.stringify(PHYSICAL_VISIBLE_ENERGY_LOSS_IDENTITY))
  ) throw new Error('destination state model physical visible-energy loss identity mismatch');
  const trainingManifestSha256 = model.trainingManifest?.sha256;
  const evaluationManifestSha256 = model.evaluationManifest?.sha256;
  if (
    !isSha256(trainingManifestSha256)
    || !isSha256(evaluationManifestSha256)
    || !isSha256(reportIdentity?.trainingManifest?.sha256)
    || !isSha256(reportIdentity?.evaluationManifest?.sha256)
    || reportIdentity.trainingManifest.sha256 !== trainingManifestSha256
    || reportIdentity.evaluationManifest.sha256 !== evaluationManifestSha256
  ) throw new Error('destination state model corpus identity mismatch');
  return {
    loss: PHYSICAL_VISIBLE_ENERGY_LOSS_IDENTITY,
    corpora: { trainingManifestSha256, evaluationManifestSha256 },
  };
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
  const rawProductView = emphasis?.authority === 'raw-product-view-no-cohort-attenuation-v0';
  const diagnosticView = emphasis?.authority === 'exact-motion-cohort-static-attenuation-v0';
  const envelopeComparison = [RECURRENT_ENVELOPE_AUTHORITY, PHYSICAL_ENERGY_ENVELOPE_AUTHORITY]
    .includes(witness.configuration?.authority);
  const physicalEnergyComparison = witness.configuration?.authority === PHYSICAL_ENERGY_ENVELOPE_AUTHORITY;
  if (envelopeComparison && !rawProductView) {
    throw new Error('recurrent envelope witness must use raw full-opacity emphasis');
  }
  if (
    (!rawProductView && !diagnosticView)
    || (diagnosticView && (
      JSON.stringify(emphasis.staticCohorts) !== JSON.stringify(['stable-q1', 'stable-q2'])
      || JSON.stringify(emphasis.motionCohorts) !== JSON.stringify(['stable-q3', 'stable-q4', 'transported', 'birth'])
      || emphasis.staticAttenuation !== 0.1
      || emphasis.unmatchedAttenuation !== 0.05
    ))
    || (rawProductView && (
      JSON.stringify(emphasis.staticCohorts) !== JSON.stringify([])
      || JSON.stringify(emphasis.motionCohorts) !== JSON.stringify([])
      || emphasis.staticAttenuation !== 1
      || emphasis.unmatchedAttenuation !== 1
    ))
  ) throw new Error('motion cohort witness emphasis contract mismatch');
  const expectedRoles = envelopeComparison ? {
    reference: 'exact-heldout-full-splat-state-v0',
    control: 'frozen-current-full-splat-state-v0',
    legacy: 'one-step-ratio-learned-recurrent-full-splat-state-v0',
    envelope: 'training-episode-envelope-learned-recurrent-full-splat-state-v0',
  } : rawProductView ? {
    reference: 'exact-heldout-full-splat-state-v0',
    control: 'frozen-current-full-splat-state-v0',
    predicted: 'learned-recurrent-full-splat-state-v0',
  } : {
    reference: 'exact-heldout-target-motion-cohorts-v0',
    control: 'copied-current-projected-onto-exact-motion-cohorts-v0',
    predicted: 'learned-recurrent-state-projected-onto-exact-motion-cohorts-v0',
  };
  if (JSON.stringify(witness.roles) !== JSON.stringify(expectedRoles)) throw new Error('motion cohort witness role contract mismatch');
  if (rawProductView) {
    const controlFrames = witness.roleEvidence?.control;
    const identity = witness.controlFrameIdentity;
    const hashes = Array.isArray(controlFrames) ? controlFrames.map(frame => frame?.sha256) : [];
    const uniqueHashes = new Set(hashes);
    if (
      hashes.length !== witness.playback.frameCount
      || hashes.some(hash => !isSha256(hash))
      || uniqueHashes.size !== 1
      || identity?.authority !== 'pixel-identical-frozen-control-v0'
      || identity.frameCount !== hashes.length
      || identity.uniqueFrameCount !== 1
      || identity.sha256 !== hashes[0]
    ) throw new Error('raw product view control frame identity mismatch');
  }
  if (envelopeComparison) {
    if (witness.configuration.witnessMode !== 'raw-recurrent-envelope-comparison') {
      throw new Error('recurrent envelope witness mode mismatch');
    }
    for (const role of ['reference', 'control', 'legacy', 'envelope']) {
      const evidence = witness.roleEvidence?.[role];
      if (
        !Array.isArray(evidence) || evidence.length !== playback.frameCount
        || evidence.some((frame, index) => frame?.step !== index + 1 || !isSha256(frame.sha256))
      ) throw new Error(`recurrent envelope ${role} role evidence mismatch`);
    }
    for (const role of ['legacy', 'envelope']) {
      if (new Set(witness.roleEvidence[role].map(frame => frame.sha256)).size <= 1) {
        throw new Error(`recurrent envelope ${role} role is static rather than moving`);
      }
    }
    const source = witness.source;
    const shared = source?.sharedIdentity;
    if (
      !isSha256(source?.manifest?.sha256)
      || !isSha256(source?.envelopeAudit?.sha256)
      || !isSha256(shared?.occupancyModelSha256)
      || !isSha256(shared?.destinationStateModelSha256)
      || !isSha256(shared?.trainingManifestSha256)
      || typeof shared?.inferenceFrameZero?.referenceFrameId !== 'string'
      || !Number.isInteger(shared?.inferenceFrameZero?.count)
      || shared.inferenceFrameZero.count <= 0
    ) throw new Error('recurrent envelope shared identity, envelope audit, or frame zero mismatch');
    if (
      physicalEnergyComparison
      && JSON.stringify(shared.destinationStateTrainingLoss) !== JSON.stringify(PHYSICAL_VISIBLE_ENERGY_LOSS_IDENTITY)
    ) throw new Error('recurrent envelope physical visible-energy loss identity mismatch');
    if (physicalEnergyComparison && (
      !isSha256(shared.destinationStateCorpora?.trainingManifestSha256)
      || !isSha256(shared.destinationStateCorpora?.evaluationManifestSha256)
      || shared.destinationStateCorpora.trainingManifestSha256 !== shared.trainingManifestSha256
      || shared.destinationStateCorpora.evaluationManifestSha256 !== source.manifest.sha256
    )) throw new Error('recurrent envelope destination state corpus identity mismatch');
    for (const [role, mode] of [['legacy', 'one-step-ratio'], ['envelope', 'training-episode-envelope']]) {
      const identity = source?.[role];
      const receipt = identity?.greenroomReceipt;
      if (
        !isSha256(identity?.predictions?.sha256)
        || !isSha256(identity?.trainingReport?.sha256)
        || !isSha256(receipt?.sha256)
        || typeof receipt.jobId !== 'string' || receipt.jobId.length === 0
        || receipt.status !== 'done' || receipt.exitCode !== 0
        || !routeHasExactOption(receipt.effectiveRoute, '--support-budget-mode', mode)
        || identity?.backend?.backend !== 'mlx'
        || !/^Device\(gpu,\s*\d+\)$/i.test(String(identity.backend.device))
        || identity.backend.fallbackReason !== null
      ) throw new Error(`recurrent envelope ${role} route identity mismatch`);
    }
    const budget = witness.supportBudgetComparison;
    if (
      budget?.authority !== 'paired-recurrent-support-budget-accounting-v0'
      || budget.trainingManifestSha256 !== shared.trainingManifestSha256
      || budget.inferenceFrameZero?.referenceFrameId !== shared.inferenceFrameZero.referenceFrameId
      || budget.inferenceFrameZero?.count !== shared.inferenceFrameZero.count
    ) throw new Error('recurrent envelope budget frame zero identity mismatch');
    for (const [role, mode] of [['legacy', 'one-step-ratio'], ['envelope', 'training-episode-envelope']]) {
      const accounting = budget?.[role];
      if (accounting?.mode !== mode || !Array.isArray(accounting.steps) || accounting.steps.length !== playback.frameCount) {
        throw new Error(`recurrent envelope ${role} budget step count mismatch`);
      }
      for (const [index, step] of accounting.steps.entries()) {
        if (
          step?.step !== index + 1
          || !Number.isInteger(step.requested) || step.requested <= 0
          || !Number.isInteger(step.effective) || step.effective <= 0
          || !Number.isInteger(step.predictedCount) || step.predictedCount <= 0
          || step.predictedCount > step.effective
          || step.effective > step.requested
          || step.clamped !== (step.effective !== step.requested)
        ) throw new Error(`recurrent envelope ${role} budget accounting mismatch at step ${index + 1}`);
      }
    }
    if (
      typeof witness.claimBoundary !== 'string'
      || !/offline/i.test(witness.claimBoundary)
      || !/no runtime(?:\s+authorization)?|does not[^.]*authorize runtime/i.test(witness.claimBoundary)
    ) throw new Error('recurrent envelope witness claim boundary mismatch');
  }
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
  if (!Array.isArray(roleDirs) || roleDirs.length < 2) throw new Error('motion cohort comparison requires at least two roles');
  await mkdir(dirname(outputPath), { recursive: true });
  const args = ['-y'];
  for (const directory of roleDirs) args.push('-framerate', String(fps), '-i', resolve(directory, 'frame-%03d.png'));
  const inputs = roleDirs.map((_, index) => `[${index}:v]`).join('');
  args.push(
    '-filter_complex', `${inputs}hstack=inputs=${roleDirs.length}[out]`,
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

export async function validateNestedMotionCohortArtifacts(nestedDirValue, witness, audit, auditBytes, expected) {
  const nestedDir = resolve(nestedDirValue);
  validateMotionCohortWitness(witness);
  if (
    audit?.schema !== SCHEMA || audit.status !== 'completed'
    || audit.source?.manifest?.sha256 !== expected?.manifestSha256
    || audit.source?.predictions?.sha256 !== expected?.predictionsSha256
    || witness.source?.manifest?.sha256 !== expected.manifestSha256
    || witness.source?.predictions?.sha256 !== expected.predictionsSha256
    || witness.source?.audit?.sha256 !== sha256(auditBytes)
  ) throw new Error('nested motion cohort audit/source identity mismatch');
  const surfaces = [
    ['beauty', witness.roleEvidence],
    ['debug', witness.partialFlowDebug?.roleEvidence],
  ];
  for (const [surface, evidenceByRole] of surfaces) {
    for (const role of ['reference', 'control', 'predicted']) {
      const evidence = evidenceByRole?.[role];
      const roleDir = resolve(nestedDir, surface, role);
      const names = (await readdir(roleDir)).filter(name => /^frame-\d{3}\.png$/.test(name)).sort();
      if (!Array.isArray(evidence) || evidence.length !== witness.playback.frameCount || names.length !== evidence.length) {
        throw new Error(`nested ${surface} ${role} raster frame count mismatch`);
      }
      for (let index = 0; index < names.length; index += 1) {
        if (names[index] !== `frame-${String(index).padStart(3, '0')}.png`) {
          throw new Error(`nested ${surface} ${role} raster sequence mismatch`);
        }
        const bytes = await readFile(resolve(roleDir, names[index]));
        if (sha256(bytes) !== evidence[index]?.sha256) {
          throw new Error(`nested ${surface} ${role} raster byte/hash mismatch at frame ${index}`);
        }
      }
    }
  }
  for (const [name, artifact] of [
    ['motion-cohort-comparison.mp4', witness.artifact],
    ['motion-cohort-debug-comparison.mp4', witness.partialFlowDebug?.artifact],
  ]) {
    const expectedPath = resolve(nestedDir, name);
    if (resolve(artifact?.path ?? '') !== expectedPath) throw new Error(`nested ${name} path mismatch`);
    const bytes = await readFile(expectedPath);
    if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`nested ${name} byte/hash mismatch`);
    }
  }
  return true;
}

function motionWitnessGuide(witness, audit) {
  const rows = Object.entries(audit.aggregate.cohorts).map(([id, cohort]) => `<tr><th>${id}</th><td>${cohort.predictionSupportRecall.toFixed(3)}</td><td>${cohort.controlSupportRecall.toFixed(3)}</td><td>${cohort.predictionEnergyRetention.toFixed(3)}</td><td>${cohort.controlEnergyRetention.toFixed(3)}</td><td>${cohort.predictionBeatStepFraction.toFixed(3)}</td></tr>`).join('');
  const rawProductView = witness.emphasis.authority === 'raw-product-view-no-cohort-attenuation-v0';
  const modeContract = motionWitnessModeContract(rawProductView ? 'raw-product-view' : 'motion-cohort', witness.playback.frameCount);
  const title = rawProductView ? 'Raw Product-View Phase Continuation' : 'Which Fire Support Did The Model Learn?';
  const beauty = rawProductView
    ? `<h2>Unmasked Full-Splat Beauty</h2><p>No exact-target cohort changes opacity: static and unmatched gains are both 1.0. ${modeContract.guideControlDescription}; its receipt requires one unique pixel hash.</p>`
    : '<h2>Motion-Bearing Beauty</h2><p>Stable Q1/Q2 are attenuated to 0.1 opacity. High-change same-cell Q3/Q4, transported support, and births remain at full opacity. Unmatched and dying support remains faint at 0.05. This isolates temporal state propagation without claiming an analytical-raymarch comparison.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motion-Cohort Phase Audit</title>
<style>body{margin:0;background:#111;color:#eee;font:15px/1.45 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:24px}h1,h2{letter-spacing:0}video{display:block;width:100%;background:#000;border:1px solid #444}section{margin:28px 0}code{color:#9ee7ff}table{border-collapse:collapse;width:100%}th,td{padding:7px;border-bottom:1px solid #444;text-align:right}th:first-child{text-align:left}.legend{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.legend span{padding:7px;border-left:5px solid #777}</style></head>
<body><main><h1>${title}</h1>
<p>This is a finite ${witness.playback.simulatorDurationSeconds.toFixed(2)}-second held-out episode. Left is exact <strong>REFERENCE</strong>, center is ${modeContract.guideControlDescription}, and right is recurrent <strong>PREDICTED</strong>. Playback does not loop.</p>
<section>${beauty}<video controls muted playsinline src="motion-cohort-comparison.mp4"></video></section>
<section><h2>Partial Cohort Debug, Gain 0.625</h2><p>The same role states and opacity emphasis receive an additive display-only cohort mix. Green: Q1/Q2. Yellow: Q3. Red: Q4. Blue: transported. Magenta: birth. Orange: unmatched/death.</p><div class="legend"><span style="border-color:#26e63f">Q1/Q2</span><span style="border-color:#f2cc1a">Q3</span><span style="border-color:#ff4210">Q4/death</span><span style="border-color:#19a6ff">transport</span><span style="border-color:#ff1acc">birth</span></div><video controls muted playsinline src="motion-cohort-debug-comparison.mp4"></video></section>
<section><h2>Full-Episode Cohort Audit</h2><table><thead><tr><th>cohort</th><th>prediction support</th><th>control support</th><th>prediction energy</th><th>control energy</th><th>prediction beat-step fraction</th></tr></thead><tbody>${rows}</tbody></table></section>
<section><h2>Claim Boundary</h2><p>${witness.claimBoundary}</p></section></main></body></html>`;
}

export function motionWitnessModeContract(mode, frameCount) {
  const value = String(mode);
  if (!['motion-cohort', 'raw-product-view', 'raw-recurrent-envelope-comparison'].includes(value)) {
    throw new Error('motion cohort witness mode mismatch');
  }
  if (!Number.isInteger(frameCount) || frameCount <= 0) throw new Error('motion cohort witness frame count mismatch');
  const rawProductView = value !== 'motion-cohort';
  return {
    includeControlFrameIdentity: rawProductView,
    roleNames: value === 'raw-recurrent-envelope-comparison'
      ? ['reference', 'control', 'legacy', 'envelope']
      : ['reference', 'control', 'predicted'],
    guideControlDescription: rawProductView
      ? `frozen frame-zero <strong>CONTROL</strong> rendered identically at all ${frameCount} times`
      : 'copied-current <strong>CONTROL</strong>',
  };
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
  const witnessMode = String(options.witnessMode ?? 'motion-cohort');
  const ffmpeg = String(options.ffmpeg ?? 'ffmpeg');
  const ffprobe = String(options.ffprobe ?? 'ffprobe');
  let failurePhase = 'argument-validation';
  let lastTrustworthyEvidence = { manifestPath, predictionsPath, auditPath, outDir };
  await mkdir(outDir, { recursive: true });
  try {
    if (!Number.isFinite(gridStep) || gridStep <= 0) throw new Error('grid step must be finite and positive');
    if (!['motion-cohort', 'raw-product-view'].includes(witnessMode)) throw new Error('motion cohort witness mode mismatch');
    const rawProductView = witnessMode === 'raw-product-view';
    if (
      (!rawProductView && (staticAttenuation !== 0.1 || unmatchedAttenuation !== 0.05))
      || (rawProductView && (staticAttenuation !== 1 || unmatchedAttenuation !== 1))
    ) throw new Error('motion cohort witness attenuation contract mismatch');
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
    const modeContract = motionWitnessModeContract(witnessMode, frameCount);
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
    const labels = rawProductView
      ? ['REFERENCE', 'FROZEN', String(options.predictionLabel ?? 'PREDICTED')]
      : ['REFERENCE', 'CONTROL', 'PREDICTED'];
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
    const controlHashes = beautyEvidence.control.map(frame => frame.sha256);
    const controlFrameIdentity = rawProductView ? {
      authority: 'pixel-identical-frozen-control-v0',
      frameCount: controlHashes.length,
      uniqueFrameCount: new Set(controlHashes).size,
      sha256: controlHashes[0],
    } : null;
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
        authority: rawProductView
          ? 'raw-product-view-no-cohort-attenuation-v0'
          : 'exact-motion-cohort-static-attenuation-v0',
        staticCohorts: rawProductView ? [] : ['stable-q1', 'stable-q2'],
        motionCohorts: rawProductView ? [] : ['stable-q3', 'stable-q4', 'transported', 'birth'],
        staticAttenuation,
        unmatchedAttenuation,
        thresholdSelection: rawProductView
          ? 'none; every full splat retains original opacity'
          : 'registered upper-half stable state-change quartiles plus exact transport and birth; no visual threshold tuning',
      },
      roles: rawProductView ? {
        reference: 'exact-heldout-full-splat-state-v0',
        control: 'frozen-current-full-splat-state-v0',
        predicted: 'learned-recurrent-full-splat-state-v0',
      } : {
        reference: 'exact-heldout-target-motion-cohorts-v0',
        control: 'copied-current-projected-onto-exact-motion-cohorts-v0',
        predicted: 'learned-recurrent-state-projected-onto-exact-motion-cohorts-v0',
      },
      roleEvidence: beautyEvidence,
      ...(modeContract.includeControlFrameIdentity ? { controlFrameIdentity } : {}),
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
      claimBoundary: rawProductView
        ? 'This witness compares full unmasked exact, frozen-present, and learned recurrent splat states under one isolated offline raster. It uses no target-derived opacity mask. It does not measure analytical-raymarch image error or authorize runtime composition.'
        : 'This witness reveals exact registered motion-bearing support under an isolated offline splat raster. It does not measure analytical-raymarch image error, prove a training remedy, or authorize runtime composition.',
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

function recurrentEnvelopeGuide(report) {
  const summary = report.metrics.summary;
  const row = (name, value) => `<tr><th>${name}</th><td>${value.terminalPredictedCount}</td><td>${value.terminalExactCount}</td><td>${value.terminalCountError}</td><td>${value.terminalPredictionIoU.toFixed(6)}</td><td>${value.clampCount}</td><td>${value.firstClampStep ?? 'none'}</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recurrent Support Envelope Comparison</title>
<style>body{margin:0;background:#111;color:#eee;font:15px/1.45 system-ui,sans-serif}main{max-width:1480px;margin:auto;padding:24px}h1,h2{letter-spacing:0}video,img{display:block;width:100%;background:#000;border:1px solid #444}section{margin:28px 0}.roles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.roles div{padding:8px;border-left:4px solid #777}table{border-collapse:collapse;width:100%}th,td{padding:7px;border-bottom:1px solid #444;text-align:right}th:first-child{text-align:left}code{color:#9ee7ff}</style></head>
<body><main><h1>Does A Training Support Envelope Arrest Recurrent Collapse?</h1>
<p>This is one complete ${report.playback.simulatorDurationSeconds.toFixed(2)}-second held-out episode at exact simulator cadence. It is a temporal sequence, not a loop. Every role uses the same fixed camera and full splat opacity; no exact-target cohort mask changes visibility.</p>
<section><h2>Fixed Roles, Left To Right</h2><div class="roles"><div><strong>REFERENCE</strong><br>Exact held-out simulator state at each time.</div><div><strong>FROZEN</strong><br>One frame-zero present-state raster reused byte-identically at all ${report.playback.frameCount} times.</div><div><strong>LEGACY</strong><br>Accepted recurrent prediction with unconstrained one-step-ratio support growth.</div><div><strong>ENVELOPE</strong><br>Accepted recurrent prediction clamped to the frozen model training episode's support-count range.</div></div><video controls muted playsinline preload="metadata" src="recurrent-envelope-comparison.mp4"></video></section>
<section><h2>Additive Flow Debug, Gain 0.625</h2><p>The same states and cadence receive display-only cohort colors. This panel helps localize transported, born, static, and dying support; it does not alter model state or the beauty witness.</p><video controls muted playsinline preload="metadata" src="recurrent-envelope-debug-comparison.mp4"></video></section>
<section><h2>Support Outcome</h2><table><thead><tr><th>role</th><th>terminal predicted</th><th>terminal exact</th><th>absolute count error</th><th>prediction IoU</th><th>clamped steps</th><th>first clamp</th></tr></thead><tbody>${row('LEGACY', summary.legacy)}${row('ENVELOPE', summary.envelope)}</tbody></table></section>
<section><h2>Interpretation Boundary</h2><p>${report.claimBoundary}</p></section></main></body></html>`;
}

function supportBudgetEvidence(report, mode, frameCount) {
  const top = report.supportBudget;
  if (
    top?.authority !== 'explicit-recurrent-support-budget-mode-v0'
    || top.mode !== mode
    || !isSha256(top.trainingManifestSha256)
    || typeof top.inferenceFrameZero?.referenceFrameId !== 'string'
    || !Number.isInteger(top.inferenceFrameZero?.count)
    || !Array.isArray(report.recurrent)
    || report.recurrent.length !== frameCount
  ) throw new Error(`${mode} recurrent support budget report mismatch`);
  const steps = report.recurrent.map((rowValue, index) => {
    const budget = rowValue.supportBudget;
    if (
      rowValue.step !== index + 1
      || budget?.mode !== mode
      || budget.trainingManifestSha256 !== top.trainingManifestSha256
      || budget.inferenceFrameZero?.referenceFrameId !== top.inferenceFrameZero.referenceFrameId
      || budget.inferenceFrameZero?.count !== top.inferenceFrameZero.count
      || rowValue.requestedTargetSupportBudget !== budget.requestedBudget
      || rowValue.targetSupportBudget !== budget.effectiveBudget
      || rowValue.supportBudgetClamped !== budget.clamped
    ) throw new Error(`${mode} recurrent support budget identity mismatch at step ${index + 1}`);
    return {
      step: rowValue.step,
      requested: rowValue.requestedTargetSupportBudget,
      effective: rowValue.targetSupportBudget,
      predictedCount: rowValue.predictedCount,
      clamped: rowValue.supportBudgetClamped,
    };
  });
  return { mode, steps };
}

function recurrentSummary(report) {
  const terminalBudget = report.recurrent.at(-1);
  const terminalMetric = report.holdoutMetrics.at(-1);
  const terminalDrift = report.countDriftGate.steps.at(-1);
  const clamped = report.recurrent.filter(rowValue => rowValue.supportBudgetClamped);
  return {
    terminalPredictedCount: terminalBudget.predictedCount,
    terminalExactCount: terminalDrift.exactCount,
    terminalCountError: terminalDrift.predictedCountError,
    terminalPredictionIoU: terminalMetric.predictionIoU,
    terminalIdentityIoU: terminalMetric.identityIoU,
    terminalPredictionToIdentityRatio: terminalMetric.predictionToIdentityRatio,
    beatsIdentitySteps: report.holdoutMetrics.filter(rowValue => rowValue.beatsIdentity).length,
    clampCount: clamped.length,
    firstClampStep: clamped[0]?.step ?? null,
  };
}

export async function writeRecurrentEnvelopeWitness(
  manifestPathValue,
  legacyPredictionsPathValue,
  envelopePredictionsPathValue,
  options = {},
) {
  const outDir = resolve(options.outDir ?? '/tmp/kaminos-recurrent-envelope-witness');
  const sourcePath = (value, label) => resolve(value ?? outDir, value ? '' : `.missing-${label}`);
  const manifestPath = sourcePath(manifestPathValue, 'manifest');
  const legacyPredictionsPath = sourcePath(legacyPredictionsPathValue, 'legacy-predictions');
  const envelopePredictionsPath = sourcePath(envelopePredictionsPathValue, 'envelope-predictions');
  const legacyTrainingReportPath = sourcePath(options.legacyTrainingReport, 'legacy-training-report');
  const envelopeTrainingReportPath = sourcePath(options.envelopeTrainingReport, 'envelope-training-report');
  const legacyReceiptPath = sourcePath(options.legacyReceipt, 'legacy-receipt');
  const envelopeReceiptPath = sourcePath(options.envelopeReceipt, 'envelope-receipt');
  const reportPath = resolve(options.report ?? outDir, options.report ? '' : 'recurrent-envelope-witness.json');
  const width = Math.max(32, Math.floor(Number(options.width ?? 320)));
  const height = Math.max(32, Math.floor(Number(options.height ?? 240)));
  const ffmpeg = String(options.ffmpeg ?? 'ffmpeg');
  const ffprobe = String(options.ffprobe ?? 'ffprobe');
  let failurePhase = 'source-validation';
  let lastTrustworthyEvidence = {
    manifestPath,
    legacyPredictionsPath,
    envelopePredictionsPath,
    legacyTrainingReportPath,
    envelopeTrainingReportPath,
    legacyReceiptPath,
    envelopeReceiptPath,
    outDir,
  };
  await mkdir(outDir, { recursive: true });
  try {
    const paths = [
      manifestPath, legacyPredictionsPath, envelopePredictionsPath,
      legacyTrainingReportPath, envelopeTrainingReportPath, legacyReceiptPath, envelopeReceiptPath,
    ];
    const bytes = await Promise.all(paths.map(path => readFile(path)));
    const [manifest, legacyPredictions, envelopePredictions, legacyReport, envelopeReport, legacyReceipt, envelopeReceipt] = bytes.map(value => JSON.parse(value.toString('utf8')));
    const manifestSha256 = sha256(bytes[0]);
    const legacyPredictionsSha256 = sha256(bytes[1]);
    const envelopePredictionsSha256 = sha256(bytes[2]);
    if (manifest.schema !== CORPUS_SCHEMA || manifest.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') {
      throw new Error('recurrent envelope manifest route mismatch');
    }
    const pair = [
      ['legacy', 'one-step-ratio', legacyPredictions, legacyReport, legacyReceipt, legacyPredictionsSha256],
      ['envelope', 'training-episode-envelope', envelopePredictions, envelopeReport, envelopeReceipt, envelopePredictionsSha256],
    ];
    for (const [role, mode, predictions, trainingReport, receipt, predictionsSha256] of pair) {
      if (predictions.schema !== PREDICTION_SCHEMA || predictions.status !== 'completed') throw new Error(`${role} predictions schema/status mismatch`);
      if (predictions.manifest?.sha256 !== manifestSha256 || predictions.manifest?.bytes !== bytes[0].byteLength) throw new Error(`${role} manifest identity mismatch`);
      if (
        trainingReport.status !== 'completed'
        || trainingReport.manifest?.sha256 !== manifestSha256
        || trainingReport.predictions?.sha256 !== predictionsSha256
        || trainingReport.supportBudget?.mode !== mode
        || trainingReport.route?.backend !== 'mlx'
        || !/^Device\(gpu,\s*\d+\)$/i.test(String(trainingReport.route?.device))
        || trainingReport.route.fallbackReason !== null
      ) throw new Error(`${role} training report route/identity mismatch`);
      if (
        receipt.status !== 'done' || receipt.exit_code !== 0 || receipt.failure_phase !== null
        || typeof receipt.job_id !== 'string' || !receipt.job_id
        || !routeHasExactOption(receipt.effective_route, '--support-budget-mode', mode)
      ) throw new Error(`${role} Greenroom receipt mismatch`);
    }
    const sharedKeys = [
      ['manifest', manifestSha256],
      ['model', legacyReport.model?.sha256],
      ['destination state model', legacyReport.destinationStateModel?.sha256],
      ['training manifest', legacyReport.modelTrainingManifest?.sha256],
    ];
    if (sharedKeys.some(([, value]) => !isSha256(value))) throw new Error('recurrent envelope shared identity is malformed');
    if (
      legacyReport.model.sha256 !== envelopeReport.model?.sha256
      || legacyReport.destinationStateModel.sha256 !== envelopeReport.destinationStateModel?.sha256
      || legacyReport.destinationStateModel.path !== envelopeReport.destinationStateModel?.path
      || legacyReport.modelTrainingManifest.sha256 !== envelopeReport.modelTrainingManifest?.sha256
      || JSON.stringify(legacyPredictions.temporal) !== JSON.stringify(envelopePredictions.temporal)
      || legacyPredictions.frames?.length !== envelopePredictions.frames?.length
      || legacyPredictions.frames.some((frame, index) => frame.referenceFrameId !== envelopePredictions.frames[index]?.referenceFrameId)
    ) throw new Error('recurrent envelope pair does not share corpus/model/time identity');
    const destinationStateModelPath = resolve(String(legacyReport.destinationStateModel.path));
    const destinationStateModelBytes = await readFile(destinationStateModelPath);
    const destinationStateModelSha256 = sha256(destinationStateModelBytes);
    if (destinationStateModelSha256 !== legacyReport.destinationStateModel.sha256) {
      throw new Error('destination state model byte/hash mismatch');
    }
    const destinationStateModel = JSON.parse(destinationStateModelBytes.toString('utf8'));
    const destinationStateIdentity = physicalDestinationStateModelIdentity(
      destinationStateModel,
      legacyReport.destinationStateModel,
    );
    const envelopeDestinationStateIdentity = physicalDestinationStateModelIdentity(
      destinationStateModel,
      envelopeReport.destinationStateModel,
    );
    if (JSON.stringify(destinationStateIdentity) !== JSON.stringify(envelopeDestinationStateIdentity)) {
      throw new Error('destination state model paired report identity mismatch');
    }
    const destinationStateTrainingLoss = destinationStateIdentity.loss;
    const destinationStateCorpora = destinationStateIdentity.corpora;
    const frameCount = legacyPredictions.frames.length - 1;
    const cadenceMs = legacyPredictions.temporal.controlledStepDeltaMs;
    const legacyBudget = supportBudgetEvidence(legacyReport, 'one-step-ratio', frameCount);
    const envelopeBudget = supportBudgetEvidence(envelopeReport, 'training-episode-envelope', frameCount);
    const frameZero = legacyReport.supportBudget.inferenceFrameZero;
    if (
      envelopeReport.supportBudget.trainingManifestSha256 !== legacyReport.supportBudget.trainingManifestSha256
      || envelopeReport.supportBudget.inferenceFrameZero?.referenceFrameId !== frameZero.referenceFrameId
      || envelopeReport.supportBudget.inferenceFrameZero?.count !== frameZero.count
    ) throw new Error('recurrent envelope pair frame zero mismatch');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      manifestSha256,
      legacyPredictionsSha256,
      envelopePredictionsSha256,
      occupancyModelSha256: legacyReport.model.sha256,
      destinationStateModelPath,
      destinationStateModelSha256,
      destinationStateTrainingLoss,
      destinationStateCorpora,
      trainingManifestSha256: legacyReport.modelTrainingManifest.sha256,
      inferenceFrameZero: frameZero,
      frameCount,
      controlledStepDeltaMs: cadenceMs,
    };
    failurePhase = 'nested-audit';
    const legacyDir = resolve(outDir, 'legacy-source');
    const envelopeDir = resolve(outDir, 'envelope-source');
    let legacyAudit;
    let envelopeAudit;
    let legacyWitness;
    let envelopeWitness;
    if (options.reuseNestedArtifacts === true) {
      failurePhase = 'nested-artifact-revalidation';
      const [legacyAuditBytes, envelopeAuditBytes, legacyWitnessBytes, envelopeWitnessBytes] = await Promise.all([
        readFile(resolve(legacyDir, 'motion-cohort-audit.json')),
        readFile(resolve(envelopeDir, 'motion-cohort-audit.json')),
        readFile(resolve(legacyDir, 'motion-cohort-witness.json')),
        readFile(resolve(envelopeDir, 'motion-cohort-witness.json')),
      ]);
      legacyAudit = JSON.parse(legacyAuditBytes.toString('utf8'));
      envelopeAudit = JSON.parse(envelopeAuditBytes.toString('utf8'));
      legacyWitness = JSON.parse(legacyWitnessBytes.toString('utf8'));
      envelopeWitness = JSON.parse(envelopeWitnessBytes.toString('utf8'));
      await validateNestedMotionCohortArtifacts(legacyDir, legacyWitness, legacyAudit, legacyAuditBytes, {
        manifestSha256, predictionsSha256: legacyPredictionsSha256,
      });
      await validateNestedMotionCohortArtifacts(envelopeDir, envelopeWitness, envelopeAudit, envelopeAuditBytes, {
        manifestSha256, predictionsSha256: envelopePredictionsSha256,
      });
    } else {
      legacyAudit = await writeMotionCohortAudit(manifestPath, legacyPredictionsPath, { outDir: legacyDir });
      envelopeAudit = await writeMotionCohortAudit(manifestPath, envelopePredictionsPath, { outDir: envelopeDir });
      failurePhase = 'nested-raster';
      const witnessOptions = {
        width, height, staticAttenuation: 1, unmatchedAttenuation: 1,
        partialFlowDebugGain: 0.625, witnessMode: 'raw-product-view', ffmpeg, ffprobe,
      };
      legacyWitness = await writeMotionCohortWitness(
        manifestPath, legacyPredictionsPath, resolve(legacyDir, 'motion-cohort-audit.json'),
        { ...witnessOptions, outDir: legacyDir, predictionLabel: 'LEGACY' },
      );
      envelopeWitness = await writeMotionCohortWitness(
        manifestPath, envelopePredictionsPath, resolve(envelopeDir, 'motion-cohort-audit.json'),
        { ...witnessOptions, outDir: envelopeDir, predictionLabel: 'ENVELOPE' },
      );
    }
    for (const role of ['reference', 'control']) {
      if (
        JSON.stringify(legacyWitness.roleEvidence[role].map(frame => frame.sha256))
        !== JSON.stringify(envelopeWitness.roleEvidence[role].map(frame => frame.sha256))
      ) throw new Error(`recurrent envelope nested ${role} raster identity mismatch`);
    }
    failurePhase = 'four-role-encode';
    const roleSources = {
      reference: resolve(legacyDir, 'beauty', 'reference'),
      control: resolve(legacyDir, 'beauty', 'control'),
      legacy: resolve(legacyDir, 'beauty', 'predicted'),
      envelope: resolve(envelopeDir, 'beauty', 'predicted'),
    };
    const debugSources = {
      reference: resolve(legacyDir, 'debug', 'reference'),
      control: resolve(legacyDir, 'debug', 'control'),
      legacy: resolve(legacyDir, 'debug', 'predicted'),
      envelope: resolve(envelopeDir, 'debug', 'predicted'),
    };
    const fps = 1000 / cadenceMs;
    const artifact = await encodeComparison(
      Object.values(roleSources), resolve(outDir, 'recurrent-envelope-comparison.mp4'), fps, frameCount, ffmpeg, ffprobe,
    );
    const debugArtifact = await encodeComparison(
      Object.values(debugSources), resolve(outDir, 'recurrent-envelope-debug-comparison.mp4'), fps, frameCount, ffmpeg, ffprobe,
    );
    const stepped = frames => frames.map((frame, index) => ({ step: index + 1, ...frame }));
    const roleEvidence = {
      reference: stepped(legacyWitness.roleEvidence.reference),
      control: stepped(legacyWitness.roleEvidence.control),
      legacy: stepped(legacyWitness.roleEvidence.predicted),
      envelope: stepped(envelopeWitness.roleEvidence.predicted),
    };
    const receiptIdentity = (path, value, rawBytes) => ({
      path,
      bytes: rawBytes.byteLength,
      sha256: sha256(rawBytes),
      jobId: value.job_id,
      status: value.status,
      exitCode: value.exit_code,
      effectiveRoute: value.effective_route,
      startedAt: value.started_at,
      finishedAt: value.finished_at,
    });
    failurePhase = 'report-write';
    const report = {
      schema: WITNESS_SCHEMA,
      status: 'completed',
      configuration: {
        authority: PHYSICAL_ENERGY_ENVELOPE_AUTHORITY,
        witnessMode: 'raw-recurrent-envelope-comparison',
      },
      source: {
        audit: { path: resolve(legacyDir, 'motion-cohort-audit.json'), sha256: sha256(await readFile(resolve(legacyDir, 'motion-cohort-audit.json'))) },
        envelopeAudit: { path: resolve(envelopeDir, 'motion-cohort-audit.json'), sha256: sha256(await readFile(resolve(envelopeDir, 'motion-cohort-audit.json'))) },
        manifest: { path: manifestPath, bytes: bytes[0].byteLength, sha256: manifestSha256 },
        legacy: {
          predictions: { path: legacyPredictionsPath, bytes: bytes[1].byteLength, sha256: legacyPredictionsSha256 },
          trainingReport: { path: legacyTrainingReportPath, bytes: bytes[3].byteLength, sha256: sha256(bytes[3]) },
          greenroomReceipt: receiptIdentity(legacyReceiptPath, legacyReceipt, bytes[5]),
          backend: legacyReport.route,
        },
        envelope: {
          predictions: { path: envelopePredictionsPath, bytes: bytes[2].byteLength, sha256: envelopePredictionsSha256 },
          trainingReport: { path: envelopeTrainingReportPath, bytes: bytes[4].byteLength, sha256: sha256(bytes[4]) },
          greenroomReceipt: receiptIdentity(envelopeReceiptPath, envelopeReceipt, bytes[6]),
          backend: envelopeReport.route,
        },
        sharedIdentity: {
          occupancyModelSha256: legacyReport.model.sha256,
          destinationStateModelSha256,
          destinationStateTrainingLoss,
          destinationStateCorpora,
          trainingManifestSha256: legacyReport.modelTrainingManifest.sha256,
          inferenceFrameZero: frameZero,
        },
      },
      playback: {
        authority: 'finite-complete-heldout-recurrent-support-envelope-comparison-v0',
        frameCount,
        controlledStepDeltaMs: cadenceMs,
        simulatorDurationSeconds: frameCount * cadenceMs / 1000,
        requestedFps: fps,
        effectiveFps: artifact.probe.fps,
        encodedDurationSeconds: artifact.probe.duration,
        loops: false,
      },
      emphasis: {
        authority: 'raw-product-view-no-cohort-attenuation-v0',
        staticCohorts: [], motionCohorts: [], staticAttenuation: 1, unmatchedAttenuation: 1,
        thresholdSelection: 'none; every full splat retains original opacity',
      },
      roles: {
        reference: 'exact-heldout-full-splat-state-v0',
        control: 'frozen-current-full-splat-state-v0',
        legacy: 'one-step-ratio-learned-recurrent-full-splat-state-v0',
        envelope: 'training-episode-envelope-learned-recurrent-full-splat-state-v0',
      },
      roleEvidence,
      controlFrameIdentity: legacyWitness.controlFrameIdentity,
      supportBudgetComparison: {
        authority: 'paired-recurrent-support-budget-accounting-v0',
        trainingManifestSha256: legacyReport.modelTrainingManifest.sha256,
        inferenceFrameZero: frameZero,
        legacy: legacyBudget,
        envelope: envelopeBudget,
      },
      artifact,
      partialFlowDebug: {
        authority: 'display-only-motion-cohort-debug-mix-v0',
        requestedGain: 0.625,
        effectiveGain: 0.625,
        stateMutation: false,
        artifact: debugArtifact,
      },
      metrics: {
        authority: 'accepted-training-report-support-and-same-corpus-iou-v0',
        summary: { legacy: recurrentSummary(legacyReport), envelope: recurrentSummary(envelopeReport) },
        legacyHoldout: legacyReport.holdoutMetrics,
        envelopeHoldout: envelopeReport.holdoutMetrics,
      },
      claimBoundary: 'Offline same-raster diagnostic only; it does not establish analytical-raymarch image error, authorize runtime composition, or prove cross-basin generalization.',
    };
    validateMotionCohortWitness(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resolve(outDir, 'inspection-guide.html'), recurrentEnvelopeGuide(report));
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
      if (args.get('--envelope-predictions')) {
        const report = await writeRecurrentEnvelopeWitness(
          args.get('--manifest'), args.get('--predictions'), args.get('--envelope-predictions'), {
            legacyTrainingReport: args.get('--legacy-training-report'),
            envelopeTrainingReport: args.get('--envelope-training-report'),
            legacyReceipt: args.get('--legacy-receipt'),
            envelopeReceipt: args.get('--envelope-receipt'),
            outDir: args.get('--out-dir'), report: args.get('--report'),
            width: args.get('--width'), height: args.get('--height'),
            ffmpeg: args.get('--ffmpeg'), ffprobe: args.get('--ffprobe'),
            reuseNestedArtifacts: args.get('--reuse-nested-artifacts') === '1',
          },
        );
        console.log(JSON.stringify({
          schema: report.schema,
          status: report.status,
          frames: report.playback.frameCount,
          roles: Object.keys(report.roles),
        }, null, 2));
      } else if (args.get('--audit')) {
        const report = await writeMotionCohortWitness(
          args.get('--manifest'), args.get('--predictions'), args.get('--audit'), {
            outDir: args.get('--out-dir'), report: args.get('--report'), gridStep: args.get('--grid-step'),
            width: args.get('--width'), height: args.get('--height'),
            staticAttenuation: args.get('--static-attenuation'), unmatchedAttenuation: args.get('--unmatched-attenuation'),
            partialFlowDebugGain: args.get('--partial-flow-debug-gain'), witnessMode: args.get('--witness-mode'),
            ffmpeg: args.get('--ffmpeg'), ffprobe: args.get('--ffprobe'),
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

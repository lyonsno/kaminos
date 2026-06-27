#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const GENERATED_POSE_FEATURES_SCHEMA = 'kaminos.generated-pose-features.v0';
const GENERATED_POSE_OUTPUT_MAP_SCHEMA = 'kaminos.generated-pose-output-map.v0';

const inputSockets = [
  {
    id: 'rootMetrics.travelXZ',
    label: 'Root travel XZ',
    valueType: 'number',
    featurePath: 'rootMetrics.travelXZ',
    units: 'meters',
    normalize: { min: 0, max: 5 },
  },
  {
    id: 'torsoFrame.chestRootHorizontalLean.range',
    label: 'Torso lean range',
    valueType: 'number',
    featurePath: 'torsoFrame.chestRootHorizontalLean.range',
    units: 'meters',
    normalize: { min: 0, max: 0.2 },
  },
  {
    id: 'torsoFrame.headRootDistance.range',
    label: 'Head/root separation range',
    valueType: 'number',
    featurePath: 'torsoFrame.headRootDistance.range',
    units: 'meters',
    normalize: { min: 0, max: 0.18 },
  },
  {
    id: 'limbEnvelope.handSpan.range',
    label: 'Hand span range',
    valueType: 'number',
    featurePath: 'limbEnvelope.handSpan.range',
    units: 'meters',
    normalize: { min: 0, max: 1.4 },
  },
  {
    id: 'limbEnvelope.maxHandSpeed',
    label: 'Maximum hand speed',
    valueType: 'number',
    featurePath: 'limbEnvelope.maxHandSpeed',
    units: 'metersPerSecond',
    normalize: { min: 0, max: 2.5 },
  },
  {
    id: 'stanceContact.stanceWidth.range',
    label: 'Stance width range',
    valueType: 'number',
    featurePath: 'stanceContact.stanceWidth.range',
    units: 'meters',
    normalize: { min: 0, max: 0.8 },
  },
  {
    id: 'stanceContact.contactBalance',
    label: 'Foot contact balance',
    valueType: 'derived-number',
    featurePath: 'stanceContact.leftContactRatio/rightContactRatio',
    units: 'ratio',
    normalize: { min: 0, max: 1 },
  },
  {
    id: 'expansionCompression.bboxVolume.range',
    label: 'Pose volume range',
    valueType: 'number',
    featurePath: 'expansionCompression.bboxVolume.range',
    units: 'cubicMeters',
    normalize: { min: 0, max: 2 },
  },
  {
    id: 'eventSpikes.0.speed',
    label: 'Primary event spike speed',
    valueType: 'number',
    featurePath: 'eventSpikes.0.speed',
    units: 'metersPerSecond',
    normalize: { min: 0, max: 2.5 },
  },
];

const outputSockets = [
  { id: 'orb.rootOffset', label: 'Orb root offset', valueType: 'number', domain: 'motion-root' },
  { id: 'orb.faceCueLead', label: 'Face cue lead', valueType: 'number', domain: 'attention' },
  { id: 'body.lean', label: 'Body lean', valueType: 'number', domain: 'body-shape' },
  { id: 'body.scalePulse', label: 'Body scale pulse', valueType: 'number', domain: 'body-shape' },
  { id: 'aura.radius', label: 'Aura radius', valueType: 'number', domain: 'expressive-envelope' },
  { id: 'trail.accent', label: 'Trail/accent emission', valueType: 'event', domain: 'accent' },
  { id: 'footfall.pulse', label: 'Footfall pulse', valueType: 'number', domain: 'grounding' },
];

const mappingEdges = [
  {
    id: 'root-travel-to-orb-offset',
    from: 'rootMetrics.travelXZ',
    to: 'orb.rootOffset',
    rule: { type: 'linear-normalized', gain: 1 },
  },
  {
    id: 'head-root-to-face-cue',
    from: 'torsoFrame.headRootDistance.range',
    to: 'orb.faceCueLead',
    rule: { type: 'linear-normalized', gain: 1.1 },
  },
  {
    id: 'torso-lean-to-body-lean',
    from: 'torsoFrame.chestRootHorizontalLean.range',
    to: 'body.lean',
    rule: { type: 'linear-normalized', gain: 1 },
  },
  {
    id: 'volume-range-to-scale-pulse',
    from: 'expansionCompression.bboxVolume.range',
    to: 'body.scalePulse',
    rule: { type: 'linear-normalized', gain: 1 },
  },
  {
    id: 'hand-span-to-aura-radius',
    from: 'limbEnvelope.handSpan.range',
    to: 'aura.radius',
    rule: { type: 'linear-normalized', gain: 1 },
  },
  {
    id: 'event-spike-to-trail-accent',
    from: 'eventSpikes.0.speed',
    to: 'trail.accent',
    rule: { type: 'event-normalized', gain: 1 },
  },
  {
    id: 'stance-and-contact-to-footfall',
    from: 'stanceContact.stanceWidth.range',
    to: 'footfall.pulse',
    rule: { type: 'weighted-average', gain: 1, with: ['stanceContact.contactBalance'] },
  },
];

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const requestedFeaturesReport = args.get('--features-report') || '';
const effectiveFeaturesReport = requestedFeaturesReport ? resolve(requestedFeaturesReport) : null;
const out = resolve(args.get('--out') || '/tmp/kaminos-generated-pose-output-map.json');

let phase = 'initializing';
let lastEvidence = {};

function round(value, digits = 5) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function hashFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function writeReport(report) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({
    schema: GENERATED_POSE_OUTPUT_MAP_SCHEMA,
    requestedFeaturesReport,
    effectiveFeaturesReport,
    outputPath: out,
    phase,
    ...lastEvidence,
    ...report,
  }, null, 2));
}

function fail(error, failureKind = 'mapping-failure') {
  writeReport({
    ok: false,
    failureKind,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function valueAtPath(object, path) {
  if (path === 'stanceContact.leftContactRatio/rightContactRatio') {
    const left = Number(object?.stanceContact?.leftContactRatio);
    const right = Number(object?.stanceContact?.rightContactRatio);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return 1 - Math.abs(left - right);
  }
  return path.split('.').reduce((current, key) => current?.[key], object);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeValue(raw, socket) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const { min, max } = socket.normalize;
  return clamp01((numeric - min) / Math.max(1e-6, max - min));
}

function socketValues(features) {
  return Object.fromEntries(inputSockets.map(socket => {
    const raw = valueAtPath(features, socket.featurePath);
    return [socket.id, {
      raw: Number.isFinite(Number(raw)) ? round(Number(raw)) : raw,
      normalized: normalizeValue(raw, socket),
      sourcePath: socket.featurePath,
    }];
  }));
}

function applyLinear(source, gain = 1) {
  if (!Number.isFinite(source?.normalized)) return null;
  return round(clamp01(source.normalized * gain));
}

function mapOutputs(features, inputs) {
  const event = Array.isArray(features.eventSpikes) ? features.eventSpikes[0] || null : null;
  const footfallBase = [
    inputs['stanceContact.stanceWidth.range']?.normalized,
    inputs['stanceContact.contactBalance']?.normalized,
  ].filter(Number.isFinite);
  const footfall = footfallBase.length
    ? round(clamp01(footfallBase.reduce((sum, value) => sum + value, 0) / footfallBase.length))
    : null;
  return {
    'orb.rootOffset': {
      value: applyLinear(inputs['rootMetrics.travelXZ'], 1),
      source: 'rootMetrics.travelXZ',
    },
    'orb.faceCueLead': {
      value: applyLinear(inputs['torsoFrame.headRootDistance.range'], 1.1),
      source: 'torsoFrame.headRootDistance.range',
    },
    'body.lean': {
      value: applyLinear(inputs['torsoFrame.chestRootHorizontalLean.range'], 1),
      source: 'torsoFrame.chestRootHorizontalLean.range',
    },
    'body.scalePulse': {
      value: applyLinear(inputs['expansionCompression.bboxVolume.range'], 1),
      source: 'expansionCompression.bboxVolume.range',
    },
    'aura.radius': {
      value: applyLinear(inputs['limbEnvelope.handSpan.range'], 1),
      source: 'limbEnvelope.handSpan.range',
    },
    'trail.accent': {
      value: applyLinear(inputs['eventSpikes.0.speed'], 1),
      source: 'eventSpikes.0.speed',
      event: event ? {
        channel: event.channel,
        time: round(Number(event.time)),
        speed: round(Number(event.speed)),
      } : null,
    },
    'footfall.pulse': {
      value: footfall,
      source: 'stanceContact.stanceWidth.range + stanceContact.contactBalance',
    },
  };
}

function validateFeatures(features) {
  if (features?.schema !== GENERATED_POSE_FEATURES_SCHEMA) {
    throw new Error(`Expected ${GENERATED_POSE_FEATURES_SCHEMA}, got ${features?.schema || 'missing schema'}`);
  }
  if (features.ok !== true) {
    throw new Error(`Feature report is not ok: ${features.error || 'unknown feature failure'}`);
  }
}

try {
  phase = 'validating-args';
  if (!requestedFeaturesReport) throw new Error('Missing --features-report');
  if (!existsSync(effectiveFeaturesReport)) {
    fail(new Error(`Feature report does not exist: ${effectiveFeaturesReport}`), 'missing-source');
  }

  phase = 'reading-source';
  const featureReportSha256 = hashFile(effectiveFeaturesReport);
  const sourceStat = statSync(effectiveFeaturesReport);
  const features = JSON.parse(readFileSync(effectiveFeaturesReport, 'utf8'));
  lastEvidence = {
    source: {
      schema: features?.schema || null,
      effectivePath: effectiveFeaturesReport,
      featureReportSha256,
      sourceSizeBytes: sourceStat.size,
      sourceMtimeMs: sourceStat.mtimeMs,
      generatedMotionInput: features.effectiveInput || null,
      generatedMotionInputSha256: features.inputSha256 || null,
      sourceFormat: features.sourceFormat || null,
    },
  };

  phase = 'validating-source';
  validateFeatures(features);

  phase = 'mapping-sockets';
  const inputs = socketValues(features);
  const normalizedOutputs = mapOutputs(features, inputs);

  phase = 'complete';
  writeReport({
    ok: true,
    route: 'generated-pose-feature-output-map-v0',
    inputSockets,
    outputSockets,
    mappingEdges,
    inputValues: inputs,
    normalizedOutputs,
    summary: {
      strongestOutput: Object.entries(normalizedOutputs)
        .filter(([, value]) => Number.isFinite(value?.value))
        .sort((a, b) => b[1].value - a[1].value)[0]?.[0] || null,
      outputCount: outputSockets.length,
      edgeCount: mappingEdges.length,
    },
  });
} catch (error) {
  fail(error);
}

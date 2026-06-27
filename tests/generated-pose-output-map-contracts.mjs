import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const mapperPath = join(root, 'generated-pose-output-map.mjs');

assert.ok(existsSync(mapperPath), 'generated-pose-output-map.mjs must provide pose-feature-to-output socket mapping');

const mapper = readFileSync(mapperPath, 'utf8');

assert.match(mapper, /kaminos\.generated-pose-output-map\.v0/, 'mapper declares the output mapping schema');
assert.match(mapper, /kaminos\.generated-pose-features\.v0/, 'mapper consumes generated pose feature reports');
assert.match(mapper, /--features-report/, 'mapper accepts an explicit generated feature report path');
assert.match(mapper, /--out/, 'mapper writes a caller-owned output path');
assert.match(mapper, /featureReportSha256/, 'mapping report records source feature report identity');
assert.match(mapper, /inputSockets/, 'mapping report declares graph-displayable input sockets');
assert.match(mapper, /outputSockets/, 'mapping report declares graph-displayable output sockets');
assert.match(mapper, /mappingEdges/, 'mapping report declares graph-displayable mapping edges');
assert.match(mapper, /rootMetrics\.travelXZ/, 'mapping includes root travel input socket');
assert.match(mapper, /torsoFrame\.chestRootHorizontalLean\.range/, 'mapping includes torso lean input socket');
assert.match(mapper, /limbEnvelope\.handSpan\.range/, 'mapping includes limb envelope input socket');
assert.match(mapper, /eventSpikes\.0\.speed/, 'mapping includes event spike input socket');
assert.match(mapper, /orb\.rootOffset/, 'mapping includes orb root output socket');
assert.match(mapper, /body\.lean/, 'mapping includes body lean output socket');
assert.match(mapper, /aura\.radius/, 'mapping includes aura radius output socket');
assert.match(mapper, /trail\.accent/, 'mapping includes trail/accent output socket');
assert.match(mapper, /footfall\.pulse/, 'mapping includes footfall pulse output socket');
assert.match(mapper, /normalizedOutputs/, 'mapping report records normalized output values');
assert.match(mapper, /ok:\s*false/, 'mapper writes loud failure reports');
assert.match(mapper, /missing-source/, 'mapper reports missing-source failures distinctly');

const temp = mkdtempSync(join(tmpdir(), 'kaminos-pose-output-map-test-'));
const featuresPath = join(temp, 'features.json');
const outPath = join(temp, 'mapped.json');

writeFileSync(featuresPath, JSON.stringify({
  schema: 'kaminos.generated-pose-features.v0',
  ok: true,
  sourceFormat: 'kimodo-soma77-explicit-joints',
  effectiveInput: '/tmp/source-motion.npz',
  inputSha256: 'feature-source-sha',
  frameCount: 180,
  jointCount: 77,
  rootMetrics: { travelXZ: 0.55775, verticalRange: 0.09829 },
  torsoFrame: {
    chestRootHorizontalLean: { range: 0.13921 },
    headRootDistance: { range: 0.0598 },
  },
  limbEnvelope: {
    handSpan: { range: 1.28518 },
    maxHandSpeed: 1.75955,
  },
  stanceContact: {
    stanceWidth: { range: 0.50163 },
    leftContactRatio: 0.55,
    rightContactRatio: 1,
  },
  expansionCompression: {
    bboxVolume: { range: 1.95614 },
  },
  eventSpikes: [
    { channel: 'leftHand', speed: 1.75955, time: 3.5 },
  ],
}, null, 2));

const result = spawnSync('node', [mapperPath, '--features-report', featuresPath, '--out', outPath], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
const mapped = JSON.parse(readFileSync(outPath, 'utf8'));

assert.equal(mapped.schema, 'kaminos.generated-pose-output-map.v0');
assert.equal(mapped.ok, true);
assert.equal(mapped.source.schema, 'kaminos.generated-pose-features.v0');
assert.equal(mapped.source.effectivePath, featuresPath);
assert.ok(mapped.source.featureReportSha256.length >= 32, 'mapping records source report sha');
assert.ok(mapped.inputSockets.some(socket => socket.id === 'limbEnvelope.handSpan.range'), 'runtime report exposes hand span socket');
assert.ok(mapped.outputSockets.some(socket => socket.id === 'aura.radius'), 'runtime report exposes aura radius socket');
assert.ok(mapped.mappingEdges.some(edge => edge.from === 'limbEnvelope.handSpan.range' && edge.to === 'aura.radius'), 'runtime report exposes hand-span to aura edge');
assert.ok(mapped.normalizedOutputs['aura.radius'].value > mapped.normalizedOutputs['orb.rootOffset'].value, 'bow-like pose drives aura more than root travel');
assert.ok(mapped.normalizedOutputs['trail.accent'].event.channel === 'leftHand', 'event spike survives as accent evidence');

const missingPath = join(temp, 'missing.json');
const missing = spawnSync('node', [mapperPath, '--features-report', missingPath, '--out', join(temp, 'missing-out.json')], { encoding: 'utf8' });
assert.notEqual(missing.status, 0, 'missing source should fail');
const missingReport = JSON.parse(readFileSync(join(temp, 'missing-out.json'), 'utf8'));
assert.equal(missingReport.ok, false);
assert.equal(missingReport.failureKind, 'missing-source');

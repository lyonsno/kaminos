import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertSwingClearanceAssayReport,
  createSwingClearanceBodySideSet,
  createSwingClearanceCandidate,
  createSwingClearanceMaskSummary,
  SWING_CLEARANCE_ASSAY_ROUTE,
  SWING_CLEARANCE_SOURCE_HASH,
} from '../lirm-swing-clearance-assay-core.mjs';

assert.equal(
  SWING_CLEARANCE_ASSAY_ROUTE,
  'kaminos/lirm-719024/swing-clearance-static-operator-assay-v0',
);
assert.equal(
  SWING_CLEARANCE_SOURCE_HASH,
  'sha256:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
);

const positions = Float64Array.from([
  0, 0, 0,
  1, 0, 0,
  2, 0, 0,
  3, 0, 0,
  4, 0, 0,
]);
const probe = {
  id: 'rear-left',
  vertexIndices: Uint32Array.from([3, 4]),
  weights: Float64Array.from([0.5, 0.5]),
  carrier: {
    influenceVertexIndices: Uint32Array.from([2, 3, 4]),
    influenceWeights: Float64Array.from([0.1, 0.6, 1]),
    rigidCoreThreshold: 0.25,
    attachmentVertexIndices: Uint32Array.from([2]),
    attachmentWeights: Float64Array.from([1]),
  },
};

assert.deepEqual(createSwingClearanceMaskSummary(probe), {
  supportId: 'rear-left',
  supportVertexCount: 2,
  influenceVertexCount: 3,
  attachmentVertexCount: 1,
  supportVertexIndices: [3, 4],
  influenceVertexIndices: [2, 3, 4],
  attachmentVertexIndices: [2],
});

const bodySideSet = createSwingClearanceBodySideSet({
  positions,
  probes: [probe],
  probe,
  neighborsPerAttachment: 2,
});
assert.deepEqual(bodySideSet, {
    authority: 'nearest-outside-all-carrier-influence-regions',
    neighborsPerAttachment: 2,
    pairs: [
      { attachmentVertex: 2, bodyVertex: 1, sourceDistance: 1 },
      { attachmentVertex: 2, bodyVertex: 0, sourceDistance: 2 },
    ],
});

const translated = createSwingClearanceCandidate({
  family: 'translation',
  positions,
  indices: Uint32Array.from([0, 1, 2, 2, 3, 4]),
  probe,
  probes: [probe],
  terrainPoint: [0, 0, 0],
  terrainNormal: [0, 1, 0],
  targetClearance: 0.008,
  maximumTranslation: 0.035,
  bodySideSet,
});
assert.equal(translated.family, 'translation');
assert.equal(translated.rotationRadians, 0);
assert.equal(translated.appliedTranslation, 0.008);
assert.deepEqual(
  Array.from(translated.positions),
  [0, 0, 0, 1, 0, 0, 2, 0.002816000000000001, 0, 3, 0.008, 0, 4, 0.008, 0],
);
assert.equal(translated.clearance.minimum, 0.008);
assert.equal(translated.clearance.passes, true);
assert.equal(translated.deformation.flippedTriangleCount, 0);
assert.ok(Number.isFinite(translated.collar.maximumAbsoluteLogDistanceDistortion));

const validReport = {
  schema: 'kaminos.lirm-swing-clearance-assay-report.v0',
  status: 'complete',
  requestedRoute: SWING_CLEARANCE_ASSAY_ROUTE,
  effectiveRoute: SWING_CLEARANCE_ASSAY_ROUTE,
  sourceHash: SWING_CLEARANCE_SOURCE_HASH,
  actualSourceHash: SWING_CLEARANCE_SOURCE_HASH,
  supportId: 'rear-left',
  inputHashes: {
    contactAtlas: 'sha256:e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
    registration: 'sha256:a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9',
  },
  masks: createSwingClearanceMaskSummary(probe),
  candidates: [
    { family: 'source', clearance: { minimum: -0.1 } },
    { family: 'translation', clearance: { minimum: 0.01 } },
    { family: 'minimum-rotation', clearance: { minimum: 0.012 } },
  ],
};
assert.equal(assertSwingClearanceAssayReport(validReport), validReport);
for (const [name, mutate, pattern] of [
  ['fallback route', report => { report.effectiveRoute = 'fallback'; }, /route mismatch/],
  ['stale source', report => { report.actualSourceHash = 'stale'; }, /source identity/],
  ['wrong support', report => { report.supportId = 'front-left'; }, /support identity/],
  ['missing mask', report => { report.masks.attachmentVertexIndices = []; }, /mask identity/],
  ['missing candidate', report => { report.candidates.pop(); }, /candidate families/],
]) {
  const report = structuredClone(validReport);
  mutate(report);
  assert.throws(() => assertSwingClearanceAssayReport(report), pattern, name);
}

const inspector = await readFile(
  new URL('../lirm-swing-clearance-inspector.html', import.meta.url),
  'utf8',
);
for (const contract of [
  'kaminos/lirm-719024/swing-clearance-static-operator-assay-v0',
  '__LIRM_SWING_CLEARANCE_STATE__',
  '__setLirmSwingClearanceVariant',
  '__setLirmSwingClearanceOverlay',
  '__setLirmSwingClearanceView',
  'rear-left',
  'Textured',
  'Masks',
  'Clearance',
  'Distortion',
  'Three-quarter',
  'Profile',
  'Underside',
  'Collar close-up',
  'support patch',
  'influence region',
  'attachment collar',
]) {
  assert.match(inspector, new RegExp(contract), `swing-clearance inspector is missing ${contract}`);
}
assert.doesNotMatch(
  inspector,
  /requestAnimationFrame\s*\(\s*animate\s*\)/,
  'static swing-clearance assay must not begin temporal playback',
);

process.stdout.write('lirm swing-clearance assay contracts passed\n');

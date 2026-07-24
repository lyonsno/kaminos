import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createSupportPlacedFittedRig,
  evaluatePublishedStationaryContactPhase,
  verifyPublishedStationaryContactArtifacts,
} from '../lirm-stationary-hill-contact-core.mjs';
import {
  locateEditablePrimitive,
  normalizePositions,
  parseGlb,
  readAccessor,
} from '../lirm-smooth-fitted-proxy-rig-assay.mjs';

const root = new URL('../', import.meta.url);
const [
  sourceBytes,
  registration,
  contactAtlas,
  phaseReport,
  handshake,
  constraintsBytes,
  receiptBytes,
  assetRegistration,
] = await Promise.all([
  readFile(new URL('artifacts/motion-ready-719024/creature.glb', root)),
  readFile(
    new URL('artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/report.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/lirm-719024-motion-contact-probe-handshake-v0/stationary-hill-request-response.json', root),
    'utf8',
  ).then(JSON.parse),
  readFile(
    new URL('artifacts/motion-ready-719024/stationary-contact-constraints/constraints.json', root),
  ),
  readFile(
    new URL('artifacts/motion-ready-719024/stationary-contact-constraints/receipt.json', root),
  ),
  readFile(
    new URL('artifacts/motion-ready-719024/registration.json', root),
    'utf8',
  ).then(JSON.parse),
]);

const { json, binary } = parseGlb(sourceBytes);
const primitive = locateEditablePrimitive(json);
const sourcePositions = readAccessor(
  json,
  binary,
  primitive.attributes.POSITION,
  'VEC3',
).values;
const normalization = normalizePositions(sourcePositions);
const placedRig = createSupportPlacedFittedRig({
  normalizedPositions: normalization.values,
  registration,
  normalization,
  bodyScale: handshake.prepass.body.scale,
  contactAtlas,
  contactAtlasSha256: phaseReport.contactAtlas.sha256,
  sampleCount: phaseReport.effectiveConfig.curveSampleCount,
});
const publication = await verifyPublishedStationaryContactArtifacts({
  constraintsBytes,
  receiptBytes,
});

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)];
}

function pointDistance(positions, left, right) {
  return Math.hypot(
    positions[left * 3] - positions[right * 3],
    positions[left * 3 + 1] - positions[right * 3 + 1],
    positions[left * 3 + 2] - positions[right * 3 + 2],
  );
}

function deterministicRegionSample(patch, minimumCarrierWeight = 0.25, sampleCount = 48) {
  assert.equal(
    patch.influenceVertexIndices.length,
    patch.influenceWeights.length,
    `${patch.id} influence region must align`,
  );
  const region = patch.influenceVertexIndices.filter(
    (_, index) => patch.influenceWeights[index] >= minimumCarrierWeight,
  );
  assert.ok(region.length >= sampleCount, `${patch.id} appendage region is undersampled`);
  const stride = Math.max(1, Math.floor(region.length / sampleCount));
  return region.filter((_, index) => index % stride === 0).slice(0, sampleCount);
}

const regions = new Map(contactAtlas.patches.map(
  patch => [patch.id, deterministicRegionSample(patch)],
));
const ratiosByPatch = new Map([...regions.keys()].map(id => [id, []]));

for (let frame = 0; frame < 24; frame += 1) {
  const packet = evaluatePublishedStationaryContactPhase({
    placedRig,
    prepass: handshake.prepass,
    publication,
    bodyPhase: frame / 24,
    amplitude: phaseReport.effectiveConfig.amplitude,
    contactPlaneY: assetRegistration.contactPlaneY,
    includeBaseline: true,
  });
  for (const [id, vertices] of regions) {
    const ratios = ratiosByPatch.get(id);
    for (let left = 0; left < vertices.length; left += 1) {
      for (let right = left + 1; right < vertices.length; right += 1) {
        const baselineDistance = pointDistance(
          packet.baseline.bodyPositions,
          vertices[left],
          vertices[right],
        );
        if (baselineDistance <= 1e-4) continue;
        ratios.push(
          pointDistance(
            packet.realized.bodyPositions,
            vertices[left],
            vertices[right],
          ) / baselineDistance,
        );
      }
    }
  }
}

const localShape = Object.fromEntries([...ratiosByPatch].map(([id, ratios]) => [
  id,
  {
    lowerRetention: percentile(ratios, 0.05),
    medianRetention: percentile(ratios, 0.5),
    pairSampleCount: ratios.length,
  },
]));

for (const id of ['front-left', 'front-right']) {
  assert.ok(
    localShape[id].lowerRetention >= 0.82,
    `${id} positive-control lower local-shape retention collapsed: ${localShape[id].lowerRetention}`,
  );
  assert.ok(
    localShape[id].medianRetention >= 0.96,
    `${id} positive-control median local-shape retention collapsed: ${localShape[id].medianRetention}`,
  );
}

for (const id of ['rear-left', 'rear-right']) {
  assert.ok(
    localShape[id].lowerRetention >= 0.82,
    `${id} lower local-shape retention collapsed: ${localShape[id].lowerRetention}`,
  );
  assert.ok(
    localShape[id].medianRetention >= 0.94,
    `${id} median local-shape retention collapsed: ${localShape[id].medianRetention}`,
  );
}

process.stdout.write(`${JSON.stringify(localShape, null, 2)}\n`);
process.stdout.write('lirm 719024 appendage local-shape contracts passed\n');

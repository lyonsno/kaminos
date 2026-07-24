#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMotionContactProbeRequest,
  resolveMotionContactConstraints,
  solveMotionSupportPrepass,
} from '../motion-support-core.js';
import {
  createAxialBodySupportFootprint,
  createHillMotionSupportIdentity,
  createHillSampledSupportSurface,
} from '../hill-motion-support-adapter.js';
import {
  sampleHillTerrainSurface,
  solveAxialTerrainSupportEnvelope,
  validateAxialCrawlerRegistration,
} from '../motion-ready-719024-core.js';
import { decodeHillMotionAffordancePacket } from '../motion-core.js';

const root = new URL('../', import.meta.url);
const packet = JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/hill/motion-affordance-packet.json', root),
  'utf8',
));
const data = JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/hill/motion-affordance-data.json', root),
  'utf8',
));
const registration = validateAxialCrawlerRegistration(JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/registration.json', root),
  'utf8',
)));
const atlas = JSON.parse(await readFile(
  new URL('artifacts/motion-ready-719024/contact-atlas.json', root),
  'utf8',
));
const hillSource = decodeHillMotionAffordancePacket({ packet, data });
const hillIdentity = createHillMotionSupportIdentity(packet);
const surface = createHillSampledSupportSurface(hillSource, hillIdentity);
const footprint = createAxialBodySupportFootprint(registration, {
  id: 'motion-ready-719024:axial-footprint',
  registrationId: 'motion-ready-719024:registration:cb519913ad863441',
  scale: 1.14,
});

assert.equal(surface.schema, 'kaminos.sampled-support-surface.v0');
assert.equal(surface.kind, 'single-valued-heightfield');
assert.equal(surface.identity.id, hillIdentity.id);
assert.equal(surface.identity.revision, hillIdentity.revision);
assert.equal(typeof surface.sample, 'function');
assert.equal(footprint.schema, 'kaminos.motion-support-footprint.v0');
assert.equal(footprint.stations.length, registration.spineStations.length + 2);
assert.ok(footprint.halfWidth > 0);

const bounds = hillSource.worldBounds;
const rootSurface = [
  bounds.x.min + (bounds.x.max - bounds.x.min) * 0.54,
  0,
  bounds.z.min + (bounds.z.max - bounds.z.min) * 0.43,
];
rootSurface[1] = sampleHillTerrainSurface(hillSource, rootSurface[0], rootSurface[2]).height;
const supportOptions = {
  id: 'stationary-hill-prepass',
  rootSurface,
  forward: [0.77, 0, -0.64],
  clearance: 0.018,
  lateralExcursion: 0.1,
  maxPitchRadians: Math.PI / 5,
  maxBendRadiansPerStation: Math.PI / 10,
  maxSuspensionLift: 0.114,
  expectedSurfaceRevision: hillIdentity.revision,
};
const legacy = solveAxialTerrainSupportEnvelope(hillSource, registration, {
  ...supportOptions,
  scale: footprint.scale,
});
const prepass = solveMotionSupportPrepass(surface, footprint, supportOptions);

assert.equal(prepass.schema, 'kaminos.motion-support-prepass.v0');
assert.equal(prepass.authority, 'world-space-support-only');
assert.deepEqual(prepass.supportSurface, surface.identity);
assert.equal(prepass.body.id, footprint.id);
assert.equal(prepass.support.plannerDisposition, legacy.plannerDisposition);
assert.ok(Math.abs(prepass.support.rootLift - legacy.rootLift) < 1e-10);
assert.deepEqual(
  prepass.support.profile.map(sample => sample.stationId),
  legacy.profile.map(sample => sample.stationId),
);
for (let index = 0; index < legacy.profile.length; index++) {
  assert.ok(
    Math.abs(prepass.support.profile[index].localOffset - legacy.profile[index].localOffset) < 1e-10,
    `portable support profile diverged at ${legacy.profile[index].stationId}`,
  );
}
assert.ok(
  Math.abs(
    prepass.support.compliance.minimumNormalizedMargin
      - legacy.compliance.minimumNormalizedMargin,
  ) < 1e-10,
);

assert.throws(
  () => solveMotionSupportPrepass(surface, footprint, {
    ...supportOptions,
    expectedSurfaceRevision: 'stale-revision',
  }),
  /support surface revision mismatch/,
  'a stale terrain revision must not silently satisfy a requested support prepass',
);

const railRoots = [
  [rootSurface[0] - 0.18, 0, rootSurface[2] - 0.1],
  rootSurface,
  [rootSurface[0] + 0.2, 0, rootSurface[2] + 0.12],
];
const railPrepasses = railRoots.map((rootPoint, index) => {
  const sampled = surface.sample(rootPoint[0], rootPoint[2]);
  return solveMotionSupportPrepass(surface, footprint, {
    ...supportOptions,
    id: `short-rail-prepass:${index}`,
    rootSurface: sampled.world,
    forward: index === railRoots.length - 1 ? [0.85, 0, 0.53] : [0.87, 0, 0.49],
  });
});
assert.ok(railPrepasses.every(result => result.support.samples.length >= footprint.stations.length));
assert.ok(railPrepasses.every(result => Number.isFinite(result.support.rootLift)));
assert.ok(
  railPrepasses.every(result => result.supportSurface.revision === hillIdentity.revision),
  'every short-rail prepass must retain the effective terrain revision',
);

const request = createMotionContactProbeRequest(prepass, atlas, {
  id: 'stationary-hill-probes:C',
  phase: 1.3,
  poseId: 'molten-low-frequency:C',
});
assert.equal(request.schema, 'kaminos.motion-contact-probe-request.v0');
assert.equal(request.authority, 'probe-request-only');
assert.equal(request.patches.length, 4);
assert.deepEqual(request.patches.map(patch => patch.id), atlas.patches.map(patch => patch.id));

const probeSet = {
  schema: 'kaminos.motion-contact-probe-set.v0',
  requestId: request.id,
  prepassId: request.prepassId,
  supportSurface: { ...request.supportSurface },
  body: { ...request.body },
  contactAtlas: { ...request.contactAtlas },
  poseId: request.poseId,
  phase: request.phase,
  patches: request.patches.map((patch, index) => {
    const longitudinal = index < 2 ? -0.31 : 0.31;
    const lateral = index % 2 === 0 ? footprint.halfWidth * 0.72 : -footprint.halfWidth * 0.72;
    const x = prepass.rootSurface[0]
      + prepass.frame.forward[0] * longitudinal
      + prepass.frame.right[0] * lateral;
    const z = prepass.rootSurface[2]
      + prepass.frame.forward[2] * longitudinal
      + prepass.frame.right[2] * lateral;
    const terrain = surface.sample(x, z);
    return {
      id: patch.id,
      worldPosition: [x, terrain.world[1] + 0.012 + index * 0.004, z],
    };
  }),
};
const constraints = resolveMotionContactConstraints(surface, prepass, request, probeSet);
assert.equal(constraints.schema, 'kaminos.motion-contact-constraints.v0');
assert.equal(constraints.authority, 'world-space-contact-resolution');
assert.equal(constraints.patches.length, request.patches.length);
assert.ok(constraints.patches.every(patch => patch.terrainPoint.every(Number.isFinite)));
assert.ok(constraints.patches.every(patch => patch.terrainNormal.every(Number.isFinite)));
assert.ok(constraints.patches.every(patch => Number.isFinite(patch.signedDistance)));
assert.ok(constraints.patches.some(patch => patch.contactState === 'stance'));
assert.ok(constraints.patches.some(patch => patch.contactState === 'swing'));
assert.ok(
  constraints.patches.every(patch => !('vertexIndices' in patch) && !('deformedPositions' in patch)),
  'contact resolution must not smuggle vertex deformation across the ownership boundary',
);

for (const malformed of [
  {
    ...probeSet,
    requestId: 'wrong-request',
  },
  {
    ...probeSet,
    supportSurface: { ...probeSet.supportSurface, revision: 'stale-revision' },
  },
  {
    ...probeSet,
    body: { ...probeSet.body, id: 'wrong-body' },
  },
  {
    ...probeSet,
    contactAtlas: { ...probeSet.contactAtlas, castHash: 'wrong-atlas' },
  },
  {
    ...probeSet,
    phase: probeSet.phase + 0.1,
  },
  {
    ...probeSet,
    patches: probeSet.patches.slice(0, -1),
  },
  {
    ...probeSet,
    patches: [...probeSet.patches, probeSet.patches[0]],
  },
]) {
  assert.throws(
    () => resolveMotionContactConstraints(surface, prepass, request, malformed),
    /mismatch|exactly|duplicate|missing/,
  );
}

const outsideProbeSet = structuredClone(probeSet);
outsideProbeSet.patches[0].worldPosition[0] = bounds.x.max + 10;
assert.throws(
  () => resolveMotionContactConstraints(surface, prepass, request, outsideProbeSet),
  /outside the admitted support surface/,
  'clamped fallback terrain must not masquerade as valid contact evidence',
);

const portableCore = await import('../motion-support-core.js');
for (const forbiddenExport of [
  'applyCrawlerContactPatchDeformation',
  'deformAxialGeometryBinding',
  'deformVertices',
]) {
  assert.equal(
    portableCore[forbiddenExport],
    undefined,
    `${forbiddenExport} must remain outside the portable support/contact boundary`,
  );
}

console.log('motion support boundary contracts passed');

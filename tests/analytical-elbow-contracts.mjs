import assert from 'node:assert/strict';

import {
  ANALYTICAL_ELBOW_DESCRIPTOR_SCHEMA,
  ANALYTICAL_ELBOW_EXPORT_SCHEMA,
  ANALYTICAL_ELBOW_POSE_SCHEMA,
  createAnalyticalElbowConsumerExport,
  createAnalyticalElbowDescriptor,
  solveAnalyticalElbowPose,
} from '../analytical-elbow-core.mjs';

function distance(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function attachmentById(descriptor, id) {
  const attachment = descriptor.attachments.find(candidate => candidate.id === id);
  assert.ok(attachment, `missing attachment ${id}`);
  return attachment;
}

function segmentById(value, id) {
  const segment = value.segments.find(candidate => candidate.id === id);
  assert.ok(segment, `missing segment ${id}`);
  return segment;
}

function processById(segment, id) {
  assert.ok(Array.isArray(segment.processes), `segment ${segment.id} has no skeletal process collection`);
  const process = segment.processes.find(candidate => candidate.id === id);
  assert.ok(process, `missing skeletal process ${id}`);
  return process;
}

function muscleById(pose, id) {
  const muscle = pose.muscles.find(candidate => candidate.id === id);
  assert.ok(muscle, `missing muscle ${id}`);
  return muscle;
}

const descriptor = createAnalyticalElbowDescriptor();
assert.equal(descriptor.schema, ANALYTICAL_ELBOW_DESCRIPTOR_SCHEMA);
assert.deepEqual(descriptor.authority, {
  kind: 'synthetic-proxy',
  anatomicalAdmission: 'structural-hypothesis',
});
assert.equal(descriptor.joint.id, 'elbow-hinge');
assert.equal(descriptor.joint.parentSegmentId, 'humerus');
assert.equal(descriptor.joint.childSegmentId, 'ulna');
assert.deepEqual(descriptor.joint.axis, [0, 0, 1]);
assert.deepEqual(
  descriptor.muscles.map(muscle => muscle.id),
  ['brachialis-like-flexor', 'monoarticular-triceps-like-extensor'],
);

const descriptorUlna = segmentById(descriptor, 'ulna');
const olecranon = processById(descriptorUlna, 'olecranon-process');
const tricepsInsertion = attachmentById(descriptor, 'triceps-insertion');
assert.equal(olecranon.kind, 'attachment-bearing-capsule');
assert.equal(olecranon.attachmentId, tricepsInsertion.id);
assert.deepEqual(
  olecranon.localEnd,
  tricepsInsertion.localPosition,
  'olecranon tip and triceps insertion must share exact ulna-local authority',
);
assert.ok(
  olecranon.localStart[1] < descriptor.joint.pivot[1],
  'olecranon must emerge from the forearm side of the hinge',
);
assert.ok(
  olecranon.localEnd[0] < descriptor.joint.pivot[0],
  'olecranon tip must establish a posterior extensor lever arm',
);

for (const muscle of descriptor.muscles) {
  const origin = attachmentById(descriptor, muscle.originAttachmentId);
  const insertion = attachmentById(descriptor, muscle.insertionAttachmentId);
  assert.notEqual(
    origin.segmentId,
    insertion.segmentId,
    `${muscle.id} must cross the elbow hinge`,
  );
  assert.equal(muscle.volumeAuthority, 'authored-target');
  assert.ok(muscle.targetVolume > 0);
}

const malformed = structuredClone(descriptor);
malformed.attachments = malformed.attachments.filter(
  attachment => attachment.id !== 'brachialis-insertion',
);
assert.throws(
  () => solveAnalyticalElbowPose(malformed, { flexionDegrees: 30 }),
  /unknown insertion attachment brachialis-insertion/,
);

const emptyMuscles = structuredClone(descriptor);
emptyMuscles.muscles = [];
assert.throws(
  () => solveAnalyticalElbowPose(emptyMuscles, { flexionDegrees: 35 }),
  /analytical elbow descriptor requires at least one muscle/,
);
assert.throws(
  () => createAnalyticalElbowConsumerExport(emptyMuscles, {
    flexionDegrees: [0, 35, 80],
  }),
  /analytical elbow descriptor requires at least one muscle/,
);

const malformedNumerics = [
  {
    label: 'non-finite joint core',
    mutate(candidate) {
      candidate.joint.protectedCoreRadius = Number.NaN;
    },
    error: /joint protectedCoreRadius must be positive and finite/,
  },
  {
    label: 'unsupported hinge axis',
    mutate(candidate) {
      candidate.joint.axis = [1, 0, 0];
    },
    error: /only supports authored hinge axis \[0,0,1\]/,
  },
  {
    label: 'non-finite route offset',
    mutate(candidate) {
      candidate.muscles[0].routing.lateralOffset = Number.NaN;
    },
    error: /routing lateralOffset must be finite/,
  },
  {
    label: 'non-finite tendon ratio',
    mutate(candidate) {
      candidate.muscles[0].profile.tendonRatio = Number.NaN;
    },
    error: /profile tendonRatio must be positive and finite/,
  },
  {
    label: 'collapsed belly power',
    mutate(candidate) {
      candidate.muscles[1].profile.bellyPower = 0;
    },
    error: /profile bellyPower must be positive and finite/,
  },
];

for (const malformedNumeric of malformedNumerics) {
  const candidate = structuredClone(descriptor);
  malformedNumeric.mutate(candidate);
  assert.throws(
    () => solveAnalyticalElbowPose(candidate, { flexionDegrees: 35 }),
    malformedNumeric.error,
    `malformed descriptor was accepted: ${malformedNumeric.label}`,
  );
}

const malformedProcessGeometry = structuredClone(descriptor);
processById(
  segmentById(malformedProcessGeometry, 'ulna'),
  'olecranon-process',
).radius = Number.NaN;
assert.throws(
  () => solveAnalyticalElbowPose(malformedProcessGeometry, { flexionDegrees: 35 }),
  /skeletal process olecranon-process has invalid geometry/,
);

const malformedProcessAttachment = structuredClone(descriptor);
processById(
  segmentById(malformedProcessAttachment, 'ulna'),
  'olecranon-process',
).attachmentId = 'brachialis-origin';
assert.throws(
  () => solveAnalyticalElbowPose(malformedProcessAttachment, { flexionDegrees: 35 }),
  /skeletal process olecranon-process attachment brachialis-origin belongs to humerus, expected ulna/,
);

const detachedProcessTip = structuredClone(descriptor);
processById(
  segmentById(detachedProcessTip, 'ulna'),
  'olecranon-process',
).localEnd = [-0.28, 0.24, 0];
assert.throws(
  () => solveAnalyticalElbowPose(detachedProcessTip, { flexionDegrees: 35 }),
  /skeletal process olecranon-process does not terminate at attachment triceps-insertion/,
);

const overflowing = structuredClone(descriptor);
overflowing.muscles[0].routing.lateralOffset = Number.MAX_VALUE;
assert.throws(
  () => solveAnalyticalElbowPose(overflowing, { flexionDegrees: 35 }),
  /analytical elbow emitted non-finite/,
  'finite descriptor values that overflow the solve must fail before admission',
);

const poses = [0, 35, 80].map(flexionDegrees =>
  solveAnalyticalElbowPose(descriptor, { flexionDegrees, pathSampleCount: 25 }),
);

for (const pose of poses) {
  assert.equal(pose.schema, ANALYTICAL_ELBOW_POSE_SCHEMA);
  assert.equal(pose.sourceId, descriptor.id);
  assert.equal(pose.requestedFlexionDegrees, pose.effectiveFlexionDegrees);
  assert.equal(pose.muscles.length, 2);
  assert.equal(pose.metrics.unresolvedAttachmentCount, 0);
  assert.equal(pose.metrics.clearanceViolationCount, 0);
  assert.equal(pose.metrics.materialIdentityViolationCount, 0);

  for (const muscle of pose.muscles) {
    const specification = descriptor.muscles.find(item => item.id === muscle.id);
    assert.ok(specification);
    assert.equal(muscle.path.length, 25);
    assert.equal(muscle.cage.ringCount, 25);
    assert.equal(muscle.cage.radialSegmentCount, 8);
    assert.equal(muscle.cage.vertices.length, 25 * 8);
    assert.equal(muscle.cage.quads.length, 24 * 8);
    assert.ok(muscle.metrics.minimumProtectedCoreClearance >= -1e-8);
    assert.ok(muscle.metrics.volumeRelativeError < 1e-10);
    assert.ok(
      Math.abs(muscle.metrics.realizedVolume - specification.targetVolume) < 1e-10,
    );
  }
}

const extension = poses[0];
const flexorAtExtension = muscleById(extension, 'brachialis-like-flexor');
const extensorAtExtension = muscleById(
  extension,
  'monoarticular-triceps-like-extensor',
);
assert.ok(
  flexorAtExtension.routeHandleWorld[0] > 0.25,
  'flexor must route around the anterior side of the joint',
);
assert.ok(
  extensorAtExtension.routeHandleWorld[0] < -0.25,
  'extensor must wrap around the posterior side of the joint',
);

for (const pose of poses) {
  for (const muscle of pose.muscles) {
    assert.deepEqual(
      muscle.path.map(sample => sample.materialId),
      extension.muscles
        .find(candidate => candidate.id === muscle.id)
        .path.map(sample => sample.materialId),
      `${muscle.id} material identities changed with pose`,
    );
    assert.deepEqual(
      muscle.cage.vertices.map(vertex => vertex.material),
      extension.muscles
        .find(candidate => candidate.id === muscle.id)
        .cage.vertices.map(vertex => vertex.material),
      `${muscle.id} cage material coordinates changed with pose`,
    );
  }
}

const flexed = poses.at(-1);
const flexedUlna = segmentById(flexed, 'ulna');
const expectedInsertion = flexedUlna.attachments.find(
  attachment => attachment.id === 'brachialis-insertion',
);

const flexedOlecranon = processById(flexedUlna, 'olecranon-process');
const expectedTricepsInsertion = flexedUlna.attachments.find(
  attachment => attachment.id === 'triceps-insertion',
);
assert.ok(expectedTricepsInsertion);
assert.ok(
  distance(flexedOlecranon.worldEnd, expectedTricepsInsertion.worldPosition) < 1e-12,
  'posed olecranon tip must remain coincident with the triceps insertion',
);
assert.notDeepEqual(
  processById(segmentById(extension, 'ulna'), 'olecranon-process').worldStart,
  flexedOlecranon.worldStart,
  'ulna-owned olecranon process did not articulate with the ulna',
);
assert.ok(expectedInsertion);
assert.ok(
  distance(
    muscleById(flexed, 'brachialis-like-flexor').insertionWorld,
    expectedInsertion.worldPosition,
  ) < 1e-12,
  'muscle insertion must follow the authored child-segment attachment exactly',
);

assert.notDeepEqual(
  muscleById(extension, 'brachialis-like-flexor').insertionWorld,
  muscleById(flexed, 'brachialis-like-flexor').insertionWorld,
  'child-segment attachment did not articulate',
);

assert.deepEqual(
  solveAnalyticalElbowPose(descriptor, {
    flexionDegrees: 35,
    pathSampleCount: 25,
  }),
  poses[1],
  'analytical elbow solve must be deterministic',
);

const consumerExport = createAnalyticalElbowConsumerExport(descriptor, {
  flexionDegrees: [0, 35, 80],
  pathSampleCount: 25,
  requestedRoute: 'analytical-cage',
});
assert.equal(consumerExport.schema, ANALYTICAL_ELBOW_EXPORT_SCHEMA);
assert.equal(consumerExport.sourceId, descriptor.id);
assert.equal(consumerExport.requestedRoute, 'analytical-cage');
assert.equal(consumerExport.effectiveRoute, 'analytical-cage');
assert.equal(consumerExport.fallbackUsed, false);
assert.deepEqual(
  consumerExport.poses.map(pose => pose.effectiveFlexionDegrees),
  [0, 35, 80],
);

assert.throws(
  () => createAnalyticalElbowConsumerExport(descriptor, {
    flexionDegrees: [0, 35],
    requestedRoute: 'mesh-skinning',
  }),
  /unsupported analytical elbow route mesh-skinning/,
);

console.log('analytical elbow contracts passed');

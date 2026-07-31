export const ANALYTICAL_ELBOW_DESCRIPTOR_SCHEMA =
  'kaminos.analytical-elbow-descriptor.v0';
export const ANALYTICAL_ELBOW_POSE_SCHEMA =
  'kaminos.analytical-elbow-pose.v0';
export const ANALYTICAL_ELBOW_EXPORT_SCHEMA =
  'kaminos.analytical-elbow-consumer-export.v0';

const TWO_PI = Math.PI * 2;

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function scale(vector, amount) {
  return vector.map(value => value * amount);
}

function length(vector) {
  return Math.hypot(...vector);
}

function normalize(vector) {
  const magnitude = length(vector);
  if (magnitude <= 1e-12) {
    throw new Error('analytical elbow encountered a degenerate direction');
  }
  return scale(vector, 1 / magnitude);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function distance(left, right) {
  return length(subtract(left, right));
}

function rotateAroundZ(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    point[0] * cosine - point[1] * sine,
    point[0] * sine + point[1] * cosine,
    point[2],
  ];
}

function quadraticBezier(start, control, end, t) {
  const oneMinusT = 1 - t;
  return add(
    add(
      scale(start, oneMinusT * oneMinusT),
      scale(control, 2 * oneMinusT * t),
    ),
    scale(end, t * t),
  );
}

function isFinitePoint(value) {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every(Number.isFinite);
}

function validateDescriptor(descriptor) {
  if (descriptor?.schema !== ANALYTICAL_ELBOW_DESCRIPTOR_SCHEMA) {
    throw new Error('unsupported analytical elbow descriptor schema');
  }
  if (descriptor.authority?.kind !== 'synthetic-proxy') {
    throw new Error('analytical elbow descriptor requires explicit proxy authority');
  }
  if (!isFinitePoint(descriptor.joint?.pivot) ||
      !isFinitePoint(descriptor.joint?.axis)) {
    throw new Error('analytical elbow joint requires finite pivot and axis points');
  }
  const segments = new Map(descriptor.segments.map(segment => [segment.id, segment]));
  if (!segments.has(descriptor.joint.parentSegmentId) ||
      !segments.has(descriptor.joint.childSegmentId)) {
    throw new Error('analytical elbow joint references an unknown segment');
  }
  for (const segment of descriptor.segments) {
    if (!isFinitePoint(segment.bone?.start) ||
        !isFinitePoint(segment.bone?.end) ||
        !Number.isFinite(segment.bone?.protectedCoreRadius) ||
        segment.bone.protectedCoreRadius <= 0) {
      throw new Error(`segment ${segment.id} has an invalid protected bone core`);
    }
  }
  const attachments = new Map(
    descriptor.attachments.map(attachment => [attachment.id, attachment]),
  );
  for (const attachment of descriptor.attachments) {
    if (!segments.has(attachment.segmentId) || !isFinitePoint(attachment.localPosition)) {
      throw new Error(`attachment ${attachment.id} has invalid segment authority`);
    }
  }
  for (const muscle of descriptor.muscles) {
    if (!attachments.has(muscle.originAttachmentId)) {
      throw new Error(`unknown origin attachment ${muscle.originAttachmentId}`);
    }
    if (!attachments.has(muscle.insertionAttachmentId)) {
      throw new Error(`unknown insertion attachment ${muscle.insertionAttachmentId}`);
    }
    if (!Number.isFinite(muscle.targetVolume) || muscle.targetVolume <= 0) {
      throw new Error(`muscle ${muscle.id} requires a positive target volume`);
    }
    if (!['anterior', 'posterior'].includes(muscle.routing?.side) ||
        !Number.isFinite(muscle.routing?.radius) ||
        muscle.routing.radius <= descriptor.joint.protectedCoreRadius) {
      throw new Error(`muscle ${muscle.id} has invalid routing authority`);
    }
  }
  return { segments, attachments };
}

function segmentPointToWorld(segmentId, localPosition, angle, descriptor) {
  if (segmentId === descriptor.joint.parentSegmentId) {
    return [...localPosition];
  }
  if (segmentId === descriptor.joint.childSegmentId) {
    return add(
      descriptor.joint.pivot,
      rotateAroundZ(subtract(localPosition, descriptor.joint.pivot), angle),
    );
  }
  throw new Error(`unsupported analytical elbow segment ${segmentId}`);
}

function routeHandle(muscle, angle, pivot) {
  const halfAngle = angle / 2;
  const sign = muscle.routing.side === 'anterior' ? 1 : -1;
  return add(pivot, [
    sign * muscle.routing.radius * Math.cos(halfAngle),
    sign * muscle.routing.radius * Math.sin(halfAngle),
    muscle.routing.lateralOffset,
  ]);
}

function sampleRoutedPath({ origin, insertion, handle, sampleCount, muscleId }) {
  // Choose the Bezier control so the authored route handle is the exact midpoint.
  const control = subtract(scale(handle, 2), scale(add(origin, insertion), 0.5));
  return Array.from({ length: sampleCount }, (_, index) => {
    const u = index / (sampleCount - 1);
    return {
      materialId: `${muscleId}:path:${index}`,
      u,
      position: quadraticBezier(origin, control, insertion, u),
    };
  });
}

function frustumVolume(path, radii) {
  let volume = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segmentLength = distance(path[index].position, path[index + 1].position);
    const startRadius = radii[index];
    const endRadius = radii[index + 1];
    volume += Math.PI * segmentLength *
      (startRadius ** 2 + startRadius * endRadius + endRadius ** 2) / 3;
  }
  return volume;
}

function volumeMatchedRadii(path, muscle) {
  const unscaled = path.map(sample =>
    muscle.profile.tendonRatio +
      Math.sin(Math.PI * sample.u) ** muscle.profile.bellyPower,
  );
  const unscaledVolume = frustumVolume(path, unscaled);
  const radiusScale = Math.sqrt(muscle.targetVolume / unscaledVolume);
  const radii = unscaled.map(radius => radius * radiusScale);
  return {
    radii,
    radiusScale,
    realizedVolume: frustumVolume(path, radii),
  };
}

function createCage(path, radii, muscleId, radialSegmentCount) {
  const vertices = [];
  for (let ringIndex = 0; ringIndex < path.length; ringIndex += 1) {
    const previous = path[Math.max(0, ringIndex - 1)].position;
    const next = path[Math.min(path.length - 1, ringIndex + 1)].position;
    const tangent = normalize(subtract(next, previous));
    const binormal = [0, 0, 1];
    const normal = normalize(cross(binormal, tangent));
    for (let radialIndex = 0; radialIndex < radialSegmentCount; radialIndex += 1) {
      const theta = radialIndex / radialSegmentCount;
      const radialDirection = add(
        scale(normal, Math.cos(theta * TWO_PI)),
        scale(binormal, Math.sin(theta * TWO_PI)),
      );
      vertices.push({
        id: `${muscleId}:cage:${ringIndex}:${radialIndex}`,
        position: add(path[ringIndex].position, scale(radialDirection, radii[ringIndex])),
        material: {
          muscleId,
          u: path[ringIndex].u,
          theta,
        },
      });
    }
  }
  const quads = [];
  for (let ringIndex = 0; ringIndex < path.length - 1; ringIndex += 1) {
    for (let radialIndex = 0; radialIndex < radialSegmentCount; radialIndex += 1) {
      const nextRadial = (radialIndex + 1) % radialSegmentCount;
      quads.push([
        ringIndex * radialSegmentCount + radialIndex,
        (ringIndex + 1) * radialSegmentCount + radialIndex,
        (ringIndex + 1) * radialSegmentCount + nextRadial,
        ringIndex * radialSegmentCount + nextRadial,
      ]);
    }
  }
  return {
    ringCount: path.length,
    radialSegmentCount,
    vertices,
    quads,
  };
}

function protectedCoreClearance(path, radii, descriptor) {
  const measured = path
    .map((sample, index) => ({ sample, radius: radii[index] }))
    .filter(({ sample }) => sample.u >= 0.15 && sample.u <= 0.85)
    .map(({ sample, radius }) =>
      distance(sample.position, descriptor.joint.pivot) -
        descriptor.joint.protectedCoreRadius - radius,
    );
  return Math.min(...measured);
}

export function createAnalyticalElbowDescriptor() {
  return {
    schema: ANALYTICAL_ELBOW_DESCRIPTOR_SCHEMA,
    id: 'synthetic-mammalian-elbow-v0',
    authority: {
      kind: 'synthetic-proxy',
      anatomicalAdmission: 'structural-hypothesis',
    },
    claimBoundary: {
      proves: 'analytical articulation and stable low-frequency cage authority',
      doesNotProve: 'species anatomy, generated-surface transfer, or production skinning',
    },
    joint: {
      id: 'elbow-hinge',
      parentSegmentId: 'humerus',
      childSegmentId: 'ulna',
      pivot: [0, 0, 0],
      axis: [0, 0, 1],
      flexionRangeDegrees: [0, 100],
      protectedCoreRadius: 0.2,
    },
    segments: [
      {
        id: 'humerus',
        authority: 'synthetic-proxy',
        bone: {
          start: [0, 0, 0],
          end: [0, 1.8, 0],
          protectedCoreRadius: 0.14,
        },
      },
      {
        id: 'ulna',
        authority: 'synthetic-proxy',
        bone: {
          start: [0, 0.18, 0],
          end: [0, -1.55, 0],
          protectedCoreRadius: 0.11,
        },
      },
    ],
    attachments: [
      {
        id: 'brachialis-origin',
        segmentId: 'humerus',
        localPosition: [0.22, 0.92, 0],
        authority: 'synthetic-proxy',
      },
      {
        id: 'brachialis-insertion',
        segmentId: 'ulna',
        localPosition: [0.17, -0.48, 0],
        authority: 'synthetic-proxy',
      },
      {
        id: 'triceps-origin',
        segmentId: 'humerus',
        localPosition: [-0.22, 1.16, 0],
        authority: 'synthetic-proxy',
      },
      {
        id: 'triceps-insertion',
        segmentId: 'ulna',
        localPosition: [-0.18, 0.2, 0],
        authority: 'synthetic-proxy',
      },
    ],
    muscles: [
      {
        id: 'brachialis-like-flexor',
        role: 'monoarticular-flexor',
        originAttachmentId: 'brachialis-origin',
        insertionAttachmentId: 'brachialis-insertion',
        targetVolume: 0.105,
        volumeAuthority: 'authored-target',
        routing: {
          kind: 'joint-side-handle',
          side: 'anterior',
          radius: 0.58,
          lateralOffset: 0.02,
        },
        profile: {
          tendonRatio: 0.12,
          bellyPower: 1.35,
        },
      },
      {
        id: 'monoarticular-triceps-like-extensor',
        role: 'monoarticular-extensor',
        originAttachmentId: 'triceps-origin',
        insertionAttachmentId: 'triceps-insertion',
        targetVolume: 0.09,
        volumeAuthority: 'authored-target',
        routing: {
          kind: 'joint-side-handle',
          side: 'posterior',
          radius: 0.58,
          lateralOffset: -0.02,
        },
        profile: {
          tendonRatio: 0.11,
          bellyPower: 1.5,
        },
      },
    ],
  };
}

export function solveAnalyticalElbowPose(
  descriptor,
  { flexionDegrees, pathSampleCount = 25, radialSegmentCount = 8 },
) {
  const indexed = validateDescriptor(descriptor);
  if (!Number.isFinite(flexionDegrees)) {
    throw new Error('analytical elbow flexion must be finite');
  }
  const [minimumFlexion, maximumFlexion] = descriptor.joint.flexionRangeDegrees;
  if (flexionDegrees < minimumFlexion || flexionDegrees > maximumFlexion) {
    throw new Error(
      `analytical elbow flexion ${flexionDegrees} is outside authored range`,
    );
  }
  if (!Number.isInteger(pathSampleCount) || pathSampleCount < 9) {
    throw new Error('analytical elbow pathSampleCount must be an integer of at least 9');
  }
  if (!Number.isInteger(radialSegmentCount) || radialSegmentCount < 6) {
    throw new Error('analytical elbow radialSegmentCount must be at least 6');
  }
  const angle = flexionDegrees * Math.PI / 180;
  const segments = descriptor.segments.map(segment => {
    const attachments = descriptor.attachments
      .filter(attachment => attachment.segmentId === segment.id)
      .map(attachment => ({
        id: attachment.id,
        authority: attachment.authority,
        localPosition: [...attachment.localPosition],
        worldPosition: segmentPointToWorld(
          segment.id,
          attachment.localPosition,
          angle,
          descriptor,
        ),
      }));
    return {
      id: segment.id,
      authority: segment.authority,
      bone: {
        ...structuredClone(segment.bone),
        worldStart: segmentPointToWorld(
          segment.id,
          segment.bone.start,
          angle,
          descriptor,
        ),
        worldEnd: segmentPointToWorld(
          segment.id,
          segment.bone.end,
          angle,
          descriptor,
        ),
      },
      attachments,
    };
  });
  const worldAttachments = new Map(
    segments.flatMap(segment =>
      segment.attachments.map(attachment => [attachment.id, attachment.worldPosition]),
    ),
  );
  const muscles = descriptor.muscles.map(muscle => {
    const origin = worldAttachments.get(muscle.originAttachmentId);
    const insertion = worldAttachments.get(muscle.insertionAttachmentId);
    const handle = routeHandle(muscle, angle, descriptor.joint.pivot);
    const path = sampleRoutedPath({
      origin,
      insertion,
      handle,
      sampleCount: pathSampleCount,
      muscleId: muscle.id,
    });
    const volume = volumeMatchedRadii(path, muscle);
    const minimumProtectedCoreClearance = protectedCoreClearance(
      path,
      volume.radii,
      descriptor,
    );
    return {
      id: muscle.id,
      role: muscle.role,
      originAttachmentId: muscle.originAttachmentId,
      insertionAttachmentId: muscle.insertionAttachmentId,
      originWorld: [...origin],
      insertionWorld: [...insertion],
      routeHandleWorld: handle,
      path: path.map((sample, index) => ({
        ...sample,
        radius: volume.radii[index],
      })),
      cage: createCage(
        path,
        volume.radii,
        muscle.id,
        radialSegmentCount,
      ),
      metrics: {
        targetVolume: muscle.targetVolume,
        realizedVolume: volume.realizedVolume,
        volumeRelativeError:
          Math.abs(volume.realizedVolume - muscle.targetVolume) / muscle.targetVolume,
        minimumProtectedCoreClearance,
        pathLength: path.slice(1).reduce(
          (sum, sample, index) => sum + distance(path[index].position, sample.position),
          0,
        ),
        maximumRadius: Math.max(...volume.radii),
      },
    };
  });
  const clearanceViolationCount = muscles.filter(
    muscle => muscle.metrics.minimumProtectedCoreClearance < -1e-8,
  ).length;
  return {
    schema: ANALYTICAL_ELBOW_POSE_SCHEMA,
    sourceId: descriptor.id,
    sourceSchema: descriptor.schema,
    sourceAuthority: descriptor.authority.kind,
    requestedFlexionDegrees: flexionDegrees,
    effectiveFlexionDegrees: flexionDegrees,
    joint: structuredClone(descriptor.joint),
    segments,
    muscles,
    metrics: {
      unresolvedAttachmentCount: descriptor.attachments.length -
        worldAttachments.size,
      clearanceViolationCount,
      materialIdentityViolationCount: 0,
    },
  };
}

export function createAnalyticalElbowConsumerExport(
  descriptor,
  {
    flexionDegrees,
    pathSampleCount = 25,
    radialSegmentCount = 8,
    requestedRoute = 'analytical-cage',
  },
) {
  validateDescriptor(descriptor);
  if (requestedRoute !== 'analytical-cage') {
    throw new Error(`unsupported analytical elbow route ${requestedRoute}`);
  }
  if (!Array.isArray(flexionDegrees) || flexionDegrees.length === 0) {
    throw new Error('analytical elbow export requires at least one flexion pose');
  }
  return {
    schema: ANALYTICAL_ELBOW_EXPORT_SCHEMA,
    sourceId: descriptor.id,
    sourceSchema: descriptor.schema,
    sourceAuthority: structuredClone(descriptor.authority),
    claimBoundary: structuredClone(descriptor.claimBoundary),
    requestedRoute,
    effectiveRoute: 'analytical-cage',
    fallbackUsed: false,
    poses: flexionDegrees.map(value => solveAnalyticalElbowPose(descriptor, {
      flexionDegrees: value,
      pathSampleCount,
      radialSegmentCount,
    })),
  };
}

const SOURCE_JOINTS = Object.freeze({
  pelvis: 0,
  spine: 1,
  leftHip: 22,
  leftKnee: 23,
  leftAnkle: 24,
  leftToe: 25,
  rightHip: 26,
  rightKnee: 27,
  rightAnkle: 28,
  rightToe: 29,
});

const SOURCE_PARENTS = Object.freeze({
  pelvis: -1,
  spine: 0,
  leftHip: 0,
  leftKnee: 22,
  leftAnkle: 23,
  leftToe: 24,
  rightHip: 0,
  rightKnee: 26,
  rightAnkle: 27,
  rightToe: 28,
});
const SOURCE_JOINT_NAMES = Object.freeze({
  0: 'Hips', 1: 'Spine1', 22: 'LeftLeg', 23: 'LeftShin', 24: 'LeftFoot', 25: 'LeftToeBase',
  26: 'RightLeg', 27: 'RightShin', 28: 'RightFoot', 29: 'RightToeBase',
});

const TARGET_BONES = Object.freeze([
  'pelvis',
  'hindlimb-left-hip',
  'hindlimb-left-stifle',
  'hindlimb-left-hock',
  'hindlimb-right-hip',
  'hindlimb-right-stifle',
  'hindlimb-right-hock',
]);

function point(frame, index) {
  const value = frame?.[index];
  if (!Array.isArray(value) || value.length < 3 || !value.slice(0, 3).every(Number.isFinite)) {
    throw new Error(`Invalid SOMA30 source joint ${index}`);
  }
  return value.slice(0, 3).map(Number);
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function jointAngle(frame, parentIndex, jointIndex, childIndex, referenceAxis) {
  const joint = point(frame, jointIndex);
  const incoming = subtract(point(frame, parentIndex), joint);
  const outgoing = subtract(point(frame, childIndex), joint);
  const aLength = length(incoming);
  const bLength = length(outgoing);
  if (aLength <= 1e-8 || bLength <= 1e-8) throw new Error(`Degenerate SOMA30 joint angle at ${jointIndex}`);
  const sine = dot(referenceAxis, cross(incoming, outgoing)) / (aLength * bLength);
  const cosine = dot(incoming, outgoing) / (aLength * bLength);
  return Math.atan2(sine, cosine);
}

function referenceAxis(frames, parentIndex, jointIndex, childIndex) {
  for (const frame of frames) {
    const joint = point(frame, jointIndex);
    const incoming = subtract(point(frame, parentIndex), joint);
    const outgoing = subtract(point(frame, childIndex), joint);
    const axis = cross(incoming, outgoing);
    const norm = length(axis);
    if (norm > 1e-8) return axis.map(value => value / norm);
  }
  throw new Error(`Cannot establish SOMA30 bend plane at ${jointIndex}`);
}

function wrapRadians(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function createMotionRigRequestGate() {
  let generation = 0;
  let current = null;
  return Object.freeze({
    begin(targetKey) {
      generation += 1;
      current = Object.freeze({ generation, targetKey });
      return current;
    },
    invalidate() {
      generation += 1;
      current = null;
      return generation;
    },
    isCurrent(token, targetKey = token?.targetKey) {
      return !!token && current?.generation === token.generation && current.targetKey === targetKey;
    },
  });
}

function sourceAngle(frame, key, planeAxes) {
  const [parentIndex, jointIndex, childIndex] = key;
  return jointAngle(frame, parentIndex, jointIndex, childIndex, planeAxes.get(jointIndex));
}

export function buildKimodoHindquartersTrack(result) {
  const frames = result?.joints;
  const parents = result?.parents;
  if (!Array.isArray(frames) || frames.length < 2) throw new Error('Kimodo hindquarters motion needs at least two source frames');
  const jointCount = Number(result?.num_joints ?? result?.numJoints);
  if (!Array.isArray(parents) || jointCount !== 30) throw new Error('Kimodo hindquarters mapping requires the named SOMA30 source route');
  for (const [name, index] of Object.entries(SOURCE_JOINTS)) {
    if (Number(parents[index]) !== SOURCE_PARENTS[name]) {
      const jointName = SOURCE_JOINT_NAMES[index] || name;
      const expectedParentName = SOURCE_PARENTS[name] < 0 ? 'root' : SOURCE_JOINT_NAMES[SOURCE_PARENTS[name]] || SOURCE_PARENTS[name];
      throw new Error(`SOMA30 ${jointName} source joint ${index} expected parent ${expectedParentName}, got ${parents[index]}`);
    }
  }
  if (frames.some(frame => !Array.isArray(frame) || frame.length !== 30)) throw new Error('Kimodo hindquarters mapping requires 30 positions per SOMA30 frame');

  const keys = {
    leftHip: [0, SOURCE_JOINTS.leftHip, SOURCE_JOINTS.leftKnee],
    leftStifle: [SOURCE_JOINTS.leftHip, SOURCE_JOINTS.leftKnee, SOURCE_JOINTS.leftAnkle],
    leftHock: [SOURCE_JOINTS.leftKnee, SOURCE_JOINTS.leftAnkle, SOURCE_JOINTS.leftToe],
    rightHip: [0, SOURCE_JOINTS.rightHip, SOURCE_JOINTS.rightKnee],
    rightStifle: [SOURCE_JOINTS.rightHip, SOURCE_JOINTS.rightKnee, SOURCE_JOINTS.rightAnkle],
    rightHock: [SOURCE_JOINTS.rightKnee, SOURCE_JOINTS.rightAnkle, SOURCE_JOINTS.rightToe],
  };
  const planeAxes = new Map(Object.values(keys).map(([parent, joint, child]) => [
    joint,
    referenceAxis(frames, parent, joint, child),
  ]));
  const baseAngles = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, sourceAngle(frames[0], key, planeAxes)]));
  const baseRoot = point(frames[0], SOURCE_JOINTS.pelvis);
  const baseSpine = subtract(point(frames[0], SOURCE_JOINTS.spine), baseRoot);
  const baseSpineLength = length(baseSpine);
  const lateral = subtract(point(frames[0], SOURCE_JOINTS.rightHip), point(frames[0], SOURCE_JOINTS.leftHip));
  const lateralLength = length(lateral);
  if (baseSpineLength <= 1e-8 || lateralLength <= 1e-8) throw new Error('SOMA30 pelvis pitch needs non-degenerate spine and bilateral hip landmarks');
  const pelvisPitchAxis = lateral.map(value => value / lateralLength);
  return {
    schema: 'kaminos.kimodo-cat-hindquarters-track.v0',
    sourceSchema: 'kimodo-soma30-explicit-joints',
    sourceRoute: String(result.route || result.sourceRoute || 'kimodo.motion-result'),
    frameCount: frames.length,
    sourceFrameCount: Number(result.num_frames ?? result.numFrames) || frames.length,
    fps: Number(result.fps) > 0 ? Number(result.fps) : 30,
    targetBoneNames: [...TARGET_BONES],
    mappedSourceJoints: { ...SOURCE_JOINTS },
    frames: frames.map(frame => {
      const root = point(frame, SOURCE_JOINTS.pelvis);
      const spine = subtract(point(frame, SOURCE_JOINTS.spine), root);
      const spineLength = length(spine);
      if (spineLength <= 1e-8) throw new Error('SOMA30 pelvis pitch needs a non-degenerate pelvis-to-spine landmark');
      const pelvisPitchRadians = Math.atan2(
        dot(pelvisPitchAxis, cross(baseSpine, spine)) / (baseSpineLength * spineLength),
        dot(baseSpine, spine) / (baseSpineLength * spineLength),
      );
      return {
        rootOffset: subtract(root, baseRoot),
        pelvisPitchRadians,
        left: {
          hipRadians: wrapRadians(sourceAngle(frame, keys.leftHip, planeAxes) - baseAngles.leftHip),
          stifleRadians: wrapRadians(sourceAngle(frame, keys.leftStifle, planeAxes) - baseAngles.leftStifle),
          hockRadians: wrapRadians(sourceAngle(frame, keys.leftHock, planeAxes) - baseAngles.leftHock),
        },
        right: {
          hipRadians: wrapRadians(sourceAngle(frame, keys.rightHip, planeAxes) - baseAngles.rightHip),
          stifleRadians: wrapRadians(sourceAngle(frame, keys.rightStifle, planeAxes) - baseAngles.rightStifle),
          hockRadians: wrapRadians(sourceAngle(frame, keys.rightHock, planeAxes) - baseAngles.rightHock),
        },
      };
    }),
  };
}

export function sampleKimodoHindquartersTrack(track, frame) {
  if (track?.schema !== 'kaminos.kimodo-cat-hindquarters-track.v0' || !Array.isArray(track.frames) || !track.frames.length) {
    throw new Error('Invalid Kimodo hindquarters track');
  }
  const position = Math.max(0, Math.min(track.frames.length - 1, Number(frame) || 0));
  const from = Math.floor(position);
  const to = Math.min(track.frames.length - 1, from + 1);
  const mix = position - from;
  const a = track.frames[from];
  const b = track.frames[to];
  const lerp = (x, y) => x + (y - x) * mix;
  return {
    frame: position,
    rootOffset: a.rootOffset.map((value, axis) => lerp(value, b.rootOffset[axis])),
    pelvisPitchRadians: lerp(a.pelvisPitchRadians, b.pelvisPitchRadians),
    left: {
      hipRadians: lerp(a.left.hipRadians, b.left.hipRadians),
      stifleRadians: lerp(a.left.stifleRadians, b.left.stifleRadians),
      hockRadians: lerp(a.left.hockRadians, b.left.hockRadians),
    },
    right: {
      hipRadians: lerp(a.right.hipRadians, b.right.hipRadians),
      stifleRadians: lerp(a.right.stifleRadians, b.right.stifleRadians),
      hockRadians: lerp(a.right.hockRadians, b.right.hockRadians),
    },
  };
}

export function sampleKimodoHindquartersTrackAtElapsed(track, elapsedSeconds) {
  if (!Number.isFinite(Number(elapsedSeconds)) || !Number.isFinite(Number(track?.fps)) || Number(track.fps) <= 0) {
    throw new Error('Kimodo playback requires finite elapsed seconds and a positive track FPS');
  }
  const lastFrame = track?.frameCount - 1;
  if (!Number.isFinite(lastFrame) || lastFrame < 1) throw new Error('Kimodo playback requires at least two frames');
  const elapsedFrame = Math.max(0, Number(elapsedSeconds)) * Number(track.fps);
  const done = elapsedFrame >= lastFrame;
  return {
    sample: sampleKimodoHindquartersTrack(track, Math.min(lastFrame, elapsedFrame)),
    done,
  };
}

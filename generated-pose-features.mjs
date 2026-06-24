#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const GENERATED_POSE_FEATURES_SCHEMA = 'kaminos.generated-pose-features.v0';

const SOMA77_JOINTS = [
  'Hips', 'Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head', 'HeadEnd', 'Jaw', 'LeftEye', 'RightEye',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3', 'LeftHandThumbEnd',
  'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3', 'LeftHandIndex4', 'LeftHandIndexEnd',
  'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3', 'LeftHandMiddle4', 'LeftHandMiddleEnd',
  'LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3', 'LeftHandRing4', 'LeftHandRingEnd',
  'LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3', 'LeftHandPinky4', 'LeftHandPinkyEnd',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3', 'RightHandThumbEnd',
  'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3', 'RightHandIndex4', 'RightHandIndexEnd',
  'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3', 'RightHandMiddle4', 'RightHandMiddleEnd',
  'RightHandRing1', 'RightHandRing2', 'RightHandRing3', 'RightHandRing4', 'RightHandRingEnd',
  'RightHandPinky1', 'RightHandPinky2', 'RightHandPinky3', 'RightHandPinky4', 'RightHandPinkyEnd',
  'LeftLeg', 'LeftShin', 'LeftFoot', 'LeftToeBase', 'LeftToeEnd',
  'RightLeg', 'RightShin', 'RightFoot', 'RightToeBase', 'RightToeEnd',
];

const JOINT = Object.fromEntries(SOMA77_JOINTS.map((name, index) => [name, index]));

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const requestedInput = args.get('--input') || '';
const effectiveInput = requestedInput ? resolve(requestedInput) : null;
const reportPath = resolve(args.get('--report') || '/tmp/kaminos-generated-pose-features.json');
const fps = Math.max(1, Number(args.get('--fps') || 30));
const unzipPath = args.get('--unzip') || 'unzip';

let phase = 'initializing';
let lastEvidence = {};

function round(value, digits = 5) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function vecRound(vec) {
  return vec.map(value => round(value));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: GENERATED_POSE_FEATURES_SCHEMA,
    requestedInput,
    effectiveInput,
    reportPath,
    fps,
    phase,
    ...lastEvidence,
    ...report,
  }, null, 2));
}

function fail(error) {
  writeReport({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function hashFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function listNpzKeys(path) {
  const result = spawnSync(unzipPath, ['-Z1', path], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`unzip key listing failed ${result.status}: ${String(result.stderr || '').slice(-1000)}`);
  }
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function readNpyFromNpz(path, member) {
  const result = spawnSync(unzipPath, ['-p', path, member], { encoding: null, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`unzip member ${member} failed ${result.status}: ${String(result.stderr || '').slice(-1000)}`);
  }
  return parseNpy(result.stdout);
}

function parseNpy(buffer) {
  if (buffer.subarray(0, 6).toString('binary') !== '\x93NUMPY') throw new Error('Invalid NPY magic');
  const major = buffer[6];
  const minor = buffer[7];
  const headerLength = major === 1
    ? buffer.readUInt16LE(8)
    : buffer.readUInt32LE(8);
  const headerOffset = major === 1 ? 10 : 12;
  const header = buffer.subarray(headerOffset, headerOffset + headerLength).toString('latin1');
  const descr = header.match(/'descr':\s*'([^']+)'/)?.[1];
  const fortranOrder = header.match(/'fortran_order':\s*(True|False)/)?.[1] === 'True';
  const shapeText = header.match(/'shape':\s*\(([^)]*)\)/)?.[1];
  if (!descr || shapeText == null) throw new Error(`Unsupported NPY header: ${header.trim()}`);
  if (fortranOrder) throw new Error('Fortran-order NPY arrays are not supported');
  const shape = shapeText.split(',').map(part => part.trim()).filter(Boolean).map(Number);
  const dataOffset = headerOffset + headerLength;
  const count = shape.reduce((product, value) => product * value, 1);
  const data = [];
  if (descr === '<f4') {
    for (let i = 0; i < count; i++) data.push(buffer.readFloatLE(dataOffset + i * 4));
  } else if (descr === '<f8') {
    for (let i = 0; i < count; i++) data.push(buffer.readDoubleLE(dataOffset + i * 8));
  } else if (descr === '<i4') {
    for (let i = 0; i < count; i++) data.push(buffer.readInt32LE(dataOffset + i * 4));
  } else if (descr === '<i8') {
    for (let i = 0; i < count; i++) data.push(Number(buffer.readBigInt64LE(dataOffset + i * 8)));
  } else {
    throw new Error(`Unsupported NPY dtype ${descr}`);
  }
  return { descr, shape, data, version: `${major}.${minor}` };
}

function at(array, shape, frame, joint = null) {
  if (shape.length === 2) {
    const offset = frame * shape[1];
    return [array[offset], array[offset + 1], array[offset + 2]];
  }
  const offset = (frame * shape[1] + joint) * shape[2];
  return [array[offset], array[offset + 1], array[offset + 2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dist(a, b) {
  const d = sub(a, b);
  return Math.hypot(d[0], d[1], d[2]);
}

function mag(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function horizontalMag(v) {
  return Math.hypot(v[0], v[2]);
}

function minMax(values) {
  return {
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    range: round(Math.max(...values) - Math.min(...values)),
  };
}

function frameFeatureData(posed, roots) {
  const frames = posed.shape[0];
  const positions = posed.data;
  const rootPositions = roots?.data;
  const rootShape = roots?.shape;
  const getRoot = frame => rootPositions ? at(rootPositions, rootShape, frame) : at(positions, posed.shape, frame, JOINT.Hips);
  const getJoint = (frame, name) => at(positions, posed.shape, frame, JOINT[name]);

  const samples = [];
  for (let frame = 0; frame < frames; frame++) {
    const root = getRoot(frame);
    const head = getJoint(frame, 'Head');
    const chest = getJoint(frame, 'Chest');
    const leftHand = getJoint(frame, 'LeftHand');
    const rightHand = getJoint(frame, 'RightHand');
    const leftFoot = getJoint(frame, 'LeftFoot');
    const rightFoot = getJoint(frame, 'RightFoot');
    const leftShoulder = getJoint(frame, 'LeftShoulder');
    const rightShoulder = getJoint(frame, 'RightShoulder');
    const leftHip = getJoint(frame, 'LeftLeg');
    const rightHip = getJoint(frame, 'RightLeg');

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let joint = 0; joint < posed.shape[1]; joint++) {
      const p = at(positions, posed.shape, frame, joint);
      minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); minZ = Math.min(minZ, p[2]);
      maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); maxZ = Math.max(maxZ, p[2]);
    }

    samples.push({
      frame,
      time: frame / fps,
      root,
      head,
      chest,
      leftHand,
      rightHand,
      leftFoot,
      rightFoot,
      headRoot: sub(head, root),
      chestRoot: sub(chest, root),
      shoulderAxis: sub(leftShoulder, rightShoulder),
      hipAxis: sub(leftHip, rightHip),
      handSpan: dist(leftHand, rightHand),
      stanceWidth: dist(leftFoot, rightFoot),
      leftHandReach: dist(leftHand, root),
      rightHandReach: dist(rightHand, root),
      leftFootHeight: leftFoot[1],
      rightFootHeight: rightFoot[1],
      bbox: {
        width: maxX - minX,
        height: maxY - minY,
        depth: maxZ - minZ,
        volume: (maxX - minX) * (maxY - minY) * (maxZ - minZ),
      },
    });
  }
  return samples;
}

function velocity(values, frame) {
  if (frame <= 0) return 0;
  return dist(values[frame], values[frame - 1]) * fps;
}

function topSpikes(samples, accessors, count = 8) {
  const spikes = [];
  for (let frame = 1; frame < samples.length; frame++) {
    const parts = accessors.map(({ id, points }) => ({
      id,
      speed: velocity(points, frame),
    }));
    const max = parts.reduce((best, part) => part.speed > best.speed ? part : best, parts[0]);
    spikes.push({
      frame,
      time: round(samples[frame].time),
      channel: max.id,
      speed: round(max.speed),
      root: vecRound(samples[frame].root),
    });
  }
  return spikes.sort((a, b) => b.speed - a.speed).slice(0, count);
}

function extractFeatures(posed, roots, npzKeys) {
  if (posed.shape.length !== 3 || posed.shape[2] !== 3) {
    throw new Error(`posed_joints.npy must be shaped [frames,joints,3], got ${JSON.stringify(posed.shape)}`);
  }
  if (posed.shape[1] < SOMA77_JOINTS.length) {
    throw new Error(`Unsupported generated pose feature input: expected SOMA77 posed_joints, got ${posed.shape[1]} joints`);
  }
  const samples = frameFeatureData(posed, roots);
  const rootsByFrame = samples.map(sample => sample.root);
  const heads = samples.map(sample => sample.head);
  const chests = samples.map(sample => sample.chest);
  const leftHands = samples.map(sample => sample.leftHand);
  const rightHands = samples.map(sample => sample.rightHand);
  const leftFeet = samples.map(sample => sample.leftFoot);
  const rightFeet = samples.map(sample => sample.rightFoot);
  const rootStart = rootsByFrame[0];
  const rootEnd = rootsByFrame.at(-1);
  const rootY = rootsByFrame.map(root => root[1]);
  const rootTravelSegments = rootsByFrame.slice(1).map((root, index) => dist(root, rootsByFrame[index]));
  const xzTravelSegments = rootsByFrame.slice(1).map((root, index) => Math.hypot(root[0] - rootsByFrame[index][0], root[2] - rootsByFrame[index][2]));
  const headRootMagnitudes = samples.map(sample => mag(sample.headRoot));
  const chestRootHorizontal = samples.map(sample => horizontalMag(sample.chestRoot));
  const shoulderWidths = samples.map(sample => mag(sample.shoulderAxis));
  const hipWidths = samples.map(sample => mag(sample.hipAxis));
  const handSpan = samples.map(sample => sample.handSpan);
  const stanceWidth = samples.map(sample => sample.stanceWidth);
  const leftHandReach = samples.map(sample => sample.leftHandReach);
  const rightHandReach = samples.map(sample => sample.rightHandReach);
  const leftFootHeight = samples.map(sample => sample.leftFootHeight);
  const rightFootHeight = samples.map(sample => sample.rightFootHeight);
  const bboxWidth = samples.map(sample => sample.bbox.width);
  const bboxHeight = samples.map(sample => sample.bbox.height);
  const bboxDepth = samples.map(sample => sample.bbox.depth);
  const bboxVolume = samples.map(sample => sample.bbox.volume);
  const footHeightFloor = Math.min(...leftFootHeight, ...rightFootHeight);
  const contactTolerance = 0.035;
  const leftContactFrames = samples.filter(sample => sample.leftFootHeight <= footHeightFloor + contactTolerance).map(sample => sample.frame);
  const rightContactFrames = samples.filter(sample => sample.rightFootHeight <= footHeightFloor + contactTolerance).map(sample => sample.frame);

  return {
    ok: true,
    sourceKind: 'generated-motion-npz',
    sourceFormat: 'kimodo-soma77-explicit-joints',
    npzKeys,
    arrayShapes: {
      posed_joints: posed.shape,
      root_positions: roots?.shape || null,
    },
    jointMap: {
      skeleton: 'somaskel77',
      indices: {
        Hips: JOINT.Hips,
        Chest: JOINT.Chest,
        Head: JOINT.Head,
        LeftHand: JOINT.LeftHand,
        RightHand: JOINT.RightHand,
        LeftFoot: JOINT.LeftFoot,
        RightFoot: JOINT.RightFoot,
        LeftShoulder: JOINT.LeftShoulder,
        RightShoulder: JOINT.RightShoulder,
        LeftLeg: JOINT.LeftLeg,
        RightLeg: JOINT.RightLeg,
      },
    },
    frameCount: posed.shape[0],
    jointCount: posed.shape[1],
    duration: round((posed.shape[0] - 1) / fps),
    rootMetrics: {
      start: vecRound(rootStart),
      end: vecRound(rootEnd),
      displacement: vecRound(sub(rootEnd, rootStart)),
      travel3d: round(rootTravelSegments.reduce((sum, value) => sum + value, 0)),
      travelXZ: round(xzTravelSegments.reduce((sum, value) => sum + value, 0)),
      verticalRange: minMax(rootY).range,
      maxSpeed: round(Math.max(...rootsByFrame.map((_, frame) => velocity(rootsByFrame, frame)))),
    },
    torsoFrame: {
      headRootDistance: minMax(headRootMagnitudes),
      chestRootHorizontalLean: minMax(chestRootHorizontal),
      shoulderWidth: minMax(shoulderWidths),
      hipWidth: minMax(hipWidths),
      representativeHeadRoot: vecRound(samples[Math.floor(samples.length / 2)].headRoot),
    },
    limbEnvelope: {
      handSpan: minMax(handSpan),
      leftHandReach: minMax(leftHandReach),
      rightHandReach: minMax(rightHandReach),
      maxHandSpeed: round(Math.max(...leftHands.map((_, frame) => Math.max(velocity(leftHands, frame), velocity(rightHands, frame))))),
      maxFootSpeed: round(Math.max(...leftFeet.map((_, frame) => Math.max(velocity(leftFeet, frame), velocity(rightFeet, frame))))),
    },
    stanceContact: {
      stanceWidth: minMax(stanceWidth),
      leftFootHeight: minMax(leftFootHeight),
      rightFootHeight: minMax(rightFootHeight),
      contactFloorY: round(footHeightFloor),
      contactTolerance,
      leftContactRatio: round(leftContactFrames.length / samples.length),
      rightContactRatio: round(rightContactFrames.length / samples.length),
      leftContactFrameSample: leftContactFrames.slice(0, 12),
      rightContactFrameSample: rightContactFrames.slice(0, 12),
      footContactsSource: npzKeys.includes('foot_contacts.npy') ? 'source-foot_contacts-present-not-yet-read' : 'height-velocity-proxy',
    },
    expansionCompression: {
      bboxWidth: minMax(bboxWidth),
      bboxHeight: minMax(bboxHeight),
      bboxDepth: minMax(bboxDepth),
      bboxVolume: minMax(bboxVolume),
      compactnessRange: round(Math.max(...bboxVolume) / Math.max(1e-6, Math.min(...bboxVolume))),
    },
    eventSpikes: topSpikes(samples, [
      { id: 'root', points: rootsByFrame },
      { id: 'head', points: heads },
      { id: 'chest', points: chests },
      { id: 'leftHand', points: leftHands },
      { id: 'rightHand', points: rightHands },
      { id: 'leftFoot', points: leftFeet },
      { id: 'rightFoot', points: rightFeet },
    ]),
    outputMappingHints: [
      { feature: 'torsoFrame.chestRootHorizontalLean', output: 'orb body lean / intent direction offset' },
      { feature: 'torsoFrame.headRootDistance', output: 'face cue lead / attention separation' },
      { feature: 'limbEnvelope.handSpan', output: 'aura radius / appendage proxy spread' },
      { feature: 'limbEnvelope.maxHandSpeed', output: 'gesture impulse / sparkle or trail accent' },
      { feature: 'stanceContact.stanceWidth', output: 'body squash-stretch width / groundedness' },
      { feature: 'stanceContact.leftContactRatio/rightContactRatio', output: 'step cadence / footfall pulse' },
      { feature: 'expansionCompression.bboxVolume', output: 'breathing scale / compression-release phrasing' },
      { feature: 'eventSpikes', output: 'strike, recoil, bow, hop, and decision accent events' },
    ],
  };
}

try {
  phase = 'validating-args';
  if (!requestedInput) throw new Error('Missing --input');
  if (!existsSync(effectiveInput)) throw new Error(`Input does not exist: ${effectiveInput}`);

  phase = 'reading-input-identity';
  const inputStat = statSync(effectiveInput);
  const inputSha256 = hashFile(effectiveInput);
  lastEvidence = {
    inputSizeBytes: inputStat.size,
    inputMtimeMs: inputStat.mtimeMs,
    inputSha256,
  };

  phase = 'listing-npz';
  const npzKeys = listNpzKeys(effectiveInput);
  lastEvidence = { ...lastEvidence, npzKeys };
  if (!npzKeys.includes('posed_joints.npy')) {
    throw new Error(`Unsupported generated pose feature input: missing posed_joints.npy; keys=${npzKeys.join(',')}`);
  }

  phase = 'reading-npy-arrays';
  const posed = readNpyFromNpz(effectiveInput, 'posed_joints.npy');
  const roots = npzKeys.includes('root_positions.npy') ? readNpyFromNpz(effectiveInput, 'root_positions.npy') : null;
  lastEvidence = {
    ...lastEvidence,
    npyArrays: {
      posed_joints: { shape: posed.shape, dtype: posed.descr, version: posed.version },
      root_positions: roots ? { shape: roots.shape, dtype: roots.descr, version: roots.version } : null,
    },
  };

  phase = 'extracting-features';
  const features = extractFeatures(posed, roots, npzKeys);

  phase = 'complete';
  writeReport(features);
} catch (error) {
  fail(error);
}

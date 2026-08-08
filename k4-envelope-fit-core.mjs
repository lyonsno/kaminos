import { createHash } from 'node:crypto';

import {
  hashMuscleCompartmentRingCageCanonicalJson,
} from './muscle-compartment-ring-cage-core.mjs';

export const K4_ENVELOPE_FIT_METRIC_SCHEMA =
  'kaminos.k4-envelope-fit-metric.v0';
const FRAME_RECEIPT_SCHEMA = 'kaminos.k4-envelope-frame-binding-receipt.v0';
const SOLVER_CARRIER_SCHEMA =
  'kaminos.muscle-compartment-ring-cage-solver-carrier.v0';
const CONSTRUCTION_ORDER = Object.freeze([
  'muscle-34', 'muscle-13', 'muscle-12', 'muscle-45',
]);

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// --- minimal glTF binary triangle-soup extraction with node-transform composition

const COMPONENT_READERS = Object.freeze({
  5120: (view, offset) => view.getInt8(offset),
  5121: (view, offset) => view.getUint8(offset),
  5122: (view, offset) => view.getInt16(offset, true),
  5123: (view, offset) => view.getUint16(offset, true),
  5125: (view, offset) => view.getUint32(offset, true),
  5126: (view, offset) => view.getFloat32(offset, true),
});
const COMPONENT_SIZES = Object.freeze({
  5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4,
});

function quaternionToMatrix([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function composeTrs(node) {
  if (node.matrix) {
    const m = node.matrix; // column-major glTF
    return {
      linear: [
        [m[0], m[4], m[8]],
        [m[1], m[5], m[9]],
        [m[2], m[6], m[10]],
      ],
      translation: [m[12], m[13], m[14]],
    };
  }
  const rotation = quaternionToMatrix(node.rotation || [0, 0, 0, 1]);
  const scale = node.scale || [1, 1, 1];
  return {
    linear: rotation.map(row => row.map((value, column) => value * scale[column])),
    translation: node.translation || [0, 0, 0],
  };
}

function composeFrames(parent, child) {
  const linear = [0, 1, 2].map(row => [0, 1, 2].map(column =>
    parent.linear[row][0] * child.linear[0][column] +
    parent.linear[row][1] * child.linear[1][column] +
    parent.linear[row][2] * child.linear[2][column]));
  const translation = [0, 1, 2].map(row =>
    parent.linear[row][0] * child.translation[0] +
    parent.linear[row][1] * child.translation[1] +
    parent.linear[row][2] * child.translation[2] +
    parent.translation[row]);
  return { linear, translation };
}

function applyFrame(frame, point) {
  return [0, 1, 2].map(row =>
    frame.linear[row][0] * point[0] +
    frame.linear[row][1] * point[1] +
    frame.linear[row][2] * point[2] +
    frame.translation[row]);
}

function accessorValues(doc, binary, accessorIndex, components) {
  const accessor = doc.accessors[accessorIndex];
  const view = doc.bufferViews[accessor.bufferView];
  const reader = COMPONENT_READERS[accessor.componentType];
  const size = COMPONENT_SIZES[accessor.componentType];
  if (!reader) throw new Error(`glb accessor component type ${accessor.componentType} unsupported`);
  const stride = view.byteStride || components * size;
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const rows = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const row = [];
    for (let component = 0; component < components; component += 1) {
      row.push(reader(data, base + index * stride + component * size));
    }
    rows.push(components === 1 ? row[0] : row);
  }
  return rows;
}

export function parseGlbTriangleSoup(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.subarray(0, 4).toString() !== 'glTF') {
    throw new Error('glb parse requires a binary glTF header');
  }
  let offset = 12;
  let doc = null;
  let binary = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) doc = JSON.parse(payload.toString());
    if (type === 0x004e4942) binary = payload;
    offset += 8 + length;
  }
  if (!doc || !binary) throw new Error('glb parse requires JSON and BIN chunks');
  const identity = { linear: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] };
  const vertices = [];
  const triangles = [];
  const visit = (nodeIndex, parentFrame) => {
    const node = doc.nodes[nodeIndex];
    const frame = composeFrames(parentFrame, composeTrs(node));
    if (Number.isInteger(node.mesh)) {
      for (const primitive of doc.meshes[node.mesh].primitives) {
        const base = vertices.length;
        const positions = accessorValues(doc, binary, primitive.attributes.POSITION, 3);
        for (const position of positions) vertices.push(applyFrame(frame, position));
        const indices = Number.isInteger(primitive.indices)
          ? accessorValues(doc, binary, primitive.indices, 1)
          : positions.map((_, index) => index);
        for (let index = 0; index + 2 < indices.length; index += 3) {
          triangles.push([
            base + indices[index],
            base + indices[index + 1],
            base + indices[index + 2],
          ]);
        }
      }
    }
    for (const child of node.children || []) visit(child, frame);
  };
  const scene = doc.scenes[doc.scene ?? 0];
  for (const nodeIndex of scene.nodes) visit(nodeIndex, identity);
  if (triangles.length === 0) throw new Error('glb parse found no triangles');
  return { vertices, triangles };
}

// --- signed distance via closest triangle + orientation-proof winding number

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a) { return Math.sqrt(dot(a, a)); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }

function pointTriangleDistanceSquared(p, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = clamp01(d1 / (d1 - d3));
    const q = sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]);
    return dot(q, q);
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = clamp01(d2 / (d2 - d6));
    const q = sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]);
    return dot(q, q);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = clamp01((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const q = sub(p, [
      b[0] + (c[0] - b[0]) * w,
      b[1] + (c[1] - b[1]) * w,
      b[2] + (c[2] - b[2]) * w,
    ]);
    return dot(q, q);
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  const q = sub(p, [
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ]);
  return dot(q, q);
}

function triangleSolidAngle(p, a, b, c) {
  const ra = sub(a, p);
  const rb = sub(b, p);
  const rc = sub(c, p);
  const la = norm(ra);
  const lb = norm(rb);
  const lc = norm(rc);
  const numerator = dot(ra, cross(rb, rc));
  const denominator = la * lb * lc +
    dot(ra, rb) * lc + dot(rb, rc) * la + dot(rc, ra) * lb;
  return 2 * Math.atan2(numerator, denominator);
}

export function signedEnvelopeDistance(point, mesh) {
  let bestSquared = Infinity;
  let windingSum = 0;
  for (const [ia, ib, ic] of mesh.triangles) {
    const a = mesh.vertices[ia];
    const b = mesh.vertices[ib];
    const c = mesh.vertices[ic];
    const squared = pointTriangleDistanceSquared(point, a, b, c);
    if (squared < bestSquared) bestSquared = squared;
    windingSum += triangleSolidAngle(point, a, b, c);
  }
  const winding = windingSum / (4 * Math.PI);
  const inside = Math.abs(winding) > 0.5;
  const distance = Math.sqrt(bestSquared);
  return {
    signedDistance: inside ? -distance : distance,
    winding,
    inside,
  };
}

function applySimilarity(transform, point) {
  const scaled = point.map(value => value * transform.scale);
  return [0, 1, 2].map(row =>
    transform.rotation[row][0] * scaled[0] +
    transform.rotation[row][1] * scaled[1] +
    transform.rotation[row][2] * scaled[2] +
    transform.translation[row]);
}

const SHAPING_EPSILON = 1e-10;

function signedTetVolume(a, b, c, d) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ad = sub(d, a);
  return dot(ab, cross(ac, ad)) / 6;
}

function envelopeRayCrossing(axisPoint, direction, mesh, maximumDistance) {
  // March outward from an inside axis point until the signed distance turns
  // positive, then bisect the crossing.
  let low = 0;
  let high = null;
  const stepCount = 24;
  for (let step = 1; step <= stepCount; step += 1) {
    const t = (maximumDistance * step) / stepCount;
    const probe = [
      axisPoint[0] + direction[0] * t,
      axisPoint[1] + direction[1] * t,
      axisPoint[2] + direction[2] * t,
    ];
    if (signedEnvelopeDistance(probe, mesh).inside) low = t;
    else { high = t; break; }
  }
  if (high === null) return null;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    const probe = [
      axisPoint[0] + direction[0] * middle,
      axisPoint[1] + direction[1] * middle,
      axisPoint[2] + direction[2] * middle,
    ];
    if (signedEnvelopeDistance(probe, mesh).inside) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function applyEnvelopeClampedSectionShaping({
  frameReceipt,
  envelopeMesh,
  solverCarrier,
  config,
}) {
  if (frameReceipt?.schema !== FRAME_RECEIPT_SCHEMA) {
    throw new Error(`envelope-clamped shaping requires ${FRAME_RECEIPT_SCHEMA}`);
  }
  const { receiptSha256: recordedReceiptSha256, ...receiptDomain } = frameReceipt;
  if (recordedReceiptSha256 !== sha256(canonicalJson(receiptDomain))) {
    throw new Error('envelope-clamped shaping frame receipt identity mismatch');
  }
  if (!solverCarrier || solverCarrier.schema !== SOLVER_CARRIER_SCHEMA) {
    throw new Error('envelope-clamped shaping requires the admitted solver carrier schema');
  }
  const { identity: _identity, ...carrierDomain } = solverCarrier;
  if (solverCarrier.identity?.sha256 !==
      hashMuscleCompartmentRingCageCanonicalJson(carrierDomain)) {
    throw new Error('envelope-clamped shaping carrier identity mismatch');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      JSON.stringify(Object.keys(config).sort()) !==
        JSON.stringify(['marginFraction', 'maximumGrowth', 'minimumShrink']) ||
      !Number.isFinite(config.marginFraction) ||
      !(config.marginFraction > 0 && config.marginFraction < 1) ||
      !Number.isFinite(config.maximumGrowth) || !(config.maximumGrowth >= 1) ||
      !Number.isFinite(config.minimumShrink) ||
      !(config.minimumShrink > 0 && config.minimumShrink < 1)) {
    throw new Error(
      'envelope-clamped shaping config requires marginFraction in (0,1), ' +
      'maximumGrowth >= 1, minimumShrink in (0,1)',
    );
  }
  const transform = frameReceipt.sourceToEnvelope.transform;
  const outputCarrier = structuredClone(solverCarrier);
  const sectionReceipts = [];
  for (const cage of outputCarrier.cages) {
    const fixedNodeIds = new Set((cage.manifest.constraints?.boundaryMasks || [])
      .filter(mask => mask.fixed === true)
      .map(mask => mask.nodeId));
    const nodesBySection = new Map();
    for (const node of cage.manifest.nodes) {
      const match = /^(.*:section:\d+)/.exec(node.id);
      if (!match) continue;
      const rows = nodesBySection.get(match[1]) || [];
      rows.push(node);
      nodesBySection.set(match[1], rows);
    }
    for (const [sectionId, nodes] of [...nodesBySection.entries()]
      .sort(([left], [right]) => left.localeCompare(right))) {
      const axisNode = nodes.find(node => node.id.endsWith(':axis'));
      if (!axisNode) throw new Error(`envelope-clamped shaping lacks axis for ${sectionId}`);
      if (nodes.some(node => fixedNodeIds.has(node.id))) {
        sectionReceipts.push({
          constructionId: cage.constructionId,
          sectionId,
          status: 'fixed-section',
          nodeReceipts: [],
        });
        continue;
      }
      const axisEnvelope = applySimilarity(transform, axisNode.currentPosition);
      if (!signedEnvelopeDistance(axisEnvelope, envelopeMesh).inside) {
        sectionReceipts.push({
          constructionId: cage.constructionId,
          sectionId,
          status: 'axis-outside-envelope',
          nodeReceipts: [],
        });
        continue;
      }
      const nodeReceipts = [];
      for (const node of nodes) {
        if (node === axisNode) continue;
        const radial = sub(node.currentPosition, axisNode.currentPosition);
        const radialLength = norm(radial);
        if (!(radialLength > SHAPING_EPSILON)) continue;
        const nodeEnvelope = applySimilarity(transform, node.currentPosition);
        const envelopeRadial = sub(nodeEnvelope, axisEnvelope);
        const envelopeRadialLength = norm(envelopeRadial);
        const direction = envelopeRadial.map(value => value / envelopeRadialLength);
        const crossing = envelopeRayCrossing(
          axisEnvelope,
          direction,
          envelopeMesh,
          envelopeRadialLength * Math.max(4, config.maximumGrowth * 4),
        );
        let appliedRadialScale;
        let cap = null;
        if (crossing === null) {
          // The surface lies beyond the search span, so the margin target is
          // far above the growth ceiling; the ceiling is the honest result.
          appliedRadialScale = config.maximumGrowth;
          cap = 'growth-capped-no-crossing-within-search';
        } else {
          const targetScale =
            (config.marginFraction * crossing) / envelopeRadialLength;
          appliedRadialScale = targetScale;
          if (targetScale > config.maximumGrowth) {
            appliedRadialScale = config.maximumGrowth;
            cap = 'growth-capped';
          } else if (targetScale < config.minimumShrink) {
            appliedRadialScale = config.minimumShrink;
            cap = 'shrink-floor-capped';
          }
        }
        node.currentPosition = [0, 1, 2].map(axisIndex =>
          axisNode.currentPosition[axisIndex] + radial[axisIndex] * appliedRadialScale);
        nodeReceipts.push({
          nodeId: node.id,
          appliedRadialScale,
          envelopeCrossingDistance: crossing,
          cap,
        });
      }
      sectionReceipts.push({
        constructionId: cage.constructionId,
        sectionId,
        status: 'shaped',
        nodeReceipts,
      });
    }
  }
  // Custody checks: fixed nodes and axes untouched by construction; verify anyway.
  let fixedNodeMaximumDrift = 0;
  let centerlineMaximumDrift = 0;
  let nonPositiveCellCount = 0;
  for (const [cageIndex, cage] of outputCarrier.cages.entries()) {
    const sourceCage = solverCarrier.cages[cageIndex];
    const sourceById = new Map(sourceCage.manifest.nodes.map(node => [node.id, node]));
    const fixedNodeIds = new Set((cage.manifest.constraints?.boundaryMasks || [])
      .filter(mask => mask.fixed === true)
      .map(mask => mask.nodeId));
    const positionById = new Map(cage.manifest.nodes.map(node => [node.id, node]));
    for (const node of cage.manifest.nodes) {
      const drift = norm(sub(node.currentPosition,
        sourceById.get(node.id).currentPosition));
      if (fixedNodeIds.has(node.id)) {
        fixedNodeMaximumDrift = Math.max(fixedNodeMaximumDrift, drift);
      }
      if (node.id.endsWith(':axis')) {
        centerlineMaximumDrift = Math.max(centerlineMaximumDrift, drift);
      }
    }
    for (const cell of cage.manifest.cells) {
      const [a, b, c, d] = cell.nodeIds.map(nodeId =>
        positionById.get(nodeId).currentPosition);
      const oriented = signedTetVolume(a, b, c, d) * cell.restOrientationParity;
      if (!(oriented > SHAPING_EPSILON)) nonPositiveCellCount += 1;
    }
  }
  if (fixedNodeMaximumDrift !== 0 || centerlineMaximumDrift !== 0) {
    throw new Error('envelope-clamped shaping violated fixed-node or centerline immutability');
  }
  if (nonPositiveCellCount !== 0) {
    throw new Error(
      `envelope-clamped shaping produced ${nonPositiveCellCount} nonpositive cells`,
    );
  }
  const { identity: _priorIdentity, ...outputDomain } = outputCarrier;
  outputCarrier.identity = {
    domain: 'canonical-json-self-excluding-top-level-identity',
    sha256: hashMuscleCompartmentRingCageCanonicalJson(outputDomain),
  };
  return {
    schema: 'kaminos.k4-envelope-clamped-section-shaping.v0',
    status: 'completed-provisional',
    shapeAuthority: 'envelope-fit-derived-provisional',
    claimCeiling: frameReceipt.claimCeiling,
    heldClaims: [...frameReceipt.heldClaims, 'anatomical-shape-authorship'],
    frameReceiptSha256: recordedReceiptSha256,
    sourceCarrierSha256: solverCarrier.identity.sha256,
    outputCarrierSha256: outputCarrier.identity.sha256,
    requested: structuredClone(config),
    effective: structuredClone(config),
    fallbackUsed: false,
    fixedNodeMaximumDrift,
    centerlineMaximumDrift,
    nonPositiveCellCount,
    sectionReceipts,
    outputCarrier,
  };
}

export function applyRouteRestorationTowardRest({
  frameReceipt,
  envelopeMesh,
  solverCarrier,
  config,
}) {
  if (frameReceipt?.schema !== FRAME_RECEIPT_SCHEMA) {
    throw new Error(`route restoration requires ${FRAME_RECEIPT_SCHEMA}`);
  }
  const { receiptSha256: recordedReceiptSha256, ...receiptDomain } = frameReceipt;
  if (recordedReceiptSha256 !== sha256(canonicalJson(receiptDomain))) {
    throw new Error('route restoration frame receipt identity mismatch');
  }
  if (!solverCarrier || solverCarrier.schema !== SOLVER_CARRIER_SCHEMA) {
    throw new Error('route restoration requires the admitted solver carrier schema');
  }
  const { identity: _identity, ...carrierDomain } = solverCarrier;
  if (solverCarrier.identity?.sha256 !==
      hashMuscleCompartmentRingCageCanonicalJson(carrierDomain)) {
    throw new Error('route restoration carrier identity mismatch');
  }
  const configKeys = Object.keys(config || {}).sort();
  const baseKeys = ['constructionId', 'containmentMargin', 'maximumBlend', 'sectionId'];
  const withExact = [...baseKeys, 'exactBlend'].sort();
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (JSON.stringify(configKeys) !== JSON.stringify([...baseKeys].sort()) &&
       JSON.stringify(configKeys) !== JSON.stringify(withExact)) ||
      typeof config.constructionId !== 'string' ||
      typeof config.sectionId !== 'string' ||
      !Number.isFinite(config.containmentMargin) ||
      !(config.containmentMargin >= 0) ||
      !Number.isFinite(config.maximumBlend) ||
      !(config.maximumBlend > 0 && config.maximumBlend <= 1) ||
      (config.exactBlend !== undefined && (!Number.isFinite(config.exactBlend) ||
        !(config.exactBlend >= 0 && config.exactBlend <= config.maximumBlend)))) {
    throw new Error('route restoration config is invalid');
  }
  const transform = frameReceipt.sourceToEnvelope.transform;
  const toEnvelope = point => applySimilarity(transform, point);
  const outputCarrier = structuredClone(solverCarrier);
  const cage = outputCarrier.cages.find(
    row => row.constructionId === config.constructionId,
  );
  if (!cage) throw new Error(`route restoration lacks construction ${config.constructionId}`);
  const fixedNodeIds = new Set((cage.manifest.constraints?.boundaryMasks || [])
    .filter(mask => mask.fixed === true)
    .map(mask => mask.nodeId));
  const sectionNodes = cage.manifest.nodes.filter(node =>
    node.id.startsWith(`${config.sectionId}:`));
  if (sectionNodes.length === 0) {
    throw new Error(`route restoration lacks section ${config.sectionId}`);
  }
  if (sectionNodes.some(node => fixedNodeIds.has(node.id))) {
    throw new Error(`route restoration refuses fixed section ${config.sectionId}`);
  }
  const axisNode = sectionNodes.find(node => node.id.endsWith(':axis'));
  if (!axisNode) throw new Error(`route restoration lacks axis for ${config.sectionId}`);
  const axisSignedDistanceBefore =
    signedEnvelopeDistance(toEnvelope(axisNode.currentPosition), envelopeMesh)
      .signedDistance;
  const blendedAxis = alpha => [0, 1, 2].map(axisIndex =>
    axisNode.currentPosition[axisIndex] +
    (axisNode.restPosition[axisIndex] - axisNode.currentPosition[axisIndex]) * alpha);
  const axisDistanceAt = alpha =>
    signedEnvelopeDistance(toEnvelope(blendedAxis(alpha)), envelopeMesh).signedDistance;
  const target = -config.containmentMargin;
  let appliedBlend;
  if (config.exactBlend !== undefined) {
    // Exact-blend mode generates intermediate states for frontier work; the
    // resulting containment state is reported, not required.
    appliedBlend = config.exactBlend;
  } else {
    if (!(axisDistanceAt(config.maximumBlend) <= target)) {
      throw new Error(
        `route restoration insufficient-blend-authority: blend cap ` +
        `${config.maximumBlend} reaches signed distance ` +
        `${axisDistanceAt(config.maximumBlend)}, above target ${target}`,
      );
    }
    let low = 0;
    let high = config.maximumBlend;
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const middle = (low + high) / 2;
      if (axisDistanceAt(middle) <= target) high = middle;
      else low = middle;
    }
    appliedBlend = high;
  }
  const originalPositions = new Map(sectionNodes.map(node =>
    [node.id, [...node.currentPosition]]));
  for (const node of sectionNodes) {
    node.currentPosition = [0, 1, 2].map(axisIndex =>
      node.currentPosition[axisIndex] +
      (node.restPosition[axisIndex] - node.currentPosition[axisIndex]) * appliedBlend);
  }
  const axisSignedDistanceAfter =
    signedEnvelopeDistance(toEnvelope(axisNode.currentPosition), envelopeMesh)
      .signedDistance;
  // Custody checks over the whole carrier.
  let fixedNodeMaximumDrift = 0;
  let nonPositiveCellCount = 0;
  for (const [cageIndex, outputCage] of outputCarrier.cages.entries()) {
    const sourceCage = solverCarrier.cages[cageIndex];
    const sourceById = new Map(sourceCage.manifest.nodes.map(node => [node.id, node]));
    const cageFixed = new Set((outputCage.manifest.constraints?.boundaryMasks || [])
      .filter(mask => mask.fixed === true)
      .map(mask => mask.nodeId));
    const positionById = new Map(outputCage.manifest.nodes.map(node => [node.id, node]));
    for (const node of outputCage.manifest.nodes) {
      if (!cageFixed.has(node.id)) continue;
      fixedNodeMaximumDrift = Math.max(fixedNodeMaximumDrift,
        norm(sub(node.currentPosition, sourceById.get(node.id).currentPosition)));
    }
    for (const cell of outputCage.manifest.cells) {
      const [a, b, c, d] = cell.nodeIds.map(nodeId =>
        positionById.get(nodeId).currentPosition);
      const oriented = signedTetVolume(a, b, c, d) * cell.restOrientationParity;
      if (!(oriented > SHAPING_EPSILON)) nonPositiveCellCount += 1;
    }
  }
  if (fixedNodeMaximumDrift !== 0) {
    throw new Error('route restoration violated fixed-node immutability');
  }
  if (nonPositiveCellCount !== 0) {
    throw new Error(
      `route restoration produced ${nonPositiveCellCount} nonpositive cells`,
    );
  }
  const { identity: _priorIdentity, ...outputDomain } = outputCarrier;
  outputCarrier.identity = {
    domain: 'canonical-json-self-excluding-top-level-identity',
    sha256: hashMuscleCompartmentRingCageCanonicalJson(outputDomain),
  };
  return {
    schema: 'kaminos.k4-route-restoration-toward-rest.v0',
    status: 'completed-provisional',
    routeAuthority: 'rest-restoring-packing-displacement-rollback',
    claimCeiling: frameReceipt.claimCeiling,
    frameReceiptSha256: recordedReceiptSha256,
    sourceCarrierSha256: solverCarrier.identity.sha256,
    outputCarrierSha256: outputCarrier.identity.sha256,
    requested: structuredClone(config),
    effective: { ...structuredClone(config), appliedBlend },
    fallbackUsed: false,
    appliedBlend,
    axisSignedDistanceBefore,
    axisSignedDistanceAfter,
    movedNodeIds: [...originalPositions.keys()].sort(),
    fixedNodeMaximumDrift,
    nonPositiveCellCount,
    outputCarrier,
  };
}

export function computeK4EnvelopeFitMetric({
  frameReceipt,
  envelopeMesh,
  solverCarrier,
}) {
  if (frameReceipt?.schema !== FRAME_RECEIPT_SCHEMA) {
    throw new Error(`envelope fit requires ${FRAME_RECEIPT_SCHEMA}`);
  }
  const { receiptSha256: recordedReceiptSha256, ...receiptDomain } = frameReceipt;
  const actualReceiptSha256 = sha256(canonicalJson(receiptDomain));
  if (recordedReceiptSha256 !== actualReceiptSha256) {
    throw new Error(
      `envelope fit frame receipt identity mismatch: recorded ` +
      `${recordedReceiptSha256 || 'missing'}, actual ${actualReceiptSha256}`,
    );
  }
  if (!solverCarrier || solverCarrier.schema !== SOLVER_CARRIER_SCHEMA) {
    throw new Error('envelope fit requires the admitted solver carrier schema');
  }
  const { identity: _identity, ...carrierDomain } = solverCarrier;
  const actualCarrierSha256 =
    hashMuscleCompartmentRingCageCanonicalJson(carrierDomain);
  if (solverCarrier.identity?.sha256 !== actualCarrierSha256) {
    throw new Error(
      `envelope fit carrier identity mismatch: recorded ` +
      `${solverCarrier.identity?.sha256 || 'missing'}, actual ${actualCarrierSha256}`,
    );
  }
  if (JSON.stringify(frameReceipt.effectiveConstructionIds) !==
      JSON.stringify(CONSTRUCTION_ORDER)) {
    throw new Error('envelope fit frame receipt construction order mismatch');
  }
  const transform = frameReceipt.sourceToEnvelope?.transform;
  if (!transform || !Number.isFinite(transform.scale) ||
      !Array.isArray(transform.rotation) || !Array.isArray(transform.translation)) {
    throw new Error('envelope fit frame receipt lacks a source-to-envelope transform');
  }
  const constructions = CONSTRUCTION_ORDER.map(constructionId => {
    const cage = solverCarrier.cages.find(
      row => row.constructionId === constructionId,
    );
    if (!cage) throw new Error(`envelope fit lacks construction ${constructionId}`);
    let insideCount = 0;
    let signedSum = 0;
    let maximumOutsideExcursion = 0;
    let maximumInsideDepth = 0;
    let boundaryNodeCount = 0;
    const samples = [];
    for (const node of cage.manifest.nodes) {
      if (node.id.endsWith(':axis')) continue;
      boundaryNodeCount += 1;
      const world = applySimilarity(transform, node.currentPosition);
      const fit = signedEnvelopeDistance(world, envelopeMesh);
      if (fit.inside) {
        insideCount += 1;
        maximumInsideDepth = Math.max(maximumInsideDepth, -fit.signedDistance);
      } else {
        maximumOutsideExcursion = Math.max(
          maximumOutsideExcursion,
          fit.signedDistance,
        );
      }
      signedSum += fit.signedDistance;
      samples.push({
        nodeId: node.id,
        envelopePosition: world,
        signedDistance: fit.signedDistance,
      });
    }
    return {
      constructionId,
      boundaryNodeCount,
      insideFraction: insideCount / boundaryNodeCount,
      meanSignedDistance: signedSum / boundaryNodeCount,
      maximumOutsideExcursion,
      maximumInsideDepth,
      samples,
    };
  });
  return {
    schema: K4_ENVELOPE_FIT_METRIC_SCHEMA,
    status: 'completed-provisional',
    claimCeiling: frameReceipt.claimCeiling,
    frameAuthority: frameReceipt.sourceToEnvelope.authority,
    heldClaims: [...frameReceipt.heldClaims],
    frameReceiptSha256: recordedReceiptSha256,
    sourceCarrierSha256: solverCarrier.identity.sha256,
    boundarySampleBasis:
      'cage boundary and ring nodes only; body interiors are not sampled',
    constructions,
  };
}

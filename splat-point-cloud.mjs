// PLY point-cloud parsing and splat crop math for cheap splat previews in the scene.
// Moved verbatim from index.html; the page imports what it uses.
import * as THREE from 'three';

function plyScalarReader(type) {
  const readers = {
    char: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
    int8: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
    uchar: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
    uint8: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
    short: { bytes: 2, read: (view, offset, little) => view.getInt16(offset, little) },
    int16: { bytes: 2, read: (view, offset, little) => view.getInt16(offset, little) },
    ushort: { bytes: 2, read: (view, offset, little) => view.getUint16(offset, little) },
    uint16: { bytes: 2, read: (view, offset, little) => view.getUint16(offset, little) },
    int: { bytes: 4, read: (view, offset, little) => view.getInt32(offset, little) },
    int32: { bytes: 4, read: (view, offset, little) => view.getInt32(offset, little) },
    uint: { bytes: 4, read: (view, offset, little) => view.getUint32(offset, little) },
    uint32: { bytes: 4, read: (view, offset, little) => view.getUint32(offset, little) },
    float: { bytes: 4, read: (view, offset, little) => view.getFloat32(offset, little) },
    float32: { bytes: 4, read: (view, offset, little) => view.getFloat32(offset, little) },
    double: { bytes: 8, read: (view, offset, little) => view.getFloat64(offset, little) },
    float64: { bytes: 8, read: (view, offset, little) => view.getFloat64(offset, little) },
  };
  return readers[String(type || '').toLowerCase()] || null;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function plyColorValue(value) {
  if (!Number.isFinite(value)) return null;
  return value > 1 ? clamp01(value / 255) : clamp01(value);
}

function plyShDcColorValue(value) {
  if (!Number.isFinite(value)) return null;
  return clamp01(0.5 + (0.28209479177387814 * value));
}

function parsePlyHeader(buffer) {
  const prefix = new TextDecoder('utf-8').decode(buffer.slice(0, Math.min(buffer.byteLength, 262144)));
  const endHeaderIndex = prefix.indexOf('end_header');
  if (endHeaderIndex < 0) throw new Error('PLY header missing end_header');
  const nextLineIndex = prefix.indexOf('\n', endHeaderIndex);
  const headerEndTextIndex = nextLineIndex >= 0 ? nextLineIndex + 1 : prefix.length;
  const headerText = prefix.slice(0, headerEndTextIndex);
  const headerBytes = new TextEncoder().encode(headerText).byteLength;
  const lines = headerText.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines[0] !== 'ply') throw new Error('not a PLY file');
  const formatLine = lines.find(line => line.startsWith('format '));
  const format = formatLine?.split(/\s+/)[1];
  if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format)) {
    throw new Error(`unsupported PLY format: ${format || 'missing'}`);
  }
  let currentElement = null;
  let vertexCount = 0;
  const vertexProperties = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'element') {
      currentElement = parts[1] || null;
      if (currentElement === 'vertex') vertexCount = Number.parseInt(parts[2] || '0', 10);
    } else if (parts[0] === 'property' && currentElement === 'vertex') {
      if (parts[1] === 'list') continue;
      vertexProperties.push({ type: parts[1], name: parts[2] });
    }
  }
  if (!Number.isFinite(vertexCount) || vertexCount < 1) throw new Error('PLY has no vertices');
  return { format, headerBytes, vertexCount, vertexProperties };
}

export function parsePlyPointCloud(buffer) {
  const header = parsePlyHeader(buffer);
  const propIndex = Object.fromEntries(header.vertexProperties.map((prop, index) => [prop.name, index]));
  for (const required of ['x', 'y', 'z']) {
    if (propIndex[required] === undefined) throw new Error(`PLY vertex property missing ${required}`);
  }
  const positions = new Float32Array(header.vertexCount * 3);
  const colors = new Float32Array(header.vertexCount * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const colorNames = [
    ['red', 'r', 'diffuse_red'],
    ['green', 'g', 'diffuse_green'],
    ['blue', 'b', 'diffuse_blue'],
  ];
  const shNames = ['f_dc_0', 'f_dc_1', 'f_dc_2'];
  const hasRgb = colorNames.every(names => names.some(name => propIndex[name] !== undefined));
  const hasShDc = shNames.every(name => propIndex[name] !== undefined);
  const readColor = (values, channel) => {
    if (hasRgb) {
      const colorIndex = colorNames[channel].map(name => propIndex[name]).find(index => index !== undefined);
      return plyColorValue(values[colorIndex]);
    }
    if (hasShDc) return plyShDcColorValue(values[propIndex[shNames[channel]]]);
    return [0.35, 0.85, 1][channel];
  };
  const writeVertex = (vertexIndex, values) => {
    const x = Number(values[propIndex.x]);
    const y = Number(values[propIndex.y]);
    const z = Number(values[propIndex.z]);
    if (![x, y, z].every(Number.isFinite)) throw new Error(`PLY vertex ${vertexIndex} has invalid position`);
    positions[vertexIndex * 3 + 0] = x;
    positions[vertexIndex * 3 + 1] = y;
    positions[vertexIndex * 3 + 2] = z;
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
    colors[vertexIndex * 3 + 0] = readColor(values, 0);
    colors[vertexIndex * 3 + 1] = readColor(values, 1);
    colors[vertexIndex * 3 + 2] = readColor(values, 2);
  };
  if (header.format === 'ascii') {
    const body = new TextDecoder('utf-8').decode(buffer.slice(header.headerBytes));
    const lines = body.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < header.vertexCount) throw new Error('PLY body has fewer vertices than header declares');
    for (let i = 0; i < header.vertexCount; i++) {
      writeVertex(i, lines[i].trim().split(/\s+/).map(Number));
    }
  } else {
    const littleEndian = header.format === 'binary_little_endian';
    const view = new DataView(buffer);
    const readers = header.vertexProperties.map(prop => {
      const reader = plyScalarReader(prop.type);
      if (!reader) throw new Error(`unsupported PLY property type: ${prop.type}`);
      return reader;
    });
    let offset = header.headerBytes;
    for (let i = 0; i < header.vertexCount; i++) {
      const values = [];
      for (const reader of readers) {
        values.push(reader.read(view, offset, littleEndian));
        offset += reader.bytes;
      }
      writeVertex(i, values);
    }
  }
  const center = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ];
  const size = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];
  const maxExtent = Math.max(size[0], size[1], size[2], 1e-6);
  const scale = 2 / maxExtent;
  for (let i = 0; i < header.vertexCount; i++) {
    positions[i * 3 + 0] = (positions[i * 3 + 0] - center[0]) * scale;
    positions[i * 3 + 1] = (positions[i * 3 + 1] - center[1]) * scale;
    positions[i * 3 + 2] = (positions[i * 3 + 2] - center[2]) * scale;
  }
  return {
    format: header.format,
    pointCount: header.vertexCount,
    positions,
    colors,
    bounds: { min, max, center, size },
    colorSource: hasRgb ? 'rgb' : (hasShDc ? 'sh-dc' : 'fallback'),
  };
}

export function createSplatPointSubsetGeometry(sourcePositions, sourceColors, indices = null) {
  const pointCount = indices ? indices.length : Math.floor(sourcePositions.length / 3);
  const positions = indices ? new Float32Array(pointCount * 3) : sourcePositions;
  const colors = indices ? new Float32Array(pointCount * 3) : sourceColors;
  if (indices) {
    indices.forEach((sourceIndex, targetIndex) => {
      const sourceOffset = sourceIndex * 3;
      const targetOffset = targetIndex * 3;
      positions[targetOffset + 0] = sourcePositions[sourceOffset + 0];
      positions[targetOffset + 1] = sourcePositions[sourceOffset + 1];
      positions[targetOffset + 2] = sourcePositions[sourceOffset + 2];
      colors[targetOffset + 0] = sourceColors[sourceOffset + 0];
      colors[targetOffset + 1] = sourceColors[sourceOffset + 1];
      colors[targetOffset + 2] = sourceColors[sourceOffset + 2];
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (pointCount > 0) geometry.computeBoundingSphere();
  return geometry;
}

export function replaceSplatPointGeometry(points, geometry) {
  points.geometry?.dispose?.();
  points.geometry = geometry;
}

function splatCropPointCoordinates(positions, index, correction, frame = 'axis-flipped-asset') {
  const offset = index * 3;
  if (frame === 'raw-normalized') {
    return [
      positions[offset + 0],
      positions[offset + 1],
      positions[offset + 2],
    ];
  }
  const coordinates = [
    positions[offset + 0] * correction.axisFlips[0],
    positions[offset + 1] * correction.axisFlips[1],
    positions[offset + 2] * correction.axisFlips[2],
  ];
  if (frame === 'pivot-local-minus-centroid') {
    return coordinates.map((value, axis) => value - correction.centroidOffset[axis]);
  }
  return coordinates;
}

export function splatPointInsideCrop(positions, index, correction, cropMin, cropMax, frame = 'axis-flipped-asset') {
  const [x, y, z] = splatCropPointCoordinates(positions, index, correction, frame);
  return x >= cropMin[0] && x <= cropMax[0]
    && y >= cropMin[1] && y <= cropMax[1]
    && z >= cropMin[2] && z <= cropMax[2];
}

function countSplatCropFrame(sourcePositions, pointCount, correction, cropMin, cropMax, frame) {
  let count = 0;
  for (let index = 0; index < pointCount; index++) {
    if (splatPointInsideCrop(sourcePositions, index, correction, cropMin, cropMax, frame)) count++;
  }
  return count;
}

export function chooseSplatCropFrame(preview, correction, cropMin, cropMax) {
  const canonicalFrame = 'axis-flipped-asset';
  const canonicalCount = countSplatCropFrame(
    preview.sourcePositions,
    preview.totalPointCount,
    correction,
    cropMin,
    cropMax,
    canonicalFrame,
  );
  if (canonicalCount > 0) {
    return { frame: canonicalFrame, includedPointCount: canonicalCount, canonicalPointCount: canonicalCount };
  }
  const hasCentroidOffset = correction.centroidOffset.some(value => Math.abs(value) > 1e-9);
  if (!hasCentroidOffset) {
    return { frame: canonicalFrame, includedPointCount: canonicalCount, canonicalPointCount: canonicalCount };
  }
  const legacyCandidates = [
    {
      frame: 'pivot-local-minus-centroid',
      includedPointCount: countSplatCropFrame(
        preview.sourcePositions,
        preview.totalPointCount,
        correction,
        cropMin,
        cropMax,
        'pivot-local-minus-centroid',
      ),
    },
    {
      frame: 'raw-normalized',
      includedPointCount: countSplatCropFrame(
        preview.sourcePositions,
        preview.totalPointCount,
        correction,
        cropMin,
        cropMax,
        'raw-normalized',
      ),
    },
  ];
  const bestLegacy = legacyCandidates.reduce((best, candidate) => (
    candidate.includedPointCount > best.includedPointCount ? candidate : best
  ), legacyCandidates[0]);
  if (bestLegacy.includedPointCount > 0) {
    return {
      frame: bestLegacy.frame,
      includedPointCount: bestLegacy.includedPointCount,
      canonicalPointCount: canonicalCount,
      pivotLocalPointCount: legacyCandidates.find(candidate => candidate.frame === 'pivot-local-minus-centroid')?.includedPointCount ?? 0,
      rawNormalizedPointCount: legacyCandidates.find(candidate => candidate.frame === 'raw-normalized')?.includedPointCount ?? 0,
    };
  }
  return {
    frame: canonicalFrame,
    includedPointCount: canonicalCount,
    canonicalPointCount: canonicalCount,
    pivotLocalPointCount: legacyCandidates.find(candidate => candidate.frame === 'pivot-local-minus-centroid')?.includedPointCount ?? 0,
    rawNormalizedPointCount: legacyCandidates.find(candidate => candidate.frame === 'raw-normalized')?.includedPointCount ?? 0,
  };
}

#!/usr/bin/env node
/**
 * Measure Tier 2 morphological relations for a source/envelope pair and emit a
 * comparison receipt.
 *
 * Reports source value, envelope value, and delta. Emits no verdict: Tier 2 is
 * instrumented, not gated.
 *
 * Records requested and effective input identity, including SHA-256 of every
 * consumed artifact, so a stale or substituted mesh cannot pass as evidence.
 * If measurement fails before the receipt is written, a durable failure record
 * naming the phase is written instead.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  CAT_ANATOMICAL_FRAME,
  axialProfile,
  compareRelations,
  proportionalRelations,
} from '../envelope-relation-measure-core.mjs';

const SCHEMA = 'kaminos.envelope-relation-comparison.v0';
const FAILURE_SCHEMA = 'kaminos.envelope-relation-comparison-failure.v0';
const MEASURER_ID = 'envelope-relation-axial-profile-v0';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Minimal GLB reader: extracts POSITION accessors and triangle indices. */
function readGlbMesh(path) {
  const buffer = readFileSync(path);
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`not a GLB: ${path}`);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (chunkType === 0x004e4942) bin = chunk;
    offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (!json || !bin) throw new Error(`GLB missing JSON or BIN chunk: ${path}`);

  const COMPONENT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
    5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
  const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  const readAccessor = (index) => {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView];
    const [Ctor, size] = COMPONENT[accessor.componentType];
    const components = COUNT[accessor.type];
    const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? components * size;
    const out = [];
    for (let i = 0; i < accessor.count; i += 1) {
      const start = base + i * stride;
      const slice = new Ctor(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + components * size));
      out.push(components === 1 ? slice[0] : Array.from(slice));
    }
    return out;
  };

  const positions = [];
  const triangles = [];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const offsetBase = positions.length;
      positions.push(...readAccessor(primitive.attributes.POSITION));
      if (primitive.indices === undefined) {
        for (let i = offsetBase; i + 2 < positions.length; i += 3) triangles.push([i, i + 1, i + 2]);
      } else {
        const indices = readAccessor(primitive.indices);
        for (let i = 0; i + 2 < indices.length; i += 3) {
          triangles.push([indices[i] + offsetBase, indices[i + 1] + offsetBase, indices[i + 2] + offsetBase]);
        }
      }
    }
  }
  if (triangles.length === 0) throw new Error(`GLB contains no triangles: ${path}`);
  return { positions, triangles };
}

/**
 * Build a source mesh from a classification's per-object world bounds.
 *
 * This is an explicit approximation: each admitted object contributes its
 * axis-aligned bounding box, not its true surface. It is sufficient for
 * low-frequency proportional relations and is labeled as such in the receipt so
 * it can never be mistaken for a surface-accurate measurement.
 */
function readClassificationBoxes(path) {
  const classification = JSON.parse(readFileSync(path, 'utf8'));
  if (classification.status !== 'completed') throw new Error('classification is not completed');
  const admitted = classification.admittedObjects;
  if (!Array.isArray(admitted) || admitted.length === 0) {
    throw new Error('classification contains no admitted source objects');
  }
  const positions = [];
  const triangles = [];
  for (const record of admitted) {
    const bounds = record.worldBounds;
    if (!bounds) throw new Error(`admitted object lacks worldBounds: ${record.name}`);
    const [x0, y0, z0] = bounds.min;
    const [x1, y1, z1] = bounds.max;
    const base = positions.length;
    positions.push([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    for (const face of [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
      [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]]) {
      triangles.push([face[0] + base, face[1] + base, face[2] + base]);
    }
  }
  return {
    mesh: { positions, triangles },
    admittedObjectCount: admitted.length,
    schema: classification.schema,
    sourceSha256: classification.source?.sha256 ?? null,
  };
}

/**
 * Read exported evaluated source surfaces.
 *
 * This is the accurate source route. Bounding boxes systematically overestimate
 * thin diagonal structures such as long limb bones, so any relation that
 * depends on mass distribution needs true surfaces.
 */
function readExportedSurfaces(path) {
  const payload = JSON.parse(readFileSync(path, 'utf8'));
  if (payload.schema !== 'kaminos.admitted-surface-export.v0') {
    throw new Error(`unexpected surface export schema: ${payload.schema}`);
  }
  if (!Array.isArray(payload.positions) || !Array.isArray(payload.triangles)) {
    throw new Error('surface export lacks positions or triangles');
  }
  if (payload.triangles.length === 0) {
    throw new Error('surface export contains no triangles');
  }
  return {
    mesh: { positions: payload.positions, triangles: payload.triangles },
    objectCount: Array.isArray(payload.objects) ? payload.objects.length : null,
    declaredSourceSha256: payload.source?.sha256 ?? null,
  };
}

function parseArguments(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.envelope || !args.out) {
    throw new Error('--envelope and --out are required');
  }
  if (!args.surfaces && !args.classification) {
    throw new Error('one of --surfaces (accurate) or --classification (bounding-box approximation) is required');
  }
  return args;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const envelopePath = resolve(args.envelope);
  const outPath = resolve(args.out);
  const sliceCount = args['slice-count'] ? Number(args['slice-count']) : 48;

  const usingSurfaces = Boolean(args.surfaces);
  const sourcePath = resolve(usingSurfaces ? args.surfaces : args.classification);
  const source = usingSurfaces
    ? readExportedSurfaces(sourcePath)
    : readClassificationBoxes(sourcePath);
  const envelopeMesh = readGlbMesh(envelopePath);

  const sourceProfile = axialProfile(source.mesh, { sliceCount, frame: CAT_ANATOMICAL_FRAME });
  const envelopeProfile = axialProfile(envelopeMesh, { sliceCount, frame: CAT_ANATOMICAL_FRAME });
  const sourceRelations = proportionalRelations(sourceProfile);
  const envelopeRelations = proportionalRelations(envelopeProfile);
  const comparison = compareRelations(sourceRelations, envelopeRelations);

  const receipt = {
    schema: SCHEMA,
    measurerId: MEASURER_ID,
    status: 'completed',
    verdict: null,
    verdictNote: 'Tier 2 relations are instrumented, not gated. No threshold is asserted.',
    sourceRepresentation: usingSurfaces
      ? 'evaluated source surface triangles'
      : 'APPROXIMATION: per-object axis-aligned bounding boxes from classification worldBounds; overestimates thin diagonal structures',
    frame: {
      right: [...CAT_ANATOMICAL_FRAME.right],
      anterior: [...CAT_ANATOMICAL_FRAME.anterior],
      dorsal: [...CAT_ANATOMICAL_FRAME.dorsal],
      basis: 'measured asset axes, not convention-guessed',
    },
    inputs: {
      source: {
        route: usingSurfaces ? 'exported-surfaces' : 'classification-bounding-boxes',
        requestedPath: usingSurfaces ? args.surfaces : args.classification,
        effectivePath: sourcePath,
        sha256: sha256(sourcePath),
        objectCount: source.objectCount ?? source.admittedObjectCount ?? null,
        declaredSourceSha256: source.declaredSourceSha256 ?? source.sourceSha256 ?? null,
        triangleCount: source.mesh.triangles.length,
      },
      envelope: {
        requestedPath: args.envelope,
        effectivePath: envelopePath,
        sha256: sha256(envelopePath),
        vertexCount: envelopeMesh.positions.length,
        triangleCount: envelopeMesh.triangles.length,
      },
    },
    parameters: { sliceCount },
    sourceRelations,
    envelopeRelations,
    comparison,
    profiles: {
      source: { axialSpan: sourceProfile.axialSpan, totalArea: sourceProfile.totalArea },
      envelope: { axialSpan: envelopeProfile.axialSpan, totalArea: envelopeProfile.totalArea },
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ status: 'completed', receipt: outPath }, null, 2)}\n`);
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  const failureTarget = process.env.KAMINOS_ENVELOPE_RELATION_FAILURE;
  if (failureTarget) {
    mkdirSync(dirname(resolve(failureTarget)), { recursive: true });
    writeFileSync(resolve(failureTarget), `${JSON.stringify({
      schema: FAILURE_SCHEMA,
      measurerId: MEASURER_ID,
      status: 'failed',
      failurePhase: 'envelope-relation-measure',
      error: String(error && error.message ? error.message : error),
      lastTrustworthyEvidence: 'inputs resolved; no relation receipt was emitted',
    }, null, 2)}\n`, 'utf8');
  }
  process.stderr.write(`${String(error && error.message ? error.message : error)}\n`);
  process.exit(1);
}

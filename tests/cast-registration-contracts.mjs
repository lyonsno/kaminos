import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CAST_REGISTRATION_RECEIPT_SCHEMA,
  buildCastRegistrationReceipt,
  castRegistrationReceiptIdentity,
  parseGlbGeometry,
  registerMeshes,
  runCastRegistration,
  validateCastRegistrationReceipt,
} from '../cast-registration-core.mjs';

// --- deterministic synthetic geometry -------------------------------------

// Seeded LCG so fixtures are bit-stable across runs and machines.
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Deterministic blobby closed surface: subdivided cube projected to a sphere,
// radius modulated by seeded noise. Irregular enough that registration has a
// unique optimum, cheap enough to solve in-test.
function syntheticBlob({ seed = 7, segments = 12, radius = 1 } = {}) {
  const rand = lcg(seed);
  const bump = [];
  for (let i = 0; i < 32; i += 1) {
    const dir = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
    const len = Math.hypot(...dir) || 1;
    bump.push({ dir: dir.map(c => c / len), amp: 0.08 + rand() * 0.12, sharp: 2 + rand() * 6 });
  }
  const displace = p => {
    const len = Math.hypot(...p) || 1;
    const unit = p.map(c => c / len);
    let r = radius;
    for (const { dir, amp, sharp } of bump) {
      const d = unit[0] * dir[0] + unit[1] * dir[1] + unit[2] * dir[2];
      r += amp * Math.exp(sharp * (d - 1));
    }
    return unit.map(c => c * r);
  };
  const positions = [];
  const triangles = [];
  const faceAxes = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ];
  for (const [normal, uAxis, vAxis] of faceAxes) {
    const base = positions.length / 3;
    for (let iv = 0; iv <= segments; iv += 1) {
      for (let iu = 0; iu <= segments; iu += 1) {
        const u = (iu / segments) * 2 - 1;
        const v = (iv / segments) * 2 - 1;
        const p = [0, 1, 2].map(k => normal[k] + u * uAxis[k] + v * vAxis[k]);
        positions.push(...displace(p));
      }
    }
    for (let iv = 0; iv < segments; iv += 1) {
      for (let iu = 0; iu < segments; iu += 1) {
        const a = base + iv * (segments + 1) + iu;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        triangles.push(a, b, d, a, d, c);
      }
    }
  }
  return {
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
  };
}

function applySimilarity(geometry, { scale, rotation, translation }) {
  const out = new Float64Array(geometry.positions.length);
  for (let i = 0; i < geometry.positions.length; i += 3) {
    const p = [geometry.positions[i], geometry.positions[i + 1], geometry.positions[i + 2]];
    for (let r = 0; r < 3; r += 1) {
      out[i + r] = scale * (
        rotation[r][0] * p[0] + rotation[r][1] * p[1] + rotation[r][2] * p[2]
      ) + translation[r];
    }
  }
  return { positions: out, triangles: geometry.triangles.slice() };
}

function axisAngleRotation(axis, angle) {
  const len = Math.hypot(...axis) || 1;
  const [x, y, z] = axis.map(c => c / len);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

const KNOWN = {
  scale: 1.37,
  rotation: axisAngleRotation([0.3, 1, 0.2], 0.62),
  translation: [0.4, -1.1, 2.3],
};

// Non-uniform stretch is OUTSIDE the similarity class: used to prove
// registration freedom cannot launder real shape differences.
function stretchAxis(geometry, axis, factor) {
  const out = geometry.positions.slice();
  for (let i = axis; i < out.length; i += 3) out[i] *= factor;
  return { positions: out, triangles: geometry.triangles.slice() };
}

// --- minimal in-test GLB builder ------------------------------------------

// One triangle, under a node with a uniform-scale transform, so the parser
// must honor node hierarchies rather than reading raw accessor bytes.
function tinyGlb({ nodeScale = 2 } = {}) {
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = Uint16Array.from([0, 1, 2]);
  const positionBytes = Buffer.from(positions.buffer);
  const indexBytes = Buffer.from(indices.buffer);
  const pad4 = buf => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  const bin = Buffer.concat([pad4(positionBytes), pad4(indexBytes)]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, scale: [nodeScale, nodeScale, nodeScale] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
      { buffer: 0, byteOffset: pad4(positionBytes).length, byteLength: indexBytes.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]);
}

// --- contracts -------------------------------------------------------------

test('receipt schema constant is exact', () => {
  assert.equal(CAST_REGISTRATION_RECEIPT_SCHEMA, 'kaminos.cast-registration-receipt.v0');
});

test('parseGlbGeometry honors node transforms and yields world-space triangles', () => {
  const geometry = parseGlbGeometry(tinyGlb({ nodeScale: 2 }));
  assert.equal(geometry.vertexCount, 3);
  assert.equal(geometry.triangleCount, 1);
  // Node scale 2 applied: vertex (1,0,0) -> (2,0,0).
  const xs = [geometry.positions[0], geometry.positions[3], geometry.positions[6]];
  assert.ok(xs.includes(2), `expected a world-space x of 2, got ${xs}`);
});

test('registerMeshes recovers a known similarity transform on identical shape', () => {
  const source = syntheticBlob();
  const target = applySimilarity(source, KNOWN);
  const result = registerMeshes({ source, target, sampleCount: 1500 });
  assert.ok(result.converged, 'solver must report convergence');
  assert.ok(Math.abs(result.transform.scale - KNOWN.scale) < 1e-3,
    `scale ${result.transform.scale} != ${KNOWN.scale}`);
  for (let r = 0; r < 3; r += 1) {
    assert.ok(Math.abs(result.transform.translation[r] - KNOWN.translation[r]) < 5e-3,
      `translation[${r}] ${result.transform.translation[r]} != ${KNOWN.translation[r]}`);
    for (let c = 0; c < 3; c += 1) {
      assert.ok(Math.abs(result.transform.rotation[r][c] - KNOWN.rotation[r][c]) < 1e-3,
        `rotation[${r}][${c}] off`);
    }
  }
  assert.ok(result.residuals.q95 < 1e-4,
    `same-shape q95 residual should be near zero, got ${result.residuals.q95}`);
});

test('similarity freedom cannot launder a non-uniform shape edit', () => {
  const source = syntheticBlob();
  const sameShape = registerMeshes({
    source, target: applySimilarity(source, KNOWN), sampleCount: 1500,
  });
  const edited = applySimilarity(stretchAxis(source, 1, 1.25), KNOWN);
  const crossShape = registerMeshes({ source, target: edited, sampleCount: 1500 });
  assert.ok(crossShape.residuals.q95 > 0.02,
    `stretched-shape q95 must stay materially nonzero, got ${crossShape.residuals.q95}`);
  assert.ok(crossShape.residuals.q95 > sameShape.residuals.q95 * 50,
    'shape edit must dominate same-shape floor');
});

test('registration is deterministic: identical inputs, identical receipt identity', () => {
  const source = syntheticBlob();
  const target = applySimilarity(source, KNOWN);
  const run = () => {
    const result = registerMeshes({ source, target, sampleCount: 800 });
    return buildCastRegistrationReceipt({
      sourceLabel: 'synthetic-envelope',
      targetLabel: 'synthetic-cast',
      sourceSha256: 'a'.repeat(64),
      targetSha256: 'b'.repeat(64),
      effectiveRoute: 'contract-test',
      result,
    });
  };
  const first = run();
  const second = run();
  assert.equal(castRegistrationReceiptIdentity(first), castRegistrationReceiptIdentity(second));
});

test('receipt identity excludes wall-clock fields', () => {
  const source = syntheticBlob();
  const result = registerMeshes({
    source, target: applySimilarity(source, KNOWN), sampleCount: 800,
  });
  const receipt = buildCastRegistrationReceipt({
    sourceLabel: 'synthetic-envelope',
    targetLabel: 'synthetic-cast',
    sourceSha256: 'a'.repeat(64),
    targetSha256: 'b'.repeat(64),
    effectiveRoute: 'contract-test',
    result,
  });
  const mutated = { ...receipt, generatedAt: '1999-01-01T00:00:00.000Z' };
  assert.equal(castRegistrationReceiptIdentity(receipt), castRegistrationReceiptIdentity(mutated));
});

test('receipt validates required fields and rejects mutations', () => {
  const source = syntheticBlob();
  const result = registerMeshes({
    source, target: applySimilarity(source, KNOWN), sampleCount: 800,
  });
  const receipt = buildCastRegistrationReceipt({
    sourceLabel: 'synthetic-envelope',
    targetLabel: 'synthetic-cast',
    sourceSha256: 'a'.repeat(64),
    targetSha256: 'b'.repeat(64),
    effectiveRoute: 'contract-test',
    result,
  });
  validateCastRegistrationReceipt(receipt);
  assert.equal(receipt.schema, CAST_REGISTRATION_RECEIPT_SCHEMA);
  assert.match(receipt.inputs.sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(receipt.inputs.targetSha256, /^[0-9a-f]{64}$/);
  assert.equal(typeof receipt.registration.iterations, 'number');
  assert.equal(typeof receipt.registration.sampleCount, 'number');
  assert.ok(Array.isArray(receipt.refinements), 'bounded per-limb refinement array must exist');
  assert.equal(receipt.refinements.length, 0, 'global-only receipt has empty refinements');
  assert.equal(receipt.registration.residualField.distances.length, 800,
    'restrictable residual field must cover every sample');
  for (const broken of [
    { ...receipt, schema: 'kaminos.other.v0' },
    { ...receipt, inputs: { ...receipt.inputs, sourceSha256: 'zz' } },
    { ...receipt, registration: { ...receipt.registration, residuals: undefined } },
    { ...receipt, registration: { ...receipt.registration, residualField: undefined } },
    {
      ...receipt,
      registration: {
        ...receipt.registration,
        residualField: {
          ...receipt.registration.residualField,
          distances: receipt.registration.residualField.distances.slice(0, 10),
        },
      },
    },
    { ...receipt, refinements: undefined },
  ]) {
    assert.throws(() => validateCastRegistrationReceipt(broken));
  }
});

test('runCastRegistration fails loud with a phase-named durable report on a missing input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cast-reg-'));
  const outputPath = join(dir, 'receipt.json');
  await assert.rejects(
    runCastRegistration({
      sourcePath: join(dir, 'missing-envelope.glb'),
      targetPath: join(dir, 'missing-cast.glb'),
      outputPath,
    }),
    /read-inputs/,
  );
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'read-inputs');
  assert.equal(report.schema, CAST_REGISTRATION_RECEIPT_SCHEMA);
});

test('degenerate and non-finite geometry fail loud with named phases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cast-reg-'));
  const goodPath = join(dir, 'good.glb');
  await writeFile(goodPath, tinyGlb());
  // Degenerate: GLB whose mesh has zero triangles.
  const flat = tinyGlb();
  const emptyGeometry = { positions: new Float64Array(0), triangles: new Uint32Array(0) };
  assert.throws(
    () => registerMeshes({ source: emptyGeometry, target: emptyGeometry, sampleCount: 10 }),
    /degenerate-geometry/,
  );
  const nanGeometry = {
    positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, Number.NaN, 0]),
    triangles: Uint32Array.from([0, 1, 2]),
  };
  assert.throws(
    () => registerMeshes({
      source: nanGeometry, target: parseGlbGeometry(flat), sampleCount: 10,
    }),
    /non-finite-geometry/,
  );
});

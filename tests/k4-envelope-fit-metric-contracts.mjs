import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  computeK4EnvelopeFitMetric,
  parseGlbTriangleSoup,
  signedEnvelopeDistance,
} from '../k4-envelope-fit-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(REPO_ROOT, 'tools/run-k4-envelope-fit-metric.mjs');
const RECEIPT = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-v0/receipt.json',
);
const ENVELOPE = path.join(
  REPO_ROOT,
  'artifacts/source-shaped-k4-envelope-frame-binding-visual-v0/envelope-baseline.glb',
);
const REFERENCE_CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
);
const KNEE_CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-m12-volume-restoration-solve-v0/candidates/' +
  'restore-e002-ramp-a090-a094-repay-6789-cn094-packed-carrier.json',
);

// A unit cube GLB whose node transform includes a NEGATIVE uniform scale and a
// rotation, pinning the orientation-proof containment sign.
function cubeGlb({ scale = -2, translation = [1, 2, 3] } = {}) {
  const positions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
  ]);
  const positionBytes = Buffer.from(positions.buffer);
  const indexBytes = Buffer.from(indices.buffer);
  const binPadded = Buffer.concat([
    positionBytes,
    indexBytes,
    Buffer.alloc((4 - ((positionBytes.length + indexBytes.length) % 4)) % 4),
  ]);
  const doc = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{
      mesh: 0,
      scale: [scale, scale, scale],
      rotation: [0.7071067811865476, 0, 0, 0.7071067811865476],
      translation,
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: 8, type: 'VEC3',
        min: [-1, -1, -1], max: [1, 1, 1],
      },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length },
    ],
    buffers: [{ byteLength: binPadded.length }],
  };
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, binPadded]);
}

test('signed envelope distance is orientation-proof under negative node scale', () => {
  const mesh = parseGlbTriangleSoup(cubeGlb());
  assert.equal(mesh.triangles.length, 12);
  // World cube: |scale| = 2 around translation, so center is deep inside and a
  // far point is outside regardless of the winding flip from the negative scale.
  const inside = signedEnvelopeDistance([1, 2, 3], mesh);
  const outside = signedEnvelopeDistance([1, 2, 3 + 10], mesh);
  assert.ok(inside.signedDistance < 0, `center should be inside: ${inside.signedDistance}`);
  assert.ok(Math.abs(Math.abs(inside.signedDistance) - 2) < 1e-3);
  assert.ok(outside.signedDistance > 0, `far point should be outside: ${outside.signedDistance}`);
  assert.ok(Math.abs(outside.signedDistance - 8) < 1e-3);
});

test('the metric preserves exact construction order and per-body accounting', async () => {
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  const carrier = JSON.parse(await readFile(REFERENCE_CARRIER, 'utf8'));
  const mesh = parseGlbTriangleSoup(await readFile(ENVELOPE));
  const metric = computeK4EnvelopeFitMetric({
    frameReceipt: receipt,
    envelopeMesh: mesh,
    solverCarrier: carrier,
  });
  assert.deepEqual(
    metric.constructions.map(row => row.constructionId),
    ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'],
  );
  for (const row of metric.constructions) {
    assert.ok(row.boundaryNodeCount > 0);
    assert.ok(row.insideFraction >= 0 && row.insideFraction <= 1);
    assert.ok(Number.isFinite(row.meanSignedDistance));
    assert.ok(row.maximumOutsideExcursion >= 0);
    assert.ok(row.maximumInsideDepth >= 0);
  }
  assert.equal(metric.frameAuthority, 'fit-derived-provisional');
  assert.equal(metric.claimCeiling, 'metric-mechanism-only');
  assert.equal(metric.sourceCarrierSha256, carrier.identity.sha256);
});

test('the metric refuses a tampered frame receipt instead of emitting numbers', async () => {
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  receipt.sourceToEnvelope.transform.scale *= 1.01;
  const carrier = JSON.parse(await readFile(REFERENCE_CARRIER, 'utf8'));
  const mesh = parseGlbTriangleSoup(await readFile(ENVELOPE));
  assert.throws(() => computeK4EnvelopeFitMetric({
    frameReceipt: receipt,
    envelopeMesh: mesh,
    solverCarrier: carrier,
  }), /receipt identity mismatch/);
});

test('the CLI binds both carriers, both hashes, and a durable comparison', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-envfit-'));
  const result = spawnSync(process.execPath, [
    TOOL,
    '--frame-receipt', RECEIPT,
    '--envelope', ENVELOPE,
    '--carrier', `reference=${REFERENCE_CARRIER}`,
    '--carrier', `restoration-knee=${KNEE_CARRIER}`,
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
  const metric = JSON.parse(
    await readFile(path.join(output, 'envelope-fit-metric.json'), 'utf8'),
  );
  assert.equal(report.status, 'completed');
  assert.deepEqual(metric.rows.map(row => row.id), ['reference', 'restoration-knee']);
  for (const row of metric.rows) {
    assert.deepEqual(
      row.metric.constructions.map(entry => entry.constructionId),
      ['muscle-34', 'muscle-13', 'muscle-12', 'muscle-45'],
    );
  }
  assert.equal(metric.frameAuthority, 'fit-derived-provisional');
  assert.equal(metric.claimCeiling, 'metric-mechanism-only');
  assert.ok(Array.isArray(metric.sectionOverlays) && metric.sectionOverlays.length >= 3);
  for (const overlay of metric.sectionOverlays) {
    const svg = await readFile(path.join(output, overlay.path), 'utf8');
    assert.ok(svg.includes('<svg'));
  }
});

test('a CLI failure before metric output writes a durable failure report', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-envfit-fail-'));
  const badReceipt = path.join(output, 'input', 'bad-receipt.json');
  await mkdir(path.dirname(badReceipt), { recursive: true });
  await writeFile(badReceipt, '{"schema":"wrong"}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--frame-receipt', badReceipt,
    '--envelope', ENVELOPE,
    '--carrier', `reference=${REFERENCE_CARRIER}`,
    '--output', path.join(output, 'out'),
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(
    await readFile(path.join(output, 'out', 'run-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'failed');
  assert.ok(report.failurePhase);
  await assert.rejects(
    readFile(path.join(output, 'out', 'envelope-fit-metric.json')),
    /ENOENT/,
  );
});

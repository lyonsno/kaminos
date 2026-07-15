import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  assertCleanJob,
  assertUsefulPngEvidence,
  inspectPngEvidence,
} from '../artifacts/lirm-trellis-multisource-sparse-guidance-v1/evidence-admission.mjs';

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  return crc >>> 0;
});
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const kind = Buffer.from(type);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([header, kind, data, checksum]);
};
const rgbaPng = (width, height, pixel) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const rgba = pixel(x, y);
      row.set(rgba, 1 + x * 4);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const expectedIdentity = {
  jobType: 'trellis2mlx_molten_sparse_pressure_ee75fdb',
  effectiveCwd: '/private/tmp/trellis2mlx-molten-shape-guidance-pressure-0715',
};
const clean = {
  status: 'done',
  exit_code: 0,
  failure_phase: null,
  error_message: null,
  warnings: null,
  ignored_params: null,
  job_type: expectedIdentity.jobType,
  effective_cwd: expectedIdentity.effectiveCwd,
};

assert.doesNotThrow(() => assertCleanJob(clean, expectedIdentity));
for (const [label, mutation] of [
  ['failed status', { status: 'failed' }],
  ['nonzero exit', { exit_code: 137 }],
  ['failure phase', { failure_phase: 'execution' }],
  ['warnings', { warnings: ['fallback runner'] }],
  ['ignored params', { ignored_params: ['sparse_guidance_strength'] }],
  ['wrong job type', { job_type: 'trellis2mlx_legacy' }],
  ['wrong worktree', { effective_cwd: '/Users/noahlyons/dev/trellis2mlx' }],
]) {
  assert.throws(
    () => assertCleanJob({ ...clean, ...mutation }, expectedIdentity),
    undefined,
    `${label} must fail before evidence assembly`,
  );
}

const uniform = rgbaPng(32, 32, () => [80, 80, 80, 255]);
const horizonOnly = rgbaPng(32, 32, (_x, y) => y < 16 ? [8, 8, 8, 255] : [130, 130, 130, 255]);
const occupied = rgbaPng(32, 32, (x, y) => {
  const dx = x - 16;
  const dy = y - 15;
  if ((dx * dx) / 81 + (dy * dy) / 49 < 1) return [175, 62 + x * 2, 35 + y, 255];
  return y < 23 ? [8, 8, 8, 255] : [105, 100, 92, 255];
});

for (const [label, png] of [['uniform', uniform], ['horizon-only', horizonOnly]]) {
  const evidence = inspectPngEvidence(png);
  assert.throws(
    () => assertUsefulPngEvidence(evidence, { minWidth: 32, minHeight: 32 }),
    undefined,
    `${label} image must not be admitted as a creature witness`,
  );
}
const evidence = inspectPngEvidence(occupied);
assert.doesNotThrow(() => assertUsefulPngEvidence(evidence, { minWidth: 32, minHeight: 32 }));
assert.ok(evidence.activePixelRatio > 0.05);
assert.ok(evidence.activeBoundsRatio > 0.05);
assert.ok(evidence.edgeRatio > 0.002);

console.log('LIRM Trellis multisource evidence-admission contracts passed');

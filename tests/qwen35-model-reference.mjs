// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen35-model-source-'));
try {
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ model_type: 'qwen3_5', quantization: { bits: 4, group_size: 64, mode: 'affine' } }));
  const header = Buffer.from(JSON.stringify({ 'language_model.model.norm.weight': { dtype: 'BF16', shape: [1], data_offsets: [0, 2] } })), length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(header.length));
  for (const name of ['a', 'b']) fs.writeFileSync(path.join(temp, name + '.safetensors'), Buffer.concat([length, header, Buffer.from([0x80, 0x3f])]));
  const report = path.join(temp, 'report.json');
  const result = spawnSync(process.env.KAMINOS_PYTHON ?? 'python3', ['models/qwen3_5/export-model-reference.py', '--model-dir', temp, '--out', path.join(temp, 'output'), '--report', report], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const saved = JSON.parse(fs.readFileSync(report)); assert.equal(saved.phase, 'source-admission'); assert.match(saved.error, /duplicate source/);
  assert.equal(fs.existsSync(path.join(temp, 'output', 'meta.json')), false);
  console.log('duplicate model tensors fail before native import and preserve the rejection report');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

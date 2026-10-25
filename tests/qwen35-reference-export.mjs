// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qwen35-reference-')));
try {
  for (const mode of ['missing', 'wrong-model', 'wrong-quantization']) {
    const model = path.join(temp, mode), report = path.join(temp, `${mode}.report.json`), output = path.join(temp, `${mode}.out`);
    if (mode !== 'missing') {
      fs.mkdirSync(model);
      fs.writeFileSync(path.join(model, 'config.json'), JSON.stringify({ model_type: mode === 'wrong-model' ? 'llama' : 'qwen3_5',
        quantization: { bits: mode === 'wrong-quantization' ? 8 : 4, group_size: 64, mode: 'affine' } }));
    }
    const result = spawnSync(process.env.KAMINOS_PYTHON ?? 'python3', [path.join(root, 'models/qwen3_5/export-kernel-reference.py'),
      '--model-dir', model, '--out', output, '--report', report], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const saved = JSON.parse(fs.readFileSync(report));
    assert.equal(saved.status, 'failed'); assert.equal(saved.phase, 'source-config');
    assert.equal(saved.requested.modelRoot, model);
    assert.ok(saved.error.includes(mode === 'missing' ? 'model root does not exist' : 'expected dense Qwen3.5'));
    assert.equal(fs.existsSync(path.join(output, 'meta.json')), false);
  }
  console.log('source rejection preserves a durable report before native import or primary output');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

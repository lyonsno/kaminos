import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptUrl = new URL('../volume-layer-coefficient-prediction-export-mlx.py', import.meta.url);
const python = process.env.KAMINOS_MLX_PYTHON || '/private/tmp/kaminos-mlx-residual-venv/bin/python';

assert.ok(existsSync(fileURLToPath(scriptUrl)), 'prediction exporter must exist');
assert.ok(existsSync(python), `MLX Python must exist at ${python}`);

const result = spawnSync(python, [fileURLToPath(scriptUrl), '--self-test'], {
  encoding: 'utf8',
  timeout: 30_000,
});

assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
const receipt = JSON.parse(result.stdout.trim());
assert.equal(receipt.identity, 'layer-coefficient-prediction-export-self-test-v0');
assert.equal(receipt.status, 'passed');
assert.equal(receipt.trainableParameters.baseline, 8192);
assert.equal(receipt.trainableParameters.treatment, 8192);
assert.equal(receipt.reloadMaxAbsError.baseline, 0);
assert.equal(receipt.reloadMaxAbsError.treatment, 0);
assert.equal(receipt.authority, 'learned-post-admission-coefficient-prediction-v0');
assert.deepEqual(receipt.rejectedDrift, [
  'corpus-identity',
  'model-sha256',
  'state-source-hashes',
]);

console.log('volume layer coefficient prediction export contracts passed');

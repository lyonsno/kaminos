import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeRgbaPng } from '../orb-inner-engine-core.js';

const root = new URL('..', import.meta.url).pathname;
const smokePath = join(root, 'orb-inner-engine-sdxl-adapter-smoke.py');

assert.ok(existsSync(smokePath), 'orb-inner-engine-sdxl-adapter-smoke.py must exist');

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-sdxl-adapter-smoke-'));
try {
  const run = spawnSync('/Users/noahlyons/dev/SuperMat/.venv/bin/python', [
    smokePath,
    '--out-dir', outDir,
    '--seed', 'molten-heartfucker-sdxl-contract',
    '--adapter', 'canny',
    '--width', '256',
    '--height', '256',
    '--steps', '1',
    '--dry-run',
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const printed = JSON.parse(run.stdout);
  assert.equal(printed.ok, true);
  assert.equal(printed.status, 'dry-run');
  assert.equal(printed.identity, 'orb-inner-engine-sdxl-adapter-smoke-v0');

  const receiptPath = join(outDir, 'receipt.json');
  const requestPath = join(outDir, 'request.json');
  const guidePath = join(outDir, 'radial-guide-canny.png');
  assert.ok(existsSync(receiptPath), 'dry run writes receipt.json');
  assert.ok(existsSync(requestPath), 'dry run writes request.json');
  assert.ok(existsSync(guidePath), 'dry run writes radial guide image');

  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.identity, 'orb-inner-engine-sdxl-adapter-smoke-v0');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.status, 'dry-run');
  assert.equal(receipt.routeId, 'local-image.sdxl-t2i-adapter.canny');
  assert.equal(receipt.seed, 'molten-heartfucker-sdxl-contract');
  assert.equal(receipt.width, 256);
  assert.equal(receipt.height, 256);
  assert.equal(receipt.steps, 1);
  assert.equal(receipt.liveGeneratorInvoked, false);
  assert.equal(receipt.outputs.guidePath, guidePath);
  assert.equal(receipt.outputs.outputImagePath, null);
  assert.ok(receipt.prompt.includes('contained radial engine'));
  assert.ok(receipt.negativePrompt.includes('camera lens'));
  assert.deepEqual(receipt.models, {
    base: 'stabilityai/stable-diffusion-xl-base-1.0',
    adapter: 'TencentARC/t2i-adapter-canny-sdxl-1.0',
  });
  assert.ok(receipt.guideMetrics.nonBackgroundRatio > 0.05, 'guide contains structural marks');
  assert.ok(receipt.guideMetrics.hotCenterRatio > 0.001, 'guide contains a hot center marker');
  assert.ok(receipt.guideMetrics.darkRimRatio > 0.05, 'guide contains dark rim/occluder structure');

  const blankOutDir = join(outDir, 'blank-probe');
  const blankPath = join(outDir, 'blank.png');
  writeRgbaPng(blankPath, {
    width: 16,
    height: 16,
    rgba: new Uint8ClampedArray(16 * 16 * 4).fill(255).map((value, index) => (index % 4 === 3 ? 255 : 0)),
  });
  const blankProbe = spawnSync('/Users/noahlyons/dev/SuperMat/.venv/bin/python', [
    smokePath,
    '--out-dir', blankOutDir,
    '--seed', 'molten-heartfucker-sdxl-blank-contract',
    '--adapter', 'canny',
    '--width', '256',
    '--height', '256',
    '--dry-run',
    '--validate-output', blankPath,
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(blankProbe.status, 5, 'blank output probe exits with evidence-failure status');
  const blankReceipt = JSON.parse(readFileSync(join(blankOutDir, 'receipt.json'), 'utf8'));
  assert.equal(blankReceipt.ok, false);
  assert.equal(blankReceipt.status, 'failed-output-validation');
  assert.equal(blankReceipt.failure.phase, 'output-validation');
  assert.equal(blankReceipt.failure.reason, 'generated output is blank or near-blank');
  assert.equal(blankReceipt.outputMetrics.blank, true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

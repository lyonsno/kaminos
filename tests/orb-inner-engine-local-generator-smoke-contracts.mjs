import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeRgbaPng } from '../orb-inner-engine-core.js';

const root = new URL('..', import.meta.url).pathname;
const smokePath = join(root, 'orb-inner-engine-local-generator-smoke.py');
const python = '/Users/noahlyons/dev/SuperMat/.venv/bin/python';

assert.ok(existsSync(smokePath), 'orb-inner-engine-local-generator-smoke.py must exist');

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-local-generator-smoke-'));
try {
  for (const route of ['z-image-turbo', 'flux2-klein']) {
    const routeDir = join(outDir, route);
    const run = spawnSync(python, [
      smokePath,
      '--route', route,
      '--out-dir', routeDir,
      '--seed', `molten-heartfucker-${route}-contract`,
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
    assert.equal(printed.identity, 'orb-inner-engine-local-generator-smoke-v0');
    assert.equal(printed.route, route);
    assert.equal(printed.liveGeneratorInvoked, false);
    assert.ok(printed.modelPath, 'dry run resolves a local model path');
    assert.ok(printed.pipelineClass, 'dry run records effective pipeline class');
    assert.ok(printed.prompt.includes('contained radial engine'));
    assert.ok(printed.negativePrompt.includes('camera lens'));
    assert.ok(existsSync(join(routeDir, 'request.json')), `${route} writes request.json`);
    assert.ok(existsSync(join(routeDir, 'receipt.json')), `${route} writes receipt.json`);
    assert.equal(printed.outputs.outputImagePath, null);
  }

  const blankOutDir = join(outDir, 'blank-probe');
  const blankPath = join(outDir, 'blank.png');
  writeRgbaPng(blankPath, {
    width: 16,
    height: 16,
    rgba: new Uint8ClampedArray(16 * 16 * 4).fill(0).map((value, index) => (index % 4 === 3 ? 255 : value)),
  });
  const blankProbe = spawnSync(python, [
    smokePath,
    '--route', 'z-image-turbo',
    '--out-dir', blankOutDir,
    '--seed', 'molten-heartfucker-local-generator-blank-contract',
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

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
    assert.equal(printed.promptProfile, 'tag-soup');
    assert.equal(printed.effectivePromptControls.promptProfile, 'tag-soup');
    assert.equal(printed.effectivePromptControls.negativePromptRequested, true);
    if (route === 'z-image-turbo') {
      assert.equal(printed.effectivePromptControls.negativePromptMode, 'plain-negative');
      assert.equal(printed.effectivePromptControls.negativePromptPassed, true);
    } else {
      assert.equal(printed.effectivePromptControls.negativePromptMode, 'unsupported');
      assert.equal(printed.effectivePromptControls.negativePromptPassed, false);
      assert.match(printed.effectivePromptControls.negativePromptReason, /does not expose plain negative_prompt/);
    }
    assert.ok(existsSync(join(routeDir, 'request.json')), `${route} writes request.json`);
    assert.ok(existsSync(join(routeDir, 'receipt.json')), `${route} writes receipt.json`);
    assert.equal(printed.outputs.outputImagePath, null);
  }

  const profileDir = join(outDir, 'cutaway-profile');
  const profileRun = spawnSync(python, [
    smokePath,
    '--route', 'z-image-turbo',
    '--out-dir', profileDir,
    '--seed', 'molten-heartfucker-cutaway-profile-contract',
    '--width', '1024',
    '--height', '1024',
    '--prompt-profile', 'cutaway-mechanical',
    '--dry-run',
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(profileRun.status, 0, profileRun.stderr || profileRun.stdout);
  const profileReceipt = JSON.parse(profileRun.stdout);
  assert.equal(profileReceipt.promptProfile, 'cutaway-mechanical');
  assert.equal(profileReceipt.width, 1024);
  assert.equal(profileReceipt.height, 1024);
  assert.match(profileReceipt.prompt, /tight cutaway/i);
  assert.match(profileReceipt.prompt, /trapped under metal/i);
  assert.doesNotMatch(profileReceipt.prompt, /orthographic hard surface concept asset/i);
  assert.equal(profileReceipt.effectivePromptControls.promptProfileSource, 'built-in');

  const croppedDir = join(outDir, 'cropped-aperture-profile');
  const croppedRun = spawnSync(python, [
    smokePath,
    '--route', 'z-image-turbo',
    '--out-dir', croppedDir,
    '--seed', 'molten-heartfucker-cropped-aperture-profile-contract',
    '--width', '1024',
    '--height', '1024',
    '--prompt-profile', 'cropped-aperture-interior',
    '--dry-run',
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(croppedRun.status, 0, croppedRun.stderr || croppedRun.stdout);
  const croppedReceipt = JSON.parse(croppedRun.stdout);
  assert.equal(croppedReceipt.promptProfile, 'cropped-aperture-interior');
  assert.match(croppedReceipt.prompt, /cropped aperture interior/i);
  assert.match(croppedReceipt.prompt, /foreground shell/i);
  assert.match(croppedReceipt.prompt, /outside the frame/i);
  assert.match(croppedReceipt.prompt, /incomplete radial machinery/i);
  assert.match(croppedReceipt.prompt, /not a complete circular product/i);
  assert.equal(croppedReceipt.effectivePromptControls.promptProfileSource, 'built-in');

  const channelDir = join(outDir, 'occluded-channel-profile');
  const channelRun = spawnSync(python, [
    smokePath,
    '--route', 'z-image-turbo',
    '--out-dir', channelDir,
    '--seed', 'molten-heartfucker-occluded-channel-profile-contract',
    '--width', '1024',
    '--height', '1024',
    '--prompt-profile', 'occluded-channel-material',
    '--dry-run',
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(channelRun.status, 0, channelRun.stderr || channelRun.stdout);
  const channelReceipt = JSON.parse(channelRun.stdout);
  assert.equal(channelReceipt.promptProfile, 'occluded-channel-material');
  assert.match(channelReceipt.prompt, /material study/i);
  assert.match(channelReceipt.prompt, /heat-stained black ceramic/i);
  assert.match(channelReceipt.prompt, /amber-orange light/i);
  assert.match(channelReceipt.prompt, /narrow recessed slots/i);
  assert.match(channelReceipt.prompt, /shader substrate/i);
  assert.equal(channelReceipt.effectivePromptControls.promptProfileSource, 'built-in');

  const conditioningPath = join(outDir, 'conditioning.png');
  writeRgbaPng(conditioningPath, {
    width: 8,
    height: 8,
    rgba: new Uint8ClampedArray(8 * 8 * 4).fill(0).map((value, index) => (index % 4 === 3 ? 255 : value)),
  });
  const conditionedDir = join(outDir, 'reference-conditioned');
  const conditionedRun = spawnSync(python, [
    smokePath,
    '--route', 'flux2-klein',
    '--out-dir', conditionedDir,
    '--seed', 'molten-heartfucker-reference-conditioned-contract',
    '--width', '1024',
    '--height', '1024',
    '--prompt-profile', 'reference-conditioned',
    '--conditioning-image', conditioningPath,
    '--dry-run',
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(conditionedRun.status, 0, conditionedRun.stderr || conditionedRun.stdout);
  const conditionedReceipt = JSON.parse(conditionedRun.stdout);
  assert.equal(conditionedReceipt.promptProfile, 'reference-conditioned');
  assert.equal(conditionedReceipt.effectivePromptControls.imageConditioningRequested, true);
  assert.equal(conditionedReceipt.effectivePromptControls.imageConditioningMode, 'image-arg');
  assert.equal(conditionedReceipt.effectivePromptControls.imageConditioningPassed, true);
  assert.equal(conditionedReceipt.effectivePromptControls.conditioningImagePath, conditioningPath);
  assert.match(conditionedReceipt.prompt, /reinterpret the reference/i);

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

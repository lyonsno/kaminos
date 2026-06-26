import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const campaignPath = join(root, 'orb-inner-engine-generator-campaign.py');
const python = '/Users/noahlyons/dev/SuperMat/.venv/bin/python';

assert.ok(existsSync(campaignPath), 'orb-inner-engine-generator-campaign.py must exist');

const outDir = mkdtempSync(join(tmpdir(), 'kaminos-generator-campaign-'));
try {
  const run = spawnSync(python, [
    campaignPath,
    '--campaign', 'molten-campaign-v0',
    '--out-dir', outDir,
    '--dry-run',
    '--candidate', 'z-comp-cropped-aperture-a',
    '--candidate', 'z-vocab-occluded-channel-a',
    '--candidate', 'flux-ref-guide-a',
  ], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const printed = JSON.parse(run.stdout);
  assert.equal(printed.ok, true);
  assert.equal(printed.status, 'dry-run');
  assert.equal(printed.identity, 'orb-inner-engine-generator-campaign-v0');
  assert.equal(printed.campaign, 'molten-campaign-v0');
  assert.equal(printed.candidateCount, 3);
  assert.equal(printed.completedCount, 3);
  assert.equal(printed.liveGeneratorInvoked, false);
  assert.equal(printed.agentReview.status, 'pending-agent-inspection');
  assert.equal(printed.agentReview.visualOutputsInspected, false);
  assert.ok(printed.outputs.manifestPath.endsWith('/manifest.json'));
  assert.ok(printed.outputs.receiptPath.endsWith('/receipt.json'));
  assert.ok(printed.outputs.contactSheetPath.endsWith('/contact-sheet.png'));
  assert.ok(printed.outputs.reviewDir.endsWith('/review'));

  for (const path of [
    printed.outputs.manifestPath,
    printed.outputs.receiptPath,
    printed.outputs.contactSheetPath,
    printed.outputs.reviewDir,
  ]) {
    assert.ok(existsSync(path), `campaign output exists: ${path}`);
  }

  const manifest = JSON.parse(readFileSync(printed.outputs.manifestPath, 'utf8'));
  assert.equal(manifest.identity, 'orb-inner-engine-generator-campaign-v0-manifest');
  assert.equal(manifest.candidates.length, 3);
  assert.deepEqual(manifest.candidates.map(candidate => candidate.id), [
    'z-comp-cropped-aperture-a',
    'z-vocab-occluded-channel-a',
    'flux-ref-guide-a',
  ]);
  assert.equal(manifest.candidates[0].series, 'composition-break');
  assert.equal(manifest.candidates[1].series, 'vocabulary-harvest');
  assert.equal(manifest.candidates[2].series, 'reference-conditioning');
  assert.equal(manifest.candidates[2].route, 'flux2-klein');
  assert.ok(manifest.candidates[2].conditioningImagePath, 'reference candidate records conditioning image');

  const receipt = JSON.parse(readFileSync(printed.outputs.receiptPath, 'utf8'));
  assert.equal(receipt.candidates.length, 3);
  assert.equal(receipt.candidates[0].status, 'dry-run');
  assert.equal(receipt.candidates[0].routeReceipt.status, 'dry-run');
  assert.equal(receipt.candidates[0].routeReceipt.effectivePromptControls.negativePromptMode, 'plain-negative');
  assert.equal(receipt.candidates[2].routeReceipt.effectivePromptControls.imageConditioningMode, 'image-arg');
  assert.equal(receipt.candidates[2].routeReceipt.effectivePromptControls.imageConditioningPassed, true);
  assert.equal(receipt.candidates[2].agentReview.status, 'pending-agent-inspection');
  assert.equal(receipt.visualSummary.status, 'pending-agent-inspection');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

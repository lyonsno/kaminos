import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SWEEP_ROOT = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-anisotropy-sweep-v0',
);
const TOOL = path.join(
  REPO_ROOT,
  'tools/prepare-current-k4-ring-cage-anisotropy-frontier-visual.mjs',
);

test('frontier visual preparation binds only the six admitted nondominated carriers', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-anisotropy-visual-'));
  await writeFile(path.join(output, 'stale.png'), Buffer.from('stale'));
  const result = spawnSync(process.execPath, [
    TOOL,
    '--sweep', path.join(SWEEP_ROOT, 'sweep-result.json'),
    '--source',
    path.join(
      REPO_ROOT,
      'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
    ),
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(output, 'visual-manifest.json')));
  assert.equal(manifest.schema,
    'kaminos.current-k4-ring-cage-anisotropy-frontier-visual-manifest.v0');
  assert.equal(manifest.status, 'prepared-pending-capture');
  assert.deepEqual(manifest.candidateIds, [
    'c12-i060-s092', 'c12-i060-s094', 'c12-i060-s096',
    'c12-i066-s094', 'c12-i066-s096', 'c12-i072-s096',
  ]);
  assert.equal(manifest.candidates.length, 6);
  assert.ok(manifest.candidates.every(candidate =>
    candidate.status === 'admissible' &&
    candidate.viewer.path === `candidates/${candidate.id}/index.html` &&
    candidate.bundleIdentity.sourceCarrierSha256 ===
      manifest.selectedReference.carrierIdentitySha256 &&
    candidate.bundleIdentity.packedCarrierSha256 ===
      candidate.packedCarrierIdentitySha256 &&
    candidate.captureUrls.primary.includes('state=packed') &&
    candidate.captureUrls.side.includes('view=side')));
  assert.equal(manifest.candidates.some(candidate => candidate.id === 'c12-i072-s094'), false,
    'volume-refused rows cannot enter the visual frontier');
  assert.match(manifest.inputs.sweep.path, /^repo:\/\//);
  assert.match(manifest.inputs.source.path, /^repo:\/\//);
  assert.doesNotMatch(JSON.stringify(manifest.inputs), /(?:\/private)?\/tmp\//,
    'public visual manifests cannot publish private runtime coordinates');
  assert.match(await readFile(path.join(output, 'contact-sheet.html'), 'utf8'),
    /Source selected c12 reference → anisotropy candidate/);
  assert.match(await readFile(path.join(output, 'contact-sheet-side.html'), 'utf8'),
    /Side view/);
  await assert.rejects(readFile(path.join(output, 'stale.png')), /ENOENT/,
    'visual preparation must clear stale captures before declaring pending capture');
});

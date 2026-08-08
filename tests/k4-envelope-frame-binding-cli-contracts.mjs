import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CLI writes a durable source-identified failure before primary output on a stale parent hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'k4-envelope-frame-binding-'));
  const extraction = join(directory, 'extraction.json');
  const atlas = join(directory, 'atlas.json');
  const output = join(directory, 'receipt.json');
  const failure = join(directory, 'failure.json');
  await writeFile(extraction, `${JSON.stringify({
    source: {
      requestedPath: '/source.blend',
      effectivePath: '/source.blend',
      sha256: 'a'.repeat(64),
    },
  })}\n`);
  await writeFile(atlas, `${JSON.stringify({ id: 'atlas', routeInventory: [{ constructionId: 'unselected-row' }] })}\n`);
  const run = spawnSync(process.execPath, [
    'tools/build-k4-envelope-frame-binding.mjs',
    '--source-extraction', extraction,
    '--skeleton-glb', join(directory, 'not-read.glb'),
    '--envelope-glb', join(directory, 'not-read-envelope.glb'),
    '--skeleton-envelope-frame-link', join(directory, 'not-read-link.json'),
    '--parent-atlas', atlas,
    '--expected-parent-atlas-file-sha256', '0'.repeat(64),
    '--baseline-result', join(directory, 'not-read-baseline.json'),
    '--requested-constructions', 'muscle-34,muscle-13',
    '--out', output,
    '--failure', failure,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  const report = JSON.parse(await readFile(failure, 'utf8'));
  assert.equal(report.schema, 'kaminos.k4-envelope-frame-binding-failure.v0');
  assert.equal(report.failurePhase, 'parent-atlas-hash');
  assert.deepEqual(report.requestedConstructionIds, ['muscle-34', 'muscle-13']);
  assert.equal(report.source.sha256, 'a'.repeat(64));
  assert.equal(report.lastTrustworthyEvidence.sourceExtractionRead, true);
  assert.equal(report.lastTrustworthyEvidence.parentAtlasRead, true);
  assert.match(report.error, /parent atlas file SHA-256 mismatch/);
});

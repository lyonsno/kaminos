import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureNBodyPackingAssayState } from '../nbody-packing-assay-capture.mjs';

test('N-body capture rejects state and evidence-mode substitution before browser resolution', async () => {
  await assert.rejects(
    () => captureNBodyPackingAssayState({ state:'reference' }),
    /state must be known-feasible, crowded, sequential-counterfeit, or joint-reference/,
  );
  await assert.rejects(
    () => captureNBodyPackingAssayState({ mode:'transparent-beauty' }),
    /mode must be volume or slice/,
  );
});

test('N-body capture uses the independent resolver and cannot inherit stable Chrome identity', async () => {
  const source = await readFile(
    new URL('../nbody-packing-assay-capture.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /process\.env\.KAMINOS_CHROME\b/);
  assert.match(source, /KAMINOS_HEADLESS_BROWSER/);
  assert.match(source, /captureIndependentBrowserScreenshot/);
  assert.match(source, /url\.searchParams\.set\('state', state\)/);
  assert.match(source, /url\.searchParams\.set\('mode', mode\)/);
});

test('N-body capture admits the joint reference as an explicit fourth state', async () => {
  const root = join(tmpdir(), `kaminos-joint-reference-capture-${process.pid}`);
  await assert.rejects(
    () => captureNBodyPackingAssayState({
      state:'joint-reference',
      baseUrl:'http://127.0.0.1:18765/artifacts/nbody-packing-joint-reference-v0/',
      browserExecutable:join(root, 'missing-independent-browser'),
      outputPath:join(root, 'joint-reference-volume.png'),
      reportPath:join(root, 'joint-reference-volume-capture-report.json'),
      receiptRoot:root,
    }),
    /Browser path is not an executable file/,
  );
});

test('joint-reference capture cannot default to the old three-state assay route', async () => {
  await assert.rejects(
    () => captureNBodyPackingAssayState({ state:'joint-reference' }),
    /joint-reference capture requires an explicit baseUrl/,
  );
});

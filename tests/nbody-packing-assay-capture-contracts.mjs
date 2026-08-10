import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureNBodyPackingAssayState } from '../nbody-packing-assay-capture.mjs';

test('N-body capture rejects state and evidence-mode substitution before browser resolution', async () => {
  await assert.rejects(
    () => captureNBodyPackingAssayState({ state:'reference' }),
    /state must be known-feasible, crowded, sequential-counterfeit, sparse-global-candidate, mixed-field-baseline, mixed-field-shifted, mixed-field-refined, unified-kkt-candidate, or joint-reference/,
  );
  await assert.rejects(
    () => captureNBodyPackingAssayState({ mode:'transparent-beauty' }),
    /mode must be volume or slice/,
  );
  await assert.rejects(
    () => captureNBodyPackingAssayState({
      viewport:{ width:1, height:1 },
      browserExecutable:join(tmpdir(), 'missing-browser-that-must-not-be-resolved'),
      outputPath:join(tmpdir(), `kaminos-invalid-viewport-${process.pid}.png`),
      reportPath:join(tmpdir(), `kaminos-invalid-viewport-${process.pid}-report.json`),
      receiptRoot:tmpdir(),
    }),
    /viewport must be exactly 1400x900/,
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

test('N-body capture admits the sparse global candidate only on an explicit witness route', async () => {
  const root = join(tmpdir(), `kaminos-sparse-global-capture-${process.pid}`);
  await assert.rejects(
    () => captureNBodyPackingAssayState({
      state:'sparse-global-candidate',
      baseUrl:'http://127.0.0.1:18765/artifacts/nbody-packing-sparse-global-v0/',
      browserExecutable:join(root, 'missing-independent-browser'),
      outputPath:join(root, 'sparse-global-candidate-volume.png'),
      reportPath:join(root, 'sparse-global-candidate-volume-capture-report.json'),
      receiptRoot:root,
    }),
    /Browser path is not an executable file/,
  );
  await assert.rejects(
    () => captureNBodyPackingAssayState({ state:'sparse-global-candidate' }),
    /sparse-global-candidate capture requires an explicit baseUrl/,
  );
});

test('joint-reference capture cannot default to the old three-state assay route', async () => {
  await assert.rejects(
    () => captureNBodyPackingAssayState({ state:'joint-reference' }),
    /joint-reference capture requires an explicit baseUrl/,
  );
});

test('mixed-field states require an explicit comparison witness route', async () => {
  for (const state of [
    'mixed-field-baseline',
    'mixed-field-shifted',
    'mixed-field-refined',
  ]) {
    await assert.rejects(
      () => captureNBodyPackingAssayState({ state }),
      new RegExp(`${state} capture requires an explicit baseUrl`),
    );
  }
});

test('unified KKT state requires an explicit source-bound comparison route', async () => {
  await assert.rejects(
    () => captureNBodyPackingAssayState({ state:'unified-kkt-candidate' }),
    /unified-kkt-candidate capture requires an explicit baseUrl/,
  );
});

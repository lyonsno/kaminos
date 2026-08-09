import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { captureNBodyPackingAssayState } from '../nbody-packing-assay-capture.mjs';

test('N-body capture rejects state and evidence-mode substitution before browser resolution', async () => {
  await assert.rejects(
    () => captureNBodyPackingAssayState({ state:'reference' }),
    /state must be known-feasible, crowded, or sequential-counterfeit/,
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

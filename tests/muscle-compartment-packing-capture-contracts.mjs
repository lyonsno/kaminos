import assert from 'node:assert/strict';
import test from 'node:test';

import { captureMuscleCompartmentPackingState } from '../muscle-compartment-packing-capture.mjs';

test('muscle capture rejects state substitution before browser resolution', async () => {
  await assert.rejects(
    () => captureMuscleCompartmentPackingState({
      state: 'demo',
      outputPath: '/virtual/capture.png',
      reportPath: '/virtual/capture-report.json',
    }),
    /state must be before or packed/i,
  );
});

test('muscle capture never uses the legacy KAMINOS_CHROME stable-browser variable', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../muscle-compartment-packing-capture.mjs', import.meta.url),
    'utf8',
  ));
  assert.doesNotMatch(source, /process\.env\.KAMINOS_CHROME\b/);
  assert.match(source, /KAMINOS_HEADLESS_BROWSER/);
  assert.match(source, /captureIndependentBrowserScreenshot/);
});

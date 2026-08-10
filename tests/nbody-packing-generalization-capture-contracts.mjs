import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  captureNBodyPackingGeneralizationState,
} from '../nbody-packing-generalization-capture.mjs';

test('generalization capture rejects substituted count, state, mode, and implicit output', async () => {
  await assert.rejects(
    () => captureNBodyPackingGeneralizationState({ memberCount:5 }),
    /memberCount must be exactly 4, 6, or 8/,
  );
  await assert.rejects(
    () => captureNBodyPackingGeneralizationState({ memberCount:4, state:'nice' }),
    /state must be crowded, packed, or reference/,
  );
  await assert.rejects(
    () => captureNBodyPackingGeneralizationState({ memberCount:4, mode:'beauty' }),
    /mode must be volume or slice/,
  );
  await assert.rejects(
    () => captureNBodyPackingGeneralizationState({ memberCount:4 }),
    /explicit baseUrl, outputPath, and reportPath/,
  );
});

test('generalization capture records the selected rung through independent browser custody', async () => {
  const source = await readFile(
    new URL('../nbody-packing-generalization-capture.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /captureIndependentBrowserScreenshot/);
  assert.match(source, /url\.searchParams\.set\('count', String\(memberCount\)\)/);
  assert.match(source, /domDatasetKeys:\['witnessLoaded', 'witnessState', 'witnessMode', 'witnessRoute', 'memberCount'\]/);
  assert.doesNotMatch(source, /process\.env\.KAMINOS_CHROME\b/);
});

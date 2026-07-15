import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const compose = readFileSync(join(root, 'volume-native-low-selective-compose.py'), 'utf8');
const witness = readFileSync(join(root, 'volume-native-low-selective-witness.mjs'), 'utf8');
const exporter = readFileSync(join(root, 'volume-full-grid-field-export.mjs'), 'utf8');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');

assert.match(
  compose,
  /--allow-cross-grid-native-input/,
  'cross-grid native application requires an explicit caller opt-in',
);
assert.match(
  compose,
  /if low_grid != trained_low_grid and not args\.allow_cross_grid_native_input/,
  'native grids that differ from the training grid remain fail-closed by default',
);
assert.match(
  compose,
  /frozen-trained-grid-heads-applied-to-explicit-cross-grid-native-state-v0/,
  'cross-grid application records a distinct authority from matched-grid application',
);
assert.match(
  compose,
  /normalized-nearest-cell-low-to-output-grid-v0/,
  'cross-grid application names the actual normalized low-cell sampling operator',
);
for (const field of ['trainedLowGrid', 'applicationLowGrid', 'outputGrid', 'crossGridApplication']) {
  assert.match(compose, new RegExp(field), `cross-grid manifest records ${field}`);
}
assert.match(
  compose,
  /syntheticDownsampleApplied["']?\s*:\s*False/,
  'cross-grid application still denies synthetic downsampling at runtime',
);
assert.match(
  compose,
  /runtimeTruthAvailable["']?\s*:\s*False/,
  'cross-grid application still denies runtime truth authority',
);

assert.match(
  witness,
  /CROSS_GRID_TREATMENT_AUTHORITY/,
  'the visual witness recognizes the explicit cross-grid treatment authority',
);
assert.doesNotMatch(
  witness,
  /native\.manifest\.grid !== 128/,
  'the visual witness must not silently reject every genuine native grid except 128',
);
assert.match(
  witness,
  /const nativeGrid = native\.manifest\.grid/,
  'the visual witness derives its control grid from the captured native manifest',
);
assert.match(
  witness,
  /const predictedGrid = predicted\.manifest\.relationship\?\.outputGrid/,
  'the visual witness derives its treatment grid from the prediction relationship',
);
assert.match(
  witness,
  /crossGridApplication/,
  'the visual witness surfaces whether the treatment crosses the model training grid',
);
assert.match(
  witness,
  /validateRender\(treatmentRender\.manifest, 'nativeLowSelectivePredicted', predictedGrid/,
  'the treatment receipt must be validated from the treatment render rather than the control render',
);
assert.match(
  witness,
  /'--render-warmup-count',\s*'2'/,
  'the visual witness must settle dynamic splat capacity before evidence capture',
);
assert.match(
  witness,
  /boundarySplatOverflowCount/,
  'the visual witness must inspect splat overflow rather than accepting clipped learned support',
);
assert.match(
  witness,
  /candidateCount\s*!==\s*instanceCount/,
  'the visual witness must reject candidate and rendered instance count disagreement',
);
assert.match(
  exporter,
  /NATIVE_LOW_CROSS_GRID_SELECTIVE_AUTHORITY/,
  'the held-field importer recognizes the explicit cross-grid treatment authority',
);
assert.match(
  exporter,
  /nativeLowSelectiveAuthority/,
  'the held-field import receipt preserves the effective matched-grid or cross-grid authority',
);
assert.match(
  core,
  /NATIVE_LOW_CROSS_GRID_SELECTIVE_INITIALIZATION_AUTHORITY/,
  'the browser importer recognizes the explicit cross-grid held-render authority',
);
assert.match(
  core,
  /isNativeLowCrossGridSelective/,
  'the browser importer admits cross-grid treatment through a named narrow route',
);

console.log('native-low cross-grid contracts passed');

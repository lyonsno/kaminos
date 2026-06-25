import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(witness, /Input\.dispatchMouseEvent/, 'Pipeline UI witness must drive trusted mouse input through the visible UI path');
assert.match(witness, /data-tab="pipeline"/, 'Pipeline UI witness must enter the Pipeline tab through the visible tab control');
assert.match(witness, /data-pipeline-asset-palette="image"/, 'Pipeline UI witness must switch to the visible Images palette tab');
assert.match(witness, /pipeline-asset-card/, 'Pipeline UI witness must start from a visible asset card');
assert.match(witness, /Import Image/, 'Pipeline UI witness must activate the visible import button');
assert.match(witness, /SCENE IMPORT/, 'Pipeline UI witness must assert the destination Scene Import receipt');
assert.match(witness, /visible-scene-row/, 'Pipeline UI witness must require the trustworthy import phase, not just no exception');
assert.doesNotMatch(witness, /kaminosPipelineCreateGraphImageNode/, 'Pipeline UI witness must not create graph image nodes through internal hooks');
assert.doesNotMatch(witness, /\.click\(\)/, 'Pipeline UI witness must not replace physical click delivery with synthetic DOM click');

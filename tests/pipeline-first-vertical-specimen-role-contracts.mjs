import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /id="pipeline-specimen-goin-button"/, 'Specimen intake must expose a visible goin fixture button for first-vertical object-of-desire smoke');
assert.match(index, /id="pipeline-specimen-glove-wealth-button"/, 'Specimen intake must expose a visible glove-wealth fixture button for first-vertical hoard smoke');
assert.match(index, /firstVerticalRole/, 'Specimen artifacts must carry first-vertical role identity');
assert.match(index, /specimenKind/, 'Specimen artifacts must carry specimen kind identity');
assert.match(index, /conditioningRoles/, 'Specimen artifacts must carry conditioning roles for later route composition');
assert.match(index, /theft_object/, 'Goin specimens must advertise theft-object role without defining goin physics');
assert.match(index, /hoard_source/, 'Glove-wealth specimens must advertise hoard-source role without defining economy law');
assert.match(index, /function kaminosPipelineImportFixtureGoinSpecimen\(/, 'Pipeline must create goin fixture specimens through the same source-truth intake path');
assert.match(index, /function kaminosPipelineImportFixtureGloveWealthSpecimen\(/, 'Pipeline must create glove-wealth fixture specimens through the same source-truth intake path');
assert.match(index, /sourceFirstVerticalRole:\s*source\.firstVerticalRole/, 'Route snapshots must carry first-vertical source role from graph-connected specimen nodes');
assert.match(index, /data-pipeline-specimen-role/, 'Graph DOM must expose specimen role chips for operator smoke');
assert.match(index, /window\.kaminosPipelineImportFixtureGoinSpecimen/, 'Browser witnesses must create goin specimens through the public debug/export path');
assert.match(index, /window\.kaminosPipelineImportFixtureGloveWealthSpecimen/, 'Browser witnesses must create glove-wealth specimens through the public debug/export path');

assert.match(witness, /scenario === 'first-vertical-specimens'/, 'Pipeline UI witness must include a first-vertical specimen role smoke scenario');
assert.match(witness, /pipeline-specimen-goin-button/, 'First-vertical witness must click the visible goin fixture button');
assert.match(witness, /pipeline-specimen-glove-wealth-button/, 'First-vertical witness must click the visible glove-wealth fixture button');
assert.match(witness, /theft_object/, 'First-vertical witness must verify goin role identity');
assert.match(witness, /hoard_source/, 'First-vertical witness must verify glove-wealth role identity');

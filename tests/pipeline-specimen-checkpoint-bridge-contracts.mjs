import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /id="pipeline-specimen-checkpoint-button"/, 'Pipeline specimen intake must expose a visible primitive checkpoint export button');
assert.match(index, /kaminos\.specimen-checkpoint\.v0/, 'Browser bridge must preserve specimen checkpoint schema identity');
assert.match(index, /kaminos\.specimen-view-artifact\.v0/, 'Browser bridge must preserve specimen view artifact schema identity');
assert.match(index, /function kaminosPipelineExportFixtureSpecimenCheckpoint\(/, 'Pipeline must export a fixture primitive checkpoint through a public bridge function');
assert.match(index, /specimenCheckpointId/, 'Pipeline graph image nodes must carry source specimen checkpoint identity');
assert.match(index, /viewKind/, 'Pipeline graph image nodes must carry exported view kind identity');
assert.match(index, /depth_source/, 'Depth view artifacts must advertise depth conditioning role');
assert.match(index, /normal_source/, 'Normal view artifacts must advertise normal conditioning role');
assert.match(index, /silhouette_source/, 'Silhouette view artifacts must advertise silhouette conditioning role');
assert.match(index, /mask_source/, 'Mask view artifacts must advertise mask conditioning role');
assert.match(index, /fixture_primitive_not_live_sculpt_truth/, 'Primitive fixture exports must not masquerade as live sculpt or generator output');
assert.match(index, /window\.kaminosPipelineExportFixtureSpecimenCheckpoint/, 'Browser witness must be able to trigger primitive checkpoint export through debug/export path');

assert.match(witness, /scenario === 'specimen-checkpoint'/, 'Pipeline UI witness must include a specimen-checkpoint smoke scenario');
assert.match(witness, /pipeline-specimen-checkpoint-button/, 'Specimen checkpoint witness must click the visible primitive checkpoint button');
assert.match(witness, /kaminos\.specimen-checkpoint\.v0/, 'Specimen checkpoint witness must verify checkpoint schema identity');
assert.match(witness, /kaminos\.specimen-view-artifact\.v0/, 'Specimen checkpoint witness must verify view artifact schema identity');
assert.match(witness, /depth_source/, 'Specimen checkpoint witness must verify exported depth conditioning');
assert.match(witness, /normal_source/, 'Specimen checkpoint witness must verify exported normal conditioning');

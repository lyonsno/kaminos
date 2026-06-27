import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /id="pipeline-specimen-intake"/, 'Pipeline browser must expose a specimen intake surface inside the graph bench');
assert.match(index, /kaminos\.kiln\.image-artifact\.v0/, 'Pipeline specimen intake must preserve kiln image artifact schema identity');
assert.match(index, /kaminos\.kiln\.image-route-receipt\.v0/, 'Pipeline specimen intake must preserve kiln image route receipt schema identity');
assert.match(index, /function buildPipelineSpecimenArtifact\(/, 'Pipeline must build source-truth artifacts before creating graph nodes');
assert.match(index, /function createPipelineGraphImageNodeFromSpecimenArtifact\(/, 'Pipeline must create graph image/specimen nodes from intake artifacts');
assert.match(index, /function pipelineGraphSourceDisplayLabel\(/, 'Pipeline inspector must summarize inline specimen sources instead of flooding the rail with data URLs');
assert.match(index, /sourceTruthWarnings/, 'Pipeline graph image nodes must carry source truth warnings');
assert.match(index, /fallback_artifact_not_requested_route_truth/, 'Pipeline graph image nodes must keep fallback warnings visible');
assert.match(index, /routeReceipt/, 'Pipeline graph image nodes must carry requested/effective route receipt identity');
assert.match(index, /artifactId/, 'Pipeline graph image nodes must preserve source artifact id');
assert.match(index, /sourceArtifact/, 'Pipeline graph route snapshots must carry source artifact truth, not only image URLs');
assert.match(index, /sourceTruthWarnings:\s*source\.sourceTruthWarnings/, 'Pipeline route snapshots must preserve warning truth from graph-connected source nodes');
assert.match(index, /sourceArtifactId:\s*source\.artifactId/, 'Pipeline graph execution must carry artifact id into route snapshots');
assert.match(index, /data-pipeline-source-warning/, 'Pipeline graph DOM must expose source-truth warnings for operator smoke');
assert.match(index, /window\.kaminosPipelineImportFixtureSpecimen/, 'Browser witnesses must create a fixture specimen through the same intake path');
assert.match(index, /window\.kaminosPipelineSpecimenIntakeDebugState/, 'Browser witnesses must inspect specimen intake state without DOM inference');
assert.match(witness, /scenario === 'specimen-intake'/, 'Pipeline UI witness must include a specimen-intake smoke scenario');
assert.match(witness, /pipeline-specimen-fixture-button/, 'Specimen witness must use the visible fixture button');
assert.match(witness, /kaminosPipelineSpecimenIntakeDebugState/, 'Specimen witness must verify source-truth state through the exported debug surface');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /function pipelineRunOutputArtifacts\(/, 'Pipeline graph UI must collect plural output artifacts from a run bundle');
assert.match(index, /function pipelinePrimaryRunArtifact\(/, 'Pipeline graph UI must choose a primary output artifact without assuming splats');
assert.match(index, /function pipelineArtifactIsLoadableSplat\(/, 'Pipeline graph UI must gate Load Output to loadable splat artifacts only');
assert.match(index, /artifactRole/, 'generated-output records must preserve primary artifact role for normal/material/splat outputs');
assert.match(index, /data-pipeline-artifact-role/, 'generated-output DOM must expose the primary artifact role for operator smoke');
assert.match(index, /normal-map/, 'Pipeline graph UI must be able to label normal-map outputs from Lotus-D routes');
assert.match(index, /pbr-material-bundle/, 'Pipeline graph UI must be able to label material bundle outputs from CHORD routes');
assert.match(index, /Open Artifact/, 'non-loadable generated artifacts must offer an evidence/open action instead of a misleading Load button');
assert.doesNotMatch(index, /const artifact = pipelineRunArtifact\(run, 'splat'\);/, 'generated-output completion must not be gated on a singleton splat artifact');
assert.doesNotMatch(index, /pipelineRunArtifact\(run, 'splat'\)\?\.path \? 'output node selected' : 'evidence node selected'/, 'graph execute success copy must not treat non-splat outputs as evidence-only');

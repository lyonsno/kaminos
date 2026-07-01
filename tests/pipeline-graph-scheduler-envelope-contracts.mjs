import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /function pipelineRunSchedulerEvidence\(/, 'Pipeline graph runtime must extract the Pipeline-owned scheduler envelope from run reports');
assert.match(index, /function pipelineGraphSchedulerEvidenceLabel\(/, 'Pipeline graph runtime must label scheduler envelope states for operator smoke');
assert.match(index, /schedulerEvidence:\s*pipelineRunSchedulerEvidence\(run\)/, 'Generated-output records must preserve scheduler evidence from the run at creation time');
assert.match(index, /schedulerEvidence:\s*value\.schedulerEvidence/, 'Generated-output workspace restore must preserve scheduler evidence across browser restarts');
assert.match(index, /data-pipeline-scheduler-state/, 'Generated-output DOM must expose scheduler evidence state for browser and human smoke');
assert.match(index, /key:\s*'scheduler'/, 'Generated-output inspector rows must show scheduler state');
assert.match(index, /key:\s*'scheduler profile'/, 'Generated-output inspector rows must show the nested kit scheduler profile schema');
assert.match(index, /key:\s*'backpressure profile'/, 'Generated-output inspector rows must show the nested kit backpressure profile schema');
assert.match(index, /scheduler-unverified/, 'Graph scheduler labels must distinguish missing effective telemetry from cooperative execution');
assert.match(index, /unsupported scheduler fields/, 'Graph scheduler labels must fail loud when requested scheduler fields were unsupported');
assert.match(index, /pipelineRunResultRows[\s\S]*scheduler/, 'Run result rows must surface scheduler evidence alongside artifact evidence');
assert.doesNotMatch(index, /breathingRoom\.status[\s\S]{0,160}data-pipeline-scheduler-state/, 'Graph DOM must expose Pipeline scheduler evidence, not raw SHARP breathingRoom as the graph-facing contract');

assert.match(witness, /schedulerEvidence/, 'Pipeline UI witness must assert generated-output scheduler evidence, not only run reports');
assert.match(witness, /data-pipeline-scheduler-state/, 'Pipeline UI witness must inspect visible scheduler state in the graph DOM');

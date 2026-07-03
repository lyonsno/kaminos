import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /function pipelineRouteLiveStatusRecord\(/, 'Route nodes must derive a live status record from generated-output/run records');
assert.match(index, /function pipelineRouteLiveStatusLabel\(/, 'Route nodes must render a stable live status label');
assert.match(index, /function pipelineRouteLiveStatusSchedulerEvidence\(/, 'Route nodes must expose scheduler evidence from the active/generated output record');
assert.match(index, /data-pipeline-route-live-status/, 'Route node DOM must expose live execution status for browser and human smoke');
assert.match(index, /data-pipeline-route-live-phase/, 'Route node DOM must expose the latest execution phase');
assert.match(index, /data-pipeline-route-scheduler-state/, 'Route node DOM must expose scheduler evidence state');
assert.match(index, /key:\s*'route status'/, 'Route inspector rows must show the live route status');
assert.match(index, /key:\s*'route phase'/, 'Route inspector rows must show the latest live phase');
assert.match(index, /key:\s*'route scheduler'/, 'Route inspector rows must show the scheduler state without selecting generated outputs');
assert.match(index, /pipelineRouteLiveStatusRecord\(node\)/, 'Route rendering must use the live status helper instead of ad hoc output lookup');
assert.doesNotMatch(index, /const latestStatus = node\.runStatus \? pipelineGeneratedOutputStatusLabel\(node\.runStatus\) : 'idle';/, 'Route status chip must not remain a coarse generated-output status only');

assert.match(witness, /data-pipeline-route-live-status/, 'Pipeline UI witness must inspect route-node live status DOM state');
assert.match(witness, /routeLiveStatus/, 'Pipeline UI witness must assert route-node live status during graph execution');
assert.match(witness, /routeSchedulerState/, 'Pipeline UI witness must assert route-node scheduler state after execution evidence lands');

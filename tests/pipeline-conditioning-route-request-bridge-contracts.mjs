import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /id="pipeline-conditioning-route-request-button"/, 'Pipeline specimen intake must expose a visible conditioning route request button');
assert.match(index, /kaminos\.conditioning-route-request\.v0/, 'Browser bridge must preserve conditioning route request schema identity');
assert.match(index, /function kaminosPipelineCreateFixtureConditioningRouteRequest\(/, 'Pipeline must create a conditioning route request through a public bridge function');
assert.match(index, /conditioningRouteRequests/, 'Pipeline dock state must preserve route requests for witness/debug and later route execution');
assert.match(index, /conditioningArtifactIds/, 'Route request must identify conditioning artifacts by view kind');
assert.match(index, /inputArtifactIds/, 'Route request must identify source/input artifacts separately from conditioning artifacts');
assert.match(index, /route_request_not_generator_execution_truth/, 'Route request must fail loud that no generator has executed yet');
assert.match(index, /request_only/, 'Route request effective route must show request-only status before a backend runs');
assert.match(index, /sourceConditioningRouteRequestId/, 'Graph route snapshots must be able to preserve route request identity when used as source truth');
assert.match(index, /window\.kaminosPipelineCreateFixtureConditioningRouteRequest/, 'Browser witness must create route requests through the public debug/export path');

assert.match(witness, /scenario === 'conditioning-route-request'/, 'Pipeline UI witness must include a conditioning-route-request smoke scenario');
assert.match(witness, /pipeline-conditioning-route-request-button/, 'Route request witness must click the visible route request button');
assert.match(witness, /kaminos\.conditioning-route-request\.v0/, 'Route request witness must verify request schema identity');
assert.match(witness, /route_request_not_generator_execution_truth/, 'Route request witness must verify request-only source truth');
assert.match(witness, /depth_source/, 'Route request witness must verify depth conditioning role');
assert.match(witness, /normal_source/, 'Route request witness must verify normal conditioning role');

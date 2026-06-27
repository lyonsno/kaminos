import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /\.pipeline-graph-canvas\s*\{[^}]*min-height:\s*520px/, 'Pipeline graph canvas must keep a stable desktop minimum height instead of shrinking under selection state');
assert.match(index, /\.pipeline-graph-canvas\s*\{[^}]*height:\s*clamp\(520px,\s*58vh,\s*680px\)/, 'Pipeline graph canvas height must be bounded and stable for graph work');
assert.match(index, /function pipelineGraphStructuralNodeReason\(/, 'Pipeline graph must explain why structural nodes cannot be deleted');
assert.match(index, /Ambient source mirrors the selected asset/, 'Source node deletion refusal must name its ambient-selection role');
assert.match(index, /Output stack is the scratch output container/, 'Output stack deletion refusal must point to deleting individual outputs or clearing failures');
assert.match(index, /Evidence node is the run report\/bundle access point/, 'Evidence node deletion refusal must name its sidecar and bundle role');
assert.match(index, /key:\s*'structure'/, 'Inspector rows must surface structural-node ontology');
assert.match(index, /Structural Node/, 'Inspector actions must visibly mark non-deletable structural nodes');
assert.match(index, /function pipelineRouteInputRequirement\(/, 'Pipeline route execution must derive input requirements from the manifest');
assert.match(index, /function pipelineSourceSatisfiesRouteInput\(/, 'Pipeline route execution must validate the connected source kind before backend compute');
assert.match(index, /source-image/, 'Pipeline route input validation must understand image-source requirements');
assert.match(index, /prepared-splat/, 'Pipeline route input validation must understand prepared-splat requirements');
assert.match(index, /Pipeline route input mismatch/, 'Incompatible graph hookups must fail loud before execution');
assert.match(index, /pipelineSourceSatisfiesRouteInput\(source,\s*pipelineRouteInputRequirement\(pipeline\)\)/, 'Graph route execution must guard the selected source against the route input contract');
assert.match(index, /status:\s*'blocked-input'/, 'Blocked route execution must record a status phase distinct from backend failure');
assert.match(index, /pipelineSetGraphInspectorStatus\(.*Pipeline route input mismatch[\s\S]*'error'\)/, 'Input mismatch must be visible in the graph inspector status');

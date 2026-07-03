import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /graphCleanupUndo/, 'Pipeline graph cleanup must keep a one-step undo snapshot in browser-local state');
assert.match(index, /function pipelineCaptureGraphWorkspaceState\(/, 'Pipeline graph cleanup captures the workspace projection before destructive-looking edits');
assert.match(index, /function pipelineRestoreGraphWorkspaceState\(/, 'Pipeline graph cleanup can restore the previous browser-local projection');
assert.match(index, /function pipelineDeleteSelectedGraphItem\(/, 'Pipeline graph exposes a single delete path for selected nodes or hooks');
assert.match(index, /function pipelineDeleteGraphNode\(/, 'Pipeline graph can delete user-created graph nodes');
assert.match(index, /pipelineGraphEditableNodeKinds/, 'Pipeline graph must explicitly distinguish editable workspace nodes from structural nodes');
assert.match(index, /edge\.from !== nodeId && edge\.to !== nodeId/, 'Deleting a graph node must remove incident hooks');
assert.match(index, /function pipelineClearFailedGeneratedOutputs\(/, 'Pipeline graph exposes a cleanup path for failed generated-output clutter');
assert.match(index, /status !== 'failed'/, 'Clear-failed cleanup must only remove failed generated-output nodes');
assert.match(index, /pipelineDockState\.runHistory/, 'Cleanup code must leave run-history evidence in state instead of deleting durable run records');
assert.match(index, /pipelineDockState\.loadedPipelineArtifactPaths/, 'Cleanup code must leave loaded scene artifact tracking intact');
assert.match(index, /Delete Graph Node/, 'Inspector must expose graph-node deletion where it is legal');
assert.match(index, /Clear Failed Outputs/, 'Inspector must expose failed-output cleanup near the graph');
assert.match(index, /Undo Graph Cleanup/, 'Inspector must expose one-step undo for graph cleanup edits');
assert.match(index, /data-pipeline-graph-node-action="delete-node"/, 'Generated-output nodes expose an in-canvas delete action for fast graph cleanup');
assert.match(index, /data-pipeline-graph-node-action="clear-failed-outputs"/, 'Output stack exposes an in-canvas clear-failed action');
assert.match(index, /if \(!\['Delete', 'Backspace'\]\.includes\(event\.key\)\) return;[\s\S]*pipelineDeleteSelectedGraphItem\(\)/, 'Keyboard delete must route through the same graph cleanup path as inspector deletion');
assert.doesNotMatch(index, /function pipelineDeleteGraphNode[\s\S]*pipelineDockState\.runHistory\s*=/, 'Deleting graph nodes must not mutate run history');
assert.doesNotMatch(index, /function pipelineClearFailedGeneratedOutputs[\s\S]*pipelineDockState\.runHistory\s*=/, 'Clearing failed outputs must not mutate run history');
assert.doesNotMatch(index, /function pipelineDeleteGraphNode[\s\S]*pipelineDockState\.loadedPipelineArtifactPaths\s*=/, 'Deleting graph nodes must not unload scene artifacts');
assert.doesNotMatch(index, /function pipelineClearFailedGeneratedOutputs[\s\S]*pipelineDockState\.loadedPipelineArtifactPaths\s*=/, 'Clearing failed outputs must not unload scene artifacts');
assert.doesNotMatch(index, /kind:\s*'generated-output'[\s\S]{0,180}title:\s*evidenceLabel/, 'Run evidence must not be minted as a generated-output graph node');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /kaminos\.pipeline-graph-workspace\.v0/, 'Pipeline graph localStorage must wrap graph state in a named workspace envelope');
assert.match(index, /function pipelineEnsureGraphWorkspace\(/, 'Pipeline graph must normalize or create a browser-local workspace record');
assert.match(index, /function pipelineRecordGraphWorkspaceEvent\(/, 'Pipeline graph must record grouped workspace history events for graph edits and executions');
assert.match(index, /function pipelineRenderGraphWorkspaceSummary\(/, 'Pipeline UI must render a visible workspace summary instead of hiding persistence in localStorage');
assert.match(index, /window\.kaminosPipelineRecordGraphWorkspaceEvent/, 'Browser smokes need a stable workspace event debug hook instead of module-scope inference');
assert.match(index, /window\.kaminosPipelineSaveGraphLocalState/, 'Browser smokes need a stable workspace save debug hook instead of synthetic UI guesses');
assert.match(index, /id="pipeline-graph-workspace-summary"/, 'Pipeline graph workspace summary needs a stable DOM id for operator and browser smoke');
assert.match(index, /data-pipeline-graph-workspace-scope/, 'Workspace summary must expose whether graph state is browser-local scratch');
assert.match(index, /Browser-local scratch workspace/, 'Workspace copy must say local browser scratch instead of implying remote asset truth');
assert.match(index, /scene\/library promotion required for asset truth/, 'Workspace copy must preserve the boundary between scratch state and promoted scene/library assets');
assert.match(index, /graphWorkspaceHistoryLimit/, 'Workspace history must be bounded deliberately by a named limit');
assert.match(index, /graphWorkspace:\s*pipelineEnsureGraphWorkspace\(\)/, 'Saved graph local state must include the normalized workspace envelope');
assert.match(index, /graphInspectorStatus:\s*pipelineDockState\.graphInspectorStatus/, 'Saved graph local state must preserve the latest meaningful action status across reloads');
assert.match(index, /pipelineRecordGraphWorkspaceEvent\(\s*'graph-edit'/, 'Graph edits must record workspace history events');
assert.match(index, /pipelineRecordGraphWorkspaceEvent\(\s*'route-execution'/, 'Route execution must record workspace history events');
assert.match(index, /pipelineRecordGraphWorkspaceEvent\(\s*'cleanup'/, 'Cleanup actions must record workspace history events');
assert.match(index, /pipelineRecordGraphWorkspaceEvent\(\s*'undo'/, 'Undo actions must record workspace history events');
assert.match(index, /data-pipeline-workspace-history-id/, 'Workspace history rows need stable DOM ids for browser smokes');
assert.doesNotMatch(index, /graphWorkspace[\s\S]{0,240}registryScope:\s*'production'/, 'Browser-local workspace metadata must not present scratch graph state as production registry truth');

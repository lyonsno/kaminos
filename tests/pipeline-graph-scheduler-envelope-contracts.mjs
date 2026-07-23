import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /function pipelineRunSchedulerEvidence\(/, 'Pipeline graph runtime must extract the Pipeline-owned scheduler envelope from run reports');
assert.match(index, /function pipelineRunSchedulerEvidenceReference\(/, 'Pipeline graph runtime must derive a compact scheduler reference for browser-persisted output records');
assert.match(index, /function pipelineGraphSchedulerEvidenceLabel\(/, 'Pipeline graph runtime must label scheduler envelope states for operator smoke');
assert.match(index, /function pipelineGraphSchedulerVerificationLabel\(/, 'Pipeline graph runtime must label the observation-bound scheduler verification receipt separately');
assert.match(index, /schedulerVerification\?\.status/, 'Pipeline graph scheduler state must prefer the nested verification receipt over legacy config aliases');
const completeOutputSource = index.match(
  /function pipelineCompleteGeneratedOutputNode\([\s\S]*?\n}\n(?=\nfunction pipelineFailGeneratedOutputNode)/,
)?.[0] || '';
const failOutputSource = index.match(
  /function pipelineFailGeneratedOutputNode\([\s\S]*?\n}\n(?=\nfunction pipelineGraphInspectorSubjectId)/,
)?.[0] || '';
assert.match(completeOutputSource, /pipelineRunSchedulerEvidenceReference\(run\)/, 'Completed generated-output records must persist a compact scheduler reference');
assert.doesNotMatch(completeOutputSource, /pipelineRunSchedulerEvidence\(run\)/, 'Completed generated-output records must not copy the full scheduler trace into browser state');
assert.match(failOutputSource, /pipelineRunSchedulerEvidenceReference\(run\)/, 'Failed generated-output records must persist the same compact scheduler reference when evidence exists');
assert.doesNotMatch(failOutputSource, /pipelineRunSchedulerEvidence\(run\)/, 'Failed generated-output records must not copy the full scheduler trace into browser state');
assert.match(index, /schedulerEvidence:\s*value\.schedulerEvidence/, 'Generated-output workspace restore must preserve scheduler evidence across browser restarts');
assert.match(index, /data-pipeline-scheduler-state/, 'Generated-output DOM must expose scheduler evidence state for browser and human smoke');
assert.match(index, /key:\s*'scheduler'/, 'Generated-output inspector rows must show scheduler state');
assert.match(index, /key:\s*'scheduler verification'/, 'Generated-output inspector rows must show the receipt status and downgrade class');
assert.match(index, /key:\s*'scheduler profile'/, 'Generated-output inspector rows must show the nested kit scheduler profile schema');
assert.match(index, /key:\s*'backpressure profile'/, 'Generated-output inspector rows must show the nested kit backpressure profile schema');
assert.match(index, /function pipelineGraphSchedulerBreathabilityState\(/, 'Pipeline graph runtime must distinguish kit-backed breathability from scheduler-only evidence');
assert.match(index, /data-pipeline-breathability-state/, 'Generated-output DOM must expose kit breathability state for browser and human smoke');
assert.match(index, /key:\s*'breathability'/, 'Generated-output inspector rows must show kit breathability state');
assert.match(index, /key:\s*'breathability checkpoints'/, 'Generated-output inspector rows must show kit breathability checkpoint count');
assert.match(index, /scheduler-unverified/, 'Graph scheduler labels must distinguish missing effective telemetry from cooperative execution');
assert.match(index, /unsupported scheduler fields/, 'Graph scheduler labels must fail loud when requested scheduler fields were unsupported');
assert.match(index, /pipelineRunResultRows[\s\S]*scheduler/, 'Run result rows must surface scheduler evidence alongside artifact evidence');
assert.doesNotMatch(index, /breathingRoom\.status[\s\S]{0,160}data-pipeline-scheduler-state/, 'Graph DOM must expose Pipeline scheduler evidence, not raw SHARP breathingRoom as the graph-facing contract');

const schedulerEvidenceSource = index.match(
  /function pipelineRunSchedulerEvidence\([\s\S]*?\n}\n(?=\nfunction pipelineRunSchedulerEvidenceReference)/,
)?.[0];
const schedulerReferenceSource = index.match(
  /function pipelineRunSchedulerEvidenceReference\([\s\S]*?\n}\n(?=\nfunction finiteKilnEvidenceNumber)/,
)?.[0];
const generatedOutputNormalizerSource = index.match(
  /function normalizePipelineGeneratedOutputNode\([\s\S]*?\n}\n(?=\nfunction loadPipelineGraphLocalState)/,
)?.[0];
assert.ok(schedulerEvidenceSource, 'Scheduler evidence extractor must remain independently testable');
assert.ok(schedulerReferenceSource, 'Scheduler evidence reference builder must remain independently testable');
assert.ok(generatedOutputNormalizerSource, 'Generated-output local-state normalizer must remain independently testable');
const pipelineRunSchedulerEvidenceReference = vm.runInNewContext(
  `(() => { ${schedulerEvidenceSource}\n${schedulerReferenceSource}\nreturn pipelineRunSchedulerEvidenceReference; })()`,
);
const forbiddenTraceSentinel = 'FULL_TRACE_MUST_NOT_ENTER_GRAPH_LOCAL_STATE';
const schedulerReference = pipelineRunSchedulerEvidenceReference({
  report: {
    path: '/reports/sharp-run.json',
    document: {
      authoritativeTrace: {
        sharpRunDebug: {
          sharpScheduler: {
            schema: 'kaminos.webgpu-route-scheduler.v0',
            breathability: {
              spans: [{ trace: forbiddenTraceSentinel }],
              checkpoints: [{ trace: forbiddenTraceSentinel }],
            },
          },
          schedulerTelemetry: {
            status: 'verified',
            classification: 'cooperative',
            eventTrace: { events: [{ payload: forbiddenTraceSentinel }] },
          },
          backpressure: {
            schema: 'kaminos.webgpu-backpressure.v0',
            samples: [{ payload: forbiddenTraceSentinel }],
          },
        },
      },
      pipelineScheduler: {
        schema: 'kaminos.pipeline-scheduler-composition-reference.v0',
        sourceSchema: 'kaminos.pipeline-scheduler-composition.v0',
      },
    },
  },
});
assert.equal(schedulerReference.schema, 'kaminos.pipeline-scheduler-composition-reference.v0');
assert.equal(schedulerReference.verificationState, 'verified');
assert.equal(schedulerReference.breathabilitySummary.spanCount, 1);
assert.equal(schedulerReference.breathabilitySummary.checkpointCount, 1);
assert.equal(schedulerReference.reportPath, '/reports/sharp-run.json');
assert.doesNotMatch(JSON.stringify(schedulerReference), new RegExp(forbiddenTraceSentinel), 'Graph-local scheduler evidence must not serialize authoritative trace payloads');
const normalizePipelineGeneratedOutputNode = vm.runInNewContext(
  `(() => {
    const pipelineArtifactRoleLabel = () => 'splat';
    const pipelineArtifactIsLoadableSplat = () => true;
    ${schedulerEvidenceSource}
    ${schedulerReferenceSource}
    ${generatedOutputNormalizerSource}
    return normalizePipelineGeneratedOutputNode;
  })()`,
);
const restoredLegacyNode = normalizePipelineGeneratedOutputNode({
  id: 'output-legacy',
  runId: 'run-legacy',
  routeNodeId: 'route-sharp',
  status: 'complete',
  artifact: { path: '/splats/legacy.ply' },
  reportPath: '/reports/legacy.json',
  schedulerEvidence: {
    schema: 'kaminos.pipeline-scheduler-composition.v0',
    scheduler: {
      schema: 'kaminos.webgpu-route-scheduler.v0',
      breathability: {
        spans: [{ trace: forbiddenTraceSentinel }],
        checkpoints: [{ trace: forbiddenTraceSentinel }],
      },
    },
    schedulerVerification: {
      status: 'verified',
      classification: 'cooperative',
      eventTrace: { events: [{ payload: forbiddenTraceSentinel }] },
    },
  },
});
assert.equal(restoredLegacyNode.schedulerEvidence.schema, 'kaminos.pipeline-scheduler-composition-reference.v0', 'Legacy full scheduler evidence must compact during local-state restore');
assert.equal(restoredLegacyNode.schedulerEvidence.reportPath, '/reports/legacy.json');
assert.doesNotMatch(JSON.stringify(restoredLegacyNode.schedulerEvidence), new RegExp(forbiddenTraceSentinel), 'Restored legacy nodes must not re-persist full scheduler telemetry');

assert.match(witness, /schedulerEvidence/, 'Pipeline UI witness must assert generated-output scheduler evidence, not only run reports');
assert.match(witness, /data-pipeline-scheduler-state/, 'Pipeline UI witness must inspect visible scheduler state in the graph DOM');
assert.match(witness, /data-pipeline-breathability-state/, 'Pipeline UI witness must inspect visible breathability state in the graph DOM');
assert.match(witness, /kit-backed-breathability/, 'Pipeline UI witness must require kit-backed breathability for generated SHARP outputs');

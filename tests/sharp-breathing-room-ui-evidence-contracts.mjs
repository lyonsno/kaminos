import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = index.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in index.html`);
  const bodyStart = index.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < index.length; i += 1) {
    const char = index[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return index.slice(start, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

const context = {
  Number,
  Math,
  String,
  Array,
  SHARP_SPN_LOWRES_BLOCK_LABELS: [
    'upsample-lowres',
    'readback-x2-upsampled',
    'readback-lowres',
    'cpu-concat-lowres',
    'concat-upload',
    'fuse-lowres',
  ],
  SHARP_MONODEPTH_PHASE_LABELS: [
    'project-feature',
    'fusion-resnet1',
    'fusion-skip-add',
    'fusion-resnet2',
    'fusion-out-conv',
    'head-conv0',
    'head-final',
  ],
  kilnRouteBenchState: { comparisonRuns: [] },
};
vm.createContext(context);
for (const fn of [
  'pipelineRunSchedulerEvidence',
  'finiteKilnEvidenceNumber',
  'uniqueKilnEvidenceLabels',
  'sharpBreathingRoomCoverageProgressText',
  'sharpBreathingRoomRunStage',
  'sharpBreathingRoomAdapterReport',
  'sharpBreathingRoomSchedulerEvents',
  'sharpBreathingRoomSchedulerEventDurationMs',
  'sharpBreathingRoomRunDurationMs',
  'sharpBreathingRoomOutputEquivalence',
  'sharpBreathingRoomComparisonSummaryText',
]) {
  vm.runInContext(extractFunction(fn), context);
}

const duplicateCoverageState = {
  comparisonRuns: [
    {
      profileId: 'cooperative-spn-gaussian',
      label: 'Friendly',
      ok: true,
      artifactSha256: '016aef03bba4a705eb8464b36a2d1119cada39f6cbb12d25b8fbe9e2629f118a',
      spnFusionCoverage: {
        requiredBlocks: context.SHARP_SPN_LOWRES_BLOCK_LABELS,
        observedBlocks: [
          'upsample-lowres',
          'upsample-lowres',
          'fuse-lowres',
          'fuse-lowres',
          'fuse-lowres',
        ],
        missingSpnFusionBlocks: [
          'readback-x2-upsampled',
          'readback-lowres',
          'cpu-concat-lowres',
          'concat-upload',
        ],
      },
      monodepthPhaseCoverage: {
        requiredLabels: context.SHARP_MONODEPTH_PHASE_LABELS,
        observedLabels: [
          'project-feature',
          'project-feature',
          'fusion-resnet1',
          'fusion-resnet1',
          'fusion-resnet2',
        ],
        missingMonodepthPhaseLabels: [
          'fusion-skip-add',
          'head-conv0',
          'head-final',
        ],
      },
    },
  ],
};
const duplicateSummary = context.sharpBreathingRoomComparisonSummaryText(duplicateCoverageState);
assert.doesNotMatch(
  duplicateSummary,
  /SPN lowres labels: 5\/6/,
  'Operator summary must not count duplicate SPN telemetry events as five covered labels',
);
assert.match(
  duplicateSummary,
  /SPN lowres labels: 2\/6/,
  'Operator summary must report unique observed SPN labels against required labels',
);
assert.doesNotMatch(
  duplicateSummary,
  /monodepth labels: 5\/7/,
  'Operator summary must not count duplicate monodepth telemetry events as five covered labels',
);
assert.match(
  duplicateSummary,
  /monodepth labels: 3\/7/,
  'Operator summary must report unique observed monodepth labels against required labels',
);

const schedulerOnlyRun = {
  report: {
    document: {
      stages: [
        {
          id: 'run-sharp-image-to-splat',
          effectiveRoute: {
            pipelineScheduler: {
              schema: 'kaminos.pipeline-scheduler-composition.v0',
              schedulerVerification: {
                eventTrace: {
                  events: [
                    { phase: 'vit-block-chunk', tMs: 16000 },
                    { phase: 'route-tail', tMs: 125000 },
                  ],
                },
              },
            },
          },
        },
      ],
    },
  },
};
assert.equal(
  context.sharpBreathingRoomRunDurationMs(schedulerOnlyRun),
  109000,
  'Run duration must fall back to scheduler event tMs span when the report lacks direct durationMs',
);

assert.match(
  index,
  /progressEvent:\s*null/,
  'Starting a fresh SHARP run must clear stale progressEvent so old 70% telemetry cannot lead the next smoke',
);

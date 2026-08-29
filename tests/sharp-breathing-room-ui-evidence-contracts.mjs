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
  'sharpBreathingRoomSchedulerEventSummary',
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

const compactSchedulerRun = {
  report: {
    document: {
      authoritativeTrace: {
        sharpRunDebug: {
          schedulerTelemetry: {
            eventSummary: {
              schema: 'kaminos.scheduler-event-summary.v0',
              count: 189000,
              firstTMs: 16000,
              lastTMs: 125000,
              spnFusionBlocks: ['fuse-lowres'],
              monodepthPhaseLabels: ['project-feature'],
            },
            eventTrace: {
              eventsRef: {
                schema: 'kaminos.ndjson-collection-reference.v0',
                collectionId: 'scheduler-events',
                count: 189000,
              },
            },
          },
        },
      },
    },
  },
};
assert.equal(
  context.sharpBreathingRoomRunDurationMs(compactSchedulerRun),
  109000,
  'Run duration must consume compact scheduler bounds without hydrating uncapped trace rows',
);

for (const fn of [
  'kilnRouteBenchBackgroundHeartbeat',
  'createKilnRouteBenchCorrelationHeartbeatLatch',
  'kilnRouteBenchHeartbeatSummary',
]) {
  vm.runInContext(extractFunction(fn), context);
}
const compactHeartbeat = {
  schema: 'sharp-webgpu.background-heartbeat.v0',
  gpuDutyIntervals: {
    schema: 'sharp-webgpu.submitted-work-drain-intervals.v0',
    count: 2,
    intervalsRef: {
      schema: 'kaminos.ndjson-collection-reference.v0',
      collectionId: 'gpu-duty-intervals',
      count: 2,
    },
  },
};
const fullCorrelationHeartbeat = {
  schema: 'sharp-webgpu.background-heartbeat.v0',
  gpuDutyIntervals: {
    schema: 'sharp-webgpu.submitted-work-drain-intervals.v0',
    count: 2,
    intervals: [
      { dutyId: 'duty-a', phase: 'encode', startMs: 10, endMs: 11 },
      { dutyId: 'duty-b', phase: 'submit', startMs: 12, endMs: 13 },
    ],
  },
};
const compactCorrelationRun = {
  report: {
    document: {
      authoritativeTrace: { backgroundHeartbeat: compactHeartbeat },
    },
  },
};
const correlationLatch = context.createKilnRouteBenchCorrelationHeartbeatLatch();
assert.equal(
  correlationLatch.resolve(compactCorrelationRun),
  compactHeartbeat,
  'an unresolved latch must preserve the compact authoritative fallback',
);
correlationLatch.capture(fullCorrelationHeartbeat);
assert.equal(
  correlationLatch.resolve(compactCorrelationRun),
  fullCorrelationHeartbeat,
  'the route-local latch must preserve the full same-invocation heartbeat across report transport',
);
assert.equal(
  JSON.stringify(compactCorrelationRun).includes('duty-a'),
  false,
  'the route-local latch must not attach uncapped duty rows to serialized run history',
);
assert.equal(
  context.createKilnRouteBenchCorrelationHeartbeatLatch().resolve({
    report: {
      document: {
        authoritativeTrace: { backgroundHeartbeat: compactHeartbeat },
      },
    },
  }),
  compactHeartbeat,
  'non-SHARP and recovered runs must retain the compact authoritative fallback',
);
const compactOverlapMessage = context.kilnRouteBenchHeartbeatSummary({
  report: {
    document: {
      authoritativeTrace: {
        backgroundHeartbeat: {
          schema: 'sharp-webgpu.background-heartbeat.v0',
          inferenceWindow: { startMs: 0, durationMs: 1000 },
          worstFrameGapSummary: {
            schema: 'kaminos.foreground-frame-gap-summary.v0',
            startMs: 100,
            durationMs: 180,
            overlapClassification: 'scheduler-event-overlap',
            overlappedEventCount: 1,
          },
        },
      },
    },
  },
});
assert.match(
  compactOverlapMessage,
  /overlapped 1 named scheduler event/,
  'compact completion copy must preserve observed overlap truth without hydrating event rows',
);
assert.doesNotMatch(
  compactOverlapMessage,
  /no named scheduler event covered it/,
  'externalized event detail must not be misreported as absent overlap evidence',
);

assert.match(
  index,
  /progressEvent:\s*null/,
  'Starting a fresh SHARP run must clear stale progressEvent so old 70% telemetry cannot lead the next smoke',
);

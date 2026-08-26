import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(
  typeof kit.runWebGpuCooperativeAdapterConformance,
  'function',
  'the package must expose a cooperative adapter conformance runner',
);

const {
  WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
  defineWebGpuCooperativeBoundaryManifest,
  runWebGpuCooperativeAdapterConformance,
  validateWebGpuCooperativeAdapterConformanceReport,
} = kit;

const ROUTE_ID = 'sf3d.image-to-mesh.webgpu-local.v0';

function createManifest({
  dynamicEncoderTotal = false,
  releaseEncoderWeights = false,
} = {}) {
  return defineWebGpuCooperativeBoundaryManifest({
    manifestId: 'sf3d.adapter-conformance.v0',
    routeId: ROUTE_ID,
    phases: [
      {
        phaseId: 'image-encoder',
        boundaries: [{
          boundaryId: 'dino-window-tiles',
          kind: 'gpu-command',
          commandDutyKind: 'compute',
          unit: 'window-tile',
          totalItems: dynamicEncoderTotal ? null : 4,
          progressWeight: 4,
          chunking: {
            mode: 'fixed',
            chunkItems: 2,
          },
          yieldPolicy: 'after-duty',
          resources: {
            retain: ['dino.weights'],
            produce: ['dino.features'],
            release: releaseEncoderWeights ? ['dino.weights'] : [],
          },
        }],
      },
      {
        phaseId: 'mesh-materialization',
        boundaries: [{
          boundaryId: 'glb-compose',
          kind: 'cpu-work',
          hostPhase: 'presentation',
          unit: 'mesh-primitive',
          totalItems: 3,
          progressWeight: 1,
          chunking: {
            mode: 'fixed',
            chunkItems: 2,
          },
          yieldPolicy: 'after-duty',
          resources: {
            retain: ['dino.features'],
            produce: ['scene.glb'],
            release: ['dino.features'],
          },
        }],
      },
    ],
  });
}

function createInput(overrides = {}) {
  return {
    conformanceId: 'sf3d:adapter:contract',
    adapterIdentity: {
      adapterId: 'sf3d.browser-webgpu.v0',
      routeId: ROUTE_ID,
      packageName: '@kaminos/webgpu-inference-kit',
      packageVersion: '0.1.38',
      sourceRevision: 'sf3d-contract-fixture',
    },
    manifest: createManifest(),
    initialResources: ['dino.weights'],
    expectedFinalResources: ['dino.weights', 'scene.glb'],
    async runAdapter({ cooperative, scenario }) {
      const encoder = cooperative.startBoundary('dino-window-tiles');
      for (let range = encoder.nextRange(); range; range = encoder.nextRange()) {
        await encoder.runGpuDuty(range, {
          encode({ range: exactRange }) {
            return { rangeId: exactRange.rangeId };
          },
        });
      }

      const glb = cooperative.startBoundary('glb-compose');
      for (let range = glb.nextRange(); range; range = glb.nextRange()) {
        await glb.runCpuDuty(range, { work() {} });
      }

      return {
        outputFingerprint: 'sha256:sf3d-coherent-glb',
        scenarioSeen: scenario,
      };
    },
    ...overrides,
  };
}

const report = await runWebGpuCooperativeAdapterConformance(createInput());

assert.equal(
  WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
  'kaminos.webgpu-cooperative-adapter-conformance-report.v0',
);
assert.equal(report.schema, WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA);
assert.equal(report.status, 'passed');
assert.equal(report.conformanceId, 'sf3d:adapter:contract');
assert.equal(report.routeId, ROUTE_ID);
assert.equal(report.manifestId, 'sf3d.adapter-conformance.v0');
assert.equal(report.kitVersion, '0.1.43');
assert.equal(report.adapterIdentityAuthority, 'caller-declared');
assert.equal(report.adapterIdentity.adapterId, 'sf3d.browser-webgpu.v0');
assert.equal(report.adapterIdentity.packageName, '@kaminos/webgpu-inference-kit');
assert.equal(report.adapterIdentity.packageVersion, '0.1.38');
assert.equal(report.adapterIdentity.sourceRevision, 'sf3d-contract-fixture');
assert.equal(report.retention, 'uncapped');
assert.deepEqual(
  report.scenarios.map(scenario => [scenario.scenario, scenario.expectedStatus, scenario.status]),
  [
    ['cooperative-success', 'succeeded', 'succeeded'],
    ['disabled-success', 'succeeded', 'succeeded'],
    ['cancellation', 'cancelled', 'cancelled'],
    ['runtime-failure', 'failed', 'failed'],
  ],
);
assert.equal(report.summary.failedCheckCount, 0);
assert.equal(report.summary.passedCheckCount, report.checks.length);
assert.ok(report.checks.length >= 12);
assert.ok(report.checks.every(check => check.status === 'passed'));
assert.equal(
  report.checks.find(check => check.checkId === 'enabled-disabled-output-equivalence')
    .detail.outputFingerprint,
  'sha256:sf3d-coherent-glb',
);
assert.deepEqual(
  report.checks.find(check => check.checkId === 'resource-lifecycle').detail.finalResources,
  ['dino.weights', 'scene.glb'],
);
assert.equal(
  report.scenarios.find(scenario => scenario.scenario === 'cooperative-success')
    .executionReport.progress.percent,
  100,
);
assert.equal(
  report.scenarios.find(scenario => scenario.scenario === 'disabled-success')
    .executionReport.queueCompletionAuthority,
  'one-terminal-prefix-fence',
);
assert.equal(
  report.scenarios.find(scenario => scenario.scenario === 'cancellation')
    .executionReport.failure.phase,
  'cancellation',
);
assert.equal(
  report.scenarios.find(scenario => scenario.scenario === 'runtime-failure')
    .executionReport.failure.phase,
  'queue-submission',
);
assert.ok(Object.isFrozen(report));
assert.ok(Object.isFrozen(report.checks));
assert.ok(Object.isFrozen(report.scenarios[0].executionReport));
assert.throws(() => {
  report.checks.push({ checkId: 'forged', status: 'passed' });
}, TypeError);

const reportValidation = validateWebGpuCooperativeAdapterConformanceReport(report);
assert.equal(reportValidation.ok, true);
assert.deepEqual(reportValidation.errors, []);
assert.ok(Object.isFrozen(reportValidation));

function expectValidationFailure(mutator, pattern) {
  const candidate = JSON.parse(JSON.stringify(report));
  mutator(candidate);
  const validation = validateWebGpuCooperativeAdapterConformanceReport(candidate);
  assert.equal(validation.ok, false, `validator accepted invalid report: ${pattern}`);
  assert.match(validation.errors.join('\n'), pattern);
}

expectValidationFailure(
  candidate => {
    candidate.checks = [
      { checkId: 'explicit-failure', status: 'failed' },
      { checkId: 'invented-terminal-settlement', status: 'passed' },
    ];
    candidate.summary.failedCheckCount = 0;
    candidate.summary.failedCheckIds = [];
  },
  /checks must match the recomputed canonical value/,
);
expectValidationFailure(
  candidate => { candidate.checks.push(candidate.checks[0]); },
  /checks must match the recomputed canonical value/,
);
expectValidationFailure(
  candidate => { candidate.scenarios.pop(); },
  /scenarios must contain exactly 4 canonical scenarios/,
);
expectValidationFailure(
  candidate => { candidate.summary.checkCount += 1; },
  /summary must match the recomputed canonical value/,
);
expectValidationFailure(
  candidate => { delete candidate.manifest; },
  /complete matching cooperative boundary manifest/,
);
expectValidationFailure(
  candidate => { candidate.adapterIdentityAuthority = 'package-owned'; },
  /adapterIdentityAuthority must be caller-declared/,
);
expectValidationFailure(
  candidate => {
    candidate.scenarios.find(scenario => scenario.scenario === 'cancellation')
      .expectedFailurePhase = null;
  },
  /cancellation.expectedFailurePhase must be cancellation/,
);
expectValidationFailure(
  candidate => { candidate.manifest.phases = {}; },
  /complete matching cooperative boundary manifest/,
);
expectValidationFailure(
  candidate => {
    candidate.scenarios.find(scenario => scenario.scenario === 'runtime-failure')
      .executionReport.boundaries = null;
  },
  /runtime-failure.executionReport must preserve canonical terminal failure settlement/,
);

await assert.rejects(
  () => runWebGpuCooperativeAdapterConformance(createInput({
    async runAdapter(context) {
      const result = await createInput().runAdapter(context);
      return {
        ...result,
        outputFingerprint: context.schedulingMode === 'disabled'
          ? 'sha256:drifted-glb'
          : result.outputFingerprint,
      };
    },
  })),
  error => {
    assert.match(error.message, /enabled-disabled-output-equivalence/);
    const failureReport = error.cooperativeAdapterConformanceReport;
    assert.equal(failureReport.status, 'failed');
    assert.equal(
      failureReport.checks.find(
        check => check.checkId === 'enabled-disabled-output-equivalence',
      ).status,
      'failed',
    );
    assert.ok(Object.isFrozen(failureReport));
    return true;
  },
);

await assert.rejects(
  () => runWebGpuCooperativeAdapterConformance(createInput({
    expectedFinalResources: ['scene.glb'],
  })),
  error => {
    assert.match(error.message, /resource-lifecycle/);
    const resourceCheck = error.cooperativeAdapterConformanceReport.checks
      .find(check => check.checkId === 'resource-lifecycle');
    assert.equal(resourceCheck.status, 'failed');
    assert.deepEqual(resourceCheck.detail.unexpectedResources, ['dino.weights']);
    return true;
  },
);

const consumeThenReleaseReport = await runWebGpuCooperativeAdapterConformance(createInput({
  manifest: createManifest({ releaseEncoderWeights: true }),
  expectedFinalResources: ['scene.glb'],
}));
const consumeThenReleaseCheck = consumeThenReleaseReport.checks
  .find(check => check.checkId === 'resource-lifecycle');
assert.equal(consumeThenReleaseCheck.status, 'passed');
assert.deepEqual(consumeThenReleaseCheck.detail.finalResources, ['scene.glb']);
assert.deepEqual(consumeThenReleaseCheck.detail.expectedFinalResources, ['scene.glb']);
assert.deepEqual(consumeThenReleaseCheck.detail.failures, []);

await assert.rejects(
  () => runWebGpuCooperativeAdapterConformance(createInput({
    async runAdapter({ cooperative }) {
      const encoder = cooperative.startBoundary('dino-window-tiles');
      for (let range = encoder.nextRange(); range; range = encoder.nextRange()) {
        await encoder.runGpuDuty(range, {
          encode() {
            return {};
          },
        });
      }
      return { outputFingerprint: 'sha256:partial-output' };
    },
  })),
  error => {
    const failureReport = error.cooperativeAdapterConformanceReport;
    assert.equal(failureReport.status, 'failed');
    assert.ok(
      failureReport.scenarios.some(
        scenario => scenario.executionReport.failure.phase === 'completion',
      ),
    );
    assert.ok(
      failureReport.checks.some(
        check => check.checkId === 'cooperative-success-terminal-settlement'
          && check.status === 'failed',
      ),
    );
    return true;
  },
);

await assert.rejects(
  () => runWebGpuCooperativeAdapterConformance(createInput({
    manifest: createManifest({ dynamicEncoderTotal: true }),
  })),
  error => {
    const failureReport = error.cooperativeAdapterConformanceReport;
    assert.equal(failureReport.status, 'failed');
    assert.ok(
      failureReport.scenarios.some(
        scenario => scenario.executionReport.failure.error.message
          .includes('totalItems must be a positive safe integer'),
      ),
    );
    return true;
  },
);

await assert.rejects(
  () => runWebGpuCooperativeAdapterConformance(createInput({
    async runAdapter(context) {
      const result = await createInput().runAdapter(context);
      return {
        ...result,
        outputFingerprint: context.schedulingMode === 'disabled'
          ? ''
          : result.outputFingerprint,
      };
    },
  })),
  error => {
    const failureReport = error.cooperativeAdapterConformanceReport;
    const disabledScenario = failureReport.scenarios.find(
      scenario => scenario.scenario === 'disabled-success',
    );
    assert.equal(disabledScenario.status, 'succeeded');
    assert.equal(disabledScenario.executionReport.status, 'succeeded');
    assert.match(disabledScenario.error.message, /outputFingerprint/);
    assert.equal(disabledScenario.outputFingerprint, null);
    assert.equal(
      failureReport.checks.find(
        check => check.checkId === 'enabled-disabled-output-equivalence',
      ).status,
      'failed',
    );
    return true;
  },
);

assert.throws(
  () => runWebGpuCooperativeAdapterConformance(createInput({
    adapterIdentity: {
      adapterId: 'sf3d.browser-webgpu.v0',
      routeId: ROUTE_ID,
      packageName: '@kaminos/webgpu-inference-kit',
    },
  })),
  /packageVersion must be a non-empty string/,
);

console.log('cooperative adapter conformance contracts passed');

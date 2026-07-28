import {
  WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA,
} from './cooperative-boundary-manifest.js';
import { createWebGpuCooperativeExecution } from './cooperative-execution.js';
import { WEBGPU_INFERENCE_KIT_VERSION } from './kernel-profile.js';

export const WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA =
  'kaminos.webgpu-cooperative-adapter-conformance-report.v0';

const SCENARIOS = Object.freeze([
  Object.freeze({
    scenario: 'cooperative-success',
    schedulingMode: 'cooperative',
    expectedStatus: 'succeeded',
  }),
  Object.freeze({
    scenario: 'disabled-success',
    schedulingMode: 'disabled',
    expectedStatus: 'succeeded',
  }),
  Object.freeze({
    scenario: 'cancellation',
    schedulingMode: 'cooperative',
    expectedStatus: 'cancelled',
    expectedFailurePhase: 'cancellation',
  }),
  Object.freeze({
    scenario: 'runtime-failure',
    schedulingMode: 'cooperative',
    expectedStatus: 'failed',
  }),
]);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireIdentity(name, value) {
  if (!isNonEmptyString(value)) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeIdentities(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const identities = value.map((identity, index) => requireIdentity(`${name}[${index}]`, identity));
  if (new Set(identities).size !== identities.length) {
    throw new TypeError(`${name} must not contain duplicate identities`);
  }
  return identities;
}

function normalizeAdapterIdentity(value, routeId) {
  if (!isPlainObject(value)) throw new TypeError('adapterIdentity must be an object');
  const normalized = {
    adapterId: requireIdentity('adapterIdentity.adapterId', value.adapterId),
    routeId: requireIdentity('adapterIdentity.routeId', value.routeId),
    packageName: requireIdentity('adapterIdentity.packageName', value.packageName),
    packageVersion: requireIdentity('adapterIdentity.packageVersion', value.packageVersion),
    sourceRevision: requireIdentity('adapterIdentity.sourceRevision', value.sourceRevision),
  };
  if (normalized.routeId !== routeId) {
    throw new Error('adapterIdentity.routeId must match the cooperative manifest routeId');
  }
  return normalized;
}

function createCheck(checkId, passed, detail = {}) {
  return {
    checkId,
    status: passed ? 'passed' : 'failed',
    detail: clone(detail),
  };
}

function attachReport(error, report) {
  const decorated = error instanceof Error ? error : new Error(String(error));
  try {
    Object.defineProperty(decorated, 'cooperativeAdapterConformanceReport', {
      value: report,
      configurable: true,
      enumerable: false,
    });
  } catch {
    decorated.cooperativeAdapterConformanceReport = report;
  }
  return decorated;
}

function normalizeError(error) {
  return {
    name: isNonEmptyString(error?.name) ? error.name : 'Error',
    message: isNonEmptyString(error?.message) ? error.message : String(error),
  };
}

function analyzeResourceLifecycle(manifest, initialResources, expectedFinalResources) {
  const live = new Set(initialResources);
  const failures = [];

  for (const phase of manifest.phases) {
    for (const boundary of phase.boundaries) {
      const { retain, produce, release } = boundary.resources;
      const overlap = produce.filter(
        resource => retain.includes(resource) || release.includes(resource),
      );
      if (overlap.length > 0) {
        failures.push({
          phaseId: phase.phaseId,
          boundaryId: boundary.boundaryId,
          reason: 'ambiguous-resource-transition',
          resources: overlap.sort(),
        });
      }
      const missingRetained = retain.filter(resource => !live.has(resource));
      if (missingRetained.length > 0) {
        failures.push({
          phaseId: phase.phaseId,
          boundaryId: boundary.boundaryId,
          reason: 'retained-resource-not-live',
          resources: missingRetained.sort(),
        });
      }
      const alreadyLiveProduced = produce.filter(resource => live.has(resource));
      if (alreadyLiveProduced.length > 0) {
        failures.push({
          phaseId: phase.phaseId,
          boundaryId: boundary.boundaryId,
          reason: 'produced-resource-already-live',
          resources: alreadyLiveProduced.sort(),
        });
      }
      const missingReleased = release.filter(resource => !live.has(resource));
      if (missingReleased.length > 0) {
        failures.push({
          phaseId: phase.phaseId,
          boundaryId: boundary.boundaryId,
          reason: 'released-resource-not-live',
          resources: missingReleased.sort(),
        });
      }
      for (const resource of produce) live.add(resource);
      for (const resource of release) live.delete(resource);
    }
  }

  const finalResources = [...live].sort();
  const expected = [...expectedFinalResources].sort();
  const expectedSet = new Set(expected);
  const finalSet = new Set(finalResources);
  const missingResources = expected.filter(resource => !finalSet.has(resource));
  const unexpectedResources = finalResources.filter(resource => !expectedSet.has(resource));
  return {
    passed: failures.length === 0
      && missingResources.length === 0
      && unexpectedResources.length === 0,
    detail: {
      initialResources: [...initialResources].sort(),
      expectedFinalResources: expected,
      finalResources,
      missingResources,
      unexpectedResources,
      failures,
    },
  };
}

function exactBoundaryCoverage(report) {
  const failures = [];
  for (const boundary of report.boundaries) {
    let cursor = 0;
    for (const [index, range] of boundary.ranges.entries()) {
      if (range.rangeIndex !== index
        || range.itemStart !== cursor
        || range.itemEnd !== range.itemStart + range.itemCount
        || range.itemEnd > boundary.totalItems) {
        failures.push({
          boundaryId: boundary.boundaryId,
          rangeId: range.rangeId || null,
          rangeIndex: index,
          expectedItemStart: cursor,
          actualItemStart: range.itemStart,
          itemEnd: range.itemEnd,
          itemCount: range.itemCount,
          totalItems: boundary.totalItems,
        });
      }
      cursor = range.itemEnd;
    }
    if (boundary.status !== 'complete'
      || boundary.totalItems == null
      || boundary.completedItems !== boundary.totalItems
      || cursor !== boundary.totalItems
      || boundary.actualRangeCount !== boundary.ranges.length
      || boundary.planner?.pendingRangeId != null) {
      failures.push({
        boundaryId: boundary.boundaryId,
        status: boundary.status,
        completedItems: boundary.completedItems,
        totalItems: boundary.totalItems,
        coveredItems: cursor,
        actualRangeCount: boundary.actualRangeCount,
        rangeCount: boundary.ranges.length,
        pendingRangeId: boundary.planner?.pendingRangeId || null,
      });
    }
  }
  return {
    passed: failures.length === 0,
    detail: {
      boundaryCount: report.boundaries.length,
      failures,
    },
  };
}

function analyzeProgress(scenario) {
  const report = scenario.executionReport;
  const expectedEventCount = report.boundaries
    .reduce((sum, boundary) => sum + boundary.ranges.length, 0);
  const events = scenario.progressEvents;
  const failures = [];
  let previousCompletedItems = 0;
  let previousProgress = 0;

  for (const [index, event] of events.entries()) {
    if (event.completedItems < previousCompletedItems) {
      failures.push({
        index,
        reason: 'completed-items-regressed',
        previousCompletedItems,
        completedItems: event.completedItems,
      });
    }
    if (event.progress != null) {
      if (event.totalItems == null) {
        failures.push({ index, reason: 'numeric-progress-without-denominator' });
      }
      if (event.progress < previousProgress) {
        failures.push({
          index,
          reason: 'progress-regressed',
          previousProgress,
          progress: event.progress,
        });
      }
      previousProgress = event.progress;
    }
    previousCompletedItems = event.completedItems;
  }

  if (events.length !== expectedEventCount) {
    failures.push({
      reason: 'progress-event-count-mismatch',
      expectedEventCount,
      actualEventCount: events.length,
    });
  }
  if (report.progress.totalItems == null
    || report.progress.progress !== 1
    || report.progress.percent !== 100) {
    failures.push({
      reason: 'terminal-progress-incomplete',
      progress: clone(report.progress),
    });
  }
  return {
    passed: failures.length === 0,
    detail: {
      expectedEventCount,
      actualEventCount: events.length,
      nullAggregateEventCount: events.filter(event => event.progress == null).length,
      failures,
    },
  };
}

function terminalSettlement(scenario) {
  const report = scenario.executionReport;
  const pendingRanges = report.boundaries
    .filter(boundary => boundary.planner?.pendingRangeId != null)
    .map(boundary => ({
      boundaryId: boundary.boundaryId,
      pendingRangeId: boundary.planner.pendingRangeId,
    }));
  const passed = scenario.status === scenario.expectedStatus
    && report.status === scenario.expectedStatus
    && (scenario.expectedFailurePhase == null
      || report.failure?.phase === scenario.expectedFailurePhase)
    && pendingRanges.length === 0;
  return {
    passed,
    detail: {
      expectedStatus: scenario.expectedStatus,
      expectedFailurePhase: scenario.expectedFailurePhase || null,
      scenarioStatus: scenario.status,
      reportStatus: report.status,
      failurePhase: report.failure?.phase || null,
      failureBoundaryId: report.failure?.boundaryId || null,
      pendingRanges,
    },
  };
}

function declaredWork(report) {
  return report.boundaries.map(boundary => ({
    phaseId: boundary.phaseId,
    boundaryId: boundary.boundaryId,
    kind: boundary.kind,
    unit: boundary.unit,
    completedItems: boundary.completedItems,
    totalItems: boundary.totalItems,
  }));
}

function createScenarioRuntime({ manifest, scenario, abortController, now }) {
  const hasGpuBoundary = manifest.phases.some(
    phase => phase.boundaries.some(boundary => boundary.kind === 'gpu-command'),
  );
  let injectedFailure = false;
  let injectedCancellation = false;
  const commandDuties = [];
  const hostPhases = [];

  function maybeCancel() {
    if (scenario.scenario === 'cancellation' && !injectedCancellation) {
      injectedCancellation = true;
      abortController.abort('adapter-conformance-cancellation');
    }
  }

  function maybeFail(kind) {
    if (scenario.scenario !== 'runtime-failure' || injectedFailure) return;
    if ((hasGpuBoundary && kind === 'gpu') || (!hasGpuBoundary && kind === 'cpu')) {
      injectedFailure = true;
      throw new Error(`adapter conformance injected ${kind} runtime failure`);
    }
  }

  const queue = {
    submit() {},
    async onSubmittedWorkDone() {
      maybeFail('gpu');
    },
  };

  return {
    routeId: manifest.routeId,
    runtimeLabel: 'kaminos-cooperative-adapter-conformance',
    queue,
    commandDuties: {
      async measureSubmission(descriptor, submit) {
        const result = await submit();
        commandDuties.push({
          boundaryId: descriptor.metadata.boundaryId,
          rangeId: descriptor.metadata.rangeId,
        });
        maybeCancel();
        return result;
      },
      snapshot() {
        return {
          status: 'recording',
          retention: 'uncapped',
          duties: clone(commandDuties),
        };
      },
    },
    hostPhases: {
      snapshot() {
        return {
          status: 'recording',
          retention: 'uncapped',
          phases: clone(hostPhases),
        };
      },
    },
    async runHostPhase(phase, fn, options) {
      maybeFail('cpu');
      const result = await fn();
      hostPhases.push({
        phase,
        detail: clone(options?.detail || {}),
      });
      maybeCancel();
      return result;
    },
    async runInvocation({ invocationId }, fn) {
      return fn({
        invocationId,
        schedulerRevision: 1,
        scheduler: {
          mode: scenario.schedulingMode,
          source: 'adapter-conformance',
        },
        async yieldToBrowser() {},
      });
    },
    async prepareCommandDutyAtBoundary(descriptor) {
      return {
        ...clone(descriptor),
        dutyId: `${descriptor.metadata.boundaryId}:${descriptor.metadata.rangeId}`,
      };
    },
    settleCommandDuty() {},
    now,
  };
}

async function runScenario({ input, manifest, adapterIdentity, scenario, scenarioIndex }) {
  const progressEvents = [];
  const abortController = new AbortController();
  let nowMs = scenarioIndex * 1000;
  const now = () => {
    nowMs += 1;
    return nowMs;
  };
  const runtime = createScenarioRuntime({
    manifest,
    scenario,
    abortController,
    now,
  });
  const invocationId = `${input.conformanceId}:${scenario.scenario}`;
  const expectedFailurePhase = scenario.scenario === 'runtime-failure'
    ? manifest.phases.some(
        phase => phase.boundaries.some(boundary => boundary.kind === 'gpu-command'),
      )
      ? 'queue-submission'
      : 'cpu-work'
    : scenario.expectedFailurePhase || null;
  const execution = createWebGpuCooperativeExecution({
    runtime,
    manifest,
    invocationId,
    schedulingMode: scenario.schedulingMode,
    signal: abortController.signal,
    now,
    onProgress(progress) {
      progressEvents.push(clone(progress));
    },
  });

  let output = null;
  let error = null;
  let executionReport;
  try {
    output = await execution.run(cooperative => input.runAdapter({
      cooperative,
      scenario: scenario.scenario,
      schedulingMode: scenario.schedulingMode,
      adapterIdentity: deepFreeze(clone(adapterIdentity)),
      manifest,
    }));
    executionReport = execution.finish();
  } catch (caught) {
    error = normalizeError(caught);
    executionReport = caught?.cooperativeExecutionReport || execution.snapshot();
  }

  let outputFingerprint = null;
  if (output != null) {
    try {
      outputFingerprint = requireIdentity(
        `${scenario.scenario}.outputFingerprint`,
        output.outputFingerprint,
      );
    } catch (caught) {
      error = normalizeError(caught);
    }
  }
  return {
    scenario: scenario.scenario,
    schedulingMode: scenario.schedulingMode,
    expectedStatus: scenario.expectedStatus,
    expectedFailurePhase,
    status: executionReport.status,
    invocationId,
    outputFingerprint,
    progressEvents,
    executionReport,
    error,
  };
}

async function runConformance(input, normalized) {
  const { manifest, adapterIdentity, initialResources, expectedFinalResources } = normalized;
  const scenarios = [];
  for (const [index, scenario] of SCENARIOS.entries()) {
    try {
      scenarios.push(await runScenario({
        input,
        manifest,
        adapterIdentity,
        scenario,
        scenarioIndex: index,
      }));
    } catch (error) {
      scenarios.push({
        scenario: scenario.scenario,
        schedulingMode: scenario.schedulingMode,
        expectedStatus: scenario.expectedStatus,
        expectedFailurePhase: scenario.scenario === 'runtime-failure'
          ? manifest.phases.some(
              phase => phase.boundaries.some(boundary => boundary.kind === 'gpu-command'),
            )
            ? 'queue-submission'
            : 'cpu-work'
          : scenario.expectedFailurePhase || null,
        status: 'harness-failed',
        invocationId: `${input.conformanceId}:${scenario.scenario}`,
        outputFingerprint: null,
        progressEvents: [],
        executionReport: null,
        error: normalizeError(error),
      });
    }
  }

  const checks = [];
  checks.push(createCheck('effective-runtime-identity', true, {
    routeId: manifest.routeId,
    manifestId: manifest.manifestId,
    kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
  }));
  checks.push(createCheck('declared-adapter-source-identity', true, {
    adapterIdentity,
    authority: 'caller-declared',
  }));
  checks.push(createCheck('uncapped-retention', true, {
    conformanceRetention: 'uncapped',
    scenarioCount: scenarios.length,
  }));

  const resourceLifecycle = analyzeResourceLifecycle(
    manifest,
    initialResources,
    expectedFinalResources,
  );
  checks.push(createCheck(
    'resource-lifecycle',
    resourceLifecycle.passed,
    resourceLifecycle.detail,
  ));

  for (const scenario of scenarios) {
    const settlement = scenario.executionReport
      ? terminalSettlement(scenario)
      : {
          passed: false,
          detail: {
            expectedStatus: scenario.expectedStatus,
            scenarioStatus: scenario.status,
            reportStatus: null,
            failurePhase: null,
            failureBoundaryId: null,
            pendingRanges: [],
            harnessError: scenario.error,
          },
        };
    checks.push(createCheck(
      `${scenario.scenario}-terminal-settlement`,
      settlement.passed,
      settlement.detail,
    ));

    if (scenario.expectedStatus === 'succeeded' && scenario.executionReport) {
      const coverage = exactBoundaryCoverage(scenario.executionReport);
      checks.push(createCheck(
        `${scenario.scenario}-boundary-coverage`,
        coverage.passed,
        coverage.detail,
      ));
      const progress = analyzeProgress(scenario);
      checks.push(createCheck(
        `${scenario.scenario}-progress`,
        progress.passed,
        progress.detail,
      ));
    }
  }

  const cooperative = scenarios.find(
    scenario => scenario.scenario === 'cooperative-success',
  );
  const disabled = scenarios.find(
    scenario => scenario.scenario === 'disabled-success',
  );
  const workEquivalent = cooperative?.executionReport != null
    && disabled?.executionReport != null
    && JSON.stringify(declaredWork(cooperative.executionReport))
      === JSON.stringify(declaredWork(disabled.executionReport));
  checks.push(createCheck('enabled-disabled-declared-work-equivalence', workEquivalent, {
    cooperative: cooperative?.executionReport
      ? declaredWork(cooperative.executionReport)
      : null,
    disabled: disabled?.executionReport
      ? declaredWork(disabled.executionReport)
      : null,
  }));

  const outputEquivalent = isNonEmptyString(cooperative?.outputFingerprint)
    && cooperative.outputFingerprint === disabled?.outputFingerprint;
  checks.push(createCheck('enabled-disabled-output-equivalence', outputEquivalent, {
    outputFingerprint: outputEquivalent ? cooperative.outputFingerprint : null,
    cooperativeOutputFingerprint: cooperative?.outputFingerprint || null,
    disabledOutputFingerprint: disabled?.outputFingerprint || null,
  }));

  const noPendingTerminalRanges = scenarios.every(scenario => (
    scenario.executionReport != null
    && scenario.executionReport.boundaries.every(
      boundary => boundary.planner?.pendingRangeId == null,
    )
  ));
  checks.push(createCheck('no-pending-terminal-ranges', noPendingTerminalRanges, {
    scenarios: scenarios.map(scenario => ({
      scenario: scenario.scenario,
      pendingRanges: scenario.executionReport?.boundaries
        .filter(boundary => boundary.planner?.pendingRangeId != null)
        .map(boundary => ({
          boundaryId: boundary.boundaryId,
          pendingRangeId: boundary.planner.pendingRangeId,
        })) || null,
    })),
  }));

  const failedChecks = checks.filter(check => check.status === 'failed');
  const report = deepFreeze({
    schema: WEBGPU_COOPERATIVE_ADAPTER_CONFORMANCE_REPORT_SCHEMA,
    status: failedChecks.length === 0 ? 'passed' : 'failed',
    conformanceId: input.conformanceId,
    routeId: manifest.routeId,
    manifestId: manifest.manifestId,
    kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
    adapterIdentity: clone(adapterIdentity),
    adapterIdentityAuthority: 'caller-declared',
    retention: 'uncapped',
    scenarios,
    checks,
    summary: {
      scenarioCount: scenarios.length,
      checkCount: checks.length,
      passedCheckCount: checks.length - failedChecks.length,
      failedCheckCount: failedChecks.length,
      failedCheckIds: failedChecks.map(check => check.checkId),
    },
  });

  if (report.status === 'failed') {
    throw attachReport(
      new Error(
        `cooperative adapter conformance failed: ${report.summary.failedCheckIds.join(', ')}`,
      ),
      report,
    );
  }
  return report;
}

export function runWebGpuCooperativeAdapterConformance(input = {}) {
  if (!isPlainObject(input)) throw new TypeError('adapter conformance input must be an object');
  const conformanceId = requireIdentity('conformanceId', input.conformanceId);
  const manifest = input.manifest;
  if (manifest?.schema !== WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA) {
    throw new TypeError('a cooperative boundary manifest is required');
  }
  const adapterIdentity = normalizeAdapterIdentity(input.adapterIdentity, manifest.routeId);
  if (typeof input.runAdapter !== 'function') {
    throw new TypeError('runAdapter must be a function');
  }
  const initialResources = normalizeIdentities(input.initialResources, 'initialResources');
  const expectedFinalResources = normalizeIdentities(
    input.expectedFinalResources,
    'expectedFinalResources',
  );
  return runConformance(
    { ...input, conformanceId },
    {
      manifest,
      adapterIdentity,
      initialResources,
      expectedFinalResources,
    },
  );
}

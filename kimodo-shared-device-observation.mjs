export function emptyObservationReport({ requestedUrl }) {
  return {
    schema: 'kaminos.kimodo-shared-device-operator-observation.v1',
    status: 'starting',
    failurePhase: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    requested: { url: requestedUrl },
    effective: null,
    telemetry: { samples: [], frameIntervalsMs: [], foregroundReceipts: [], runs: [], completedRuns: [] },
    observations: [],
    error: null,
  };
}

export function isTerminalRunStatus(status) {
  return !['running', 'finishing', 'finalizing'].includes(status);
}

export function mergeObservation(report, observation) {
  const telemetry = report.telemetry;
  const offsets = {
    samples: observation.sampleOffset ?? telemetry.samples.length,
    frameIntervalsMs: observation.frameIntervalOffset ?? telemetry.frameIntervalsMs.length,
    foregroundReceipts: observation.foregroundReceiptOffset ?? telemetry.foregroundReceipts.length,
  };
  for (const [key, offset] of Object.entries(offsets)) {
    if (offset !== telemetry[key].length) throw new Error(`${key} offset ${offset} does not match persisted count ${telemetry[key].length}`);
  }
  if (report.latest?.pageRuntimeId != null && observation.pageRuntimeId !== report.latest.pageRuntimeId) {
    throw new Error(`page runtime changed from ${report.latest.pageRuntimeId} to ${observation.pageRuntimeId ?? 'unknown'}`);
  }
  telemetry.samples.push(...(observation.samples ?? []));
  telemetry.frameIntervalsMs.push(...(observation.frameIntervals ?? []));
  telemetry.foregroundReceipts.push(...(observation.foregroundReceipts ?? []));
  telemetry.runs = observation.runs ?? telemetry.runs;
  telemetry.completedRuns.push(...(observation.completedRuns ?? []));
  report.latest = {
    at: observation.at,
    url: observation.url ?? null,
    pageRuntimeId: observation.pageRuntimeId ?? null,
    pageStatePresent: observation.pageStatePresent === true,
    state: observation.state ?? null,
  };
  report.observations.push({
    at: observation.at,
    url: observation.url ?? null,
    pageRuntimeId: observation.pageRuntimeId ?? null,
    pageStatePresent: observation.pageStatePresent === true,
    sampleCount: telemetry.samples.length,
    frameIntervalCount: telemetry.frameIntervalsMs.length,
    foregroundReceiptCount: telemetry.foregroundReceipts.length,
    runCount: telemetry.runs.length,
    newlyCompletedRunCount: observation.completedRuns?.length ?? 0,
  });
  report.updatedAt = observation.at;
}

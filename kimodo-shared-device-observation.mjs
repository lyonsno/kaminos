export function emptyObservationReport({ requestedUrl }) {
  return {
    schema: 'kaminos.kimodo-shared-device-operator-observation.v1',
    status: 'starting',
    failurePhase: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    requested: { url: requestedUrl },
    effective: null,
    telemetry: { samples: [], frameIntervalsMs: [], foregroundReceipts: [], runs: [] },
    observations: [],
    error: null,
  };
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
  telemetry.samples.push(...(observation.samples ?? []));
  telemetry.frameIntervalsMs.push(...(observation.frameIntervals ?? []));
  telemetry.foregroundReceipts.push(...(observation.foregroundReceipts ?? []));
  telemetry.runs = observation.runs ?? telemetry.runs;
  report.latest = {
    at: observation.at,
    url: observation.url ?? null,
    pageStatePresent: observation.pageStatePresent === true,
    state: observation.state ?? null,
  };
  report.observations.push({
    at: observation.at,
    url: observation.url ?? null,
    pageStatePresent: observation.pageStatePresent === true,
    sampleCount: telemetry.samples.length,
    frameIntervalCount: telemetry.frameIntervalsMs.length,
    foregroundReceiptCount: telemetry.foregroundReceipts.length,
    runCount: telemetry.runs.length,
  });
  report.updatedAt = observation.at;
}

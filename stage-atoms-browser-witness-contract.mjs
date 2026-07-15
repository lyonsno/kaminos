const DEFAULT_THRESHOLDS = Object.freeze({
  maxWindowSkewSeconds: 0.03,
  minimumSampleCount: 8,
  minimumSpectralCentroidRatio: 1.45,
  minimumHighBandRatioDelta: 0.015,
  minimumOutputRmsRatio: 1.8,
  minimumAudibleRms: 0.001,
  effectiveRouteAuthority: 'role-ordered-material-dsp',
});

export function evaluateMatchedAudioTransductionEvidence(scenarios, thresholds = {}) {
  const contract = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const closedAperture = scenarios?.closedAperture || {};
  const openAperture = scenarios?.openAperture || {};
  const quietRelease = scenarios?.quietRelease || {};
  const loudRelease = scenarios?.loudRelease || {};
  const samples = [closedAperture, openAperture, quietRelease, loudRelease];
  const spectralCentroidRatio = Number(openAperture.spectralCentroidHz || 0) / Math.max(1, Number(closedAperture.spectralCentroidHz || 0));
  const highBandRatioDelta = Number(openAperture.highBandRatio || 0) - Number(closedAperture.highBandRatio || 0);
  const outputRmsRatio = Number(loudRelease.outputRms || 0) / Math.max(0.000001, Number(quietRelease.outputRms || 0));
  const matchedWindows = samples.every(sample => (
    Number(sample.sampleCount) >= contract.minimumSampleCount &&
    Math.abs(Number(sample.startTime) - Number(closedAperture.startTime)) < contract.maxWindowSkewSeconds &&
    Math.abs(Number(sample.endTime) - Number(closedAperture.endTime)) < contract.maxWindowSkewSeconds
  ));
  const effectiveRouteExecuted = samples.every(sample => sample.effectiveParameters?.authority === contract.effectiveRouteAuthority);
  const failures = [];
  if (!matchedWindows) failures.push('source_window_mismatch');
  if (!effectiveRouteExecuted) failures.push('effective_audio_route_mismatch');
  if (!samples.every(sample => Number(sample.outputRms || 0) >= contract.minimumAudibleRms)) failures.push('silent_audio_scenario');
  if (spectralCentroidRatio < contract.minimumSpectralCentroidRatio || highBandRatioDelta < contract.minimumHighBandRatioDelta) {
    failures.push('weak_aperture_spectral_delta');
  }
  if (outputRmsRatio < contract.minimumOutputRmsRatio) failures.push('weak_release_output_delta');
  return {
    closedAperture,
    openAperture,
    quietRelease,
    loudRelease,
    spectralCentroidRatio,
    highBandRatioDelta,
    outputRmsRatio,
    matchedWindows,
    effectiveRouteExecuted,
    failures,
    thresholds: contract,
  };
}

export function assertMatchedAudioTransductionEvidence(scenarios, thresholds = {}) {
  const evidence = evaluateMatchedAudioTransductionEvidence(scenarios, thresholds);
  if (evidence.failures.length) {
    const error = new Error(`matched_audio_transduction_failed:${evidence.failures.join(',')}`);
    error.code = 'matched_audio_transduction_failed';
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}

export function assessControlledStepSequence(frames, requestedFrameCount, requestedRenderScales) {
  const sessionIds = new Set(frames.map(frame => frame.sameBrowserSessionId));
  const sameBrowserSequenceSuitable = frames.length === requestedFrameCount
    && frames.length > 0
    && sessionIds.size === 1
    && !sessionIds.has(null)
    && !sessionIds.has(undefined);
  const simStepCounts = frames.map(frame => frame.captures?.[0]?.simStepCount ?? null);
  const frameImageHashes = frames.map(frame => frame.captures?.[0]?.image?.sha256 ?? null);
  const imageEvidenceValid = Array.isArray(requestedRenderScales)
    && requestedRenderScales.length > 0
    && frames.every(frame => frame.captures?.length === requestedRenderScales.length
    && frame.captures.every((capture, index) => capture.requestedRenderScale === requestedRenderScales[index]
      && Number.isInteger(capture.renderWidth) && capture.renderWidth > 1
      && Number.isInteger(capture.renderHeight) && capture.renderHeight > 1
      && capture.imageWidth === capture.renderWidth
      && capture.imageHeight === capture.renderHeight
      && typeof capture.image?.path === 'string' && capture.image.path.endsWith('.png')
      && capture.image.authority === 'gpu-presentation-texture-rgba8-readback-frozen-sim-state'
      && /^[0-9a-f]{64}$/.test(capture.image.sha256 || '')
      && capture.image.sourceSimStepCount === capture.simStepCount
      && capture.image.sourceSameStateCaptureId === capture.sameStateCaptureId));
  const first = frames[0];
  const firstCapture = first?.controlledStepCapture;
  const validInitialState = first?.controlledStepFrameIndex === 0
    && firstCapture?.ok === true
    && firstCapture.sampleAuthority === 'controlled-step-initial-state'
    && Number.isInteger(firstCapture.beforeSimStepCount)
    && firstCapture.beforeSimStepCount === firstCapture.afterSimStepCount
    && first.captures?.length > 0
    && first.captures.every(capture => capture.simStepCount === firstCapture.afterSimStepCount);
  const advancedFramesValid = frames.slice(1).every((frame, offset) => {
    const capture = frame.controlledStepCapture;
    const previous = frames[offset].controlledStepCapture;
    return frame.controlledStepFrameIndex === offset + 1
      && capture?.ok === true
      && capture.sampleAuthority === 'controlled-step-sim-advance'
      && Number.isInteger(capture.beforeSimStepCount)
      && Number.isInteger(capture.afterSimStepCount)
      && capture.beforeSimStepCount === previous?.afterSimStepCount
      && capture.afterSimStepCount > capture.beforeSimStepCount
      && frame.captures?.length > 0
      && frame.captures.every(sample => sample.simStepCount === capture.afterSimStepCount);
  });
  const stepSequenceVerified = sameBrowserSequenceSuitable
    && frames.length >= 2
    && validInitialState
    && advancedFramesValid;
  const frameEvidenceComplete = sameBrowserSequenceSuitable
    && validInitialState
    && advancedFramesValid
    && imageEvidenceValid;
  return {
    sampleAuthority: stepSequenceVerified && frameEvidenceComplete
      ? 'controlled-step-sim-advance'
      : frames.length === 1 && frameEvidenceComplete
        ? 'controlled-step-initial-state'
        : 'controlled-step-unverified',
    sameBrowserSequenceSuitable,
    stepSequenceVerified,
    frameEvidenceComplete,
    visualJudgment: 'operator-inspection-required',
    simStepCounts,
    frameImageHashes,
  };
}

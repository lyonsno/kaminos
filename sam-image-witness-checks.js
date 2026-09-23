function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateSamConsumerInteraction(evidence, invocationId) {
  check(evidence.sameDevice === true, 'inference did not use the host device');
  check(evidence.sameRendererDevice === true, 'Three.js did not use the host device');
  const { invocation, foreground } = evidence;
  check(invocation?.invocationId === invocationId, 'interaction belongs to another invocation');
  const start = invocation.startedAtMs, end = invocation.completedAtMs;
  check(Number.isFinite(start) && Number.isFinite(end) && end > start, 'missing browser invocation bounds');
  check(foreground?.failure === null, 'foreground failed');
  const inputs = foreground.inputs.filter(input => input.trusted && input.receivedAtMs >= start && input.receivedAtMs < end);
  check(inputs.length > 0, 'no trusted input received during inference');
  const responses = [];
  for (let i = 1; i < foreground.frames.length; i += 1) {
    const frame = foreground.frames[i], previous = foreground.frames[i - 1];
    if (!(frame.submittedAtMs >= start && frame.submittedAtMs < end)) continue;
    const input = inputs.find(row => row.id === frame.inputIds.at(-1));
    if (!input || input.receivedAtMs > frame.submittedAtMs) continue;
    if (!['zoom', 'panX', 'panY'].every(key => frame[key] === input[key])) continue;
    if (!['zoom', 'panX', 'panY'].some(key => frame[key] !== previous[key])) continue;
    responses.push({ inputId: input.id, receivedAtMs: input.receivedAtMs, submittedAtMs: frame.submittedAtMs,
      inputToSubmitMs: frame.submittedAtMs - input.receivedAtMs });
  }
  check(responses.length > 0, 'no input-correlated view change submitted during inference');
  return { start, end, receivedInputCount: inputs.length, responses,
    authority: 'input-to-same-device-submission-liveness; cadence-is-measured-not-a-smoothness-verdict' };
}

export function validateSamFlameAdvance(before, after, observedMs) {
  check(before?.active === true && after?.active === true, 'flame stopped during the observation interval');
  check(Number.isFinite(before.frameCount) && Number.isFinite(after.frameCount)
    && after.frameCount > before.frameCount, 'flame frame counter did not advance during the observation interval');
  check(Number.isFinite(before.simStepCount) && Number.isFinite(after.simStepCount)
    && after.simStepCount > before.simStepCount, 'flame simulation counter did not advance during the observation interval');
  check(Number.isFinite(observedMs) && observedMs > 0, 'flame advance observation interval is invalid');
  return { beforeFrameCount: before.frameCount, afterFrameCount: after.frameCount,
    frameDelta: after.frameCount - before.frameCount,
    beforeSimStepCount: before.simStepCount, afterSimStepCount: after.simStepCount,
    simStepDelta: after.simStepCount - before.simStepCount, observedMs };
}

export function validateSamFlameComposition({ output, bridge, sceneObject, sourceSha256, expectedPrompt, presentation,
  selectedIndices, volume, advanceEvidence, pixelEvidence }) {
  check(output?.outputAuthority === 'actual-webgpu-readback', 'mask is not actual browser WebGPU output');
  check(output?.verificationState === 'not-attached', 'mask verification authority was overstated');
  check(output?.effectiveRouteId === 'sam3.detr-encoder.phase-program.webgpu-local.v0', 'unexpected SAM route');
  check(typeof expectedPrompt === 'string' && output?.promptText === expectedPrompt,
    'composed mask prompt does not match the requested prompt');
  check(presentation?.activeTab === 'assets' && presentation.samImageViewportHidden === true,
    'live flame composition is not visible in the Assets scene');
  check(typeof output?.invocationId === 'string' && output.invocationId.length > 0, 'missing SAM invocation identity');
  check(Array.isArray(output?.instances) && output.instances.length > 0, 'composition has no selected SAM candidates');
  check(Array.isArray(selectedIndices) && selectedIndices.length > 0, 'composition has no selected picker instance');
  check(volume?.active === true && typeof volume.backend === 'string' && volume.backend.startsWith('WebGPU:'),
    'live flame is not active on WebGPU');
  const advance = validateSamFlameAdvance(advanceEvidence?.before, advanceEvidence?.after, advanceEvidence?.observedMs);
  check(advance.afterFrameCount <= volume.frameCount && advance.afterSimStepCount <= volume.simStepCount,
    'flame advance witness predates the captured live volume state');
  check(bridge?.presentation === 'source-image-mask-overlay' && bridge.maskOverlayCount === 1,
    'live renderer did not select the source-image mask presentation');
  const overlay = bridge.maskOverlay;
  check(overlay?.visible === true, 'live flame overlay is not visible');
  check(overlay.method === '2d-image-space-mask' && overlay.fireSimulationModified === false
    && overlay.persistence === 'live-only', 'composition claims geometry, simulation control, or persistence');
  check(overlay.outputAuthority === output.outputAuthority && overlay.verificationState === output.verificationState,
    'overlay provenance does not match SAM output authority');
  check(overlay.invocationId === output.invocationId, 'overlay belongs to another SAM invocation');
  check(Array.isArray(overlay.instanceIndices) && overlay.instanceIndices.length === selectedIndices.length
    && overlay.instanceIndices.every((index, i) => index === selectedIndices[i])
    && selectedIndices.every(index => output.instances.some(instance => instance.index === index)),
  'overlay instance does not match the selected instance');
  check(sceneObject?.type === 'image', 'source image plane is not a registered scene object');
  const provenance = sceneObject.image?.maskProvenance;
  const composition = sceneObject.image?.flameComposition;
  check(provenance?.invocationId === output.invocationId, 'scene image provenance belongs to another invocation');
  check(provenance?.outputAuthority === output.outputAuthority && provenance?.verificationState === output.verificationState,
    'scene image provenance authority does not match SAM output');
  check(provenance?.sourceImage?.sha256 === sourceSha256 && overlay.sourceImageSha256 === sourceSha256,
    'scene composition source hash does not match the ingressed image');
  check(Array.isArray(provenance?.indices) && provenance.indices.length === selectedIndices.length
    && provenance.indices.every((index, i) => index === selectedIndices[i]),
  'scene provenance does not match the selected instance');
  check(Array.isArray(provenance?.dimensions) && provenance.dimensions[0] === sceneObject.image.width
    && provenance.dimensions[1] === sceneObject.image.height, 'mask dimensions do not match the source image plane');
  check(composition?.method === '2d-image-space-mask' && composition.status === 'active' && composition.fireSimulationModified === false
    && composition.persistence === 'live-only', 'scene metadata overstates the composition');
  const layer = presentation?.compositionLayer;
  check(layer?.enabled === true && layer.sceneCanvasVisible === true && layer.sceneCanvasOpacity > 0
    && layer.sceneCanvasZIndex > layer.volumeCanvasZIndex && layer.volumeCanvasVisible === false
    && layer.volumeCanvasOpacity === 0, 'live flame composition is not visibly layered in the scene renderer');
  check(pixelEvidence?.authority === 'playwright-visible-viewport-screenshot-pixels',
    'final scene pixels were not sampled from visible browser viewport screenshots');
  const sourceCapture = pixelEvidence.sourceFrameCapture;
  const composedCapture = pixelEvidence.composedFrameCapture;
  const validCapture = capture => typeof capture?.path === 'string' && capture.path.length > 0
    && Number.isInteger(capture.bytes) && capture.bytes > 0
    && Number.isInteger(capture.width) && capture.width > 0
    && Number.isInteger(capture.height) && capture.height > 0
    && capture.authority === pixelEvidence.authority
    && /^sha256:[0-9a-f]{64}$/.test(capture.sha256 || '');
  check(validCapture(sourceCapture) && validCapture(composedCapture),
    'paired visible screenshots are missing complete capture receipts');
  check(sourceCapture.path !== composedCapture.path && sourceCapture.sha256 !== composedCapture.sha256,
    'source and composed screenshots reuse the same capture');
  check(pixelEvidence.sourceScreenshotSize?.width === sourceCapture.width
    && pixelEvidence.sourceScreenshotSize?.height === sourceCapture.height
    && pixelEvidence.composedScreenshotSize?.width === composedCapture.width
    && pixelEvidence.composedScreenshotSize?.height === composedCapture.height
    && sourceCapture.width === composedCapture.width && sourceCapture.height === composedCapture.height,
  'source and composed screenshots do not share complete viewport dimensions');
  check(Number.isFinite(pixelEvidence.viewport?.width) && pixelEvidence.viewport.width > 0
    && Number.isFinite(pixelEvidence.viewport?.height) && pixelEvidence.viewport.height > 0
    && Number.isFinite(pixelEvidence.viewport?.devicePixelRatio) && pixelEvidence.viewport.devicePixelRatio > 0,
  'screenshot viewport dimensions are missing');
  for (const key of ['foreground', 'background']) {
    const sample = pixelEvidence[key];
    check(Number.isInteger(sample?.sourceScreenshotPixel?.x) && Number.isInteger(sample.sourceScreenshotPixel.y)
      && Number.isInteger(sample?.composedScreenshotPixel?.x) && Number.isInteger(sample.composedScreenshotPixel.y)
      && sample.sourceScreenshotPixel.x === sample.composedScreenshotPixel.x
      && sample.sourceScreenshotPixel.y === sample.composedScreenshotPixel.y
      && sample.sourceScreenshotPixel.x >= 0 && sample.sourceScreenshotPixel.x < sourceCapture.width
      && sample.sourceScreenshotPixel.y >= 0 && sample.sourceScreenshotPixel.y < sourceCapture.height,
    `${key} source/composed screenshots sampled different coordinates`);
  }
  const pixelDistance = (a, b) => {
    const rgba = value => Array.isArray(value) && value.length === 4
      && value.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255);
    check(rgba(a) && rgba(b), 'pixel evidence is incomplete or outside 8-bit RGBA');
    return a.slice(0, 3).reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);
  };
  check(pixelEvidence.foreground?.maskValue === 1
    && pixelDistance(pixelEvidence.foreground.sourceRgba, pixelEvidence.foreground.composedRgba) > 24,
  'masked foreground pixels do not show live flame contribution');
  check(pixelEvidence.background?.maskValue === 0
    && pixelDistance(pixelEvidence.background.sourceRgba, pixelEvidence.background.composedRgba) <= 18,
  'masked background pixels show flame outside the selected mask');
  return { invocationId: output.invocationId, route: output.effectiveRouteId, promptText: expectedPrompt,
    presentation, sourceSha256,
    dimensions: provenance.dimensions, instanceIndices: overlay.instanceIndices, method: composition.method,
    outputAuthority: output.outputAuthority, verificationState: output.verificationState,
    fireSimulationModified: false, persistence: 'live-only', advance };
}

export function validateSamConsumerExport(exported, { kind, width, height, mask, sourcePixels, libraryEntry }) {
  check(exported.mimeType === 'image/png', 'export is not PNG');
  check(exported.width === width && exported.height === height, 'export is not source-size');
  check(exported.pixels.length === width * height * 4, 'partial export pixels');
  check(mask.length === width * height && sourcePixels.length === width * height * 4, 'partial source contract');
  for (const key of ['source', 'sha256', 'name']) {
    check(typeof exported[key] === 'string' && exported[key] === libraryEntry?.[key], `persisted export ${key} mismatch`);
  }
  let foregroundPixels = 0;
  for (let i = 0; i < mask.length; i += 1) {
    check(mask[i] === 0 || mask[i] === 1, 'nonbinary source mask');
    foregroundPixels += mask[i];
    const offset = i * 4;
    const alpha = kind === 'mask' ? 255 : sourcePixels[offset + 3] * mask[i];
    check(exported.pixels[offset + 3] === alpha, `wrong ${kind} alpha at pixel ${i}`);
    if (kind === 'mask' || alpha > 0) for (let channel = 0; channel < 3; channel += 1) {
      const expected = kind === 'mask' ? mask[i] * 255 : sourcePixels[offset + channel];
      check(exported.pixels[offset + channel] === expected, `wrong ${kind} RGB at pixel ${i}`);
    }
  }
  check(foregroundPixels > 0 && foregroundPixels < mask.length, 'export lacks a discriminating foreground/background selection');
  return { width, height, foregroundPixels, exactPixels: true };
}

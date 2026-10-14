function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function samControlIsFullyVisible(button) {
  const rect = button.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
  for (let parent = button.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    const left = bounds.left + parent.clientLeft, top = bounds.top + parent.clientTop;
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)
      && (rect.left < left || rect.right > left + parent.clientWidth)) return false;
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)
      && (rect.top < top || rect.bottom > top + parent.clientHeight)) return false;
  }
  return true;
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

export function validateSamApplicationForeground(evidence, invocationId) {
  check(evidence?.sameDevice === true && evidence?.sameRendererDevice === true, 'application device mismatch');
  const foreground = evidence.runtime?.applicationForegroundEvidence;
  const routeId = 'sam3.resident-model-owner.webgpu-local.v0';
  check(foreground?.routeId === routeId && foreground.status === 'idle' && foreground.error === null,
    'missing or unsettled application foreground evidence');
  const run = foreground.lastRun;
  check(run?.runId === invocationId && run.routeId === routeId, 'application foreground belongs to another run or route');
  check(run.status === 'succeeded' && run.pendingRequestCount === 0, 'application foreground handback failed');
  check(Array.isArray(run.receipts) && run.receipts.some(receipt => receipt.status === 'completed'
    && receipt.metadata?.renderer === 'kaminos-app'),
    'no completed application foreground callback');
  check(run.receipts.every(receipt => receipt.runId === invocationId && receipt.routeId === routeId
    && receipt.failure === null), 'application foreground receipt failed or belongs to another run');
  const frames = run.receipts.filter(row => row.status === 'completed' && row.metadata?.renderer === 'kaminos-app')
    .map(samApplicationFrameObservation);
  check(frames.some(frame => frame.drawn), 'no new application scene draw inside this run');
  return { runId: invocationId, routeId, completedCallbacks: frames.length,
    renderedCallbacks: frames.filter(frame => frame.drawn).length, skippedCallbacks: frames.filter(frame => !frame.drawn).length,
    authority: 'application-callback-and-queue-settlement-not-presented-frame-cadence' };
}

export function validateSamApplicationFrame(receipt) {
  const frame = samApplicationFrameObservation(receipt);
  check(frame.drawn, 'application scene draw was skipped for this callback');
  return frame;
}

function samApplicationFrameObservation(receipt) {
  check(receipt?.status === 'completed' && receipt.failure === null, 'application frame callback failed');
  const result = receipt.result, before = result?.sceneFrameCountBefore, after = result?.sceneFrameCountAfter;
  check(Number.isSafeInteger(before) && before >= 0 && Number.isSafeInteger(after) && after >= before
    && result.sceneFrameCount === after, 'application callback lacks per-request scene draw counts');
  const drawn = after > before;
  check(result.sceneDrawn === drawn && result.sceneAuthority === (drawn
    ? 'three-render-returned-inside-service-not-presentation' : 'scene-draw-skipped-this-request'),
  'application scene draw identity contradicts its frame counts');
  return { drawn, before, after, authority: result.sceneAuthority };
}

export function validateSamExportProvenance(provenance, { kind, source, output, indices, width, height }) {
  const expected = {
    schema: 'kaminos.sam3-mask-export.v1', kind,
    sourceImage: source.source, sourceImageSha256: source.sha256, sourceArtifactId: source.artifactId,
    sourceResolution: [width, height], promptText: output.promptText, promptSha256: output.promptSha256,
    invocationId: output.invocationId, indices, maskResolution: [output.width, output.height],
    effectiveRouteId: output.effectiveRouteId, outputAuthority: output.outputAuthority,
    verificationState: output.verificationState,
  };
  check(provenance && typeof provenance === 'object', 'persisted PNG has no mask provenance');
  for (const [key, value] of Object.entries(expected)) {
    const actual = provenance[key];
    check(Array.isArray(value) ? Array.isArray(actual) && actual.length === value.length
      && actual.every((entry, index) => entry === value[index]) : actual === value,
    `persisted PNG provenance ${key} mismatch`);
  }
  return { invocationId: provenance.invocationId, sourceImageSha256: provenance.sourceImageSha256,
    indices: [...provenance.indices], authority: 'persisted-PNG-metadata-matched-to-live-source-and-selection' };
}

export function validateSamNativeSourceHandoff({ selected, source, mode, maskPanelActive }, expectedSha256) {
  check(selected?.kind === 'image' && typeof selected.source === 'string' && selected.source.length > 0,
    'no selected library image at Masks entry');
  check(selected.sha256 === expectedSha256 && source?.sha256 === expectedSha256
    && source.source === selected.source, 'Masks opened a different source than the selected library image');
  check(mode === 'workbench' && maskPanelActive === true, 'selected-image Masks action did not open the mask tools');
  return { source: source.source, sha256: source.sha256, entry: 'asset-open-masks',
    authority: 'actual-Authoring-selected-image-action-and-loaded-source' };
}

export function validateSamMaskControls(state) {
  check(state.mode === 'workbench' && state.tab === 'masks', 'Masks workspace or tab is not active');
  check(state.promptVisible === true && state.runVisible === true && state.runDisabled === false
    && state.failed === false, 'Masks prompt/run controls are unavailable');
}

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

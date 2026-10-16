// Evidence admission for the proxy measurement harnesses: a result is counted
// under its requested label only when the workload it names actually ran.
// Anything else is excluded with reasons, never compared or summarized.

// A fire sweep arm: the stepping mode was accepted, the effective ray steps and
// render scale match, every timed render succeeded, and a complete primary
// frame was captured.
export function fireSweepArmAdmission(requested, effective, steppingError, { frame, renders } = {}) {
  const reasons = [];
  if (steppingError) reasons.push(`stepping refused: ${steppingError}`);
  if (effective?.opticalStepping !== requested.mode) reasons.push(`stepping ${effective?.opticalStepping} instead of ${requested.mode}`);
  if (effective?.raySteps !== requested.steps) reasons.push(`ray steps ${effective?.raySteps} instead of ${requested.steps}`);
  if (!(Math.abs(Number(effective?.renderScale) - requested.scale) <= 1e-6)) reasons.push(`render scale ${effective?.renderScale} instead of ${requested.scale}`);
  if (frame !== undefined) {
    const complete = frame?.ok === true && Number.isInteger(frame.width) && Number.isInteger(frame.height) && frame.width > 0 && frame.height > 0
      && frame.bytes === frame.width * frame.height * 4;
    if (!complete) reasons.push(`no complete primary frame${frame?.reason ? ` (${frame.reason})` : ''}`);
  }
  if (renders && renders.failed > 0) reasons.push(`${renders.failed} timed renders failed`);
  return { admitted: reasons.length === 0, reasons };
}

// A water cadence window: the host presented the requested display, the
// effective sim time policy matches the requested step interval, and a proxy
// window drew a populated proxy with no producer failure.
export function waterCadenceWindowAdmission(config, measured) {
  const reasons = [];
  if (measured?.presentation !== config.water) reasons.push(`presentation ${measured?.presentation} instead of ${config.water}`);
  const expectedPolicy = config.water === 'proxy' && config.stepEvery > 1 ? `one-fixed-1/60-step-every-${config.stepEvery}-rendered-frames` : 'one-fixed-1/60-step-per-rendered-frame';
  if (measured?.timePolicy !== expectedPolicy) reasons.push(`time policy ${measured?.timePolicy} instead of ${expectedPolicy}`);
  if (config.water === 'proxy') {
    if (!(measured?.surfels > 0)) reasons.push('proxy drew no surfels');
    if (measured?.producerError) reasons.push(`proxy producer failed: ${measured.producerError}`);
  }
  return { admitted: reasons.length === 0, reasons };
}

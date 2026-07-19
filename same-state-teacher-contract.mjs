const REQUIRED_INITIAL_FIELD_IDENTITY = 'same-state-teacher-initial-field-v0';
const REQUIRED_SUBTRACTION_IDENTITY = 'source-centroid-aligned-rigid-displacement-subtraction-v0';
const NAMED_RESIDUAL = 'source-relative-upper-plume-inertial-lag-v0';

function requireCondition(condition, reason) {
  if (!condition) throw new Error(reason);
}

function initialFieldKey(sequence) {
  const field = sequence?.initialField;
  requireCondition(field?.identity === REQUIRED_INITIAL_FIELD_IDENTITY, 'missing-same-state-initial-field-identity');
  requireCondition(Number.isInteger(field.grid) && field.grid > 0, 'missing-same-state-grid');
  requireCondition(Number.isInteger(field.simStepCount) && field.simStepCount >= 0, 'missing-same-state-step');
  requireCondition(/^[a-f0-9]{64}$/i.test(String(field.fluidSha256 || '')), 'missing-same-state-fluid-sha256');
  requireCondition(/^[a-f0-9]{64}$/i.test(String(field.frontSha256 || '')), 'missing-same-state-front-sha256');
  return [field.grid, field.simStepCount, field.fluidSha256, field.frontSha256].join(':');
}

function validateArm(arm, expectedArm) {
  requireCondition(arm?.sequence?.arm === expectedArm, `wrong-teacher-arm:${expectedArm}`);
  requireCondition(arm.sequence.completedSteps === arm.sequence.requestedSteps, `partial-teacher-sequence:${expectedArm}`);
  requireCondition(arm.sequence.requestedSteps > 0, `blank-teacher-sequence:${expectedArm}`);
  requireCondition(arm.sequence.rigidDisplacementSubtraction === 'required-before-teacher-residual-v0', `missing-rigid-displacement-receipt:${expectedArm}`);
  requireCondition(Array.isArray(arm.sequence.effectiveFrames), `missing-effective-emitter-frames:${expectedArm}`);
  requireCondition(arm.sequence.effectiveFrames.length === arm.sequence.requestedSteps, `partial-effective-emitter-frames:${expectedArm}`);
  requireCondition(arm.sequence.effectiveFrames.every(frame => frame.emitterCount > 0), `blank-emitter-frame:${expectedArm}`);
  requireCondition(arm.render?.ok === true, `missing-teacher-render:${expectedArm}`);
  requireCondition(arm.render.complete === true, `partial-teacher-render:${expectedArm}`);
  requireCondition(arm.render.nonblank === true, `blank-teacher-render:${expectedArm}`);
  requireCondition(/^[a-f0-9]{64}$/i.test(String(arm.render.sha256 || '')), `missing-teacher-render-sha256:${expectedArm}`);
}

export function validateSameStateTeacherPair(pair) {
  validateArm(pair?.control, 'stationary-source-control');
  validateArm(pair?.teacher, 'moving-source-wind-teacher');
  const controlKey = initialFieldKey(pair.control.sequence);
  const teacherKey = initialFieldKey(pair.teacher.sequence);
  requireCondition(controlKey === teacherKey, 'unmatched-initial-fields');
  const subtraction = pair.residual?.rigidDisplacementSubtraction;
  requireCondition(pair.residual?.identity === 'rigid-subtracted-low-frequency-field-projection-v0', 'missing-rigid-subtracted-residual-identity');
  requireCondition(pair.residual?.residualName === NAMED_RESIDUAL, 'wrong-teacher-residual-name');
  requireCondition(typeof pair.residual?.path === 'string' && pair.residual.path.length > 0, 'missing-teacher-residual-artifact');
  requireCondition(/^[a-f0-9]{64}$/i.test(String(pair.residual?.sha256 || '')), 'missing-teacher-residual-sha256');
  requireCondition(subtraction?.identity === REQUIRED_SUBTRACTION_IDENTITY, 'missing-rigid-displacement-subtraction');
  requireCondition(subtraction.applied === true, 'rigid-displacement-subtraction-not-applied');
  requireCondition(Array.isArray(subtraction.worldDisplacement) && subtraction.worldDisplacement.length === 3, 'missing-world-rigid-displacement');
  requireCondition(Array.isArray(subtraction.imageDisplacementPx) && subtraction.imageDisplacementPx.length === 2, 'missing-image-rigid-displacement');
  requireCondition(subtraction.worldDisplacement.every(Number.isFinite), 'invalid-world-rigid-displacement');
  requireCondition(subtraction.imageDisplacementPx.every(Number.isFinite), 'invalid-image-rigid-displacement');
  return {
    initialFieldKey: controlKey,
    requestedSteps: pair.control.sequence.requestedSteps,
    subtraction,
  };
}

export function selectShortestVisibleTeacherResidual(rows, thresholds = {}) {
  const minimumChangedPixelFraction = Number(thresholds.minimumChangedPixelFraction ?? 0.01);
  const minimumUpperPlumeLagPx = Number(thresholds.minimumUpperPlumeLagPx ?? 2);
  requireCondition(Array.isArray(rows) && rows.length > 0, 'missing-teacher-horizon-rows');
  let priorSteps = 0;
  for (const row of rows) {
    const validated = validateSameStateTeacherPair(row);
    requireCondition(Number.isFinite(Number(row.horizonMs)) && Number(row.horizonMs) > 0, 'invalid-teacher-horizon-ms');
    requireCondition(validated.requestedSteps > priorSteps, 'teacher-horizons-not-strictly-increasing');
    priorSteps = validated.requestedSteps;
    const changedPixelFraction = Number(row.residual.changedPixelFraction);
    const upperPlumeLagPx = Number(row.residual.upperPlumeLagPx);
    requireCondition(Number.isFinite(changedPixelFraction), 'missing-changed-pixel-fraction');
    requireCondition(Number.isFinite(upperPlumeLagPx), 'missing-upper-plume-lag');
    if (changedPixelFraction >= minimumChangedPixelFraction && Math.abs(upperPlumeLagPx) >= minimumUpperPlumeLagPx) {
      return {
        identity: 'shortest-visible-same-state-teacher-residual-v0',
        residualName: NAMED_RESIDUAL,
        requestedSteps: validated.requestedSteps,
        horizonMs: row.horizonMs,
        changedPixelFraction,
        upperPlumeLagPx,
        thresholds: { minimumChangedPixelFraction, minimumUpperPlumeLagPx },
      };
    }
  }
  return null;
}

export function validateSameStateTeacherWitnessIdentity(report) {
  const shortest = report?.shortestVisibleResidual;
  requireCondition(shortest?.residualName === NAMED_RESIDUAL, 'wrong-summary-teacher-residual-name');
  const selectedRow = report?.horizons?.find(
    row => row.control?.sequence?.requestedSteps === shortest.requestedSteps,
  );
  requireCondition(selectedRow?.residual?.residualName === NAMED_RESIDUAL, 'wrong-selected-row-teacher-residual-name');
  return selectedRow;
}

export const SAME_STATE_TEACHER_CONTRACT = Object.freeze({
  initialFieldIdentity: REQUIRED_INITIAL_FIELD_IDENTITY,
  subtractionIdentity: REQUIRED_SUBTRACTION_IDENTITY,
  residualName: NAMED_RESIDUAL,
});

// A sweep arm is admitted to the comparison only when the renderer actually ran
// what the arm requested: the stepping mode was accepted and the effective ray
// steps and render scale match. Anything else is a different arm and is
// excluded with its reasons, never compared under the requested label.
export function fireSweepArmAdmission(requested, effective, steppingError) {
  const reasons = [];
  if (steppingError) reasons.push(`stepping refused: ${steppingError}`);
  if (effective?.opticalStepping !== requested.mode) reasons.push(`stepping ${effective?.opticalStepping} instead of ${requested.mode}`);
  if (effective?.raySteps !== requested.steps) reasons.push(`ray steps ${effective?.raySteps} instead of ${requested.steps}`);
  if (!(Math.abs(Number(effective?.renderScale) - requested.scale) <= 1e-6)) reasons.push(`render scale ${effective?.renderScale} instead of ${requested.scale}`);
  return { admitted: reasons.length === 0, reasons };
}

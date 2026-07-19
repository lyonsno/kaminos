export const NATIVE96_LEARNED_FORCING_TEMPORAL_IDENTITY = 'native96-learned-forcing-continuous-cue-v0';

export function planNative96LearnedForcingTick(options = {}) {
  const sourceStepBefore = Math.max(0, Math.floor(Number(options.sourceStepBefore) || 0));
  const learnedRefreshCadence = Math.max(1, Math.floor(Number(options.learnedRefreshCadence) || 1));
  const producedAtSourceStep = options.producedAtSourceStep == null
    ? null
    : Math.max(0, Math.floor(Number(options.producedAtSourceStep) || 0));
  const sourceStepAfter = sourceStepBefore + 1;
  const cueValid = options.cueValid === true;
  const modelRefreshDue = !cueValid
    || producedAtSourceStep === null
    || sourceStepAfter - producedAtSourceStep >= learnedRefreshCadence;

  return Object.freeze({
    identity: NATIVE96_LEARNED_FORCING_TEMPORAL_IDENTITY,
    sourceStepBefore,
    sourceStepAfter,
    sourceStepDelta: 1,
    learnedRefreshCadence,
    modelRefreshDue,
    cueBlendDue: true,
    producedAtSourceStep,
    cueAgeBeforeRefresh: producedAtSourceStep === null ? null : sourceStepAfter - producedAtSourceStep,
  });
}

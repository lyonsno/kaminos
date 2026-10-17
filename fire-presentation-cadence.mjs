// Decoupled fire cadence: when the sim steps every N presented frames, the
// raymarch shows the latest real state carried forward along its own velocity
// by the fraction of a step that has elapsed (presentationAdvect in the WGSL).
// Presentation only; nothing feeds back into the sim. The phase is 0 on the
// frame a step lands, and it holds while the sim is paused.
export function presentationPhase(pacing) {
 if (!pacing || pacing.presentationAdvect !== true) return 0;
 return stepFraction(pacing);
}

// Blend: the raymarch reads mix(previous real state, current real state, t).
// On a step frame t is 0 and the previous state is the one just replaced, so
// what is shown runs one step behind the sim and never jumps.
export function presentationBlendPhase(pacing) {
 if (!pacing || pacing.presentationBlend !== true) return 0;
 return stepFraction(pacing);
}

function stepFraction(pacing) {
 const every = Math.max(1, Math.floor(Number(pacing.simStepEvery)) || 1), frame = Math.floor(Number(pacing.frame));
 if (every <= 1 || !Number.isFinite(frame) || frame < 0) return 0;
 return (frame % every) / every;
}

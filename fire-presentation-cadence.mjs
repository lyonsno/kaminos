// Decoupled fire cadence: when the sim steps every N presented frames, the
// raymarch shows the latest real state carried forward along its own velocity
// by the fraction of a step that has elapsed (presentationAdvect in the WGSL).
// Presentation only; nothing feeds back into the sim. The phase is 0 on the
// frame a step lands, and it holds while the sim is paused.
export function presentationPhase(pacing, {paused = false} = {}) {
 // Paused: show the real state rather than a held extrapolation.
 if (!pacing || pacing.presentationAdvect !== true || paused) return 0;
 return stepFraction(pacing);
}

// Blend: the raymarch reads mix(previous real state, current real state, t).
// On a step frame t is 0 and the previous state is the one just replaced, so
// what is shown runs one step behind the sim and never jumps.
export function presentationBlendPhase(pacing, {paused = false} = {}) {
 if (!pacing || pacing.presentationBlend !== true) return 0;
 // Paused: show the current real state, crisp, not a held half-mix. Stepping
 // every frame (frame detail alone) shows the current state too.
 if (paused || Math.floor(Number(pacing.simStepEvery)) <= 1) return 1;
 return stepFraction(pacing);
}

function stepFraction(pacing) {
 const every = Math.max(1, Math.floor(Number(pacing.simStepEvery)) || 1), frame = Math.floor(Number(pacing.frame));
 if (every <= 1 || !Number.isFinite(frame) || frame < 0) return 0;
 return (frame % every) / every;
}

// Speed is the world rate: when the sim steps every N presented frames, each
// step covers N frames of world time, so the sim runs at N times the Speed.
export function cadenceSimSpeed(worldSpeed, every) {
 return worldSpeed * Math.max(1, Math.floor(Number(every)) || 1);
}

// Auto: how much of the motion-compensated in-between to show in a cell. The
// previous state carried forward and the current state carried backward meet
// at the in-between; if they agree better than the two states do standing
// still, the motion is real and following it keeps the detail. Where aligning
// explains nothing (a standing shape, a source, a new burn) the cell blends.
// The blend kernel computes the same in WGSL.
export function autoFollowWeight(plainDifference, alignedDifference) {
 if (!(plainDifference > 0)) return 0;
 return Math.min(1, Math.max(0, (plainDifference - alignedDifference) / Math.max(plainDifference, 1e-6)));
}

// Flame Doctor's coordinate-set cross-fade (waveletBlendA), on continuous time
// so frame detail never pops between real steps: set A weighs 0 when it resets
// to the lattice and 1 half a period later.
export function waveletCoherenceBlendA(step, period = 48) {
 const phase = ((step % period) + period) % period / period;
 return 1 - Math.abs(2 * phase - 1);
}

// The blend pass's uniform block (12 floats): t, auto (1) or blend (0),
// follow, frame detail, grid width, grid height, one step's displacement scale
// (cells per unit velocity), wavelet octaves, coordinate set A's weight at
// this instant, whether the coordinates ride the flow, and two spare lanes.
export function presentationBlendUniforms({phase, mode, follow, detail, grid, gridY, backtraceScale, octaves, simStep, coordinatesCarried}) {
 return new Float32Array([phase, mode === 'auto' ? 1 : 0, follow, detail, grid, gridY, backtraceScale, octaves,
  waveletCoherenceBlendA(simStep + phase), coordinatesCarried ? 1 : 0, 0, 0]);
}

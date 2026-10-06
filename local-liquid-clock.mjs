// Solver submissions and display frames have independent lifetimes. Completion
// is certified only by the device queue, including when the display is held.
export function createLiquidClock({ step, drain, assertCurrent = () => {}, runId, stepSeconds = 1 / 60 }) {
  if (!runId || !(Number.isFinite(stepSeconds) && stepSeconds > 0)) throw Error('Clock identity and positive step duration required');
  let submittedSteps = 0, completedSteps = 0, paused = false, busy = false, failure = null;
  const check = () => { if (failure) throw Error(failure); assertCurrent(); };
  const read = () => ({ runId, submittedSteps, completedSteps, simulationSeconds: completedSteps * stepSeconds,
    stepSeconds, paused, busy, failure });
  const submit = () => { check(); step(stepSeconds); submittedSteps++; };
  const finish = async () => { const through = submittedSteps; await drain(); check(); completedSteps = through; };
  async function heldWork(action) {
    check();
    if (busy) throw Error('Water clock operation already in progress');
    busy = true; paused = true;
    try { await action(); return read(); }
    catch (error) { failure = error.message || String(error); throw error; }
    finally { busy = false; }
  }
  return {
    read,
    setPaused(value) { check(); if (busy && !value) throw Error('Water clock is advancing; keep it held'); paused = Boolean(value); return paused; },
    tick() { if (!paused && !busy) submit(); },
    hold: () => heldWork(finish).then(() => read()),
    async advanceTo(seconds) {
      check();
      if (!Number.isFinite(seconds) || seconds < 0) throw Error('Simulation time must be finite and nonnegative');
      const target = Math.round(seconds / stepSeconds);
      if (!Number.isSafeInteger(target) || Math.abs(target * stepSeconds - seconds) > 1e-9)
        throw Error('Requested simulation time must align with a fixed solver step');
      if (!paused) throw Error('Hold the water runtime before advancing');
      if (target < submittedSteps) throw Error('Requested time precedes this runtime; reopen the authored scene to replay');
      await heldWork(async () => { while (submittedSteps < target) submit(); await finish(); });
      return read();
    },
  };
}

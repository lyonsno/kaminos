// The live budget agents' browser runs stay within (operator, 2026-10-18:
// "160 needs to feel expensive to agents"). Live viewing uses 6-8 adaptive
// ray steps and a high setting 32-40; an authored basin saved at 160 steps is
// an offline look. A run whose fire raymarches above the budget for two
// consecutive observations stops, unless it explicitly opted in because the
// question needs that look. The peak is always recorded.
export const AGENT_LIVE_BUDGET = Object.freeze({ fireRaySteps: 40 });
const SUSTAINED_OBSERVATIONS = 2;

export function createAgentLiveBudget({ allowed = false } = {}) {
  let maxFireRaySteps = null, over = 0, violation = null;
  return {
    observe({ fireRaySteps } = {}) {
      const steps = Number(fireRaySteps);
      if (fireRaySteps == null || !Number.isFinite(steps)) { over = 0; return; }
      maxFireRaySteps = maxFireRaySteps == null ? steps : Math.max(maxFireRaySteps, steps);
      over = steps > AGENT_LIVE_BUDGET.fireRaySteps ? over + 1 : 0;
      // Judged on the current state: lowering the steps clears it, so a slow
      // basin load followed by a live tier is not punished; the peak stays.
      violation = !allowed && over >= SUSTAINED_OBSERVATIONS
        ? `the fire raymarches at ${steps} steps, above the live budget of ${AGENT_LIVE_BUDGET.fireRaySteps} (live viewing uses 6-8 adaptive)` : null;
    },
    check() {
      if (violation) throw new Error(`over-live-budget: ${violation}. Lower the steps (Preview, or a live tier), or pass --allow-over-live-budget 1 if the question needs this look.`);
    },
    report: () => ({ budget: { ...AGENT_LIVE_BUDGET }, allowed, maxFireRaySteps, violation }),
  };
}

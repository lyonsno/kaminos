import { fractureArchStructuralProxy, solveArchStructuralForce } from './structural-material-arch-core.js';

export const ARCH_HISTORY_RECIPE = Object.freeze({
  contact: Object.freeze({ x: 0.35, y: 0.2, patchRadius: 0.032 }),
  priorForces: Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5]),
  fractureThreshold: 0.04,
  solverLoad: Object.freeze({ contactDepthMode: 'through-thickness', iterations: 1200 }),
  matchedForce: 0.5,
});

export function buildArchDamageHistory(base) {
  let state = base;
  const events = [];
  const steps = [];
  for (const force of ARCH_HISTORY_RECIPE.priorForces) {
    const solved = solveArchStructuralForce(state, {
      ...ARCH_HISTORY_RECIPE.contact,
      ...ARCH_HISTORY_RECIPE.solverLoad,
      force,
    });
    state = fractureArchStructuralProxy(solved, { threshold: ARCH_HISTORY_RECIPE.fractureThreshold });
    const stepEvents = state.events.slice(events.length);
    events.push(...stepEvents);
    steps.push({
      force,
      newBondEvents: stepEvents.length,
      connectivityEpoch: state.connectivityEpoch,
      brokenBondCount: state.bonds.filter(bond => !bond.alive).length,
      componentCount: state.components.length,
    });
    if (state.components.length !== base.components.length) {
      throw new Error('arch damage history unexpectedly separated the continuous proxy');
    }
  }
  return { state, events, steps };
}

import { ARCH_COLLAPSE_ROUTE } from './structural-material-arch-collapse.js';

export function inspectArchCollapseState(state, expectedConfig = {}) {
  const errors = [];
  if (state?.route !== ARCH_COLLAPSE_ROUTE || state?.backend !== 'cannon-es-cpu' || state?.engineVersion !== '0.20.0') errors.push('wrong effective physics route');
  for (const [name, value] of Object.entries(expectedConfig)) if (state?.config?.[name] !== value) errors.push(`effective config mismatch: ${name}`);
  if (!Number.isInteger(state?.step) || !Number.isFinite(state?.time) ||
      Math.abs(state.time - state.step * state.config?.timeStep) > 1e-9) errors.push('missing or inconsistent simulation time');
  if (!Array.isArray(state?.bodies) || state.bodies.length === 0 || !Array.isArray(state?.bonds) || state.bonds.length === 0) {
    errors.push('missing structural output'); return { errors, minimumY: null };
  }
  if (!['dx','dy','dz'].every(axis => Number.isFinite(state.dimensions?.[axis]) && state.dimensions[axis] > 0)) errors.push('invalid physical dimensions');
  let minimumY = Infinity;
  for (const body of state.bodies) {
    if (!['position','velocity','quaternion','rest'].every(field => ['x','y','z'].every(axis => Number.isFinite(body[field]?.[axis]))) ||
        !Number.isFinite(body.quaternion?.w)) { errors.push(`nonfinite body: ${body.index}`); continue; }
    const q = body.quaternion;
    if (Math.abs(Math.hypot(q.x,q.y,q.z,q.w) - 1) > 1e-6) errors.push(`invalid rotation: ${body.index}`);
    if (body.pinned && ['x','y','z'].some(axis => Math.abs(body.position[axis] - body.rest[axis]) > 1e-10)) errors.push(`support moved: ${body.index}`);
    const yx = 2 * (q.x * q.y + q.z * q.w), yy = 1 - 2 * (q.x*q.x + q.z*q.z), yz = 2 * (q.y*q.z - q.x*q.w);
    const extent = 0.49 * (Math.abs(yx)*state.dimensions.dx + Math.abs(yy)*state.dimensions.dy + Math.abs(yz)*state.dimensions.dz);
    minimumY = Math.min(minimumY, body.position.y - extent);
  }
  if (state.bonds.some(bond => typeof bond.alive !== 'boolean' || !state.bodies[bond.a] || !state.bodies[bond.b])) errors.push('invalid connection state');
  if (state.broken !== state.bonds.filter(bond => !bond.alive).length) errors.push('damage count disagrees with connections');
  if (!Number.isFinite(state.floorY) || minimumY < state.floorY - Math.max(state.dimensions.dx, state.dimensions.dy, state.dimensions.dz)) {
    errors.push('invalid floor containment');
  }
  return { errors, minimumY };
}

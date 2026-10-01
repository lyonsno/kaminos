import * as CANNON from 'cannon-es';

export const ARCH_COLLAPSE_ROUTE = 'kaminos.structural-material.arch-gravity-collapse.cannon.v0';
const vector = value => new CANNON.Vec3(value.x, value.y, value.z);
const xyz = value => ({ x: value.x, y: value.y, z: value.z });
const quaternionDot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

export function coarsenArchProfile(source, columns = 18, rows = 14) {
  const occupancy = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const x = Math.min(source.columns - 1, Math.floor((column + 0.5) * source.columns / columns));
    const y = Math.min(source.rows - 1, Math.floor((row + 0.5) * source.rows / rows));
    return source.occupancy[y * source.columns + x];
  });
  return { ...source, columns, rows, occupancy, constructionSource: {
    kind: 'source-raster-center-resampling-v0', columns: source.columns, rows: source.rows,
  } };
}

export function createArchCollapse(profile, options = {}) {
  if (!Number.isInteger(profile.columns) || !Number.isInteger(profile.rows) ||
      profile.columns < 1 || profile.rows < 1 ||
      profile.occupancy?.length !== profile.columns * profile.rows ||
      profile.occupancy.some(value => typeof value !== 'boolean')) throw new Error('invalid arch occupancy');
  if (!profile.bounds || [0, 1].some(axis => !Number.isFinite(profile.bounds.min?.[axis]) ||
      !Number.isFinite(profile.bounds.max?.[axis]) || profile.bounds.max[axis] <= profile.bounds.min[axis])) {
    throw new Error('arch bounds must be finite and increasing');
  }
  const config = {
    layers: 3, depth: 0.65, scale: 4, density: 1, gravity: 9.81,
    timeStep: 1 / 60, solverIterations: 20, solverTolerance: 1e-8,
    stiffness: 1e6, strength: 160, friction: 0.65, restitution: 0.03,
    gripStiffness: 250, gripDamping: 5, ...options,
  };
  for (const name of ['depth', 'scale', 'density', 'timeStep', 'stiffness', 'strength', 'gripStiffness']) {
    if (!Number.isFinite(config[name]) || config[name] <= 0) throw new Error(`${name} must be positive and finite`);
  }
  if (!Number.isFinite(config.gravity) || config.gravity < 0) throw new Error('gravity must be nonnegative and finite');
  for (const name of ['friction', 'restitution', 'gripDamping', 'solverTolerance']) {
    if (!Number.isFinite(config[name]) || config[name] < 0) throw new Error(`${name} must be nonnegative and finite`);
  }
  if (!Number.isInteger(config.solverIterations) || config.solverIterations <= 0) {
    throw new Error('solverIterations must be a positive integer');
  }
  if (!Number.isInteger(config.layers) || config.layers < 2) throw new Error('layers must be at least two');
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -config.gravity, 0), allowSleep: false });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = config.solverIterations;
  world.solver.tolerance = config.solverTolerance;
  world.defaultContactMaterial.friction = config.friction;
  world.defaultContactMaterial.restitution = config.restitution;
  const dx = (profile.bounds.max[0] - profile.bounds.min[0]) * config.scale / profile.columns;
  const dy = (profile.bounds.max[1] - profile.bounds.min[1]) * config.scale / profile.rows;
  const dz = config.depth / config.layers;
  const floorY = profile.bounds.min[1] * config.scale;
  const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floor.position.y = floorY;
  world.addBody(floor);
  const cells = [], byGrid = new Map(), bonds = [], events = [], samples = [];
  let stepIndex = 0, connectivityEpoch = 0, hand = null, disposed = false;
  const lowest = [Infinity, Infinity];
  for (let row = 0; row < profile.rows; row++) for (let column = 0; column < profile.columns; column++) {
    if (profile.occupancy[row * profile.columns + column]) {
      const side = column < profile.columns / 2 ? 0 : 1;
      lowest[side] = Math.min(lowest[side], row);
    }
  }
  for (let layer = 0; layer < config.layers; layer++) {
    for (let row = 0; row < profile.rows; row++) for (let column = 0; column < profile.columns; column++) {
      if (!profile.occupancy[row * profile.columns + column]) continue;
      const pinned = row === lowest[column < profile.columns / 2 ? 0 : 1];
      const half = new CANNON.Vec3(dx * 0.49, dy * 0.49, dz * 0.49);
      const body = new CANNON.Body({ mass: pinned ? 0 : dx * dy * dz * config.density,
        shape: new CANNON.Box(half), linearDamping: 0.08, angularDamping: 0.12 });
      body.position.set((profile.bounds.min[0] + (column + 0.5) * dx / config.scale) * config.scale,
        floorY + (row + 0.5) * dy, -config.depth / 2 + (layer + 0.5) * dz);
      body.allowSleep = false;
      world.addBody(body);
      const cell = { index: cells.length, id: `cell:${column}:${row}:${layer}`, column, row, layer,
        pinned, half, body, rest: body.position.clone(), volume: dx * dy * dz };
      cells.push(cell);
      byGrid.set(`${column}:${row}:${layer}`, cell.index);
    }
  }
  function attach(bond) {
    const a = cells[bond.a].body, b = cells[bond.b].body;
    const joint = new CANNON.LockConstraint(a, b);
    joint.collideConnected = false;
    for (const equation of joint.equations) equation.setSpookParams(config.stiffness, 4, config.timeStep);
    world.addConstraint(joint);
    bond.joint = joint;
    bond.alive = true;
  }
  for (const cell of cells) for (const [dc, dr, dl, area] of
    [[1, 0, 0, dy * dz], [0, 1, 0, dx * dz], [0, 0, 1, dx * dy]]) {
    const b = byGrid.get(`${cell.column + dc}:${cell.row + dr}:${cell.layer + dl}`);
    if (b === undefined || cell.pinned && cells[b].pinned) continue;
    const normal = new CANNON.Vec3(dc, dr, dl);
    const midpoint = cell.rest.vadd(cells[b].rest).scale(0.5);
    const bond = { id: `connection:${bonds.length}`, a: cell.index, b, area, normal,
      anchorA: midpoint.vsub(cell.rest), anchorB: midpoint.vsub(cells[b].rest),
      reaction: 0, stress: 0, alive: true, lastBreakStep: null };
    attach(bond);
    bonds.push(bond);
  }
  function components() {
    const adjacency = cells.map(() => []);
    for (const bond of bonds) if (bond.alive) { adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a); }
    const labels = cells.map(() => -1), result = [];
    for (const cell of cells) {
      if (labels[cell.index] >= 0) continue;
      const queue = [cell.index], label = result.length;
      labels[cell.index] = label;
      let pinned = false, mass = 0;
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i]; pinned ||= cells[current].pinned; mass += cells[current].body.mass;
        for (const next of adjacency[current]) if (labels[next] < 0) { labels[next] = label; queue.push(next); }
      }
      result.push({ id: label, count: queue.length, pinned, mass });
    }
    return { labels, components: result };
  }
  function step() {
    if (disposed) throw new Error('arch collapse is disposed');
    const started = performance.now();
    world.step(config.timeStep);
    stepIndex++;
    if (hand) {
      const force = new CANNON.Vec3();
      for (const equation of hand.joint.equations) {
        force.vadd(equation.jacobianElementA.spatial.scale(equation.multiplier), force);
      }
      hand.force = xyz(force);
    }
    const failed = [];
    for (const bond of bonds) {
      if (!bond.alive) continue;
      const force = new CANNON.Vec3(), torque = new CANNON.Vec3();
      for (const equation of bond.joint.equations) {
        force.vadd(equation.jacobianElementB.spatial.scale(equation.multiplier), force);
        torque.vadd(equation.jacobianElementB.rotational.scale(equation.multiplier), torque);
      }
      bond.reaction = force.length();
      const normal = cells[bond.a].body.vectorToWorldFrame(bond.normal);
      const axial = force.dot(normal);
      const shear = Math.sqrt(Math.max(0, force.lengthSquared() - axial * axial));
      // Bonded-block traction proxy: compression is carried, tension/shear and bending may fracture.
      bond.stress = (Math.max(0, -axial) + shear + torque.length() / Math.sqrt(bond.area)) / bond.area;
      if (bond.stress > config.strength) failed.push(bond);
    }
    if (failed.length) connectivityEpoch++;
    for (const bond of failed) {
      world.removeConstraint(bond.joint); bond.joint = null; bond.alive = false; bond.lastBreakStep = stepIndex;
      events.push({ kind: 'crack', id: bond.id, step: stepIndex, time: stepIndex * config.timeStep,
        epoch: connectivityEpoch, reaction: bond.reaction, stress: bond.stress, area: bond.area,
        energyProxy: bond.reaction * cells[bond.a].body.velocity.vsub(cells[bond.b].body.velocity).length() * config.timeStep,
        handActive: Boolean(hand) });
    }
    samples.push({ step: stepIndex, milliseconds: performance.now() - started, cracks: failed.length,
      handActive: Boolean(hand), contacts: world.contacts.length });
  }
  function setHand(index, target, localPoint = { x: 0, y: 0, z: 0 }) {
    const cell = cells[index];
    if (!cell || cell.layer !== config.layers - 1 || cell.pinned) throw new Error('hand requires unpinned front-layer cell');
    if ([target.x, target.y, target.z, localPoint.x, localPoint.y, localPoint.z].some(value => !Number.isFinite(value))) {
      throw new Error('hand coordinates must be finite');
    }
    if (!hand || hand.index !== index) {
      release();
      const anchor = new CANNON.Body({ mass: 0, position: vector(target) });
      world.addBody(anchor);
      const joint = new CANNON.PointToPointConstraint(cell.body, vector(localPoint), anchor, new CANNON.Vec3());
      for (const equation of joint.equations) equation.setSpookParams(config.gripStiffness, config.gripDamping, config.timeStep);
      world.addConstraint(joint);
      hand = { index, target: anchor.position, anchor, joint, localPoint: vector(localPoint), layers: [cell.layer], force: { x: 0, y: 0, z: 0 } };
    }
    hand.target.copy(vector(target)); hand.localPoint.copy(vector(localPoint)); hand.joint.pivotA.copy(hand.localPoint);
  }
  function release() {
    if (hand) { world.removeConstraint(hand.joint); world.removeBody(hand.anchor); }
    hand = null;
  }
  function bind(index, radius = Math.max(dx, dy) * 2) {
    const cell = cells[index];
    if (!cell) throw new Error('bind requires known cell');
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('bind radius must be positive and finite');
    const repaired = [];
    for (const bond of bonds) {
      if (bond.alive) continue;
      const a = cells[bond.a], b = cells[bond.b];
      if (a.body.position.distanceTo(cell.body.position) > radius && b.body.position.distanceTo(cell.body.position) > radius) continue;
      const faceA = a.body.pointToWorldFrame(bond.anchorA), faceB = b.body.pointToWorldFrame(bond.anchorB);
      if (faceA.distanceTo(faceB) > Math.min(dx, dy, dz) * 0.15 ||
        Math.abs(quaternionDot(a.body.quaternion, b.body.quaternion)) < 0.98) continue;
      attach(bond); repaired.push(bond.id);
    }
    if (repaired.length) connectivityEpoch++;
    for (const id of repaired) events.push({ kind: 'bind', id, step: stepIndex, epoch: connectivityEpoch });
    return repaired;
  }
  function snapshot() {
    const graph = components();
    return { route: ARCH_COLLAPSE_ROUTE, backend: 'cannon-es-cpu', engineVersion: '0.20.0', config,
      step: stepIndex, time: stepIndex * config.timeStep, connectivityEpoch, floorY, dimensions: { dx, dy, dz },
      hand: hand ? { index: hand.index, layers: hand.layers, target: xyz(hand.target), force: hand.force } : null,
      bodies: cells.map(cell => ({ index: cell.index, id: cell.id, column: cell.column, row: cell.row,
        layer: cell.layer, pinned: cell.pinned, mass: cell.body.mass, volume: cell.volume,
        position: xyz(cell.body.position), rest: xyz(cell.rest), velocity: xyz(cell.body.velocity),
        quaternion: { ...xyz(cell.body.quaternion), w: cell.body.quaternion.w },
        component: graph.labels[cell.index], stress: Math.max(0, ...bonds.filter(bond =>
          bond.alive && (bond.a === cell.index || bond.b === cell.index)).map(bond => bond.stress)) })),
      bonds: bonds.map(({ joint, normal, anchorA, anchorB, ...bond }) =>
        ({ ...bond, normal: xyz(normal), anchorA: xyz(anchorA), anchorB: xyz(anchorB) })),
      broken: bonds.filter(bond => !bond.alive).length, components: graph.components,
      events: events.map(event => ({ ...event })), samples: samples.map(sample => ({ ...sample })),
    };
  }
  return { world, cells, bonds, step, setHand, bind, release, snapshot,
    worldToLocalPoint: (index, point) => {
      if (!cells[index] || [point.x, point.y, point.z].some(value => !Number.isFinite(value))) {
        throw new Error('world point requires known cell and finite coordinates');
      }
      return cells[index].body.pointToLocalFrame(vector(point));
    },
    dispose: () => { disposed = true; release(); for (const joint of [...world.constraints]) world.removeConstraint(joint);
      for (const body of [...world.bodies]) world.removeBody(body); } };
}

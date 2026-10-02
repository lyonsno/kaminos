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
    gripStiffness: 250, gripDamping: 5, gripRadius: 0.55, ...options,
  };
  for (const name of ['depth', 'scale', 'density', 'timeStep', 'stiffness', 'strength', 'gripStiffness']) {
    if (!Number.isFinite(config[name]) || config[name] <= 0) throw new Error(`${name} must be positive and finite`);
  }
  if (!Number.isFinite(config.gravity) || config.gravity < 0) throw new Error('gravity must be nonnegative and finite');
  for (const name of ['friction', 'restitution', 'gripDamping', 'gripRadius', 'solverTolerance']) {
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
      reaction: 0, bendingReaction: 0, stress: 0, alive: true, lastBreakStep: null };
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
      for (const member of hand.members) for (const equation of member.joint.equations) {
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
      }
      for (const equation of [bond.joint.rotationalEquation1, bond.joint.rotationalEquation2, bond.joint.rotationalEquation3]) {
        torque.vadd(equation.jacobianElementB.rotational.scale(equation.multiplier), torque);
      }
      bond.reaction = force.length();
      bond.bendingReaction = torque.length();
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
        epoch: connectivityEpoch, reaction: bond.reaction, bendingReaction: bond.bendingReaction, stress: bond.stress, area: bond.area,
        energyProxy: (bond.reaction * cells[bond.a].body.velocity.vsub(cells[bond.b].body.velocity).length() +
          bond.bendingReaction * cells[bond.a].body.angularVelocity.vsub(cells[bond.b].body.angularVelocity).length()) * config.timeStep,
        handActive: Boolean(hand) });
    }
    samples.push({ step: stepIndex, milliseconds: performance.now() - started, cracks: failed.length,
      handActive: Boolean(hand), contacts: world.contacts.length });
  }
  function setHand(index, target, localPoint = { x: 0, y: 0, z: 0 }) {
    const cell = cells[index];
    if (!cell || cell.layer !== config.layers - 1 || cell.pinned) throw new Error('hand requires unpinned front-layer cell');
    setGrip(index, target, localPoint, { x: 0, y: 0, z: 1 });
  }
  const faceNormals = [new CANNON.Vec3(1, 0, 0), new CANNON.Vec3(-1, 0, 0), new CANNON.Vec3(0, 1, 0),
    new CANNON.Vec3(0, -1, 0), new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 0, -1)];
  function isExposedFace(index, normal) {
    if (!cells[index] || !faceNormals.some(face => face.distanceTo(vector(normal)) < 1e-8)) return false;
    return !bonds.some(bond => bond.alive && (bond.a === index && bond.normal.dot(vector(normal)) > 0.99 ||
      bond.b === index && bond.normal.dot(vector(normal)) < -0.99));
  }
  function setSurfaceHand(index, target, localPoint, normal) {
    const cell = cells[index];
    if (!cell || cell.pinned || !isExposedFace(index, normal)) throw new Error('surface hand requires unpinned exposed face');
    const expected = Math.abs(normal.x) * cell.half.x + Math.abs(normal.y) * cell.half.y + Math.abs(normal.z) * cell.half.z;
    if (Math.abs(vector(localPoint).dot(vector(normal)) - expected) > 1e-6 ||
        Math.abs(localPoint.x) > cell.half.x + 1e-6 || Math.abs(localPoint.y) > cell.half.y + 1e-6 || Math.abs(localPoint.z) > cell.half.z + 1e-6) {
      throw new Error('surface hand point must lie on exposed face');
    }
    setGrip(index, target, localPoint, normal);
  }
  function setGrip(index, target, localPoint, normal) {
    const cell = cells[index];
    if ([target.x, target.y, target.z, localPoint.x, localPoint.y, localPoint.z].some(value => !Number.isFinite(value))) {
      throw new Error('hand coordinates must be finite');
    }
    if (!hand || hand.index !== index) {
      release();
      const anchor = new CANNON.Body({ mass: 0, position: vector(target) });
      world.addBody(anchor);
      const contact = cell.body.pointToWorldFrame(vector(localPoint));
      const worldNormal = cell.body.vectorToWorldFrame(vector(normal));
      const candidates = [], points = [];
      for (const other of cells) {
        if (other.pinned) continue;
        if (other.index === index) { candidates.push(other); points.push(vector(localPoint)); continue; }
        const face = faceNormals.find(direction => isExposedFace(other.index, direction) &&
          other.body.vectorToWorldFrame(direction).dot(worldNormal) > 0.97);
        if (!face) continue;
        const point = new CANNON.Vec3(face.x * other.half.x, face.y * other.half.y, face.z * other.half.z);
        const offset = other.body.pointToWorldFrame(point).vsub(contact);
        if (offset.length() >= config.gripRadius || Math.abs(offset.dot(worldNormal)) > Math.min(dx, dy, dz) * 0.5) continue;
        candidates.push(other); points.push(point);
      }
      const weights = candidates.map((other, i) => other.index === index ? 1 :
        1 - other.body.pointToWorldFrame(points[i]).distanceTo(contact) / config.gripRadius);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const members = candidates.map((other, i) => {
        const offset = other.body.pointToWorldFrame(points[i]).vsub(contact);
        const weight = weights[i] / total;
        const joint = new CANNON.PointToPointConstraint(other.body, points[i], anchor, offset);
        for (const equation of joint.equations) equation.setSpookParams(config.gripStiffness * weight, config.gripDamping, config.timeStep);
        world.addConstraint(joint);
        return { index: other.index, weight, joint };
      });
      hand = { index, target: anchor.position, anchor, members, localPoint: vector(localPoint), normal: xyz(normal),
        layers: [...new Set(candidates.map(other => other.layer))], force: { x: 0, y: 0, z: 0 } };
    }
    hand.target.copy(vector(target));
  }
  function moveHand(target) {
    if (!hand || [target.x, target.y, target.z].some(value => !Number.isFinite(value))) throw new Error('move requires active hand and finite target');
    hand.target.copy(vector(target));
  }
  function release() {
    if (hand) { for (const member of hand.members) world.removeConstraint(member.joint); world.removeBody(hand.anchor); }
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
      hand: hand ? { index: hand.index, indices: hand.members.map(member => member.index),
        weights: hand.members.map(member => member.weight), radius: config.gripRadius,
        layers: hand.layers, normal: hand.normal, target: xyz(hand.target), force: hand.force } : null,
      bodies: cells.map(cell => ({ index: cell.index, id: cell.id, column: cell.column, row: cell.row,
        layer: cell.layer, pinned: cell.pinned, mass: cell.body.mass, volume: cell.volume,
        position: xyz(cell.body.position), rest: xyz(cell.rest), velocity: xyz(cell.body.velocity),
        angularVelocity: xyz(cell.body.angularVelocity),
        quaternion: { ...xyz(cell.body.quaternion), w: cell.body.quaternion.w },
        component: graph.labels[cell.index], stress: Math.max(0, ...bonds.filter(bond =>
          bond.alive && (bond.a === cell.index || bond.b === cell.index)).map(bond => bond.stress)) })),
      bonds: bonds.map(({ joint, normal, anchorA, anchorB, ...bond }) =>
        ({ ...bond, normal: xyz(normal), anchorA: xyz(anchorA), anchorB: xyz(anchorB) })),
      broken: bonds.filter(bond => !bond.alive).length, components: graph.components,
      events: events.map(event => ({ ...event })), samples: samples.map(sample => ({ ...sample })),
    };
  }
  return { world, cells, bonds, step, setHand, setSurfaceHand, moveHand, isExposedFace, bind, release, snapshot,
    setStrength: value => { if (!Number.isFinite(value) || value <= 0) throw new Error('strength must be positive and finite'); config.strength = value; },
    worldToLocalPoint: (index, point) => {
      if (!cells[index] || [point.x, point.y, point.z].some(value => !Number.isFinite(value))) {
        throw new Error('world point requires known cell and finite coordinates');
      }
      return cells[index].body.pointToLocalFrame(vector(point));
    },
    dispose: () => { disposed = true; release(); for (const joint of [...world.constraints]) world.removeConstraint(joint);
      for (const body of [...world.bodies]) world.removeBody(body); } };
}

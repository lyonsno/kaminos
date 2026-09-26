import { Vector3, Quaternion, Euler } from './lib/three.core.js';

const clone = value => structuredClone(value);

export function checkedPose(pose) {
  const result = {};
  for (const key of ['position', 'rotation', 'scale']) {
    if (!Array.isArray(pose?.[key]) || pose[key].length !== 3 || !pose[key].every(Number.isFinite)) {
      throw new Error(`Pose ${key} requires three finite numbers`);
    }
    result[key] = [...pose[key]];
  }
  return result;
}

export function createSceneEdits({ read, write, changed = () => {}, admit = () => {} }) {
  let active = null;
  let past = [];
  let future = [];
  let replaying = false;
  const targets = new Map();
  const listeners = new Set();
  const check = (id, value) => {
    const target = targets.get(id);
    if (target?.check) return target.check(clone(value));
    if (value == null && target?.allowMissing) return value;
    return checkedPose(value);
  };
  const put = (id, value) => targets.has(id) ? targets.get(id).write(clone(value)) : write(id, value);
  const state = () => ({ active: active ? clone(active) : null, undoCount: past.length, redoCount: future.length, replaying });
  const assertAvailable = () => {
    if (replaying) throw new Error('Wait for the current scene history action to finish');
  };
  const get = id => {
    const pose = targets.has(id) ? targets.get(id).read() : read(id);
    if (pose == null && !targets.get(id)?.allowMissing) throw new Error(`Scene object "${id}" was not found`);
    return check(id, pose);
  };
  const notify = () => {
    changed(state());
    for (const listener of listeners) listener(state());
  };

  function begin(id, label = 'Transform') {
    admit();
    assertAvailable();
    if (active) throw new Error('A scene edit is already active');
    active = { id, label, before: get(id) };
    notify();
    return state();
  }

  function preview(patch) {
    admit();
    assertAvailable();
    if (!active) throw new Error('No scene edit is active');
    const pose = check(active.id, { ...get(active.id), ...patch });
    put(active.id, pose);
    notify();
    return clone(pose);
  }

  function commit() {
    if (!active) return false;
    admit();
    assertAvailable();
    const after = get(active.id);
    const entry = { ...active, after };
    if (JSON.stringify(entry.before) !== JSON.stringify(after)) {
      past.push(entry);
      future = [];
    }
    active = null;
    notify();
    return true;
  }

  function cancel() {
    if (!active) return false;
    assertAvailable();
    get(active.id);
    put(active.id, clone(active.before));
    active = null;
    notify();
    return true;
  }

  function apply(id, patch, label = 'Transform') {
    admit();
    assertAvailable();
    if (active) throw new Error('Finish the active scene edit first');
    const pose = check(id, { ...get(id), ...patch });
    begin(id, label);
    preview(pose);
    commit();
    return clone(pose);
  }

  function replay(from, to, key) {
    admit();
    assertAvailable();
    if (active) throw new Error('Finish the active scene edit first');
    const entry = from.at(-1);
    if (!entry) return false;
    get(entry.id);
    const result = put(entry.id, clone(entry[key]));
    const finish = () => {
      from.pop();
      to.push(entry);
      return true;
    };
    if (!result || typeof result.then !== 'function') {
      finish();
      notify();
      return true;
    }
    replaying = true;
    notify();
    return Promise.resolve(result)
      .then(finish)
      .finally(() => {
        replaying = false;
        notify();
      });
  }

  function recordApplied(id, before, after, label = 'Change') {
    assertCanRecordApplied(id);
    const checkedBefore = check(id, before);
    const checkedAfter = check(id, after);
    if (JSON.stringify(get(id)) !== JSON.stringify(checkedAfter)) {
      throw new Error(`Applied scene edit "${label}" does not match target "${id}"`);
    }
    if (JSON.stringify(checkedBefore) === JSON.stringify(checkedAfter)) return false;
    past.push({ id, label, before: checkedBefore, after: checkedAfter });
    future = [];
    notify();
    return true;
  }

  function assertCanRecordApplied(id) {
    admit();
    assertAvailable();
    if (active?.id === id) throw new Error('Finish the active edit on this target first');
    if (!targets.has(id)) throw new Error(`Scene edit target "${id}" is not registered`);
  }

  function discard(predicate) {
    assertAvailable();
    if (typeof predicate !== 'function') throw new Error('History discard requires an entry predicate');
    if (active) cancel();
    past = past.filter(entry => !predicate(clone(entry)));
    future = future.filter(entry => !predicate(clone(entry)));
    notify();
    return state();
  }

  function unregister(id) {
    assertAvailable();
    if (active?.id === id || past.some(entry => entry.id === id) || future.some(entry => entry.id === id)) {
      throw new Error(`Scene edit target "${id}" is still retained by scene history`);
    }
    return targets.delete(id);
  }

  return {
    begin, preview, commit, cancel, apply, state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    register(id, target) {
      if (!id.startsWith('@') || targets.has(id)) throw new Error('Duplicate or invalid edit target');
      if (!target || typeof target.read !== 'function' || typeof target.write !== 'function') {
        throw new Error('Scene edit targets require read and write functions');
      }
      targets.set(id, target);
    },
    undo: () => replay(past, future, 'before'),
    redo: () => replay(future, past, 'after'),
    recordApplied,
    assertCanRecordApplied,
    discard,
    unregister,
    clear() { assertAvailable(); if (active) cancel(); past = []; future = []; notify(); },
  };
}

export function axisVector(axis, frame = 'world', frameRotation = [0, 0, 0]) {
  const vector = new Vector3(...({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis] || [0, 0, 1]));
  if (frame === 'local') vector.applyQuaternion(new Quaternion().setFromEuler(new Euler(...frameRotation)));
  return vector;
}

export function transformPose(base, {
  operation, axis = null, plane = false, frame = 'world', frameRotation = base.rotation,
  amount = 0, delta = [0, 0, 0], viewAxis = [0, 0, 1], snap = 0,
}) {
  const pose = checkedPose(base);
  if (!Number.isFinite(amount)) throw new Error('Transform amount must be finite');
  if (snap) amount = Math.round(amount / snap) * snap;
  const direction = axisVector(axis, frame, frameRotation);
  if (operation === 'translate') {
    let move = new Vector3(...delta);
    if (axis && !plane) move = direction.multiplyScalar(amount);
    else if (axis && plane) move.addScaledVector(direction, -move.dot(direction));
    if (snap && (!axis || plane)) {
      const rotation = new Quaternion().setFromEuler(new Euler(...frameRotation));
      if (frame === 'local') move.applyQuaternion(rotation.clone().invert());
      move.set(...move.toArray().map(value => Math.round(value / snap) * snap));
      if (axis && plane) move[axis] = 0;
      if (frame === 'local') move.applyQuaternion(rotation);
    }
    pose.position = new Vector3(...base.position).add(move).toArray();
  } else if (operation === 'rotate') {
    const around = axis ? direction : new Vector3(...viewAxis).normalize();
    const rotation = new Quaternion().setFromAxisAngle(around, amount)
      .multiply(new Quaternion().setFromEuler(new Euler(...base.rotation)));
    const euler = new Euler().setFromQuaternion(rotation);
    pose.rotation = [euler.x, euler.y, euler.z];
  } else if (operation === 'scale') {
    const index = { x: 0, y: 1, z: 2 }[axis];
    pose.scale = base.scale.map((value, i) => !axis || (plane ? i !== index : i === index) ? value * amount : value);
  } else {
    throw new Error(`Unknown transform operation: ${operation}`);
  }
  return checkedPose(pose);
}

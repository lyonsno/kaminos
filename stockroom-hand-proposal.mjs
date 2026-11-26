import {Quaternion, Vector3} from './lib/three.core.js';

// One pending piece. Input ownership changes without replacing its geometry or pose.
export function createHandProposal(initial) {
  let pose = structuredClone(initial);
  let accepted = pose;
  const history = [];
  const open = new Set();
  let pointer = false;
  let held = null;
  let armed = null;
  let nominated = false;

  const pending = () => pose.width !== accepted.width ||
    pose.position.some((value, i) => value !== accepted.position[i]) ||
    pose.rotation.some((value, i) => value !== accepted.rotation[i]);
  const read = () => ({
    mode: pointer ? 'pointer' : held ? 'held' : 'parked',
    pose: structuredClone(pose),
    armed,
    holding: held?.side ?? null,
    nominated,
    pending: pending(),
  });

  function park() {
    held = null;
    armed = null;
    open.clear();
  }

  function observe(hands) {
    if (pointer) return;
    if (held) {
      const hand = hands.find(h => h.side === held.side);
      if (!hand || hand.gap >= .7) {
        park();
        return;
      }
      if (!held.base) {
        held.base = {point: hand.point.clone(), inverse: hand.frame.clone().invert(), pose};
        return;
      }
      const base = held.base;
      const movement = hand.point.clone().sub(base.point);
      const position = new Vector3().fromArray(base.pose.position).add(movement).toArray();
      // Extract the twist around the world up axis from the relative palm pose.
      const delta = hand.frame.clone().multiply(base.inverse);
      const twist = new Quaternion(0, delta.y, 0, delta.w);
      const rotation = twist.lengthSq() > 1e-8
        ? twist.normalize().multiply(new Quaternion().fromArray(base.pose.rotation)).normalize().toArray()
        : pose.rotation;
      if (position.some((value, i) => value !== pose.position[i])
          || rotation.some((value, i) => value !== pose.rotation[i])) {
        pose = {...pose, position, rotation};
      }
      return;
    }

    for (const side of open) {
      if (!hands.some(h => h.side === side)) open.delete(side);
    }
    armed = null;
    for (const hand of hands) {
      const eligible = hand.eligible || nominated;
      if (!eligible) {
        open.delete(hand.side);
        continue;
      }
      if (hand.gap >= .7) open.add(hand.side);
      if (!open.has(hand.side)) continue;
      armed ??= hand.side;
      if (hand.gap > .42) continue;
      held = {side: hand.side, base: {point: hand.point.clone(), inverse: hand.frame.clone().invert(), pose}};
      armed = null;
      nominated = false;
      open.clear();
      return;
    }
  }

  return {
    read, observe,
    suspend() {
      armed = null;
      open.clear();
      if (held) held.base = null;
    },
    beginPointer() {
      park();
      nominated = false;
      pointer = true;
    },
    refine(change) {
      if (!pointer) return;
      pose = {...pose, ...structuredClone(change)};
    },
    endPointer() {pointer = false;},
    nominate() {nominated = true;},
    accept() {
      if (pending()) history.push(accepted);
      accepted = pose;
      pointer = false;
      nominated = false;
      park();
    },
    back() {
      if (!pending() && history.length) accepted = history.pop();
      pose = accepted;
      pointer = false;
      nominated = false;
      park();
    },
  };
}

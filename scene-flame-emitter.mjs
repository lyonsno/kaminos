import { Euler, Vector3 } from './lib/three.core.js';
import { checkedPose } from './scene-edit-session.mjs';

export const FLAME_EMITTER_ID = 'flame-emitter';
export const FLAME_EMITTER_TYPE = 'flame-emitter';
export const FLAME_EMITTER_SOURCE = 'kaminos:analytic-flame';

export function defaultFlameEmitterPose() {
  return { position: [0, -0.76, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

export function normalizeFlameEmitterPose(value = defaultFlameEmitterPose()) {
  const pose = checkedPose(value);
  const scale = pose.scale[0];
  if (!(scale > 0) || pose.scale.some(v => Math.abs(v - scale) > 1e-10 * scale)) {
    throw new Error('Flame source requires positive uniform scale; use S without an axis');
  }
  return pose;
}

// The current ordinary flame has one fixed world-aligned simulation domain.
// This frame changes injection only; it does not transform the advected field.
export function flameEmitterFrame(value) {
  const pose = normalizeFlameEmitterPose(value);
  const rotation = new Euler(...pose.rotation);
  return { pose, origin: [...pose.position],
    direction: new Vector3(0, 1, 0).applyEuler(rotation).toArray(),
    supportAxis: new Vector3(1, 0, 0).applyEuler(rotation).toArray(),
    scale: pose.scale[0] };
}

export function createFlameEmitterHandle(THREE) {
  const group = new THREE.Group();
  group.name = 'Flame source';
  group.userData.kaminosEditorHelper = true;
  const material = new THREE.MeshBasicMaterial({color: 0xffb54d, wireframe: true,
    depthWrite: false, toneMapped: false});
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), material));
  group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.22, 0xffb54d, 0.05, 0.025));
  const outlineMaterial = new THREE.MeshBasicMaterial({color: 0xffb54d, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide});
  for (const rotation of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.0025, 4, 32), outlineMaterial);
    ring.rotation.set(...rotation);
    group.add(ring);
  }
  return group;
}

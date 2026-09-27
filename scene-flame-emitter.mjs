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

export function flameDomainTranslationForPose(value) {
  const pose = normalizeFlameEmitterPose(value);
  const [x, y, z] = pose.position;
  if (Math.abs(x) <= 1 && y >= -1 && y <= 3 && Math.abs(z) <= 1) return [0, 0, 0];
  return [x, y - defaultFlameEmitterPose().position[1], z];
}

export function flameDomainTranslationForAcceptedPose(value, currentTranslation) {
  return flamePoseInDomain(value, currentTranslation)
    ? [...currentTranslation]
    : flameDomainTranslationForPose(value);
}

export function flamePoseInDomain(value, translation) {
  const pose = normalizeFlameEmitterPose(value);
  if (!Array.isArray(translation) || translation.length !== 3 || !translation.every(Number.isFinite)) {
    throw new Error('Flame domain translation requires three finite coordinates');
  }
  const [x, y, z] = pose.position.map((component, index) => component - translation[index]);
  return Math.abs(x) <= 1 && y >= -1 && y <= 3 && Math.abs(z) <= 1;
}

export function normalizeFlameDomainTranslation(translation) {
  if (!Array.isArray(translation) || translation.length !== 3 || !translation.every(Number.isFinite)) {
    throw new Error('Flame domain translation requires three finite coordinates');
  }
  return [...translation];
}

export function flamePoseToDomain(value, translation) {
  const pose = normalizeFlameEmitterPose(value);
  if (!Array.isArray(translation) || translation.length !== 3 || !translation.every(Number.isFinite)) {
    throw new Error('Flame domain translation requires three finite coordinates');
  }
  return { ...pose, position: pose.position.map((component, index) => component - translation[index]) };
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

export function updateFlameEmitterSupportOutline(THREE, group, { family, inputRadius } = {}) {
  if (!group) return;
  const signature = `${family}:${inputRadius}`;
  if (group.userData.supportSignature === signature) return;
  const previous = group.userData.supportOutline;
  if (previous) {
    group.remove(previous);
    previous.geometry.dispose();
    previous.material.dispose();
  }
  group.userData.supportOutline = null;
  group.userData.supportSignature = signature;
  if (family !== 'ring' || !Number.isFinite(inputRadius) || inputRadius <= 0) return;
  const material = new THREE.MeshBasicMaterial({ color: 0xffbf66, wireframe: true,
    transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false });
  const outline = new THREE.Mesh(new THREE.TorusGeometry(inputRadius, inputRadius * 0.2, 6, 48), material);
  outline.rotation.x = -Math.PI / 2;
  outline.renderOrder = 1001;
  outline.userData.kaminosEditorHelper = true;
  group.add(outline);
  group.userData.supportOutline = outline;
}

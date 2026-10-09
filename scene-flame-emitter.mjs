import { Euler, Quaternion, Vector3 } from './lib/three.core.js';
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

export function flameDomainTranslationForAcceptedPose(value, currentTranslation, { injectionSuspended = false } = {}) {
  if (injectionSuspended) {
    const pose = normalizeFlameEmitterPose(value);
    return [pose.position[0], pose.position[1] - defaultFlameEmitterPose().position[1], pose.position[2]];
  }
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

// Doctor's engine uses a disc centre and yaw/pitch in domain coordinates.
// The authored object's local +Y is its nozzle axis; roll remains authored
// even though the circular supply does not depend on it.
export function immersedControlsForFlamePose(controls, value, sourceEnabled = true) {
  const frame = flameEmitterFrame(value);
  if (sourceEnabled && !flamePoseInDomain(frame.pose, [0, 0, 0])) {
    throw new Error('Immersed source centre is outside the current domain');
  }
  const radius = Number(controls.immersedRadius ?? 0.2) * frame.scale;
  if (!Number.isFinite(radius) || radius < 0.02 || radius > 0.5) {
    throw new Error('Scaled immersed source radius must be within [0.02, 0.5]');
  }
  const [x, y, z] = frame.direction;
  const yaw = Math.hypot(x, z) < 1e-12 ? Number(controls.immersedYaw ?? 0)
    : (Math.atan2(z, x) * 180 / Math.PI + 360) % 360;
  return { ...controls, immersedCentreX: frame.origin[0], immersedCentreY: frame.origin[1],
    immersedCentreZ: frame.origin[2], immersedYaw: yaw,
    immersedPitch: Math.asin(Math.max(-1, Math.min(1, y))) * 180 / Math.PI,
    immersedRadius: radius, immersedSourceEnabled: sourceEnabled };
}

export function flamePoseFromImmersedControls(controls, translation = [0, 0, 0], previous = defaultFlameEmitterPose()) {
  const pose = normalizeFlameEmitterPose(previous);
  const yaw = Number(controls.immersedYaw ?? 0) * Math.PI / 180;
  const pitch = Number(controls.immersedPitch ?? 90) * Math.PI / 180;
  const direction = new Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
  // Preserve the existing roll when the controls describe the same direction.
  if (new Vector3(...flameEmitterFrame(pose).direction).distanceTo(direction) > 1e-10) {
    pose.rotation = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction)).toArray().slice(0, 3);
  }
  const domain = normalizeFlameDomainTranslation(translation);
  pose.position = [Number(controls.immersedCentreX ?? 0), Number(controls.immersedCentreY ?? -0.5), Number(controls.immersedCentreZ ?? 0)].map((v, i) => v + domain[i]);
  return normalizeFlameEmitterPose(pose);
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

export function updateFlameEmitterSupportOutline(THREE, group, { family, inputRadius, sourceLaw, immersedRadius } = {}) {
  if (!group) return;
  const immersed = sourceLaw === 'immersed-source';
  const radius = immersed ? immersedRadius : inputRadius;
  const signature = `${family}:${sourceLaw}:${radius}`;
  if (group.userData.supportSignature === signature) return;
  const previous = group.userData.supportOutline;
  if (previous) {
    group.remove(previous);
    previous.geometry.dispose();
    previous.material.dispose();
  }
  group.userData.supportOutline = null;
  group.userData.supportSignature = signature;
  if ((!immersed && family !== 'ring') || !Number.isFinite(radius) || radius <= 0) return;
  const material = new THREE.MeshBasicMaterial({ color: 0xffbf66, wireframe: true,
    transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false });
  const outline = new THREE.Mesh(immersed ? new THREE.CircleGeometry(radius, 48)
    : new THREE.TorusGeometry(radius, radius * 0.2, 6, 48), material);
  outline.rotation.x = -Math.PI / 2;
  outline.renderOrder = 1001;
  outline.userData.kaminosEditorHelper = true;
  group.add(outline);
  group.userData.supportOutline = outline;
}

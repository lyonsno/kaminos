// Shared authored-object pose and legacy material overrides, used by page and worker.
import {FrontSide,NormalBlending} from './lib/three.core.js';

export function sceneObjectTransformState(object) {
  return {
    position: object?.position?.toArray?.() || [0, 0, 0],
    rotation: object?.rotation ? [object.rotation.x, object.rotation.y, object.rotation.z] : [0, 0, 0],
    scale: object?.scale?.toArray?.() || [1, 1, 1],
  };
}

export function applySceneObjectTransformState(object, transform = {}) {
  if (!object) return;
  object.position.fromArray(Array.isArray(transform.position) ? transform.position : [0, 0, 0]);
  object.rotation.set(...(Array.isArray(transform.rotation) ? transform.rotation : [0, 0, 0]));
  object.scale.fromArray(Array.isArray(transform.scale) ? transform.scale : [1, 1, 1]);
}

export function getMaterialStateForObject(object) {
  if (!object) return null;
  const state = { side: FrontSide, transparent: true, opacity: 1 };
  object.traverse(child => {
    if (child.isMesh && child.material) {
      const mat = Array.isArray(child.material) ? child.material[0] : child.material;
      state.side = mat.side;
      state.transparent = mat.transparent;
      state.opacity = mat.opacity;
    }
  });
  return state;
}

export function applyMaterialStateToObject(object, state) {
  if (!object || !state) return;
  object.traverse(child => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (state.side !== undefined) mat.side = state.side;
      if (state.transparent !== undefined) mat.transparent = state.transparent;
      if (state.opacity !== undefined) mat.opacity = state.opacity;
      if (!state.transparent) {
        mat.depthWrite = true;
        mat.blending = NormalBlending;
      }
      mat.needsUpdate = true;
    }
  });
}

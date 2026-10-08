import { clone as cloneHierarchy } from 'three/addons/utils/SkeletonUtils.js';

// Clone an object for GLB export, carrying its scene placement as the clone's
// own transform and leaving editor helpers behind. The skeleton-aware clone
// rebinds skinned meshes to their cloned bones, so the exported skin points at
// joints inside the export rather than at the scene's originals.
export function exportCloneInWorld(object) {
  object.updateWorldMatrix(true, true);
  const clone = cloneHierarchy(object);
  const helpers = [];
  clone.traverse(child => { if (child !== clone && child.userData?.kaminosEditorHelper) helpers.push(child); });
  for (const helper of helpers) helper.removeFromParent();
  object.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
  return clone;
}

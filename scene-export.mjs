import { clone as cloneHierarchy } from 'three/addons/utils/SkeletonUtils.js';

import { snapshotExportGeometry } from './scene-export-geometry.mjs';

// Clone an object for GLB export, carrying its scene placement as the clone's
// own transform and leaving editor helpers behind. The skeleton-aware clone
// rebinds skinned meshes to their cloned bones, so the exported skin points at
// joints inside the export rather than at the scene's originals.
export function exportCloneInWorld(object) {
  const restoreBeauty = object.userData?.kaminosBeautyLodRestore?.();
  try {
    object.updateWorldMatrix(true, true);
    const clone = cloneHierarchy(object);
    snapshotExportGeometry(object, clone);
    // Export the portable triangle fallback. Retire the temporary clone's
    // reconstruction before detaching helpers, restoring its source materials.
    const splats=[];clone.traverse(child=>{if(child.isSurfaceSplatObject)splats.push(child);});
    for(const child of splats)child.dispose();
    const helpers = [];
    clone.traverse(child => {
      // Evaluated copies become ordinary asset geometry at this boundary. Their
      // live ownership marker must not survive glTF extras and a later import.
      delete child.userData.kaminosRepetitionCopy;
      if (child !== clone && (child.userData?.kaminosEditorHelper || child.userData?.kaminosBeautyLodProxy)) helpers.push(child);
    });
    for (const helper of helpers) helper.removeFromParent();
    object.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    return clone;
  } finally {
    restoreBeauty?.();
  }
}
